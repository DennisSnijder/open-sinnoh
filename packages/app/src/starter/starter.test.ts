import { describe, expect, it } from 'vitest';
import { starterLayout } from './layout.ts';
import { askMarkup, colourLines } from './text.ts';

const ROM_ASKS = [
  '{color 3}Tiny Leaf Pokémon TURTWIG{color 0}!\nWill you take this Pokémon?',
  '{color 1}Chimp Pokémon CHIMCHAR{color 0}!\nDo you choose this Pokémon?',
  '{color 2}Penguin Pokémon{color 0} {color 2}PIPLUP{color 0}!\nIs this Pokémon the one for you?',
];

describe('starter scene words', () => {
  it('splits markup into lines of colour runs', () => {
    expect(colourLines(ROM_ASKS[2]!)).toEqual([
      [
        { text: 'Penguin Pokémon', color: 2 },
        { text: ' ', color: 0 },
        { text: 'PIPLUP', color: 2 },
        { text: '!', color: 0 },
      ],
      [{ text: 'Is this Pokémon the one for you?', color: 0 }],
    ]);
    expect(colourLines('Look!\nThere is one!{clear}')).toEqual([[{ text: 'Look!', color: 0 }], [{ text: 'There is one!', color: 0 }]]);
  });

  it('asks with the entry that names the species, wherever a mod put it', () => {
    expect(askMarkup(ROM_ASKS, 0, 'TURTWIG')).toBe(ROM_ASKS[0]);
    // platinum-demo swaps Chimchar and Piplup: slot 1 asks about Piplup with Piplup's own entry.
    expect(askMarkup(ROM_ASKS, 1, 'PIPLUP')).toBe(ROM_ASKS[2]);
    expect(askMarkup(ROM_ASKS, 2, 'Chimchar')).toBe(ROM_ASKS[1]);
  });

  it('builds the ask from the name and the slot question when no entry names the species', () => {
    const asks = ['The moss one!\nWill you take it?', 'The ember one!\nWill you take it?', 'The drip one!\nAre you sure?'];
    expect(askMarkup(asks, 2, 'Mosslet')).toBe('Mosslet!\nAre you sure?');
    // A name inside another word is no match.
    expect(askMarkup(['Big MEWTWO!\nOK?'], 0, 'MEW')).toBe('MEW!\nOK?');
  });
});

describe('starter scene layout', () => {
  const inside = (r: { x: number; y: number; width: number; height: number }, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.width <= w && r.y + r.height <= h;

  it.each([
    [1280, 720, 1],
    [1920, 1080, 2],
    [844, 390, 3],
  ])('landscape %i×%i: preview beside the briefcase, everything on screen, crisp', (w, h, dpr) => {
    const l = starterLayout(w, h, dpr);
    expect(l.landscape).toBe(true);
    expect(Number.isInteger(l.u * dpr)).toBe(true);
    expect(l.preview.x).toBeGreaterThan(l.ds.x + l.ds.width);
    expect(l.preview.x + 60 * l.preview.k).toBeLessThanOrEqual(w);
    expect(inside(l.message, w, h)).toBe(true);
    expect(inside(l.yes, w, h)).toBe(true);
    // Room for the open lid's rim (54 DS px) above the DS view; 720 px tall keeps the 3× scale.
    expect(l.ds.y).toBeGreaterThanOrEqual(54 * l.u);
    if (w === 1280) expect(l.u).toBe(3);
  });

  it.each([
    [390, 696, 3],
    [390, 844, 3],
    [768, 1024, 2],
  ])('portrait %i×%i: preview above the briefcase, everything on screen, crisp', (w, h, dpr) => {
    const l = starterLayout(w, h, dpr);
    expect(l.landscape).toBe(false);
    expect(Number.isInteger(l.u * dpr) && Number.isInteger(l.preview.k * dpr)).toBe(true);
    expect(l.preview.y + 84 * l.preview.k).toBeLessThanOrEqual(l.ds.y - 54 * l.u);
    expect(l.preview.y - 52 * l.preview.k).toBeGreaterThanOrEqual(0);
    expect(inside(l.message, w, h)).toBe(true);
    expect(l.ds.x).toBeGreaterThanOrEqual(0);
  });
});
