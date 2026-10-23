/**
 * The battle animation VM (decomp battle_anim_system.c): runs one move or common animation script headless
 * at the game's 30 Hz (the DS runs battle tasks once per two vblanks). One `tick()` is one DS frame, in the
 * DS's task order:
 * 1. the script (BattleAnimSystem_ExecuteScript, priority 0): commands until one waits;
 * 2. the animation and sound tasks (priority 1100) in start order, those started this frame included;
 * 3. the draw task (60000): battler sprite fades step, the particle systems are drawn, then updated;
 * 4. the palette fade task (0xFFFFFFFE): the background fades step.
 * `view()` is what the scene draws for the frame. The run is a pure function of the script, the records and
 * the deps (the particle random stream is seeded from `deps.seed`), so the battle can wait on it tick by tick.
 *
 * Battlers are DS battler ids (0 the player's first, 1 the enemy's first, 2 and 3 their second). In singles their
 * types are BATTLER_TYPE_SOLO_PLAYER and _SOLO_ENEMY (0, 1); in doubles battler b has type b + 2 (PLAYER_SIDE_SLOT_1,
 * ENEMY_SIDE_SLOT_1, PLAYER_SIDE_SLOT_2, ENEMY_SIDE_SLOT_2), which picks its place, world positions and particle
 * resources.
 */
import type { AnimBattlerView, AnimParticle, AnimSpriteView, AnimView, BattleAnimData, CryMod, ParticleSystem, Registries, StubLog } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { BattleBg } from './bg.ts';
import { ParticleCamera } from './camera.ts';
import { createEmitterCallback } from './callbacks.ts';
import { callFunc } from './funcs.ts';
import { ObjectSprites } from './objects.ts';
import { startBattlerSlideIn } from './funcs4.ts';
import { instructionLength, OP, OPCODES } from './script.ts';
import { ParticleManager, SplRandom, type Emitter } from './spl.ts';
import { sideOf } from './tasks.ts';

export { sideOf };

export type Side = 'player' | 'enemy';

/** A battler as the animation sees it. */
export interface AnimBattler {
  species: Id;
  form: number;
  /** The sprite's `yOffset` (decomp pokemonSpriteData yOffset, MON_SPRITE_SHADOW_HEIGHT). */
  height: number;
  /** On screen (not fainted, not yet sent out). */
  visible: boolean;
}

export interface AnimDeps {
  registries: Pick<Registries, 'battleAnimations' | 'particleSystems' | 'battleAnimData'> & Partial<Pick<Registries, 'ui2d'>>;
  /** The attacker's and the defender's battler ids. */
  attacker: number;
  defender: number;
  /** The battlers by id (singles: 0 and 1); null where nobody stands (an empty slot in doubles). */
  battlers: (AnimBattler | null)[];
  /** A double battle (decomp BattleAnimSystem_IsDoubleBattle): four slots, the doubles battler types. */
  doubles: boolean;
  /** The move's secondary effect chance (JumpIfEffectChance*). */
  effectChance: number;
  /** The move's power this use (BATTLE_ANIM_MOVE_INFO_POWER: Magnitude's shake); absent: 0. */
  power?: number;
  weather: 'rain' | 'sandstorm' | 'sun' | 'hail' | null;
  /** Seeds the particle random stream. */
  seed: number;
  log: StubLog;
  sound?: AnimSound;
  /**
   * A contest's acting round (decomp BattleAnimSystem_SetIsContest): battler 0 is the performer at the contestant's
   * place (216, 112), battler 1 the hidden target (80, 42); JumpIfContest jumps, world positions are the contest
   * rows, pans and X directions turn round, switched backgrounds use their contest screen.
   */
  contest?: boolean;
}

/** The game's sound for the animation (decomp Sound_* calls); absent: silent, and sounds never hold the animation. */
export interface AnimSound {
  se(seq: number): void;
  stopSe(seq: number): void;
  /** A sound effect plays (`seq`), or any sound effect (undefined). */
  sePlaying(seq?: number): boolean;
  cry(species: Id, form: number, mod: CryMod, pan: number, volume: number): void;
  cryPlaying(): boolean;
  stopCries(): void;
}

/** A Pokémon sprite as the decomp's PokemonSprite attributes have it (positions in DS px). */
export class MonSprite {
  x: number;
  y: number;
  /** 0x100 = 100 % (MON_AFFINE_SCALE). */
  scaleX = 256;
  scaleY = 256;
  /** MON_SPRITE_ROTATION_Z, 65536ths of a turn, about the pivot (MON_SPRITE_X_PIVOT / Y_PIVOT, px from the centre). */
  rotation = 0;
  pivotX = 0;
  pivotY = 0;
  hide: boolean;
  cropBottom = 0;
  /** Translucency 0–31 (31 opaque). */
  alpha = 31;
  fade = { active: false, cur: 0, target: 0, delay: 0, counter: 0, color: 0 };
  /** The blend last applied (PokemonSpriteManager's palette), 0–16. */
  fadeAmount = 0;
  fadeColor = 0;

