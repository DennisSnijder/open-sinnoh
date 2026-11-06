import { fieldSystemHandlers } from './field-system-ops.ts';
import { frontierFieldHandlers } from './frontier-field-ops.ts';
import { FrontierRunner } from './frontier/runner.ts';
import type { BattleTower } from '@opensinnoh/services';
/**
 * Script VM (contracts `CreateScriptRunner`). Interprets Script IR with the decomp's execution model
 * (docs/research/scripts-and-opening.md §1.6):
 *
 * - A thread (decomp ScriptManager) has a main context and at most one concurrent sub context
 *   (`call_common_script`); both are run each tick, main first. Temp vars (registry scope 'temp') and the
 *   string template slots belong to the thread.
 * - A command either continues or yields the tick. Waits are predicates polled on later ticks; on the tick
 *   a predicate becomes true the context resumes but runs no command (one tick of resume latency).
 * - Call stack of 20 slots (a push onto 19 entries is dropped, as on the DS); `return` on an empty stack
 *   stops the context. Comparisons store 0 (<), 1 (==), 2 (>) per context.
 * - The message printer runs after the scripts, 2 sub-steps per tick (DS print task runs twice per loop).
 * - Flags/vars live in the shared GameState; only values that differ from the registry `initial` are stored.
 */
import { DAY_PERIODS, dayPeriod, type Arg, type Command, type Id, type Rng } from '@opensinnoh/core';
import type { Button } from '@opensinnoh/core';
import { LOCALID_FOLLOWER, newGameRecord, type AppRequest, type AppResult, type CreateScriptRunner, type Facing, type FieldHost, type GameState, type InputFrame, type Labels, type PanelView, type Registries, type ScriptRunner, type ScriptSaves, type ScriptStart, type ScriptView, type SignpostKind, type StubLog } from '@opensinnoh/contracts';
import { TEXT_SPEED, TextPrinter, hitChoice, plainMarkup, toPrintOps } from '@opensinnoh/text';
import { classifyOp, stubDefault } from './classify.ts';
import { COMMAND_BY_NAME, CONDITIONS } from './commands.ts';
import type { ScriptMenu } from './menu.ts';
import { BANKS, m1aHandlers } from './ops.ts';
import { m1bHandlers } from './m1b-ops.ts';
import { partyHandlers } from './party-ops.ts';
import { daycareHandlers } from './daycare-ops.ts';
import { m3aHandlers } from './m3a-ops.ts';
import { m3bPoketchHandlers } from './m3b-poketch-ops.ts';
import { audioHandlers } from './audio-ops.ts';
import { m2aHandlers } from './m2a-ops.ts';
import { m5Handlers } from './m5-ops.ts';
import { m6Handlers } from './m6-ops.ts';
import { gymHandlers } from './gym-ops.ts';
import { safariHandlers } from './safari-ops.ts';
import { dwHandlers } from './dw-ops.ts';
import { sceneHandlers } from './scene-ops.ts';
import { staticHandlers } from './static-ops.ts';
import { formHandlers } from './form-ops.ts';
import { sideHandlers } from './side-ops.ts';
import { poffinHandlers } from './poffin-ops.ts';
import { contestHandlers } from './contest-ops.ts';
import { galleryHandlers } from './gallery-ops.ts';
import { sealHandlers } from './seal-ops.ts';
import { gameCornerHandlers } from './game-corner-ops.ts';
import { encounterHandlers } from './encounter-ops.ts';
import { undergroundHandlers } from './underground-ops.ts';
import { appearanceHandlers } from './appearance-ops.ts';
import { mysteryGiftHandlers } from './mystery-gift-ops.ts';
import { hofHandlers } from './hof-ops.ts';
import { villaHandlers } from './villa-ops.ts';
import { journalHandlers } from './journal-ops.ts';
import { tvHandlers } from './tv-ops.ts';
import { npcHandlers } from './npc-ops.ts';
import { townFieldHandlers } from './town-field-ops.ts';

/** Fixed native vars, looked up by `sourceIndex` in the vars registry. */
export const NATIVE_VARS = { PLAYER_STARTER: 0x4030, SCRIPT_PARAMETER_0: 0x8000, LAST_TALKED: 0x800d } as const;
export const CALL_STACK_SLOTS = 20;
/** Commands per context per tick before we call it an infinite loop. */
/** Decomp SE_CONFIRM (sequence 1500): the message boxes' and menus' sound. */
const SE_CONFIRM = 1500;
const MAX_COMMANDS_PER_RUN = 100_000;
/** Iterations allowed for a runImmediate script (they must not block). */
const MAX_IMMEDIATE_ITERATIONS = 10_000;
const POCKETS = ['items', 'medicine', 'balls', 'tmhms', 'berries', 'mail', 'battleitems', 'keyitems'];
/**
 * Pocket names are texts of decomp TEXT_BANK_BAG_POCKET_NAMES_WITH_ICONS (pl_msg bank 396, what
 * StringTemplate_SetBagPocketName reads), one message per pocket in POCKETS order. The importer names
 * them by their decomp message ids.
 */
const pocketNameText = (pocket: number) => `platinum:pl_msg_00000396_${String(pocket).padStart(5, '0')}` as Id;
/** Item ids of the Plates (decomp ITEM_FLAME_PLATE..ITEM_IRON_PLATE). */
const PLATES = { first: 298, last: 313 };
const DIRS: Facing[] = ['up', 'down', 'left', 'right'];
const DIR_BUTTONS: Button[] = ['up', 'down', 'left', 'right'];
/** "Now choose! Which Pokémon will it be?" in the starter scene's bank. */
const CHOOSE_STARTER_PROMPT = 7;

export type Wait = (input: InputFrame) => boolean;

export interface Context {
  label: Id;
  cmds: Command[];
  pc: number;
  stack: { label: Id; cmds: Command[]; pc: number }[];
  state: 'running' | 'waiting' | 'stopped';
  wait: Wait | null;
  cmp: number;
}

export interface Thread {
  /** The label the thread started at (trainer scripts derive the trainer id from it). */
  label: Id;
  zone: Id;
  contexts: (Context | null)[];
  subActive: boolean;
  temps: Map<Id, number>;
  slots: (string | undefined)[];
  lastTalked: number | undefined;
  chosenStarter: number | null;
  /** Loaded prop animations by tag (decomp ANIMATION_TAG_*): a door at a tile, or the PC (load_pc_animation). */
  doors: Map<number, { x: number; z: number } | 'pc'>;
  immediate: boolean;
  trainer: ScriptStart['trainer'];
  /** Approach tasks started per approach slot (decomp SCRIPT_MANAGER_TRAINER_n_TASK). */
  approaching: boolean[];
  /** Player state bits requested by set_player_state (decomp PlayerAvatar request bits). */
  playerStateRequest: number;
  /** Tick hooks of background tasks that write a var when done (decomp SysTasks such as obstacle animations). */
  tasks: (() => boolean)[];
  /** The scripted menu's result var (decomp ctx->data[0] of the menu commands). */
  menuVar: Id | null;
  /** Decomp FieldSystem_ShowStartMenu: the start menu opens when this script ends. */
  startMenu: boolean;
  /** Turn away when a nurse conversation that actually healed finishes (not DS: m3a-ops.ts). */
  turnAfterHealing: Facing | null;
}

