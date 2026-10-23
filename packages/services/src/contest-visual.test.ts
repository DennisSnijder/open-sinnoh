/** The visual round's rules (ov22_02257580, ov22_02257FB0, ov17_0223F334, ov22_02257DEC, ov22_02256FD8) on original data. */
import { describe, expect, it } from 'vitest';
import type { ContestAccessory, ContestTables } from '@opensinnoh/contracts';
import { zeroCondition, type Id } from '@opensinnoh/core';
import {
  accessoryHit, accessoryLimit, accessoryMargin, accessoryOpaque, accessoryPage, backdropSlot, dressUpPoints, innerRect, monHit, npcOutfit, onMon, opaqueRows,
  photoAccessories, samplePoints,
} from './contest-visual.ts';

/** A picture whose opaque pixels are the rect (x0, y0)–(x1, y1) exclusive. */
function picture(width: number, height: number, x0 = 0, y0 = 0, x1 = width, y1 = height): ContestAccessory {
  const bits = new Uint8Array(Math.ceil((width * height) / 8));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) bits[(y * width + x) >> 3]! |= 1 << ((y * width + x) & 7);
  return { width, height, mask: btoa(String.fromCharCode(...bits)) };
}
/** A Pokémon mask: 80 rows, the rows `top`…`bottom` opaque from `left` to `right` (exclusive). */
function monMask(top: number, bottom: number, left: number, right: number): string {
  const bytes: number[] = [];
  for (let y = 0; y < 80; y++) bytes.push(...(y >= top && y < bottom ? [1, left, right] : [0]));
  return btoa(String.fromCharCode(...bytes));
}
const tables = (accessories: ContestAccessory[], themes: number[][] = []): ContestTables => ({
  opponents: [
    {
      species: 'test:S' as Id, moves: [], nickname: 'test:N' as Id, trainerName: 'test:T' as Id, condition: zeroCondition(), rank: 0, types: [0], practice: false,
      single: false, pool: 0, gender: 'male', aiLevel: 0, gfx: 1, trainerClass: 0, fame: 1, dressUps: [1, 0],
    },
  ],
  judges: [],
  dressUps: [
    { accessories: [], monPriority: 0, backdrop: 0 },
    { accessories: [{ accessory: 2, x: 100, y: 90, priority: 1 }], monPriority: 0, backdrop: 3 },
  ],
  themes,
  playerGfx: { male: 1, female: 2 },
  playerSprite: { male: 'test:M' as Id, female: 'test:F' as Id },
  accessories,
  dance: { songs: [], choice: [], variants: [], aiJitter: [], aiRepeat: [], stage: [], grades: [], noteRows: [], tints: [], shades: [], buttons: [] },
});

describe('the dress-up limits and the Fashion Case pages', () => {
  it('allows 5, 10, 15, 20 accessories by rank', () => {
    expect([0, 1, 2, 3].map(accessoryLimit)).toEqual([5, 10, 15, 20]);
    expect(() => accessoryLimit(4)).toThrow(/limit/);
  });

  it('puts accessories on their 14 pages by id, backdrops nine to a page', () => {
    expect([0, 5, 6, 21, 22, 60, 61, 71, 72, 91, 92, 99].map(accessoryPage)).toEqual([0, 0, 1, 3, 4, 10, 11, 11, 12, 12, 13, 13]);
    expect(() => accessoryPage(100)).toThrow(/no page/);
    expect(backdropSlot(0)).toEqual({ page: 0, x: 16, y: 24 });
    expect(backdropSlot(4)).toEqual({ page: 0, x: 48, y: 64 });
    expect(backdropSlot(9)).toEqual({ page: 1, x: 16, y: 24 });
  });
});

