/**
 * The OPTIONS screen's settings, one entry each (options-screen.ts draws and drives them). A setting has an
 * id, its section, a kind (how its row shows and steps), where it is kept, and reads and writes its value
 * through the `SettingsEnv`. The DS options are the OPTIONS app's rows (packages/menus: labels, values and
 * descriptions in the pack's text) and change through the app's taps, so they go through the game's input
 * like a key press and replays record them; the app's own settings apply at once on this device. DATA's
 * rows are actions (a file dialog, a download, a confirmed deletion) run through `AppSettings.data`.
 *
 * One screen serves the title and the game (`SettingsEnv.where`): a setting that does not work where the
 * screen is open stays listed, disabled, with a one-line reason as its description.
 *
 * Adding a setting is one entry in `SETTINGS` (and, for a new app hook, one field of `AppSettings`); `group` names
 * the heading it sits under, and rows of one group stand together in `SETTINGS`.
 */
import { isSavedOption, type DeviceOptions, type OptionsView } from '@opensinnoh/contracts';
import { frameMode, setFrameMode, setThemeMode, themeMode, WINDOW_FRAMES, type ThemeMode } from '@opensinnoh/ui';
import { actionLabel, ACTIONS, bindKey, bindingText, bindPad, keyLabel, PAD_LAYOUTS, padLabel, type Action, type Captured } from '../controls.ts';
import { chooseFlashing, flashingOn } from '../flashing.ts';
import { setSuspendOn, suspendOn } from '../suspend.ts';
import { introSkipOn, setIntroSkip } from '../title/intro-skip.ts';
import { controls } from '../input.ts';
import { CONTROL_SIZES, OPACITY_MIN, OPACITY_RANGE, type PhoneSettings } from '../phone.ts';
import { RENDER_SCALES, type RenderScale } from '../layout.ts';
import { zoomLabel, type Zoom } from '../zoom.ts';
import { VISUAL_STYLES, type Visuals } from '../visuals.ts';
import { MENU_STYLES, readMenuStyle, storeMenuStyle } from '../menu-style.ts';
import { S, type Strings } from '../strings/index.ts';

export type SectionId = 'game' | 'device' | 'controls' | 'data' | 'privacy';
/** A row's heading on its page (`S.options.groups`). */
export type GroupId = keyof Strings['options']['groups'];

/** The sections in page order (L/R and the tabs), with their tab labels. */
export const SECTIONS: readonly { id: SectionId; readonly label: string }[] = (['game', 'device', 'controls', 'data', 'privacy'] as const).map((id) => ({
  id,
  get label() {
    return S.options.section[id];
  },
}));

/**
 * The DATA section's actions (game-view.ts). Each resolves to a one-line result for the player (shown in the
 * description window; '' for none) or throws an Error whose message is. One that needs a file opens the browser's
 * file dialog.
 */
export interface DataActions {
  /** Downloads the last save. */
  exportSave(): Promise<string>;
  /** Asks for a save file and puts it in the game (in a game) or in the save slot (at the title), once `ask` says YES. */
  importSave(ask: (question: string) => Promise<boolean>): Promise<string>;
  /** The imported game's actions; null when the run has no imported ROM (dev packs). */
  rom: {
    /** Asks for the Platinum ROM and imports it again. */
    reimport(): Promise<string>;
    /** The browser's storage for this site: a status line for the description (two lines), and a request that the browser keeps the data. */
    storage: { line(): string; keep(): Promise<string> };
    /** The HGSS add-on's ROM name, or null when none is imported. */
    addon: string | null;
    addAddon(): Promise<string>;
    removeAddon(): Promise<string>;
    /** Deletes the imported game data (the saves stay). */
    remove(): Promise<string>;
  } | null;
  /** The mods the packs offer for this game, and turning one on or off (it rebuilds the game). */
  mods: { list(): { id: string; name: string; on: boolean }[]; set(id: string, on: boolean): Promise<string> };
}