export type Result = 'continue' | 'yield';
export type Handler = (t: Thread, c: Context, args: Arg[]) => Result;

/** Signpost window (decomp overlay005/signpost.c): its kind, Y offset below rest (0–48) and pending command. */
interface Signpost {
  kind: SignpostKind;
  offset: number;
  command: number;
}
/** Decomp SIGNPOST_CMD_*. */
export const SIGNPOST_CMD = { none: 0, draw: 1, scrollOut: 2, scrollIn: 3, remove: 4 } as const;
export const SIGNPOST_KINDS: SignpostKind[] = ['map', 'arrow', 'landmark', 'scrolling'];
const SIGNPOST_HIDDEN = 48;

export const createScriptRunner: CreateScriptRunner = (deps) => new Runner(deps);

export class Runner implements ScriptRunner {
  thread: Thread | null = null;
  tick = 0;
  readonly backgroundTasks = new Set<() => void>();
  lastTouch: InputFrame['touch'] = null;
  /** This tick's input, for commands that read the keys directly (decomp gSystem.heldKeys: `check_ab_press`). */
  input: InputFrame = { held: [], pressed: [], touch: null };
  ui: {
    /** `font`: `message_unown`'s FONT_UNOWN. */
    message: { printer: TextPrinter; font?: 'unown' } | null;
    buttonWait: boolean;
    /** wait_ab_press / wait_ab_pad_press: a wait for A or B without the arrow (`ScriptView.waitsForAB`). */
    abWait: boolean;
    yesNo: { cursor: 0 | 1 } | null;
    menu: ScriptMenu | null;
    signpost: Signpost | null;
    panel: PanelView;
    /** The current-floor window (m1b-ops show_current_floor) and the var that closes it at 0xFFFF. */
    floorWindow: { view: NonNullable<ScriptView['floorWindow']>; thread: Thread; closeVar: Id } | null;
    /** The money window (m3a-ops show_money … hide_money). */
    moneyWindow: NonNullable<ScriptView['moneyWindow']> | null;
    /** The Pokémon preview (m6-ops draw_pokemon_preview … remove_pokemon_preview). */
    pokemonPreview: NonNullable<ScriptView['pokemonPreview']> | null;
    /** The Battle Points window (frontier-field-ops show_battle_points … hide_battle_points). */
    bpWindow: NonNullable<ScriptView['bpWindow']> | null;
    /** The coin window (game-corner-ops show_coins … hide_coins). */
    coinWindow: NonNullable<ScriptView['coinWindow']> | null;
    /** The save info window (open_save_info … close_save_info). */
    saveInfo: NonNullable<ScriptView['saveInfo']> | null;
    savingIcon: boolean;
  } = {
    message: null,
    buttonWait: false,
    abWait: false,
    yesNo: null,
    menu: null,
    floorWindow: null,
    moneyWindow: null,
    pokemonPreview: null,
    bpWindow: null,
    coinWindow: null,
    saveInfo: null,
    savingIcon: false,
    signpost: null,
    panel: { kind: 'idle', title: '' },
  };
  readonly registries: Registries;
  readonly labels: Labels;
  readonly state: GameState;
  readonly fieldFn: () => FieldHost;
  readonly rng: () => number;
  /** Field message delay per character (the game's text speed option). */
  readonly textSpeed: () => number;
  readonly log: StubLog;
  readonly battleLog: Parameters<CreateScriptRunner>[0]['battleLog'];
  readonly audio: Parameters<CreateScriptRunner>[0]['audio'];
  /** The game clock (ops that read the RTC directly); the field's time of day is `state.gameTime.now`. */
  readonly clock: Parameters<CreateScriptRunner>[0]['clock'];
  readonly handlers: Record<string, Handler>;
  readonly bySource = new Map<string, Map<number, Id>>();
  /** Ops seen by this runner (coverage). */
  readonly seen = new Set<string>();
  /** A script that asked for the start menu has ended; the app takes the request (takeStartMenuRequest). */
  private startMenuReady = false;
  /** The menu app a script op waits on (ScriptView.app), and its result once the game calls appDone. */
  app: { request: AppRequest; result: AppResult | null } | null = null;
  /** A field message outside any script (`notice`): open until A, B or the d-pad after it has printed. */
  private noticeOpen = false;
  /** A field question outside any script (`ask`): its answer, run when the YES/NO box closes. */
  private question: ((yes: boolean) => void) | null = null;
  /** The open notice closes on A or B only (a `{ markup }` notice). */
  private abOnly = false;
  /** The Battle Tower challenge (decomp fieldSystem->battleTower), from InitBattleTower to FreeBattleTower. */
  tower: BattleTower | null = null;
  /** The Battle Frontier scene a field script waits on (`launch_battle_frontier_scene`). */
  frontier: FrontierRunner | null = null;
  private readonly savesDep: ScriptSaves | undefined;

  constructor(deps: Parameters<CreateScriptRunner>[0]) {
    this.registries = deps.registries;
    this.labels = deps.labels;
    this.state = deps.state;
    this.fieldFn = deps.field;
    this.rng = deps.rng;
    this.textSpeed = deps.textSpeed;
    this.log = deps.log;
    this.battleLog = deps.battleLog;
    this.audio = deps.audio;
    this.clock = deps.clock;
    this.savesDep = deps.saves;
    this.handlers = this.makeHandlers();
  }

  // ---------------------------------------------------------------- ScriptRunner

  start(start: ScriptStart): void {
    if (this.thread || this.noticeOpen) throw new Error(`script ${start.label}: a script or field message is already running`);
    this.startMenuReady = false;
    this.thread = this.newThread(start, false);
  }

  takeStartMenuRequest(): boolean {
    const ready = this.startMenuReady;
    this.startMenuReady = false;
    return ready;
  }

  appDone(result: AppResult): void {
    if (!this.app || this.app.result) throw new Error(`appDone(${result.app}): no script waits on an app`);
    if (result.app !== this.app.request.app) throw new Error(`appDone(${result.app}): the script waits on ${this.app.request.app}`);
    this.app.result = result;
  }

  /** Yields until the game has run the app (decomp: the script waits on the field task of the application). */
  openApp(c: Context, request: AppRequest, done: (result: AppResult) => void): Result {
    if (this.app) throw new Error(`open ${request.app}: the script already waits on ${this.app.request.app}`);
    this.app = { request, result: null };
    return this.pause(c, () => {
      const result = this.app?.result;
      if (!result) return false;
      this.app = null;
      done(result);
      return true;
    });
  }

