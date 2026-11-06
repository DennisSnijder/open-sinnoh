/**
 * The title screen and main menu, shown on launch before the field (not in replay or `?packs=` mode).
 * One full-bleed composition (docs/decisions.md: single screen): the background scene (the intro's portal) and
 * the hovering model fill the frame; our OpenSinnoh wordmark (the brand's pixel art, @opensinnoh/ui; it replaces the game's logo) sits
 * in the lower third with "press start" under it, and an unofficial-project note at the bottom. The
 * title opens straight on the finished scene with a short fade from black. The main menu comes up over
 * the same scene. Before the first main menu on a device, the setup asks its questions (setup.ts); NEW GAME runs
 * Rowan's intro (new-game-flow.ts). See docs/research/title-screen.md.
 */
import type { AppHost, AssetSource, GameState, InputFrame, LoadedFont, Registries, StubLog, TitleModel, TitleScreen } from '@opensinnoh/contracts';
import { createMysteryGift } from '@opensinnoh/menus';
import { allowTestGiftCodes } from '@opensinnoh/services';
import type { Button } from '@opensinnoh/core';
import type { NewGameOptions, SoundSystem } from '@opensinnoh/game';
import { snapPixels, wordmark } from '@opensinnoh/ui';
import type { InputState } from '../input.ts';
import { stepClock } from '../loop.ts';
import { PixelFont } from '../ui/pixel-font.ts';
import type { AppSettings } from '../ui/settings.ts';
import { titleLayout, wordmarkScale } from './layout.ts';
import { MainMenu, type ContinueInfo, type MenuChoice } from './menu.ts';
import { newGameFlow, setupFlow, TitleFlow, type FlowDeps } from './new-game-flow.ts';
import { OptionsFlow } from './options-flow.ts';
import type { SetupDeps } from './setup.ts';
import { offerIntroSkip } from './intro-skip.ts';
import { TitleScene3d } from './model3d.ts';
import { TitleStrings } from './strings.ts';
import { EXIT_DELAY, EXIT_FADE, exitBrightness, FADE_IN, hoverY, promptOn } from './timeline.ts';
import { S } from '../strings/index.ts';
import './title.css';

export type { ContinueInfo } from './menu.ts';

export interface TitleDeps {
  record: TitleScreen;
  registries: Registries;
  /** The base pack's namespace (menu labels). */
  ns: string;
  assets: AssetSource;
  font: LoadedFont;
  input: InputState;
  /** Polls gamepads into `input` (once per tick). */
  poll(): void;
  save: ContinueInfo | null;
  /** Why an existing save cannot be continued ('' when fine), shown in the menu. */
  saveProblem: string;
  newGameDefaults: NewGameOptions;
  /** Load the save / start a new game; a rejection's message is shown in the menu. */
  continueGame(): Promise<void>;
  newGame(form: unknown): Promise<void>;
  /** The device's options (what the OPTIONS screen lists as the DS options) and the app's settings and data actions. */
  options: { host: Pick<AppHost, 'options' | 'setOption'>; settings(): AppSettings };
  /**
   * The game's sound system and its tick (the game loop is not running): the title's music and cry, Rowan's
   * intro's music and sounds. The title takes it over from the field (see `titleMusic`).
   */
  sound?: SoundSystem;
  tickSound(): void;
  log: StubLog;
  /** The message box frame option. */
  frame(): number;
  /** The setup before the first main menu: its questions still unanswered here (none: no setup), the answers. */
  setup: SetupDeps;
  /** The root is on the page: the game view sizes it to its game area (clear of the touch controls) and keeps it so. */
  mounted(root: HTMLElement): void;
  /**
   * The save's state for MYSTERY GIFT (validated and migrated, as CONTINUE loads it) and its writer: the screen edits
   * the state, `write` stores it as the save.
   */
  mysteryGiftSave(): Promise<{ state: GameState; write(): Promise<void> }>;
  /** Today's date (yyyy-mm-dd): a received Wonder Card's date. */
  today(): string;
  /** The installed app's Continue shortcut (`?continue`): loads the save without the title and menu, unless the setup still has questions. */
  autoContinue?: boolean;
}