  constructor(
    readonly battler: number,
    readonly baseX: number,
    readonly baseY: number,
    readonly height: number,
    visible: boolean,
  ) {
    this.x = baseX;
    this.y = baseY;
    this.hide = !visible;
  }

  get side(): Side {
    return sideOf(this.battler);
  }

  /** PokemonSprite_StartFade. */
  startFade(from: number, to: number, delay: number, color: number): void {
    this.fade = {
      active: true,
      cur: from,
      target: to,
      delay,
      counter: 0,
      color,
    };
  }

  /** The fade step of PokemonSpriteManager_DrawSprites. */
  stepFade(): void {
    const f = this.fade;
    if (!f.active) return;
    if (f.counter !== 0) {
      f.counter--;
      return;
    }
    f.counter = f.delay;
    this.fadeAmount = f.cur;
    this.fadeColor = f.color;
    if (f.cur === f.target) f.active = false;
    else f.cur += f.cur > f.target ? -1 : 1;
  }
}

/**
 * A copy of a battler's sprite in the animation's sprite manager (AddPokemonSprite: an OAM sprite of the
 * battler's picture at its place). Positions are DS px like `MonSprite`'s; scale 0x100 = 100 % (negative:
 * mirrored).
 */
export class PokeCopy {
  scaleX = 256;
  scaleY = 256;
  rotation = 0;
  visible = true;
  /** GX_OAM_MODE_XLU: blended by the animation's OBJ blend (`AnimVm.objBlend`). */
  xlu = false;
  /** GX_OAM_MODE_OBJWND: a mask (the stat change overlay shows through it), not drawn. */
  window = false;
  /** Its palette loaded darkened (PaletteData_LoadBufferFromFileStartWithTint), and faded: 0–16 toward `fadeColor`. */
  fade = 0;
  fadeColor = 0;

  constructor(
    readonly battler: number,
    public x: number,
    public y: number,
  ) {}
}

/** An animation or sound task (a SysTask of the anim system): `step` returns false once it is done. */
export interface Task {
  /** anim and sound tasks are counted (End and the waits); bg (background switches) are not. */
  kind: 'anim' | 'sound' | 'bg';
  step(): boolean;
}

/** The commands `AnimVm` runs (the rest are logged and skipped; a script that uses one plays the generic hit). */
export const ANIM_OPCODES = new Set([
  'Delay', 'WaitForAnimTasks', 'BeginLoop', 'EndLoop', 'End', 'PlaySoundEffect', 'PlayPannedSoundEffect', 'StopSoundEffect', 'PanSoundEffects',
  'SetBg0Bg1AlphaBlending', 'SetDefaultAlphaBlending', 'Nop0', 'Nop1', 'Nop2', 'Nop3', 'Nop4', 'Nop5', 'Nop6', 'Nop7', 'Nop8', 'Nop9', 'Nop10', 'Nop11',
  'PlayMovingSoundEffectAtkDef', 'PlayMovingSoundEffectNoCorrection', 'PlayMovingSoundEffectAtkDef2', 'PlayLoopedSoundEffect', 'PlayDelayedSoundEffect',
  'WaitForSoundEffects', 'Call', 'Return', 'SetVar', 'ResetVars', 'Jump', 'JumpIfEffectChanceOdd', 'JumpIfEffectChance', 'JumpIfBattlerSide', 'JumpIfWeather',
  'JumpIfContest', 'JumpIfFriendlyFire', 'CallFunc', 'CreateEmitter', 'CreateEmitterEx', 'CreateEmitterForMove', 'CreateEmitterForFriendlyFire', 'WaitForAllEmitters', 'LoadParticleSystem',
  'UnloadParticleSystem', 'SetCameraProjection', 'SetCameraFlip', 'InitPokemonSpriteManager', 'LoadPokemonSpriteDummyResources', 'FreePokemonSpriteManager',
  'AddPokemonSprite', 'RemovePokemonSprite', 'PlayPokemonCry', 'WaitForPokemonCries', 'SetExtraParams',
  'SwitchBg', 'RestoreBg', 'SwitchBgEx', 'SetBgSwitchVar', 'WaitForPartialBgSwitch', 'WaitForBgSwitch',
  'InitSpriteManager', 'LoadCharResObj', 'LoadPlttRes', 'LoadCellResObj', 'LoadAnimResObj', 'AddSpriteWithFunc', 'StartBattlerSlideIn',
  'FreeSpriteManager', 'SetPokemonSpriteVisible', 'StartPokemonSpriteDrawTask', 'StopPokemonSpriteDrawTask',
]);

