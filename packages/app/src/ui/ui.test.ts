import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { hpColor, hpPixels } from './art.ts';
import { DEFAULT_OPTIONS, parseOptions } from './options.ts';
import { poketchAppIndex, UiStrings } from './strings.ts';

const fixture = JSON.parse(readFileSync(new URL('../../../../packs/fixture/data.json', import.meta.url), 'utf8')) as {
  texts: { id: Id; text: string }[];
};
const texts = new Map(fixture.texts.map((t) => [t.id, t]));

describe('UI strings', () => {
  it('reads the Pokétch app names from the base pack namespace (fixture has original strings)', () => {
    expect(new UiStrings({ texts }, 'fixture').poketchApp('fixture:POKETCH_APPID_DIGITALWATCH' as Id)).toBe('CLOCK');
  });

  it('fails loudly when a pack lacks a name', () => {
    const partial = new Map([...texts].filter(([id]) => id !== 'fixture:pl_msg_00000457_00000'));
    expect(() => new UiStrings({ texts: partial }, 'fixture')).toThrow(/fixture:pl_msg_00000457_00000/);
  });

  it('maps Pokétch app ids by decomp name', () => {
    expect(poketchAppIndex('platinum:POKETCH_APPID_PARTYSTATUS' as Id)).toBe(4);
    expect(() => poketchAppIndex('platinum:POKETCH_APPID_NOPE' as Id)).toThrow();
  });
});

describe('HP bar (decomp HealthBar_PixelCount / HealthBar_Color over 48 px)', () => {
  it('rounds down, keeps 1 px above 0 and colours by pixels', () => {
    expect(hpPixels(1, 200)).toBe(1);
    expect(hpPixels(0, 20)).toBe(0);
    expect(hpPixels(20, 20)).toBe(48);
    expect(hpColor(20, 20)).toBe('max');
    expect(hpColor(11, 20)).toBe('green');
    expect(hpColor(10, 20)).toBe('yellow');
    expect(hpColor(4, 20)).toBe('red');
  });
});

describe('stored options', () => {
  it('parse strictly: missing is the default; unreadable or out of range says why', () => {
    expect(parseOptions(null)).toEqual({ options: DEFAULT_OPTIONS, problem: null });
    expect(parseOptions(JSON.stringify({ ...DEFAULT_OPTIONS, textSpeed: 2 })).options.textSpeed).toBe(2);
    expect(parseOptions(JSON.stringify({ ...DEFAULT_OPTIONS, followerStyle: 2 })).problem).toBe('followerStyle is 2');
    expect(parseOptions('{"textSpeed": 2,').problem).toMatch(/^not JSON/);
    expect(parseOptions('[]').problem).toBe('not an object');
    expect(parseOptions(JSON.stringify({ ...DEFAULT_OPTIONS, frame: 20 }))).toEqual({ options: DEFAULT_OPTIONS, problem: 'frame is 20' });
    expect(parseOptions(JSON.stringify({ ...DEFAULT_OPTIONS, extra: 1 })).problem).toBe('unknown keys extra');
    // Older device settings gain new defaults without losing existing choices.
    const old: Record<string, number> = { ...DEFAULT_OPTIONS, textSpeed: 2, followers: 1, sound: 1 };
    delete old.tradeEvolution;
    delete old.followerStyle;
    delete old.autoLowercase;
    expect(parseOptions(JSON.stringify(old))).toEqual({ options: { ...DEFAULT_OPTIONS, textSpeed: 2, followers: 1, sound: 1 }, problem: null });
  });
});
