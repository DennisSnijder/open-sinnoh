import { describe, expect, it } from 'vitest';
import { objectiveTexts } from './objectives.ts';

describe('objectiveTexts', () => {
  it('has the same texts in every language, each one in words of its own', () => {
    const en = objectiveTexts('en');
    const de = objectiveTexts('de');
    expect(Object.keys(de)).toEqual(Object.keys(en));
    expect(en['OpenSinnoh_Objective_VisitBarry']).toBe('Visit Barry in the house next door.');
    for (const id of Object.keys(en)) expect(de[id], id).not.toBe(en[id]);
  });
});
