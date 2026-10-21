/**
 * The game clock (the DS RTC): a local date and time, and the decomp's time-of-day periods.
 * Game logic reads the clock only through the game's clock source (device time in play, frozen in
 * replays and tests), never `Date`.
 */

/** A clock reading: local calendar date and time of day (the DS RTCDate + RTCTime, without the weekday). */
export interface ClockTime {
  /** `yyyy-mm-dd` */
  date: string;
  hour: number;
  minute: number;
  second: number;
}

/** The frozen clock of headless games, tests and replays unless they set one (`date`/`time` lines): midday, so the day period. */
export const DEFAULT_CLOCK: ClockTime = Object.freeze({ date: '2009-03-22', hour: 12, minute: 0, second: 0 });

/**
 * Decomp `enum TimeOfDay`, in its order (TIMEOFDAY_MORNING = 0 … TIMEOFDAY_LATE_NIGHT = 4): the index is
 * the value scripts read (`get_time_of_day`).
 */
export const DAY_PERIODS = ['morning', 'day', 'twilight', 'night', 'lateNight'] as const;
export type DayPeriod = (typeof DAY_PERIODS)[number];

/**
 * Decomp TimeOfDayForHour (rtc.c): late night 0–3, morning 4–9, day 10–16, twilight 17–19, night 20–23.
 */
export function dayPeriod(hour: number): DayPeriod {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error(`clock: invalid hour ${hour}`);
  if (hour < 4) return 'lateNight';
  if (hour < 10) return 'morning';
  if (hour < 17) return 'day';
  if (hour < 20) return 'twilight';
  return 'night';
}

/** Decomp IsNight: night and late night. */
export function isNight(period: DayPeriod): boolean {
  return period === 'night' || period === 'lateNight';
}

/**
 * The battle background and platform palette of a period (decomp BattleSystem_GetBackgroundTimeOffset):
 * morning and day → day, twilight → twilight, night and late night → night.
 */
export function battleTime(period: DayPeriod): 'day' | 'twilight' | 'night' {
  return period === 'twilight' ? 'twilight' : isNight(period) ? 'night' : 'day';
}

/** A real calendar date written `yyyy-mm-dd`. */
export function isDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

/** A time of day written `hh:mm` (00:00–23:59). */
export function isTime(s: string): boolean {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  return !!m && Number(m[1]) < 24 && Number(m[2]) < 60;
}

/** Checks a reading (boundaries: saves, options, the bridge); returns it. */
export function checkClock(c: ClockTime): ClockTime {
  const ok = isDate(c.date) && [c.hour, c.minute, c.second].every(Number.isInteger) && c.hour >= 0 && c.hour < 24 && c.minute >= 0 && c.minute < 60 && c.second >= 0 && c.second < 60;
  if (!ok) throw new Error(`clock: invalid reading ${JSON.stringify(c)}`);
  return c;
}

/** The reading with its date and/or time (`hh:mm`, seconds 0) replaced. */
export function withClock(c: ClockTime, date?: string, time?: string): ClockTime {
  if (date !== undefined && !isDate(date)) throw new Error(`clock: invalid date ${JSON.stringify(date)} (expected yyyy-mm-dd)`);
  if (time !== undefined && !isTime(time)) throw new Error(`clock: invalid time ${JSON.stringify(time)} (expected hh:mm)`);
  const [hour, minute] = time ? time.split(':').map(Number) : [c.hour, c.minute];
  return { date: date ?? c.date, hour: hour!, minute: minute!, second: time ? 0 : c.second };
}

/** Seconds since midnight (decomp GetSecondsSinceMidnight; the area lights switch on it). */
export function secondsSinceMidnight(c: ClockTime): number {
  return c.hour * 3600 + c.minute * 60 + c.second;
}

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000;

/** Days since 1970-01-01 (decomp RTC_ConvertDateToDay counts from 2000; only differences are used). */
export function clockDay(c: ClockTime): number {
  return dayNumber(c.date);
}

/** Seconds since 1970-01-01 00:00 of the local calendar (decomp RTC_ConvertDateTimeToSecond, likewise). */
export function clockSeconds(c: ClockTime): number {
  return clockDay(c) * 86400 + secondsSinceMidnight(c);
}

/** Day of the week, 0 = Sunday (decomp RTCDate.week, RTC_WEEK_SUNDAY = 0). */
export function dayOfWeek(date: string): number {
  return (((dayNumber(date) + 4) % 7) + 7) % 7;
}

/** The device's local date and time (the app's clock source in normal play). */
export function localClock(d: Date): ClockTime {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds() };
}

/** `yyyy-mm-dd hh:mm:ss` */
export function formatClock(c: ClockTime): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${c.date} ${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`;
}
