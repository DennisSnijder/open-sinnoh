/**
 * The game language's rules (the base pack's NewGame `language`, decomp GAME_LANGUAGE; core ENGLISH, GERMAN):
 * the order of the DS's sorted name and word lists, and a name's first letter for the A–Z groups.
 */
import { ENGLISH, forLanguage, GERMAN } from '@opensinnoh/core';
import { dexOf, type Registries } from '@opensinnoh/contracts';

/** The game's language (core `Dex.language`). */
export const gameLanguage = (registries: Registries): number => dexOf(registries).language;

type Order = (a: string, b: string) => number;

const byCodeUnit: Order = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/**
 * The German build's order: letters only (spaces, hyphens and punctuation left out, Ä Ö Ü as A O U). It gives
 * exactly the German ROM's sorted lists: the Pokédex A–Z list (zukan_data member 13; a hyphenated name sorts as if
 * written without the hyphen) and the Easy Chat word lists in the arm9 (a word with a space or comma sorts as if
 * written without it).
 */
const german: Order = new Intl.Collator('de', { ignorePunctuation: true }).compare;
const english: Order = new Intl.Collator('en').compare;

/**
 * The Pokédex A–Z order (zukan_data members 13 and 18–26, checked against the ROM by the Pokédex ROM test):
 * English compares the names by code unit (decomp strcmp of the names); German as `german`.
 */
export const dexNameOrder = (language: number): Order => forLanguage(language, { [ENGLISH]: byCodeUnit, [GERMAN]: german });

/** The Easy Chat word lists' order: English by its collation, German as `german` (the ROM's lists). */
export const wordOrder = (language: number): Order => forLanguage(language, { [ENGLISH]: english, [GERMAN]: german });

/** The letter a name files under in the A–Z groups (ABC … YZ): its first letter without accents (Ä under A). */
export const nameInitial = (name: string): string => name.normalize('NFD').charAt(0).toUpperCase();
