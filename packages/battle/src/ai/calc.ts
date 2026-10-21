/**
 * The battle_lib.c helpers and the AI's own damage routines (decomp trainer_ai.c TrainerAI_CalcDamage,
 * TrainerAI_CalcAllDamage, TrainerAI_MoveType; battle_lib.c Battler_Ability, Battler_HeldItem,
 * BattleSystem_CountAbility, Move_CalcVariableType) over the view.
 */
import { ABILITY, ARCEUS_PLATE_TYPES, BATTLE_TYPE, FIELD_CONDITION, FIELD_CONDITION_WEATHER, MOVE, MOVE_EFFECT, MOVE_STATUS_IMMUNE, TYPE } from './constants.ts';
import type { AiDex } from './dex.ts';
import type { AiBattleView, AiPartyMon, AiRng } from './view.ts';

export interface Calc {
  dex: AiDex;
  view: AiBattleView;
  rng: AiRng;
}

/** BattleSystem_GetMaxBattlers. */
export const maxBattlers = (view: AiBattleView): number => (view.battleType & BATTLE_TYPE.DOUBLES ? 4 : 2);

/** BattleSystem_GetPartner: the other battler on the same side (singles: itself). */
export const partnerOf = (view: AiBattleView, battler: number): number => (view.battleType & BATTLE_TYPE.DOUBLES ? battler ^ 2 : battler);

/** Battler_Ability. */
export function battlerAbility(view: AiBattleView, battler: number): number {
  const b = view.battler(battler);
  if (b.moveEffects & MOVE_EFFECT.ABILITY_SUPPRESSED && b.ability !== ABILITY.MULTITYPE) return ABILITY.NONE;
  if (view.fieldConditions & FIELD_CONDITION.GRAVITY && b.ability === ABILITY.LEVITATE) return ABILITY.NONE;
  if (b.moveEffects & MOVE_EFFECT.INGRAIN && b.ability === ABILITY.LEVITATE) return ABILITY.NONE;
  return b.ability;
}

/** Battler_HeldItem: none under Klutz or Embargo. */
export function battlerHeldItem(view: AiBattleView, battler: number): number {
  if (battlerAbility(view, battler) === ABILITY.KLUTZ) return 0;
  const b = view.battler(battler);
  return b.embargoTurns ? 0 : b.heldItem;
}

/** BattleSystem_CountAbility for the modes the AI uses. */
export function countAbility(view: AiBattleView, mode: 'alive' | 'their-side' | 'all-except-me', battler: number, ability: number): number {
  let n = 0;
  for (let i = 0; i < maxBattlers(view); i++) {
    if (battlerAbility(view, i) !== ability) continue;
    if (mode === 'alive' && view.battler(i).hp) n++;
    else if (mode === 'their-side' && (i & 1) !== (battler & 1)) n++;
    else if (mode === 'all-except-me' && i !== battler) n++;
  }
  return n;
}

/** NO_CLOUD_NINE: no living battler has Cloud Nine or Air Lock. */
const noCloudNine = (view: AiBattleView): boolean => countAbility(view, 'alive', 0, ABILITY.CLOUD_NINE) === 0 && countAbility(view, 'alive', 0, ABILITY.AIR_LOCK) === 0;

/** Weather Ball's type in the current weather; TYPE_NORMAL without one (the DS leaves it unset there; see docs/decisions.md). */
function weatherBallType(view: AiBattleView): number {
  let type: number = TYPE.NORMAL;
  if (noCloudNine(view) && view.fieldConditions & FIELD_CONDITION_WEATHER) {
    const f = view.fieldConditions;
    if (f & FIELD_CONDITION.RAINING) type = TYPE.WATER;
    if (f & FIELD_CONDITION.SANDSTORM) type = TYPE.ROCK;
    if (f & FIELD_CONDITION.SUNNY) type = TYPE.FIRE;
    if (f & FIELD_CONDITION.HAILING) type = TYPE.ICE;
  }
  return type;
}

const plateType = (dex: AiDex, item: number): number => ARCEUS_PLATE_TYPES[dex.item(item).holdEffectName] ?? TYPE.NORMAL;

/** Hidden Power's type from IVs (HP, Atk, Def, Spe, SpA, SpD), skipping TYPE_MYSTERY. */
function hiddenPowerType(ivs: readonly number[]): number {
  let t = 0;
  for (let i = 0; i < 6; i++) t |= (ivs[i]! & 1) << i;
  t = Math.trunc((t * 15) / 63) + 1;
  return t >= TYPE.MYSTERY ? t + 1 : t;
}

function hiddenPowerPower(ivs: readonly number[]): number {
  let p = 0;
  for (let i = 0; i < 6; i++) p |= ((ivs[i]! & 2) >> 1) << i;
  return Math.trunc((p * 40) / 63) + 30;
}

/**
 * TrainerAI_MoveType: the type of a variable-type move used by a battler; TYPE_NORMAL (= "the move's own
 * type" to the type chart) for any other move.
 */
export function aiMoveType(c: Calc, battler: number, move: number): number {
  switch (move) {
    case MOVE.NATURAL_GIFT:
      return c.dex.item(battlerHeldItem(c.view, battler)).naturalGiftType;
    case MOVE.JUDGMENT:
      return plateType(c.dex, battlerHeldItem(c.view, battler));
    case MOVE.HIDDEN_POWER:
      return hiddenPowerType(c.view.battler(battler).ivs);
    case MOVE.WEATHER_BALL:
      return weatherBallType(c.view);
    default:
      return TYPE.NORMAL;
  }
}

