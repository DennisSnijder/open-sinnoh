/**
 * Battle formulas we own (decomp), next to the exp and EV rules in core `pokemon.ts`.
 */

/**
 * Decomp Battler_CanEscape: Smoke Ball (HOLD_EFFECT_FLEE) and Run Away always escape; a battler at least as
 * fast as the foe always escapes; otherwise `u8 escape = speed·128/foeSpeed + attempts·30` (the u8 wrap kept)
 * must beat `rand % 256`. Speeds are the battlers' stats, not their stages. The caller counts the attempt
 * (the DS counts it in the speed branches only, as `attempts` here).
 */
export function canEscape(o: { speed: number; foeSpeed: number; attempts: number; smokeBall: boolean; runAway: boolean; rand16: () => number }): boolean {
  if (o.smokeBall || o.runAway) return true;
  if (o.speed >= o.foeSpeed) return true;
  const escape = (Math.floor((o.speed * 128) / o.foeSpeed) + o.attempts * 30) & 0xff;
  return escape > o.rand16() % 256;
}

/**
 * Decomp BattleScript_CalcPrizeMoney for one trainer in a single battle: the level of the trainer's last party
 * member (a u8) · 4 · prizeMoneyMul (2 with an Amulet Coin out) · the class multiplier (sTrainerClassPrizeMul).
 */
export function prizeMoney(partyLevels: readonly number[], classPrize: number, prizeMul: 1 | 2 | number): number {
  const last = partyLevels[partyLevels.length - 1];
  if (last === undefined) throw new Error('prize money: the trainer has no party');
  return (last & 0xff) * 4 * prizeMul * classPrize;
}

/** Decomp BattleSystem_CalcMoneyPenalty: the party's highest level · 4 · {2,4,6,9,12,16,20,25,30}[badges], at most the money. */
export function moneyPenalty(partyLevels: readonly number[], badges: number, money: number): number {
  const mul = [2, 4, 6, 9, 12, 16, 20, 25, 30][badges];
  if (mul === undefined) throw new Error(`money penalty: ${badges} badges`);
  return Math.min(money, Math.max(0, ...partyLevels) * 4 * mul);
}

/**
 * Decomp Pokemon_UpdateFriendship for FRIENDSHIP_EVENT_LEVEL_UP: +5/+3/+2 below 100/200/above, +1 in a
 * Luxury Ball, ×1.5 with Soothe Bell (HOLD_EFFECT_FRIENDSHIP_UP), capped at 255. The met-location bonus
 * needs the egg location, which the model does not keep.
 */
export function levelUpFriendship(friendship: number, luxuryBall: boolean, sootheBell: boolean): number {
  let change = friendship >= 200 ? 2 : friendship >= 100 ? 3 : 5;
  if (luxuryBall) change++;
  if (sootheBell) change = Math.floor((change * 150) / 100);
  return Math.min(255, friendship + change);
}

/** Gauge pixels: the HP bar is 48 px (6 cells), the EXP bar 96 (12). */
export const HP_PIXELS = 48;
export const EXP_PIXELS = 96;

/**
 * The DS gauge animation (healthbox.c UpdateGauge, called by Task_UpdateHPGauge / Task_UpdateExpGauge, main-loop
 * SysTasks: one frame per 30 Hz tick): a gauge with fewer points than pixels moves one pixel's worth per frame
 * (8.8 fixed point in `temp`); a bigger one moves by the pixel distance of the whole change, in points, per frame. Returns the new `temp` and the value to show.
 */
export function gaugeFrame(max: number, from: number, to: number, pixels: number, temp: number): { temp: number; shown: number } {
  if (max < pixels) {
    const ratio = Math.floor((max * 0x100) / pixels);
    if (to > temp >> 8) {
      const next = temp + ratio;
      return next >> 8 >= to ? { temp: to << 8, shown: to } : { temp: next, shown: next >> 8 };
    }
    const next = temp - ratio;
    const shown = (next >> 8) + ((next & 0xff) > 0 ? 1 : 0);
    return shown <= to ? { temp: to << 8, shown: to } : { temp: next, shown };
  }
  const step = Math.max(1, Math.abs(Math.floor((from * pixels) / max) - Math.floor((to * pixels) / max)));
  if (to > temp) {
    const next = Math.min(to, temp + step);
    return { temp: next, shown: next };
  }
  const next = Math.max(to, temp - step);
  return { temp: next, shown: next };
}

/** Initial gauge `temp` for a value (see `gaugeFrame`). */
export const gaugeTemp = (max: number, value: number, pixels: number) => (max < pixels ? value << 8 : value);

/**
 * Decomp FillCells: filled pixels of a gauge (at least 1 while the value is above 0) and the per-cell fill
 * (0–8 each).
 */
export function gaugeCells(max: number, value: number, cells: number): { pixels: number; fill: number[] } {
  const size = cells * 8;
  let pixels = max > 0 ? Math.floor((value * size) / max) : 0;
  if (pixels === 0 && value > 0) pixels = 1;
  return { pixels, fill: Array.from({ length: cells }, (_, i) => Math.max(0, Math.min(8, pixels - i * 8))) };
}

/** Decomp App_BarColor over the HP gauge's pixels. */
export function barColor(pixels: number, size = HP_PIXELS): 'green' | 'yellow' | 'red' {
  if (pixels * 256 > (size * 256) / 2) return 'green';
  if (pixels * 256 > (size * 256) / 5) return 'yellow';
  return 'red';
}

/**
 * The colour of a move's PP on the move buttons (decomp battle_subscreen.c GetPPTextColor): empty, a
 * quarter or less (orange), a half or less (yellow), else normal. Maxima of 7 or less go by count: 1 PP is
 * orange and 2 PP yellow (2 or less: only 1 PP is orange).
 */
export function ppColor(pp: number, maxPp: number): 'normal' | 'yellow' | 'orange' | 'red' {
  if (pp === 0) return 'red';
  if (pp === maxPp) return 'normal';
  if (maxPp <= 2) return pp === 1 ? 'orange' : 'normal';
  if (maxPp <= 7) return pp === 1 ? 'orange' : pp === 2 ? 'yellow' : 'normal';
  if (pp <= Math.floor(maxPp / 4)) return 'orange';
  if (pp <= Math.floor(maxPp / 2)) return 'yellow';
  return 'normal';
}
