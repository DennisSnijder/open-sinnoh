/**
 * OPTIONS, one page per section (settings.ts), on the OpenSinnoh UI design system (@opensinnoh/ui,
 * docs/design-system.md): OpenSinnoh's own screen, so it is not drawn with ROM art or the ROM font. One
 * window (the picked frame) over the field, capped and centred on whole pixels, full bleed on a phone: the
 * system-toned title tab, underline tabs for the sections, the rows (the ▶, label, description and one control:
 * every value of a choice inline, ◀ value ▶ for a stepper, a switch for a toggle, cells for a slider, a
 * button for an action), the description box (typed at the Text speed) and the footer with Back.
 *
 * The screen keeps its own page and cursor (the OPTIONS app's cursor covers only the DS options): while the
 * app is open it takes the d-pad, A, L and R from the input frame and the `settings:` taps of its DOM; a DS
 * option changes through the app's tap (next frame), B and Back go to the app. The cursor is a slot: the tab
 * row, a setting, or Back (the last), drawn as the cursor row (`is-cursor`). The title opens the same screen
 * over `createOptions` (title/options-flow.ts). A setting that does not work where it is open (`where`) is
 * drawn muted and says why; a DATA action's result (or error) replaces the description until the cursor
 * moves. A destructive action asks first in a dialog that opens on NO (up/down/left/right and A, B is NO, or
 * a tap), never a browser dialog.
 */
import type { InputFrame, OptionsView } from '@opensinnoh/contracts';
import { applyButtonMode } from '@opensinnoh/game';
import type { Button } from '@opensinnoh/core';
import { backButton, button, cycle, dialog, footer, h, pick as osPick, row as osRow, slider, tabs, titleTab, toggle, typeText, type IconName } from '@opensinnoh/ui';
import { controls } from '../input.ts';
import type { DrawContext } from './apps.ts';
import { pages, stepSetting, type AppSettings, type Setting, type SettingsEnv, type SectionId } from './settings.ts';
import { language, S } from '../strings/index.ts';
import './options.css';

const SECTION_ICONS: Record<SectionId, IconName> = { game: 'pad', device: 'screen', controls: 'dpad', data: 'disk', privacy: 'shield' };

/** A row of a page: the tab strip, a setting, or CLOSE (Back, always last). */
type Slot = { kind: 'tabs' } | { kind: 'setting'; setting: Setting } | { kind: 'close' };

/** The buttons the screen takes while open; the others (B) go to the OPTIONS app. */
const TAKEN: readonly Button[] = ['up', 'down', 'left', 'right', 'a', 'l', 'r'];

export class OptionsScreen {
  private page = 0;
  /** An index into the page's slots (0 is the tab strip). */
  private cursor = 1;
  private open = false;
  /** A DATA action's result line, shown in the description strip until the cursor moves. */
  private status = '';
  /** The actions running (a second press on one does nothing). */
  private readonly running = new Set<string>();
  /** An action's open question: its YES/NO cursor (0 YES) and the answer's promise. */
  private asking: { question: string; cursor: number; danger: boolean; answer(yes: boolean): void } | null = null;
  /** The question last drawn (its dialog opens once). */
  private drawnQuestion: object | null = null;
  /** Whether the running action is destructive (its question's YES is a danger button). */
  private danger = false;
  /** The description last typed (a redraw with the same text shows it whole). */
  private typed = '';

  constructor(
    private readonly deps: {
      /** Where the screen is open: from the title or in the game. */
      where: 'title' | 'game';
      settings(): AppSettings;
      tap(id: string): void;
      /** The BUTTON MODE option (the DS remaps every key read; L=A takes L and R). */
      buttonMode(): number;
    },
  ) {}

  env(view: OptionsView): SettingsEnv {
    return { ...this.deps.settings(), where: this.deps.where, view, tap: this.deps.tap, ask: (question) => this.ask(question) };
  }

  /** The question in a dialog with NO and YES, the cursor on NO; resolves with the answer (B and leaving the screen are NO). */
  private ask(question: string): Promise<boolean> {
    if (this.asking) throw new Error('ui: options asked a second question while one is open');
    return new Promise((resolve) => {
      this.asking = {
        question,
        cursor: 1,
        danger: this.danger,
        answer: (yes) => {
          this.asking = null;
          resolve(yes);
        },
      };
    });
  }

  /** The open question's input: up/down (swap), left (NO), right (YES), A, B (NO), or a tap on YES or NO. */
  private answer(b: Button | 'yes' | 'no'): void {
    const q = this.asking!;
    if (b === 'up' || b === 'down') q.cursor = 1 - q.cursor;
    else if (b === 'left' || b === 'right') q.cursor = b === 'right' ? 0 : 1;
    else if (b === 'a') q.answer(q.cursor === 0);
    else if (b === 'b' || b === 'no') q.answer(false);
    else if (b === 'yes') q.answer(true);
  }

