import { afterEach, describe, expect, it } from 'vitest';
import { SUPPORTED_ROMS } from '@opensinnoh/nds';
import { keyLabel, reservedKey } from '../controls.ts';
import { ASK } from '../title/setup-questions.ts';
import { labelCase } from '../ui/options-screen.ts';
import { SECTIONS, SETTINGS } from '../ui/settings.ts';
import { chooseLanguage, S, setLanguage, strings } from './index.ts';

const shaOf = (language: string) => Object.entries(SUPPORTED_ROMS).find(([, r]) => r.language === language)![0];

// Test files share workers (vitest.config.ts `isolate: false`): every test leaves the app in English.
afterEach(() => setLanguage('en'));

describe('the language', () => {
  it("is the stored game's, whatever the browser prefers", () => {
    expect(chooseLanguage(shaOf('de'), ['en-US'])).toBe('de');
    expect(chooseLanguage(shaOf('en'), ['de-DE', 'de'])).toBe('en');
  });

  it("is the browser's first choice without a known game, else English", () => {
    expect(chooseLanguage(undefined, ['de-DE', 'en'])).toBe('de');
    expect(chooseLanguage(undefined, ['DE'])).toBe('de');
    expect(chooseLanguage('0'.repeat(40), ['de-AT'])).toBe('de');
    expect(chooseLanguage(undefined, ['en-GB', 'de-DE'])).toBe('en');
    expect(chooseLanguage(undefined, ['fr-FR'])).toBe('en');
    expect(chooseLanguage(undefined, [])).toBe('en');
  });
});

/** Every leaf's path and kind (a function, or a string), and every list's length, so the tables can be compared. */
function shape(v: unknown, path = ''): string[] {
  if (typeof v === 'function') return [`${path}: function`];
  if (typeof v === 'string') return [`${path}: ${v === '' ? 'empty' : 'string'}`];
  if (Array.isArray(v)) return [`${path}: list of ${v.length}`, ...v.flatMap((x, i) => shape(x, `${path}[${i}]`))];
  if (v && typeof v === 'object') return Object.keys(v).sort().flatMap((k) => shape((v as Record<string, unknown>)[k], `${path}.${k}`));
  throw new Error(`strings: ${path} is ${typeof v}`);
}

describe('the German table', () => {
  it('has every English key, list entry and function, and no empty string', () => {
    expect(shape(strings('de'))).toEqual(shape(strings('en')));
    expect(shape(strings('de')).filter((s) => s.endsWith('empty'))).toEqual([]);
  });

  it('is what the screens read once chosen: nothing keeps the English from module load', () => {
    setLanguage('de');
    expect(S.rom.startPlaying).toBe('Losspielen');
    expect(SECTIONS.map((s) => s.label)).toEqual(['Spiel', 'Gerät', 'Steuerung', 'Daten', 'Datenschutz']);
    expect(ASK.textSpeed.title).toBe('Text-Tempo');
    expect(SETTINGS.find((s) => s.id === 'bind/up')!.label({} as never)).toBe('Steuerkreuz oben');
    expect(keyLabel('Space')).toBe('Leertaste');
    expect(reservedKey('KeyP')).toBe('P öffnet den Pokétch');
    setLanguage('en');
    expect(SECTIONS[0]!.label).toBe('GAME');
    expect(reservedKey('Backquote')).toBe('the backtick toggles fast-forward');
  });
});

describe('Options labels in capitals', () => {
  it('are sentence case in English, ROM and HGSS kept', () => {
    expect(labelCase('BATTLE STYLE')).toBe('Battle style');
    expect(labelCase('HGSS ADD-ON')).toBe('HGSS add-on');
    expect(labelCase('Mixed Case')).toBe('Mixed Case');
  });

  it('capitalise German nouns, after a hyphen too, but not the small words', () => {
    setLanguage('de');
    expect(labelCase('KAMPFSTIL')).toBe('Kampfstil');
    expect(labelCase('TEXT-TEMPO')).toBe('Text-Tempo');
    expect(labelCase('STIL DES KAMPFES')).toBe('Stil des Kampfes');
    expect(labelCase('ROM-IMPORT')).toBe('ROM-Import');
    expect(labelCase('POKéDEX')).toBe('POKéDEX');
  });
});
