import { expect, it } from 'vitest';
import { Prng } from './prng.ts';

it('is deterministic and resumes from saved state', () => {
  const a = new Prng(42);
  const first = [a.next(), a.next()];
  const saved = a.save();
  const tail = [a.next(), a.below(10)];
  expect(new Prng(42).next()).toBe(first[0]);
  const b = Prng.from(JSON.parse(JSON.stringify(saved)));
  expect([b.next(), b.below(10)]).toEqual(tail);
  expect(() => a.below(0)).toThrow();
});