/** Decomp default sprite centres by battler type (BATTLER_POS_SOLO_*, BATTLER_POS_*_SLOT_*). */
export const BATTLER_POS: readonly { x: number; y: number }[] = [
  { x: 64, y: 112 },
  { x: 192, y: 48 },
  { x: 40, y: 112 },
  { x: 216, y: 50 },
  { x: 80, y: 120 },
  { x: 176, y: 42 },
];

/** CONTESTANT_POS_PLAYER/ENEMY (BattleAnimUtil_GetBattlerTypeDefaultPos with isContest). */
export const CONTEST_POS: readonly { x: number; y: number }[] = [
  { x: 216, y: 112 },
  { x: 80, y: 42 },
];
/** CONTESTANT_TYPE_PLAYER: the contest rows of the world position table follow the six battler types. */
const CONTEST_TYPE = 6;

/**
 * GetParticleResIdxForMove's table: the CreateEmitterForMove resource by attacker and defender type (−1: none, a
 * friendly-fire pairing, which the scripts branch away from first).
 */
const MOVE_RESOURCE: readonly (readonly number[])[] = [
  [-1, 0, -1, -1, -1, -1],
  [3, -1, -1, -1, -1, -1],
  [-1, -1, -1, 2, -1, 0],
  [-1, -1, 5, -1, 3, -1],
  [-1, -1, -1, 0, -1, 1],
  [-1, -1, 3, -1, 4, -1],
];
/** GetParticleResIdxForFriendlyFire's table: the CreateEmitterForFriendlyFire resource by attacker and defender type. */
const FRIENDLY_FIRE_RESOURCE: readonly (readonly number[])[] = [
  [-1, -1, -1, -1, -1, -1],
  [-1, -1, -1, -1, -1, -1],
  [-1, -1, -1, -1, 0, -1],
  [-1, -1, -1, -1, -1, 1],
  [-1, -1, 1, -1, -1, -1],
  [-1, -1, -1, 0, -1, -1],
];
/** StartPokemonSpriteDrawTask in doubles: the battler types whose copy draws in front (priority 1), by battler role. */
const DRAW_TASK_FRONT: Record<number, readonly number[]> = { 0: [3, 4], 2: [5, 2], 1: [3, 4], 3: [2, 5] };
/** The longest an animation may run; a script that never ends is a VM bug. */
const MAX_TICKS = 60 * 30;

export class AnimVm {
  /** The battlers' sprites by battler id (an empty slot's is hidden). */
  readonly sprites: MonSprite[];
  readonly data: BattleAnimData;
  readonly rng: SplRandom;
  /** The script position (word index). */
  pc = 0;
  vars: number[] = new Array(10).fill(0);
  /** BattleAnimSystem scriptDelay and executeAnimScriptFunc (true: BattleAnimScript_WaitForDelay). */
  private scriptDelay = 0;
  private waitMode = false;
  private readonly loops: { start: number; count: number; max: number }[] = [];
  private readonly calls: number[] = [];
  private endFrames = 0;
  private seWait = 0;
  done = false;
  ticks = 0;
  readonly tasks: Task[] = [];
  readonly particleSystems: (ParticleManager | null)[] = new Array(16).fill(null);
  readonly cameraProjections: number[] = new Array(16).fill(1);
  readonly cameraFlips: number[] = new Array(16).fill(0);
  currentParticleSystem = 0;
  readonly emitters: (Emitter | null)[] = new Array(20).fill(null);
  readonly bg: BattleBg = new BattleBg(this);
  private drawn: AnimParticle[] = [];
  readonly objects = new ObjectSprites(this);
  curtain: { top: number; bottom: number } | null = null;
  /** The Pokémon sprite copies (AddPokemonSprite), by sprite id. */
  readonly pokemonSprites: (PokeCopy | null)[] = new Array(5).fill(null);
  /** G2_SetBlendAlpha for translucent OBJs (EVA, EVB; 0–16). */
  objBlend = { a: 8, b: 8 };
  /** The stat change pattern over a battler's silhouette (BattleAnimTask_StatChange). */
  overlay: { sheet: Id; dx: number; dy: number; alpha: number; mask: number } | null = null;