/** The app's settings hooks (game-view.ts); null where this run has none (no audio). */
export interface AppSettings {
  audio: { get(): { volume: number; muted: boolean }; set(s: { volume: number; muted: boolean }): void } | null;
  /** The field zoom: the setting and the choices for this window. */
  zoom: { get(): Zoom; choices(): Zoom[]; set(zoom: Zoom): void } | null;
  /** The field's 3D resolution (layout.ts `RenderScale`). */
  renderScale: { get(): RenderScale; set(scale: RenderScale): void } | null;
  /**
   * The visual style and angled camera (visuals.ts); `phone`: a touch screen (Cinematic says it is heavier there);
   * `eased`: the automatic quality step is on (auto-quality.ts), which the style's row says.
   */
  visuals: { get(): Visuals; set(v: Visuals): void; phone: boolean; eased(): boolean } | null;
  /** Page fullscreen, where the browser has it and the app is not installed (the HUD's button; a pad reaches this row). */
  fullscreen: { run(): Promise<void>; active(): boolean } | null;
  /** The fast-forward speed. */
  speed: { get(): number; choices(): readonly number[]; set(speed: number): void } | null;
  /** The DATA section's actions. */
  data: DataActions;
  /** Anonymous error reports on or off. */
  reports: { get(): boolean; set(on: boolean): void } | null;
  /**
   * The phone settings of this device (phone.ts); each row is listed only where this device has the feature:
   * `touch` (on-screen controls: a touch screen), `haptics` (`navigator.vibrate`), `wakeLock`.
   */
  phone: { get(): PhoneSettings; set(p: PhoneSettings): void; touch: boolean; haptics: boolean; wakeLock: boolean } | null;
  /** The browser's install prompt, when it has offered one (platform.ts). */
  install: { available(): boolean; run(): Promise<string> } | null;
  /** A new version waits for the restart (platform.ts). */
  update: { waiting(): boolean; apply(): Promise<void> } | null;
}

export interface SettingsEnv extends AppSettings {
  /** Where the screen is open: from the title (no game running yet) or in the game. */
  where: 'title' | 'game';
  /** The open OPTIONS app's view. */
  view: OptionsView;
  /** A tap on the OPTIONS app (the next input frame's). */
  tap(id: string): void;
  /** A YES/NO question in the screen's message box: true for YES. */
  ask(question: string): Promise<boolean>;
}

/**
 * - `choice`: every value on the row, the chosen one marked (the DS's rows); left/right step and wrap.
 * - `toggle`: a choice of ON and OFF (the pack's words), stored as a boolean.
 * - `stepper`: one value between arrows (the DS's FRAME row); left/right step and wrap.
 * - `slider`: a number from `range.min` to `range.max` in `range.step`s, drawn as a bar; it does not wrap.
 * - `action`: one button (the first of `values`); A runs `run`, after `confirm`'s question when it has one.
 */
export type SettingKind = 'choice' | 'toggle' | 'stepper' | 'slider' | 'action';

export interface Setting {
  id: string;
  section: SectionId;
  /** Its heading on the page (`grouped`); a row without one stays under the row before it. */
  group?: GroupId;
  kind: SettingKind;
  /** `save`: in the game's save (GameState options); `device`: this device's localStorage; `none`: an action. */
  storage: 'save' | 'device' | 'none';
  /** Whether this run has the setting (the app's hooks can be absent). */
  available(env: SettingsEnv): boolean;
  label(env: SettingsEnv): string;
  /** The message window's text while the row is focused (`\n` breaks lines). */
  description(env: SettingsEnv): string;
  /** The value names (not for sliders). */
  values(env: SettingsEnv): string[];
  /** The value: an index into `values`, or the slider's number. */
  get(env: SettingsEnv): number;
  set(env: SettingsEnv, value: number): void;
  /**
   * One step left (−1) or right (+1). Absent: `set` the next value. The DS options step with the app's
   * relative tap, so two presses in a row are two steps even before the app has drawn the first.
   */
  step?(env: SettingsEnv, delta: 1 | -1): void;
  range?: { min: number; max: number; step: number };
  /** Why the setting does not work where the screen is open (the description window's text), or null when it does. */
  disabled?(env: SettingsEnv): string | null;
  /** An action's work: its result line for the player (or a thrown Error's message). */
  run?(env: SettingsEnv): Promise<string>;
  /** An action's question before it runs (the player can decline), or null. */
  confirm?(env: SettingsEnv): string | null;
  /** A destructive action: a danger button, and its question's YES too. */
  danger?(env: SettingsEnv): boolean;
}