  private slots(env: SettingsEnv): Slot[] {
    const p = pages(env)[this.page]!;
    return [{ kind: 'tabs' }, ...p.settings.map((setting) => ({ kind: 'setting' as const, setting })), { kind: 'close' }];
  }

  /** The state that changes the drawing (with the app's view and the settings' values). */
  key(view: OptionsView): string {
    const env = this.env(view);
    return JSON.stringify([this.page, this.cursor, this.status, this.asking && [this.asking.question, this.asking.cursor], pages(env).flatMap((p) => p.settings.map((s) => [s.get(env), s.values(env), s.disabled?.(env) ?? null]))]);
  }

  /** A line for the description strip (a DATA action's result). */
  say(text: string): void {
    this.status = text;
  }

  private moveTo(cursor: number): void {
    if (cursor !== this.cursor) this.status = '';
    this.cursor = cursor;
  }

  /** A on an action: its question first (declining does nothing), then its work; the result is said. */
  private activate(env: SettingsEnv, s: Setting): void {
    if (s.disabled?.(env) || this.running.has(s.id)) return;
    this.running.add(s.id);
    this.status = '';
    this.danger = !!s.danger?.(env);
    const question = s.confirm?.(env);
    (question ? env.ask(question) : Promise.resolve(true))
      .then((yes) => (yes ? s.run!(env) : ''))
      .then(
        (text) => this.say(text),
        (e: Error) => this.say(e.message),
      )
      .finally(() => this.running.delete(s.id));
  }

  /** One tick while the OPTIONS app is open (null view: it is not): returns the frame the game steps with. */
  input(frame: InputFrame, view: OptionsView | null): InputFrame {
    if (!view) {
      this.open = false;
      this.asking?.answer(false);
      controls.cancelCapture();
      return frame;
    }
    // A tap elsewhere (a row, a tab, Back) ends a binding that waits for a key; the tap itself is handled below.
    if (frame.tap?.startsWith('settings:')) controls.cancelCapture();
    if (!this.open) {
      this.open = true;
      this.page = 0;
      this.cursor = 1;
      this.status = '';
    }
    const env = this.env(view);
    if (this.asking) {
      // The question takes every button (B is NO, not CLOSE) and the YES/NO taps; nothing goes on to the app.
      if (frame.tap === 'settings:answer:yes' || frame.tap === 'settings:answer:no') this.answer(frame.tap === 'settings:answer:yes' ? 'yes' : 'no');
      else for (const b of applyButtonMode(frame, this.deps.buttonMode()).pressed) if (this.asking) this.answer(b);
      return { held: [], pressed: [], touch: frame.touch };
    }
    let tap = frame.tap;
    if (tap?.startsWith('settings:')) {
      this.tap(env, tap.slice('settings:'.length));
      tap = undefined;
    }
    const pressed = applyButtonMode(frame, this.deps.buttonMode()).pressed;
    for (const b of pressed) if (TAKEN.includes(b)) this.button(env, b);
    // The frame without what the screen took (B, and the app's own taps, go on).
    const keep = (list: Button[]) => list.filter((b) => !TAKEN.includes(b));
    const out: InputFrame = { held: keep(frame.held), pressed: keep(frame.pressed), touch: frame.touch };
    if (tap !== undefined) out.tap = tap;
    return out;
  }

  private button(env: SettingsEnv, b: Button): void {
    const slots = this.slots(env);
    const slot = slots[this.cursor]!;
    if (b === 'up' || b === 'down') this.moveTo((this.cursor + (b === 'up' ? slots.length - 1 : 1)) % slots.length);
    else if (b === 'l' || b === 'r') this.turn(env, b === 'l' ? -1 : 1);
    else if (b === 'left' || b === 'right') {
      if (slot.kind === 'tabs') this.turn(env, b === 'left' ? -1 : 1);
      else if (slot.kind === 'setting') stepSetting(env, slot.setting, b === 'left' ? -1 : 1);
    } else if (b === 'a') {
      if (slot.kind === 'close') env.tap('close');
      else if (slot.kind === 'tabs') this.turn(env, 1);
      else if (slot.setting.kind === 'action') this.activate(env, slot.setting);
      else stepSetting(env, slot.setting, 1);
    }
  }