  constructor(
    readonly code: readonly number[],
    readonly deps: AnimDeps,
  ) {
    const data = [...deps.registries.battleAnimData.values()];
    if (data.length !== 1) throw new Error(`battle anim: expected one battleAnimData record, found ${data.length}`);
    this.data = data[0]!;
    this.rng = new SplRandom(deps.seed >>> 0);
    if (deps.battlers.length !== (deps.doubles ? 4 : 2)) throw new Error(`battle anim: ${deps.battlers.length} battlers in a ${deps.doubles ? 'double' : 'single'} battle`);
    if (deps.contest && (deps.doubles || deps.attacker !== 0 || deps.defender !== 1)) throw new Error('battle anim: a contest has the performer as battler 0 and its target as battler 1, singles');
    for (const b of [deps.attacker, deps.defender]) if (!deps.battlers[b]) throw new Error(`battle anim: battler ${b} is not in the battle`);
    this.sprites = deps.battlers.map((m, b) => {
      const at = (deps.contest ? CONTEST_POS : BATTLER_POS)[this.typeOf(b)]!;
      return new MonSprite(b, at.x, at.y, m?.height ?? 0, m?.visible ?? false);
    });
  }

  // ---------- the battlers ----------

  /** BattleAnimUtil_GetBattlerType: SOLO_PLAYER 0 and SOLO_ENEMY 1 in singles, battler + 2 in doubles. */
  typeOf(battler: number): number {
    return this.deps.doubles ? battler + 2 : battler;
  }

  /** A battler's sprite. */
  sprite(battler: number): MonSprite {
    const s = this.sprites[battler];
    if (!s) throw new Error(`battle anim: no battler ${battler}`);
    return s;
  }

  /** BattleAnimUtil_GetAlliedBattler: the battler beside it (in singles the battler itself). */
  ally(battler: number): number {
    return this.deps.doubles ? battler ^ 2 : battler;
  }

  get attacker(): number {
    return this.deps.attacker;
  }

  get defender(): number {
    return this.deps.defender;
  }

  get doubles(): boolean {
    return this.deps.doubles;
  }

  get contest(): boolean {
    return this.deps.contest === true;
  }

  /** BattleAnimUtil_GetBattlerWorldPos_*: the table's position for the battler's type and the current camera projection. */
  worldPos(battler: number, kind = 0): [number, number, number] {
    return this.typePos(this.typeOf(battler), kind);
  }

  /** BattleAnimUtil_GetBattlerTypeWorldPos_*: the table's position for a battler type. */
  typePos(type: number, kind = 0): [number, number, number] {
    const proj = this.particleSystems[this.currentParticleSystem]?.camera.projection ?? 1;
    // A contest's rows follow the six battler types (CONTESTANT_TYPE_PLAYER, _ENEMY).
    if (this.deps.contest && type > 1) throw new Error(`battle anim: battler type ${type} in a contest`);
    const p = this.data.positions[this.deps.contest ? CONTEST_TYPE + type : type]?.[kind]?.[proj];
    if (!p) throw new Error(`battle anim: no world position ${kind} for battler type ${type}`);
    return [...p];
  }

  // ---------- running ----------

  tick(): void {
    if (this.done) throw new Error('battle anim: tick after the end');
    if (++this.ticks > MAX_TICKS) throw new Error(`battle anim: still running after ${MAX_TICKS} ticks (pc ${this.pc})`);
    if (this.waitMode) {
      // BattleAnimScript_WaitForDelay: counts down, then a frame to switch back to executing.
      if (this.scriptDelay === 0) this.waitMode = false;
      else this.scriptDelay--;
    } else this.execute();
    for (let i = 0; i < this.tasks.length; i++) {
      const t = this.tasks[i]!;
      if (!t.step()) {
        this.tasks.splice(i, 1);
        i--;
      }
    }
    this.objects.tick();
    this.bg.scroll();
    for (const s of this.sprites) s.stepFade();
    this.drawn = [];
    for (const ps of this.particleSystems) ps?.draw(this.drawn);
    for (const ps of this.particleSystems) ps?.update();
    this.bg.fade.tick();
  }

  /** BattleAnimScript_Execute: commands while scriptDelay stays 0 (a waiting command sets it). */
  private execute(): void {
    for (let guard = 0; ; guard++) {
      if (guard > 100000) throw new Error(`battle anim: no wait in 100000 commands (pc ${this.pc})`);
      this.command();
      if (this.scriptDelay !== 0 || this.done) return;
    }
  }

  word(i: number): number {
    const v = this.code[i];
    if (v === undefined) throw new Error(`battle anim: read past the script's end (word ${i})`);
    return v;
  }

