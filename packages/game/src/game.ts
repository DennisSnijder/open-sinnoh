/**
 * Game composition: packs → registries/labels, GameState, VM + world, the fixed 30 Hz tick, saves.
 * Headless: no DOM. The app (packages/app) renders `world` and `scripts.view()` and drives input.
 */
import { DAY_PERIODS, dayPeriod, monGender, undergroundDaily, checkClock, dailyEvents, DEFAULT_CLOCK, elapseHoneyTrees, elapsePokerus, fieldSeed, hasFieldSystems, newDailyRandom, emptyBag, emptyDaycare, evolutionTarget, heal, Prng, withClock, type VillaDaily, type Button, type ClockTime, type Id, type LabelOverride, type PackData } from '@opensinnoh/core';
import {
  BOX_SIZE,
  DEFAULT_DEVICE_OPTIONS,
  dexOf,
  levelEvolutionTrigger,
  DEFAULT_WALLPAPERS,
  PLAY_HOURS_MAX,
  firstFreeBox,
  markCaught,
  newPoketchState,
  newRoamerState,
  poketchRuns,
  markSeen,
  newGameRecord,
  newFashionCase,
  newSealCase,
  newTvState,
  tvCatch,
  tvDaily,
  tvTimeSlot,
  DRESS_UP_PHOTOS,
  storeInBox,
  trainerIdFor,
  type AppHost,
  type AppModel,
  type AppView,
  type Battle,
  type BattleChoice,
  type BattleLogEntry,
  type BattleResult,
  type BattleSetup,
  type CreateApp,
  type CreateBattle,
  type CreateContestMoveAnimation,
  type CreatePoketch,
  type CreateScriptRunner,
  type CreateWorld,
  type DeviceOptions,
  type GameSnapshot,
  type GameState,
  type InputFrame,
  type Labels,
  type MapEntry,
  type MapPopupView,
  type BlackOutView,
  isSavedOption,
  parseTextMarkup,
  type PoketchModel,
  type PoketchView,
  type NewGame,
  type Registries,
  type SaveEnvelope,
  type ScriptRunner,
  type WildBattleMode,
  type EvolutionMode,
  type World,
  type AudioOutput,
  JOURNAL_EVENT,
  isWildKind,
  journalDate,
  journalOpensOnContinue,
  journalOwned,
  openJournalPage,
  type JournalDate,
  journalEvent,
  journalMon,
  journalTrainer,
} from '@opensinnoh/contracts';
import { elapseBerryMinutes, newBerryPatches, scoreBattle, scoreCatch, shayminClockRevert, shayminToLand } from '@opensinnoh/services';
import { repelPrompt } from './repel-prompt.ts';
import { followerTalk } from './follower-talk.ts';
import { digDestination, fieldMoveError, fieldMoveStart, flyDestination, isTaskMove, teleportDestination, usableFieldMoves } from './field-moves.ts';
import { applyButtonMode, InputState } from './input.ts';
import { fieldItemCheck, useFieldItem, useRegisteredItem } from './field-items.ts';
import { MapPopupState } from './map-popup.ts';
import { loadGamePacks, savedPacks } from './packs.ts';
import { canonicalState, cloneState, encounterSeed, validateSave } from './save.ts';
import { SoundSystem } from './sound.ts';
import { battleBgm, redHp, SEQ_SE_DP_HINSI, victoryBgm } from './battle-music.ts';
import { clockChanged, newGameTime, updateGameTime } from './game-time.ts';
import { CountingStubLog } from './stub-log.ts';
import { clearGameSave, continueAtStart, saveScreenStep, startClearGame, type ClearPhase } from './clear-game.ts';

export interface NewGameOptions {
  names: { player: string; rival: string };
  gender: 'male' | 'female';
}

/** Text speed option (decomp enum OptionsTextSpeed): slow, mid, fast. */
export type TextSpeedOption = 0 | 1 | 2;
/** Frames per character for each option (decomp Options_TextFrameDelay: TEXT_SPEED_SLOW 8, NORMAL 4, FAST 1). */
export const TEXT_FRAME_DELAY: Record<TextSpeedOption, number> = { 0: 8, 1: 4, 2: 1 };

export interface GameOptions {
  packs: readonly PackData[];
  createWorld: CreateWorld;
  createScriptRunner: CreateScriptRunner;
  /** The battle engine (packages/battle), given directly (headless) … */
  createBattle?: CreateBattle;
  /** … or loaded on the first battle (the app's lazy chunk). The game does not tick while it loads. */
  loadBattle?: () => Promise<CreateBattle>;
  /**
   * The contests' move animations (packages/battle `createContestMoveAnimation`), given directly (headless) or loaded
   * with the battle engine's chunk: the contest app does not tick while it loads. Without either, acts have none.
   */
  createContestAnimation?: CreateContestMoveAnimation;
  loadContestAnimation?: () => Promise<CreateContestMoveAnimation>;
  /**
   * The menu apps (packages/menus `createApp`). With it, X or Start on an idle field opens the start
   * menu and script ops open apps; without it the game has no menus and a script that opens an app throws.
   */
  createApp?: CreateApp;
  /**
   * The device: its stored options and where the start menu's SAVE writes. Default: options in memory
   * (the DS defaults) and a save that is only validated (headless runs have no save slot).
   */
  device?: GameDevice;
  seed: number;
  /** Overrides the newGame record's names and gender (the naming screen). */
  newGame?: NewGameOptions;
  log?: CountingStubLog;
  /** Clock for `savedAt` only; never used by game logic. */
  now?: () => string;
  /** The device's text speed option (default mid, the DS default). Not saved: replays print at mid. */
  textSpeed?: TextSpeedOption;
  /**
   * The game clock (the DS RTC): the app passes the device's local time; default frozen at DEFAULT_CLOCK
   * (headless runs, tests and replays). Game logic reads the clock only through this.
   */
  clock?: () => ClockTime;
  /** Where the sound system sends what to play (the app's AudioWorklet synth); none headless. */
  audio?: AudioOutput;
  /**
   * The Pokétch (packages/menus `createPoketch`): stepped on every field tick while it runs (enabled, an
   * app registered, not hidden), with the panel touch. Without it the game has no Pokétch device (its state
   * still counts steps).
   */
  createPoketch?: CreatePoketch;
}

export interface GameDevice {
  options(): DeviceOptions;
  setOption(key: keyof DeviceOptions, value: number): void;
  /** Writes a save made from the start menu; throws a player-facing Error when it cannot. */
  persist(save: SaveEnvelope): void;
}

/** Device options in memory (the contract defaults, or these), saves validated only (headless runs). */
export function memoryDevice(set: Partial<DeviceOptions> = {}): GameDevice {
  const options = { ...DEFAULT_DEVICE_OPTIONS, ...set };
  return {
    options: () => options,
    setOption: (key, value) => void (options[key] = value),
    persist: () => {},
  };
}

/** A tick with nothing pressed (the field while a talk holds the player). */
const NO_INPUT: InputFrame = { held: [], pressed: [], touch: null };
/** The item wheel (OpenSinnoh): Y held this many ticks on the idle field opens it. */
const WHEEL_HOLD = 8;

/** decomp SEQ_SE_DP_WIN_OPEN: the start menu opening (FieldSystem_ShowStartMenu → StartMenu_Init). */
const SEQ_SE_DP_WIN_OPEN = 1533;

/** Buttons that open the start menu on an idle field (decomp FieldInput: X; Start too, here). */
const OPENS_MENU = ['x', 'start'] as const;
/**
 * Apps drawn over the running field map (decomp field tasks: the start menu, the save prompt, the shop, the
 * Underground's menus; OpenSinnoh's item wheel). Every other app replaces the field map (FieldMap_Exit), which stops
 * the weather's sound.
 */
const FIELD_APPS: ReadonlySet<string> = new Set(['start-menu', 'save', 'mart', 'ug-menu', 'ug-vendor', 'ug-trap', 'ug-base', 'ug-pc', 'item-wheel']);
/** The blackout screen's fades (decomp sub_020529C4: StartScreenFade 8 steps of 1 frame each way; ExecScreenFade runs once a tick). */
const BLACK_OUT_FADE = 8;