  /** Decomp FieldMap_Init: the zone's on-load script, the field's dynamic features, then its on-resume script. */
  fieldReturn(): void {
    const zone = this.registries.zones.get(this.state.player.zone);
    if (!zone) throw new Error(`field return: unknown zone ${this.state.player.zone}`);
    if (zone.mapScripts.onLoad) this.runImmediate({ label: zone.mapScripts.onLoad, zone: zone.id, source: 'load' });
    this.field.fieldReturned();
    if (zone.mapScripts.onResume) this.runImmediate({ label: zone.mapScripts.onResume, zone: zone.id, source: 'resume' });
  }

  runImmediate(start: ScriptStart): void {
    const t = this.newThread(start, true);
    const idle: InputFrame = { held: [], pressed: [], touch: null };
    for (let i = 0; i < MAX_IMMEDIATE_ITERATIONS; i++) {
      this.runThread(t, idle);
      if (t.contexts.every((c) => !c)) return;
    }
    throw new Error(`runImmediate ${start.label}: did not finish (a map script must not block)`);
  }

  running(): boolean {
    return this.thread !== null || this.noticeOpen;
  }

  notice(text: Id | { markup: string }, slots: string[]): void {
    const what = typeof text === 'string' ? text : 'text';
    if (this.running()) throw new Error(`notice ${what}: a script or field message is running`);
    const markup = typeof text === 'string' ? this.registries.texts.get(text)?.text : text.markup;
    if (markup === undefined) throw new Error(`unknown text ${what}`);
    this.ui.message = { printer: new TextPrinter(toPrintOps(markup, slots), { speed: this.textSpeed(), canSpeedUp: true }) };
    this.noticeOpen = true;
    this.abOnly = typeof text !== 'string';
  }

  ask(text: Id, slots: string[], answer: (yes: boolean) => void): void {
    this.notice(text, slots);
    this.question = answer;
  }

  /** Decomp PrintRegisteredKeyItemUseMessage: once printed, A, B or the d-pad erases the box. A question shows YES/NO. */
  private stepNotice(input: InputFrame): void {
    const printer = this.ui.message?.printer;
    if (!printer) throw new Error('notice: the field message box is gone');
    if (!printer.done) return;
    if (this.question) return this.stepQuestion(input);
    this.ui.buttonWait = true;
    if (!has(input.pressed, 'a') && !has(input.pressed, 'b') && (this.abOnly || !DIR_BUTTONS.some((b) => has(input.pressed, b)))) return;
    this.ui.buttonWait = false;
    this.ui.message = null;
    this.noticeOpen = false;
  }

  /** The YES/NO box of `ask`, as `show_yes_no_menu` takes it. */
  private stepQuestion(input: InputFrame): void {
    const box = (this.ui.yesNo ??= { cursor: 0 });
    const before = box.cursor;
    let yes: boolean | null = null;
    if (has(input.pressed, 'a')) yes = box.cursor === 0;
    else if (has(input.pressed, 'b')) yes = false;
    else if (has(input.pressed, 'up')) box.cursor = 0;
    else if (has(input.pressed, 'down')) box.cursor = 1;
    if (yes !== null || box.cursor !== before) this.playFieldSe(SE_CONFIRM);
    if (yes === null) return;
    const answer = this.question!;
    this.question = null;
    this.ui.yesNo = null;
    this.ui.message = null;
    this.noticeOpen = false;
    answer(yes);
  }

  step(input: InputFrame): void {
    for (const task of this.backgroundTasks) task();
    this.tick++;
    if (this.noticeOpen) this.stepNotice(input);
    else if (this.thread) {
      // The frontier app runs in front of the field script that launched it (which waits until it exits).
      this.frontier?.step(input);
      const t = this.thread;
      this.runThread(t, input);
      t.tasks = t.tasks.filter((task) => !task());
      if (t.contexts.every((c) => !c)) {
        if (t.turnAfterHealing) this.field.turnPlayer(t.turnAfterHealing);
        this.thread = null;
        this.startMenuReady = t.startMenu;
        this.ui.buttonWait = false;
        this.ui.abWait = false;
        this.ui.menu = null;
        // A signpost that is scrolling out finishes after the script (the field runs its command).
        if (!this.ui.signpost || this.ui.signpost.command === SIGNPOST_CMD.none) {
          this.ui.message = null;
          this.ui.signpost = null;
        }
      }
    }
    this.stepSignpost();
    // Decomp CurrentFloorWindowSystaskCallback, every frame: the window closes once its var is 0xFFFF.
    const fw = this.ui.floorWindow;
    if (fw && this.getVar(fw.thread, fw.closeVar) === 0xffff) this.ui.floorWindow = null;
    const printer = this.ui.message?.printer;
    if (printer) {
      const ab = { pressed: has(input.pressed, 'a') || has(input.pressed, 'b'), held: has(input.held, 'a') || has(input.held, 'b') };
      // SE_CONFIRM for each press that ends a {clear}/{scroll} wait (decomp TextPrinter_Continue).
      for (let i = 0; i < 2; i++) if (printer.subStep(ab)) this.playFieldSe(SE_CONFIRM);
    }
    this.lastTouch = input.touch;
  }

  view(): ScriptView {
    const m = this.ui.message;
    const sp = this.ui.signpost;
    return {
      message: m ? { text: m.printer.text(), waitingForInput: m.printer.waiting || this.ui.buttonWait, ...(sp ? { signpost: { kind: sp.kind, offset: sp.offset } } : {}), ...(m.font ? { font: m.font } : {}) } : null,
      yesNo: this.ui.yesNo ? { ...this.yesNoLabels(), cursor: this.ui.yesNo.cursor } : null,
      menu: this.ui.menu?.shown ? this.ui.menu.view() : null,
      ...(this.ui.floorWindow ? { floorWindow: this.ui.floorWindow.view } : {}),
      ...(this.ui.moneyWindow ? { moneyWindow: { ...this.ui.moneyWindow } } : {}),
      ...(this.ui.pokemonPreview ? { pokemonPreview: { ...this.ui.pokemonPreview } } : {}),
      ...(this.ui.bpWindow ? { bpWindow: { ...this.ui.bpWindow } } : {}),
      ...(this.ui.coinWindow ? { coinWindow: { ...this.ui.coinWindow } } : {}),
      ...(this.ui.saveInfo ? { saveInfo: this.ui.saveInfo } : {}),
      ...(this.ui.savingIcon ? { savingIcon: true } : {}),
      ...(this.ui.abWait ? { waitsForAB: true as const } : {}),
      ...(this.frontier && !this.frontier.done ? { frontier: this.frontier.view() } : {}),
      panel: this.ui.panel,
      app: this.app && !this.app.result ? this.app.request : null,
    };
  }

