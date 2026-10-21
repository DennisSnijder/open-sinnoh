import { describe, expect, it } from 'vitest';
import { battleTime, checkClock, clockSeconds, DAY_PERIODS, dayOfWeek, dayPeriod, isNight, localClock, secondsSinceMidnight, withClock } from './clock.ts';

describe('clock', () => {
  it('splits the day into the decomp periods (TimeOfDayForHour)', () => {
    const want = [...Array(4).fill('lateNight'), ...Array(6).fill('morning'), ...Array(7).fill('day'), ...Array(3).fill('twilight'), ...Array(4).fill('night')];
    expect(Array.from({ length: 24 }, (_, h) => dayPeriod(h))).toEqual(want);
    // The boundaries, hour by hour.
    expect([3, 4, 9, 10, 16, 17, 19, 20, 23, 0].map(dayPeriod)).toEqual(['lateNight', 'morning', 'morning', 'day', 'day', 'twilight', 'twilight', 'night', 'night', 'lateNight']);
    expect(() => dayPeriod(24)).toThrow(/hour/);
    expect(() => dayPeriod(-1)).toThrow(/hour/);
    // Script values are the decomp enum order.
    expect(DAY_PERIODS.indexOf('morning')).toBe(0);
    expect(DAY_PERIODS.indexOf('lateNight')).toBe(4);
  });

  it('maps periods to night and to the battle palettes', () => {
    expect(DAY_PERIODS.filter(isNight)).toEqual(['night', 'lateNight']);
    expect(DAY_PERIODS.map(battleTime)).toEqual(['day', 'day', 'twilight', 'night', 'night']);
  });

  it('replaces date and time of a frozen reading', () => {
    const c = { date: '2009-03-22', hour: 12, minute: 0, second: 7 };
    expect(withClock(c, undefined, '21:30')).toEqual({ date: '2009-03-22', hour: 21, minute: 30, second: 0 });
    expect(withClock(c, '2024-02-29')).toEqual({ date: '2024-02-29', hour: 12, minute: 0, second: 7 });
    expect(() => withClock(c, '2023-02-29')).toThrow(/date/);
    expect(() => withClock(c, undefined, '24:00')).toThrow(/time/);
    expect(() => checkClock({ ...c, minute: 60 })).toThrow(/invalid/);
  });

  it('counts seconds and weekdays', () => {
    const a = { date: '2009-03-22', hour: 23, minute: 59, second: 30 };
    const b = { date: '2009-03-23', hour: 0, minute: 0, second: 30 };
    expect(clockSeconds(b) - clockSeconds(a)).toBe(60);
    expect(secondsSinceMidnight(a)).toBe(86370);
    expect(dayOfWeek('2009-03-22')).toBe(0); // a Sunday
    expect(dayOfWeek('2026-10-14')).toBe(3);
    expect(dayOfWeek('1969-12-31')).toBe(3);
    expect(localClock(new Date(2026, 9, 14, 21, 5, 9))).toEqual({ date: '2026-10-14', hour: 21, minute: 5, second: 9 });
  });
});
