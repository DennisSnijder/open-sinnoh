/**
 * The game screen: canvases placed by the layout, input wiring, the 30 Hz loop, the replay
 * bridge and the menu (saves, mods, storage).
 */
import { BUTTONS, DEFAULT_CLOCK, type Button, type ClockTime } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, PANEL_HEIGHT, PANEL_WIDTH, type GameState, type InputFrame, type SaveEnvelope } from '@opensinnoh/contracts';
import { IndexedDbSaveStore, PackMismatchError, saveFromJson, TEXT_FRAME_DELAY, validateSave, type Game, type NewGameOptions, type TextSpeedOption } from '@opensinnoh/game';
import { checkNewGame, readNewGame, storeNewGame } from './new-game.ts';
import { createSession, warmBattleEngine, type Session } from './boot.ts';
import { parseEnhanced, setEnhancedVisuals, visualStyleConfig, type EnhancedConfig } from '@opensinnoh/render';
import { readVisuals, storeVisuals, VISUAL_STYLES, visualStyleChosen, type Visuals } from './visuals.ts';
import { createBridge, type AppBridge } from './bridge.ts';
import type { ReplayRecorder } from './recorder.ts';
import { attachGamepadEvents, attachKeyboard, controls, FAST_FORWARD_TOGGLE, gamepadFastForward, InputState, pollGamepads } from './input.ts';
import { computeLayout, readRenderScale, renderPixelRatio, storeRenderScale, type Insets, type Layout, type Rect, type RenderScale } from './layout.ts';
import { newLoopStats, startLoop, type LoopStats } from './loop.ts';
import { CONTROL_SIZES, fullscreenSupported, HAPTIC_MS, hapticsSupported, readPhone, ScreenAwake, standalone, storePhone, wakeLockSupported, type PhoneSettings } from './phone.ts';
import { applyUpdate, canInstall, promptInstall, requestPersistence, storageLine, storageStatus, updateWaiting, type StorageStatus } from './platform.ts';
import { saveImportMessage } from './save-errors.ts';
import { setPlaying } from './update-toast.ts';
import { splashDone, splashPhase } from './splash.ts';
import { FAST_SPEEDS, FastForward, readFastSpeed, storeFastSpeed, type FastSpeed } from './speed.ts';
import { toggleMod, type PackSource } from './pack-source.ts';
import { bottomFrame, drawPanel, toOverlayPoint, toPanelPoint, type DsFrame } from './panel.ts';
import { frontierFrame } from './frontier-scene.ts';
import { mountUi, type InGameUi } from './ui/index.ts';
import type { AppSettings, DataActions } from './ui/settings.ts';
import { PixelFont } from './ui/pixel-font.ts';
import { MapPopupLayer, mapPopupScale } from './map-popup.ts';
import { CardStrings } from './battle/strings.ts';
import { mountBattle, type BattleSceneInfo } from './battle/index.ts';
import { createDevice, OPENSINNOH_OPTIONS } from './ui/options.ts';
import { createSuspend, suspendOn } from './suspend.ts';
import { showTitle, type ContinueInfo } from './title/index.ts';
import { isStarterChoice, StarterScene } from './starter/index.ts';
import { createWebAudio, type WebAudio } from './audio.ts';
import { crash } from './telemetry/crash.ts';
import { watchGame } from './telemetry/game.ts';
import { watchPerf } from './telemetry/perf.ts';
import { playWatcher, track } from './telemetry/analytics.ts';
import { mountPerfHud } from './debug/perf.ts';
import { reportsEnabled, setReportsEnabled } from './telemetry/index.ts';
import { reportsAnswered } from './telemetry/settings.ts';
import { readAnswered, storeAnswered, type SetupQuestion } from './title/setup.ts';
import { fieldScale, readZoom, stepZoom, storeZoom, WheelSteps, zoomChoices, zoomLabel, type Zoom } from './zoom.ts';
import { S } from './strings/index.ts';

declare global {
  interface Window {
    openSinnohGame?: AppBridge;
    /** Debug/test handle (always present once the game is mounted). */
    openSinnohApp?: { lastInput: InputFrame | null; ticks: number; layout: Layout; overlayFrame(): DsFrame; game: Game; sceneLoading(): boolean; ui: InGameUi; battleScene(): BattleSceneInfo; audio: WebAudio; zoom(): { setting: Zoom; scale: number }; renderScale(): { setting: RenderScale; pixelRatio: number }; loop: LoopStats; hold(): { holding: boolean; ms: number; reason: string }; speed(): { fast: number; latched: boolean; active: boolean; speed: number }; tileAt(x: number, y: number): { x: number; z: number } | null };
  }
}

