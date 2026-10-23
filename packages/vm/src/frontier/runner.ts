/**
 * The Battle Frontier's script VM (decomp overlay 104: battle_frontier.c's app loop, frontier_script_manager.c,
 * frontier_script_context.c, frscrcmd*.c). It runs inside the field VM (`Runner.frontier`) while a field script waits
 * on `launch_battle_frontier_scene`: the field's message box, menus and yes/no box are the frontier's too
 * (`Runner.ui`), and its battles go through the field host as the field's do.
 *
 * Execution model, as the decomp's:
 * - A script manager holds up to 8 contexts (FrontierScriptManager ctx[8]), run in order each frame; a context runs
 *   commands until one returns TRUE (yields), a wait resumes on a later frame without running a command that frame.
 * - Vars: 0x8000–0x8007 are the context's own, 0x8008–0x800F the manager's (kept across a ChangeScript), 0x8010–0x8013
 *   the context's data words (commands use them as scratch too); any other value read as a var is that value.
 * - ChangeScript ends the context and changes the scene on the next frames (the app's states 5 and 6), ExitFrontier
 *   ends the frontier; a battle (a sub-app) suspends the scripts until it is done.
 * - Unimplemented commands log once (`frontier:<op>`) and do nothing, as the field VM's.
 */
import type { Arg, Command, Id } from '@opensinnoh/core';
import type { AppRequest, AppResult, FrontierSceneData, FrontierTables, FrontierView, InputFrame, Ui2dAnimation } from '@opensinnoh/contracts';
import { newGameRecord } from '@opensinnoh/contracts';
import type { BattleArcade, BattleCastle, BattleFactory, BattleHall, BattleTower } from '@opensinnoh/services';
import type { Runner } from '../runner.ts';
import { FRONTIER_VARS } from './commands.ts';
import { FrontierScene } from './scene.ts';
import { frontierHandlers } from './ops.ts';
import { towerFrontierHandlers } from './tower-ops.ts';
import { factoryFrontierHandlers } from './factory-ops.ts';
import { hallFrontierHandlers } from './hall-ops.ts';
import { castleFrontierHandlers } from './castle-ops.ts';
import { arcadeFrontierHandlers } from './arcade-ops.ts';

export type FrontierResult = 'continue' | 'yield';
export type FrontierWait = (input: InputFrame) => boolean;
export type FrontierHandler = (f: FrontierRunner, c: FrontierContext, args: Arg[]) => FrontierResult;

/** Decomp FrontierScriptContext. */
export interface FrontierContext {
  label: Id;
  cmds: Command[];
  pc: number;
  /** Decomp stack[20]: a push onto 19 entries is dropped, as the field's. */
  stack: { label: Id; cmds: Command[]; pc: number }[];
  state: 'running' | 'waiting' | 'stopped';
  wait: FrontierWait | null;
  cmp: number;
  /** Decomp unk_08[8]: vars 0x8000–0x8007. */
  locals: number[];
  /** Decomp data[4]: vars 0x8010–0x8013, also the commands' scratch. */
  data: number[];
  /** The text bank its messages and local menus read (decomp ctx->msgLoader: its scene's FR_SCENE_BANK_ID). */
  textBank: Id;
}

const CONTEXTS = 8;
const STACK_SLOTS = 20;
const MANAGER_VARS = 8;
/** Commands per context per frame before we call it a loop. */
const MAX_COMMANDS = 100_000;
/** Decomp NO_NEW_ENTRY_POINT (ChangeSceneWithinScript). */
export const NO_NEW_ENTRY_POINT = 0xffff;
/** Decomp FRONTIER_SCENE_FACTORY_CORRIDOR, _FACTORY_BATTLE_ROOM, _HALL_BATTLE_ROOM: the scenes whose setup runs here. */
const SCENE = { factoryCorridor: 3, factoryBattleRoom: 4, hallBattleRoom: 10, arcadeBattleRoom: 16 } as const;