  /** BattleAnimSystem_GetExtraParams: the SetExtraParams at the script position, which must hold `count` words. */
  extraParams(count: number): number[] {
    if (this.word(this.pc) !== OP.SetExtraParams) throw new Error(`battle anim: expected SetExtraParams at word ${this.pc}, found opcode ${this.word(this.pc)}`);
    const n = this.word(this.pc + 1);
    if (n !== count) throw new Error(`battle anim: SetExtraParams at word ${this.pc} has ${n} values, the callback reads ${count}`);
    const out = this.code.slice(this.pc + 2, this.pc + 2 + n) as number[];
    this.pc += 2 + n;
    return out;
  }

  get activeAnimTasks(): number {
    return this.tasks.filter((t) => t.kind === 'anim').length;
  }

  get activeSoundTasks(): number {
    return this.tasks.filter((t) => t.kind === 'sound').length;
  }

  get activeEmitters(): number {
    return this.particleSystems.reduce((n, ps) => n + (ps?.activeEmitters ?? 0), 0);
  }

  /** Runs one command: a waiting command sets scriptDelay (1: run again next frame). */
  private command(): void {
    this.scriptDelay = 0;
    const pc = this.pc;
    const op = this.word(pc);
    const len = instructionLength(this.code, pc);
    const a = (i: number) => this.word(pc + i);
    const next = () => {
      this.pc = pc + len;
    };
    const jumpBy = (operand: number) => {
      this.pc = pc + operand + this.word(pc + operand);
    };
    switch (op) {
      case OP.Delay:
        this.scriptDelay = a(1) & 0xff;
        next();
        this.waitMode = true;
        return;
      case OP.WaitForAnimTasks:
        if (this.activeAnimTasks) {
          this.scriptDelay = 1;
          return;
        }
        next();
        return;
      case OP.BeginLoop:
        this.loops.push({ start: pc + len, count: 0, max: a(1) & 0xff });
        next();
        return;
      case OP.EndLoop: {
        const l = this.loops[this.loops.length - 1];
        next();
        if (!l) return;
        l.count++;
        if (l.count === l.max) this.loops.pop();
        else this.pc = l.start;
        return;
      }
      case OP.End:
        this.end();
        return;
      case OP.PlaySoundEffect:
        this.deps.sound?.se(a(1) & 0xffff);
        next();
        return;
      case OP.PlayPannedSoundEffect:
        this.deps.sound?.se(a(1) & 0xffff);
        next();
        return;
      case OP.StopSoundEffect:
        this.deps.sound?.stopSe(a(1) & 0xffff);
        next();
        return;
      case OP.PanSoundEffects:
      case OP.SetBg0Bg1AlphaBlending:
      case OP.SetDefaultAlphaBlending:
      case OP.Nop0:
      case OP.Nop1:
      case OP.Nop2:
      case OP.Nop3:
      case OP.Nop4:
      case OP.Nop5:
      case OP.Nop6:
      case OP.Nop7:
      case OP.Nop8:
      case OP.Nop9:
      case OP.Nop10:
      case OP.Nop11:
        next();
        return;
      case OP.PlayMovingSoundEffectAtkDef:
      case OP.PlayMovingSoundEffectNoCorrection:
      case OP.PlayMovingSoundEffectAtkDef2:
        this.soundPan(a(1) & 0xffff, a(2), a(3), a(4), a(5) & 0xff, op === OP.PlayMovingSoundEffectNoCorrection);
        next();
        return;
      case OP.PlayLoopedSoundEffect:
        this.soundRepeat(a(1) & 0xffff, a(3) & 0xff, a(4) & 0xff);
        next();
        return;
      case OP.PlayDelayedSoundEffect:
        this.soundDelay(a(1) & 0xffff, a(3) & 0xff);
        next();
        return;
      case OP.WaitForSoundEffects: {
        if (this.activeSoundTasks) {
          this.seWait = 0;
          {
            this.scriptDelay = 1;
            return;
          }
        }
        if (this.deps.sound?.sePlaying() && ++this.seWait <= 90) {
          this.scriptDelay = 1;
          return;
        }
        this.seWait = 0;
        next();
        return;
      }
      case OP.SwitchBg:
      case OP.RestoreBg:
        this.bg.start(a(1), a(2), op === OP.RestoreBg);
        next();
        return;
      case OP.SwitchBgEx:
        this.bg.start(this.contest ? a(3) : sideOf(this.defender) === 'player' ? a(2) : a(1), 0, false);
        next();
        return;
      case OP.SetBgSwitchVar:
        this.bg.setVar(a(1), a(2));
        next();
        return;
      case OP.WaitForPartialBgSwitch:
      case OP.WaitForBgSwitch:
        if (this.bg.switchState !== (op === OP.WaitForBgSwitch ? 0 : 2)) {
          this.scriptDelay = 1;
          return;
        }
        next();
        return;
      case OP.Call:
        this.calls.push(pc + 2);
        jumpBy(1);
        return;
      case OP.Return: {
        const r = this.calls.pop();
        if (r === undefined) throw new Error(`battle anim: Return at word ${pc} with no Call`);
        this.pc = r;
        return;
      }
      case OP.SetVar:
        if (a(1) >= 0 && a(1) < 10) this.vars[a(1)] = a(2);
        next();
        return;
      case OP.ResetVars:
        this.vars.fill(0);
        next();
        return;
      case OP.Jump:
        jumpBy(1);
        return;
      case OP.JumpIfEffectChanceOdd:
        jumpBy(this.deps.effectChance & 1 ? 2 : 1);
        return;
      case OP.JumpIfEffectChance:
        if (a(1) === this.deps.effectChance) jumpBy(2);
        else next();
        return;
      case OP.JumpIfBattlerSide: {
        jumpBy(sideOf(a(1) === 0 ? this.attacker : this.defender) === 'enemy' ? 3 : 2);
        return;
      }
      case OP.JumpIfWeather: {
        const w = this.deps.weather;
        jumpBy(w === null ? 1 : { rain: 2, sandstorm: 3, sun: 4, hail: 5 }[w]);
        return;
      }
      case OP.JumpIfContest:
        if (this.contest) jumpBy(1);
        else next();
        return;
      case OP.JumpIfFriendlyFire:
        if (sideOf(this.attacker) === sideOf(this.defender)) jumpBy(1);
        else next();
        return;
      case OP.CallFunc: {
        const argc = a(2);
        for (let i = 0; i < 10; i++) this.vars[i] = i < argc ? a(3 + i) : 0;
        next();
        callFunc(this, a(1));
        return;
      }
      case OP.CreateEmitter:
        next();
        this.createEmitter(a(1), 0, a(2), a(3));
        return;
      case OP.CreateEmitterEx:
        next();
        this.createEmitter(a(1), a(2), a(3), a(4));
        return;
      case OP.CreateEmitterForMove: {
        // GetParticleResIdxForMove: the resource by the attacker's and the defender's types (singles: player → enemy
        // the first, enemy → player the fourth).
        next();
        const index = MOVE_RESOURCE[this.typeOf(this.attacker)]![this.typeOf(this.defender)]!;
        if (index < 0) throw new Error(`battle anim: CreateEmitterForMove from battler ${this.attacker} to ${this.defender} (no resource: friendly fire)`);
        this.createEmitter(a(1), 0, a(2 + index), a(8));
        return;
      }
      case OP.SetExtraParams:
        throw new Error(`battle anim: SetExtraParams at word ${pc} that no emitter callback reads`);
      case OP.CreateEmitterForFriendlyFire: {
        next();
        const index = FRIENDLY_FIRE_RESOURCE[this.typeOf(this.attacker)]![this.typeOf(this.defender)]!;
        if (index < 0) throw new Error(`battle anim: CreateEmitterForFriendlyFire from battler ${this.attacker} to ${this.defender} (not allies)`);
        this.createEmitter(a(1), 0, a(2 + index), a(6));
        return;
      }
      case OP.WaitForAllEmitters:
        if (this.activeEmitters) {
          this.scriptDelay = 1;
          return;
        }
        next();
        return;
      case OP.LoadParticleSystem: {
        const index = a(1);
        if (this.particleSystems[index]) throw new Error(`battle anim: particle system ${index} loaded twice`);
        this.particleSystems[index] = new ParticleManager(this.particleSystem(a(2)), new ParticleCamera(), this.rng);
        next();
        this.scriptDelay = 2;
        this.waitMode = true;
        return;
      }
      case OP.UnloadParticleSystem:
        this.particleSystems[a(1)] = null;
        next();
        return;
      case OP.SetCameraProjection:
        this.cameraProjections[a(1)] = a(2);
        next();
        return;
      case OP.SetCameraFlip:
        this.cameraFlips[a(1)] = a(2);
        next();
        return;
      case OP.InitPokemonSpriteManager:
      case OP.LoadPokemonSpriteDummyResources:
      case OP.FreePokemonSpriteManager:
        next();
        return;
      case OP.AddPokemonSprite: {
        const b = this.roleBattler(a(1));
        const m = this.sprites[b]!;
        const copy = new PokeCopy(b, m.x, m.y);
        copy.visible = !m.hide;
        this.pokemonSprites[a(3)] = copy;
        next();
        return;
      }
      case OP.SetPokemonSpriteVisible: {
        const c = this.pokemonSprites[a(1)];
        if (!c) throw new Error(`battle anim: SetPokemonSpriteVisible on sprite ${a(1)}, which was not added`);
        c.visible = a(2) !== 0;
        next();
        return;
      }
      case OP.StartPokemonSpriteDrawTask: {
        // Singles: the copy is switched off (the draw task only runs in doubles). Doubles: the copy draws while its
        // battler shows and stands in front for its role (priority 1, DRAW_TASK_FRONT); otherwise not (priority 255).
        const c = this.pokemonSprites[a(3)];
        if (c) {
          const role = a(1);
          const type = this.typeOf(role === 0 || role === 2 ? this.attacker : this.defender);
          c.visible = this.doubles && !this.sprites[this.roleBattler(role)]!.hide && (DRAW_TASK_FRONT[role]?.includes(type) ?? false);
        }
        next();
        return;
      }
      case OP.StopPokemonSpriteDrawTask:
        next();
        return;
      case OP.InitSpriteManager:
        this.objects.init(a(1), a(2));
        next();
        return;
      case OP.LoadCharResObj:
      case OP.LoadPlttRes:
      case OP.LoadCellResObj:
      case OP.LoadAnimResObj:
        this.objects.load(a(1), op === OP.LoadCharResObj ? 'chars' : op === OP.LoadPlttRes ? 'palettes' : op === OP.LoadCellResObj ? 'cells' : 'animations', a(2));
        next();
        return;
      case OP.AddSpriteWithFunc:
        this.objects.add(a(1), { chars: a(3), palette: a(4), cells: a(5), animation: a(6) }, a(2), this.code.slice(pc + 10, pc + len) as number[]);
        next();
        return;
      case OP.FreeSpriteManager:
        this.objects.free(a(1));
        next();
        return;
      case OP.StartBattlerSlideIn:
        startBattlerSlideIn(this, a(1));
        next();
        return;
      case OP.RemovePokemonSprite:
        this.pokemonSprites[a(1)] = null;
        next();
        return;
      case OP.PlayPokemonCry: {
        const b = this.deps.battlers[this.attacker]!;
        this.deps.sound?.cry(b.species, b.form, cryMod(a(1), this.deps.log), this.pan(a(2)), a(3));
        next();
        return;
      }
      case OP.WaitForPokemonCries:
        if (this.deps.sound?.cryPlaying()) {
          this.scriptDelay = 1;
          return;
        }
        if (a(1)) this.deps.sound?.stopCries();
        next();
        return;
      default:
        this.deps.log.stub(`anim:op:${OPCODES[op]![0]}`, 'battle animation command not implemented: skipped');
        next();
        return;
    }
  }