export interface Game {
  readonly registries: Registries;
  readonly labels: Labels;
  readonly loadOrder: readonly { id: string; version: string }[];
  readonly overrides: readonly LabelOverride[];
  readonly log: CountingStubLog;
  /** The live, mutable state shared by the VM and the world. */
  readonly state: GameState;
  readonly world: World;
  readonly scripts: ScriptRunner;
  /** Battles so far (real, and the VM's logged stubs). Not saved: a new game clears it, loading a save keeps it. */
  readonly battles: readonly BattleLogEntry[];
  /** The running battle (battle mode: the field and VM do not tick), null in the field or while the engine loads. */
  readonly battle: Battle | null;
  /** A battle was started and has not ended (it may still be loading its engine). */
  inBattle(): boolean;
  /** The setup of the battle started and not ended (the app preloads its art from it), else null. */
  battleSetup(): BattleSetup | null;
  /** Answers the running battle's prompt (`Battle.choose`); throws when no battle waits. */
  battleChoose(choice: BattleChoice): void;
  /**
   * Wild encounters battle (default), flee without a battle (replay `wild flee`), or battle
   * and are fought by the replay's waits (`wild auto`; the game itself treats it as `battle`). `reset` restores `battle`.
   */
  wildBattles: WildBattleMode;
  /** How the replay's waits treat the evolution scene (replay `evolve …`; `reset` restores `manual`). Not game logic. */
  evolutions: EvolutionMode;
  /** Resolves once the battle engine (and the contests' move animations) are loaded (starting the load if needed); replays call it up front. */
  loadBattleEngine(): Promise<void>;
  press(button: Button): void;
  release(button: Button): void;
  touch(x: number, y: number): void;
  untouch(): void;
  /** Taps an element of the open menu app on the next tick (`InputFrame.tap`). */
  tap(id: string): void;
  /** The open menu app's view, or null. While an app is open the field and the VM do not step. */
  app(): AppView | null;
  /** The map-name popup over the field, or null (not saved). */
  mapPopup(): MapPopupView | null;
  /** The blackout screen (0.19.0), or null. */
  blackOutScreen(): BlackOutView | null;
  /** What the Pokétch shows, or null while it does not run (not enabled, no app, hidden) or the game has none. */
  poketch(): PoketchView | null;
  /** One 30 Hz tick: input → triggers → vm.step → world.step. */
  tick(): void;
  /** One tick with an input frame sampled elsewhere (the app's own input sources); same order as `tick`. */
  step(frame: InputFrame): void;
  advance(ticks: number): void;
  snapshot(): GameSnapshot;
  /** No script runs, the world is idle and no menu app is open. */
  canSave(): boolean;
  /** Throws while a script runs, the world is busy or a menu app is open. */
  save(): SaveEnvelope;
  /**
   * Validates strictly (shape, pack set, ids) and re-enters the saved map as a loaded save (decomp
   * FieldTask_LoadSavedGameMap). `arrival` enters it as a map change instead (the replay `warp` setup).
   */
  load(envelope: unknown, entry?: MapEntry): void;
  /**
   * The player's CONTINUE from the title, after `load` (decomp FieldTask_LoadSavedGameMap): the roamers scatter
   * (World `continued`). Replays and their save round trips load without it.
   */
  onContinue(): void;
  /**
   * 0.30.0. Opens Mystery Gift over the idle field: the screen the title's MYSTERY GIFT runs on the save, for replays
   * (`open mystery-gift`), which cannot reach the title. Throws when a script, an app or the world is busy.
   */
  openMysteryGift(): void;
  /** Fresh new game (same packs), with a new seed and new names/gender if given (kept for later resets). */
  reset(seed?: number, newGame?: NewGameOptions): void;
  /**
   * The save `clear_game` wrote (what the title's CONTINUE loads after the reset), or null. Once the clear's
   * credits end the game has reset (snapshot `reset`): it no longer ticks until a load or a new game.
   */
  resetSave(): SaveEnvelope | null;
  /** The clear's credits have ended: the game has reset (snapshot `reset`). */
  hasReset(): boolean;
  /** The text speed option; applies from the next message. */
  textSpeed: TextSpeedOption;
  /** The game clock now (the option's clock, or the frozen one `setClock` set). */
  clock(): ClockTime;
  /**
   * Freezes the clock at a date (`yyyy-mm-dd`) and/or time (`hh:mm`, seconds 0); the other part stays as
   * the clock reads now. Kept until the next `reset`, which restores the option's clock (replay `date`/`time`).
   */
  setClock(date?: string, time?: string): void;
  /** The sound system (contracts `AudioHost`); deterministic, it runs headless too. */
  readonly sound: SoundSystem;
  /** Where the sound system sends what to play (set by the app once its audio exists). */
  audioOutput: AudioOutput | null;
  /**
   * Uses a party Pokémon's field move as from the party menu (decomp FieldMoves_SetUsableMoves, then the
   * `FIELD_MOVES` script, which starts on the next tick). Throws when it is not usable now. Fly needs the Town Map's
   * chosen location (`TownMap.locations` index); Fly and Teleport start the world's field task.
   */
  useFieldMove(slot: number, move: Id, location?: number): void;
  /** The field moves usable now, per party slot (what the party menu would offer). */
  usableFieldMoves(): { slot: number; move: Id }[];
}

/**
 * A new game's state. The weather is the start zone's header weather (the world resolves yearly values on
 * entry). The trainer id comes from the seed through its own mix (decomp: a random u32 at new game), so
 * the main stream starts where it always did. The clock fields start at `now` (decomp GameTime_Clear); the
 * daily random takes the field stream's first draw (decomp InitializeNewSave: RecordMixedRNG's
 * player override seeded from MTRNG_Next).
 */
export function newGameState(record: NewGame, registries: Pick<Registries, 'zones' | 'texts'>, order: readonly { id: string; version: string }[], seed: number, options?: NewGameOptions, now: ClockTime = DEFAULT_CLOCK): GameState {
  const zone = registries.zones.get(record.zone);
  if (!zone) throw new Error(`newGame ${record.id}: unknown zone ${record.zone}`);
  const boxes = record.boxNames.map((text, i) => {
    const name = registries.texts.get(text);
    if (!name) throw new Error(`newGame ${record.id}: unknown box name text ${text}`);
    return { name: name.text, wallpaper: i % DEFAULT_WALLPAPERS, slots: Array.from({ length: BOX_SIZE }, () => null) };
  });
  const fieldRng = new Prng(fieldSeed(seed));
  const dailyRandom = newDailyRandom(fieldRng.next());
  return {
    schemaVersion: 23,
    packs: order.map((p) => ({ ...p })),
    names: { ...(options?.names ?? record.names) },
    gender: options?.gender ?? record.gender,
    trainerId: trainerIdFor(seed),
    flags: {},
    vars: {},
    party: [],
    boxes,
    currentBox: 0,
    money: record.money,
    bag: emptyBag(record.pockets),
    player: { zone: record.zone, x: record.x, z: record.z, y: 0, facing: record.facing },
    objects: [],
    hasPartner: false, runningShoes: false,
    follower: null,
    rng: new Prng(seed).save(),
    fieldRng: fieldRng.save(),
    seed,
    encounterRng: new Prng(encounterSeed(seed)).save(),
    badges: [],
    pokedex: { obtained: false, national: false, seen: [], caught: [], forms: {} },
    poketch: newPoketchState(),
    playerState: 'walk',
    cyclingGear: 0,
    weather: zone.weather,
    specialLocation: null,
    previousZone: null,
    platformLift: null,
    mapFeatures: null,
    gameTime: { ...newGameTime(now), dailyRandom },
    tick: 0,
    startDate: now.date,
    playTime: { hours: 0, minutes: 0, seconds: 0 },
    coins: 0,
    registeredItem: null,
    wallpapersUnlocked: 0,
    repel: 0,
    records: { score: 0, hallOfFame: null, timesLinked: 0, linkBattleWins: 0, linkBattleLosses: 0, linkTrades: 0, counts: {} },
    signature: null,
    options: savedOptions(DEFAULT_DEVICE_OPTIONS),
    daycare: emptyDaycare(),
    roamers: newRoamerState(),
    hallOfFame: { total: 0, entries: [] },
    berryPatches: record.berries ? newBerryPatches(record.berries) : [],
    poffins: [],
    fashionCase: newFashionCase(),
    sealCase: newSealCase(),
    contestPhotos: [null, null, null, null, null],
    journal: [],
    tv: newTvState(),
    dressUpPhotos: Array.from({ length: DRESS_UP_PHOTOS.count }, () => null),
  };
}

