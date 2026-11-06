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
  /** A pack's own keyboard (test data, not any build's). */
  const own = (keyboard: string[][]) => ({ newGame: new Map([['t:NEW' as Id, { ...record, keyboard }]]) }) as unknown as Registries;
  const pages = own([['ÖÄÜß„        ', ...Array<string>(4).fill(' '.repeat(13))]]);

  it('are the US pages without a keyboard in the pack', () => {
    expect(keyboardPages(registries).map((p) => p.map((r) => r.join('')))).toEqual([
      ['ABCDEFGHIJ ,.', 'KLMNOPQRST ’-', 'UVWXYZ     ♂♀', '             ', '0123456789   '],
      ['abcdefghij ,.', 'klmnopqrst ’-', 'uvwxyz     ♂♀', '             ', '0123456789   '],
      [',.:;!?   ♂♀  ', '“”‘’()       ', '…·~@#%+-*/=  ', '◉●■▲◆♠♥♦♣★♪  ', '☀☁☂☃☺♚♛☹☽↗↘  '],
    ]);
  });

  it('are the pack’s when it has them, and a row of another length fails', () => {
    expect(keyboardPages(pages)[0]![0]!.join('')).toBe('ÖÄÜß„        ');
    expect(() => keyboardPages(own([['short']]))).toThrow(/keyboard row/);
  });

  it('take typed characters on their keys only', () => {
    expect(typedChars('Jürgen „Ö“ ß', registries).join('')).toBe('Jrgen “ ');
    expect(typedChars('Jürgen „Ö“ ß', pages).join('')).toBe(' „Ö ß');
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
