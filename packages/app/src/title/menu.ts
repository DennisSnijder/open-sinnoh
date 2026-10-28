/**
 * The main menu (decomp src/main_menu/main_menu.c) on one responsive screen: option windows stacked on
 * the DS blue (GX_RGB(12, 12, 31)), CONTINUE with the save's info panel (player, time, badges and,
 * once obtained, the Pokédex; text in the player's gender colour), NEW GAME, and OPTIONS (where the DS lists
 * Nintendo WFC settings): the one OPTIONS screen the game opens too (options-flow.ts). The focused window's frame
 * cycles its colour one step a frame (sFocusedOptionBorderColors). Up/down move, A (or Start) opens, B returns to
 * the title; taps open directly. Every cursor move that moves, every choice and B play SE_CONFIRM (main_menu.c
 * FocusNextOption and MAIN_MENU_STATE_SELECT_OPTION); a move at either end is silent.
 * NEW GAME runs Rowan's intro from the ROM, with the naming keyboard (new-game-flow.ts).
 */
import type { Button } from '@opensinnoh/core';
import type { InputFrame } from '@opensinnoh/contracts';
import { REPEAT_DELAY, REPEAT_EVERY } from '@opensinnoh/menus';
import type { NewGameOptions } from '@opensinnoh/game';
import type { PixelFont, Palette } from '../ui/pixel-font.ts';
import type { Sheet, TitleFlow } from './new-game-flow.ts';
import type { OptionsFlow } from './options-flow.ts';
import type { TitleStrings } from './strings.ts';
import { FOCUS_CYCLE } from './timeline.ts';
import { S } from '../strings/index.ts';

export interface ContinueInfo {
  player: string;
  gender: 'male' | 'female';
  /** Play time in 30 Hz ticks. */
  ticks: number;
  badges: number;
  pokedex: boolean;
  /** The save has unlocked Mystery Gift (decomp SystemData isMysteryGiftUnlocked). */
  mysteryGift: boolean;
}

/** SE_CONFIRM (SEQ_SE_DP_SELECT), the main menu's one sound. */
const SE_CONFIRM = 1500;

export type MenuChoice = { kind: 'continue' } | { kind: 'new'; form: unknown } | { kind: 'title' };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  e.append(...children);
  return e;
}

export interface MenuDeps {
  strings: TitleStrings;
  font: PixelFont;
  /** CSS px per font pixel. */
  scale(): number;
  save: ContinueInfo | null;
  /** Shown under the windows when the menu opens (e.g. an unreadable save). */
  notice: string;
  newGameDefaults: NewGameOptions;
  reducedMotion: boolean;
  /** Sound_PlayEffect of a sequence number. */
  se(source: number): void;
  /** Runs a choice; a rejected promise's message is shown in the menu (the menu stays). */
  choose(choice: MenuChoice): Promise<void>;
  /** The NEW GAME flow (Rowan's intro). */
  newGameFlow(done: (form: unknown) => void): Sheet;
  /** The OPTIONS screen; `close` is called when the player leaves it. */
  optionsFlow(close: () => void): OptionsFlow;
  /** MYSTERY GIFT over the save; `close` when it ends, with a problem to show (the gift was not saved) or null. */
  mysteryGiftFlow(close: (problem: string | null) => void): Promise<TitleFlow>;
}

export class MainMenu {
  readonly root: HTMLElement;
  private stops: HTMLElement[] = [];
  private cursor = 0;
  private held: Button | null = null;
  private heldFor = 0;
  private frame = 0;
  private busy = false;
  /** NEW GAME's or OPTIONS' screen over the windows; it takes the title's input while it is open. */
  private sheet: Sheet | OptionsFlow | null = null;
  private readonly status: HTMLElement;

  constructor(private readonly deps: MenuDeps) {
    this.root = el('div', 'title-menu');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', S.title.mainMenu);
    this.status = el('p', 'tm-status');
    this.status.setAttribute('role', 'status');
    this.build();
  }

  private label(text: string, palette: Palette = 'ink'): HTMLSpanElement {
    return this.deps.font.label(text, palette, this.deps.scale());
  }

  private build(): void {
    const { strings, save } = this.deps;
    const list = el('div', 'tm-list');
    if (save) {
      const color: Palette = save.gender === 'female' ? 'female' : 'male';
      const minutes = Math.floor(save.ticks / 30 / 60);
      const rows: [string, string][] = [
        [strings.t('player'), strings.t('playerName', save.player)],
        [strings.t('time'), strings.t('playTime', String(Math.floor(minutes / 60)), String(minutes % 60).padStart(2, '0'))],
        [strings.t('badges'), strings.t('badgeCount', String(save.badges))],
      ];
      // The DS shows the seen count; GameState does not keep it yet.
      if (save.pokedex) rows.push([strings.t('pokedex'), strings.t('dashes')]);
      const info = el('dl', 'tm-info', ...rows.flatMap(([k, v]) => [el('dt', '', this.label(k, color)), el('dd', '', this.label(v, color))]));
      list.append(this.window('continue', [this.label(strings.t('continue')), info], () => this.choose({ kind: 'continue' })));
    }
    list.append(this.window('new-game', [this.label(strings.t('newGame'))], () => this.openNewGame()));
    // RenderMysteryGiftOption: unlocked (the Jubilife TV questionnaire) and the Pokédex obtained.
    if (save?.mysteryGift && save.pokedex) list.append(this.window('mystery-gift', [this.label(strings.t('mysteryGift'))], () => this.openMysteryGift()));
    list.append(this.window('options', [this.label(strings.t('options'))], () => this.openOptions()));
    this.status.textContent = this.deps.notice;
    this.root.replaceChildren(list, this.status);
    this.stops = [...list.querySelectorAll<HTMLElement>('[data-nav]')];
    this.setCursor(0, false);
  }

