/**
 * The game language's rules on our own words (no ROM text): the A–Z and word orders, the name groups' letters,
 * the keyboards and typed names, and the HM check that no longer reads item names.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGLISH, GERMAN, readPackFolder, type Id } from '@opensinnoh/core';
import type { Item, NewGame, Registries, Species } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { nameGroupSpecies } from './dex.ts';
import { isHmItem } from './items.ts';
import { dexNameOrder, gameLanguage, nameInitial, wordOrder } from './language.ts';
import { keyboardPages, typedChars } from './naming.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;

/** The fixture as a German game: its new game's language 5, `names` replacing species names by id. */
function german(names: Record<string, string> = {}): Registries {
  const species = new Map([...registries.species].map(([id, s]): [Id, Species] => [id, names[id] ? { ...s, name: names[id] } : s]));
  return { ...registries, species, newGame: new Map([[record.id, { ...record, language: GERMAN } as NewGame]]) };
}

describe('game language', () => {
  it('is the new game record’s, English when it names none', () => {
    expect(gameLanguage(registries)).toBe(ENGLISH);
    expect(gameLanguage(german())).toBe(GERMAN);
  });

  it('sorts A–Z by code unit in English and by letters alone in German', () => {
    const names = ['OB-AB', 'OBA', 'OBZ', 'ÖBB', 'OBB', 'PA'];
    expect([...names].sort(dexNameOrder(ENGLISH))).toEqual(['OB-AB', 'OBA', 'OBB', 'OBZ', 'PA', 'ÖBB']);
    // Hyphens left out (OBAB between OBA and OBB), Ö as O.
    expect([...names].sort(dexNameOrder(GERMAN))).toEqual(['OBA', 'OB-AB', 'OBB', 'ÖBB', 'OBZ', 'PA']);
    // The word lists leave out spaces and punctuation too: ÄH, JA (AHJA) after AHA, TOR! (TOR) before TO RE (TORE).
    expect(['ÄH, JA', 'AHA', 'AAH', 'TO RE', 'TOR!'].sort(wordOrder(GERMAN))).toEqual(['AAH', 'AHA', 'ÄH, JA', 'TOR!', 'TO RE']);
    expect(() => dexNameOrder(1)).toThrow(/language 1/);
  });

  it('files a name under its first letter without accents', () => {
    expect(['Ärger', 'öl', 'Zebra', 'Éclair'].map(nameInitial)).toEqual(['A', 'O', 'Z', 'E']);
  });

  it('gives a name group in the game language’s order, umlauts under their letter', () => {
    const reg = german({ 'fixture:SPECIES_MOSSLET': 'ÜBERMOOS', 'fixture:SPECIES_SKYLET': 'TA-UB', 'fixture:SPECIES_DRIPLING': 'TAUA' });
    expect(nameGroupSpecies(reg, 6).map((s) => s.name)).toEqual(expect.arrayContaining(['ÜBERMOOS', 'TA-UB', 'TAUA']));
    const stu = nameGroupSpecies(reg, 6).map((s) => s.name);
    expect(stu.indexOf('TAUA')).toBeLessThan(stu.indexOf('TA-UB'));
  });
});

describe('naming keyboards', () => {
  it('keeps the US pages as the US build has them', () => {
    expect(keyboardPages(ENGLISH).map((p) => p.map((r) => r.join('')))).toEqual([
      ['ABCDEFGHIJ ,.', 'KLMNOPQRST ’-', 'UVWXYZ     ♂♀', '             ', '0123456789   '],
      ['abcdefghij ,.', 'klmnopqrst ’-', 'uvwxyz     ♂♀', '             ', '0123456789   '],
      [',.:;!?   ♂♀  ', '“”‘’()       ', '…·~@#%+-*/=  ', '◉●■▲◆♠♥♦♣★♪  ', '☀☁☂☃☺♚♛☹☽↗↘  '],
    ]);
  });

  it('has the German build’s umlauts and „ on its pages', () => {
    const pages = keyboardPages(GERMAN).map((p) => p.map((r) => r.join('')));
    expect([pages[0]![3], pages[1]![3], pages[2]![1]]).toEqual(['ÄÖÜ          ', 'äöüß         ', '“„”‘’()      ']);
  });

  it('takes typed characters on the game language’s keys only', () => {
    expect(typedChars('Jürgen „Ö“ ß', ENGLISH).join('')).toBe('Jrgen “ ');
    expect(typedChars('Jürgen „Ö“ ß', GERMAN).join('')).toBe('Jürgen „Ö“ ß');
    expect(typedChars(`It's "x"`, GERMAN).join('')).toBe('It’s ”x”');
  });
});

describe('HM items', () => {
  it('are the ITEM_HM ids, or move-teaching items that cannot be tossed (not their names)', () => {
    const tm = registries.items.get('fixture:ITEM_LESSON_DIG' as Id)!;
    const items = new Map(registries.items);
    items.set('mod:ITEM_VM09' as Id, { ...tm, id: 'mod:ITEM_VM09' as Id, name: 'VM09', preventToss: true } as Item);
    items.set('mod:ITEM_TM_HM' as Id, { ...tm, id: 'mod:ITEM_TM_HM' as Id, name: 'HM99', preventToss: false } as Item);
    const reg = { ...registries, items };
    expect([isHmItem(reg, tm.id), isHmItem(reg, 'mod:ITEM_VM09' as Id), isHmItem(reg, 'mod:ITEM_TM_HM' as Id)]).toEqual([false, true, false]);
  });
});
