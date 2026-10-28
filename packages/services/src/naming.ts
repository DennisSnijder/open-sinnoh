/**
 * Naming rules (decomp naming_screen.c): the keyboard pages UPPER, lower and Others (5 rows × 13 keys,
 * sCharCodes*, as the message font's Unicode) of the game's language, the length per kind and the "all spaces
 * keeps the old name" rule. Typed text is user input: only characters on the pages are taken.
 */
import { ENGLISH, forLanguage, GERMAN } from '@opensinnoh/core';
import type { NamingRequest } from '@opensinnoh/contracts';

const row = (s: string) => {
  const keys = [...s];
  if (keys.length !== 13) throw new Error(`naming: a keyboard row has ${keys.length} keys`);
  return keys;
};

type Pages = readonly (readonly string[][])[];

/** Decomp sCharCodesUpper/Lower/Others of the US build (CHAR_SPACE keys enter a space). */
const US_PAGES: Pages = [
  ['ABCDEFGHIJ ,.', 'KLMNOPQRST ’-', 'UVWXYZ     ♂♀', '             ', '0123456789   '].map(row),
  ['abcdefghij ,.', 'klmnopqrst ’-', 'uvwxyz     ♂♀', '             ', '0123456789   '].map(row),
  [',.:;!?   ♂♀  ', '“”‘’()       ', '…·~@#%+-*/=  ', '◉●■▲◆♠♥♦♣★♪  ', '☀☁☂☃☺♚♛☹☽↗↘  '].map(row),
];
/**
 * The German build's tables (its arm9 next to the US ones' place): the US pages with Ä Ö Ü and ä ö ü ß on the
 * fourth row and „ after “ on Others.
 */
const GERMAN_PAGES: Pages = [
  ['ABCDEFGHIJ ,.', 'KLMNOPQRST ’-', 'UVWXYZ     ♂♀', 'ÄÖÜ          ', '0123456789   '].map(row),
  ['abcdefghij ,.', 'klmnopqrst ’-', 'uvwxyz     ♂♀', 'äöüß         ', '0123456789   '].map(row),
  [',.:;!?   ♂♀  ', '“„”‘’()      ', '…·~@#%+-*/=  ', '◉●■▲◆♠♥♦♣★♪  ', '☀☁☂☃☺♚♛☹☽↗↘  '].map(row),
];
const PAGES: Readonly<Record<number, Pages>> = { [ENGLISH]: US_PAGES, [GERMAN]: GERMAN_PAGES };
const CHARS: Readonly<Record<number, ReadonlySet<string>>> = Object.fromEntries(Object.entries(PAGES).map(([l, p]) => [l, new Set(p.flatMap((r) => r.flat()))]));

/** The keyboard pages of the game's language (services `gameLanguage`). */
export const keyboardPages = (language: number): Pages => forLanguage(language, PAGES);

/** Every character a name can hold in the game's language (its pages' keys). */
export const nameChars = (language: number): ReadonlySet<string> => forLanguage(language, CHARS);

/**
 * Decomp NamingScreenArgs maxChars per kind: player and rival 7, nickname 10, box 8, Route 224's tablet 10
 * (ScrCmd_OpenShayminTabletNamingScreen); ours: a Mystery Gift code 8, the Pokédex search's name 10 (a nickname's).
 */
export const NAME_LENGTH: Record<NamingRequest['kind'], number> = { player: 7, rival: 7, pokemon: 10, box: 8, tablet: 10, 'gift-code': 8, 'dex-search': 10 };

/** Typed characters that are on the game language's keyboard (straight quotes become the DS's curly ones). */
export function typedChars(text: string, language: number): string[] {
  const chars = nameChars(language);
  return [...text.replace(/'/g, '’').replace(/"/g, '”')].filter((c) => chars.has(c));
}

/** The name OK gives: null (unchanged) when empty or all spaces (decomp NamingScreen_IsRawStringAllSpaces), trailing spaces kept as typed. */
export function finishName(text: string): string | null {
  return text.trim() === '' ? null : text;
}