const THEMES: readonly ThemeMode[] = ['system', 'dark', 'light'];

/** The OPTIONS app's row for a DS option. */
function dsRow(env: SettingsEnv, key: keyof DeviceOptions): { row: OptionsView['rows'][number]; index: number } {
  const index = env.view.rows.findIndex((r) => r.key === key);
  if (index < 0) throw new Error(`ui: the OPTIONS app has no ${key} row`);
  return { row: env.view.rows[index]!, index };
}

/** A DS option (the app's row): the DS's saved ones go in the save (game.ts), text speed and the modern options stay on the device. */
function dsOption(key: keyof DeviceOptions, section: SectionId, kind: 'choice' | 'stepper', group?: GroupId): Setting {
  const storage = isSavedOption(key) ? 'save' : 'device';
  return {
    id: key,
    section,
    ...(group ? { group } : {}),
    kind,
    storage,
    available: () => true,
    disabled: (env) => (storage === 'save' && env.where === 'title' ? S.options.needsGame : null),
    label: (env) => dsRow(env, key).row.label,
    description: (env) => dsRow(env, key).row.description,
    values: (env) => dsRow(env, key).row.values,
    get: (env) => dsRow(env, key).row.value,
    set: (env, v) => env.tap(`value:${dsRow(env, key).index}:${v}`),
    step: (env, delta) => env.tap(`step:${dsRow(env, key).index}:${delta}`),
  };
}

/** ON and OFF in the pack's words (the BATTLE SCENE row's: 0 on, 1 off). */
const onOff = (env: SettingsEnv) => dsRow(env, 'battleScene').row.values;

/** A DATA row: one button. */
function action(id: string, label: () => string, button: (env: SettingsEnv) => string, description: (env: SettingsEnv) => string, run: Setting['run'], extra: Partial<Setting> = {}): Setting {
  return {
    id,
    section: 'data',
    kind: 'action',
    storage: 'none',
    available: () => true,
    label,
    description,
    values: (env) => [button(env)],
    get: () => 0,
    set: () => {},
    run,
    ...extra,
  };
}

/** The Controls row waiting for a key or a pad button (its button says so), or null. */
let binding: Action | null = null;

/** Binds what the player pressed to an action; the result line names a swap with the action that had it. */
function bindCaptured(action: Action, got: Captured): string {
  const { result, error } = controls.edit((b) => (got.kind === 'key' ? bindKey(b, action, got.code) : bindPad(b, got.raw, got.face, action, got.token)));
  const b = controls.bindings;
  const what = got.kind === 'key' ? keyLabel(got.code) : padLabel(got.token, got.raw, got.face);
  let text = S.options.bound(actionLabel(action), what);
  if (result.holder) {
    const now = got.kind === 'key' ? b.keys[result.holder].map(keyLabel).join(', ') : padLabel((got.raw ? b.raw : b.pad)[result.holder], got.raw, got.face);
    text += S.options.swapped(actionLabel(result.holder), now || S.options.noKey);
  }
  return error ? S.options.keptForVisit(text, error) : text;
}

/** Where the bindings' groups start (the rows after each stay in it). */
const BIND_GROUPS: Partial<Record<Action, GroupId>> = { up: 'dpad', a: 'face', l: 'other' };

