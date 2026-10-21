/**
 * The intro skip (OpenSinnoh, for repeat play; not the DS's): once Rowan's intro has been finished on this device,
 * NEW GAME asks whether to skip it (the setup's screen), and a skip goes from the black screen straight to the boy and
 * the girl and the names (packages/menus rowan-intro `skip`). Device data: whether the intro was finished
 * (`lantern-nds:intro-seen`) and the Options toggle (`lantern-nds:intro-skip`, on by default).
 */
const SEEN = 'lantern-nds:intro-seen'; // pre-rename name, kept: players' stored data uses it
const ON = 'lantern-nds:intro-skip'; // pre-rename name, kept: players' stored data uses it

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): string | null => {
  try {
    localStorage.setItem(key, value);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

/** The skip question is asked: the intro was finished here before, and the option is on. */
export const offerIntroSkip = (): boolean => read(SEEN) === '1' && introSkipOn();
export const introSkipOn = (): boolean => read(ON) !== 'off';
/** Returns the storage error, or null. */
export const setIntroSkip = (on: boolean): string | null => write(ON, on ? 'on' : 'off');
/** Rowan's intro (full or skipped) was finished: later NEW GAMEs offer the skip. */
export const markIntroSeen = (): string | null => write(SEEN, '1');