export class FrontierRunner {
  readonly tables: FrontierTables;
  readonly handlers: Record<string, FrontierHandler>;
  scene!: FrontierScene;
  /** The scene's text bank (decomp scriptMan->msgLoader), for contexts that load with it. */
  textBank!: Id;
  readonly contexts: (FrontierContext | null)[] = Array(CONTEXTS).fill(null);
  /** Decomp unk_24: vars 0x8008–0x800F. */
  readonly managerVars: number[] = Array(MANAGER_VARS).fill(0);
  /** Decomp scriptMan->strTemplate (8 slots). */
  readonly slots: (string | undefined)[] = [];
  /** Decomp exitBattleFrontier. */
  exited = false;
  /** Contexts waiting in FrontierScrCmd_WaitABPress (`FrontierView.waitsForAB`). */
  abWaits = 0;
  /** The facility the scripts run (decomp BattleFrontier_SetFacilityStruct): the Factory's or the Hall's challenge. */
  factory: BattleFactory | null = null;
  hall: BattleHall | null = null;
  castle: BattleCastle | null = null;
  arcade: BattleArcade | null = null;
  /** Decomp changeScript and the app's states 5–6: the scene to load and its entry label (null: keep the scripts). */
  private change: { scene: number; entry: Id | null; frames: number } | null = null;
  /** The Battle Tower the challenge runs (decomp FieldFrontierDTO facilityData), shared with the field VM. */
  constructor(
    readonly r: Runner,
    sceneId: number,
    entry: Id,
    readonly tower: () => BattleTower | null,
  ) {
    const tables = newGameRecord(r.registries).frontier;
    if (!tables) throw new Error('launch_battle_frontier_scene: the packs have no Battle Frontier (NewGame.frontier)');
    this.tables = tables;
    this.handlers = { ...frontierHandlers(), ...towerFrontierHandlers(), ...factoryFrontierHandlers(), ...hallFrontierHandlers(), ...castleFrontierHandlers(), ...arcadeFrontierHandlers() };
    // The field faded out before the scene (decomp: the frontier app starts on a black screen).
    this.loadScene(sceneId, { color: 'black', alpha: 1 });
    this.load(entry);
  }

  /** Decomp FrontierGraphics_New: the scene's room and music (the scene BGM plays again after a battle too). */
  loadScene(sceneId: number, screen: { color: 'black' | 'white'; alpha: number }): void {
    const data = this.sceneData(sceneId);
    // Decomp BattleFrontier unk_24: the loaded 2D characters outlive the scene (FrontierGraphics is rebuilt).
    this.scene = new FrontierScene(sceneId, data, this.tables, (sheet) => this.animations(sheet), screen, this.scene?.loaded);
    this.textBank = data.textBank;
    if (data.setup) this.setupScene(sceneId);
    if (data.bgm) this.r.audio.playBgm(data.bgm);
  }

  /**
   * Decomp sFrontierScenes' setupFunc: the Factory corridor's BG2 under BG3 (BattleFactoryCorridorSceneSetup), the Hall
   * battle room's BG2 off and blended 8:9 over the room (BattleHallBattleRoomSceneSetup, ov104_0223D9E4's
   * G2_SetBlendAlpha). Their animations (the Hall lights' tilemap and palette tasks), the Factory room's message blend
   * and the other facilities' setups are logged, not drawn.
   */
  private setupScene(sceneId: number): void {
    if (sceneId === SCENE.factoryCorridor) {
      this.scene.fgBelow = true;
      return;
    }
    if (sceneId === SCENE.hallBattleRoom) {
      this.scene.fgHidden = true;
      this.scene.fgBlend = { a: 8, b: 9 };
    }
    // Decomp BattleArcadeBattleRoomSceneSetup: BG2 (the effect screen) off until an effect shows.
    if (sceneId === SCENE.arcadeBattleRoom) this.scene.fgHidden = true;
    this.r.log.stub(`frontier:scene-setup:${sceneId}`, `frontier scene ${sceneId}'s setup effects (palette tasks, blends) are not drawn`);
  }

