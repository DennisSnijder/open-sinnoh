/**
 * The saved clock fields (decomp GameTime, system_data.c and unk_020559DC.c). The field's time of day reads
 * `GameState.gameTime.now`; this keeps it in step with the game clock.
 */
import { clockDay, clockSeconds, type ClockTime } from '@opensinnoh/core';
import type { GameTime, StubLog } from '@opensinnoh/contracts';

/** Decomp GameTime_StartPenalty: 24 hours. */
export const PENALTY_MINUTES = 24 * 60;

/** A new game's clock fields (decomp GameTime_Clear). */
export function newGameTime(now: ClockTime): GameTime {
  return { now: { ...now }, penaltyMinutes: 0 };
}

/**
 * Decomp sub_020559DC, run on field ticks with no script running and on a load. A later day runs the daily
 * events (FieldSystem_HandleDailyEvents); a clock behind `now` moves `now` back with nothing else; whole
 * minutes forward count the penalty down (GameTime_DecrementPenalty, capped at 24 h first) and run the
 * timed events (sub_02055B64: berries, honey trees, the TV slot, Shaymin), then move `now` on.
 * The callback runs the implemented daily events; the remaining daily and timed systems stay counted stubs.
 */
export function updateGameTime(t: GameTime, clock: ClockTime, log: StubLog, onDaily?: (days: number) => void, onMinutes?: (minutes: number) => void): void {
  const was = clockSeconds(t.now);
  const is = clockSeconds(clock);
  if (is < was) {
    t.now = { ...clock };
    return;
  }
  const minutes = Math.floor((is - was) / 60);
  // The DS keeps the day apart from the date (GameTime.day); here a new day moves `now` too, so the daily
  // events run once per day even when less than a minute passed.
  const newDay = clockDay(clock) > clockDay(t.now);
  if (newDay && onDaily) onDaily(clockDay(clock) - clockDay(t.now));
  if (newDay) log.stub('clock:daily-events', 'remaining daily events (villa, TV, …) are not implemented');
  if (minutes > 0) {
    t.penaltyMinutes = Math.max(0, Math.min(t.penaltyMinutes, PENALTY_MINUTES) - minutes);
    // Decomp sub_02055B64: the berry patches, the honey trees and Shaymin's Sky Forme (onMinutes) are real; the rest is not.
    onMinutes?.(minutes);
    log.stub('clock:timed-events', 'minutes passed: the TV time slot is not implemented (the Underground gift penalty is link-only)');
  }
  if (minutes > 0 || newDay) t.now = { ...clock };
}

/**
 * Decomp GameStartLoadSave_Main starts the penalty when the save's RTC offset differs from the DS's (the
 * player changed the clock). A browser has no RTC offset; here a save whose clock is ahead of the device's
 * (the clock was set back) starts it: 24 hours, and `now` becomes the clock (GameTime_StartPenalty). Returns whether it did.
 */
export function clockChanged(t: GameTime, clock: ClockTime): boolean {
  if (clockSeconds(clock) >= clockSeconds(t.now)) return false;
  t.penaltyMinutes = PENALTY_MINUTES;
  t.now = { ...clock };
  return true;
}