/** A Controls row: one action's keys and gamepad button; A, then press the new key or button. */
function bindRow(a: (typeof ACTIONS)[number]): Setting {
  const group = BIND_GROUPS[a.id];
  return {
    id: `bind/${a.id}`,
    section: 'controls',
    ...(group ? { group } : {}),
    kind: 'action',
    storage: 'device',
    available: () => true,
    label: () => actionLabel(a.id),
    description: () => (binding === a.id ? S.options.bindWaiting : S.options.bindText),
    values: () => [binding === a.id ? S.options.pressKey : bindingText(controls.bindings, a.id, controls.padRaw, controls.face)],
    get: () => 0,
    set: () => {},
    run: async () => {
      binding = a.id;
      try {
        const got = await controls.capture(window, () => (typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : []));
        return got ? bindCaptured(a.id, got) : '';
      } finally {
        binding = null;
      }
    },
  };
}

/** The second line of the CONTROLLER row's description: what AUTO found. */
function autoLine(): string {
  const found = controls.detected;
  if (found === null) return S.options.autoFollows;
  return found === 'generic' ? S.options.autoNoName : S.options.autoFound(found.toUpperCase());
}

/** Rows that need the imported ROM (not in dev-pack runs). */
const hasRom = (env: SettingsEnv) => !!env.data.rom;