  /** The field's per-tick signpost command (decomp Signpost_DoCurrentCommand: slides 16 px per tick). */
  stepSignpost(): void {
    const sp = this.ui.signpost;
    if (!sp) return;
    if (sp.command === SIGNPOST_CMD.scrollIn) {
      if (sp.offset === 0) sp.command = SIGNPOST_CMD.none;
      else sp.offset = Math.max(0, sp.offset - 16);
    } else if (sp.command === SIGNPOST_CMD.scrollOut) {
      if (sp.offset === SIGNPOST_HIDDEN) {
        this.ui.signpost = null;
        this.ui.message = null;
      } else sp.offset = Math.min(SIGNPOST_HIDDEN, sp.offset + 16);
    } else if (sp.command === SIGNPOST_CMD.remove) {
      this.ui.signpost = null;
      this.ui.message = null;
    } else if (sp.command === SIGNPOST_CMD.draw) sp.command = SIGNPOST_CMD.none;
  }

  /** Opens a signpost window (decomp Signpost_SetTypeAndNARCMemberIdx + SIGNPOST_CMD_DRAW: drawn 48 px low). */
  openSignpost(type: number): void {
    const kind = SIGNPOST_KINDS[type];
    if (!kind) throw new Error(`bad signpost type ${type}`);
    this.ui.signpost = { kind, offset: SIGNPOST_HIDDEN, command: SIGNPOST_CMD.none };
  }

  /** Message `index` of text bank `bank` (pl_msg number). */
  bankText(bank: number, index: number): Id {
    const b = this.registries.textBanks.get(this.source('textBanks', bank)!)!;
    const id = b.messages[index];
    if (!id) throw new Error(`text bank ${b.id} has no message ${index}`);
    return id;
  }

  /** Index of a text in a bank (scripts store message numbers in vars). */
  bankIndex(bank: number, text: Id): number {
    const b = this.registries.textBanks.get(this.source('textBanks', bank)!)!;
    const i = b.messages.indexOf(text);
    if (i < 0) throw new Error(`text ${text} is not in bank ${b.id}`);
    return i;
  }

  /** A text as one plain line (line breaks become spaces, format codes dropped), for panel titles. */
  plainText(id: Id): string {
    return toPrintOps(this.textOf(id))
      .map((op) => (op.kind === 'char' ? op.c : op.kind === 'newline' || op.kind === 'scroll' ? ' ' : ''))
      .join('');
  }

  /** A message as one plain line with slots (windows that print at TEXT_SPEED_NO_TRANSFER). */
  plainSlots(markup: string, slots: (string | undefined)[]): string {
    return toPrintOps(markup, slots)
      .map((op) => (op.kind === 'char' ? op.c : ''))
      .join('');
  }

  /** A text's message number in the bank that holds it (scripts store message numbers in vars). */
  indexInBank(text: Id): number {
    for (const b of this.registries.textBanks.values()) {
      const i = b.messages.indexOf(text);
      if (i >= 0) return i;
    }
    throw new Error(`text ${text} is in no text bank`);
  }

  /** The host's saves (CreateScriptRunner deps `saves`): the in-script save and the Battle Tower's reset. */
  saves(): ScriptSaves {
    if (!this.savesDep) throw new Error('this host has no saves (CreateScriptRunner deps.saves)');
    return this.savesDep;
  }

  /** A persistent field var or flag-free var by id, outside a thread (the frontier's system vars). */
  getFieldVar(id: Id): number {
    if (!this.thread) throw new Error(`field var ${id}: no field script runs`);
    return this.getVar(this.thread, id);
  }

  setFieldVar(id: Id, value: number): void {
    if (!this.thread) throw new Error(`field var ${id}: no field script runs`);
    this.setVar(this.thread, id, value);
  }

  /** The YES/NO box's labels (decomp Menu_MakeYesNoChoice: MenuEntries_Text_Yes and _No of the base pack). */
  private yesNoLabels(): { yes: string; no: string } {
    const ns = newGameRecord(this.registries).id.split(':')[0]!;
    return { yes: this.plainText(`${ns}:MenuEntries_Text_Yes` as Id), no: this.plainText(`${ns}:MenuEntries_Text_No` as Id) };
  }

  textOf(id: Id): string {
    const rec = this.registries.texts.get(id);
    if (!rec) throw new Error(`unknown text ${id}`);
    return rec.text;
  }

  // ---------------------------------------------------------------- execution

  newThread(start: ScriptStart, immediate: boolean): Thread {
    const t: Thread = {
      label: start.label,
      zone: start.zone,
      trainer: start.trainer,
      approaching: [],
      playerStateRequest: 0,
      tasks: [],
      menuVar: null,
      startMenu: false,
      turnAfterHealing: null,
      contexts: [this.newContext(start.label)],
      subActive: false,
      temps: new Map(),
      slots: [],
      lastTalked: start.lastTalked,
      chosenStarter: null,
      doors: new Map(),
      immediate,
    };
    if (start.lastTalked !== undefined) {
      const v = this.source('vars', NATIVE_VARS.LAST_TALKED, false);
      if (v) this.setVar(t, v, start.lastTalked);
    }
    // Script parameters (decomp FieldSystem_SetScriptParameters) live in VAR_0x8000.. .
    start.params?.forEach((value, i) => this.setVar(t, this.source('vars', NATIVE_VARS.SCRIPT_PARAMETER_0 + i)!, value));
    return t;
  }

  newContext(label: Id): Context {
    return { label, cmds: this.commands(label), pc: 0, stack: [], state: 'running', wait: null, cmp: 0 };
  }

  commands(label: Id): Command[] {
    const l = this.labels.get(label);
    if (!l) throw new Error(`script label ${label} does not exist`);
    return l.commands;
  }

  runThread(t: Thread, input: InputFrame): void {
    this.input = input;
    // Index loop: a sub context created by the main context runs in the same tick.
    for (let i = 0; i < t.contexts.length; i++) {
      const c = t.contexts[i];
      if (c && !this.runContext(t, c, input)) t.contexts[i] = null;
    }
  }

  /** One tick of a context; false when it has stopped. */
  runContext(t: Thread, c: Context, input: InputFrame): boolean {
    if (c.state === 'stopped') return false;
    if (c.state === 'waiting') {
      if (c.wait!(input)) {
        c.state = 'running';
        c.wait = null;
      }
      return true;
    }
    for (let n = 0; n < MAX_COMMANDS_PER_RUN; n++) {
      const cmd = c.cmds[c.pc];
      if (!cmd) throw new Error(`script ${c.label} ran past its last command`);
      c.pc++;
      this.seen.add(cmd.op);
      const h = this.handlers[cmd.op];
      let r: Result;
      if (!h) r = this.fallback(t, cmd);
      else {
        try {
          r = h(t, c, cmd.args);
        } catch (e) {
          throw new Error(`script ${c.label}[${c.pc - 1}] ${cmd.op}: ${(e as Error).message}`, { cause: e });
        }
      }
      if ((c.state as Context['state']) === 'stopped') return false;
      if (r === 'yield') return true;
    }
    throw new Error(`script ${c.label}: more than ${MAX_COMMANDS_PER_RUN} commands without yielding`);
  }