  /** The next or previous page (wrapping); the cursor stays on the tabs, else goes to the first setting. */
  private turn(env: SettingsEnv, delta: 1 | -1): void {
    const n = pages(env).length;
    this.page = (this.page + delta + n) % n;
    this.status = '';
    this.cursor = this.cursor === 0 ? 0 : 1;
  }

  /** A `settings:` tap of the DOM: `page:<i>`, `turn:<±1>`, `row:<slot>`, `value:<id>:<v>`, `step:<id>:<±1>`. */
  private tap(env: SettingsEnv, id: string): void {
    const [what, a, b] = id.split(':');
    if (what === 'page') {
      this.page = Number(a);
      this.status = '';
      this.cursor = 0;
      return;
    }
    if (what === 'turn') {
      this.turn(env, Number(a) as 1 | -1);
      return;
    }
    if (what === 'row') {
      this.moveTo(Number(a));
      return;
    }
    const slots = this.slots(env);
    const i = slots.findIndex((s) => s.kind === 'setting' && s.setting.id === a);
    if (i < 0) throw new Error(`ui: no setting ${a} on this options page`);
    this.moveTo(i);
    const setting = (slots[i] as { setting: Setting }).setting;
    if (what !== 'value' && what !== 'step') throw new Error(`ui: unknown options tap ${id}`);
    if (setting.kind === 'action') this.activate(env, setting);
    else if (setting.disabled?.(env)) return;
    else if (what === 'value') setting.set(env, Number(b));
    else stepSetting(env, setting, Number(b) as 1 | -1);
  }