export const SETTINGS: readonly Setting[] = [
  // GAME: the DS's own six, in the DS's order.
  dsOption('textSpeed', 'game', 'choice', 'platinum'),
  dsOption('sound', 'game', 'choice', 'platinum'),
  dsOption('battleScene', 'game', 'choice', 'platinum'),
  dsOption('battleStyle', 'game', 'choice', 'platinum'),
  dsOption('buttonMode', 'game', 'choice', 'platinum'),
  dsOption('frame', 'game', 'stepper', 'platinum'),
  // The QoL additions that change what the game offers (OpenSinnoh, not Platinum; docs/decisions.md).
  dsOption('repelPrompt', 'game', 'choice', 'additions'),
  dsOption('followerTalk', 'game', 'choice', 'additions'),
  dsOption('statView', 'game', 'choice', 'additions'),
  dsOption('summaryRename', 'game', 'choice', 'additions'),
  dsOption('dexNameSearch', 'game', 'choice', 'additions'),
  dsOption('spiritombVendors', 'game', 'choice', 'additions'),
  dsOption('objective', 'game', 'choice', 'additions'),
  // Repeat play: NEW GAME offers to skip Rowan's intro once this device has finished it (OpenSinnoh, title/intro-skip.ts).
  {
    id: 'introSkip',
    group: 'additions',
    section: 'game',
    kind: 'toggle',
    storage: 'device',
    available: () => true,
    label: () => S.options.introSkip,
    description: () => S.options.introSkipText,
    values: onOff,
    get: () => (introSkipOn() ? 0 : 1),
    set: (_env, v) => {
      const err = setIntroSkip(v === 0);
      if (err) console.warn(`intro skip: the setting is not stored: ${err}`);
    },
  },
  // DEVICE: this device's zoom (`lantern-nds:zoom`): Auto, or a whole scale this window can show.
  {
    id: 'zoom',
    group: 'display',
    section: 'device',
    kind: 'stepper',
    storage: 'device',
    available: (env) => !!env.zoom,
    label: () => S.options.zoom,
    description: () => S.options.zoomText,
    values: (env) => zoomValues(env).map((z) => (z === 'auto' ? S.options.auto : zoomLabel(z))),
    get: (env) => zoomValues(env).indexOf(env.zoom!.get()),
    set: (env, v) => env.zoom!.set(zoomValues(env)[v]!),
  },
  // The field's 3D resolution (`lantern-nds:render-scale`): Auto caps phones at 2 device px per CSS px.
  {
    id: 'renderScale',
    group: 'display',
    section: 'device',
    kind: 'choice',
    storage: 'device',
    available: (env) => !!env.renderScale,
    label: () => S.options.renderScale,
    description: () => S.options.renderScaleText,
    values: () => [S.options.auto, S.options.full],
    get: (env) => RENDER_SCALES.indexOf(env.renderScale!.get()),
    set: (env, v) => env.renderScale!.set(RENDER_SCALES[v]!),
  },
  // The visual style (`lantern-nds:visual-style`, visuals.ts): the DS look, or the enhanced visuals. Presentation only.
  {
    id: 'visualStyle',
    group: 'display',
    section: 'device',
    kind: 'choice',
    storage: 'device',
    available: (env) => !!env.visuals,
    label: () => S.options.visualStyle,
    description: (env) =>
      env.visuals!.eased()
        ? S.options.visualStyleEased
        : env.visuals!.get().style === 'cinematic' && env.visuals!.phone
          ? S.options.visualStyleHeavy
          : S.options.visualStyleText,
    values: () => S.options.styles,
    get: (env) => VISUAL_STYLES.indexOf(env.visuals!.get().style),
    set: (env, v) => env.visuals!.set({ ...env.visuals!.get(), style: VISUAL_STYLES[v]! }),
  },
  // The menu style (`lantern-nds:menu-style`, menu-style.ts): the same menus in OpenSinnoh's own style. Presentation only.
  {
    id: 'menuStyle',
    section: 'device',
    group: 'display',
    kind: 'choice',
    storage: 'device',
    available: () => true,
    label: () => S.options.menus,
    description: () => (readMenuStyle() === 'modern' ? S.options.menusModern : S.options.menusOriginal),
    values: () => S.options.menuStyles,
    get: () => MENU_STYLES.indexOf(readMenuStyle()),
    set: (_env, v) => {
      const err = storeMenuStyle(MENU_STYLES[v]!);
      if (err) console.warn(`menus: the setting is kept for this visit only: ${err}`);
    },
  },
  // The angled camera (`lantern-nds:angled-camera`): outdoors only, the DS camera in caves, buildings and fog.
  {
    id: 'angledCamera',
    group: 'display',
    section: 'device',
    kind: 'toggle',
    storage: 'device',
    available: (env) => !!env.visuals,
    label: () => S.options.angledCamera,
    description: () => S.options.angledCameraText,
    values: onOff,
    get: (env) => (env.visuals!.get().angledCamera ? 0 : 1),
    set: (env, v) => env.visuals!.set({ ...env.visuals!.get(), angledCamera: v === 0 }),
  },
  // Reduce flashing (`lantern-nds:reduce-flashing`, flashing.ts): follows the system's reduce-motion until chosen. Presentation only.
  {
    id: 'reduceFlashing',
    group: 'display',
    section: 'device',
    kind: 'toggle',
    storage: 'device',
    available: () => true,
    label: () => S.options.reduceFlashing,
    description: () => S.options.reduceFlashingText,
    values: onOff,
    get: () => (flashingOn() ? 0 : 1),
    set: (_env, v) => {
      const err = chooseFlashing(v === 0);
      if (err) console.warn(`flashing: the setting is kept for this visit only: ${err}`);
    },
  },
  action('fullscreen', () => S.options.fullscreen, (env) => (env.fullscreen!.active() ? S.options.on : S.options.off), () => S.options.fullscreenText, async (env) => (await env.fullscreen!.run(), ''), { section: 'device', group: 'display', available: (env) => !!env.fullscreen }),
  // This device's volume and mute (WebAudio settings, `lantern-nds:audio`).
  {
    id: 'volume',
    group: 'sound',
    section: 'device',
    kind: 'slider',
    storage: 'device',
    available: (env) => !!env.audio,
    label: () => S.options.volume,
    description: () => S.options.volumeText,
    values: () => [],
    get: (env) => env.audio!.get().volume,
    set: (env, volume) => env.audio!.set({ ...env.audio!.get(), volume }),
    range: { min: 0, max: 100, step: 10 },
  },
  {
    id: 'mute',
    group: 'sound',
    section: 'device',
    kind: 'toggle',
    storage: 'device',
    available: (env) => !!env.audio,
    label: () => S.options.mute,
    description: () => S.options.muteText,
    values: onOff,
    get: (env) => (env.audio!.get().muted ? 0 : 1),
    set: (env, v) => env.audio!.set({ ...env.audio!.get(), muted: v === 0 }),
  },
  // The fast-forward speed (`lantern-nds:speed`).
  {
    id: 'speed',
    group: 'play',
    section: 'device',
    kind: 'choice',
    storage: 'device',
    available: (env) => !!env.speed,
    label: () => S.options.speed,
    description: () => S.options.speedText,
    values: (env) => env.speed!.choices().map((n) => `${n}x`),
    get: (env) => env.speed!.choices().indexOf(env.speed!.get()),
    set: (env, v) => env.speed!.set(env.speed!.choices()[v]!),
  },
  // Following Pokémon (a DS-model row) and how a stopped follower stands.
  dsOption('followers', 'device', 'choice', 'play'),
  dsOption('followerStyle', 'device', 'choice', 'play'),
  // The player's look in the field: Platinum's, or the HGSS add-on's Ethan or Lyra.
  dsOption('character', 'device', 'choice', 'play'),
  // Naming keyboard: lowercase after the first capital (OpenSinnoh, not Platinum).
  dsOption('autoLowercase', 'device', 'choice', 'play'),
  // The modern trade-evolution rule (a DS-model row).
  dsOption('tradeEvolution', 'device', 'choice', 'play'),
  // OpenSinnoh's own screens: light or dark by the system, or always one (`lantern-nds:theme`, @opensinnoh/ui).
  {
    id: 'theme',
    group: 'appearance',
    section: 'device',
    kind: 'choice',
    storage: 'device',
    available: () => true,
    label: () => S.options.theme,
    description: () => S.options.themeText,
    values: () => S.options.themes,
    get: () => THEMES.indexOf(themeMode()),
    set: (_env, v) => setThemeMode(THEMES[v]!),
  },
  // The frame of OpenSinnoh's own windows (`lantern-nds:ui-frame`, @opensinnoh/ui); the game's message box keeps FRAME.
  {
    id: 'uiFrame',
    group: 'appearance',
    section: 'device',
    kind: 'choice',
    storage: 'device',
    available: () => true,
    label: () => S.options.windows,
    description: () => S.options.windowsText,
    values: () => WINDOW_FRAMES.map((f) => f.toUpperCase()),
    get: () => WINDOW_FRAMES.indexOf(frameMode()),
    set: (_env, v) => setFrameMode(WINDOW_FRAMES[v]!),
  },
  // The touch controls (this device, `lantern-nds:phone`): their size and how opaque they are.
  {
    id: 'controlSize',
    group: 'touch',
    section: 'device',
    kind: 'choice',
    storage: 'device',
    available: (env) => !!env.phone?.touch,
    label: () => S.options.controlSize,
    description: () => S.options.controlSizeText,
    values: () => CONTROL_SIZES.map((c) => c.label),
    get: (env) => env.phone!.get().size,
    set: (env, v) => env.phone!.set({ ...env.phone!.get(), size: v }),
  },
  {
    id: 'controlOpacity',
    group: 'touch',
    section: 'device',
    kind: 'slider',
    storage: 'device',
    available: (env) => !!env.phone?.touch,
    label: () => S.options.controlOpacity,
    description: () => S.options.controlOpacityText,
    values: () => [],
    get: (env) => env.phone!.get().opacity,
    set: (env, opacity) => env.phone!.set({ ...env.phone!.get(), opacity: Math.max(OPACITY_MIN, opacity) }),
    range: OPACITY_RANGE,
  },
  {
    id: 'haptics',
    group: 'touch',
    section: 'device',
    kind: 'toggle',
    storage: 'device',
    available: (env) => !!env.phone?.haptics,
    label: () => S.options.haptics,
    description: () => S.options.hapticsText,
    values: onOff,
    get: (env) => (env.phone!.get().haptics ? 0 : 1),
    set: (env, v) => env.phone!.set({ ...env.phone!.get(), haptics: v === 0 }),
  },
  {
    id: 'keepAwake',
    group: 'touch',
    section: 'device',
    kind: 'toggle',
    storage: 'device',
    available: (env) => !!env.phone?.wakeLock,
    label: () => S.options.keepAwake,
    description: () => S.options.keepAwakeText,
    values: onOff,
    get: (env) => (env.phone!.get().keepAwake ? 0 : 1),
    set: (env, v) => env.phone!.set({ ...env.phone!.get(), keepAwake: v === 0 }),
  },
  // CONTROLS: running without B and the item wheel on a held Y (OpenSinnoh), then this device's keyboard and gamepad bindings (`lantern-nds:controls`, controls.ts).
  dsOption('autoRun', 'controls', 'choice', 'play'),
  dsOption('itemWheel', 'controls', 'choice', 'play'),
  ...ACTIONS.map(bindRow),
  {
    id: 'padLayout',
    group: 'setup',
    section: 'controls',
    kind: 'stepper',
    storage: 'device',
    available: () => true,
    label: () => S.options.controller,
    description: () => S.options.controllerText(autoLine()),
    values: () => PAD_LAYOUTS.map((l) => l.toUpperCase()),
    get: () => PAD_LAYOUTS.indexOf(controls.bindings.layout),
    set: (_env, v) => void controls.setLayout(PAD_LAYOUTS[v]!),
  },
  {
    id: 'deadZone',
    group: 'setup',
    section: 'controls',
    kind: 'slider',
    storage: 'device',
    available: () => true,
    label: () => S.options.deadZone,
    description: () => S.options.deadZoneText,
    values: () => [],
    get: () => controls.bindings.deadZone,
    set: (_env, v) => void controls.setDeadZone(v),
    range: { min: 0, max: 100, step: 10 },
  },
  {
    id: 'resetControls',
    group: 'setup',
    section: 'controls',
    kind: 'action',
    storage: 'none',
    available: () => true,
    label: () => S.options.resetControls,
    description: () => S.options.resetControlsText,
    values: () => [S.options.reset],
    get: () => 0,
    set: () => {},
    run: async () => {
      const error = controls.reset();
      return error ? S.options.keptForVisit(S.options.controlsReset, error) : S.options.controlsReset;
    },
  },
  // DATA: the save file, the imported game, the optional HeartGold/SoulSilver follower art, and the mods.
  action('exportSave', () => S.options.exportSave, () => S.options.export, () => S.options.exportSaveText, (env) => env.data.exportSave(), { group: 'saves' }),
  action(
    'importSave',
    () => S.options.importSave,
    () => S.options.chooseFile,
    (env) => (env.where === 'title' ? S.options.importSaveTitle : S.options.importSaveGame),
    (env) => env.data.importSave((q) => env.ask(q)),
    { group: 'saves' },
  ),
  // The suspend point (suspend.ts): the game is kept when the app is hidden; CONTINUE picks up there once.
  {
    id: 'suspend',
    group: 'saves',
    section: 'data',
    kind: 'toggle',
    storage: 'device',
    available: () => true,
    label: () => S.options.suspend,
    description: () => S.options.suspendText,
    values: onOff,
    get: () => (suspendOn() ? 0 : 1),
    set: (_env, v) => {
      const err = setSuspendOn(v === 0);
      if (err) console.warn(`suspend: the setting is not stored: ${err}`);
    },
  },
  action('install', () => S.options.install, () => S.options.installButton, () => S.options.installText, (env) => env.install!.run(), { group: 'app', available: (env) => !!env.install?.available() }),
  action(
    'update',
    () => S.options.update,
    () => S.options.restart,
    () => S.options.updateText,
    async (env) => {
      await env.update!.apply();
      return S.options.restarting;
    },
    { group: 'app', available: (env) => !!env.update?.waiting(), confirm: (env) => (env.where === 'game' ? S.options.updateConfirm : null) },
  ),
  action('storage', () => S.options.storage, () => S.options.keepData, (env) => env.data.rom!.storage.line(), (env) => env.data.rom!.storage.keep(), { group: 'gameData', available: hasRom }),
  action('reimport', () => S.options.reimport, () => S.options.chooseRom, () => S.options.reimportText, (env) => env.data.rom!.reimport(), { group: 'gameData', available: hasRom }),
  action(
    'addon',
    () => S.options.addon,
    (env) => (env.data.rom!.addon ? S.options.remove : S.options.add),
    (env) => (env.data.rom!.addon ? S.options.addonOn(env.data.rom!.addon.replace(/ \(.*\)$/, '')) : S.options.addonOff),
    (env) => (env.data.rom!.addon ? env.data.rom!.removeAddon() : env.data.rom!.addAddon()),
    { group: 'gameData', available: hasRom, danger: (env) => !!env.data.rom!.addon, confirm: (env) => (env.data.rom!.addon ? S.options.addonConfirm : null) },
  ),
  action(
    'deleteRom',
    () => S.options.deleteRom,
    () => S.options.delete,
    () => S.options.deleteRomText,
    (env) => env.data.rom!.remove(),
    { group: 'gameData', available: hasRom, danger: () => true, confirm: () => S.options.deleteRomConfirm },
  ),
  // PRIVACY: anonymous error reports (`lantern-nds:error-reports`).
  {
    id: 'reports',
    section: 'privacy',
    kind: 'toggle',
    storage: 'device',
    available: (env) => !!env.reports,
    label: () => S.options.reports,
    description: () => S.options.reportsText,
    values: onOff,
    get: (env) => (env.reports!.get() ? 0 : 1),
    set: (env, v) => env.reports!.set(v === 0),
  },
];

