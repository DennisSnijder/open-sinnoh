/**
 * The stored OPTIONS values (`lantern-nds:options`), read and written without the engine: the ROM page's first-run
 * setup writes the text speed before the game chunk loads (options.ts builds the game's device on these).
 */
import { DEFAULT_DEVICE_OPTIONS, DEVICE_OPTION_COUNTS, type DeviceOptions } from '@opensinnoh/contracts';

export type Options = DeviceOptions;
export const OPTIONS_KEY = 'lantern-nds:options'; // pre-rename name, kept: players' stored data uses it
/**
 * The OpenSinnoh additions (not the DS's): their contract default is the DS behaviour, which replays and tests run
 * (`DEFAULT_DEVICE_OPTIONS`); players get `DEFAULT_OPTIONS` (docs/decisions.md).
 */
export const OPENSINNOH_OPTIONS = ['autoLowercase', 'autoRun', 'repelPrompt', 'itemWheel', 'followerTalk', 'statView', 'summaryRename', 'dexNameSearch', 'character', 'spiritombVendors'] as const satisfies readonly (keyof DeviceOptions)[];
/** On for players: auto lowercase, the repeat-Repel prompt, the item wheel, follower talk and the Pokédex name search. Auto-run is on for touch screens only (`playerDefaults`). */
export const DEFAULT_OPTIONS: Readonly<DeviceOptions> = { ...DEFAULT_DEVICE_OPTIONS, autoLowercase: 0, repelPrompt: 0, itemWheel: 0, followerTalk: 0, dexNameSearch: 0 };
/** The player's defaults on this device: auto-run on where the screen is a touch screen (phones). */
export const playerDefaults = (touch: boolean): DeviceOptions => ({ ...DEFAULT_OPTIONS, autoRun: touch ? 0 : 1 });
/** Options of earlier versions start at the default when stored without them. */
const ADDED_LATER: readonly (keyof DeviceOptions)[] = ['tradeEvolution', 'followers', 'followerStyle', 'autoLowercase', 'autoRun', 'repelPrompt', 'itemWheel', 'followerTalk', 'statView', 'summaryRename', 'dexNameSearch', 'character', 'spiritombVendors'];

/** Options not applied to the game yet, and why (logged when changed). */
export const NOT_APPLIED: Readonly<Partial<Record<keyof Options, string>>> = {};

/** Parses stored options strictly: `problem` says why they were rejected (the caller resets them). */
export function parseOptions(raw: string | null, touch = false): { options: Options; problem: string | null } {
  const defaults = playerDefaults(touch);
  if (raw === null) return { options: { ...defaults }, problem: null };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    return { options: { ...defaults }, problem: `not JSON (${(e as Error).message})` };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { options: { ...defaults }, problem: 'not an object' };
  const v = value as Record<string, unknown>;
  const options = { ...defaults };
  for (const key of Object.keys(DEVICE_OPTION_COUNTS) as (keyof Options)[]) {
    // Stored before the option existed (trade evolutions 0.19, followers 0.27.11, their style 0.27.21, auto lowercase
    // 0.29.3, the quality-of-life options 0.31.0): it starts at the default, every stored setting kept.
    if (ADDED_LATER.includes(key) && !(key in v)) continue;
    const x = v[key];
    if (!Number.isInteger(x) || (x as number) < 0 || (x as number) >= DEVICE_OPTION_COUNTS[key]) return { options: { ...defaults }, problem: `${key} is ${JSON.stringify(x)}` };
    options[key] = x as number;
  }
  const extra = Object.keys(v).filter((k) => !(k in DEVICE_OPTION_COUNTS));
  if (extra.length) return { options: { ...defaults }, problem: `unknown keys ${extra.join(', ')}` };
  return { options, problem: null };
}

/** Writes the options; returns the error message when storage refuses (private mode, quota). */
export function storeOptions(o: Options): string | null {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(o));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Sets one stored option, keeping the others (unreadable or missing ones start from this device's defaults, as the game's device reads them). */
export function storeOption<K extends keyof Options>(key: K, value: Options[K]): string | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(OPTIONS_KEY);
  } catch (e) {
    return (e as Error).message;
  }
  const { options } = parseOptions(raw, matchMedia('(pointer: coarse)').matches);
  options[key] = value;
  return storeOptions(options);
}