/** The options saved with the game (all but text speed). */
export function savedOptions(o: DeviceOptions): GameState['options'] {
  return { sound: o.sound, battleScene: o.battleScene, battleStyle: o.battleStyle, buttonMode: o.buttonMode, frame: o.frame };
}

/** Decomp PlayTime_IncrementOneSecond: stops at 999:59:59. */
export function addPlaySecond(p: GameState['playTime']): void {
  if (p.hours >= PLAY_HOURS_MAX && p.minutes === 59 && p.seconds === 59) return;
  if (++p.seconds < 60) return;
  p.seconds = 0;
  if (++p.minutes < 60) return;
  p.minutes = 0;
  p.hours++;
}

export function createGame(options: GameOptions): Game {
  const { registries, labels, loaded } = loadGamePacks(options.packs);
  const records = [...registries.newGame.values()];
  if (records.length !== 1) throw new Error(`expected exactly one newGame record, found ${records.length}`);
  const record = records[0]!;
  const log = options.log ?? new CountingStubLog();
  const now = options.now ?? (() => new Date().toISOString());
  const input = new InputState();
  let seed = options.seed;
  let newGameOptions = options.newGame;
  let state!: GameState;
  /**
   * With the item wheel on (OpenSinnoh), the ticks Y has been held since its press on the idle field (null: not held).
   * Nothing else runs meanwhile, and no save falls inside it.
   */
  let yHeld: number | null = null;
  let world!: World;
  let scripts!: ScriptRunner;
  let battles: BattleLogEntry[] = [];
  let textSpeed: TextSpeedOption = options.textSpeed ?? 1;
  let engine: CreateBattle | null = options.createBattle ?? null;
  let loading: Promise<void> | null = null;
  let contestAnimation: CreateContestMoveAnimation | null = options.createContestAnimation ?? null;
  let contestLoading: Promise<void> | null = null;
  let contestLoadError: Error | null = null;
  /** The contests' move animations, loaded with the battle engine's chunk when the game loads it lazily. */
  const loadContestAnimation = (): Promise<void> => {
    if (contestAnimation || !options.loadContestAnimation) return Promise.resolve();
    contestLoading ??= options.loadContestAnimation().then(
      (create) => {
        contestAnimation = create;
      },
      (e: unknown) => {
        contestLoadError = e instanceof Error ? e : new Error(String(e));
        contestLoading = null;
        throw contestLoadError;
      },
    );
    return contestLoading;
  };
  /** The battle started by `FieldHost.startBattle`: its setup and seed, and the engine's battle once created. */
  let battle: { setup: BattleSetup; seed: number; run: Battle | null; redHp: { flag: number; delay: number } } | null = null;
  let lastResult: BattleResult | null = null;
  let wildBattles: WildBattleMode = 'battle';
  let evolutions: EvolutionMode = 'manual';
  /**
   * A blackout (decomp FieldTask_BlackOutFromBattle): `pending` until no script runs, then `warping` to the
   * blackout spawn; the recover script starts once the warp is done. Not saved (saves need an idle field).
   */
  /** The blackout after a lost battle: the warp, the black screen (`screen`: its ticks, fading out once A/B), the recover script. */
  let blackOut: { phase: 'pending' | 'screen' | 'warping'; label: Id; text: string; t: number; out: boolean } | null = null;
  let loadError: Error | null = null;
  const loadEngine = (): Promise<void> => {
    if (engine) return Promise.resolve();
    if (!options.loadBattle) return Promise.reject(new Error('this game has no battle engine (GameOptions.createBattle or loadBattle)'));
    loading ??= options.loadBattle().then(
      (create) => {
        engine = create;
      },
      (e: unknown) => {
        // Fail loudly at the next battle tick (a stale build after a deploy cannot fetch its chunk), not a frozen battle.
        loadError = e instanceof Error ? e : new Error(String(e));
        loading = null;
        throw loadError;
      },
    );
    return loading;
  };
  const device = options.device ?? memoryDevice();
  /**
   * The open menu app; `script` when a script op waits on it, `evolution` for the evolution scene after a
   * battle. Not saved (saves happen without one).
   */
  /** `journalRoll`: the journal the load opened (Journal_CheckOpenOnContinue); today's page opens when it closes. */
  let app: { model: AppModel; name: string; script: boolean; evolution?: true; underground?: true; journalRoll?: JournalDate } | null = null;
  /** The game clear (clear-game.ts): its phase and whether its credits may be skipped. Not saved (it ends in a reset). */
  let clear: (ClearPhase & { skippable: boolean }) | null = null;
  /** The save the clear wrote (kept across the reset for CONTINUE); also the Battle Tower's save before its reset. */
  let clearSave: SaveEnvelope | null = null;
  /** A save exists for this game (loaded from one, or written since): `check_save_type`'s answer. */
  let hasSave = false;
  /** The last save written (the one CONTINUE loads after a script's reset, BT_FUNC_RESET_SYSTEM). */
  let lastSave: SaveEnvelope | null = null;
  const persist = (env: SaveEnvelope) => {
    device.persist(env);
    hasSave = true;
    lastSave = env;
  };
  /** After a battle: the party slots still to check for a level-up evolution (decomp leveledUpMonsMask). */
  let evolving: number[] = [];
  /** X/Start arrived mid-step: the start menu opens once the field is idle (as on the DS). */
  let pendingMenu = false;
  /** The Pokétch device (not saved: a load or new game starts it afresh, as the DS's power-on does). */
  let poketch: PoketchModel | null = null;
  const popup = new MapPopupState();
  /** The zone and map-load count after the last tick: a new load is a warp, a new zone alone a crossing. */
  let seen: { zone: Id; loads: number } | null = null;
  const zoneOf = (id: Id) => {
    const z = registries.zones.get(id);
    if (!z) throw new Error(`unknown zone ${id}`);
    return z;
  };
  const watchZone = () => {
    const now = { zone: state.player.zone, loads: world.view().loads };
    const before = seen;
    seen = now;
    // The binoculars' temporary map changes request no location name (Task_GreatMarshLookout uses FieldTransition_StartMap).
    if (world.lookoutView()) return now.loads;
    if (before?.loads !== now.loads) popup.arrived(zoneOf(now.zone));
    else if (before.zone !== now.zone) popup.crossed(zoneOf(before.zone), zoneOf(now.zone));
    return now.loads;
  };
  const optionClock = options.clock ?? (() => DEFAULT_CLOCK);
  /** The clock game logic reads; `setClock` freezes it, a reset restores the option's. */
  let clockSource = optionClock;
  const clock = (): ClockTime => checkClock(clockSource());
  let sound!: SoundSystem;
  const newSound = (output: AudioOutput | null) =>
    new SoundSystem({
      registries,
      log,
      hour: () => state.gameTime.now.hour,
      field: () => ({ surfing: state.playerState === 'surf', cycling: state.playerState === 'cycle' }),
      output,
    });
  sound = newSound(options.audio ?? null);
  /** The zone and map load the sound system last saw (zone BGM changes). */
  let heard = { zone: '' as Id, loads: -1 };
  /** A map load plays the zone's BGM; walking into another zone fades to its BGM (decomp field_bgm.c). */
  const hearZone = (loads: number) => {
    if (loads !== heard.loads) sound.playForZone(state.player.zone);
    else if (state.player.zone !== heard.zone) sound.zoneChanged(state.player.zone);
    heard = { zone: state.player.zone, loads };
  };

  /** The game owns the PRNG; its state lives in `state.rng` so saves and replays carry it. */
  const rng = () => {
    const prng = Prng.from(state.rng);
    const value = prng.next();
    state.rng = prng.save();
    return value;
  };

  const wire = (next: GameState) => {
    state = next;
    input.clear();
    yHeld = null;
    app = null;
    clear = null;
    evolving = [];
    pendingMenu = false;
    poketch = null;
    pendingFieldMove = null;
    popup.hide();
    seen = null;
    const battleLog = (entry: Omit<BattleLogEntry, 'tick'>) => void battles.push({ tick: state.tick, ...entry });
    battle = null;
    lastResult = null;
    blackOut = null;
    // The sound system is not saved: a new game or a loaded save starts from silence (decomp: the field
    // map load plays the zone's BGM).
    sound = newSound(sound.output);
    sound.output?.send({ op: 'stop-all' });
    heard = { zone: '' as Id, loads: -1 };
    // The in-script save (CommonScript_SaveGame) and the Battle Tower's reset (BattleTower_ResetSystem: OS_ResetSystem,
    // so CONTINUE loads the save just written, as after the clear).
    const saves = {
      exists: () => hasSave,
      write: () => {
        try {
          persist(envelope());
          return true;
        } catch (e) {
          log.stub('save:script-save-failed', `the in-script save failed: ${(e as Error).message}`);
          return false;
        }
      },
      reset: () => {
        if (!lastSave) throw new Error('reset: no save was written to continue from');
        clearSave = lastSave;
        clear = { phase: 'reset', skippable: false };
      },
    };
    scripts = options.createScriptRunner({ registries, labels, state, field: () => world, rng, textSpeed: () => TEXT_FRAME_DELAY[textSpeed], log, battleLog, clock, audio: sound, saves });
    const start = (setup: BattleSetup) => {
      if (battle) throw new Error('startBattle: a battle is already running');
      lastResult = null;
      if (setup.kind === 'wild' && wildBattles === 'flee') {
        log.stub('battle:wild-flee', 'replay "wild flee": the wild Pokémon is met and the player flees without a battle');
        battleLog({ kind: 'wild', trainers: [], species: setup.wild.map((w) => w.species), result: 'fled' });
        lastResult = { outcome: 'fled', turns: 0, ballsThrown: 0, party: state.party, money: state.money, bag: state.bag, caught: null, seen: [], levelled: [] };
        return;
      }
      // Decomp: a wild Pokémon is seen when the battle starts.
      for (const w of setup.wild) markSeen(state, w.species, null);
      battle = { setup, seed: rng(), run: null, redHp: { flag: 0, delay: 0 } };
      // EncEffects_BGM: the battle BGM starts with the encounter effect; the field BGM pauses.
      sound.playBattleBgm(sound.sequenceBySource(battleBgm(setup, registries)));
      if (!engine) loadEngine().catch(() => {});
    };
    const worldDeps = { audio: sound, mapLoaded: (zone: Id, loads: number) => { sound.playForZone(zone); heard = { zone, loads }; }, registries, state, scripts, log, battleLog, battles: { start, done: () => lastResult, blackOut: startBlackOut }, clock, followers: () => device.options().followers === 0, followerWalkInPlace: () => device.options().followerStyle === 1, autoRun: () => device.options().autoRun === 0, hgssCharacter: () => device.options().character === 1 };
    world = options.createWorld(worldDeps);
  };

  const startNew = () => {
    battles = [];
    wire(newGameState(record, registries, savedPacks(loaded), seed, newGameOptions, clock()));
    if (record.label) scripts.runImmediate({ label: record.label, zone: record.zone, source: 'new-game' });
    world.enter('arrival');
    hearZone(watchZone());
  };

  /** The blackout spawn: the last one entered by a warp, else the default (spawn 1). */
  const startBlackOut = () => {
    if (blackOut) throw new Error('blackOut: a blackout is already under way');
    const zone = state.blackOut ? registries.zones.get(state.blackOut) : [...registries.zones.values()].find((z) => z.blackOut?.spawn === 1);
    if (!zone?.blackOut) throw new Error(`blackOut: no blackout spawn (${state.blackOut ?? 'the default spawn 1'})`);
    blackOut = { phase: 'pending', label: zone.blackOut.label, text: '', t: 0, out: false };
  };
  /** decomp sub_02052AA4: the blackout scene's message 3 (a Pokémon Center), or 4 at the default spawn (home). */
  const blackOutText = (home: boolean): string => {
    const ns = record.id.slice(0, record.id.indexOf(':'));
    const bank = registries.textBanks.get(`${ns}:TEXT_BANK_BLACK_OUT_SCENE` as Id);
    const id = bank?.messages[home ? 4 : 3];
    const text = id && registries.texts.get(id);
    if (!text) throw new Error(`blackOut: the ${ns} pack has no TEXT_BANK_BLACK_OUT_SCENE message ${home ? 4 : 3}`);
    let out = '';
    for (const t of parseTextMarkup(text.text)) {
      if (t.kind === 'chars') out += t.value;
      else if (t.kind === 'var') out += t.slot === 0 ? state.names.player : '';
      else if (t.kind === 'newline' || t.kind === 'clear' || t.kind === 'scroll') out += '\n';
    }
    return out;
  };
  /**
   * One field tick of the blackout (decomp FieldTask_BlackOutFromBattle): once the scripts are done, the warp,
   * the black screen with its text (faded in over 8 DS frames, A or B, faded out over 8), then the recover
   * script at the spawn once the warp is done.
   */
  const blackOutStep = (frame: InputFrame) => {
    if (!blackOut || scripts.running()) return;
    if (blackOut.phase === 'pending') {
      const zone = state.blackOut ? registries.zones.get(state.blackOut)! : [...registries.zones.values()].find((z) => z.blackOut?.spawn === 1)!;
      world.warp(zone.id, zone.blackOut!.x, zone.blackOut!.z, 'up');
      Object.assign(blackOut, { phase: 'screen', text: blackOutText(zone.blackOut!.spawn === 1), t: 0, out: false });
      return;
    }
    if (blackOut.phase === 'screen') {
      blackOut.t++;
      if (!blackOut.out && blackOut.t > BLACK_OUT_FADE && (frame.pressed.includes('a') || frame.pressed.includes('b'))) {
        blackOut.out = true;
        blackOut.t = 0;
      } else if (blackOut.out && blackOut.t >= BLACK_OUT_FADE) blackOut.phase = 'warping';
      return;
    }
    if (!world.warpDone()) return;
    const label = blackOut.label;
    blackOut = null;
    scripts.start({ label, zone: state.player.zone, source: 'blackout' });
  };

  const blackOutView = (): BlackOutView | null => {
    if (blackOut?.phase !== 'screen') return null;
    const k = Math.min(1, blackOut.t / BLACK_OUT_FADE);
    return { text: blackOut.text, alpha: blackOut.out ? 1 - k : k, waiting: !blackOut.out && blackOut.t > BLACK_OUT_FADE };
  };

  const fieldIdle = () => !scripts.running() && world.idle() && !blackOut;
  /** No save during a battle or with an app open (both live outside the state), nor while Y is held for the item wheel. */
  const canSave = () => fieldIdle() && !app && !battle && yHeld === null && !talk.active();
  const envelope = (): SaveEnvelope => ({ format: 'lantern-nds-save', version: 1, savedAt: now(), state: canonicalState(state) });
  /** A script or one of its boxes owns the screen: the start menu is unavailable (not just mid-step). */
  const scriptBusy = () => {
    const v = scripts.view();
    return scripts.running() || v.panel.kind !== 'idle' || !!v.message || !!v.yesNo || !!v.menu;
  };
  /** A field move chosen in the party menu: it starts once the app has closed (decomp: back to the field first). */
  let pendingFieldMove: { slot: number; move: Id; location?: number } | null = null;
  /**
   * Starts a usable field move: its FIELD_MOVES script (or Chatter's), or the field task of Fly, Teleport, Dig or Sweet
   * Scent. Fly, Teleport and Dig get off the bike in their map change, which also ends the bike's BGM.
   */
  const runFieldMove = (slot: number, move: Id, location?: number) => {
    if (!isTaskMove(move)) {
      scripts.start(fieldMoveStart(registries, state, slot, move));
      return;
    }
    const error = fieldMoveError(registries, state, slot, move);
    if (error) throw new Error(`${move} cannot be used here (${error})`);
    // The journal's field-move entries (FIELD_MOVE_*): Sweet Scent and Dig on the map used, Fly on the destination
    // (StartMenu_FlyTask), Teleport on the map it lands on (CreateJournalEntryForTeleport after ChangeMap).
    const mapOf = (zone: Id) => registries.zones.get(zone)!.sourceIndex ?? 0;
    if (move.endsWith(':MOVE_SWEET_SCENT')) {
      journalEvent(registries, state, JOURNAL_EVENT.sweetScent, mapOf(state.player.zone));
      return world.sweetScent(slot);
    }
    // The map changes on foot (FieldTask_MapChangeFly, FieldTask_ChangeMapByFieldWarp): the bike's BGM ends.
    if (state.playerState === 'cycle') sound.setSpecialBgm(null);
    if (move.endsWith(':MOVE_FLY')) {
      if (location === undefined) throw new Error('Fly needs the Town Map\'s location');
      const dest = flyDestination(registries, location);
      journalEvent(registries, state, JOURNAL_EVENT.fly, mapOf(dest.zone));
      world.fly(slot, dest);
    } else if (move.endsWith(':MOVE_DIG')) {
      journalEvent(registries, state, JOURNAL_EVENT.dig, mapOf(state.player.zone));
      world.teleport(slot, digDestination(state), 'dig');
    } else {
      const dest = teleportDestination(registries, state);
      journalEvent(registries, state, JOURNAL_EVENT.teleport, mapOf(dest.zone));
      world.teleport(slot, dest);
    }
  };
  /** A field item used from the bag: its use runs once the app has closed (decomp FieldSystem_StartFieldMap, then the use). */
  let pendingFieldItem: Id | null = null;
  /** FieldSystem_HandleDailyEvents: the daily values and flags (core `dailyEvents`), then Party_UpdatePokerusStatus. */
  const onDaily = (days: number) => {
    if (hasFieldSystems(registries)) dailyEvents(registries, state, days, villaDaily(registries, state));
    elapsePokerus(state.party, days);
    tvDaily(state);
    // Underground_HandleDailyEvents: buried spheres grow, the seed moves on, new spots are due.
    if (state.underground) undergroundDaily(state.underground, days);
  };
  const onMinutes = (minutes: number) => timedEvents(registries, state, minutes, clock());
  const fieldItems = () => ({ registries, state, world, scripts, sound, log, ns: record.id.slice(0, record.id.indexOf(':')), openApp: (request: { app: 'poffin-case' } | { app: 'journal' } | { app: 'town-map' }) => openApp(request, false) });
  // Follower talk (OpenSinnoh, with the HGSS add-on's data): the field's own task while it runs.
  const talk = followerTalk({ registries, state: () => state, world: () => world, scripts: () => scripts, sound, rng, ns: record.id.slice(0, record.id.indexOf(':')), on: () => device.options().followerTalk === 0 });
  const repel = repelPrompt({ registries, state: () => state, scripts: () => scripts, ns: record.id.slice(0, record.id.indexOf(':')), on: () => device.options().repelPrompt === 0 });
  /**
   * Decomp encounter.c's journal entries at a field battle's end: a won wild battle (wild, roamer, AI partner, Safari)
   * from the fifth since the last map change (wildMonDefeated, reset by FieldMapChange_UpdateGameData: any map load
   * here) writes the defeated line, a capture the caught line (the battle's time of day: the clock's period at the
   * end, inferred); a won trainer or tag battle the trainer entry. The count is not saved: a load (a new world) starts
   * it again, as the DS's field system does.
   */
  const wildDefeats: { world: unknown; loads: number; count: number } = { world: null, loads: -1, count: 0 };
  const journalBattle = (setup: BattleSetup, result: BattleResult) => {
    if (isWildKind(setup.kind)) {
      const period = DAY_PERIODS.indexOf(dayPeriod(state.gameTime.now.hour));
      const genderOf = (g: string | undefined) => (g === 'male' ? 0 : g === 'female' ? 1 : 2);
      if (result.outcome === 'won') {
        const loads = world.view().loads;
        if (loads !== wildDefeats.loads || world !== wildDefeats.world) Object.assign(wildDefeats, { world, loads, count: 0 });
        if (++wildDefeats.count >= 5) {
          const foe = battle?.run?.view().battlers.find((x) => x.side === 'enemy');
          if (foe) journalMon(registries, state, 'defeated', foe.species, genderOf(foe.gender), period);
        }
      } else if (result.outcome === 'caught' && result.caught) {
        journalMon(registries, state, 'caught', result.caught.mon.species, genderOf(monGender(dexOf(registries), result.caught.mon)), period);
      }
    } else if ((setup.kind === 'trainer' || setup.kind === 'first') && result.outcome === 'won' && setup.trainers[0]) {
      journalTrainer(registries, state, setup.trainers[0], state.player.zone);
    }
  };
  const host: AppHost = {
    // The DS options in SAVED_OPTIONS are saved with the game (GameState v6); text speed and the modern options are the device's.
    options: () => ({ ...device.options(), ...state.options }),
    // The device hears every change (it stores text speed and reports what is not applied yet).
    setOption(key, value) {
      device.setOption(key, value);
      if (key === 'textSpeed') game.textSpeed = value as TextSpeedOption;
      else if (isSavedOption(key)) state.options[key] = value;
    },
    // The start menu opens only on an idle field, so its SAVE needs no further check (the app is not saved).
    save: () => persist(envelope()),
    get sound() {
      return sound;
    },
    fieldMoveCheck: (slot, move) => {
      const error = fieldMoveError(registries, state, slot, move);
      if (error === 'unsupported') log.stub(`menus:field-move:${move}`, `${move} from the party menu is not implemented yet`);
      return error;
    },
    useFieldMove(slot, move, location) {
      pendingFieldMove = { slot, move, ...(location !== undefined ? { location } : {}) };
    },
    fieldItemCheck: (item) => fieldItemCheck(fieldItems(), item),
    useFieldItem(item) {
      pendingFieldItem = item;
    },
    clock,
    undergroundAhead: () => world.undergroundAhead(),
    undergroundMiningRand: () => world.undergroundMiningRand(),
    undergroundDecoration: (view) => world.undergroundDecoration(view),
    undergroundTrapShadow: (size) => world.undergroundTrapShadow(size),
    undergroundPlace: () => world.undergroundPlace(),
    spiritombVendors: () => device.options().spiritombVendors === 0,
    get contestAnimation() {
      return contestAnimation ?? undefined;
    },
  };
  const openApp = (request: Parameters<CreateApp>[0], script: boolean) => {
    if (!options.createApp) throw new Error(`no menu apps in this game (createApp): cannot open ${request.app}`);
    app = { model: options.createApp(request, { registries, state, log, host }), name: request.app, script };
  };
  /**
   * Decomp BATTLE_STATE_CHECK_EVOLUTION (Battle_FindEvolvingPartyMember): the next party member that
   * levelled in the battle and can evolve now opens the evolution scene (B cancels, "What?" first). False
   * when none is left: the field takes over (its BGM comes back).
   */
  const nextEvolution = (): boolean => {
    while (evolving.length) {
      const slot = evolving.shift()!;
      const mon = state.party[slot];
      if (!mon) throw new Error(`battle: levelled party slot ${slot} is empty`);
      const found = evolutionTarget(dexOf(registries), mon, levelEvolutionTrigger(registries, state, clock(), device.options().tradeEvolution === 0));
      if (!found) continue;
      if (!options.createApp) {
        log.stub('evolution:no-apps', 'this game has no menu apps (createApp): evolutions after a battle are skipped');
        evolving = [];
        return false;
      }
      openApp({ app: 'evolution', slot, target: found.target, method: found.method, source: 'battle' }, false);
      app!.evolution = true;
      return true;
    }
    return false;
  };
  /**
   * The start menu (decomp FieldSystem_ShowStartMenu, FieldInput): X or Start, or a script's request once
   * it has ended, opens it when the field is idle; a press during a step waits for the step's end. Returns
   * true when it opened (the frame is consumed).
   */
  const startMenu = (frame: InputFrame): boolean => {
    if (!options.createApp) return false;
    if (scriptBusy()) {
      pendingMenu = false;
      return false;
    }
    if (scripts.takeStartMenuRequest() || frame.pressed.some((b) => (OPENS_MENU as readonly string[]).includes(b))) pendingMenu = true;
    if (!pendingMenu || !world.idle()) return false;
    pendingMenu = false;
    // The Underground's own menu (UndergroundMan_OpenMenu → UndergroundMenu_Start, which plays the sound itself).
    if (inUnderground()) {
      openApp({ app: 'ug-menu' }, false);
      app!.underground = true;
      return true;
    }
    openApp({ app: 'start-menu' }, false);
    sound.playSeBySource(SEQ_SE_DP_WIN_OPEN);
    return true;
  };
  const inUnderground = () => newGameRecord(registries).underground?.zone === state.player.zone;

  /**
   * Y on the idle field (decomp FieldInput registeredItem): the registered item's use; the frame is consumed. With the
   * item wheel, Y held for WHEEL_HOLD ticks opens the wheel (when it has items) and a shorter press uses the
   * registered item as the DS does, when Y is let go.
   */
  const registeredItem = (frame: InputFrame): boolean => {
    if (yHeld !== null) {
      if (!frame.held.includes('y')) {
        yHeld = null;
        useRegisteredItem(fieldItems());
      } else if (++yHeld >= WHEEL_HOLD && state.registeredWheel?.length) {
        yHeld = null;
        openApp({ app: 'item-wheel' }, false);
      }
      return true;
    }
    // The Underground's field takes no registered item (its input is the comm player's).
    if (!frame.pressed.includes('y') || scriptBusy() || !world.idle() || blackOut || inUnderground()) return false;
    if (device.options().itemWheel === 0) yHeld = 0;
    else useRegisteredItem(fieldItems());
    return true;
  };

  /** Decomp FieldMap_Init on the field's return after a battle: the zone's on-load, then its on-resume script. */
  const fieldReturn = () => {
    const zone = registries.zones.get(state.player.zone);
    if (!zone) throw new Error(`field return: unknown zone ${state.player.zone}`);
    if (zone.mapScripts.onLoad) scripts.runImmediate({ label: zone.mapScripts.onLoad, zone: zone.id, source: 'load' });
    world.fieldReturned();
    if (zone.mapScripts.onResume) scripts.runImmediate({ label: zone.mapScripts.onResume, zone: zone.id, source: 'resume' });
  };

  /** Battle mode: one tick of the battle; its result goes into the state and the log. */
  /**
   * SysTask_UpdateRedHPSound: while a player Pokémon's gauge is red the beep repeats (4 frames after it
   * ends: 2 ticks); it stops when no gauge is red, and for good after the victory music.
   */
  const lowHpBeep = (b: NonNullable<typeof battle>) => {
    const r = b.redHp;
    if (r.flag & 2 || b.setup.kind === 'tutorial' || !b.run) return;
    const red = b.run.view().battlers.some((x) => x.side === 'player' && x.visible && redHp(x.hp, x.maxHp));
    if (red && !r.flag) {
      sound.playSeBySource(SEQ_SE_DP_HINSI);
      r.flag = 1;
      r.delay = 2;
    } else if (!red && r.flag) {
      sound.stopSeBySource(SEQ_SE_DP_HINSI);
      r.flag = 0;
    }
    if (r.flag && !sound.sePlayingBySource(SEQ_SE_DP_HINSI) && --r.delay <= 0) {
      sound.playSeBySource(SEQ_SE_DP_HINSI);
      r.delay = 2;
    }
  };
  const battleStep = (frame: InputFrame) => {
    const b = battle!;
    if (!b.run) {
      if (loadError) throw new Error(`battle engine failed to load: ${loadError.message}`);
      if (!engine) return false;
      const free = firstFreeBox(state);
      const ns = record.id.slice(0, record.id.indexOf(':'));
      const bebe = `${ns}:FLAG_MET_BEBE` as Id;
      b.run = engine(b.setup, {
        registries,
        party: structuredClone(state.party),
        bag: structuredClone(state.bag),
        player: { name: state.names.player, gender: state.gender, trainerId: state.trainerId, rival: state.names.rival },
        money: state.money,
        badges: state.badges.length,
        caught: state.pokedex.caught,
        pc: {
          current: { box: state.currentBox, name: state.boxes[state.currentBox]!.name },
          free: free === null ? null : { box: free, name: state.boxes[free]!.name },
          metBebe: state.flags[bebe] ?? registries.flags.get(bebe)?.initial ?? false,
        },
        met: { zone: state.player.zone, date: clock().date },
        seed: b.seed,
        textSpeed: TEXT_FRAME_DELAY[textSpeed],
        // Decomp OPTIONS_BATTLE_SCENE_ON 0 / OFF 1, OPTIONS_BATTLE_STYLE_SHIFT 0 / SET 1.
        options: { scene: state.options.battleScene === 0, style: state.options.battleStyle === 0 ? 'shift' : 'set' },
        log,
        sound: {
          // The victory music (decomp: the result check for trainers, the exp or catch for wild battles);
          // it turns the low-HP beep off for the rest of the battle (BattleSystem_SetRedHPSoundFlag 2).
          victory: () => {
            sound.playBgm(sound.sequenceBySource(victoryBgm(b.setup, registries)));
            if (b.redHp.flag & 1) sound.stopSeBySource(SEQ_SE_DP_HINSI);
            b.redHp.flag = 2;
          },
          // The battle animations' sound effects and cries, on the game's deterministic sound state.
          se: (n) => sound.playSeBySource(n),
          stopSe: (n) => sound.stopSeBySource(n),
          sePlaying: (n) => (n === undefined ? sound.anySePlaying() : sound.sePlayingBySource(n)),
          cry: (species, form, mod, pan, volume) => sound.playCry(species, form, mod, pan, volume),
          cryPlaying: () => sound.cryPlaying(),
          stopCries: () => sound.stopCries(),
        },
        // Options "battle scene": 0 on, 1 off (decomp OPTIONS_BATTLE_SCENE_*).
      });
    }
    b.run.step(frame);
    lowHpBeep(b);
    // Decomp Pokedex_Encounter: a foe is seen with its form and gender once it is out (not in the frontier's
    // battles: BattleSystem_RecordSeenMon skips BATTLE_TYPE_FRONTIER).
    if (!b.setup.frontier) for (const x of b.run.view().battlers) if (x.side === 'enemy' && x.visible) markSeen(state, x.species, { form: x.form, gender: x.gender });
    // The battle's bag or party sheet: the game hosts it like any app until it returns (see `step`).
    const request = b.run.app();
    if (request && options.createApp) openApp(request, false);
    else if (request?.app === 'pokedex-entry') {
      // Without menu apps (headless hosts) the entry cannot be shown; the battle goes on.
      log.stub('game:pokedex-entry', 'no menu apps in this game: the Pokédex entry after a catch is skipped');
      b.run.appDone({ app: 'pokedex-entry' });
    }
    const result = b.run.done();
    if (result && b.setup.frontier) {
      // A frontier battle (FieldBattleDTO_NewBattleTower): it played on copies; nothing goes back to the save, the
      // field does not return (the frontier scene goes on), and its music is the scene's (BattleFrontier_RunSubApp).
      battles.push({ tick: state.tick, kind: 'frontier', trainers: [], species: [], result: result.outcome, turns: result.turns, topology: b.setup.topology ?? 'single' });
      lastResult = result;
      if (b.redHp.flag & 1) sound.stopSeBySource(SEQ_SE_DP_HINSI);
      battle = null;
    } else if (result) {
      state.party = result.party;
      state.bag = result.bag;
      for (const species of result.seen) markSeen(state, species, null);
      if (result.caught) {
        // Decomp BattleSystem_TryIncrementTrainerScoreCaughtSpecies: a species new to the Pokédex.
        scoreCatch(state, registries, result.caught.mon.species);
        markCaught(state, registries, result.caught.mon);
        if (result.caught.box !== null) storeInBox(state, registries, result.caught.box, result.caught.mon);
      }
      state.money = result.money;
      // Decomp encounter.c FieldTask_Encounter / FieldTask_WildEncounter: a battle the player did not lose, with a
      // partner walking along (the has-partner flag), heals the party (Party_HealAllMembers).
      if (result.outcome !== 'lost' && result.outcome !== 'draw' && state.hasPartner) for (const mon of state.party) heal(dexOf(registries), mon);
      // Decomp encounter.c UpdateGameRecords: only after a battle the player did not lose (CheckPlayerWonEncounter).
      if (result.outcome !== 'lost' && result.outcome !== 'draw') scoreBattle(state, registries, b.setup.kind, result.outcome, result.caught?.mon.species ?? null);
      journalBattle(b.setup, result);
      // Decomp encounter.c: after a wild, roamer or AI-partner battle (not the Safari Game's or the tutorial's), the
      // Catch That Pokémon Show (FieldSystem_SaveTVSegment_CatchThatPokemonShow).
      if (b.setup.kind === 'wild' || b.setup.kind === 'static' || b.setup.kind === 'legendary') {
        const m = result.caught?.mon;
        tvCatch(state, result.outcome, result.ballsThrown, m ? { species: m.species, ball: m.ball, nickname: m.nickname } : null);
      }
      // The field's return (decomp encounter.c FieldTransition_StartMap → FieldMap_Init), for every field battle:
      // unless the player lost or drew (the tutorial whatever its result), the field is rebuilt, which runs the
      // zone's on-load and on-resume scripts before the battle's script goes on. Scripts rely on it with
      // FLAG_MAP_LOCAL_REMOVE_OBJECT (static Pokémon, Fantina's bollards). Our field stays up, so only the two
      // scripts run; the objects stay as they are (the DS restores them from the save, not from the events).
      if (b.setup.kind === 'tutorial' || (result.outcome !== 'lost' && result.outcome !== 'draw')) fieldReturn();
      // Decomp: a lost wild battle blacks out from the encounter task; trainer scripts call BlackOutFromBattle;
      // the first battle and the tutorial never black out (their scripts go on).
      if (result.outcome === 'lost' && b.setup.kind === 'wild') startBlackOut();
      // A script's own wild battles (the tutorial, static and legendary ones) log as scripted.
      const kind = b.setup.kind === 'wild' || b.setup.kind === 'safari' ? 'wild' : b.setup.kind === 'tutorial' || b.setup.kind === 'static' || b.setup.kind === 'legendary' ? 'scripted' : 'trainer';
      battles.push({ tick: state.tick, kind, trainers: b.setup.trainers, species: b.setup.wild.map((w) => w.species), result: result.outcome, turns: result.turns, topology: b.setup.topology ?? 'single' });
      lastResult = result;
      if (b.redHp.flag & 1) sound.stopSeBySource(SEQ_SE_DP_HINSI);
      battle = null;
      // Decomp: after a win, a catch or a flight, the Pokémon that levelled may evolve before the field returns.
      evolving = result.outcome === 'won' || result.outcome === 'caught' || result.outcome === 'fled' ? [...result.levelled] : [];
      // Back on the field (FieldBGM_PlayEffectiveForMapHeader): the paused field BGM fades back in.
      if (!nextEvolution()) sound.playEffectiveForZone(state.player.zone);
    }
    return true;
  };

  /** The running Pokétch, created when it starts running and dropped when it stops (decomp PoketchSystem_Create / shutdown). */
  const poketchModel = (): PoketchModel | null => {
    if (!options.createPoketch || !poketchRuns(state, registries)) return (poketch = null);
    return (poketch ??= options.createPoketch({ registries, state, log, rng, clock, sound, radarChain: () => world.radarChain() }));
  };
  /**
   * One Pokétch tick (field ticks only: menus and battles pause it). Its input is the panel touch, as the DS
   * bottom screen's, while no script runs and no panel choice is up.
   */
  const stepPoketch = (frame: InputFrame) => {
    const model = poketchModel();
    if (!model) return;
    const busy = scriptBusy();
    const t = frame.touch;
    const touch = t && (t.screen ?? 'panel') === 'panel' && !busy ? { x: t.x, y: t.y } : null;
    model.step({ touch, busy, moved: !world.idle() });
  };

  /**
   * One tick of the clear's save screen (clear-game.ts): the party healed, the Hall of Fame entry added and the
   * save written to the device on its tick (CONTINUE loads it after the reset), the save sound, then the credits.
   */
  const clearSaveStep = (c: Extract<ClearPhase, { phase: 'save' }> & { skippable: boolean }) => {
    const act = saveScreenStep(++c.t);
    if (act === 'save') {
      clearGameSave(registries, state, clock());
      clearSave = envelope();
      persist(clearSave);
    } else if (act === 'se') {
      const se = `${record.id.slice(0, record.id.indexOf(':'))}:SEQ_SE_DP_SAVE` as Id;
      if (registries.sequences.has(se)) sound.playSe(se);
      else log.stub('clear-game:save-se', `the pack has no ${se}: the clear's save plays no sound`);
    } else if (act === 'done') {
      clear = { phase: 'credits', skippable: c.skippable };
      if (newGameRecord(registries).credits) openApp({ app: 'credits', skippable: c.skippable }, false);
      else {
        log.stub('clear-game:credits', 'the pack has no NewGame.credits: the clear resets without credits');
        clear = { phase: 'reset', skippable: c.skippable };
      }
    }
  };

  /** One tick of game time: the tick counter and, every 30 ticks, a second of play time. */
  const countTick = () => {
    state.tick++;
    if (state.tick % 30 === 0) addPlaySecond(state.playTime);
    world.weatherTick(!battle && !clear && (!app || FIELD_APPS.has(app.name)));
    sound.tick();
  };

  startNew();

  const game: Game = {
    registries,
    labels,
    loadOrder: loaded.order,
    overrides: loaded.overrides,
    log,
    get state() {
      return state;
    },
    get world() {
      return world;
    },
    get scripts() {
      return scripts;
    },
    get battles() {
      return battles;
    },
    get battle() {
      return battle?.run ?? null;
    },
    inBattle: () => battle !== null,
    battleSetup: () => battle?.setup ?? null,
    battleChoose(choice) {
      if (!battle?.run) throw new Error(`battleChoose: no battle is running (${JSON.stringify(choice)})`);
      battle.run.choose(choice);
      // A direct answer (replays, the card) closes the battle's bag or party sheet if it was open.
      if (app && !battle.run.app()) app = null;
    },
    get wildBattles() {
      return wildBattles;
    },
    set wildBattles(v) {
      if (v !== 'flee' && v !== 'battle' && v !== 'auto') throw new Error(`invalid wild battle mode ${String(v)}`);
      wildBattles = v;
    },
    get evolutions() {
      return evolutions;
    },
    set evolutions(v) {
      if (v !== 'manual' && v !== 'auto' && v !== 'cancel') throw new Error(`invalid evolution mode ${String(v)}`);
      evolutions = v;
    },
    loadBattleEngine: () => Promise.all([loadEngine(), loadContestAnimation()]).then(() => {}),
    get textSpeed() {
      return textSpeed;
    },
    set textSpeed(v) {
      if (TEXT_FRAME_DELAY[v] === undefined) throw new Error(`invalid text speed option ${String(v)}`);
      textSpeed = v;
    },
    clock,
    setClock(date, time) {
      const frozen = withClock(clock(), date, time);
      clockSource = () => frozen;
    },
    get sound() {
      return sound;
    },
    get audioOutput() {
      return sound.output;
    },
    set audioOutput(v) {
      sound.output = v;
      // A late output starts what the sound system plays now (the zone's BGM).
      if (v && sound.currentBgm()) v.send({ op: 'start', handle: sound.currentHandleName()!, seq: sound.currentBgm()! });
    },
    useFieldMove(slot, move, location) {
      // The party menu opens only from the idle field (start menu), as on the DS.
      if (!canSave()) throw new Error('field moves are used from the party menu, which needs the idle field (no script, no movement)');
      runFieldMove(slot, move, location);
    },
    usableFieldMoves: () => usableFieldMoves(registries, state),
    press: (b) => input.press(b),
    release: (b) => input.release(b),
    touch: (x, y) => input.touch(x, y),
    untouch: () => input.untouch(),
    tap: (id) => input.tap(id),
    app: () => app?.model.view() ?? null,
    tick() {
      game.step(input.sample());
    },
    mapPopup: () => popup.view(),
    blackOutScreen: () => blackOutView(),
    poketch: () => poketchModel()?.view() ?? null,
    step(raw) {
      // After the clear's credits the DS resets: nothing runs until a load or a new game.
      if (clear?.phase === 'reset') return;
      // The BUTTON MODE option remaps every key read (decomp ApplyButtonModeToInput).
      const frame = applyButtonMode(raw, state.options.buttonMode);
      if (clear?.phase === 'save') {
        clearSaveStep(clear);
        countTick();
        return;
      }
      // A battle or a menu app replaces the field map, and the popup with it (decomp FieldMap_Exit).
      if (battle || app) popup.hide();
      if (battle) {
        // The battle's bag or party sheet takes the frame while open; its result answers the battle.
        if (app) {
          const result = app.model.step(frame);
          if (result) {
            app = null;
            battle.run!.appDone(result);
          }
          countTick();
          return;
        }
        // While the engine loads nothing moves, not even the tick count (replays preload it).
        if (battleStep(frame)) countTick();
        return;
      }
      // An open app takes the frame; the field and the VM wait (the DS runs the app as a field task).
      if (app) {
        // The contest app waits for the move animations' chunk (like a battle for its engine): nothing moves meanwhile.
        if (app.name === 'contest' && !contestAnimation && options.loadContestAnimation) {
          if (contestLoadError) throw new Error(`contest animations failed to load: ${contestLoadError.message}`);
          loadContestAnimation().catch(() => {});
          return;
        }
        const result = app.model.step(frame);
        if (result) {
          const { script, evolution, underground, journalRoll } = app;
          app = null;
          if (journalRoll) openJournalPage(state, journalRoll, state.player.zone);
          // An app the Underground's field opened: it hears the result; GO UP starts the return to the surface.
          if (underground) {
            world.undergroundAppDone(result);
            if (result.app === 'ug-menu' && result.goUp) world.exitUnderground();
          }
          // The clear's record screen goes on to the save screen, its credits to the reset.
          if (clear?.phase === 'record') clear = { phase: 'save', t: 0, skippable: clear.skippable };
          else if (clear?.phase === 'credits') clear = { phase: 'reset', skippable: clear.skippable };
          if (script) scripts.appDone(result);
          // StartMenu_SelectRetire: RETIRE closes the menu and starts SAFARI_GAME 21.
          if (result.app === 'start-menu' && result.retire) {
            const retire = newGameRecord(registries).greatMarsh?.labels.retire;
            if (!retire) throw new Error('start menu: RETIRE without a Great Marsh (NewGame.greatMarsh)');
            scripts.start({ label: retire, zone: state.player.zone, source: 'field-move' });
          }
          if (evolution && !nextEvolution()) sound.playEffectiveForZone(state.player.zone);
          if (pendingFieldMove) {
            const { slot, move, location } = pendingFieldMove;
            pendingFieldMove = null;
            runFieldMove(slot, move, location);
          }
          if (pendingFieldItem) {
            useFieldItem(fieldItems(), pendingFieldItem);
            pendingFieldItem = null;
          }
          // The item wheel's pick is used as Y uses the registered item.
          if (result.app === 'item-wheel' && result.item) useRegisteredItem(fieldItems(), result.item);
        }
        countTick();
        return;
      }
      // Decomp FieldInput_Process: the registered item (Y) before the start menu.
      if (registeredItem(frame)) {
        popup.hide();
        countTick();
        return;
      }
      if (startMenu(frame)) {
        popup.hide();
        countTick();
        return;
      }
      const repelBefore = repel.before();
      popup.step();
      // Follower talk: its steps, the message box, and the field drawn on with the player held.
      if (talk.active()) {
        talk.step();
        scripts.step(frame);
        world.step(NO_INPUT);
        countTick();
        return;
      }
      blackOutStep(frame);
      // Decomp sub_020559DC: the saved clock follows the RTC while no field task (script) runs.
      if (!scripts.running()) updateGameTime(state.gameTime, clock(), log, onDaily, onMinutes);
      // The world gates its own triggers: frame scripts and trainer sight also run between forced steps.
      if (!scripts.running() && !blackOut) {
        // Decomp HandleFieldInput: A, or an event the field input starts (a script, a warp, a slide, a
        // battle), hides the popup at once.
        if (frame.pressed.includes('a')) popup.hide();
        if (!blackOut && talk.tryStart(frame)) {
          popup.hide();
          scripts.step(frame);
          world.step(NO_INPUT);
          countTick();
          return;
        }
        const idle = world.idle();
        world.checkTriggers(frame);
        if (scripts.running() || battle || (idle && !world.idle())) popup.hide();
        // The Underground's A opens its apps (a mining spot, a vendor): the field waits for them.
        const ug = world.undergroundRequest();
        if (ug) {
          openApp(ug, false);
          app!.underground = true;
          countTick();
          return;
        }
      }
      scripts.step(frame);
      world.step(frame);
      repel.after(repelBefore);
      talk.stepMood();
      stepPoketch(frame);
      // Both observers need the same load count, not two complete actor/feature views per tick.
      hearZone(watchZone());
      countTick();
      const request = scripts.view().app;
      if (request?.app === 'hall-of-fame' && request.mode === 'record') {
        // `clear_game`: the clear task takes over; the script never resumes (the DS resets).
        clear = { phase: 'record', ...startClearGame(registries, state, clock()) };
        openApp(request, false);
      } else if (request) openApp(request, true);
    },
    advance(ticks) {
      if (!Number.isInteger(ticks) || ticks < 0) throw new Error(`advance: invalid tick count ${ticks}`);
      for (let i = 0; i < ticks; i++) game.tick();
    },
    snapshot: () => ({
      battles: structuredClone(battles),
      battle: battle?.run?.view() ?? null,
      tick: state.tick,
      state: cloneState(state),
      scriptRunning: scripts.running(),
      view: structuredClone(scripts.view()),
      fade: world.fadeState(),
      app: app ? structuredClone(app.model.view()) : null,
      mapPopup: popup.view(),
      blackOut: blackOutView(),
      reset: clear?.phase === 'reset',
    }),
    canSave,
    save() {
      if (battle) throw new Error('cannot save during a battle');
      if (scripts.running()) throw new Error('cannot save while a script is running');
      if (!world.idle() || blackOut) throw new Error('cannot save while the world is busy (step, warp, fade, movement or a blackout)');
      if (app) throw new Error('cannot save while a menu is open');
      return envelope();
    },
    load(envelope, entry = 'load') {
      const env = validateSave(envelope, registries, loaded.order, labels);
      hasSave = true;
      lastSave = env;
      const next = cloneState(env.state);
      // The clear's save continues upstairs in the player's house, a map change (decomp FieldTask_LoadSavedGameMap).
      if (continueAtStart(registries, next)) entry = 'arrival';
      // Decomp GameStartLoadSave_Main: a changed clock starts the penalty and turns Sky Forme Shaymin back to Land.
      if (clockChanged(next.gameTime, clock())) shayminToLand(registries, next.party);
      updateGameTime(
        next.gameTime,
        clock(),
        log,
        (days) => {
          if (hasFieldSystems(registries)) dailyEvents(registries, next, days, villaDaily(registries, next));
          if (next.underground) undergroundDaily(next.underground, days);
          tvDaily(next);
        },
        (minutes) => timedEvents(registries, next, minutes, clock()),
      );
      wire(next);
      world.enter(entry);
      hearZone(watchZone());
      // FieldTask_LoadSavedGameMap: a journal two or more days old opens first, as saved (Journal_CheckOpenOnContinue);
      // then today's page (Journal_GetSavedPage and its title, sub_02053494). Headless hosts without apps only roll.
      if (journalOwned(registries, state)) {
        const today = journalDate(clock());
        if (options.createApp && journalOpensOnContinue(state, today)) {
          openApp({ app: 'journal' }, false);
          app!.journalRoll = today;
        } else openJournalPage(state, today, state.player.zone);
      }
    },
    onContinue() {
      world.continued();
    },
    openMysteryGift() {
      if (app || scriptBusy() || !world.idle()) throw new Error('openMysteryGift: the field is not idle');
      openApp({ app: 'mystery-gift' }, false);
    },
    resetSave: () => clearSave,
    hasReset: () => clear?.phase === 'reset',
    reset(nextSeed, nextNewGame) {
      if (nextSeed !== undefined) seed = nextSeed;
      if (nextNewGame !== undefined) newGameOptions = nextNewGame;
      clockSource = optionClock;
      wildBattles = 'battle';
      evolutions = 'manual';
      startNew();
    },
  };
  return game;
}

