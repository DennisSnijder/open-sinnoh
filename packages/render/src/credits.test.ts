import { expect, it } from 'vitest';
import { creditsPlacement, creditsTreeOrdinal } from './credits.ts';

it('wraps each coordinate by the row span, preserving FX32 integer truncation', () => {
  const row = { count: 3, speed: 7, start: [100, 200, 300] as [number, number, number], spacing: [10, 20, 30] as [number, number, number] };
  expect(creditsPlacement(row, 0, 0)).toEqual({ position: [100 / 4096, 200 / 4096, 300 / 4096], wraps: 0 });
  expect(creditsPlacement(row, 0, 1)).toEqual({ position: [74 / 4096, 148 / 4096, 222 / 4096], wraps: 1 });
  expect(creditsPlacement(row, 2, 5).wraps).toBe(1);
  expect(creditsPlacement(row, 2, 4).wraps).toBe(0);
  expect(creditsPlacement(row, 0, 16).wraps).toBe(3);
});

it('counts far-row wraps too, and counts simultaneous wraps only once for the snowy-tree sequence', () => {
  const rows = [
    { count: 2, speed: 8, start: [0, 0, 0] as [number, number, number], spacing: [16, 16, 16] as [number, number, number] },
    { count: 2, speed: 12, start: [0, 0, 0] as [number, number, number], spacing: [12, 12, 12] as [number, number, number] },
  ];
  expect(creditsTreeOrdinal(rows, 0, 0)).toBe(0);
  expect(creditsTreeOrdinal(rows, 0, 1)).toBe(16); // Both wrap on tick 1.
  expect(creditsTreeOrdinal(rows, 1, 1)).toBe(17); // Near tick 5.
  expect(creditsTreeOrdinal(rows, 0, 2)).toBe(19); // Far tick 7 also advanced the sequence before near tick 9.
  expect(creditsTreeOrdinal([rows[0]!, { ...rows[1]!, count: 0, speed: 0 }], 0, 2)).toBe(18);
});
