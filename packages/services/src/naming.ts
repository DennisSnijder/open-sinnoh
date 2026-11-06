/**
 * Naming rules (decomp naming_screen.c): the keyboard pages UPPER, lower and Others (5 rows × 13 keys,
 * sCharCodes*, as the message font's Unicode) of the game, the length per kind and the "all spaces
 * keeps the old name" rule. Typed text is user input: only characters on the pages are taken.
 */
import { newGameRecord, type NamingRequest, type Registries } from '@opensinnoh/contracts';

const row = (s: string) => {
  const keys = [...s];
  if (keys.length !== 13) throw new Error(`naming: a keyboard row has ${keys.length} keys`);
  return keys;
};

type Pages = readonly (readonly string[][])[];
type KeyboardRegistries = Pick<Registries, 'newGame'>;

/** Decomp sCharCodesUpper/Lower/Others (CHAR_SPACE keys enter a space). */
const US_PAGES: Pages = [
  ['ABCDEFGHIJ ,.', 'KLMNOPQRST ’-', 'UVWXYZ     ♂♀', '             ', '0123456789   '].map(row),
  ['abcdefghij ,.', 'klmnopqrst ’-', 'uvwxyz     ♂♀', '             ', '0123456789   '].map(row),
  [',.:;!?   ♂♀  ', '“”‘’()       ', '…·~@#%+-*/=  ', '◉●■▲◆♠♥♦♣★♪  ', '☀☁☂☃☺♚♛☹☽↗↘  '].map(row),
];
/** The keyboard pages of the game (`NewGame.keyboard`: the build's, read from the ROM at import; else the US pages). */
export function keyboardPages(registries: KeyboardRegistries): Pages {
  return newGameRecord(registries as Registries).keyboard?.map((page) => page.map(row)) ?? US_PAGES;
}

/** Every character a name can hold in the game (its keys). */
export const nameChars = (registries: KeyboardRegistries): ReadonlySet<string> => new Set(keyboardPages(registries).flatMap((p) => p.flat()));

/**
 * Decomp NamingScreenArgs maxChars per kind: player and rival 7, nickname 10, box 8, Route 224's tablet 10
 * (ScrCmd_OpenShayminTabletNamingScreen); ours: a Mystery Gift code 8, the Pokédex search's name 10 (a nickname's).
 */
export const NAME_LENGTH: Record<NamingRequest['kind'], number> = { player: 7, rival: 7, pokemon: 10, box: 8, tablet: 10, 'gift-code': 8, 'dex-search': 10 };

/** Typed characters that are on the game's keyboard (straight quotes become the DS's curly ones). */
export function typedChars(text: string, registries: KeyboardRegistries): string[] {
  const chars = nameChars(registries);
  return [...text.replace(/'/g, '’').replace(/"/g, '”')].filter((c) => chars.has(c));
}

/** The name OK gives: null (unchanged) when empty or all spaces (decomp NamingScreen_IsRawStringAllSpaces), trailing spaces kept as typed. */
export function finishName(text: string): string | null {
  return text.trim() === '' ? null : text;
}