  private window(name: string, content: Node[], activate: () => void): HTMLButtonElement {
    const b = el('button', `tm-window tm-${name}`, ...content);
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.option = name;
    b.addEventListener('click', () => {
      if (this.busy) return;
      this.deps.se(SE_CONFIRM);
      this.setCursor(this.stops.indexOf(b), false);
      activate();
    });
    return b;
  }

  private setCursor(i: number, focus: boolean): void {
    this.cursor = i;
    this.stops.forEach((s, j) => {
      s.classList.toggle('is-focus', j === i);
      if (j === i) s.setAttribute('aria-current', 'true');
      else s.removeAttribute('aria-current');
    });
    if (focus) {
      this.stops[i]?.focus({ preventScroll: true });
      this.stops[i]?.scrollIntoView({ block: 'nearest' });
    }
  }

  private async choose(choice: MenuChoice): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status.textContent = '';
    try {
      await this.deps.choose(choice);
    } catch (e) {
      this.status.textContent = (e as Error).message;
      if (this.sheet) this.closeSheet();
    } finally {
      this.busy = false;
    }
  }

  /** CONTINUE without the player choosing it (the installed app's shortcut); a failure shows in the menu. */
  continueNow(): Promise<void> {
    return this.choose({ kind: 'continue' });
  }

  /** NEW GAME: Rowan's intro (a rejected start shows its message in the menu again). */
  private openNewGame(): void {
    const flow = this.deps.newGameFlow((form) => void this.choose({ kind: 'new', form }));
    this.showSheet(flow);
  }

  /** MYSTERY GIFT; leaving it returns to the title, as on the DS (ExitToTitleScreen), which reads the save again. */
  private openMysteryGift(): void {
    if (this.busy) return;
    this.busy = true;
    this.deps
      .mysteryGiftFlow((problem) => {
        this.closeSheet();
        if (problem) this.status.textContent = problem;
        else void this.choose({ kind: 'title' });
      })
      .then(
        (flow) => this.showSheet(flow),
        (e: Error) => (this.status.textContent = e.message),
      )
      .finally(() => (this.busy = false));
  }

  private openOptions(): void {
    this.showSheet(this.deps.optionsFlow(() => this.closeSheet()));
  }

  private showSheet(sheet: Sheet | OptionsFlow): void {
    this.root.querySelector('.tm-list')!.setAttribute('inert', '');
    this.root.append(sheet.root);
    this.sheet = sheet;
  }

  private closeSheet(): void {
    this.sheet?.root.remove();
    this.sheet = null;
    this.root.querySelector('.tm-list')!.removeAttribute('inert');
    this.setCursor(this.cursor, true);
  }

  /** One 30 Hz tick: input and the focus colour cycle. */
  tick(pressed: readonly Button[], held: readonly Button[], frame?: InputFrame): void {
    this.frame++;
    const [r, g, b] = FOCUS_CYCLE[this.deps.reducedMotion ? 15 : this.frame % FOCUS_CYCLE.length]!;
    this.root.style.setProperty('--focus', `rgb(${(r * 255) / 31} ${(g * 255) / 31} ${(b * 255) / 31})`);
    if (this.sheet) {
      if (!this.busy && frame) this.sheet.tick(frame);
      return;
    }
    if (this.busy) return;
    for (const p of pressed) this.press(p);
    const dir = held.includes('up') ? 'up' : held.includes('down') ? 'down' : null;
    if (dir !== this.held) {
      this.held = dir;
      this.heldFor = 0;
    } else if (dir && ++this.heldFor >= REPEAT_DELAY && (this.heldFor - REPEAT_DELAY) % REPEAT_EVERY === 0) this.press(dir);
  }

  private press(b: Button): void {
    // FocusNextOption: no wrap at either end.
    if (b === 'up' || b === 'down') {
      const next = b === 'up' ? Math.max(0, this.cursor - 1) : Math.min(this.stops.length - 1, this.cursor + 1);
      if (next === this.cursor) return;
      this.deps.se(SE_CONFIRM);
      this.setCursor(next, true);
    } else if (b === 'a' || b === 'start') this.stops[this.cursor]?.click();
    else if (b === 'b') {
      this.deps.se(SE_CONFIRM);
      void this.choose({ kind: 'title' });
    }
  }

  /** NEW GAME's intro covers the screen. */
  get covered(): boolean {
    return this.sheet !== null;
  }

  /** For tests: the focused option. */
  get focused(): string {
    return this.stops[this.cursor]?.dataset.option ?? '';
  }
}
