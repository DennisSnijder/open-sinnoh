/**
 * The first-run setup on the ROM page: while the Platinum ROM imports, a short wizard asks the
 * questions a new player answers once (the optional HeartGold/SoulSilver add-on, error reports, text speed, the visual
 * style). It is a
 * list of steps, so a later question is one more entry in `STEPS`. Each answer is stored at once where the title's
 * setup (title/setup.ts) keeps it, so a question answered here is never asked there, and one left open (the player
 * pressed Start playing first) is asked there.
 *
 * Keys: Tab and the arrows move between the answers (the cursor follows focus), Enter or Space picks.
 */
import { choices, h, icon, snapPixels } from '@opensinnoh/ui';
import { readReports, reportsAnswered } from './telemetry/settings.ts';
import { setReportsEnabled } from './telemetry/index.ts';
import { ASK, readAnswered, storeAnswered, type SetupQuestion } from './title/setup-questions.ts';
import { OPTIONS_KEY, parseOptions, storeOption } from './ui/options-store.ts';
import { readVisuals, storeVisuals, VISUAL_STYLES, visualStyleChosen } from './visuals.ts';
import { S } from './strings/index.ts';

export interface FirstRunDeps {
  /** The add-on's file was picked: import it (now, or once the base import is done). */
  addAddon(file: File): void;
  /** Every step is answered or skipped. */
  done(): void;
}

interface Step {
  id: SetupQuestion;
  /** Whether to ask it on this device now. */
  ask(o: { addon: boolean }): boolean;
  /** The answer the cursor starts on (-1: none, for a question with no default answer). */
  cursor(): number;
  /** Stores answer `i`; false when the step stays (the add-on's file dialog is open). */
  answer(i: number, deps: FirstRunDeps, input: HTMLInputElement): boolean;
}

const stored = (q: SetupQuestion) => {
  const err = storeAnswered(q);
  if (err) console.warn(`the setup's answers are kept for this visit only: ${err}`);
};

function storedTextSpeed(): number {
  try {
    return parseOptions(localStorage.getItem(OPTIONS_KEY)).options.textSpeed;
  } catch {
    return parseOptions(null).options.textSpeed;
  }
}

/** The steps, in order. */
const STEPS: readonly Step[] = [
  {
    id: 'addon',
    ask: (o) => !o.addon,
    cursor: () => -1,
    answer(i, _deps, input) {
      if (i === 0) {
        // The system's file dialog; the step moves on once a file is picked (the input's change), not on a cancel.
        input.click();
        return false;
      }
      stored('addon');
      return true;
    },
  },
  {
    id: 'reports',
    ask: () => !reportsAnswered(),
    cursor: () => (reportsAnswered() ? (readReports() ? 0 : 1) : -1),
    answer(i) {
      const err = setReportsEnabled(i === 0);
      if (err) console.warn(`the error reports setting is kept for this visit only: ${err}`);
      stored('reports');
      return true;
    },
  },
  {
    id: 'textSpeed',
    ask: () => true,
    cursor: storedTextSpeed,
    answer(i) {
      const err = storeOption('textSpeed', i);
      if (err) console.warn(`the text speed is kept for this visit only: ${err}`);
      stored('textSpeed');
      return true;
    },
  },
  {
    id: 'visualStyle',
    ask: () => !visualStyleChosen(),
    // DS until chosen.
    cursor: () => VISUAL_STYLES.indexOf(readVisuals().style),
    answer(i) {
      const err = storeVisuals({ ...readVisuals(), style: VISUAL_STYLES[i]! });
      if (err) console.warn(`the visual style is kept for this visit only: ${err}`);
      stored('visualStyle');
      return true;
    },
  },
];

/** The steps still open on this device. `addon`: an add-on is already imported (its question is not asked). */
export function pendingSteps(o: { addon: boolean }): SetupQuestion[] {
  const answered = readAnswered();
  return STEPS.filter((s) => !answered.includes(s.id) && s.ask(o)).map((s) => s.id);
}

