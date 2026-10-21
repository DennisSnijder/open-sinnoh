import type { Id } from '@opensinnoh/core';
import type { Registries, Weather, Zone } from '@opensinnoh/contracts';

/**
 * The weather a map change sets (decomp FieldMapChange_UpdateGameData → FieldSystem_GetWeather,
 * src/field_overworld_weather.c and src/field_map_change.c): the zone header's weather; a yearly weather
 * (Routes 212 South, 213, 216, Acuity Lakefront, Snowpoint City) is looked up for the day of the year;
 * FOG under Defog and DARK_FLASH under Flash become CLEAR. The date is the saved clock's (GameTime), or
 * January 2 while the clock-change penalty runs (FieldSystem_HasPenalty; the world's `date`).
 */

/** Weather values (decomp OVERWORLD_WEATHER_*), matched by `Weather.sourceIndex`. */
export const WEATHER_CLEAR = 0;
export const WEATHER_FOG = 14;
export const WEATHER_DARK_FLASH = 16;
/** System flags (decomp SystemFlag_CheckFlashActive / CheckDefogActive), matched by `Flag.sourceIndex`. */
export const FLAG_FLASH_ACTIVE = 2426;
export const FLAG_DEFOG_ACTIVE = 2427;

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Index into a 366-entry yearly table (Jan 1 = 0, Feb 29 = 59, Dec 31 = 365): a non-leap year skips Feb 29
 * (DayNumberForDate − 1, plus one after February when the year is not a leap year).
 */
export function yearlyDayIndex(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`world: invalid date ${JSON.stringify(date)}`);
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // DayNumberForDate counts Feb 29 in a leap year; FieldSystem_GetWeather skips it in other years.
  const before = DAYS_BEFORE_MONTH[month - 1]! + (month > 2 && isLeap(year) ? 1 : 0);
  return before + day - 1 + (month > 2 && !isLeap(year) ? 1 : 0);
}

export function weatherBySource(reg: Registries, value: number): Weather {
  for (const w of reg.weathers.values()) if (w.sourceIndex === value) return w;
  throw new Error(`world: no weather record with sourceIndex ${value}`);
}

/** The weather a map change into `zone` sets. `flag(sourceIndex)` reads a flag by its source index. */
export function mapChangeWeather(reg: Registries, zone: Zone, date: () => string, flag: (sourceIndex: number) => boolean): Id {
  let weather = reg.weathers.get(zone.weather);
  if (!weather) throw new Error(`world: ${zone.id} has unknown weather ${zone.weather}`);
  if (weather.yearly || weather.pending?.includes('yearly')) weather = yearlyWeather(reg, weather, date);
  if ((weather.sourceIndex === WEATHER_FOG && flag(FLAG_DEFOG_ACTIVE)) || (weather.sourceIndex === WEATHER_DARK_FLASH && flag(FLAG_FLASH_ACTIVE))) {
    return weatherBySource(reg, WEATHER_CLEAR).id;
  }
  return weather.id;
}

/** A yearly weather's value for the date. */
export function yearlyWeather(reg: Registries, weather: Weather, date: () => string): Weather {
  if (!weather.yearly) throw new Error(`world: weather ${weather.id} is yearly but its table is not decoded`);
  if (weather.yearly.length !== 366) throw new Error(`world: weather ${weather.id} has ${weather.yearly.length} yearly entries, expected 366`);
  const id = weather.yearly[yearlyDayIndex(date())]!;
  const day = reg.weathers.get(id);
  if (!day) throw new Error(`world: weather ${weather.id} names unknown weather ${id}`);
  return day;
}