/** Test handle (`window.openSinnohTitle`). */
export interface TitleHandle {
  readonly phase: Phase;
  readonly frame: number;
  readonly focused: string;
  /** True while the title ignores input (the 30 frames after returning from the menu). */
  readonly inputBlocked: boolean;
  /** The setup's question on screen, or null. */
  readonly question: string | null;
  /** Milliseconds of tick and draw work per display frame, most recent last (at most 2048; perf runs). */
  readonly frameMs: number[];
  /** Mystery Gift takes the test-only gift codes (browser specs; services `TEST_GIFT_CODES`). */
  allowTestGiftCodes(): void;
}

declare global {
  interface Window {
    openSinnohTitle?: TitleHandle;
  }
}

type Phase = 'title' | 'exit' | 'setup' | 'menu' | 'leaving' | 'done';

/** Main menu fade in/out (MainMenuUtil_StartScreenFadeToState), frames. */
const MENU_FADE = 8;
/** After returning from the menu the DS ignores input for 30 frames (TITLE_SCREEN_INPUT_DISABLE_FRAMES). */
const INPUT_DELAY = 30;
const START: readonly Button[] = ['a', 'start'];
/** decomp sequence numbers: SEQ_TITLE01 (title_screen.c TITLE_SCREEN_APP_STATE_INIT_SOUND), SEQ_PRESENT (mystery_gift_app.c). */
const SEQ_TITLE01 = 1173;
const SEQ_PRESENT = 1174;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  e.textContent = text;
  return e;
}