export interface GameOptions {
  replay: boolean;
  /** The game clock in normal play (the device's); undefined in replay mode (the game's frozen clock). */
  clock?: () => ClockTime;
  /** Show the title screen and main menu first (never in replay mode). */
  title: boolean;
  /**
   * OPTIONS > DATA's imported-game actions; null in fixture mode (no re-import/delete). `reimport` goes to the ROM
   * page (the crash screen's button); `importRom` imports the chosen file (`addon`: the HGSS follower add-on) and
   * offers Start playing when it is done (the ROM page's session); `addAddon` is the setup's ADD NOW; `addon` is the add-on's ROM name, or null when none.
   */
  imported: { reimport(): void; importRom(file: File, addon: boolean): void; remove(): Promise<void>; addon: string | null; removeAddon(): Promise<void>; addAddon(file: File): void } | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const SAVE_SLOT = 'main';
/** Its own database: the app's `lantern-nds` database holds the imported packs. */
const SAVES_DB = 'lantern-nds-saves'; // pre-rename name, kept: players' stored data uses it
const MAX_SAVE_FILE = 2 * 1024 * 1024;
/** The longest the loop holds the game for the battle's art before it stops with an error. */
const HOLD_LIMIT_MS = 5000;
/**
 * The longest the loop holds the game on a map load's black for the scene in view before it stops with an error (well
 * past a slow phone's cold start, or a machine busy with parallel browser tests).
 */
const REVEAL_LIMIT_MS = 120_000;
/** A touch on the controls keeps them solid this long, even in a cut-scene that takes no input. */
const CONTROLS_WAKE_MS = 2000;
/** Ctrl/⌘ + these keys zoom the field: in (+1), out (−1) or back to Auto (0). */
const ZOOM_KEYS: Readonly<Record<string, 1 | -1 | 0>> = { Equal: 1, NumpadAdd: 1, Minus: -1, NumpadSubtract: -1, Digit0: 0, Numpad0: 0 };

function place(el: HTMLElement, r: Rect): void {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.width}px`;
  el.style.height = `${r.height}px`;
}

/**
 * The title and its DS screens in the area the field takes: above the portrait controls strip, the whole view in
 * landscape with its windows kept between the control columns (the `--sa*` and `--room-*` its CSS pads by).
 */
function placeTitle(el: HTMLElement, l: Layout): void {
  place(el, l.main);
  const vars: [string, number][] = l.controls ? [['--sal', l.room.left], ['--sar', l.room.right], ['--sab', l.room.bottom], ['--room-top', l.safe.y], ['--room-right', l.room.right], ['--room-bottom', l.room.bottom], ['--room-left', l.room.left]] : [];
  for (const name of ['--sal', '--sar', '--sab', '--room-top', '--room-right', '--room-bottom', '--room-left']) el.style.removeProperty(name);
  for (const [name, px] of vars) el.style.setProperty(name, `${px}px`);
}

/** The safe-area insets as CSS resolves them, read off a probe padded with `env(safe-area-inset-*)`. */
function safeAreaInsets(probe: HTMLElement): Insets {
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft) };
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]!;
}

/** The browser's file dialog: the chosen file, or null when it is cancelled. */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, hidden: true });
    const done = (file: File | null) => {
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => done(null));
    document.body.append(input);
    input.click();
  });
}

export async function mountGame(source: PackSource, opts: GameOptions): Promise<void> {
  splashPhase('graphics');
  const root = $('game');
  const mainCanvas = $<HTMLCanvasElement>('main-canvas');
  const overlay = $<HTMLCanvasElement>('overlay-canvas');
  const battleCanvas = $<HTMLCanvasElement>('battle-canvas');
  const panel = $<HTMLCanvasElement>('panel-canvas');
  const dpad = $('dpad');
  const buttons = $('buttons');
  const selectPill = $('select-pill');
  const startPill = $('start-pill');
  const controlBoxes = [dpad, buttons, selectPill, startPill];
  const insetProbe = $('safe-area-probe');
  const overlayCtx = overlay.getContext('2d')!;
  const panelCtx = panel.getContext('2d')!;

  const input = new InputState();
  let mods: readonly string[] = source.initialMods;
  /** Why the stored new-game settings were not used (shown as a notice), or ''. */
  let newGameProblem = '';
  const storedNewGame = (fontChars: string): NewGameOptions | undefined => {
    newGameProblem = '';
    try {
      const stored = readNewGame();
      return stored === null ? undefined : checkNewGame(stored, fontChars);
    } catch (e) {
      newGameProblem = S.game.namesUnused((e as Error).message);
      return undefined;
    }
  };
  const saves = new IndexedDbSaveStore(SAVES_DB);
  // The suspend point (suspend.ts): kept when the page hides, outside the title; never in replays.
  const suspend = createSuspend({ game: () => session.game, store: saves, on: () => !opts.replay && suspendOn() });
  // The device: stored options and the save slot the start menu's SAVE writes (a failed write is shown).
  let ui: InGameUi | null = null;
  const device = createDevice({
    log: () => session.game.log,
    write: (save) => saves.put(SAVE_SLOT, save),
    failed: (message) => (ui ? ui.notice(message) : console.error(message)),
    touch: matchMedia('(pointer: coarse)').matches,
  });
  // Replays play as the DS does: the OpenSinnoh additions (some on for players) take the contract default, in memory only.
  if (opts.replay) for (const key of OPENSINNOH_OPTIONS) device.options()[key] = DEFAULT_DEVICE_OPTIONS[key];
  // The synth: the game sends it what to play (output only). The device clock picks day or night music.
  const audio = createWebAudio(source.assets);
  const attachAudio = (s: Session) => {
    audio.bind(s.game.registries, s.game.log);
    s.game.audioOutput = audio;
  };
  /** The dev recorder (recorder.ts, dev builds only); null in production. */
  let recorder: ReplayRecorder | null = null;
  let startingRecording = false;
  // A recording runs on the replay's frozen clock, set before the reset creates the new state (its startDate).
  const sessionClock = import.meta.env.DEV && opts.clock ? () => (startingRecording || (recorder && !recorder.stopped) ? DEFAULT_CLOCK : opts.clock!()) : opts.clock;
  const open = async (withMods: readonly string[], seed: number) => {
    const s = await createSession(await source.load(withMods), source.assets, mainCanvas, seed, storedNewGame, device, sessionClock);
    // Replays print at the default speed; the player's stored text speed applies otherwise.
    if (!opts.replay) s.game.textSpeed = device.options().textSpeed as TextSpeedOption;
    return s;
  };
  let session: Session = await open(mods, opts.replay ? 1 : randomSeed());
  attachAudio(session);
  // The visual style and angled camera (visuals.ts; the renderer's enhanced visuals): the player's choice, applied
  // live; replays keep the DS look whatever is stored. Dev and test builds also get a hook to set a config directly.
  let visuals: Visuals = readVisuals();
  const lowPower = () => matchMedia('(pointer: coarse)').matches;
  const applyVisuals = () => setEnhancedVisuals(opts.replay ? null : visualStyleConfig(visuals.style, visuals.angledCamera, lowPower()));
  applyVisuals();
  // A preset or switch list takes this device's power, as the Options' style does.
  if (import.meta.env.DEV)
    (window as { openSinnohEnhanced?: (c: string | EnhancedConfig | null) => void }).openSinnohEnhanced = (c) => {
      const config = typeof c === 'string' ? parseEnhanced(c) : c;
      setEnhancedVisuals(config && typeof c === 'string' ? { ...config, lowPower: lowPower() } : config);
    };
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('debug') === '1') {
    const { mountDebugPanel } = await import('./debug/panel.ts');
    mountDebugPanel(() => session, () => input.clear('keyboard'));
  }
  // Replays never wait on a chunk mid-run: the battle engine loads up front (normal play loads it on the first battle).
  if (opts.replay) await session.game.loadBattleEngine();
  // Normal play fetches it now too, in the background: a deploy after the page opened can no longer take the
  // chunk away before the first battle (its failure shows at that battle).
  else void session.game.loadBattleEngine().then(() => warmBattleEngine(session.game), () => {});
  let ticks = 0;
  let lastInput: InputFrame | null = null;
  let panelTouch: { x: number; y: number } | null = null;
  let panelShown = true;
  /** The briefcase scene, drawn instead of the panel card while the VM offers the starters. */
  let starter: StarterScene | null = null;
  /** The field zoom (an app setting of this device) and the scale it gives in the current layout. */
  let zoom: Zoom = readZoom();
  let zoomScale = 1;
  /** The field's 3D resolution (an app setting of this device) and the pixel ratio it gives now. */
  let renderScale: RenderScale = readRenderScale();
  let fieldDpr = 1;
  const setZoom = (next: Zoom, toast: boolean) => {
    zoom = next;
    const err = storeZoom(zoom);
    if (err) session.game.log.stub('ui:zoom-storage', `the zoom is kept for this visit only: ${err}`);
    relayout();
    if (toast) ui!.toast(S.game.zoom(zoom === 'auto' ? S.game.auto : zoomLabel(zoomScale)));
  };

  // The phone settings of this device (phone.ts): control size and opacity, haptics, keeping the screen on.
  const coarse = matchMedia('(pointer: coarse)');
  let phone: PhoneSettings = readPhone();
  const setPhone = (next: PhoneSettings) => {
    const sizeChanged = next.size !== phone.size;
    phone = next;
    const err = storePhone(phone);
    if (err) session.game.log.stub('ui:phone-storage', `the phone settings are kept for this visit only: ${err}`);
    root.style.setProperty('--c-opacity', String(phone.opacity / 100));
    awake.hold(playing && phone.keepAwake && !opts.replay);
    if (sizeChanged) relayout();
  };
  /** The screen stays on while the game is played (the field or a battle runs), not at the title. */
  let playing = false;
  const awake = new ScreenAwake((message) => console.warn(message));
  root.style.setProperty('--c-opacity', String(phone.opacity / 100));
  const setPlayingNow = (on: boolean) => {
    playing = on;
    awake.hold(on && phone.keepAwake && !opts.replay);
    setPlaying(on);
  };

  /** Fast-forward (presentation only: replays and the bridge never use it). The fast speed is an app setting. */
  const fastForward = new FastForward(readFastSpeed());
  const loopStats = newLoopStats();
  const setFastSpeed = (n: number) => {
    if (!FAST_SPEEDS.includes(n as FastSpeed)) throw new Error(`fast-forward speed ${n} is not one of ${FAST_SPEEDS.join(', ')}`);
    fastForward.fast = n as FastSpeed;
    const err = storeFastSpeed(fastForward.fast);
    if (err) session.game.log.stub('ui:speed-storage', `the fast-forward speed is kept for this visit only: ${err}`);
  };
  const toggleFast = () => {
    fastForward.latched = !fastForward.latched;
    ui!.toast(S.game.speed(fastForward.speed()));
  };
  let fastWas = false;
  /** The loop's speed for this frame: the pad's trigger is polled here; holding (not the latch) toasts as it starts. */
  const loopSpeed = () => {
    fastForward.hold('gamepad', gamepadFastForward());
    if (fastForward.active && !fastWas && !fastForward.latched) ui!.toast(S.game.speed(fastForward.fast));
    fastWas = fastForward.active;
    return fastForward.speed();
  };
  const speedIndicator = document.createElement('div');
  speedIndicator.className = 'speed-indicator';
  speedIndicator.setAttribute('aria-hidden', 'true');
  speedIndicator.hidden = true;
  root.append(speedIndicator);

  // The OPTIONS screen's settings, in the game and from the title (ui/settings.ts).
  const appSettings = (): AppSettings => ({
    audio: { get: () => audio.settings(), set: (s) => audio.setSettings(s) },
    zoom: { get: () => zoom, choices: () => zoomChoices(layout.main.width, layout.main.height), set: (z) => setZoom(z, false) },
    renderScale: {
      get: () => renderScale,
      set: (s) => {
        renderScale = s;
        const err = storeRenderScale(s);
        if (err) session.game.log.stub('ui:render-scale-storage', `the render scale is kept for this visit only: ${err}`);
        relayout();
      },
    },
    speed: { get: () => fastForward.fast, choices: () => FAST_SPEEDS, set: setFastSpeed },
    visuals: {
      get: () => visuals,
      set: (v) => {
        visuals = v;
        const err = storeVisuals(v);
        if (err) session.game.log.stub('ui:visuals-storage', `the visual style is kept for this visit only: ${err}`);
        applyVisuals();
      },
      phone: coarse.matches,
    },
    data: dataActions,
    reports: {
      get: reportsEnabled,
      set: (on) => {
        const err = setReportsEnabled(on);
        if (err) session.game.log.stub('ui:reports-storage', `the error reports setting is kept for this visit only: ${err}`);
      },
    },
    phone: { get: () => phone, set: setPhone, touch: coarse.matches, haptics: hapticsSupported(), wakeLock: wakeLockSupported() },
    install: { available: canInstall, run: promptInstall },
    update: { waiting: updateWaiting, apply: applyUpdate },
  });

  // In-game UI: draws the open menu app (run by the game) and the Pokétch; taps go into the same input frame.
  const pulse = (button: Button) => {
    input.set('ui', button, true);
    input.set('ui', button, false);
  };
  ui = mountUi({
    root,
    game: () => session.game,
    font: () => session.font,
    assets: () => source.assets,
    pulse,
    tap: (id) => input.tap(id),
    fieldTile: (x, y) => {
      const r = mainCanvas.getBoundingClientRect();
      return session.renderer.tileAt?.(x - r.left, y - r.top) ?? null;
    },
    // The message box frame is saved with the game (GameState v6 options).
    frame: () => session.game.state.options.frame,
    settings: appSettings,
    fastForward: opts.replay ? null : { toggle: toggleFast, active: () => fastForward.active },
    // Where the browser has page fullscreen (not iPhone Safari: the installed app is its fullscreen) and the app is not installed already.
    fullscreen:
      fullscreenSupported() && !standalone()
        ? {
            toggle: () => {
              const change = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' });
              change.catch((e: Error) => ui!.notice(S.game.fullscreenFailed(e.message)));
            },
            active: () => document.fullscreenElement !== null,
          }
        : null,
    replay: opts.replay,
  });
  if (device.problem) {
    session.game.log.stub('ui:options-reset', `stored options were invalid (${device.problem}); reset to the defaults`);
    ui.notice(S.game.optionsReset(device.problem));
  }

  const pixelFonts = new WeakMap<object, PixelFont>();
  const battleStrings = new WeakMap<object, CardStrings>();
  const battle = mountBattle({
    root,
    canvas: battleCanvas,
    field: mainCanvas,
    game: () => session.game,
    assets: source.assets,
    font: () => session.font,
    pixelFont: () => {
      let p = pixelFonts.get(session.font);
      if (!p) pixelFonts.set(session.font, (p = new PixelFont(session.font)));
      return p;
    },
    strings: () => {
      let s = battleStrings.get(session.game);
      if (!s) battleStrings.set(session.game, (s = new CardStrings(session.game.registries)));
      return s;
    },
    // The card's back button while keys opened the move list: one B press, seen by the next tick.
    pressB: () => {
      input.set('card', 'b', true);
      input.set('card', 'b', false);
    },
  });

  let battleCovers = false;
  /**
   * The field's reveal. A map load (CONTINUE, a loaded save, a new game, a warp) starts the world's fade at full black;
   * the wall-clock loop holds the game there while the scene in view loads (its chunks, models, textures, sprites,
   * weather) and for two complete frames after it: the first draws the whole scene under the black, compiling its
   * programs and uploading its textures; the ticks due over that long frame pass while the second draws, so the fade
   * does not jump. Then the DS fade-in plays over the finished scene. Presentation only: the same ticks run, later
   * (replays never wait).
   */
  let completeFrames = 0;
  const revealing = () => !battleCovers && !session.game.inBattle() && (session.game.world.fadeState()?.alpha ?? 0) >= 1 && (session.renderer.loading() || completeFrames < 2);
  /** The map-name popup's boards, per game (a new session may bring other packs). */
  const popups = new WeakMap<Game, MapPopupLayer>();
  const popupLayer = () => {
    let p = popups.get(session.game);
    if (!p) {
      const game = session.game;
      const font = session.font;
      popups.set(game, (p = new MapPopupLayer(source.assets, () => game.registries, () => font)));
    }
    return p;
  };

  const recorderModule = import.meta.env.DEV ? await import('./recorder.ts') : null;
  const tick = () => {
    if (!opts.replay) pollGamepads(input);
    // The Pokétch card adds its touches (and L/R, touch mode) to the frame; the recorder records what the game gets.
    lastInput = ui!.input(input.frame());
    // Dev builds only: production folds these away.
    if (import.meta.env.DEV && recorder) recorder.frame(lastInput, session.game);
    session.tick(lastInput);
    if (!opts.replay) suspend.tick();
    if (import.meta.env.DEV && recorder) recorder.observe(session.game);
    ticks++;
    // After the clear's credits the DS resets to the title (decomp OS_ResetSystem): once the clear's save is
    // stored, the page reloads; CONTINUE loads it. Replays read the reset from the snapshot instead.
    const cleared = session.game.hasReset() ? session.game.resetSave() : null;
    if (cleared && !opts.replay && !resetting) {
      resetting = true;
      void saves.put(SAVE_SLOT, cleared).then(() => location.reload());
    }
  };
  let resetting = false;

  // Layout. On-screen controls show on touch devices until a keyboard or gamepad is used.
  let physicalInput = false;
  let controlsQuiet = false;
  let controlsWokenAt = -Infinity;
  // A hidden or not-yet-laid-out window can report 0×0; lay out at 1×1 until the next resize.
  const viewport = () => [Math.max(1, innerWidth), Math.max(1, innerHeight)] as const;
  let layout = computeLayout(...viewport(), { controls: false });
  let overlayScale = 1;
  /** The title's root while it shows: laid out with the game (placeTitle), the touch controls over it. */
  let titleRoot: HTMLElement | null = null;
  let popupScale = 1;
  /** The pixel ratio of the last layout (see `render`). */
  let layoutDpr = 1;
  const relayout = () => {
    const dpr = devicePixelRatio || 1;
    layoutDpr = dpr;
    const controlScale = CONTROL_SIZES[phone.size]!.scale;
    layout = computeLayout(...viewport(), { controls: coarse.matches && !physicalInput, insets: safeAreaInsets(insetProbe), dpr, controlScale });
    place(mainCanvas, layout.main);
    place(overlay, layout.main);
    place(panel, layout.panel);
    zoomScale = fieldScale(zoom, layout.main.width, layout.main.height);
    fieldDpr = renderPixelRatio(dpr, coarse.matches, renderScale);
    session.renderer.resize(layout.main.width, layout.main.height, fieldDpr, zoomScale);
    overlay.width = Math.round(layout.main.width * dpr);
    overlay.height = Math.round(layout.main.height * dpr);
    // Script windows share the UI's DS unit (capped on big screens, like the mart and the battle window).
    overlayScale = Math.max(1, Math.round(layout.ui.unit * dpr));
    popupScale = mapPopupScale(overlayScale, layout.main, dpr);
    const k = Math.max(1, Math.ceil(layout.panel.scale * dpr));
    panel.width = PANEL_WIDTH * k;
    panel.height = PANEL_HEIGHT * k;
    panelCtx.setTransform(k, 0, 0, k, 0, 0);
    for (const box of controlBoxes) box.hidden = !layout.controls;
    if (layout.controls) {
      // style.css draws the controls at the sizes the layout placed (smaller than chosen where they do not fit).
      const c = layout.controls.metrics;
      for (const [name, px] of [['key', c.key], ['face', c.face], ['pill-w', c.pillW], ['pill-h', c.pillH], ['pill-inset-y', c.pillInsetY], ['pill-inset-x', c.pillInsetX]] as const) root.style.setProperty(`--c-${name}`, `${px}px`);
      root.style.setProperty('--c-s', String(c.scale));
      place(dpad, layout.controls.dpad);
      place(buttons, layout.controls.buttons);
      place(selectPill, layout.controls.select);
      place(startPill, layout.controls.start);
    }
    if (titleRoot) placeTitle(titleRoot, layout);
    starter?.resize(layout.safe);
    ui.layout(layout);
    battle.layout(layout);
    if (window.openSinnohApp) window.openSinnohApp.layout = layout;
  };
  /** The overlay's DS frame: a frontier scene's centred in the room, else the field's at the bottom (device px). */
  const overlayFrame = (): DsFrame => {
    if (!session.game.scripts.view().frontier) return bottomFrame(overlay, overlayScale);
    const dpr = devicePixelRatio || 1;
    const r = layout.room;
    return frontierFrame(overlay, { top: Math.round(r.top * dpr), right: Math.round(r.right * dpr), bottom: Math.round(r.bottom * dpr), left: Math.round(r.left * dpr) }, overlayScale);
  };
  addEventListener('resize', relayout);
  // Rotation: a browser may report the old size at the change itself (iOS), so lay out again at the next frame too.
  screen.orientation?.addEventListener('change', () => {
    relayout();
    requestAnimationFrame(relayout);
  });
  coarse.addEventListener('change', relayout);
  const sawPhysical = () => {
    if (physicalInput) return;
    physicalInput = true;
    relayout();
  };
  addEventListener('keydown', (e) => {
    if (!controls.keyMap()[e.code]) return;
    // Native control activation must not replace its button between keydown and keyup.
    if (e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, dialog') || ((e.code === 'Space' || e.code === 'Enter') && e.target.closest('button:not([data-button])')))) return;
    sawPhysical();
  });
  addEventListener('gamepadconnected', sawPhysical);

  // Input sources.
  attachKeyboard(window, input);
  attachGamepadEvents(window, input, () => ui!.toast(S.game.gamepadGone));
  panel.addEventListener('pointerdown', (e) => {
    panel.setPointerCapture(e.pointerId);
    panelTouch = toPanelPoint(e.clientX, e.clientY, panel.getBoundingClientRect());
    input.setTouch('panel', panelTouch);
  });
  panel.addEventListener('pointermove', (e) => {
    if (!panel.hasPointerCapture(e.pointerId)) return;
    panelTouch = toPanelPoint(e.clientX, e.clientY, panel.getBoundingClientRect());
    input.setTouch('panel', panelTouch);
  });
  const panelUp = () => {
    panelTouch = null;
    input.setTouch('panel', null);
  };
  panel.addEventListener('pointerup', panelUp);
  panel.addEventListener('pointercancel', panelUp);
  // A scripted menu (ScriptView.menu) is a box over the field: touches on it go to the VM in the overlay's DS frame.
  mainCanvas.addEventListener('pointerdown', (e) => {
    // The Underground's field: a touch is the touch radar on the tile under it (UndergroundMan_CheckForTouchInput).
    if (session.game.world.undergroundView()) {
      const r = mainCanvas.getBoundingClientRect();
      const tile = session.renderer.tileAt?.(e.clientX - r.left, e.clientY - r.top);
      if (tile) input.tap(`tile:${tile.x},${tile.z}`);
    }
    if (!session.game.scripts.view().menu) return;
    input.setTouch('overlay', toOverlayPoint(e.clientX, e.clientY, mainCanvas.getBoundingClientRect(), overlay, overlayFrame()));
  });
  const overlayUp = () => input.setTouch('overlay', null);
  mainCanvas.addEventListener('pointerup', overlayUp);
  mainCanvas.addEventListener('pointercancel', overlayUp);
  // The battle scene stands in for the DS touch screen: touching it speeds up or skips battle messages as a
  // touch does on the DS (the battle reads only whether it is touched; the point is in the scene's DS px).
  battleCanvas.addEventListener('pointerdown', (e) => {
    battleCanvas.setPointerCapture(e.pointerId);
    const { rect, scale } = battle.scene();
    const k = (devicePixelRatio || 1) / scale;
    input.setTouch('battle', { x: Math.round((e.clientX - rect.x) * k), y: Math.round((e.clientY - rect.y) * k) });
  });
  const battleUp = () => input.setTouch('battle', null);
  battleCanvas.addEventListener('pointerup', battleUp);
  battleCanvas.addEventListener('pointercancel', battleUp);
  for (const el of root.querySelectorAll<HTMLButtonElement>('.controls button')) {
    const button = el.dataset.button as Button;
    if (!BUTTONS.includes(button)) throw new Error(`unknown on-screen button ${button}`);
    const set = (down: boolean) => (e: PointerEvent) => {
      if (down) {
        el.setPointerCapture(e.pointerId);
        // A touch on the controls brings them back for a moment even in a cut-scene.
        controlsWokenAt = performance.now();
        if (phone.haptics && hapticsSupported()) navigator.vibrate(HAPTIC_MS);
      }
      el.classList.toggle('active', down);
      input.set(`screen-${button}`, button, down);
    };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
  }
  // Field zoom shortcuts (desktop): Ctrl/⌘ + wheel or trackpad pinch over the field, Ctrl/⌘ + +/−/0
  // (0 = Auto). The browser's page zoom is prevented only for these; a plain wheel is left alone.
  const wheelSteps = new WheelSteps();
  root.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target instanceof HTMLElement && e.target.closest('.ui-screen'))) return;
      e.preventDefault();
      const dir = wheelSteps.add(e.deltaY, e.deltaMode);
      if (dir) setZoom(stepZoom(zoom, dir, layout.main.width, layout.main.height), true);
    },
    { passive: false },
  );
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || root.hidden || titleActive) return;
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, dialog')) return;
    const dir = ZOOM_KEYS[e.code];
    if (dir === undefined) return;
    e.preventDefault();
    setZoom(dir === 0 ? 'auto' : stepZoom(zoom, dir, layout.main.width, layout.main.height), true);
  });
  // Fast-forward (desktop): Tab held, backtick toggles. Not while typing; Tab not in a menu app (it moves focus there).
  if (!opts.replay) {
    addEventListener('keydown', (e) => {
      if (root.hidden || titleActive || e.ctrlKey || e.metaKey || e.altKey) return;
      const fastKey = controls.isFastKey(e.code);
      if (fastKey && session.game.app()) return;
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, dialog')) return;
      if (fastKey) {
        e.preventDefault();
        fastForward.hold('keyboard', true);
      } else if (e.code === FAST_FORWARD_TOGGLE && !e.shiftKey && !e.repeat) {
        e.preventDefault();
        toggleFast();
      }
    });
    addEventListener('keyup', (e) => controls.isFastKey(e.code) && fastForward.hold('keyboard', false));
    addEventListener('blur', () => fastForward.hold('keyboard', false));
  }
  // No long-press menu (iOS callout, Android/desktop context menu) anywhere on the game screen.
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  const render = (alpha: number) => {
    // A pixel ratio change alone (another monitor, device emulation) fires no resize, and the canvases would keep
    // the old ratio (the battle scene drawn at the wrong scale): lay out again.
    if ((devicePixelRatio || 1) !== layoutDpr) relayout();
    // Once the battle scene covers the field, the field is not drawn (nor loaded) under it. While a battle
    // runs the world does not tick: the field is drawn at its last tick, not interpolated toward it (an
    // alpha between two stale ticks jittered the camera, the encounter "shake").
    // The DS STEREO/MONO option (saved with the game; decomp Sound_SetPlaybackMode).
    audio.setMono(session.game.state.options.sound === 1);
    // The synth's sequencer follows the game: the speed asked for, or what the machine manages when behind.
    const speed = loopStats.speed;
    audio.setSpeed(loopStats.behind ? Math.max(1, Math.round(loopStats.effective * 4) / 4) : speed);
    if (speedIndicator.hidden !== (speed === 1)) speedIndicator.hidden = speed === 1;
    if (speed !== 1 && speedIndicator.textContent !== `>> ${speed}x`) speedIndicator.textContent = `>> ${speed}x`;
    battleCovers = battle.covers();
    if (!battleCovers) session.renderer.render(session.game.inBattle() ? 1 : alpha);
    // The count matters only under the full black (`revealing`); elsewhere the scene's loading is not asked for (it
    // builds the world's view again) and the field counts as complete.
    const black = (session.game.world.fadeState()?.alpha ?? 0) >= 1;
    completeFrames = battleCovers || (black && session.renderer.loading()) ? 0 : black ? Math.min(completeFrames + 1, 2) : 2;
    battle.frame();
    session.drawOverlay(overlayCtx, overlayFrame(), zoomScale * (devicePixelRatio || 1));
    if (!battleCovers) {
      // The landscape HUD sits above the d-pad; start the signboard inside the available room.
      overlayCtx.save();
      overlayCtx.translate(Math.round(layout.room.left * (devicePixelRatio || 1)), 0);
      popupLayer().draw(overlayCtx, session.game.mapPopup(), popupScale);
      overlayCtx.restore();
    }
    // The touch panel is a card over the field, shown only while it has something to offer.
    const panelView = session.game.scripts.view().panel;
    const starterChoice = isStarterChoice(panelView, session.game.registries);
    if (starterChoice) {
      if (!starter) {
        const ns = [...session.game.registries.newGame.keys()][0]!.split(':')[0]!;
        starter = new StarterScene({ parent: root, registries: session.game.registries, ns, assets: source.assets, font: session.font, input }, panelView);
        starter.resize(layout.safe);
      }
      starter.frame(panelView);
    } else if (starter) {
      void starter.close();
      starter = null;
    }
    const show = panelView.kind !== 'idle' && !starterChoice;
    if (show !== panelShown) {
      panelShown = show;
      panel.style.display = show ? 'block' : 'none';
      if (!show && panelTouch) {
        panelTouch = null;
        input.setTouch('panel', null);
      }
    }
    if (show) drawPanel(panelCtx, panelView, panelTouch);
    // A cut-scene that takes no input (a script moving people about, no message, question, menu or battle): the controls fade.
    const game = session.game;
    const sv = game.scripts.view();
    const quiet = game.scripts.running() && !sv.message && !sv.yesNo && !sv.menu && sv.panel.kind === 'idle' && !game.app() && !game.inBattle() && performance.now() - controlsWokenAt > CONTROLS_WAKE_MS;
    if (quiet !== controlsQuiet) {
      controlsQuiet = quiet;
      for (const box of controlBoxes) box.classList.toggle('quiet', quiet);
    }
    ui.frame();
  };

  window.openSinnohApp = {
    get lastInput() {
      return lastInput;
    },
    get ticks() {
      return ticks;
    },
    get game() {
      return session.game;
    },
    sceneLoading: () => (battleCovers ? false : session.renderer.loading()) || battle.loading(),
    battleScene: () => battle.scene(),
    layout,
    overlayFrame,
    ui,
    audio,
    zoom: () => ({ setting: zoom, scale: zoomScale }),
    renderScale: () => ({ setting: renderScale, pixelRatio: fieldDpr }),
    loop: loopStats,
    hold: () => (battle.holding() ? { holding: true, ms: held, reason: battle.holdReason() } : { holding: revealing(), ms: held, reason: revealing() ? 'the field scene' : '' }),
    speed: () => ({ fast: fastForward.fast, latched: fastForward.latched, active: fastForward.active, speed: fastForward.speed() }),
    tileAt: (x, y) => session.renderer.tileAt?.(x, y) ?? null,
  };
  // The title screen runs first (its own loop); the field shows and its loop starts once it is left.
  const titleRecord = opts.title ? [...session.game.registries.titleScreens.values()][0] : undefined;
  let titleActive = !!titleRecord;
  root.classList.toggle('at-title', titleActive);
  root.hidden = false;
  relayout();

  // Anything that throws in a tick or frame stops the game: reported, and the crash screen shows it (telemetry/crash.ts).
  // A watchdog that stops the game calls `fatal` too.
  const fatal = (e: Error) => crash(e, 'loop', opts.imported ? { secondary: { label: S.crash.reimportRom, run: () => opts.imported!.reimport() } } : {});
  if (!opts.replay) {
    watchPerf(loopStats, () => fieldDpr);
    // Analytics: the play heartbeat and milestones (badges, Hall of Fame), checked once a second.
    const play = playWatcher({ playing: () => (titleActive ? null : session.game.state), ticks: () => loopStats.ticks, visible: () => document.visibilityState === 'visible' });
    setInterval(play.second, 1000);
  }
  if (new URLSearchParams(location.search).has('perf')) mountPerfHud(document.body, { loop: loopStats, renderDpr: () => fieldDpr });
  const watch = watchGame({ game: () => session.game, loop: loopStats, title: () => titleActive, holding: () => battle.holding() });
  // The wall-clock loop holds the game on the cut-in's black screen until the battle's art is in (replays never wait).
  // A hold that does not end (art that never loads) must never leave a silently frozen screen: past
  // HOLD_LIMIT_MS of running wall time (a hidden tab's pause is not counted) the game stops with the reason.
  // Every frame gap counts in full: a loaded machine drawing a few frames a second is still running (a cap per
  // frame made the limit stretch with the frame time, past the point the screen looked frozen). Only a hidden
  // tab's pause (no frames at all) is left out: counting resumes from the first tick after it.
  let held = 0;
  let heldAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    heldAt = null;
    // A hidden page makes no sound and holds no wake lock (the loop stops itself: loop.ts); showing it again resumes both.
    if (document.visibilityState === 'hidden') {
      audio.suspend();
      awake.hide();
      if (!titleActive) void suspend.hide().catch((e: Error) => console.error(`suspend: not kept (${e.message})`));
    } else {
      audio.resume();
      awake.show();
    }
  });
  // Leaving for good (not into the back/forward cache): close the save database's connection.
  addEventListener('pagehide', (e) => !e.persisted && saves.close());
  const loopTick = () => {
    watch.tick();
    const battleHold = battle.holding();
    if (!battleHold && !revealing()) {
      held = 0;
      heldAt = null;
      tick();
      return;
    }
    const now = performance.now();
    held += heldAt === null ? 0 : now - heldAt;
    heldAt = now;
    if (battleHold && held > HOLD_LIMIT_MS) throw new Error(`the battle's art did not load within ${HOLD_LIMIT_MS / 1000} s (still loading: ${battle.holdReason()})`);
    if (!battleHold && held > REVEAL_LIMIT_MS) throw new Error(`the field's scene did not load within ${REVEAL_LIMIT_MS / 1000} s`);
  };
  const playHooks = { tick: loopTick, render, onError: fatal, speed: loopSpeed };
  if (!titleActive) {
    startLoop(playHooks, !opts.replay, loopStats);
    setPlayingNow(true);
    splashDone(true);
  }
  /** Recording starts from a new game with the replay seed (1) and the default names, as `opensinnoh test` plays it. */
  const recordingTools = recorderModule ? {
    startRecording: async () => {
      recorder?.stop('a new recording started', session.game);
      recorder = null;
      const record = [...session.game.registries.newGame.values()][0]!;
      input.reset();
      startingRecording = true;
      try {
        await session.reset(1, { names: { ...record.names }, gender: record.gender });
      } finally {
        startingRecording = false;
      }
      // Replays print at the default speed.
      session.game.textSpeed = 1;
      ticks = 0;
      recorder = recorderModule.ReplayRecorder.start(session.game, [`Recorded in the app (${session.game.loadOrder.map((p) => `${p.id}@${p.version}`).join(', ')}), seed 1, from a new game.`]);
    },
    recording: () => (recorder ? recorder.text(session.game.state) : null),
  } : undefined;
  if (recorderModule && recordingTools) recorderModule.attachRecorderMenu({ start: recordingTools.startRecording, recording: recordingTools.recording, stopped: () => recorder?.stopped ?? null });
  if (opts.replay) {
    const bridge = createBridge({
      input,
      session: () => session,
      tick,
      reset: async (seed) => {
        input.clear('bridge');
        await session.reset(seed ?? 1);
        ticks = 0;
      },
      recordingTools,
      setOption: (key, value) => device.setOption(key, value),
    });
    window.openSinnohGame = bridge;
    bridge.ready = true;
  }

  // OPTIONS > DATA (ui/settings.ts): the save file, the imported game and its HGSS add-on, and the mods.
  const download = (name: string, text: string, type: string) => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  /** The mods the packs offer, with whether each is on (read when the game starts and after a change). */
  let modList: { id: string; name: string; on: boolean }[] = [];
  const refreshMods = async () => {
    modList = (await source.mods()).map((m) => ({ id: m.id, name: m.name, on: mods.includes(m.id) }));
  };
  /** Rebuilds the game from the new pack set, from the last save when the new packs accept it. */
  const setMods = async (next: readonly string[]): Promise<string> => {
    recorder?.stop('the packs changed', session.game);
    const save = (await saves.get(SAVE_SLOT)) ?? null;
    const fresh = await open(next, opts.replay ? 1 : randomSeed());
    if (opts.replay) await fresh.game.loadBattleEngine();
    else warmBattleEngine(fresh.game);
    let result = S.game.newGameStarted;
    if (save !== null) {
      try {
        await fresh.load(save);
        result = S.game.backAtSave;
      } catch (e) {
        if (!(e instanceof PackMismatchError)) {
          fresh.dispose();
          throw e;
        }
        result = S.game.newGameOtherPacks;
      }
    }
    mods = next;
    const old = session;
    old.game.audioOutput = null;
    session = fresh;
    attachAudio(session);
    old.dispose();
    relayout();
    return result;
  };
  const imported = opts.imported;
  /** What the browser says about its storage, for Options > Data (an imported game only). */
  let storage: StorageStatus | null = null;
  const refreshStorage = async () => {
    storage = await storageStatus();
  };
  if (imported) void refreshStorage();
  const dataActions: DataActions = {
    async exportSave() {
      const json = await saves.get(SAVE_SLOT);
      if (json === undefined) throw new Error(S.game.saveFirst);
      download(`opensinnoh-save-${new Date().toISOString().slice(0, 10)}.json`, json, 'application/json');
      return S.game.exported;
    },
    async importSave(ask) {
      const file = await pickFile('.json,application/json');
      if (!file) return '';
      if (file.size > MAX_SAVE_FILE) throw new Error(S.game.saveTooLarge);
      if (!(await ask(titleActive ? S.game.replaceSaved : S.game.replaceGame))) return '';
      const text = await file.text();
      // Loading validates it (strictly: shape, packs, ids) before anything is kept.
      try {
        await session.load(text);
      } catch (e) {
        throw new Error(saveImportMessage(e), { cause: e });
      }
      await suspend.loaded();
      if (!titleActive) {
        // The load closes the OPTIONS app that asked, so the line goes where it is still read.
        const text = S.game.loadedSave;
        ui!.notice(text);
        return text;
      }
      await saves.put(SAVE_SLOT, saveFromJson(text) as SaveEnvelope);
      // The title read its save when it opened: start again so CONTINUE shows this one.
      location.reload();
      return S.game.savedRestarting;
    },
    rom: imported && {
      addon: imported.addon,
      storage: {
        line: () => (storage ? storageLine(storage) : S.game.checkingStorage),
        async keep() {
          const kept = await requestPersistence();
          await refreshStorage();
          return kept ? S.game.keepDone : S.game.keepRefused;
        },
      },
      async reimport() {
        const file = await pickFile('.nds,application/octet-stream');
        if (file) await imported.importRom(file, false);
        return '';
      },
      async addAddon() {
        const file = await pickFile('.nds,application/octet-stream');
        if (file) await imported.importRom(file, true);
        return '';
      },
      async removeAddon() {
        await imported.removeAddon();
        return '';
      },
      async remove() {
        await imported.remove();
        return '';
      },
    },
    mods: {
      list: () => modList,
      async set(id, on) {
        const name = modList.find((m) => m.id === id)!.name;
        const result = await setMods(toggleMod(mods, id, on));
        await refreshMods();
        const text = S.game.modToggled(on, name, result);
        // The restart closes the OPTIONS app that asked.
        ui!.notice(text);
        return text;
      },
    },
  };
  refreshMods().catch((e: Error) => ui!.notice(S.game.modsUnreadable(e.message)));
  if (newGameProblem) ui.notice(newGameProblem);

  /** The setup's questions not yet answered on this device and where each answer is kept (title/setup.ts). */
  const setupDeps = () => {
    const answered = readAnswered();
    const questions: SetupQuestion[] = [];
    if (!answered.includes('reports') && !reportsAnswered()) questions.push('reports');
    if (opts.imported && !opts.imported.addon && !answered.includes('addon')) questions.push('addon');
    if (!answered.includes('textSpeed')) questions.push('textSpeed');
    if (!answered.includes('visualStyle') && !visualStyleChosen()) questions.push('visualStyle');
    const stored = (q: SetupQuestion) => {
      const err = storeAnswered(q);
      if (err) session.game.log.stub('ui:setup-storage', `the setup's answers are kept for this visit only: ${err}`);
    };
    return {
      questions,
      textSpeed: () => device.options().textSpeed,
      textDelay: (speed: number) => TEXT_FRAME_DELAY[speed as TextSpeedOption],
      answer(q: SetupQuestion, choice: number) {
        if (q === 'reports') {
          const err = setReportsEnabled(choice === 0);
          if (err) session.game.log.stub('ui:reports-storage', `the error reports setting is kept for this visit only: ${err}`);
        } else if (q === 'textSpeed') {
          device.setOption('textSpeed', choice);
          session.game.textSpeed = choice as TextSpeedOption;
        } else if (q === 'visualStyle') {
          visuals = { ...visuals, style: VISUAL_STYLES[choice]! };
          const err = storeVisuals(visuals);
          if (err) session.game.log.stub('ui:visuals-storage', `the visual style is kept for this visit only: ${err}`);
          applyVisuals();
        }
        stored(q);
      },
      pickAddon() {
        // The add-on import path (main.ts): the ROM page's session, then Start playing; the setup goes on after it.
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.nds' });
        input.addEventListener('change', () => {
          const file = input.files?.[0];
          if (!file) return;
          stored('addon');
          opts.imported!.addAddon(file);
        });
        input.click();
      },
    };
  };

  if (titleRecord) {
    // The title's CONTINUE shows (and loads) the save, or the suspend point when it is newer.
    const real = await saves.get(SAVE_SLOT);
    const saved = await suspend.pick(real);
    let save: ContinueInfo | null = null;
    let saveProblem = '';
    if (saved !== undefined) {
      try {
        // Only the info panel is read here; Continue loads (and fully validates) the save.
        const s = (saveFromJson(saved) as { state?: Partial<GameState> } | null)?.state;
        if (typeof s?.names?.player !== 'string' || (s.gender !== 'male' && s.gender !== 'female') || typeof s.tick !== 'number' || !Array.isArray(s.badges) || typeof s.pokedex?.obtained !== 'boolean')
          throw new Error('it has no player data');
        // MYSTERY GIFT edits the real save (never the suspend point), so it shows by that save's state.
        save = { player: s.names.player, gender: s.gender, ticks: s.tick, badges: s.badges.length, pokedex: s.pokedex.obtained, mysteryGift: s.mysteryGift?.unlocked === true && real !== undefined && saved === real };
      } catch (e) {
        saveProblem = S.game.saveUnreadable((e as Error).message);
      }
    }
    await showTitle({
      record: titleRecord,
      registries: session.game.registries,
      ns: [...session.game.registries.newGame.keys()][0]!.split(':')[0]!,
      assets: source.assets,
      font: session.font,
      input,
      poll: () => pollGamepads(input),
      save,
      saveProblem,
      newGameDefaults: { names: { ...session.game.state.names }, gender: session.game.state.gender },
      continueGame: async () => {
        // Read again: MYSTERY GIFT may have written the save since the title opened. A newer suspend point wins, once.
        await session.load((await suspend.pick(await saves.get(SAVE_SLOT)))!);
        await suspend.loaded();
        // The title's CONTINUE (not a plain load): the roamers scatter, as on the DS.
        session.game.onContinue();
        ticks = 0;
        track('game_continue');
      },
      mysteryGiftSave: async () => {
        const g = session.game;
        const env = validateSave(saveFromJson((await saves.get(SAVE_SLOT))!), g.registries, g.loadOrder, g.labels);
        return { state: env.state, write: () => saves.put(SAVE_SLOT, { ...env, savedAt: new Date().toISOString() }) };
      },
      today: () => session.game.clock().date,
      newGame: async (form) => {
        const settings = checkNewGame(form, session.messageChars);
        storeNewGame(settings);
        newGameProblem = '';
        await session.reset(randomSeed(), settings);
        await suspend.loaded();
        ticks = 0;
        track('game_new');
      },
      // The device's options as the game lists them (the saved ones are the new game's, shown muted).
      options: {
        host: {
          options: () => ({ ...device.options(), ...session.game.state.options }),
          setOption: (key, value) => {
            device.setOption(key, value);
            if (key === 'textSpeed') session.game.textSpeed = value as TextSpeedOption;
          },
        },
        settings: appSettings,
      },
      sound: session.game.sound,
      tickSound: () => session.game.sound.tick(),
      log: session.game.log,
      frame: () => session.game.state.options.frame,
      setup: setupDeps(),
      autoContinue: new URLSearchParams(location.search).has('continue'),
      mounted: (el) => {
        titleRoot = el;
        relayout();
        // The title draws its first frame next (from black): the splash fades out over its fade in.
        splashDone(true);
      },
    });
    titleActive = false;
    titleRoot = null;
    input.clear('keyboard');
    root.classList.remove('at-title');
    relayout();
    startLoop(playHooks, true, loopStats);
    setPlayingNow(true);
  }
}
