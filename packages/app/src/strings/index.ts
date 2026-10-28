/**
 * The app shell's language (OpenSinnoh's own words; the game's text is the ROM's). The imported game's language when
 * there is one (its SHA-1 in SUPPORTED_ROMS), else the browser's first choice, else English. Chosen once at boot
 * (main.ts; a new import reloads the page) and, in the import worker, from the page's request.
 *
 * `S` is the live table: read it where a string is shown, never into a module-level constant.
 */
import { SUPPORTED_ROMS, type RomLanguage } from '@opensinnoh/nds';
import { DE } from './de.ts';
import { EN, type Strings } from './en.ts';

export type { Strings };
export type Language = RomLanguage;

const TABLES: Record<Language, Strings> = { en: EN, de: DE };

export let S: Strings = EN;
let current: Language = 'en';

export function setLanguage(language: Language): void {
  current = language;
  S = TABLES[language];
}

export const language = (): Language => current;

/** The language for the stored game (`romSha1`, if any) and the browser's preferred languages. */
export function chooseLanguage(romSha1: string | undefined, browser: readonly string[]): Language {
  const rom = romSha1 === undefined ? undefined : SUPPORTED_ROMS[romSha1];
  if (rom) return rom.language;
  return browser[0]?.toLowerCase().startsWith('de') ? 'de' : 'en';
}

/** A table by language (tests). */
export const strings = (language: Language): Strings => TABLES[language];