export async function showTitle(deps: TitleDeps): Promise<void> {
  const { record } = deps;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touch = matchMedia('(pointer: coarse)').matches;
  const strings = new TitleStrings(deps.registries.texts, deps.ns);
  const pixelFont = new PixelFont(deps.font);
  const part = (m: TitleModel | undefined) => {
    if (!m) return undefined;
    const rec = deps.registries.models.get(m.model);
    if (!rec) throw new Error(`title: no model ${m.model}`);
    return { record: m, gltf: rec.gltf };
  };
  const scene3d = record.model || record.background ? await TitleScene3d.load({ model: part(record.model), background: part(record.background) }, deps.assets) : null;

  // --- DOM: 3D, vignette, brand (wordmark + prompt), legal line, screen fade, (menu) ---
  const root = el('section', 'title');
  root.id = 'title';
  root.setAttribute('aria-label', S.title.screen);
  // The brand on the dark theme's tokens, whatever the page's theme: the scene behind it is the game's.
  const brand = el('div', 'title-brand');
  brand.dataset.theme = 'dark';
  const mark = wordmark(2, { label: 'OpenSinnoh', animate: true });
  const prompt = el('p', 'title-prompt', touch ? S.title.tap : S.title.press);
  brand.append(mark, prompt);
  const legal = el('p', 'title-legal', S.title.legal);
  const fade = el('div', 'title-fade');
  root.append(...(scene3d ? [scene3d.canvas] : []), el('div', 'title-vignette'), brand, legal, fade);
  document.body.append(root);
  deps.mounted(root);

  // The title's own box: the game area, above the portrait controls strip (game-view.ts).
  const width = () => Math.max(1, root.clientWidth);
  const height = () => Math.max(1, root.clientHeight);
  const relayout = () => {
    const L = titleLayout(width(), height(), devicePixelRatio || 1);
    scene3d?.resize(width(), height(), L.k3d, L.lift, L.zoom);
    // The wordmark at a whole scale with its clear space, the brand centred on whole pixels in the lower third.
    const k = wordmarkScale(width(), height());
    mark.setAttribute('width', String(58 * k));
    mark.setAttribute('height', String(11 * k));
    brand.style.setProperty('--k', `${k}px`);
    brand.style.left = `${Math.round((width() - brand.offsetWidth) / 2)}px`;
    brand.style.top = `${Math.round(height() * (L.landscape ? 0.74 : 0.72) - brand.offsetHeight / 2)}px`;
    snapPixels(brand);
  };
  relayout();
  const resized = new ResizeObserver(relayout);
  resized.observe(root);

  // --- state ---
  let phase: Phase = 'title';
  let frame = 0; // frames in the current phase
  let sceneFrame = 0;
  let inputDelay = 0;
  let menu: MainMenu | null = null;
  let tapped = false;
  /** The setup runs once per launch at most (its answers are stored as they are given). */
  let setupDone = false;
  let finished: () => void = () => {};
  const done = new Promise<void>((resolve) => (finished = resolve));
  const frameMs: number[] = [];
  window.openSinnohTitle = {
    frameMs,
    get phase() {
      return phase;
    },
    get frame() {
      return frame;
    },
    get focused() {
      return menu?.focused ?? '';
    },
    get inputBlocked() {
      return inputDelay > 0;
    },
    get question() {
      return setup?.setup.question ?? null;
    },
    allowTestGiftCodes,
  };
  const go = (next: Phase) => {
    phase = next;
    frame = 0;
  };
  /**
   * The title's sound (decomp title_screen.c): opening, it plays SEQ_TITLE01 as a cutscene BGM, which stops
   * everything else (the field BGM the session's map load started behind the title); A/Start fades it out over
   * 60 frames with Giratina's (Origin) cry; leaving for the main menu stops it. The main menu plays no BGM
   * (main_menu.c only sets SOUND_SCENE_NONE); NEW GAME's intro starts its own (SEQ_OPENING). Back from the menu the
   * theme waits for the menu's SE_CONFIRM to end (the DS plays it out during the menu's fade; the cutscene BGM stops
   * every sequence).
   */
  const titleMusic = () => deps.sound?.playCutsceneBgm(deps.sound.sequenceBySource(SEQ_TITLE01));
  let titleMusicPending = false;
  const pressed = () => {
    deps.sound?.fadeOutBgm(0, 60);
    const giratina = `${deps.ns}:SPECIES_GIRATINA` as const;
    if (deps.registries.cries.has(giratina)) deps.sound?.playCry(giratina, 1);
    go('exit');
  };
  root.addEventListener('pointerdown', (e) => {
    if (phase === 'title') {
      e.preventDefault();
      tapped = true;
    }
  });

  // The DS screens before a game exists: the scene's scale on the naming sheet (title.css --dot), the input.
  const scale = () => (width() >= 900 && height() >= 700 ? 3 : 2);
  const flowDeps: FlowDeps = {
    registries: deps.registries,
    assets: deps.assets,
    font: pixelFont,
    scale,
    tap: (id) => deps.input.tap(id),
    pulse: (b) => {
      deps.input.set('ui', b, true);
      deps.input.set('ui', b, false);
    },
    frame: deps.frame,
  };
  let setup: { flow: { root: HTMLElement; tick(f: InputFrame): void }; setup: { question: string | null } } | null = null;
  const openSetup = () => {
    setup = setupFlow({
      ...flowDeps,
      ...deps.setup,
      done: () => {
        setup!.flow.root.remove();
        setup = null;
        go('menu');
        openMenu();
      },
    });
    root.append(setup.flow.root);
  };

  const openMenu = () => {
    menu = new MainMenu({
      strings,
      font: pixelFont,
      // The menu's dot grid (title.css --dot): 2 CSS px per font pixel, 3 on large screens.
      scale,
      save: deps.save,
      notice: deps.saveProblem,
      newGameDefaults: deps.newGameDefaults,
      reducedMotion: reduced,
      se: (n) => deps.sound?.playSeBySource(n),
      newGameFlow: (done) =>
        newGameFlow({
          ...flowDeps,
          log: deps.log,
          ...(deps.sound ? { sound: deps.sound } : {}),
          textDelay: () => deps.setup.textDelay(deps.setup.textSpeed()),
          autoLowercase: () => deps.options.host.options().autoLowercase === 0,
          defaults: deps.newGameDefaults.names,
          offerSkip: offerIntroSkip(),
          done,
        }),
      optionsFlow: (close) =>
        new OptionsFlow({
          registries: deps.registries,
          assets: deps.assets,
          font: pixelFont,
          host: deps.options.host,
          log: deps.log,
          settings: deps.options.settings,
          tap: (id) => deps.input.tap(id),
          close,
        }),
      // MYSTERY GIFT over the save's state; a received gift is saved before the DS returns to the title. Its music is
      // SEQ_PRESENT (MysteryGiftApp_Init); the title's theme replaces it on the way out, or the menu is silent again.
      mysteryGiftFlow: async (close) => {
        const save = await deps.mysteryGiftSave();
        const app = createMysteryGift({ registries: deps.registries, state: save.state, date: deps.today, host: deps.sound ? { sound: deps.sound } : {}, log: deps.log });
        // Over the silent menu, without stopping the SE_CONFIRM that chose it.
        deps.sound?.playBgm(deps.sound.sequenceBySource(SEQ_PRESENT));
        let finished = false;
        return new TitleFlow(flowDeps, S.title.mysteryGift, {
          view: () => app.view(),
          tick: (f) => {
            if (finished) return;
            const r = app.step(f);
            if (r?.app !== 'mystery-gift') return;
            finished = true;
            if (r.received)
              void save.write().then(
                () => close(null),
                (e: Error) => {
                  deps.sound?.stopBgm();
                  close(S.title.giftNotSaved(e.message));
                },
              );
            else close(null);
          },
        });
      },
      choose: async (choice: MenuChoice) => {
        if (choice.kind === 'title') {
          menu?.root.remove();
          menu = null;
          inputDelay = INPUT_DELAY;
          go('title');
          titleMusicPending = true;
          return;
        }
        // Run the choice first (errors stay in the menu), then fade out.
        await (choice.kind === 'continue' ? deps.continueGame() : deps.newGame(choice.form));
        go('leaving');
      },
    });
    root.append(menu.root);
  };

  const tick = () => {
    deps.poll();
    const input = deps.input.frame();
    const tap = tapped;
    tapped = false;
    frame++;
    sceneFrame++;
    deps.tickSound();
    if (titleMusicPending && !deps.sound?.anySePlaying()) {
      titleMusicPending = false;
      titleMusic();
    }
    if (phase === 'title') {
      if (inputDelay > 0) inputDelay--;
      else if (input.pressed.some((b) => START.includes(b)) || tap) pressed();
    } else if (phase === 'exit') {
      // The DS leaves once the fade is done and Giratina's cry has ended.
      if (reduced || (frame >= EXIT_DELAY + EXIT_FADE && !deps.sound?.cryPlaying())) {
        deps.sound?.stopBgm();
        if (deps.setup.questions.length && !setupDone) {
          setupDone = true;
          go('setup');
          openSetup();
        } else {
          go('menu');
          openMenu();
        }
      }
    } else if (phase === 'setup') setup?.flow.tick(input);
    else if (phase === 'menu') menu?.tick(input.pressed, input.held, input);
    else if (phase === 'leaving' && (reduced || frame >= MENU_FADE)) {
      go('done');
      finished();
    }
  };

  const draw = () => {
    const inMenu = phase === 'setup' || phase === 'menu' || phase === 'leaving' || phase === 'done';
    brand.hidden = legal.hidden = inMenu;
    prompt.style.visibility = phase === 'title' && inputDelay === 0 && (reduced || promptOn(frame)) ? '' : 'hidden';
    // In from black when the title opens, to white on exit, the menu in from black, out to black when leaving.
    const f =
      phase === 'title' ? { c: '#000', o: Math.max(0, 1 - sceneFrame / FADE_IN) }
      : phase === 'exit' ? { c: '#fff', o: exitBrightness(frame) / 16 }
      : phase === 'menu' ? { c: '#000', o: Math.max(0, 1 - frame / MENU_FADE) }
      : phase === 'setup' ? { c: '#000', o: 0 }
      : { c: '#000', o: Math.min(1, frame / MENU_FADE) };
    fade.style.background = f.c;
    fade.style.opacity = String(reduced && phase !== 'leaving' && phase !== 'done' ? 0 : f.o);
    // The setup and the intro cover the whole screen: the scene behind them is not drawn.
    if (phase !== 'setup' && !menu?.covered) scene3d?.render(reduced ? 0 : sceneFrame, reduced ? 0 : hoverY(sceneFrame));
  };

  if (deps.autoContinue && deps.save && !deps.setup.questions.length) {
    deps.sound?.stopAllSequences();
    go('menu');
    openMenu();
    void menu!.continueNow();
  } else titleMusic();

  // The title runs its own 30 Hz loop (the field loop has not started yet).
  let acc = 0;
  let last: number | null = null;
  const loop = (now: number) => {
    const t0 = performance.now();
    const step = stepClock(acc, last === null ? 0 : now - last);
    last = now;
    acc = step.accumulator;
    for (let i = 0; i < step.ticks && phase !== 'done'; i++) tick();
    draw();
    frameMs.push(performance.now() - t0);
    if (frameMs.length > 2048) frameMs.shift();
    if (phase !== 'done') requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // A hidden page draws no frames; showing it again starts the clock afresh (no ticks for the hidden time).
  const resumed = () => {
    if (document.visibilityState === 'hidden') return;
    acc = 0;
    last = null;
  };
  document.addEventListener('visibilitychange', resumed);
  await done;
  document.removeEventListener('visibilitychange', resumed);
  resized.disconnect();
  scene3d?.dispose();
  root.remove();
  delete window.openSinnohTitle;
}
