/**
 * The AI script interpreter: move scoring (decomp trainer_ai.c TrainerAI_Init, TrainerAI_EvalMoves and the
 * 109 AICmd_* handlers). One `ScoreRun` is one AIContext between two TrainerAI_Init calls.
 *
 * Kept from the DS on purpose:
 * - Scores are s8: `AddToMoveScore` wraps at 127 before the clamp at 0 (100 + 30 scores 0).
 * - The cursor stack and the BREAK/ESCAPE flags live across moves and flags until the next init.
 * - Dummy3E does not advance the cursor: on the DS the script spins forever. We throw instead.
 */
import {
  ABILITY,
  AI_BATTLER,
  AI_HAVE,
  AI_MOVE_IS_HIGHEST_DAMAGE,
  AI_NO_COMPARISON_MADE,
  AI_NOT_HAVE,
  AI_NOT_HIGHEST_DAMAGE,
  AI_UNKNOWN,
  AI_WEATHER,
  BATTLE_STAT,
  BATTLE_TYPE,
  CHECK_DISABLE,
  CHECK_ENCORE,
  CHECK_EQUAL_TO_TARGET,
  CHECK_HIGHER_THAN_TARGET,
  CHECK_LOWER_THAN_TARGET,
  DEFAULT_STAT_STAGE,
  FIELD_CONDITION,
  LOAD_TYPE,
  MAX_STACK,
  MOVE,
  MOVE_EFFECT,
  MOVE_STATUS,
  MOVE_STATUS_IMMUNE,
  SIDE_CONDITION,
  TYPE_MULTI,
} from './constants.ts';
import { aiCalcAllDamage, aiCalcDamage, aiMoveType, battlerAbility, damageScored, maxBattlers, partnerOf, type Calc } from './calc.ts';
import { OP, OPCODES } from './opcodes.ts';
import type { AiBattler, AiPartyMon } from './view.ts';

const FLAG_DONE = 1 << 0;
const FLAG_ESCAPE = 1 << 1;
const FLAG_SAFARI = 1 << 2;
const FLAG_BREAK = 1 << 3;

/** A party member that can be sent out: alive, a species, not an egg. */
export const usable = (m: AiPartyMon): boolean => m.hp !== 0 && m.species !== 0 && !m.isEgg;

/** The effectiveness value scripts compare with (CalcMaxEffectiveness / IfMoveEffectivenessEquals). */
function effectivenessValue(damage: number, flags: number): number {
  let d = damage;
  if (d === TYPE_MULTI.STAB * 2) d = TYPE_MULTI.DOUBLE;
  else if (d === TYPE_MULTI.STAB * 4) d = TYPE_MULTI.QUADRUPLE;
  else if (d === TYPE_MULTI.STAB / 2) d = TYPE_MULTI.HALF;
  else if (d === TYPE_MULTI.STAB / 4) d = TYPE_MULTI.QUARTER;
  return flags & MOVE_STATUS_IMMUNE ? TYPE_MULTI.IMMUNE : d;
}

export class ScoreRun {
  readonly scores = [0, 0, 0, 0];
  readonly rolls = [100, 100, 100, 100];
  attacker: number;
  defender: number;
  mask: number;
  moveSlot = 0;
  move = 0;
  calcTemp = 0;
  stateFlags = 0;
  bitShift = 0;
  cursor = 0;
  stack: number[] = [];
  private readonly c: Calc;

  /** TrainerAI_Init: scores for the slots in `initScore` (bit per slot) start at 100, invalid moves at 0, then the four damage rolls. */
  constructor(c: Calc, attacker: number, defender: number, initScore: number, mask: number) {
    this.c = c;
    this.attacker = attacker;
    this.defender = defender;
    for (let i = 0; i < 4; i++) this.scores[i] = initScore & (1 << i) ? 100 : 0;
    const invalid = c.view.invalidMoves(attacker);
    for (let i = 0; i < 4; i++) {
      if (invalid & (1 << i)) this.scores[i] = 0;
      this.rolls[i] = 100 - (c.rng.next() % 16);
    }
    this.mask = mask >>> 0;
  }

  get escaped(): boolean {
    return (this.stateFlags & FLAG_ESCAPE) !== 0;
  }
  get safari(): boolean {
    return (this.stateFlags & FLAG_SAFARI) !== 0;
  }

  /** The flag loop of TrainerAI_MainSingles/MainDoubles: each set flag's routine over every move slot. */
  evalFlags(): void {
    for (let mask = this.mask; mask; mask >>>= 1) {
      if (mask & 1) this.evalMoves();
      this.bitShift++;
      this.moveSlot = 0;
    }
  }

