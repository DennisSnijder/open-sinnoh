/**
 * The title's screens before a game exists: the setup (setup.ts, once per device; OpenSinnoh's own screen) and
 * NEW GAME, Rowan's intro from the ROM (packages/menus `createRowanIntro`: it replaces
 * the boy/girl and name form), drawn as one composed DS screen (ui/rowan-intro.ts); the intro's naming keyboard is
 * the in-game one (`ui/apps.ts`). Keys and gamepad drive them through the title's input; taps and typing send tap
 * ids. Neither can be skipped (the DS's intro has no skip; A and B speed up its text).
 */
import { uiScales } from '../layout.ts';
import type { AppModel, AppView, AssetSource, InputFrame, NamingView, Registries, StubLog } from '@opensinnoh/contracts';
import type { SoundSystem } from '@opensinnoh/game';
import { createRowanIntro } from '@opensinnoh/menus';
import type { Button } from '@opensinnoh/core';
import { drawApp, type DrawContext } from '../ui/apps.ts';
import { Art } from '../ui/art.ts';
import { wireTyping } from '../ui/index.ts';
import type { PixelFont } from '../ui/pixel-font.ts';
import { SetupFlow, SetupScreen, type SetupDeps } from './setup.ts';
import { markIntroSeen } from './intro-skip.ts';
import '../ui/ui.css';
import '../ui/apps.css';
import '../ui/apps-m3a.css';
import '../ui/naming.css';
import { MAX_SCALE } from '../ui/rowan-intro.ts';
import { S } from '../strings/index.ts';

export interface FlowDeps {
  registries: Registries;
  assets: AssetSource;
  font: PixelFont;
  /** CSS px per font pixel on the naming sheet. */
  scale(): number;
  /** A tap for the next frame. */
  tap(id: string): void;
  /** A button press for one frame (arrows typed in the naming screen's text field). */
  pulse(button: Button): void;
  /** The message box frame option (0–19). */
  frame(): number;
}

/** What the main menu shows over itself for a while (NEW GAME, Mystery Gift): its root and a 30 Hz tick. */
export interface Sheet {
  readonly root: HTMLElement;
  tick(frame: InputFrame): void;
}

/** A DS screen the title runs for a while: ticks its model and draws its view. */
export class TitleFlow {
  readonly root: HTMLElement;
  private drawn = '';
  private readonly art: Art;

  constructor(
    private readonly deps: FlowDeps,
    label: string,
    private readonly model: { tick(f: InputFrame): void; view(): AppView },
  ) {
    this.root = document.createElement('div');
    this.root.className = 'ui-layer tm-flow';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', label);
    this.art = new Art(() => deps.assets, () => deps.registries);
    this.draw();
  }

  /** One 30 Hz tick. */
  tick(frame: InputFrame): void {
    this.model.tick(frame);
    this.draw();
  }

  private draw(): void {
    const view = this.model.view();
    this.root.toggleAttribute('data-naming', view.app === 'naming');
    this.root.toggleAttribute('data-board', view.app === 'mystery-gift' || view.app === 'easy-chat');
    // The naming board fits and centres in the same padded safe area as the intro's canvas stage.
    const cs = getComputedStyle(this.root);
    // The title's box (the game area, clear of the touch controls), not the window; the window's until it is on the page.
    const box = { width: this.root.clientWidth || innerWidth, height: this.root.clientHeight || innerHeight };
    const width = box.width - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const height = box.height - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0);
    const scale = this.deps.scale();
    const unit = Math.min(uiScales(width, height, devicePixelRatio || 1, box.height > box.width).unit, MAX_SCALE);
    this.root.style.setProperty('--dot', `${scale}px`);
    this.root.style.setProperty('--unit', `${unit}px`);
    this.root.dataset.mode = box.width < 700 && box.height > box.width ? 'compact' : 'wide';
    const d: DrawContext = { text: (t, palette = 'ink', className, k = scale) => this.deps.font.label(t, palette, k, className), flow: (t, lines, palette = 'ink', k = scale) => this.deps.font.flow(t, palette, k, lines), measure: (t) => this.deps.font.measure(t), tap: (id) => this.deps.tap(id), art: this.art, registries: this.deps.registries, frame: this.deps.frame(), scale, unit, compact: this.root.dataset.mode === 'compact', size: box };
    if (view.app !== 'naming') {
      // Rowan's intro redraws itself in place (its canvas changes every frame); the other screens (Mystery Gift, its
      // Easy Chat) only when their view changes, so a tap's target stays in place.
      const key = `${scale}|${unit}|${box.width}x${box.height}|${JSON.stringify(view)}`;
      if (view.app !== 'rowan-intro' && key === this.drawn) return;
      const root = drawApp(d, view).root;
      root.classList.add('ui-screen');
      if (root.parentElement !== this.root) this.root.replaceChildren(root);
      this.drawn = view.app === 'rowan-intro' ? '' : key;
      this.root.style.background = '';
      return;
    }
    const key = `${scale}|${unit}|${box.width}x${box.height}|${this.root.dataset.mode}|${JSON.stringify(view)}`;
    if (key === this.drawn) return;
    this.drawn = key;
    const { root } = drawApp(d, view as NamingView);
    root.dataset.screen = 'naming';
    root.classList.add('ui-screen');
    // The keyboard is a DS screen of its own: centred, on an opaque backdrop that runs the screen on to the viewport's
    // edges: its top row's colour above, each row's edge colour beside it (the stripes go on), its bottom row's below.
    this.root.style.background = '#000';
    this.root.replaceChildren(root);
    const backdrop = root.dataset.backdrop;
    if (backdrop)
      void this.art.edgeColors(backdrop).then(({ top, bottom, left, right }) => {
        if (!root.isConnected) return;
        const y0 = root.offsetTop;
        const k = root.offsetHeight / left.length;
        const bands = (side: (string | null)[]) => {
          const stops = [`${top} 0 ${y0}px`];
          for (let y = 0, start = 0; y < side.length; y++) {
            if (y + 1 < side.length && side[y + 1] === side[y]) continue;
            stops.push(`${side[y] ?? (y < side.length / 2 ? top : bottom)} ${y0 + start * k}px ${y0 + (y + 1) * k}px`);
            start = y + 1;
          }
          stops.push(`${bottom} ${y0 + root.offsetHeight}px 100%`);
          return `linear-gradient(${stops.join(', ')})`;
        };
        this.root.style.background = `${bands(left)} left / 50% 100% no-repeat, ${bands(right)} right / 50% 100% no-repeat`;
      });
    const typing = root.querySelector<HTMLInputElement>('input[data-typing]');
    if (typing) wireTyping(typing, { tap: (id) => this.deps.tap(id), pulse: (b) => this.deps.pulse(b) });
  }
}