/**
 * The wizard's DOM (`root`): the step count and dots, the question, its answers; then "All set". It redraws one
 * step at a time (the stepped opening on each new step; reduced motion shows it at once).
 */
export class FirstRun {
  readonly root: HTMLElement;
  private index = 0;
  private readonly steps: Step[];
  private readonly input: HTMLInputElement;

  constructor(
    questions: readonly SetupQuestion[],
    private readonly deps: FirstRunDeps,
  ) {
    this.steps = questions.map((q) => STEPS.find((s) => s.id === q)!);
    this.root = h('section', 'fr');
    this.root.id = 'wizard';
    this.root.setAttribute('aria-labelledby', 'fr-q');
    // The add-on's file input: outside the redrawn step, so a pick that lands after a redraw still arrives.
    this.input = h('input');
    Object.assign(this.input, { type: 'file', accept: '.nds,application/octet-stream', id: 'addon-input', hidden: true });
    this.input.setAttribute('aria-label', S.title.chooseAddon);
    this.input.addEventListener('change', () => {
      const file = this.input.files?.[0];
      this.input.value = '';
      if (!file || this.current?.id !== 'addon') return;
      stored('addon');
      this.deps.addAddon(file);
      this.next(true);
    });
    this.root.append(this.input);
    this.draw(false);
  }

  get current(): Step | null {
    return this.steps[this.index] ?? null;
  }

  get finished(): boolean {
    return this.index >= this.steps.length;
  }

  private next(focus: boolean): void {
    this.index++;
    this.draw(focus);
    if (this.finished) this.deps.done();
  }

  private draw(focus: boolean): void {
    for (const el of [...this.root.children]) if (el !== this.input) el.remove();
    const step = this.current;
    const n = this.steps.length;
    const body = h('div', 'fr-step os-enter');
    if (!step) {
      const done = h('div', 'fr-done', icon('check'), h('div', '', h('h2', 'fr-q', S.title.allSet), h('p', 'fr-text', S.title.changeLater)));
      done.querySelector('h2')!.id = 'fr-q';
      done.querySelector('h2')!.tabIndex = -1;
      body.append(done);
      this.root.append(body);
      if (focus) done.querySelector('h2')!.focus({ preventScroll: true });
      snapPixels(this.root);
      return;
    }
    const ask = ASK[step.id];
    // The count, as numbers and as dots (done, this one, to come).
    const dots = h('span', 'fr-dots', ...this.steps.map((_, i) => h('i', i < this.index ? 'done' : i === this.index ? 'now' : '')));
    dots.setAttribute('aria-hidden', 'true');
    const count = h('p', 'fr-count', h('span', 'os-num', S.title.question(this.index + 1, n)), dots);
    const title = h('h2', 'fr-q', ask.title);
    title.id = 'fr-q';
    const cursor = step.cursor();
    const list = choices(ask.entries, cursor, { label: ask.title, onPick: (i) => step.answer(i, this.deps, this.input) && this.next(true) });
    list.classList.add('fr-choices');
    list.setAttribute('aria-labelledby', title.id);
    list.removeAttribute('aria-label');
    list.dataset.question = step.id;
    const buttons = [...list.querySelectorAll<HTMLButtonElement>('.os-choice')];
    // One cursor: it follows focus and the pointer, and the arrows move it.
    const moveCursor = (b: HTMLButtonElement) => buttons.forEach((x) => x.classList.toggle('is-cursor', x === b));
    for (const b of buttons) {
      b.addEventListener('focus', () => moveCursor(b));
      b.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && moveCursor(b));
    }
    list.addEventListener('keydown', (e) => {
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const to = e.key === 'ArrowDown' ? Math.min(buttons.length - 1, at + 1) : e.key === 'ArrowUp' ? Math.max(0, at - 1) : null;
      if (to === null) return;
      e.preventDefault();
      buttons[to]!.focus();
    });
    body.append(count, h('div', 'fr-ask', title, h('p', 'fr-text', ask.text)), list);
    this.root.append(body);
    if (focus) (buttons[cursor] ?? buttons[0])!.focus({ preventScroll: true });
    snapPixels(this.root);
  }
}
