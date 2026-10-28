/**
 * The setup before the first main menu, for anyone who left a first-run question unanswered (the ROM page asks them
 * while the ROM imports: first-run.ts): OpenSinnoh's own screen on the
 * design system (@opensinnoh/ui), not the game's message box, since these are the app's questions, not Rowan's.
 * It asks whether to send error reports (nothing is sent before the answer), whether to add the optional
 * HeartGold/SoulSilver ROM (following Pokémon for every species; only where the add-on can be imported), and the
 * text speed and the visual style (DS by default; asked only until the device has chosen one). Each answer is stored at once as a device option, changeable in Options; a question already
 * answered on this device is not asked again (picking the add-on opens the ROM page's import, whose Start playing comes back here for the rest).
 * Keys and the pad move the cursor (up/down) and choose (A); a tap on an answer sends `menu:<i>`.
 */
import type { InputFrame } from '@opensinnoh/contracts';
import { choices, h, snapPixels, titleTab, wordmark } from '@opensinnoh/ui';
import { ASK, type SetupQuestion } from './setup-questions.ts';
import { S } from '../strings/index.ts';
import './setup.css';

export { readAnswered, SETUP_KEY, storeAnswered, type SetupQuestion } from './setup-questions.ts';

export interface SetupDeps {
  /** The questions to ask, in this order. */
  questions: readonly SetupQuestion[];
  /** The device's text speed (0 slow, 1 mid, 2 fast). */
  textSpeed(): number;
  /** Render calls per character at a text speed (the game's TEXT_FRAME_DELAY; Rowan's intro reads it). */
  textDelay(speed: number): number;
  /** Stores an answer: `reports` 0 allow, 1 don't; `addon` 1 skip; `textSpeed` the speed. */
  answer(q: SetupQuestion, choice: number): void;
  /** ADD NOW: the file picker for the add-on ROM (picking one imports it on the ROM page, then Start playing). */
  pickAddon(): void;
}

/** The screen's heading: the setup's, or another flow's that asks on the same screen. */
export interface SetupHeading {
  tab: string;
  lead: string;
}
/** The fade to black before the main menu fades in (frames). */
const FADE = 6;

export class SetupFlow {
  private index = 0;
  private cursor: number;
  private fadeOut: number | null = null;

  constructor(private readonly deps: SetupDeps) {
    this.cursor = this.start();
  }

  /** The question on screen, or null (tests). */
  get question(): SetupQuestion | null {
    return this.fadeOut === null ? (this.deps.questions[this.index] ?? null) : null;
  }

  /** The cursor's first place: the stored text speed, else the first answer. */
  private start(): number {
    return this.deps.questions[this.index] === 'textSpeed' ? this.deps.textSpeed() : 0;
  }

  /** One 30 Hz tick; true once the setup has faded out. */
  tick(f: InputFrame): boolean {
    if (this.fadeOut !== null) return ++this.fadeOut >= FADE;
    const q = this.question;
    if (!q) {
      this.fadeOut = 0;
      return false;
    }
    const n = ASK[q].entries.length;
    const pressed = (b: string) => f.pressed.includes(b as never);
    const tap = f.tap?.startsWith('menu:') ? Number(f.tap.slice(5)) : null;
    let chosen: number | null = null;
    // Moves first: a move and A in the same frame choose where the move went.
    if (pressed('up')) this.cursor = Math.max(0, this.cursor - 1);
    else if (pressed('down')) this.cursor = Math.min(n - 1, this.cursor + 1);
    if (tap !== null && tap >= 0 && tap < n) chosen = this.cursor = tap;
    else if (pressed('a')) chosen = this.cursor;
    if (chosen === null) return false;
    if (q === 'addon' && chosen === 0) {
      // The picker; the ROM page imports it and offers Start playing. Cancelled: the question stays.
      this.deps.pickAddon();
      return false;
    }
    this.deps.answer(q, chosen);
    this.index++;
    if (this.index >= this.deps.questions.length) this.fadeOut = 0;
    else this.cursor = this.start();
    return false;
  }

  /** What the screen shows: the question, its answers and the cursor, and the fade (0 to 1). */
  view(): { question: SetupQuestion | null; step: number; steps: number; cursor: number; fade: number } {
    return { question: this.question, step: this.index + 1, steps: this.deps.questions.length, cursor: this.cursor, fade: this.fadeOut === null ? 0 : this.fadeOut / FADE };
  }
}

/**
 * The setup's screen: the OpenSinnoh wordmark (its intro plays once, as the setup starts) over one window on the
 * page's background, full bleed on a phone. The window redraws when the view changes; the wordmark stays.
 */
export class SetupScreen {
  readonly root: HTMLElement;
  private readonly shade: HTMLElement;
  private readonly col: HTMLElement;
  private panel: HTMLElement | null = null;
  private drawn = '';

  constructor(
    private readonly setup: SetupFlow,
    private readonly tap: (id: string) => void,
    private readonly heading: SetupHeading = S.title.setupHeading,
  ) {
    this.root = h('div', 'os os-screen os-field tm-flow tm-setup');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', S.title.setup);
    this.root.dataset.screen = 'setup';
    this.shade = h('div', 'setup-shade');
    this.col = h('div', 'setup-col', h('div', 'setup-brand', wordmark(5, { animate: true })));
    this.root.append(this.col, this.shade);
    this.draw();
  }

  draw(): void {
    const v = this.setup.view();
    this.shade.style.opacity = String(v.fade);
    const key = JSON.stringify([v.question, v.step, v.cursor]);
    if (key === this.drawn) return;
    const first = this.drawn === '';
    this.drawn = key;
    if (!v.question) {
      // Fading out: the last question stays under the shade.
      return;
    }
    const ask = ASK[v.question];
    const panel = h('section', `os-win setup-panel${first ? ' os-enter' : ''}`);
    panel.dataset.question = v.question;
    const counter = h('span', 'os-num', `${v.step}/${v.steps}`);
    counter.setAttribute('aria-hidden', 'true');
    const title = h('h3', 'setup-q os-title', ask.title);
    title.id = 'setup-q';
    const list = choices(ask.entries, v.cursor, { label: ask.title, onPick: (i) => this.tap(`menu:${i}`) });
    list.classList.add('setup-choices');
    list.setAttribute('aria-labelledby', title.id);
    list.removeAttribute('aria-label');
    list.querySelectorAll<HTMLElement>('.os-choice').forEach((b, i) => (b.dataset.tap = `menu:${i}`));
    panel.append(
      titleTab(this.heading.tab, { icon: 'gear', tone: 'system', end: [h('span', 'os-sr', S.title.question(v.step, v.steps)), counter] }),
      h(
        'div',
        'setup-body',
        h('p', 'setup-lead', this.heading.lead),
        h('div', 'setup-ask', title, h('p', 'setup-text', ask.text)),
        list,
      ),
    );
    if (this.panel) this.panel.replaceWith(panel);
    else this.col.append(panel);
    this.panel = panel;
    // Keyboard focus follows the cursor, so a screen reader reads the answer the keys are on.
    list.querySelector<HTMLElement>('.is-cursor')?.focus({ preventScroll: true });
    snapPixels(this.root);
  }
}
