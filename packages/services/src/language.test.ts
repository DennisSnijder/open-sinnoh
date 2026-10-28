/**
 * The game language's rules on our own words (no ROM text): the A–Z and word orders, the name groups' letters,
 * the keyboards and typed names, and the HM check that no longer reads item names.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ENGLISH, readPackFolder, type Id } from '@opensinnoh/core';
import type { Item } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { isHmItem } from './items.ts';
import { dexNameOrder, gameLanguage, nameInitial } from './language.ts';
import { keyboardPages, typedChars } from './naming.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries } = loadGamePacks([pack]);

describe('game language', () => {
  it('is the new game record’s, English when it names none', () => {
    expect(gameLanguage(registries)).toBe(ENGLISH);
  });

  it('sorts A–Z by code unit in English', () => {
    const names = ['OB-AB', 'OBA', 'OBZ', 'ÖBB', 'OBB', 'PA'];
    expect([...names].sort(dexNameOrder(ENGLISH))).toEqual(['OB-AB', 'OBA', 'OBB', 'OBZ', 'PA', 'ÖBB']);
    expect(() => dexNameOrder(1)).toThrow(/language 1/);
  });

  it('files a name under its first letter without accents', () => {
    expect(['Ärger', 'öl', 'Zebra', 'Éclair'].map(nameInitial)).toEqual(['A', 'O', 'Z', 'E']);
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

  it('takes typed characters on the game language’s keys only', () => {
    expect(typedChars('Jürgen „Ö“ ß', ENGLISH).join('')).toBe('Jrgen “ ');
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