  /**
   * An op without a handler: a classified stub returns its bucket default (0 in every destination var, no
   * wait) and is logged once as `stub:<op>`; an unclassified op is a logged no-op (`cmd:<op>`).
   */
  fallback(t: Thread, cmd: Command): Result {
    const cls = classifyOp(cmd.op);
    if (cls.status !== 'stubbed') {
      this.log.stub(`cmd:${cmd.op}`, `unimplemented script command ${cmd.op} (no-op)`);
      return 'continue';
    }
    const spec = COMMAND_BY_NAME.get(cmd.op)!;
    for (const i of stubDefault(spec).zero) {
      const a = cmd.args[i];
      if (a?.kind === 'var') this.setVar(t, a.id, 0);
    }
    if (cls.default === 'buffers an empty string') t.slots[this.int(cmd.args[0])] = '';
    this.log.stub(`stub:${cmd.op}`, `${cls.bucket} stub (${cls.milestone}): ${cls.default}`);
    return 'continue';
  }

  pause(c: Context, wait: Wait): Result {
    c.state = 'waiting';
    c.wait = wait;
    return 'yield';
  }

  jump(c: Context, label: Id): void {
    c.label = label;
    c.cmds = this.commands(label);
    c.pc = 0;
  }

  call(c: Context, label: Id): void {
    if (c.stack.length + 1 < CALL_STACK_SLOTS) c.stack.push({ label: c.label, cmds: c.cmds, pc: c.pc });
    // The DS drops the push when the stack is full (the later `return` goes one frame further up).
    else this.log.stub('vm:call-stack-overflow', `call to ${label} from ${c.label} with ${c.stack.length} frames: the return frame is dropped, as on the DS`);
    this.jump(c, label);
  }

  // ---------------------------------------------------------------- state access

  /** The game's main stream as a core `Rng` (Pokémon creation). */
  rngSource(): Rng {
    return { next: () => this.rng() >>> 0, below: (n: number) => (this.rng() >>> 0) % n };
  }

  /** A sequence by its SDAT name (`SEQ_SE_DP_GAGAGA`), or undefined (logged) when the packs have none. */
  namedSequence(name: string): Id | undefined {
    for (const s of this.registries.sequences.values()) if (s.id.endsWith(`:${name}`)) return s.id;
    this.log.stub('audio:sequence-missing', `no sequence ${name} in the packs: not played`);
    return undefined;
  }