describe('the dress-up points (ov17_0223F334) and the NPC outfits (sub_020951B0)', () => {
  const t = tables([], [[1, 2, 3], [0, 5, 9]]);
  it('adds each accessory\'s points for the theme; the backdrop counts nothing', () => {
    const outfit = { accessories: [0, 1, 2, 2].map((accessory) => ({ accessory, x: 0, y: 0, priority: 0 })), monPriority: 0, backdrop: 7 };
    expect(dressUpPoints(t, 0, outfit)).toBe(1 + 2 + 3 + 3);
    expect(dressUpPoints(t, 1, outfit)).toBe(0 + 5 + 9 + 9);
    expect(dressUpPoints(t, 0, { accessories: [], monPriority: 0, backdrop: 0 })).toBe(0);
    expect(() => dressUpPoints(t, 2, outfit)).toThrow(/no theme/);
  });

  it('gives an NPC its outfit for the theme', () => {
    expect(npcOutfit(t, 0, 0).backdrop).toBe(3);
    expect(npcOutfit(t, 0, 1).accessories).toEqual([]);
  });
});

describe('the pictures\' hit tests', () => {
  it('insets 32 and 64 px pictures by 10 and 20 px for the overlap tests', () => {
    expect([16, 32, 64].map(accessoryMargin)).toEqual([0, 10, 20]);
    expect(innerRect(picture(32, 64), 100, 50)).toEqual({ left: 110, top: 70, right: 122, bottom: 94 });
    expect(samplePoints({ left: 0, top: 0, right: 10, bottom: 7 })).toContainEqual([6, 4]);
    expect(samplePoints({ left: 0, top: 0, right: 10, bottom: 7 })).toHaveLength(16);
  });

  it('picks an accessory where an opaque pixel lies within 4 px of the touch', () => {
    const ring = picture(16, 16, 6, 6, 8, 8);
    expect(accessoryOpaque(ring, 6, 6)).toBe(true);
    expect(accessoryOpaque(ring, 0, 0)).toBe(false);
    expect(accessoryHit(ring, 10, 10, 13, 13)).toBe(true);
    expect(accessoryHit(ring, 10, 10, 11, 11)).toBe(false);
    expect(accessoryHit(ring, 10, 10, 30, 13)).toBe(false);
  });

  it('reads a Pokémon mask and hits its pixels inside its 80 × 80 square', () => {
    const rows = opaqueRows(monMask(20, 60, 30, 50));
    expect(rows[19]).toEqual([]);
    expect(rows[20]).toEqual([[30, 50]]);
    expect(monHit(rows, 100, 100, 100 - 40 + 30, 100 - 40 + 20)).toBe(true);
    expect(monHit(rows, 100, 100, 100 - 40 + 29, 100 - 40 + 20)).toBe(false);
    expect(() => opaqueRows(btoa('\u0000'))).toThrow(/shorter/);
  });

  it('counts an accessory on the Pokémon when one of its 16 points hits it', () => {
    const rows = opaqueRows(monMask(20, 60, 30, 50));
    const hat = picture(16, 16);
    // The Pokémon's opaque square is (90, 80)–(110, 120) for a centre (100, 100); the points include the far edges.
    expect(onMon(hat, 73, 64, rows, 100, 100)).toBe(false);
    expect(onMon(hat, 74, 63, rows, 100, 100)).toBe(false);
    expect(onMon(hat, 74, 64, rows, 100, 100)).toBe(true);
    expect(onMon(hat, 80, 70, rows, 100, 100)).toBe(true);
  });
});

describe('the photo keeps the accessories on the Pokémon and those touching them (ov22_0225768C)', () => {
  const t = tables([picture(16, 16), picture(32, 32)]);
  it('joins accessories through overlapping rectangles, in the stage\'s order', () => {
    const staged = [
      { accessory: 0, x: 100, y: 100, onMon: true },
      { accessory: 0, x: 200, y: 200, onMon: false },
      { accessory: 0, x: 114, y: 100, onMon: false },
      { accessory: 1, x: 120, y: 90, onMon: false },
      { accessory: 0, x: 160, y: 100, onMon: false },
    ];
    // 2 overlaps 0; 3's rectangle holds a point of 2; 4 touches nothing.
    expect(photoAccessories(t, staged)).toEqual([staged[0], staged[2], staged[3]]);
    expect(photoAccessories(t, staged.map((s) => ({ ...s, onMon: false })))).toEqual([]);
  });
});
