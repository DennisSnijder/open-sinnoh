/**
 * Reduce flashing on this device (`lantern-nds:reduce-flashing`, never in the save): until the player picks,
 * it follows the system's "reduce motion". The setting itself, and what it dampens, is packages/render/src/flash.ts;
 * it is presentation only.
 */
import { reduceFlashing, setReduceFlashing } from '@opensinnoh/render/flash';

export const FLASHING_KEY = 'lantern-nds:reduce-flashing'; // pre-rename name, kept: players' stored data uses it

/** The stored choice: true, false, or null when none (anything else is rejected with a warning: device data is validated). */
export function parseFlashing(raw: string | null, warn: (message: string) => void = console.warn): boolean | null {
  if (raw === null) return null;
  if (raw === 'true' || raw === 'false') return raw === 'true';
  warn(`flashing: the stored value ${JSON.stringify(raw)} is not true or false; the system's reduce-motion setting is used`);
  return null;
}

let chosen: boolean | null = null;

/** Reads the choice and applies it (and follows the system's reduce-motion while there is none). Call once at boot. */
export function startFlashing(): void {
  try {
    chosen = parseFlashing(localStorage.getItem(FLASHING_KEY));
  } catch (e) {
    console.warn(`flashing: storage is unavailable (${(e as Error).message}); the system's reduce-motion setting is used`);
  }
  const system = matchMedia('(prefers-reduced-motion: reduce)');
  const apply = () => setReduceFlashing(chosen ?? system.matches);
  system.addEventListener('change', apply);
  apply();
}

export const flashingOn = (): boolean => reduceFlashing();

/** The player's choice: applied at once and stored; returns the error message when storage refuses. */
export function chooseFlashing(on: boolean): string | null {
  chosen = on;
  setReduceFlashing(on);
  try {
    localStorage.setItem(FLASHING_KEY, String(on));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
