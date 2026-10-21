/**
 * The device side of the game (`GameDevice`): the OPTIONS values (decomp game_options.h order and
 * defaults) kept in this device's localStorage, and where the start menu's SAVE writes. Stored options
 * are user-device data, so they are validated when read: anything unreadable or out of range resets
 * every option to the default, and the reason is logged and shown.
 */
import type { SaveEnvelope, StubLog } from '@opensinnoh/contracts';
import { NOT_APPLIED, OPTIONS_KEY, parseOptions, storeOptions } from './options-store.ts';
import { SaveStorageFullError, type GameDevice } from '@opensinnoh/game';

export { DEFAULT_OPTIONS, NOT_APPLIED, OPENSINNOH_OPTIONS, OPTIONS_KEY, parseOptions, playerDefaults, storeOptions, type Options } from './options-store.ts';

/**
 * The app's device: options from localStorage (validated), saves to the app's save slot. A save is made
 * synchronously (the menu shows "saved" at once); a failed write is reported through `failed`.
 */
export function createDevice(deps: { log: () => StubLog; write(save: SaveEnvelope): Promise<void>; failed(message: string): void; touch: boolean }): GameDevice & {
  problem: string | null;
} {
  let stored: string | null = null;
  let problem: string | null = null;
  try {
    stored = localStorage.getItem(OPTIONS_KEY);
  } catch (e) {
    problem = `storage is unavailable (${(e as Error).message})`;
  }
  const parsed = parseOptions(stored, deps.touch);
  const options = parsed.options;
  problem ??= parsed.problem;
  const store = () => {
    const err = storeOptions(options);
    if (err) deps.log().stub('ui:options-storage', `options are kept for this visit only: ${err}`);
  };
  // Reset in storage too; the caller reports `problem` (logged once the game exists, and shown).
  if (parsed.problem) {
    const err = storeOptions(options);
    if (err) problem = `${problem}; the defaults are kept for this visit only (${err})`;
  }
  return {
    problem,
    options: () => options,
    setOption(key, value) {
      options[key] = value;
      const reason = NOT_APPLIED[key];
      if (reason) deps.log().stub(`ui:option-${key}`, `stored, not applied: ${reason}`);
      store();
    },
    persist(save) {
      deps.write(save).catch((e: Error) => deps.failed(e instanceof SaveStorageFullError ? e.message : `The save could not be written: ${e.message}`));
    },
  };
}