  /** BattleAnimScriptCmd_End: one frame's grace, then waits for emitters, tasks and sounds (sounds at most 90 frames). */
  private end(): void {
    this.scriptDelay = 1;
    if (this.endFrames < 1) {
      this.endFrames++;
      return;
    }
    if (this.activeEmitters || this.activeAnimTasks || this.activeSoundTasks) {
      this.seWait = 0;
      return;
    }
    if (this.deps.sound?.sePlaying() && ++this.seWait <= 90) return;
    this.particleSystems.fill(null);
    this.objects.clear();
    this.done = true;
  }

  private particleSystem(member: number): ParticleSystem {
    for (const p of this.deps.registries.particleSystems.values()) if (!p.archive && p.sourceIndex === member) return p;
    throw new Error(`battle anim: no particle system ${member} in the packs`);
  }

  private createEmitter(ps: number, slot: number, resource: number, callback: number): void {
    const sys = this.particleSystems[ps];
    if (!sys) throw new Error(`battle anim: CreateEmitter on particle system ${ps}, which is not loaded`);
    this.currentParticleSystem = ps;
    if (this.cameraFlips[ps]) sys.camera.up = [sys.camera.up[0], -sys.camera.up[1], sys.camera.up[2]];
    sys.camera.projection = this.cameraProjections[ps]!;
    const e = sys.createEmitter(resource, (em) => createEmitterCallback(this, sys, em, callback));
    // SPLManager_CreateEmitter hands back no self-maintaining emitter (they end themselves).
    this.emitters[slot] = e && !e.selfMaintaining ? e : null;
  }