  /** Decomp BattleFrontier_RunSubApp with an application (the Factory's and the Hall's apps): the script waits for it. */
  openApp(c: FrontierContext, request: AppRequest, done: (result: AppResult) => void): FrontierResult {
    if (this.r.app) throw new Error(`frontier: open ${request.app} while ${this.r.app.request.app} is open`);
    this.r.app = { request, result: null };
    return this.pause(c, () => {
      const result = this.r.app?.result;
      if (!result) return false;
      this.r.app = null;
      done(result);
      this.afterSubApp();
      return true;
    });
  }

  /** Decomp BattleFrontier_RunSubApp's return: the scene's music again (the room and its characters are kept). */
  afterSubApp(): void {
    const bgm = this.sceneData(this.scene.id).bgm;
    if (bgm) this.r.audio.playBgm(bgm);
  }

  sceneData(sceneId: number): FrontierSceneData {
    const data = this.tables.scenes[sceneId];
    if (!data) throw new Error(`frontier: no scene ${sceneId}`);
    return data;
  }

  private animations(sheet: Id): readonly Ui2dAnimation[] {
    const s = this.r.registries.ui2d.get(sheet);
    if (!s?.animations) throw new Error(`frontier: sheet ${sheet} has no animations`);
    return s.animations;
  }

  /** Decomp FrontierScriptManager_Load: a new context at `label`, with the scene's text bank. */
  load(label: Id): void {
    const i = this.contexts.findIndex((c) => !c);
    if (i < 0) throw new Error(`frontier: no free script context for ${label}`);
    this.contexts[i] = { label, cmds: this.commands(label), pc: 0, stack: [], state: 'running', wait: null, cmp: 0, locals: Array(8).fill(0), data: Array(4).fill(0), textBank: this.textBank };
  }

  commands(label: Id): Command[] {
    const l = this.r.labels.get(label);
    if (!l) throw new Error(`frontier: script label ${label} does not exist`);
    return l.commands;
  }

  /** Decomp FrontierScrCmd_ChangeScript / ChangeSceneWithinScript (BattleFrontier_ChangeScene). */
  changeScene(scene: number, entry: Id | null): void {
    this.change = { scene, entry, frames: 0 };
  }

  get done(): boolean {
    return this.exited;
  }

  /** One frame of BattleFrontier_Main (state 1, or a scene change's states 5–6), then the room's tasks. */
  step(input: InputFrame): void {
    if (this.exited) return;
    if (this.change) {
      // State 5 frees the graphics; state 6 builds the new scene (and its script manager, unless the scripts stay).
      if (++this.change.frames < 2) return;
      const { scene, entry } = this.change;
      this.change = null;
      this.loadScene(scene, this.scene.screen);
      if (entry !== null) {
        // ov104_0222E8C8/E8E8: the manager's vars survive the new script manager; its contexts are gone.
        this.contexts.fill(null);
        this.abWaits = 0;
        this.slots.length = 0;
        this.load(entry);
      } else for (const c of this.contexts) if (c) c.textBank = this.textBank;
      this.scene.step();
      return;
    }
    for (let i = 0; i < this.contexts.length; i++) {
      const c = this.contexts[i];
      if (c && !this.run(c, input)) this.contexts[i] = null;
      if (this.exited || this.change) break;
    }
    this.scene.step();
  }

  /** Decomp FrontierScriptContext_Run: false once the context has stopped. */
  private run(c: FrontierContext, input: InputFrame): boolean {
    if (c.state === 'stopped') return false;
    if (c.state === 'waiting') {
      if (c.wait!(input)) {
        c.state = 'running';
        c.wait = null;
      }
      return true;
    }
    for (let n = 0; n < MAX_COMMANDS; n++) {
      const cmd = c.cmds[c.pc];
      if (!cmd) throw new Error(`frontier script ${c.label} ran past its last command`);
      c.pc++;
      this.r.seen.add(cmd.op);
      const h = this.handlers[cmd.op];
      let result: FrontierResult;
      if (!h) {
        this.r.log.stub(`frontier:${cmd.op}`, `unimplemented frontier command ${cmd.op} (no-op)`);
        result = 'continue';
      } else {
        try {
          result = h(this, c, cmd.args);
        } catch (e) {
          throw new Error(`frontier script ${c.label}[${c.pc - 1}] ${cmd.op}: ${(e as Error).message}`, { cause: e });
        }
      }
      if ((c.state as FrontierContext['state']) === 'stopped') return false;
      if (result === 'yield') return true;
    }
    throw new Error(`frontier script ${c.label}: more than ${MAX_COMMANDS} commands without yielding`);
  }

