/**
 * The words a spec expects in the language the app shows, looked up rather than written out, so a check holds on
 * every supported ROM: OpenSinnoh's own words (the app's string tables, packages/app/src/strings) and the parts of a
 * message that do not change with its slots.
 */
import type { Page } from '@playwright/test';
import { SUPPORTED_ROMS } from '@opensinnoh/nds';
import { strings, type Language, type Strings } from '../../packages/app/src/strings/index.ts';
import { romSha1 } from '../rom.ts';

/** The app's words once the imported game is stored: the game's language (strings/index.ts `chooseLanguage`). */
export const appStrings = (): Strings => strings(SUPPORTED_ROMS[romSha1()]!.language);

/** The app's words in the page's language (main.ts sets `<html lang>`), for helpers the fixture specs share. */
export const pageStrings = async (page: Page): Promise<Strings> => strings((await page.evaluate(() => document.documentElement.lang)) as Language);

/** A message's longest run of its own words: `fill` builds it with every slot a line break, then it is split at those and its own breaks. */
export function fixedPart(fill: (...slots: string[]) => string): string {
  return fill(...Array<string>(8).fill('\n'))
    .split('\n')
    .map((s) => s.trim())
    .reduce((a, b) => (b.length > a.length ? b : a));
}