  /**
   * The battler a BATTLER_ROLE_* names (BattleAnimSystem_GetBattlerWithRole): the attacker, the defender, their
   * partners (in singles the battler itself), or a slot: player 1, enemy 1, player 2, enemy 2 (in singles the
   * first slots, as before the doubles port).
   */
  roleBattler(role: number): number {
    switch (role) {
      case 0:
        return this.attacker;
      case 1:
        return this.defender;
      case 2:
        return this.ally(this.attacker);
      case 3:
        return this.ally(this.defender);
      case 4:
        return 0;
      case 5:
        return 1;
      case 6:
        return this.doubles ? 2 : 0;
      case 7:
        return this.doubles ? 3 : 1;
      default:
        throw new Error(`battle anim: battler role ${role}`);
    }
  }

  /** BattleAnimSound_CorrectPanDirection. */
  pan(pan: number): number {
    const p = (pan << 24) >> 24;
    const atk = sideOf(this.attacker);
    const def = sideOf(this.defender);
    let out: number;
    if (atk === 'player' && def === 'enemy') out = p;
    else if (atk === 'enemy' && def === 'player') out = -p;
    else if (atk === 'player') out = p > 0 ? -p : p;
    else out = p < 0 ? -p : p;
    // A contest's pans are turned round (the performer stands on the right).
    return this.contest ? -out : out;
  }

