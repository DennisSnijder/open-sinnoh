import { describe, expect, it } from 'vitest';
import { SUPPORTED_ROMS } from '@opensinnoh/nds';
import { reservedKey } from '../controls.ts';
import { labelCase } from '../ui/options-screen.ts';
import { SECTIONS } from '../ui/settings.ts';
import { chooseLanguage } from './index.ts';

const shaOf = (language: string) => Object.entries(SUPPORTED_ROMS).find(([, r]) => r.language === language)![0];

describe('the language', () => {
  it("is the stored game's, whatever the browser prefers", () => {
    expect(chooseLanguage(shaOf('en'), ['de-DE', 'de'])).toBe('en');
  });

  it("is the browser's first choice without a known game when there is a table for it, else English", () => {
    expect(chooseLanguage(undefined, ['en-GB', 'de-DE'])).toBe('en');
    expect(chooseLanguage(undefined, ['fr-FR'])).toBe('en');
    expect(chooseLanguage('0'.repeat(40), ['fr-FR'])).toBe('en');
    expect(chooseLanguage(undefined, [])).toBe('en');
  });
});

describe('the English table', () => {
  it('is what the screens read', () => {
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
});
