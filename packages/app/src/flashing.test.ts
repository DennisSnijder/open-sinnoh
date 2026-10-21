import { describe, expect, it } from 'vitest';
import { parseFlashing } from './flashing.ts';

describe('the stored reduce-flashing choice', () => {
  it('is true, false, or none', () => {
    const warnings: string[] = [];
    expect([parseFlashing(null, (m) => warnings.push(m)), parseFlashing('true', (m) => warnings.push(m)), parseFlashing('false', (m) => warnings.push(m))]).toEqual([null, true, false]);
    expect(warnings).toEqual([]);
  });

  it('anything else is rejected with a warning and follows the system', () => {
    const warnings: string[] = [];
    expect(parseFlashing('yes', (m) => warnings.push(m))).toBeNull();
    expect(warnings).toHaveLength(1);
  });
});
