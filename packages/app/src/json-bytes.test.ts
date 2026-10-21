import { describe, expect, it } from 'vitest';
import { jsonBytes } from './json-bytes.ts';

const whole = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

describe('jsonBytes', () => {
  it('writes the bytes of JSON.stringify', () => {
    const values: unknown[] = [
      { a: 1, b: 'x', c: [1, 'two', null, { d: true }], e: {} },
      { skip: undefined, f: () => 1, keep: 0, arr: [undefined, () => 1, 3], nested: { deep: { deeper: [{ x: undefined }] } } },
      { text: 'é ♂ … 🐟 "quoted" \\ \n  ', [`k"ey`]: [new Date(0), { toJSON: () => 'custom' }] },
      [[], {}, [[]], 'top-level array'],
      { empty: [], s: '', n: -0, big: 1e21, nan: NaN },
      'just a string',
      42,
      null,
    ];
    for (const v of values) for (const depth of [0, 1, 2, 3]) expect(jsonBytes(v, depth)).toEqual(whole(v));
  });

  it('is the same across its 1 MB runs (multi-byte text at the seams)', () => {
    const v = { texts: Array.from({ length: 40_000 }, (_, i) => ({ id: `platinum:text/${i}`, text: `Pokémon ♀ 🐟 ${'…'.repeat(i % 50)}` })) };
    const bytes = jsonBytes(v);
    expect(bytes.length).toBeGreaterThan(3 << 20);
    expect(Buffer.compare(bytes, whole(v))).toBe(0);
  });
});