  playFieldSe(source: number): void {
    const id = this.source('sequences', source, false);
    if (id) this.audio.playSe(id);
    else this.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${source} in the packs: not played`);
  }

  source(registry: 'vars' | 'flags' | 'species' | 'items' | 'zones' | 'trainers' | 'textBanks' | 'weathers' | 'sequences', sourceIndex: number, required = true): Id | undefined {
    let m = this.bySource.get(registry);
    if (!m) {
      m = new Map();
      for (const r of this.registries[registry].values()) if (r.sourceIndex !== undefined) m.set(r.sourceIndex, r.id);
      this.bySource.set(registry, m);
    }
    const id = m.get(sourceIndex);
    if (!id && required) throw new Error(`no ${registry} record with sourceIndex ${sourceIndex}`);
    return id;
  }

  varRecord(id: Id) {
    const r = this.registries.vars.get(id);
    if (!r) throw new Error(`unknown var ${id}`);
    return r;
  }

  getVar(t: Thread, id: Id): number {
    const r = this.varRecord(id);
    return (r.scope === 'temp' ? t.temps.get(id) : this.state.vars[id]) ?? r.initial;
  }

  setVar(t: Thread, id: Id, value: number): void {
    const r = this.varRecord(id);
    const v = value & 0xffff;
    if (r.scope === 'temp') t.temps.set(id, v);
    else if (v === r.initial) delete this.state.vars[id];
    else this.state.vars[id] = v;
  }

  getFlag(id: Id): boolean {
    const r = this.registries.flags.get(id);
    if (!r) throw new Error(`unknown flag ${id}`);
    return this.state.flags[id] ?? r.initial;
  }

  setFlag(id: Id, value: boolean): void {
    const r = this.registries.flags.get(id);
    if (!r) throw new Error(`unknown flag ${id}`);
    if (value === r.initial) delete this.state.flags[id];
    else this.state.flags[id] = value;
  }

  /** Var-or-value operand. */
  val(t: Thread, a: Arg | undefined): number {
    if (a?.kind === 'int') return a.value;
    if (a?.kind === 'var') return this.getVar(t, a.id);
    throw new Error(`expected an int or var operand, got ${JSON.stringify(a)}`);
  }

  ref(a: Arg | undefined, kind: Arg['kind']): Id {
    if (a && a.kind === kind && 'id' in a) return a.id;
    throw new Error(`expected a ${kind}(...) operand, got ${JSON.stringify(a)}`);
  }

  int(a: Arg | undefined): number {
    if (a?.kind === 'int') return a.value;
    throw new Error(`expected an int operand, got ${JSON.stringify(a)}`);
  }

  get field(): FieldHost {
    return this.fieldFn();
  }

  // ---------------------------------------------------------------- UI

  /** Decomp ScriptMessage_Show: `canSpeedUp` is its canSkipDelay (A/B speed up), `autoScroll` the options' autoScroll. */
  showMessage(t: Thread, text: Id, speed: number, opts: { canSpeedUp?: boolean; autoScroll?: { skip: boolean } } = {}): TextPrinter {
    const rec = this.registries.texts.get(text);
    if (!rec) throw new Error(`unknown text ${text}`);
    const printer = new TextPrinter(toPrintOps(rec.text, t.slots), { speed, canSpeedUp: opts.canSpeedUp ?? true, ...(opts.autoScroll ? { autoScroll: opts.autoScroll } : {}) });
    this.ui.message = { printer };
    return printer;
  }

  waitButton(t: Thread): Wait {
    this.ui.buttonWait = true;
    return (input) => {
      let done = has(input.pressed, 'a') || has(input.pressed, 'b');
      // A d-pad press turns the player and ends the wait (decomp ScriptContext_CheckABXPadPress).
      const dir = done ? -1 : DIR_BUTTONS.findIndex((b) => has(input.pressed, b));
      if (dir >= 0) {
        this.field.turnPlayer(DIRS[dir]!);
        done = true;
      }
      // X opens the start menu once the script ends (decomp ScriptContext_CheckABXPadPress → FieldSystem_ShowStartMenu).
      if (!done && has(input.pressed, 'x')) {
        t.startMenu = true;
        done = true;
      }
      if (done) this.ui.buttonWait = false;
      return done;
    };
  }

  starterOptions() {
    const list = [...this.registries.species.values()].filter((s) => s.starterSlot !== undefined).sort((a, b) => a.starterSlot! - b.starterSlot!);
    if (!list.length) throw new Error('no species with a starterSlot');
    return list;
  }

  speciesName(sourceIndex: number): string {
    return this.registries.species.get(this.source('species', sourceIndex)!)!.name;
  }

  itemRecord(sourceIndex: number) {
    return this.registries.items.get(this.source('items', sourceIndex)!)!;
  }

  // ---------------------------------------------------------------- commands

  makeHandlers(): Record<string, Handler> {
    const cont = (): Result => 'continue';
    const stub =
      (key: string, detail: string, r: Result = 'continue'): Handler =>
      () => {
        this.log.stub(`stub:${key}`, detail);
        return r;
      };
    const compare = (a: number, b: number) => (a < b ? 0 : a === b ? 1 : 2);
    const flagCmd = (value: boolean): Handler => (_t, _c, a) => (this.setFlag(this.ref(a[0], 'flag'), value), 'continue');
    const setDest = (t: Thread, a: Arg | undefined, v: number) => this.setVar(t, this.ref(a, 'var'), v);
    const dirOf = (f: Facing) => DIRS.indexOf(f);
    const facingOf = (d: number) => {
      const f = DIRS[d];
      if (!f) throw new Error(`bad direction ${d}`);
      return f;
    };
    const condJump =
      (isCall: boolean): Handler =>
      (_t, c, a) => {
        const cond = a[0]?.kind === 'string' ? (CONDITIONS as readonly string[]).indexOf(a[0].value) : -1;
        if (cond < 0) throw new Error(`bad condition ${JSON.stringify(a[0])}`);
        const hit = [
          [true, false, false],
          [false, true, false],
          [false, false, true],
          [true, true, false],
          [false, true, true],
          [true, false, true],
        ][cond]![c.cmp];
        if (hit) (isCall ? this.call : this.jump).call(this, c, this.ref(a[1], 'label'));
        return 'continue';
      };

    return {
      noop: cont,
      dummy: cont,
      end: (_t, c) => ((c.state = 'stopped'), 'continue'),
      wait_time: (t, c, a) => {
        const frames = this.int(a[0]);
        const v = this.ref(a[1], 'var');
        this.setVar(t, v, frames);
        return this.pause(c, () => {
          const left = (this.getVar(t, v) - 1) & 0xffff;
          this.setVar(t, v, left);
          return left === 0;
        });
      },
      compare_var_to_value: (t, c, a) => ((c.cmp = compare(this.getVar(t, this.ref(a[0], 'var')), this.int(a[1]))), 'continue'),
      compare_var_to_var: (t, c, a) => ((c.cmp = compare(this.getVar(t, this.ref(a[0], 'var')), this.getVar(t, this.ref(a[1], 'var')))), 'continue'),
      call_common_script: (t, c, a) => {
        if (t.contexts[1]) throw new Error('a common script is already running');
        t.contexts[1] = this.newContext(this.ref(a[0], 'label'));
        t.subActive = true;
        return this.pause(c, () => !t.subActive);
      },
      return_common_script: (t) => ((t.subActive = false), 'continue'),
      go_to: (_t, c, a) => (this.jump(c, this.ref(a[0], 'label')), 'continue'),
      call: (_t, c, a) => (this.call(c, this.ref(a[0], 'label')), 'continue'),
      return: (_t, c) => {
        const r = c.stack.pop();
        if (!r) c.state = 'stopped';
        else Object.assign(c, r);
        return 'continue';
      },
      go_to_if: condJump(false),
      call_if: condJump(true),
      set_flag: flagCmd(true),
      clear_flag: flagCmd(false),
      check_flag: (_t, c, a) => ((c.cmp = this.getFlag(this.ref(a[0], 'flag')) ? 1 : 0), 'continue'),
      add_var: (t, _c, a) => {
        const v = this.ref(a[0], 'var');
        this.setVar(t, v, this.getVar(t, v) + this.val(t, a[1]));
        return 'continue';
      },
      sub_var: (t, _c, a) => {
        const v = this.ref(a[0], 'var');
        this.setVar(t, v, this.getVar(t, v) - this.val(t, a[1]));
        return 'continue';
      },
      set_var_from_value: (t, _c, a) => (setDest(t, a[0], this.int(a[1])), 'continue'),
      set_var_from_var: (t, _c, a) => (setDest(t, a[0], this.getVar(t, this.ref(a[1], 'var'))), 'continue'),

      // messages
      message: (t, c, a) => {
        const p = this.showMessage(t, this.ref(a[0], 'text'), this.textSpeed());
        return this.pause(c, () => p.done);
      },
      // Decomp ScrCmd_MessageInstant → ScriptMessage_ShowInstant: the whole message at once; the script goes on.
      message_instant: (t, _c, a) => (this.showMessage(t, this.ref(a[0], 'text'), TEXT_SPEED.instant), 'continue'),
      wait_button: (t, c) => this.pause(c, this.waitButton(t)),
      close_message: () => ((this.ui.message = null), 'continue'),
      show_yes_no_menu: (t, c, a) => {
        const dest = this.ref(a[0], 'var');
        const box = (this.ui.yesNo = { cursor: 0 as 0 | 1 });
        return this.pause(c, (input) => {
          const before = box.cursor;
          let result: number | null = null;
          if (has(input.pressed, 'a')) result = box.cursor;
          else if (has(input.pressed, 'b')) result = 1;
          else if (has(input.pressed, 'up')) box.cursor = 0;
          else if (has(input.pressed, 'down')) box.cursor = 1;
          if (result !== null || box.cursor !== before) this.playFieldSe(SE_CONFIRM);
          if (result === null) return false;
          this.setVar(t, dest, result);
          this.ui.yesNo = null;
          return true;
        });
      },
      // Signposts (decomp scrcmd.c Signpost commands; the window slides in/out in stepSignpost).
      draw_signpost_text_box: (t, _c, a) => {
        this.openSignpost(this.int(a[0]));
        this.ui.message = { printer: new TextPrinter([], { speed: TEXT_SPEED.instant }) };
        return 'yield';
      },
      set_signpost_command: (_t, _c, a) => {
        const sp = this.ui.signpost;
        if (!sp) throw new Error('set_signpost_command with no signpost');
        sp.command = this.int(a[0]);
        if (sp.command === SIGNPOST_CMD.draw) sp.offset = SIGNPOST_HIDDEN;
        return 'yield';
      },
      wait_for_signpost_done: (_t, c) => (!this.ui.signpost || this.ui.signpost.command === SIGNPOST_CMD.none ? 'continue' : this.pause(c, () => !this.ui.signpost || this.ui.signpost.command === SIGNPOST_CMD.none)),
      draw_signpost_instant_message: (t, _c, a) => {
        this.openSignpost(this.int(a[1]));
        this.showMessage(t, this.ref(a[0], 'text'), TEXT_SPEED.instant);
        return 'yield';
      },
      draw_signpost_scrolling_message: (t, c, a) => {
        const p = this.showMessage(t, this.ref(a[0], 'text'), this.textSpeed());
        const dest = this.ref(a[1], 'var');
        return this.pause(c, (input) => {
          let r: number | null = null;
          const dir = DIR_BUTTONS.findIndex((b) => has(input.pressed, b));
          if (p.done) r = 2;
          else if (dir >= 0) {
            this.field.turnPlayer(DIRS[dir]!);
            r = 0;
          } else if (has(input.pressed, 'x')) r = 1;
          if (r === null) return false;
          this.setVar(t, dest, r);
          return true;
        });
      },
      get_signpost_input: (t, c, a) => {
        const dest = this.ref(a[0], 'var');
        return this.pause(c, (input) => {
          let r: number | null = null;
          const dir = DIR_BUTTONS.findIndex((b) => has(input.pressed, b));
          if (has(input.pressed, 'a') || has(input.pressed, 'b')) r = 0;
          else if (dir >= 0) {
            this.field.turnPlayer(DIRS[dir]!);
            r = 0;
          } else if (has(input.pressed, 'x')) r = 1;
          if (r === null) return false;
          this.setVar(t, dest, r);
          return true;
        });
      },
      show_start_menu: (t) => ((t.startMenu = true), 'continue'),

      // objects and camera
      apply_movement: (t, _c, a) => (this.field.applyMovement(this.val(t, a[0]), this.ref(a[1], 'movement')), 'continue'),
      wait_movement: (_t, c) => this.pause(c, () => this.field.movementDone('all')),
      lock_all: (_t, c) => {
        this.field.lockAll();
        // Decomp ScrCmd_LockAll: a partner follower that is mid-step finishes its step first.
        if (this.state.hasPartner && this.field.objectMoving(LOCALID_FOLLOWER)) return this.pause(c, () => !this.field.objectMoving(LOCALID_FOLLOWER));
        return 'yield';
      },
      release_all: () => (this.field.releaseAll(), 'yield'),
      lock_object: (t, _c, a) => (this.field.lockObject(this.val(t, a[0])), 'continue'),
      add_object: (t, _c, a) => (this.field.addObject(this.val(t, a[0])), 'continue'),
      remove_object: (t, _c, a) => (this.field.removeObject(this.val(t, a[0])), 'continue'),
      add_free_camera: (t, _c, a) => (this.field.addFreeCamera(this.val(t, a[0]), this.val(t, a[1])), 'continue'),
      restore_camera: () => (this.field.restoreCamera(), 'continue'),
      face_player: (t) => {
        if (t.lastTalked !== undefined) this.field.facePlayer(t.lastTalked);
        return 'continue';
      },
      get_player_map_pos: (t, _c, a) => {
        const p = this.field.player();
        setDest(t, a[0], p.x);
        setDest(t, a[1], p.z);
        return 'continue';
      },
      get_player_dir: (t, _c, a) => (setDest(t, a[0], dirOf(this.field.player().facing)), 'continue'),
      set_object_flag_is_persistent: (t, _c, a) => (this.field.setObjectPersistent(this.val(t, a[0]), this.int(a[1]) !== 0), 'continue'),
      set_movement_type: (t, _c, a) => (this.field.switchMovementType(this.val(t, a[0]), this.val(t, a[1])), 'continue'),
      set_object_event_movement_type: (t, _c, a) => (this.field.setObjectMovementType(this.val(t, a[0]), this.val(t, a[1])), 'continue'),
      set_object_event_pos: (t, _c, a) => (this.field.setObjectPosition(this.val(t, a[0]), this.val(t, a[1]), this.val(t, a[2])), 'continue'),
      set_object_event_dir: (t, _c, a) => (this.field.setObjectFacing(this.val(t, a[0]), facingOf(this.val(t, a[1]))), 'continue'),
      set_warp_event_pos: (t, _c, a) => (this.field.setWarpPosition(this.val(t, a[0]), this.val(t, a[1]), this.val(t, a[2])), 'continue'),

      // screen and warps
      fade_screen: (_t, _c, a) => {
        const [steps, framesPerStep, type, color] = [this.int(a[0]), this.int(a[1]), this.int(a[2]), this.int(a[3])];
        this.field.fade(type % 2 === 0 ? 'out' : 'in', steps * framesPerStep, color === 0 ? 'black' : 'white');
        return 'continue';
      },
      wait_fade_screen: (_t, c) => this.pause(c, () => this.field.fadeDone()),
      warp: (t, c, a) => {
        const zone = this.source('zones', this.val(t, a[0]))!;
        this.field.warp(zone, this.val(t, a[2]), this.val(t, a[3]), facingOf(this.val(t, a[4])));
        return this.pause(c, () => this.field.warpDone());
      },
      load_door_animation: (t, _c, a) => {
        t.doors.set(this.int(a[4]), { x: this.int(a[0]) * 32 + this.val(t, a[2]), z: this.int(a[1]) * 32 + this.val(t, a[3]) });
        return 'continue';
      },
      play_door_open_animation: (t, _c, a) => this.door(t, this.int(a[0]), 'open'),
      play_door_close_animation: (t, _c, a) => this.door(t, this.int(a[0]), 'close'),
      wait_for_animation: (_t, c) => this.pause(c, () => this.field.doorDone()),
      unload_animation: (t, _c, a) => (t.doors.delete(this.int(a[0])), 'continue'),
      // Decomp ScrCmd_LoadPCAnimation / PlayPCBootUpAnimation / PlayPCShutDownAnimation (pc_animation.c): the loaded
      // PC's one-shot clips 0 and 1 under the tag; wait_for_animation waits on them.
      load_pc_animation: (t, _c, a) => (t.doors.set(this.int(a[0]), 'pc'), 'continue'),
      play_pc_boot_up_animation: (t, _c, a) => this.pc(t, this.int(a[0]), 'pc-on'),
      play_pc_shut_down_animation: (t, _c, a) => this.pc(t, this.int(a[0]), 'pc-off'),

      // strings
      buffer_player_name: (t, _c, a) => ((t.slots[this.int(a[0])] = plainMarkup(this.state.names.player)), 'continue'),
      buffer_rival_name: (t, _c, a) => ((t.slots[this.int(a[0])] = plainMarkup(this.state.names.rival)), 'continue'),
      buffer_item_name: (t, _c, a) => ((t.slots[this.int(a[0])] = this.itemRecord(this.val(t, a[1])).name), 'continue'),
      buffer_pocket_name: (t, _c, a) => {
        const pocket = this.val(t, a[1]);
        if (pocket >= POCKETS.length) throw new Error(`bad pocket ${pocket}`);
        const rec = this.registries.texts.get(pocketNameText(pocket));
        if (!rec) throw new Error(`buffer_pocket_name: no text ${pocketNameText(pocket)}`);
        t.slots[this.int(a[0])] = rec.text;
        return 'continue';
      },
      buffer_rival_starter_species_name: (t, _c, a) => ((t.slots[this.int(a[0])] = this.rivalStarter(t).name), 'continue'),

      // items and party
      get_item_pocket: (t, _c, a) => {
        const pocket = this.itemRecord(this.val(t, a[0])).pocket;
        const i = newGameRecord(this.registries).pockets.findIndex((p) => p.name === pocket);
        if (i < 0) throw new Error(`unknown pocket "${pocket}"`);
        setDest(t, a[1], i);
        return 'continue';
      },
      check_item_is_plate: (t, _c, a) => {
        const item = this.val(t, a[0]);
        setDest(t, a[1], item >= PLATES.first && item <= PLATES.last ? 1 : 0);
        return 'continue';
      },
      start_choose_starter_scene: (t, c) => {
        const options = this.starterOptions();
        // The prompt the DS prints over the choice (decomp choose_starter_app.c: bank 360, entry 7).
        const title = this.plainText(this.bankText(BANKS.chooseStarter, CHOOSE_STARTER_PROMPT));
        const panel = { kind: 'choice' as const, title, options: options.map((s) => ({ id: s.id, label: s.name })), cursor: 0 };
        this.ui.panel = panel;
        return this.pause(c, (input) => {
          let pick = -1;
          if (input.touch && input.touch.screen !== 'main' && !this.lastTouch) pick = hitChoice(options.length, input.touch);
          if (pick < 0) {
            if (has(input.pressed, 'up') || has(input.pressed, 'left')) panel.cursor = Math.max(0, panel.cursor - 1);
            else if (has(input.pressed, 'down') || has(input.pressed, 'right')) panel.cursor = Math.min(options.length - 1, panel.cursor + 1);
            else if (has(input.pressed, 'a')) pick = panel.cursor;
          }
          if (pick < 0) return false;
          panel.cursor = pick;
          t.chosenStarter = options[pick]!.sourceIndex ?? null;
          if (t.chosenStarter === null) throw new Error(`starter ${options[pick]!.id} has no sourceIndex`);
          this.ui.panel = { kind: 'idle', title: '' };
          return true;
        });
      },
      save_chosen_starter: (t) => {
        if (t.chosenStarter === null) throw new Error('save_chosen_starter before start_choose_starter_scene');
        this.setVar(t, this.source('vars', NATIVE_VARS.PLAYER_STARTER)!, t.chosenStarter);
        return 'continue';
      },
      get_player_starter_species: (t, _c, a) => (setDest(t, a[0], this.getVar(t, this.source('vars', NATIVE_VARS.PLAYER_STARTER)!)), 'continue'),
      // Decomp ScrCmd_ReturnToField → FieldTransition_StartMap: the field map starts again after the script's app.
      return_to_field: () => (this.fieldReturn(), 'yield'),

      // player and system
      get_player_gender: (t, _c, a) => (setDest(t, a[0], this.state.gender === 'male' ? 0 : 1), 'continue'),
      set_has_partner: () => ((this.state.hasPartner = true), 'continue'),
      clear_has_partner: () => ((this.state.hasPartner = false), 'continue'),
      give_running_shoes: () => ((this.state.runningShoes = true), 'continue'),
      check_running_shoes_acquired: (t, _c, a) => (setDest(t, a[0], this.state.runningShoes ? 1 : 0), 'continue'),
      set_step_flag: stub('set_step_flag', 'step flag not modelled'),
      // Decomp ScrCmd_GetTimeOfDay (FieldSystem_GetTimeOfDay): the saved GameTime's hour, TIMEOFDAY_* order.
      get_time_of_day: (t, _c, a) => (setDest(t, a[0], DAY_PERIODS.indexOf(dayPeriod(this.state.gameTime.now.hour))), 'continue'),
      get_random: (t, _c, a) => {
        const bound = this.val(t, a[1]);
        if (!bound) throw new Error('get_random with bound 0');
        setDest(t, a[0], (this.rng() >>> 0) % bound);
        return 'yield';
      },
      // Decomp ScrCmd_GetRandom2 is the same handler as ScrCmd_GetRandom.
      get_random2: (t, c, a) => this.handlers.get_random!(t, c, a),
      ...m1aHandlers(this),
      ...m1bHandlers(this),
      ...partyHandlers(this),
      ...m3aHandlers(this),
      ...daycareHandlers(this),
      ...m3bPoketchHandlers(this),
      ...audioHandlers(this),
      ...m2aHandlers(this),
      ...m5Handlers(this),
      ...m6Handlers(this),
      ...gymHandlers(this),
      ...safariHandlers(this),
      ...dwHandlers(this),
      ...sceneHandlers(this),
      ...staticHandlers(this),
      ...formHandlers(this),
      ...hofHandlers(this),
      ...fieldSystemHandlers(this),
      ...sideHandlers(this),
      ...mysteryGiftHandlers(this),
      ...poffinHandlers(this),
      ...encounterHandlers(this),
      ...frontierFieldHandlers(this),
      ...undergroundHandlers(this),
      ...contestHandlers(this),
      ...galleryHandlers(this),
      ...sealHandlers(this),
      ...gameCornerHandlers(this),
      ...villaHandlers(this),
      ...journalHandlers(this),
      ...tvHandlers(this),
      ...npcHandlers(this),
      ...townFieldHandlers(this),
      ...appearanceHandlers(this),
    };
  }

  door(t: Thread, tag: number, kind: 'open' | 'close'): Result {
    const d = t.doors.get(tag);
    if (!d || d === 'pc') throw new Error(`door animation tag ${tag} not loaded`);
    this.field.playDoor(d.x, d.z, kind);
    return 'continue';
  }

  pc(t: Thread, tag: number, use: 'pc-on' | 'pc-off'): Result {
    if (t.doors.get(tag) !== 'pc') throw new Error(`PC animation tag ${tag} not loaded`);
    this.field.playPcAnimation(use);
    return 'continue';
  }

  /** Rival's starter: the next starter slot after the player's (Turtwig → Chimchar → Piplup → Turtwig). */
  rivalStarter(t: Thread) {
    const player = this.getVar(t, this.source('vars', NATIVE_VARS.PLAYER_STARTER)!);
    const options = this.starterOptions();
    const slot = options.findIndex((s) => s.sourceIndex === player);
    return options[(slot + 1) % options.length]!;
  }
}

const has = (list: readonly Button[], b: Button) => list.includes(b);