  private soundPan(seq: number, start: number, end: number, step: number, interval: number, raw: boolean): void {
    const s = this.deps.sound;
    s?.se(seq);
    let from = raw ? (start << 24) >> 24 : this.pan(start);
    const to = raw ? (end << 24) >> 24 : this.pan(end);
    const st = raw ? (step << 24) >> 24 : from < to ? Math.abs(step) : from > to ? -Math.abs(step) : 0;
    let count = 0;
    this.tasks.push({
      kind: 'sound',
      step: () => {
        if (count++ < interval) return true;
        count = 0;
        from += st;
        let active = st !== 0 && (start < end ? from < to : from > to);
        if (from >= to && st > 0) active = false;
        if (!(s?.sePlaying(seq) ?? false)) return false;
        return active;
      },
    });
  }

  private soundRepeat(seq: number, interval: number, repeats: number): void {
    let count = interval;
    let left = repeats;
    this.tasks.push({
      kind: 'sound',
      step: () => {
        if (count++ < interval) return true;
        count = 0;
        left = (left - 1) & 0xff;
        this.deps.sound?.se(seq);
        return left !== 0;
      },
    });
  }

  private soundDelay(seq: number, delay: number): void {
    let left = delay;
    this.tasks.push({
      kind: 'sound',
      step: () => {
        if (left-- === 0) {
          this.deps.sound?.se(seq);
          return false;
        }
        return true;
      },
    });
  }

  // ---------- the view ----------

  view(): AnimView {
    const battlers: AnimBattlerView[] = this.sprites.filter((s) => this.deps.battlers[s.battler]).map((s) => {
      return {
        battler: s.battler,
        dx: s.x - s.baseX,
        dy: s.y - s.baseY,
        scaleX: s.scaleX / 256,
        scaleY: s.scaleY / 256,
        rotation: (s.rotation & 0xffff) / 0x10000,
        hidden: s.hide,
        ...(s.cropBottom ? { cropBottom: s.cropBottom } : {}),
        pivotX: s.pivotX,
        pivotY: s.pivotY,
        fade: s.fadeAmount ? { color: s.fadeColor, amount: s.fadeAmount } : null,
        alpha: s.alpha / 31,
      };
    });
    return {
      battlers,
      particles: this.drawn,
      sprites: [...this.objects.view(), ...this.pokemonSprites.flatMap((c): AnimSpriteView[] => {
        if (!c || !c.visible || c.window) return [];
        const m = this.sprites[c.battler]!;
        return [
          {
            kind: 'pokemon',
            battler: c.battler,
            x: c.x - m.baseX,
            y: c.y - m.baseY,
            scaleX: c.scaleX / 256,
            scaleY: c.scaleY / 256,
            rotation: (c.rotation & 0xffff) / 0x10000,
            alpha: c.xlu ? Math.min(16, this.objBlend.a) / 16 : 1,
            fade: c.fade ? { color: c.fadeColor, amount: c.fade } : null,
          },
        ];
      })],
      ...(this.curtain ? { curtain: { ...this.curtain } } : {}),
      overlay: this.overlay && { ...this.overlay },
      bg: this.bg.view(this.data.backgrounds),
    };
  }
}

/** Decomp enum PokemonCryMod → contracts CryMod (UPROAR_1 and HYPERVOICE_1 have no CryMod: played as normal, logged). */
function cryMod(mod: number, log: StubLog): CryMod {
  const mods: (CryMod | null)[] = [
    'normal',
    'half',
    'field-event',
    'mid-move',
    null,
    'faint',
    'hyper-voice-2',
    'howl-1',
    'howl-2',
    null,
    'uproar-2',
    'pinch',
    'pinch-half',
    'pokedex-chorus',
    'pokedex',
  ];
  const m = mods[mod];
  if (m === undefined) throw new Error(`battle anim: cry modulation ${mod}`);
  if (m === null) log.stub(`anim:cry-mod:${mod}`, 'cry modulation without a CryMod: played as a normal cry');
  return m ?? 'normal';
}