/** The mods the packs offer: one DATA row each, after the fixed ones (`mod/<id>`: a tap id splits on colons). */
function modSettings(env: SettingsEnv): Setting[] {
  return env.data.mods.list().map((mod) =>
    action(
      `mod/${mod.id}`,
      () => S.options.mod(mod.name).slice(0, 14),
      (e) => (e.data.mods.list().find((m) => m.id === mod.id)?.on ? S.options.on : S.options.off),
      () => S.options.modText,
      (e) => e.data.mods.set(mod.id, !e.data.mods.list().find((m) => m.id === mod.id)!.on),
      {
        group: 'mods',
        disabled: (e) => (e.where === 'title' ? S.options.modTitle : null),
        confirm: () => S.options.modConfirm,
      },
    ),
  );
}

/** The zoom choices for this window; a stored scale it cannot show is listed as it is (it applies clamped). */
function zoomValues(env: SettingsEnv): Zoom[] {
  const choices = env.zoom!.choices();
  const now = env.zoom!.get();
  return choices.includes(now) ? choices : [...choices, now];
}

/** Every setting this run has, the mods last in DATA (they change with the packs). */
export function allSettings(env: SettingsEnv): Setting[] {
  const after = SETTINGS.findIndex((s) => s.section === 'privacy');
  return [...SETTINGS.slice(0, after), ...modSettings(env), ...SETTINGS.slice(after)];
}

