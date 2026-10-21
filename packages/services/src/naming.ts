/**
 * Naming rules (decomp naming_screen.c): the keyboard pages UPPER, lower and Others (5 rows × 13 keys,
 * sCharCodes*, as the message font's Unicode), the length per kind and the "all spaces keeps the old
 * name" rule. Typed text is user input: only characters on the pages are taken.
 */
import type { NamingRequest } from '@opensinnoh/contracts';

const row = (s: string) => {
  const keys = [...s];
  if (keys.length !== 13) throw new Error(`naming: a keyboard row has ${keys.length} keys`);
  return keys;
};

/** Decomp sCharCodesUpper/Lower/Others (CHAR_SPACE keys enter a space). */
export const KEYBOARD_PAGES: readonly (readonly string[][])[] = [
  ['ABCDEFGHIJ ,.', 'KLMNOPQRST ’-', 'UVWXYZ     ♂♀', '             ', '0123456789   '].map(row),
  ['abcdefghij ,.', 'klmnopqrst ’-', 'uvwxyz     ♂♀', '             ', '0123456789   '].map(row),
  [',.:;!?   ♂♀  ', '“”‘’()       ', '…·~@#%+-*/=  ', '◉●■▲◆♠♥♦♣★♪  ', '☀☁☂☃☺♚♛☹☽↗↘  '].map(row),
];

/** Every character a name can hold (the pages' keys). */
export const NAME_CHARS: ReadonlySet<string> = new Set(KEYBOARD_PAGES.flatMap((p) => p.flat()));

/**
 * Decomp NamingScreenArgs maxChars per kind: player and rival 7, nickname 10, box 8, Route 224's tablet 10
 * (ScrCmd_OpenShayminTabletNamingScreen); ours: a Mystery Gift code 8, the Pokédex search's name 10 (a nickname's).
 */
export const NAME_LENGTH: Record<NamingRequest['kind'], number> = { player: 7, rival: 7, pokemon: 10, box: 8, tablet: 10, 'gift-code': 8, 'dex-search': 10 };

/** Typed characters that are on the keyboard (straight quotes become the DS's curly ones). */
export function typedChars(text: string): string[] {
  return [...text.replace(/'/g, '’').replace(/"/g, '”')].filter((c) => NAME_CHARS.has(c));
}

/** The name OK gives: null (unchanged) when empty or all spaces (decomp NamingScreen_IsRawStringAllSpaces), trailing spaces kept as typed. */
export function finishName(text: string): string | null {
  return text.trim() === '' ? null : text;
}