  /** TrainerAI_EvalMoves for the current flag. */
  private evalMoves(): void {
    const code = this.c.dex.script.code;
    for (;;) {
      this.cursor = code[this.bitShift]!;
      const b = this.c.view.battler(this.attacker);
      this.move = b.pp[this.moveSlot] === 0 ? MOVE.NONE : (b.moves[this.moveSlot] ?? MOVE.NONE);
      while (!(this.stateFlags & FLAG_DONE)) {
        if (this.move === MOVE.NONE) {
          this.scores[this.moveSlot] = 0;
          this.stateFlags |= FLAG_DONE;
        } else {
          this.step();
        }
      }
      this.moveSlot++;
      const more = this.moveSlot < 4 && !(this.stateFlags & FLAG_BREAK);
      this.stateFlags &= ~FLAG_DONE;
      if (!more) return;
    }
  }

  private read(): number {
    const w = this.c.dex.script.code[this.cursor++];
    if (w === undefined) throw new Error(`trainer AI: read past the script at word ${this.cursor - 1}`);
    return w;
  }

  private jump(offset: number, when: boolean): void {
    if (when) this.cursor += offset;
  }

  /** AIScript_Battler. */
  private who(inBattler: number): number {
    switch (inBattler) {
      case AI_BATTLER.ATTACKER:
        return this.attacker;
      case AI_BATTLER.ATTACKER_PARTNER:
        return this.attacker ^ 2;
      case AI_BATTLER.DEFENDER_PARTNER:
        return this.defender ^ 2;
      default:
        return this.defender;
    }
  }

  private mon(battler: number): AiBattler {
    return this.c.view.battler(battler);
  }

  private moveData(move: number) {
    return this.c.dex.move(move);
  }

  private random(): number {
    return this.c.rng.next() % 256;
  }

  private hpPercent(battler: number): number {
    const b = this.mon(battler);
    // ARM integer division by zero yields 0 (an empty partner slot).
    return b.maxHp ? Math.trunc((b.hp * 100) / b.maxHp) : 0;
  }

  /** The party slots of the battler and its partner (doubles), excluded from party checks. */
  private activeSlots(battler: number): [number, number] {
    const v = this.c.view;
    const own = v.selectedPartySlot(battler);
    return v.battleType & BATTLE_TYPE.DOUBLES ? [own, v.selectedPartySlot(partnerOf(v, battler))] : [own, own];
  }

  /** IVs of the AI's battler (BattleMon_Get HP_IV + i). */
  private attackerIvs(): number[] {
    return this.mon(this.attacker).ivs;
  }

  /** The AI battler's damage per move; `vary` = TRUE (1) uses the damage rolls. */
  private allDamage(vary: number): { damage: number[]; max: number } {
    const a = this.mon(this.attacker);
    return aiCalcAllDamage(this.c, this.defender, this.attacker, a.moves, a.heldItem, a.ivs, battlerAbility(this.c.view, this.attacker), a.embargoTurns, vary === 1 ? this.rolls : null);
  }

  /** The ability a script sees: its own battler's for real, an opponent's as known or guessed (LoadBattlerAbility). */
  private guessedAbility(battler: number, inBattler: number): number {
    const b = this.mon(battler);
    if (b.moveEffects & MOVE_EFFECT.ABILITY_SUPPRESSED) return ABILITY.NONE;
    if (this.attacker === battler || inBattler === AI_BATTLER.ATTACKER_PARTNER) return b.ability;
    const known = this.c.view.memory.knownAbilities[battler]!;
    if (known) return known;
    if (b.ability === ABILITY.SHADOW_TAG || b.ability === ABILITY.MAGNET_PULL || b.ability === ABILITY.ARENA_TRAP) return b.ability;
    const [a1, a2] = this.c.dex.speciesAbilities(b.species);
    if (a1 && a2) return this.c.rng.next() & 1 ? a1 : a2;
    return a1 ? a1 : a2;
  }

  private stat(battler: number, stat: number): number {
    const b = this.mon(battler);
    switch (stat) {
      case BATTLE_STAT.HP:
        return b.hp;
      case BATTLE_STAT.ATTACK:
        return b.attack;
      case BATTLE_STAT.DEFENSE:
        return b.defense;
      case BATTLE_STAT.SP_ATTACK:
        return b.spAttack;
      case BATTLE_STAT.SP_DEFENSE:
        return b.spDefense;
      case BATTLE_STAT.SPEED:
        return b.speed;
      default:
        throw new Error(`trainer AI: TrainerAI_GetStats stat ${stat}`);
    }
  }