export interface IntroDeps extends FlowDeps {
  log: StubLog;
  sound?: SoundSystem;
  /** Render calls per character at the device's text speed. */
  textDelay(): number;
  /** The device's auto-lowercase naming option. */
  autoLowercase(): boolean;
  /** OK with nothing entered keeps these (the running game's names). */
  defaults: { player: string; rival: string };
  /** The intro's names and gender (the menu validates and starts the game). */
  done(form: { names: { player: string; rival: string }; gender: 'male' | 'female' }): void;
  /** Ask first whether to skip the intro (OpenSinnoh: this device has finished it, and the option is on). */
  offerSkip?: boolean;
}

/**
 * NEW GAME: Rowan's intro; its sound system ticks with it (the game's loop has not started). With `offerSkip` the
 * setup's screen first asks whether to skip it (intro-skip.ts). A finished intro marks the device for the skip.
 */
export function newGameFlow(deps: IntroDeps): Sheet {
  const finish = (form: Parameters<IntroDeps['done']>[0]) => {
    const err = markIntroSeen();
    if (err) console.warn(`intro skip: not remembered (${err})`);
    deps.done(form);
  };
  if (!deps.offerSkip) return introFlow(deps, false, finish);
  const ask = new SetupFlow({ questions: ['introSkip'], textSpeed: () => 0, textDelay: () => 0, answer: (_q, c) => void (skip = c === 0), pickAddon: () => {} });
  const screen = new SetupScreen(ask, deps.tap, S.title.newGameHeading);
  let skip = false;
  let intro: TitleFlow | null = null;
  const root = document.createElement('div');
  root.style.display = 'contents';
  root.append(screen.root);
  return {
    root,
    tick: (f) => {
      if (intro) return intro.tick(f);
      if (!ask.tick(f)) return screen.draw();
      intro = introFlow(deps, skip, finish);
      root.replaceChildren(intro.root);
    },
  };
}

function introFlow(deps: IntroDeps, skip: boolean, done: IntroDeps['done']): TitleFlow {
  // rowan_intro_app.c starts on Sound_SetSceneAndPlayBGM(SOUND_SCENE_2, SEQ_OPENING) then Sound_StopBGM: a
  // cutscene scene, so nothing from before plays on; the intro starts SEQ_OPENING itself when Rowan fades in. The
  // stop waits for the menu's SE_CONFIRM to end (the DS plays it out during the menu's fade).
  let quiet = false;
  const app: AppModel = createRowanIntro({ registries: deps.registries, log: deps.log, ...(deps.sound ? { sound: deps.sound } : {}), textDelay: deps.textDelay(), defaults: deps.defaults, autoLowercase: deps.autoLowercase, skip });
  let finished = false;
  return new TitleFlow(deps, 'New game', {
    view: () => app.view(),
    tick: (f) => {
      if (finished) return;
      if (!quiet && !deps.sound?.anySePlaying()) {
        quiet = true;
        deps.sound?.stopAllSequences();
      }
      const r = app.step(f);
      if (r?.app === 'rowan-intro') {
        finished = true;
        done({ names: r.names, gender: r.gender });
      }
    },
  });
}

/** The setup before the first main menu; `done` once it has faded out. */
export function setupFlow(deps: Pick<FlowDeps, 'tap'> & SetupDeps & { done(): void }): { flow: { root: HTMLElement; tick(f: InputFrame): void }; setup: SetupFlow } {
  const setup = new SetupFlow(deps);
  const screen = new SetupScreen(setup, deps.tap);
  let finished = false;
  const flow = {
    root: screen.root,
    tick: (f: InputFrame) => {
      if (finished) return;
      if (setup.tick(f)) {
        finished = true;
        deps.done();
      } else screen.draw();
    },
  };
  return { flow, setup };
}
