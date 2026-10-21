import { describe, expect, it } from 'vitest';
import type { InputFrame } from '@opensinnoh/contracts';
import { DexScroll } from './pokedex-scroll.ts';

const idle: InputFrame = { held: [], pressed: [], touch: null };
const down: InputFrame = { held: ['down'], pressed: [], touch: null };

describe('Pokédex 30 Hz scroll clock', () => {
  it('takes 11 ticks for the first row, finishing after release without repeating', () => {
    const s = new DexScroll(() => 100);
    s.tick(down);
    expect(s.cursor).toBe(1);
    expect(s.position).toBeCloseTo(60 / 640);
    for (let i = 0; i < 9; i++) s.tick(idle);
    expect(s.position).toBeCloseTo(600 / 640);
    s.tick(idle);
    expect(s.position).toBe(1);
    s.tick(idle);
    expect(s.cursor).toBe(1);
  });

  it('accelerates after four held rows, then resets on release', () => {
    const s = new DexScroll(() => 100);
    for (let i = 0; i < 44; i++) s.tick(down);
    expect(s.position).toBe(4);
    s.tick(down);
    expect(s.position).toBeCloseTo(4 + 96 / 640);
    for (let i = 0; i < 8; i++) s.tick(idle);
    s.tick(down);
    expect(s.position).toBeCloseTo(5 + 60 / 640);
  });

  it('right travels five rows one per tick; held right does not repeat; boundaries clamp', () => {
    const s = new DexScroll(() => 20);
    s.tick({ ...idle, pressed: ['right'], held: ['right'] });
    expect(s.cursor).toBe(1);
    for (let i = 0; i < 10; i++) s.tick({ ...idle, held: ['right'] });
    expect(s.position).toBe(5);
    s.reset(18);
    s.tick({ ...idle, pressed: ['right'] });
    for (let i = 0; i < 5; i++) s.tick(idle);
    expect(s.position).toBe(19);
    s.reset(0);
    s.tick({ ...idle, held: ['up'] });
    expect(s.position).toBe(0);
  });

  it('touch coasts after release, settles on a row and can reverse', () => {
    const s = new DexScroll(() => 100);
    s.reset(30);
    s.touch(160);
    for (let i = 0; i < 5; i++) s.tick(idle);
    expect(s.cursor).toBeGreaterThan(30);
    s.touch(null);
    for (let i = 0; i < 150; i++) s.tick(idle);
    expect(s.moving).toBe(false);
    expect(s.position).toBe(s.cursor);
    const before = s.cursor;
    s.touch(-160);
    for (let i = 0; i < 10; i++) s.tick(idle);
    expect(s.cursor).toBeLessThan(before);
    s.reset(99);
    s.touch(640);
    s.tick(idle);
    expect(s.position).toBe(99);
    expect(s.moving).toBe(false);
  });
});