  /** The screen for the app's view: the root fills the room; its window places itself. */
  draw(d: DrawContext, view: OptionsView): HTMLElement {
    const env = this.env(view);
    const all = pages(env);
    const page = all[this.page]!;
    const slots = this.slots(env);
    const root = h('div', 'os os-screen os-options');
    root.setAttribute('aria-label', view.title);
    const panel = h('section', 'os-win os-panel');
    root.append(panel);

    panel.append(titleTab(S.options.tab, { icon: 'gear', tone: 'system' }));

    // The sections; on the tab row the cursor is on the open page's tab.
    const strip = tabs(
      all.map((p) => ({ id: p.section.id, label: labelCase(p.section.label), icon: SECTION_ICONS[p.section.id] })),
      page.section.id,
      { label: S.options.sections, keyboard: false },
    );
    strip.classList.add('options-tabs');
    for (const [i, t] of [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')].entries()) {
      t.classList.add('options-tab');
      t.dataset.section = all[i]!.section.id;
      tapOn(d, t, `settings:page:${i}`);
      if (this.cursor === 0 && i === this.page) t.classList.add('is-cursor');
    }
    panel.append(strip);

    const list = h('div', 'os-list options-rows');
    list.setAttribute('role', 'tabpanel');
    list.setAttribute('aria-label', labelCase(page.section.label));
    list.dataset.scrolls = '';
    slots.forEach((slot, i) => {
      if (slot.kind === 'setting') list.append(settingRow(d, env, slot.setting, i, this.cursor === i));
    });
    panel.append(list);

    // The description box: an action's result, a muted row's reason, or the row's help, typed at the Text speed.
    const slot = slots[this.cursor]!;
    const text = oneLine(this.status || (slot.kind === 'setting' ? slot.setting.disabled?.(env) ?? slot.setting.description(env) : slot.kind === 'close' ? view.closeDescription : ''));
    const desc = h('p', `os-win os-desc options-desc${this.status ? ' is-status' : ''}`);
    desc.dataset.frame = 'slim';
    desc.setAttribute('aria-live', 'polite');
    if (text === this.typed) desc.textContent = text;
    else typeText(desc, text, view.rows.find((r) => r.key === 'textSpeed')!.value);
    this.typed = text;
    panel.append(desc);

    // The footer: Back (the CLOSE slot).
    const back = backButton();
    back.classList.add('options-close');
    tapOn(d, back, 'close');
    if (slot.kind === 'close') {
      back.classList.add('is-cursor');
      back.setAttribute('aria-current', 'true');
    }
    panel.append(footer(back));

    if (this.asking) {
      const q = this.asking;
      const answer = (i: 0 | 1, text: string) => {
        const b = button(text, i === 0 ? { variant: q.danger ? 'solid-danger' : 'primary' } : {});
        b.classList.add('options-answer');
        tapOn(d, b, `settings:answer:${i === 0 ? 'yes' : 'no'}`);
        if (q.cursor === i) {
          b.classList.add('is-cursor');
          b.setAttribute('aria-current', 'true');
        }
        return b;
      };
      const layer = dialog(oneLine(q.question), '', [answer(1, S.options.no), answer(0, S.options.yes)]);
      layer.classList.add('options-question');
      // It opens once; later draws (the cursor moving) do not open it again.
      if (this.drawnQuestion !== q) layer.firstElementChild!.classList.add('os-enter');
      this.drawnQuestion = q;
      panel.append(layer);
    }
    return root;
  }
}

/** German words a label in capitals keeps in lower case (all others are nouns, as in the ROM's KAMPFSTIL or TEXT-TEMPO). */
const GERMAN_LOWER = new Set(['der', 'die', 'das', 'des', 'dem', 'den', 'und', 'oder', 'im', 'in', 'am', 'an', 'auf', 'aus', 'bei', 'mit', 'von', 'vom', 'zu', 'zum', 'zur', 'für']);

/**
 * A label in capitals (ours, or the ROM's) in the game's casing; any other label is shown as written. English is
 * sentence case ("BATTLE STYLE" → "Battle style"); German capitalises each word and each part after a hyphen, as
 * its nouns are ("TEXT-TEMPO" → "Text-Tempo"), except the small words. ROM and HGSS stay in capitals.
 */
export const labelCase = (s: string): string => {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  const cased =
    language() === 'de'
      ? lower.replace(/(^|[\s-])([^\s-]+)/g, (_, sep: string, word: string) => sep + (sep !== '' && GERMAN_LOWER.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      : lower.charAt(0).toUpperCase() + lower.slice(1);
  return cased.replace(/\b(rom|hgss)\b/gi, (word) => word.toUpperCase());
};

/** The DS descriptions break lines for its window; ours wrap. */
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ');

/** A control's tap (`settings:` or the app's), never also the row's under it. */
function tapOn(d: DrawContext, e: HTMLElement, id: string): void {
  e.dataset.tap = id;
  e.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (e.getAttribute('aria-disabled') !== 'true') d.tap(id);
  });
}

/** One setting's row: its label, description and its control by kind. A tap on the row moves the cursor there. */
function settingRow(d: DrawContext, env: SettingsEnv, s: Setting, slot: number, cursor: boolean): HTMLElement {
  const off = s.disabled?.(env) ?? null;
  const label = labelCase(s.label(env));
  const v = s.get(env);
  const values = s.values(env);
  const id = s.id;
  const pick = (value: number) => d.tap(`settings:value:${id}:${value}`);
  let control: HTMLElement;
  if (s.kind === 'slider') {
    const r = s.range!;
    control = slider(v, r.max, { label, min: r.min, keyboard: false, disabled: !!off, onSet: pick });
  } else if (s.kind === 'stepper') {
    control = cycle(values, v, { label, disabled: !!off, onStep: (delta) => d.tap(`settings:step:${id}:${delta}`) });
    for (const a of control.querySelectorAll<HTMLElement>('.arr')) {
      a.classList.add('options-step');
      a.dataset.tap = `settings:step:${id}:${a.classList.contains('prev') ? -1 : 1}`;
    }
    control.querySelector('.cv')!.classList.add('options-value', 'on');
  } else if (s.kind === 'toggle') {
    // The pack's ON and OFF (index 0 is ON).
    control = toggle(v === 0, { label, words: [values[0]!, values[1]!], disabled: !!off, onChange: (on) => pick(on ? 0 : 1) });
    control.classList.add('options-value');
  } else if (s.kind === 'action') {
    control = button(values[0]!, s.danger?.(env) ? { variant: 'danger' } : {});
    control.classList.add('options-value', 'action');
    if (off) control.setAttribute('aria-disabled', 'true');
    tapOn(d, control, `settings:value:${id}:0`);
  } else {
    control = osPick(values, v, { label, disabled: !!off, onPick: pick });
    for (const [i, b] of [...control.querySelectorAll<HTMLElement>('button')].entries()) {
      b.classList.add('options-value');
      b.dataset.tap = `settings:value:${id}:${i}`;
    }
  }
  // A working control's click is its own; a muted one's moves the cursor to the row and shows why.
  if (!off) control.addEventListener('click', (e) => e.stopPropagation());
  const r = osRow(label, oneLine(off ?? s.description(env)), control, { disabled: !!off, cursor });
  r.classList.add('options-row', `kind-${s.kind}`);
  r.querySelector('.lab')!.classList.add('options-label');
  r.dataset.setting = id;
  r.dataset.storage = s.storage;
  r.dataset.tap = `settings:row:${slot}`;
  r.setAttribute('role', 'group');
  r.setAttribute('aria-label', label);
  if (cursor) r.setAttribute('aria-current', 'true');
  r.addEventListener('click', () => d.tap(`settings:row:${slot}`));
  return r;
}