/**
 * Dev hot reload: a new game from edited packs, continuing the current state. Call it between
 * scripts (it throws like `save()` otherwise). Pack ids and versions must stay the same.
 */
export function reloadGame(game: Game, options: GameOptions): Game {
  const save = game.save();
  const next = createGame(options);
  next.load(save);
  return next;
}

/**
 * Decomp sub_02055B64, the minutes that passed: the berry patches grow (BerryPatches_ElapseTime), the honey trees count
 * down (SpecialEncounter_DecrementHoneyTreeTimers), then the night turns party Sky Forme Shaymin back to Land
 * (Party_SetShayminForm), with the TV's slot between (TVBroadcast_UpdateProgramTimeSlot).
 */
function timedEvents(registries: Registries, state: GameState, minutes: number, now: ClockTime): void {
  const berries = newGameRecord(registries).berries;
  if (berries) elapseBerryMinutes(berries, state.berryPatches, minutes);
  if (state.encounters) elapseHoneyTrees(state.encounters, minutes);
  tvTimeSlot(state, minutes, now.minute);
  shayminClockRevert(registries, state.party, minutes, now);
}

/** The Villa's daily visitor inputs (core `VillaDaily`), or none when the pack has no Villa. */
function villaDaily(registries: Registries, state: GameState): VillaDaily | undefined {
  const v = newGameRecord(registries).villa;
  if (!v) return undefined;
  return { ...v.visitors, furniture: v.furniture.map((f) => f.flag), away: state.player.zone !== v.zone && state.player.zone !== v.resortArea };
}
