/**
 * The Gen 4 catch (decomp battle_script.c BattleScript_CalcCatchShakes): the ball modifier, the HP and
 * status terms, then up to four shake checks of a u16 roll against the threshold. Four shakes = caught.
 */
import type { StatusCondition } from '@opensinnoh/core';

/** decomp BALL_3_SHAKES_SUCCESS: four checks passed. */
export const CAUGHT = 4;

export interface BallContext {
  /** The target's types (bare `TYPE_*` names). */
  types: readonly string[];
  level: number;
  /** decomp BattleSystem_GetTerrain: the battle's terrain (bare `TERRAIN_*` name), or null. */
  terrain: string | null;
  time: 'day' | 'twilight' | 'night';
  /** The species is already caught (Repeat Ball). */
  caughtBefore: boolean;
  /** decomp battleCtx->totalTurns: turns finished before this one (0 on the first). */
  turns: number;
}

/** decomp sBasicBallMod (Ultra, Great, Poké, Safari), ×10. */
const BASIC: Record<string, number> = { ITEM_ULTRA_BALL: 20, ITEM_GREAT_BALL: 15, ITEM_POKE_BALL: 10, ITEM_SAFARI_BALL: 15 };

/**
 * The ball modifier ×10 for a ball item (its bare `ITEM_*` name). Every other ball (Luxury, Premier, Heal,
 * Cherish, a mod's) is 10, as in the decomp's switch default. The Master Ball never gets here (`catchShakes`).
 */
export function ballModifier(ball: string, c: BallContext): number {
  const basic = BASIC[ball];
  if (basic !== undefined) return basic;
  switch (ball) {
    case 'ITEM_NET_BALL':
      return c.types.includes('TYPE_WATER') || c.types.includes('TYPE_BUG') ? 30 : 10;
    case 'ITEM_DIVE_BALL':
      return c.terrain === 'TERRAIN_WATER' ? 35 : 10;
    case 'ITEM_NEST_BALL':
      return c.level < 40 ? Math.max(10, 40 - c.level) : 10;
    case 'ITEM_REPEAT_BALL':
      return c.caughtBefore ? 30 : 10;
    case 'ITEM_TIMER_BALL':
      return Math.min(40, 10 + c.turns);
    case 'ITEM_DUSK_BALL':
      // TIMEOFDAY_NIGHT and LATE_NIGHT are our `night`.
      return c.time === 'night' || c.terrain === 'TERRAIN_CAVE' ? 35 : 10;
    case 'ITEM_QUICK_BALL':
      return c.turns < 1 ? 40 : 10;
    default:
      return 10;
  }
}

/** CP_Sqrt32: the integer square root. */
const isqrt = (n: number) => Math.floor(Math.sqrt(n));

/**
 * The shakes (0–3 broke free after that many, 4 caught). `rate` = catchRate·ball/10 · (3·max − 2·hp) /
 * (3·max), ×2 asleep or frozen, ×1.5 poisoned, burned or paralysed (u32 integer maths); at 255 or more it is
 * caught without a roll; otherwise each check draws `rand16()` and passes below
 * (0xFFFF << 4) / sqrt(sqrt((0xFF << 16) / rate)).
 *
 * The Master Ball: the DS reads sBasicBallMod[-1] (the byte before the table) and then forces four shakes
 * after the rolls; we catch at once without rolling. `alwaysCatch` is BATTLE_TYPE_ALWAYS_CATCH (the catching
 * tutorial, Pal Park).
 */
export function catchShakes(o: { catchRate: number; ball: string; ballMod: number; maxHp: number; hp: number; status: StatusCondition; rand16: () => number; alwaysCatch?: boolean }): number {
  if (o.alwaysCatch || o.ball === 'ITEM_MASTER_BALL') return CAUGHT;
  let rate = Math.floor(Math.floor((o.catchRate * o.ballMod) / 10) * (o.maxHp * 3 - o.hp * 2) / (o.maxHp * 3));
  if (o.status === 'sleep' || o.status === 'freeze') rate *= 2;
  if (o.status === 'poison' || o.status === 'toxic' || o.status === 'burn' || o.status === 'paralysis') rate = Math.floor((rate * 15) / 10);
  if (rate >= 255) return CAUGHT;
  const threshold = Math.floor((0xffff << 4) / isqrt(isqrt(Math.floor((0xff << 16) / rate))));
  let shakes = 0;
  while (shakes < CAUGHT && o.rand16() < threshold) shakes++;
  return shakes;
}

/**
 * Decomp sSafariCatchRate (battle_script.c) and sFleeRateMultipliers (battle_display.c): the same 13 fractions,
 * indexed by the Safari catch stage and escape count (0–SAFARI_STAGE_MAX, both 6 at the start: ×1).
 */
export const SAFARI_STAGES: readonly (readonly [number, number])[] = [
  [10, 40], [10, 35], [10, 30], [10, 25], [10, 20], [10, 15], [10, 10], [15, 10], [20, 10], [25, 10], [30, 10], [35, 10], [40, 10],
];
/** Decomp SAFARI_STAGE_MAX. */
export const SAFARI_STAGE_MAX = 12;
/** Decomp battleCtx->safariCatchStage and safariEscapeCount at the start (BattleContext_Init). */
export const SAFARI_STAGE_START = 6;

/** A rate scaled by a Safari stage (u32 integer maths: rate · numerator / denominator). */
export function safariScaled(rate: number, stage: number): number {
  const f = SAFARI_STAGES[stage];
  if (!f) throw new Error(`battle: Safari stage ${stage} is out of range`);
  return Math.floor((rate * f[0]) / f[1]);
}