  pause(c: FrontierContext, wait: FrontierWait): FrontierResult {
    c.state = 'waiting';
    c.wait = wait;
    return 'yield';
  }

  stop(c: FrontierContext): void {
    c.state = 'stopped';
  }

  jump(c: FrontierContext, label: Id): void {
    c.label = label;
    c.cmds = this.commands(label);
    c.pc = 0;
  }

  call(c: FrontierContext, label: Id): void {
    if (c.stack.length + 1 < STACK_SLOTS) c.stack.push({ label: c.label, cmds: c.cmds, pc: c.pc });
    else this.r.log.stub('frontier:call-stack-overflow', `frontier call to ${label} from ${c.label}: the return frame is dropped, as on the DS`);
    this.jump(c, label);
  }

  /** Decomp FrontierScriptContext_Return: an empty stack stops the context (scriptPtr NULL). */
  ret(c: FrontierContext): void {
    const top = c.stack.pop();
    if (!top) {
      this.stop(c);
      return;
    }
    c.label = top.label;
    c.cmds = top.cmds;
    c.pc = top.pc;
  }

  // ---------------------------------------------------------------- vars (decomp FrontierScriptContext_GetVarPointer)

  private cell(c: FrontierContext, id: number): { get(): number; set(v: number): void } | null {
    if (id < FRONTIER_VARS.first || id > FRONTIER_VARS.last) return null;
    const i = id - FRONTIER_VARS.first;
    if (i < 8) return { get: () => c.locals[i]!, set: (v) => void (c.locals[i] = v & 0xffff) };
    if (i < 16) return { get: () => this.managerVars[i - 8]!, set: (v) => void (this.managerVars[i - 8] = v & 0xffff) };
    return { get: () => c.data[i - 16]!, set: (v) => void (c.data[i - 16] = v & 0xffff) };
  }

  /** Decomp FrontierScriptContext_GetVar: a var's value, or the operand itself. */
  val(c: FrontierContext, a: Arg | undefined): number {
    const raw = this.int(a);
    return this.cell(c, raw)?.get() ?? raw;
  }

  /** Decomp FrontierScriptContext_TryGetVarPointer's write. */
  set(c: FrontierContext, a: Arg | undefined, value: number): void {
    const raw = this.int(a);
    const v = this.cell(c, raw);
    if (!v) throw new Error(`0x${raw.toString(16)} is not a frontier var`);
    v.set(value);
  }

  /** A var's value by its id, which must be a var (a pointer the command keeps, as in ctx->data[0]). */
  getVar(c: FrontierContext, id: number): number {
    const v = this.cell(c, id);
    if (!v) throw new Error(`0x${id.toString(16)} is not a frontier var`);
    return v.get();
  }

  setVar(c: FrontierContext, id: number, value: number): void {
    const v = this.cell(c, id);
    if (!v) throw new Error(`0x${id.toString(16)} is not a frontier var`);
    v.set(value);
  }

  int(a: Arg | undefined): number {
    if (a?.kind === 'int') return a.value;
    throw new Error(`expected an int operand, got ${JSON.stringify(a)}`);
  }

  ref(a: Arg | undefined, kind: Arg['kind']): Id {
    if (a && a.kind === kind && 'id' in a) return a.id;
    throw new Error(`expected a ${kind}(...) operand, got ${JSON.stringify(a)}`);
  }

  view(): FrontierView {
    return { ...this.scene.view(), ...(this.abWaits ? { waitsForAB: true as const } : {}) };
  }
}
