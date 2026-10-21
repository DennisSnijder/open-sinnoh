/**
 * The device clock the game reads in normal play (the DS RTC): the browser's local date and time. QA can
 * start it elsewhere with `?clock=yyyy-mm-ddThh:mm` or `?time=hh:mm` (today's date): the clock then runs
 * on from there. Replays pass no clock (the game's frozen one).
 */
import { isDate, isTime, localClock, type ClockTime } from '@opensinnoh/core';

/** The local clock, shifted so that it reads `start` now (a `?clock=`/`?time=` override); null = the real one. */
export function deviceClock(start: { date: string; time: string } | null): () => ClockTime {
  if (!start) return () => localClock(new Date());
  const [y, mo, d] = start.date.split('-').map(Number) as [number, number, number];
  const [h, mi] = start.time.split(':').map(Number) as [number, number];
  const offset = new Date(y, mo - 1, d, h, mi).getTime() - Date.now();
  return () => localClock(new Date(Date.now() + offset));
}

/** The override in the URL (`?clock=2026-10-14T21:30`, `?time=21:30`), or null; throws on a malformed one. */
export function clockOverride(params: URLSearchParams): { date: string; time: string } | null {
  const clock = params.get('clock');
  const time = params.get('time');
  if (clock !== null) {
    const [date, t] = clock.split('T');
    if (!date || !t || !isDate(date) || !isTime(t)) throw new Error(`?clock=${clock}: expected yyyy-mm-ddThh:mm`);
    return { date, time: t };
  }
  if (time !== null) {
    if (!isTime(time)) throw new Error(`?time=${time}: expected hh:mm`);
    return { date: localClock(new Date()).date, time };
  }
  return null;
}
