/**
 * The "Error reports" option: an app setting of this device (localStorage, like Zoom and Fast-forward), not a DS
 * option and not in the save. The player answers it once, in the setup before the first main menu; until then nothing is sent. Changeable in Options.
 */
export const REPORTS_KEY = 'lantern-nds:error-reports'; // pre-rename name, kept: players' stored data uses it

/** A stored setting, validated (device data): 'true' is on; anything else, or no answer yet, is off. */
export function parseReports(raw: string | null): boolean {
  return raw === 'true';
}

export function readReports(): boolean {
  try {
    return parseReports(localStorage.getItem(REPORTS_KEY));
  } catch {
    return false; // Blocked storage: never asked, never sent.
  }
}

/** Whether the player has answered (or changed the setting in Options). */
export function reportsAnswered(): boolean {
  try {
    return localStorage.getItem(REPORTS_KEY) !== null;
  } catch {
    return false;
  }
}

/** Stores the setting; returns the error message when storage refuses (private mode). */
export function storeReports(on: boolean): string | null {
  try {
    localStorage.setItem(REPORTS_KEY, String(on));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
