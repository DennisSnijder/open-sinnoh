/**
 * Marks the DS draws as pictures, not text, that our screens print in the game font, per game language (core
 * ENGLISH; the game's is contracts `dexOf(registries).language`).
 */
import { ENGLISH, forLanguage } from '@opensinnoh/core';

/**
 * The level mark before a level number (font_special_chars, pl_font.narc member 4, characters 11–12: the US
 * build's "Lv"): the summary, the battle's plain healthbox, the Battle Castle's lists.
 */
export const levelMark = (language: number): string => forLanguage(language, { [ENGLISH]: 'Lv' });