/** The sections this run has settings for, each with its settings in order. */
export function pages(env: SettingsEnv, settings: readonly Setting[] = allSettings(env)): { section: (typeof SECTIONS)[number]; settings: Setting[] }[] {
  return SECTIONS.map((section) => ({ section, settings: settings.filter((s) => s.section === section.id && s.available(env)) })).filter((p) => p.settings.length);
}

/** A page's rows under their headings, in page order; '' is no heading (a page of one row needs none). */
export function grouped(settings: readonly Setting[]): { label: string; settings: Setting[] }[] {
  const out: { id: GroupId | undefined; label: string; settings: Setting[] }[] = [];
  for (const s of settings) {
    const last = out.at(-1);
    if (last && (s.group === undefined || s.group === last.id)) last.settings.push(s);
    else out.push({ id: s.group, label: s.group ? S.options.groups[s.group] : '', settings: [s] });
  }
  return out;
}

/** One step of a setting: choices wrap, a slider stops at its ends; an action only runs on A. */
export function stepSetting(env: SettingsEnv, s: Setting, delta: 1 | -1): void {
  if (s.kind === 'action') return;
  if (s.disabled?.(env)) return;
  if (s.step) return s.step(env, delta);
  const v = s.get(env);
  if (s.kind === 'slider') {
    const r = s.range!;
    const next = Math.min(r.max, Math.max(r.min, v + delta * r.step));
    if (next !== v) s.set(env, next);
    return;
  }
  const n = s.values(env).length;
  s.set(env, (v + delta + n) % n);
}
