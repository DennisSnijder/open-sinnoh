import { expect, it } from 'vitest';
import { parseTextMarkup, printTextMarkup } from './text.ts';

it('parses and prints opensinnoh text markup', () => {
  const src = 'Hi, {var 0}!\nWait{pause 15}{clear}{color 1}x{{y}}{raw 0200 3}';
  const tokens = parseTextMarkup(src);
  expect(tokens.map((t) => t.kind)).toEqual(['chars', 'var', 'chars', 'newline', 'chars', 'pause', 'clear', 'color', 'chars', 'raw']);
  expect(printTextMarkup(tokens)).toBe(src);
  expect(() => parseTextMarkup('{bogus 1}')).toThrow(/unknown tag/);
  expect(() => parseTextMarkup('oops}')).toThrow(/stray/);
});