  private typeChart(move: number, attacker: number, defender: number, damage: number) {
    return this.c.view.applyTypeChart(move, aiMoveType(this.c, attacker, move), attacker, defender, damage, false);
  }

  /** Execute one instruction. */
  private step(): void {
    const v = this.c.view;
    const dex = this.c.dex;
    const at = this.cursor;
    const op = this.read();
    switch (op) {
      case OP.IfRandomLessThan: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.random() < val);
      }
      case OP.IfRandomGreaterThan: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.random() > val);
      }
      case OP.IfRandomEqualTo: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.random() === val);
      }
      case OP.IfRandomNotEqualTo: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.random() !== val);
      }
      case OP.AddToMoveScore: {
        const s = ((this.scores[this.moveSlot]! + this.read()) << 24) >> 24;
        this.scores[this.moveSlot] = s < 0 ? 0 : s;
        return;
      }
      case OP.IfHPPercentLessThan:
      case OP.IfHPPercentGreaterThan:
      case OP.IfHPPercentEqualTo:
      case OP.IfHPPercentNotEqualTo: {
        const [b, pct, j] = [this.read(), this.read(), this.read()];
        const hp = this.hpPercent(this.who(b));
        const cmp = [hp < pct, hp > pct, hp === pct, hp !== pct][op - OP.IfHPPercentLessThan]!;
        return this.jump(j, cmp);
      }
      case OP.IfStatus:
      case OP.IfNotStatus: {
        const [b, mask, j] = [this.read(), this.read(), this.read()];
        const set = (this.mon(this.who(b)).status & mask) !== 0;
        return this.jump(j, op === OP.IfStatus ? set : !set);
      }
      case OP.IfVolatileStatus:
      case OP.IfNotVolatileStatus: {
        const [b, mask, j] = [this.read(), this.read(), this.read()];
        const set = (this.mon(this.who(b)).volatile & mask) !== 0;
        return this.jump(j, op === OP.IfVolatileStatus ? set : !set);
      }
      case OP.IfMoveEffect:
      case OP.IfNotMoveEffect: {
        const [b, mask, j] = [this.read(), this.read(), this.read()];
        const set = (this.mon(this.who(b)).moveEffects & mask) !== 0;
        return this.jump(j, op === OP.IfMoveEffect ? set : !set);
      }
      case OP.IfSideCondition:
      case OP.IfNotSideCondition: {
        const [b, mask, j] = [this.read(), this.read(), this.read()];
        const set = (v.sideConditions(this.who(b) & 1) & mask) !== 0;
        return this.jump(j, op === OP.IfSideCondition ? set : !set);
      }
      case OP.IfLoadedLessThan: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.calcTemp < val);
      }
      case OP.IfLoadedGreaterThan: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.calcTemp > val);
      }
      case OP.IfLoadedEqualTo:
      case OP.IfTempEqualTo: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.calcTemp === val);
      }
      case OP.IfLoadedNotEqualTo:
      case OP.IfTempNotEqualTo: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.calcTemp !== val);
      }
      case OP.IfLoadedMask: {
        const [mask, j] = [this.read(), this.read()];
        return this.jump(j, (this.calcTemp & mask) !== 0);
      }
      case OP.IfLoadedNotMask: {
        const [mask, j] = [this.read(), this.read()];
        return this.jump(j, (this.calcTemp & mask) === 0);
      }
      case OP.IfMoveEqualTo: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.move === val);
      }
      case OP.IfMoveNotEqualTo: {
        const [val, j] = [this.read(), this.read()];
        return this.jump(j, this.move !== val);
      }
      case OP.IfLoadedInTable:
      case OP.IfLoadedNotInTable: {
        const [ofs, j] = [this.read(), this.read()];
        const code = dex.script.code;
        let found = false;
        for (let i = this.cursor + ofs; code[i] !== -1; i++) {
          if (code[i] === undefined) throw new Error(`trainer AI: table at word ${this.cursor + ofs} has no end`);
          if (code[i] === this.calcTemp) {
            found = true;
            break;
          }
        }
        return this.jump(j, op === OP.IfLoadedInTable ? found : !found);
      }
      case OP.IfAttackerHasDamagingMoves:
      case OP.IfAttackerHasNoDamagingMoves: {
        const j = this.read();
        const has = this.mon(this.attacker).moves.some((m) => m !== MOVE.NONE && this.moveData(m).power !== 0);
        return this.jump(j, op === OP.IfAttackerHasDamagingMoves ? has : !has);
      }
      case OP.LoadTurnCount:
        this.calcTemp = v.totalTurns;
        return;
      case OP.LoadTypeFrom: {
        const what = this.read();
        const partner = (b: number) => partnerOf(v, b);
        switch (what) {
          case LOAD_TYPE.ATTACKER_TYPE_1:
            this.calcTemp = this.mon(this.attacker).types[0];
            return;
          case LOAD_TYPE.DEFENDER_TYPE_1:
            this.calcTemp = this.mon(this.defender).types[0];
            return;
          case LOAD_TYPE.ATTACKER_TYPE_2:
            this.calcTemp = this.mon(this.attacker).types[1];
            return;
          case LOAD_TYPE.DEFENDER_TYPE_2:
            this.calcTemp = this.mon(this.defender).types[1];
            return;
          case LOAD_TYPE.MOVE_TYPE:
            this.calcTemp = this.moveData(this.move).type;
            return;
          case LOAD_TYPE.ATTACKER_PARTNER_TYPE_1:
            this.calcTemp = this.mon(partner(this.attacker)).types[0];
            return;
          case LOAD_TYPE.DEFENDER_PARTNER_TYPE_1:
            this.calcTemp = this.mon(partner(this.defender)).types[0];
            return;
          case LOAD_TYPE.ATTACKER_PARTNER_TYPE_2:
            this.calcTemp = this.mon(partner(this.attacker)).types[1];
            return;
          case LOAD_TYPE.DEFENDER_PARTNER_TYPE_2:
            // The DS loads TYPE_1 here (decomp trainer_ai.c AICmd_LoadTypeFrom).
            this.calcTemp = this.mon(partner(this.defender)).types[0];
            return;
          default:
            throw new Error(`trainer AI: LoadTypeFrom ${what} at word ${at}`);
        }
      }
      case OP.LoadMovePower:
        this.calcTemp = this.moveData(this.move).power;
        return;
      case OP.FlagMoveDamageScore: {
        const vary = this.read();
        if (damageScored(dex, this.move)) {
          const { damage } = this.allDamage(vary);
          const mine = damage[this.moveSlot]!;
          this.calcTemp = damage.some((d) => d > mine) ? AI_NOT_HIGHEST_DAMAGE : AI_MOVE_IS_HIGHEST_DAMAGE;
        } else {
          this.calcTemp = AI_NO_COMPARISON_MADE;
        }
        return;
      }
      case OP.LoadBattlerPreviousMove:
        this.calcTemp = v.previousMove(this.who(this.read()));
        return;
      case OP.IfSpeedCompareEqualTo:
      case OP.IfSpeedCompareNotEqualTo: {
        const [val, j] = [this.read(), this.read()];
        const cmp = v.compareSpeed(this.attacker, this.defender);
        return this.jump(j, op === OP.IfSpeedCompareEqualTo ? cmp === val : cmp !== val);
      }
      case OP.CountAlivePartyBattlers: {
        const battler = this.who(this.read());
        const [s1, s2] = this.activeSlots(battler);
        this.calcTemp = v.party(battler).filter((m, i) => i !== s1 && i !== s2 && usable(m)).length;
        return;
      }
      case OP.LoadCurrentMove:
        this.calcTemp = this.move;
        return;
      case OP.LoadCurrentMoveEffect:
        this.calcTemp = this.moveData(this.move).effect;
        return;
      case OP.LoadBattlerAbility: {
        const inBattler = this.read();
        this.calcTemp = this.guessedAbility(this.who(inBattler), inBattler);
        return;
      }
      case OP.CheckBattlerAbility: {
        const [inBattler, expected] = [this.read(), this.read()];
        const battler = this.who(inBattler);
        const b = this.mon(battler);
        let ability: number;
        if (b.moveEffects & MOVE_EFFECT.ABILITY_SUPPRESSED) ability = ABILITY.NONE;
        else if (inBattler === AI_BATTLER.DEFENDER || inBattler === AI_BATTLER.DEFENDER_PARTNER) {
          const known = v.memory.knownAbilities[battler]!;
          if (known) ability = known;
          else if (b.ability === ABILITY.SHADOW_TAG || b.ability === ABILITY.MAGNET_PULL || b.ability === ABILITY.ARENA_TRAP) ability = b.ability;
          else {
            const [a1, a2] = dex.speciesAbilities(b.species);
            // Two possible abilities: if one is the expected one, the AI treats it as unknown.
            if (a1 && a2) ability = a1 !== expected && a2 !== expected ? a1 : ABILITY.NONE;
            else ability = a1 ? a1 : a2;
          }
        } else ability = b.ability;
        this.calcTemp = ability === ABILITY.NONE ? AI_UNKNOWN : ability === expected ? AI_HAVE : AI_NOT_HAVE;
        return;
      }
      case OP.CalcMaxEffectiveness: {
        this.calcTemp = TYPE_MULTI.IMMUNE;
        for (const move of this.mon(this.attacker).moves) {
          if (!move) continue;
          const r = this.typeChart(move, this.attacker, this.defender, TYPE_MULTI.BASE);
          const d = effectivenessValue(r.damage, r.flags);
          if (this.calcTemp < d) this.calcTemp = d;
        }
        return;
      }
      case OP.IfMoveEffectivenessEquals: {
        const [expected, j] = [this.read(), this.read()];
        const r = this.typeChart(this.move, this.attacker, this.defender, TYPE_MULTI.BASE);
        return this.jump(j, effectivenessValue(r.damage, r.flags) === expected);
      }
      case OP.IfPartyMemberStatus:
      case OP.IfPartyMemberNotStatus: {
        const [b, mask, j] = [this.read(), this.read(), this.read()];
        const battler = this.who(b);
        const [s1, s2] = this.activeSlots(battler);
        const any = v.party(battler).some((m, i) => i !== s1 && i !== s2 && usable(m) && (op === OP.IfPartyMemberStatus ? (m.status & mask) !== 0 : (m.status & mask) === 0));
        return this.jump(j, any);
      }
      case OP.LoadCurrentWeather: {
        const f = v.fieldConditions;
        let w: number = AI_WEATHER.CLEAR;
        if (f & FIELD_CONDITION.RAINING) w = AI_WEATHER.RAINING;
        if (f & FIELD_CONDITION.SANDSTORM) w = AI_WEATHER.SANDSTORM;
        if (f & FIELD_CONDITION.SUNNY) w = AI_WEATHER.SUNNY;
        if (f & FIELD_CONDITION.HAILING) w = AI_WEATHER.HAILING;
        if (f & FIELD_CONDITION.DEEP_FOG) w = AI_WEATHER.DEEP_FOG;
        this.calcTemp = w;
        return;
      }
      case OP.IfCurrentMoveEffectEqualTo:
      case OP.IfCurrentMoveEffectNotEqualTo: {
        const [val, j] = [this.read(), this.read()];
        const eq = this.moveData(this.move).effect === val;
        return this.jump(j, op === OP.IfCurrentMoveEffectEqualTo ? eq : !eq);
      }
      case OP.IfStatStageLessThan:
      case OP.IfStatStageGreaterThan:
      case OP.IfStatStageEqualTo:
      case OP.IfStatStageNotEqualTo: {
        const [b, stat, val, j] = [this.read(), this.read(), this.read(), this.read()];
        const s = this.mon(this.who(b)).statStages[stat]!;
        return this.jump(j, [s < val, s > val, s === val, s !== val][op - OP.IfStatStageLessThan]!);
      }
      case OP.IfCurrentMoveKills:
      case OP.IfCurrentMoveDoesNotKill: {
        const [useRoll, j] = [this.read(), this.read()];
        if (!damageScored(dex, this.move)) return;
        const a = this.mon(this.attacker);
        const roll = useRoll === 1 ? this.rolls[this.moveSlot]! : 100;
        const damage = aiCalcDamage(this.c, this.defender, this.move, a.heldItem, a.ivs, this.attacker, battlerAbility(v, this.attacker), a.embargoTurns, roll);
        const kills = this.mon(this.defender).hp <= damage;
        return this.jump(j, op === OP.IfCurrentMoveKills ? kills : !kills);
      }
      case OP.IfMoveKnown:
      case OP.IfMoveNotKnown:
      case OP.IfMoveEffectKnown:
      case OP.IfMoveEffectNotKnown: {
        const [inBattler, val, j] = [this.read(), this.read(), this.read()];
        const battler = this.who(inBattler);
        const byEffect = op === OP.IfMoveEffectKnown || op === OP.IfMoveEffectNotKnown;
        const matches = (m: number) => (byEffect ? m !== MOVE.NONE && this.moveData(m).effect === val : m === val);
        let moves: number[];
        if (inBattler === AI_BATTLER.ATTACKER) moves = this.mon(battler).moves;
        else if (inBattler === AI_BATTLER.ATTACKER_PARTNER && !byEffect) {
          if (this.mon(battler).hp === 0) return;
          moves = this.mon(battler).moves;
        } else if (inBattler === AI_BATTLER.DEFENDER) moves = v.memory.knownMoves[battler]!;
        else return;
        const known = moves.some(matches);
        return this.jump(j, op === OP.IfMoveKnown || op === OP.IfMoveEffectKnown ? known : !known);
      }
      case OP.IfBattlerUnderEffect: {
        const [b, check, j] = [this.read(), this.read(), this.read()];
        const mon = this.mon(this.who(b));
        if (check === CHECK_DISABLE) return this.jump(j, mon.disabledTurns !== 0);
        if (check === CHECK_ENCORE) return this.jump(j, mon.encoredTurns !== 0);
        return;
      }
      case OP.IfCurrentMoveMatchesEffect: {
        const [check, j] = [this.read(), this.read()];
        const a = this.mon(this.attacker);
        if (check === CHECK_DISABLE) return this.jump(j, a.disabledMove === this.move);
        if (check === CHECK_ENCORE) return this.jump(j, a.encoredMove === this.move);
        return;
      }
      case OP.Escape:
        this.stateFlags |= FLAG_DONE | FLAG_ESCAPE | FLAG_BREAK;
        return;
      case OP.Dummy3E:
      case OP.Dummy3F:
        // The DS handlers return without moving the cursor, so the script never ends (Safari_Main).
        throw new Error(`trainer AI: ${OPCODES[op]!.name} at word ${at} never ends on the DS`);
      case OP.LoadHeldItem:
        this.calcTemp = this.mon(this.who(this.read())).heldItem;
        return;
      case OP.LoadHeldItemEffect: {
        const battler = this.who(this.read());
        const item = this.attacker !== battler ? v.memory.knownHeldItems[battler]! : this.mon(battler).heldItem;
        this.calcTemp = dex.item(item).holdEffect;
        return;
      }
      case OP.IfHeldItemEqualTo: {
        const [b, item, j] = [this.read(), this.read(), this.read()];
        const battler = this.who(b);
        const held = (battler & 1) === (this.attacker & 1) ? this.mon(battler).heldItem : v.memory.knownHeldItems[battler]!;
        return this.jump(j, held === item);
      }
      case OP.LoadGender:
        this.calcTemp = this.mon(this.who(this.read())).gender;
        return;
      case OP.LoadIsFirstTurnInBattle:
        this.calcTemp = this.mon(this.who(this.read())).switchInTurn < v.totalTurns ? 0 : 1;
        return;
      case OP.LoadStockpileCount:
        this.calcTemp = this.mon(this.who(this.read())).stockpileCount;
        return;
      case OP.LoadBattleType:
        this.calcTemp = v.battleType | 0;
        return;
      case OP.LoadRecycleItem:
        this.calcTemp = v.recycleItem(this.who(this.read()));
        return;
      case OP.LoadTypeOfLoadedMove:
        this.calcTemp = this.moveData(this.calcTemp).type;
        return;
      case OP.LoadPowerOfLoadedMove:
        this.calcTemp = this.moveData(this.calcTemp).power;
        return;
      case OP.LoadEffectOfLoadedMove:
        this.calcTemp = this.moveData(this.calcTemp).effect;
        return;
      case OP.LoadProtectChain: {
        const battler = this.who(this.read());
        const p = v.protectMove(battler);
        this.calcTemp = p === MOVE.PROTECT || p === MOVE.DETECT || p === MOVE.ENDURE ? this.mon(battler).protectSuccessTurns : 0;
        return;
      }
      case OP.PushAndGoTo: {
        const j = this.read();
        if (this.stack.length >= MAX_STACK) throw new Error(`trainer AI: cursor stack overflow at word ${at}`);
        this.stack.push(this.cursor);
        this.cursor += j;
        return;
      }
      case OP.GoTo: {
        const j = this.read();
        this.cursor += j;
        return;
      }
      case OP.PopOrEnd:
        if (this.stack.length) this.cursor = this.stack.pop()!;
        else this.stateFlags |= FLAG_DONE;
        return;
      case OP.IfLevel: {
        const [check, j] = [this.read(), this.read()];
        const a = this.mon(this.attacker).level;
        const d = this.mon(this.defender).level;
        if (check === CHECK_HIGHER_THAN_TARGET) return this.jump(j, a > d);
        if (check === CHECK_LOWER_THAN_TARGET) return this.jump(j, a < d);
        if (check === CHECK_EQUAL_TO_TARGET) return this.jump(j, a === d);
        return;
      }
      case OP.IfTargetIsTaunted:
      case OP.IfTargetIsNotTaunted: {
        const j = this.read();
        const taunted = this.mon(this.defender).tauntedTurns !== 0;
        return this.jump(j, op === OP.IfTargetIsTaunted ? taunted : !taunted);
      }
      case OP.IfTargetIsPartner:
        return this.jump(this.read(), (this.attacker & 1) === (this.defender & 1));
      case OP.FlagBattlerIsType: {
        const [b, type] = [this.read(), this.read()];
        const t = this.mon(this.who(b)).types;
        this.calcTemp = t[0] === type || t[1] === type ? 1 : 0;
        return;
      }
      case OP.IfActivatedFlashFire: {
        const [b, j] = [this.read(), this.read()];
        return this.jump(j, this.mon(this.who(b)).flashFire);
      }
      case OP.IfFieldConditionsMask: {
        const [mask, j] = [this.read(), this.read()];
        return this.jump(j, (v.fieldConditions & mask) !== 0);
      }
      case OP.LoadSpikesLayers: {
        const [b, cond] = [this.read(), this.read()];
        const side = this.who(b) & 1;
        if (cond === SIDE_CONDITION.SPIKES) this.calcTemp = v.spikesLayers(side);
        else if (cond === SIDE_CONDITION.TOXIC_SPIKES) this.calcTemp = v.toxicSpikesLayers(side);
        return;
      }
      case OP.IfAnyPartyMemberIsWounded: {
        const [b, j] = [this.read(), this.read()];
        const battler = this.who(b);
        const own = v.selectedPartySlot(battler);
        return this.jump(j, v.party(battler).some((m, i) => i !== own && m.hp !== m.maxHp));
      }
      case OP.IfAnyPartyMemberUsedPP: {
        const [b, j] = [this.read(), this.read()];
        const battler = this.who(b);
        const own = v.selectedPartySlot(battler);
        return this.jump(j, v.party(battler).some((m, i) => i !== own && [0, 1, 2, 3].some((k) => (m.pp[k] ?? 0) !== (m.maxPp[k] ?? 0))));
      }
      case OP.LoadFlingPower: {
        const b = this.mon(this.who(this.read()));
        this.calcTemp = b.embargoTurns ? 0 : dex.item(b.heldItem).flingPower;
        return;
      }
      case OP.LoadCurrentMovePP:
        this.calcTemp = this.mon(this.attacker).pp[this.moveSlot]!;
        return;
      case OP.IfCanUseLastResort: {
        const [b, j] = [this.read(), this.read()];
        const mon = this.mon(this.who(b));
        let known = mon.moves.findIndex((m) => m === MOVE.NONE);
        if (known < 0) known = 4;
        return this.jump(j, mon.lastResortCount >= known - 1 && known > 1);
      }
      case OP.LoadCurrentMoveClass:
        this.calcTemp = this.moveData(this.move).class;
        return;
      case OP.LoadDefenderLastUsedMoveClass:
        this.calcTemp = this.moveData(v.previousMove(this.defender)).class;
        return;
      case OP.LoadBattlerSpeedRank: {
        const battler = this.who(this.read());
        const n = maxBattlers(v);
        const order = Array.from({ length: n }, (_, i) => i);
        for (let i = 0; i < n - 1; i++)
          for (let k = i + 1; k < n; k++)
            if (v.compareSpeed(order[i]!, order[k]!)) [order[i], order[k]] = [order[k]!, order[i]!];
        const rank = order.indexOf(battler);
        if (rank >= 0) this.calcTemp = rank;
        return;
      }
      case OP.LoadBattlerTurnCount:
        this.calcTemp = v.totalTurns - this.mon(this.who(this.read())).switchInTurn;
        return;
      case OP.IfPartyMemberDealsMoreDamage: {
        const [vary, j] = [this.read(), this.read()];
        const active = this.allDamage(vary).max;
        const own = v.selectedPartySlot(this.attacker);
        const party = v.party(this.attacker);
        for (let i = 0; i < party.length; i++) {
          const m = party[i]!;
          if (i === own || !usable(m)) continue;
          const d = aiCalcAllDamage(this.c, this.defender, this.attacker, m.moves, m.heldItem, m.ivs, m.ability, 0, vary === 1 ? this.rolls : null).max;
          if (d > active) return this.jump(j, true);
        }
        return;
      }
      case OP.IfHasSuperEffectiveMove:
        return this.jump(this.read(), hasSuperEffectiveMove(this.c, this.attacker, true));
      case OP.IfBattlerDealsMoreDamage: {
        const [b, vary, j] = [this.read(), this.read(), this.read()];
        const ivs = this.attackerIvs();
        const ai = this.allDamage(vary).max;
        const battler = this.who(b);
        const other = this.mon(battler);
        const roll = vary === 1 ? this.rolls[this.moveSlot]! : 100;
        // The DS passes the AI battler's IVs for the other battler too.
        const theirs = aiCalcDamage(this.c, this.defender, v.previousMove(battler), other.heldItem, ivs, battler, battlerAbility(v, battler), other.embargoTurns, roll);
        return this.jump(j, theirs > ai);
      }
      case OP.SumPositiveStatStages: {
        const b = this.mon(this.who(this.read()));
        this.calcTemp = b.statStages.reduce((sum, s) => (s > DEFAULT_STAT_STAGE ? sum + s - DEFAULT_STAT_STAGE : sum), 0);
        return;
      }
      case OP.DiffStatStages: {
        const [b, stat] = [this.read(), this.read()];
        this.calcTemp = this.mon(this.who(b)).statStages[stat]! - this.mon(this.attacker).statStages[stat]!;
        return;
      }
      case OP.IfBattlerHasHigherStat:
      case OP.IfBattlerHasLowerStat:
      case OP.IfBattlerHasEqualStat: {
        const [b, stat, j] = [this.read(), this.read(), this.read()];
        const mine = this.stat(this.attacker, stat);
        const theirs = this.stat(this.who(b), stat);
        return this.jump(j, [mine < theirs, mine > theirs, mine === theirs][op - OP.IfBattlerHasHigherStat]!);
      }
      case OP.CheckIfHighestDamageWithPartner: {
        const vary = this.read();
        if (!damageScored(dex, this.move)) {
          this.calcTemp = AI_NO_COMPARISON_MADE;
          return;
        }
        let battler = this.attacker;
        let mine = 0;
        for (let k = 0; k < 2; k++) {
          const b = this.mon(battler);
          const { damage } = aiCalcAllDamage(this.c, this.defender, battler, b.moves, b.heldItem, this.mon(battler).ivs, battlerAbility(v, battler), b.embargoTurns, vary === 1 ? this.rolls : null);
          battler = partnerOf(v, this.attacker);
          if (k === 0) mine = damage[this.moveSlot]!;
          if (damage.some((d) => d > mine)) {
            this.calcTemp = AI_NOT_HIGHEST_DAMAGE;
            return;
          }
          this.calcTemp = AI_MOVE_IS_HIGHEST_DAMAGE;
        }
        return;
      }
      case OP.IfBattlerFainted:
      case OP.IfBattlerNotFainted: {
        const [b, j] = [this.read(), this.read()];
        if (b === AI_BATTLER.ATTACKER || b === AI_BATTLER.DEFENDER) throw new Error(`trainer AI: ${OPCODES[op]!.name} on battler operand ${b} at word ${at}`);
        const switching = v.switching(this.who(b));
        return this.jump(j, op === OP.IfBattlerFainted ? switching : !switching);
      }
      case OP.LoadAbility:
        this.calcTemp = battlerAbility(v, this.who(this.read()));
        return;
      default:
        throw new Error(`trainer AI: unknown opcode ${op} at word ${at}`);
    }
  }
}

/**
 * AI_HasSuperEffectiveMove: the battler has a move super effective on the opponent across from it (or,
 * in doubles, that one's partner). Without `always`, each such move says yes 9 times in 10.
 */
export function hasSuperEffectiveMove(c: Calc, battler: number, always: boolean): boolean {
  const v = c.view;
  let defender = battler ^ 1;
  const check = (): boolean => {
    if (v.switching(defender)) return false;
    for (const move of v.battler(battler).moves) {
      if (!move) continue;
      const r = v.applyTypeChart(move, aiMoveType(c, battler, move), battler, defender, 0, false);
      if (r.flags & MOVE_STATUS.SUPER_EFFECTIVE && (always || c.rng.next() % 10 !== 0)) return true;
    }
    return false;
  };
  if (check()) return true;
  if (!(v.battleType & BATTLE_TYPE.DOUBLES)) return false;
  defender = partnerOf(v, defender);
  return check();
}