/** Move_CalcVariableType: the same for a party Pokémon (its own item and IVs, no Klutz/Embargo check). */
export function partyMoveType(c: Calc, mon: AiPartyMon, move: number): number {
  switch (move) {
    case MOVE.NATURAL_GIFT:
      return c.dex.item(mon.heldItem).naturalGiftType;
    case MOVE.JUDGMENT:
      return plateType(c.dex, mon.heldItem);
    case MOVE.HIDDEN_POWER:
      return hiddenPowerType(mon.ivs);
    case MOVE.WEATHER_BALL:
      return weatherBallType(c.view);
    default:
      return TYPE.NORMAL;
  }
}

/** BattleSystem_Divide: truncating division that never rounds a non-zero result to 0. */
export function divide(dividend: number, divisor: number): number {
  if (dividend === 0) return 0;
  const q = Math.trunc(dividend / divisor);
  return q === 0 ? (dividend < 0 ? -1 : 1) : q;
}

/** The moves the AI scores by damage: an alternate-power effect, or power above 1 without a no-calc effect. */
export function damageScored(dex: AiDex, move: number): boolean {
  const m = dex.move(move);
  if (dex.script.altPowerEffects.includes(m.effect)) return true;
  return m.power > 1 && !dex.script.noDamageCalcEffects.includes(m.effect);
}

/**
 * TrainerAI_CalcDamage: `attacker`'s damage to `defender` with `move`, held item, IVs and ability given
 * separately (the party-member checks pass a bench Pokémon's), times `variance`/100.
 */
export function aiCalcDamage(
  c: Calc,
  defender: number,
  move: number,
  heldItem: number,
  ivs: readonly number[],
  attacker: number,
  ability: number,
  embargoTurns: number,
  variance: number,
): number {
  const a = c.view.battler(attacker);
  let damage = 0;
  let power = 0;
  let type: number = TYPE.NORMAL;
  switch (move) {
    case MOVE.NATURAL_GIFT:
      if (ability !== ABILITY.KLUTZ && embargoTurns === 0) {
        power = c.dex.item(heldItem).naturalGiftPower;
        type = power ? c.dex.item(heldItem).naturalGiftType : TYPE.NORMAL;
      }
      break;
    case MOVE.JUDGMENT:
      if (ability !== ABILITY.KLUTZ && embargoTurns === 0) type = plateType(c.dex, heldItem);
      break;
    case MOVE.HIDDEN_POWER:
      power = hiddenPowerPower(ivs);
      type = hiddenPowerType(ivs);
      break;
    case MOVE.GYRO_BALL:
      power = Math.min(150, 1 + Math.trunc((25 * c.view.speedValue(defender)) / c.view.speedValue(attacker)));
      break;
    case MOVE.DRAGON_RAGE:
      damage = 40;
      break;
    case MOVE.SEISMIC_TOSS:
    case MOVE.NIGHT_SHADE:
      damage = a.level;
      break;
    case MOVE.PSYWAVE:
      damage = Math.trunc((a.level * ((c.rng.next() % 11) + 5)) / 10);
      break;
    case MOVE.RETURN:
      power = Math.trunc((a.friendship * 10) / 25);
      break;
    case MOVE.FRUSTRATION:
      power = Math.trunc(((255 - a.friendship) * 10) / 25);
      break;
    case MOVE.MAGNITUDE: {
      const r = c.rng.next() % 100;
      power = r < 5 ? 10 : r < 15 ? 30 : r < 35 ? 50 : r < 65 ? 70 : r < 85 ? 90 : r < 95 ? 110 : 150;
      break;
    }
    case MOVE.SONIC_BOOM:
      damage = 20;
      break;
    case MOVE.LOW_KICK:
    case MOVE.GRASS_KNOT: {
      const weight = c.view.battler(defender).weight;
      power = c.dex.script.weightToPower.find(([limit]) => limit >= weight)?.[1] ?? 120;
      break;
    }
  }
  const fixed = damage !== 0;
  if (!fixed) damage = c.view.calcMoveDamage(move, attacker, defender, power, type);
  const chart = c.view.applyTypeChart(move, type, attacker, defender, damage, fixed);
  return chart.flags & MOVE_STATUS_IMMUNE ? 0 : divide(chart.damage * variance, 100);
}

/** TrainerAI_CalcAllDamage: damage per move slot (0 for unscored moves) and the highest. */
export function aiCalcAllDamage(
  c: Calc,
  defender: number,
  attacker: number,
  moves: readonly number[],
  heldItem: number,
  ivs: readonly number[],
  ability: number,
  embargoTurns: number,
  rolls: readonly number[] | null,
): { damage: number[]; max: number } {
  const damage = [0, 1, 2, 3].map((i) => {
    const move = moves[i] ?? 0;
    const m = c.dex.move(move);
    const scored = c.dex.script.altPowerEffects.includes(m.effect) || (move !== 0 && !c.dex.script.noDamageCalcEffects.includes(m.effect) && m.power > 1);
    return scored ? aiCalcDamage(c, defender, move, heldItem, ivs, attacker, ability, embargoTurns, rolls ? rolls[i]! : 100) : 0;
  });
  return { damage, max: Math.max(0, ...damage) };
}
