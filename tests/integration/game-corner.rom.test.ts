/**
 * The Veilstone Game Corner on the ROM (docs/research/game-corner.md): the imported slot tables and prizes (the note's
 * §3 values), the slot art and the daily machine shuffle. The machines, the clerk and the Prize Exchange are played by
 * the `sys-game-corner-*` replays (game-corner-*.rom.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { SLOT, type NewGame } from '@opensinnoh/contracts';
import { slotMode } from '@opensinnoh/services';
import { romSlice } from '../rom.ts';

const tablesOf = () => (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!.slots!;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Game Corner (OPENSINNOH_NDS_ROM)', () => {
  it('imports the slot tables and the prizes (the research note §3)', () => {
    const t = tablesOf();
    expect(t.modes).toEqual([0, 5, 1, 1, 4, 4, 2, 2, 2, 3, 3, 3]);
    expect(t.reels[0]).toEqual([5, 3, 1, 0, 2, 4, 5, 3, 1, 2, 4, 5, 3, 1, 2, 4, 5, 2, 0, 2, 4]);
    expect(t.reels[1]).toEqual([3, 0, 1, 5, 4, 2, 3, 0, 5, 4, 2, 3, 0, 5, 4, 2, 3, 1, 5, 4, 2]);
    expect(t.reels[2]).toEqual([4, 2, 1, 0, 2, 5, 4, 2, 1, 3, 5, 4, 2, 1, 3, 5, 4, 2, 0, 3, 5]);
    expect(t.payouts).toEqual([100, 100, 0, 2, 10, 15]);
    expect(t.bonusPayouts).toEqual([100, 100, 15, 2, 10, 15]);
    expect(t.winChance).toEqual([25, 25, 30, 30, 35, 35]);
    expect(t.hintChance).toEqual([80, 80, 80, 80, 80, 70]);
    expect(t.standbySmall).toEqual(t.winChance);
    expect(t.redMoon).toEqual([3, 3, 5, 5, 7, 7]);
    expect(t.blueMoon).toEqual([1, 1, 3, 3, 5, 5]);
    expect(t.continueDrop).toEqual([[25, 20], [20, 15], [15, 15], [15, 15], [10, 15], [5, 10]]);
    expect(t.winFlags[0]).toEqual([1, 4, 2, 13, 1, 39, 1]);
    expect(t.winFlags[2]).toEqual([2, 3, 4, 11, 2, 38, 2]);
    expect(t.winFlags[5]).toEqual([4, 1, 6, 9, 3, 37, 3]);
    expect(t.standbyFlags.every((r) => JSON.stringify(r) === '[5,15,30,50]')).toBe(true);
    expect(t.bonusTypes[0]!.map((r) => [r.chance, r.type, r.class])).toEqual([[5, 3, 0], [10, 1, 1], [10, 5, 2], [10, 2, 2], [15, 4, 1], [50, 0, 0]]);
    expect(t.continueStart).toEqual([50, 70, 90, 50, 70, 90]);
    expect(t.clefairyKinds[0]!.map((c) => c.map((k) => [k.chance, k.kind]))).toEqual([[[5, 2], [20, 0], [75, 1]], [[20, 2], [60, 0], [20, 1]], [[75, 2], [20, 0], [5, 1]]]);
    expect(t.endTells[0]!.map((r) => [r.min, r.a, r.b])).toEqual([[75, 10, 10], [65, 10, 30], [55, 10, 40], [45, 20, 50], [35, 30, 50], [25, 50, 40], [15, 60, 30], [5, 80, 10], [0, 90, 5]]);
    expect(t.bonusOrders.map((o) => o.buttons.join(''))).toEqual(['yba', 'yab', 'bya', 'bay', 'ayb', 'aby']);
    expect(t.bonusOrders[0]!.clefairy).toEqual([6, 5, 7]);
    expect(t.stopButtons).toEqual([{ x: 7, y: 17 }, { x: 15, y: 17 }, { x: 22, y: 17 }]);
    expect(t.linePalettes).toEqual([2, 3, 12, 4, 11]);
    expect(t.lightShow).toHaveLength(82);
    expect(t.lineFlash[3]!.map((p) => p.y)).toEqual([48, 80, 112]);
    expect(t.messageWindow).toEqual({ x: 2, y: 19, width: 26, height: 4 });
    expect(t.prizes.map((p) => p.price)).toEqual([1000, 1000, 1000, 1000, 2000, 2000, 4000, 4000, 6000, 6000, 6000, 8000, 8000, 10000, 10000, 10000, 10000, 15000, 20000]);
    expect(t.prizes[0]!.item).toBe('platinum:ITEM_SILK_SCARF');
    expect(t.prizes.at(-1)!.item).toBe('platinum:ITEM_TM68');
    expect(t.streakVar).toBe('platinum:VAR_CONSECUTIVE_BONUS_ROUND_WINS');
  });

  it('imports the slot art: the machine, the field, the symbols, the balls and Clefairy', () => {
    const ui2d = romSlice().pack.registries.ui2d as { id: string; cells: unknown[]; animations?: unknown[] }[];
    const sheet = (p: string) => ui2d.find((s) => s.id === `platinum:ui2d/slots/${p}`);
    for (const p of ['machine', 'lamps', 'stops', 'shade', 'field', 'backdrop', 'symbols', 'digits', 'seven_red', 'seven_galactic', 'sparkle', 'pikachu', 'bonus_label', 'get_label', 'counter_digits', 'round_digits']) expect(sheet(p), p).toBeDefined();
    for (let i = 0; i < 5; i++) expect(sheet(`ball_${i}`)?.animations?.length).toBeGreaterThanOrEqual(5);
    for (let i = 0; i < 3; i++) expect(sheet(`clefairy_${i}`)?.animations?.length).toBeGreaterThanOrEqual(6);
    expect(sheet('symbols')!.animations).toHaveLength(6);
    expect(sheet('digits')!.animations).toHaveLength(10);
    expect(sheet('lamps')!.cells).toHaveLength(5);
    expect(sheet('stops')!.cells).toHaveLength(6);
  });

  it('the daily shuffle gives each mode its share of machines', () => {
    const t = tablesOf();
    for (const random of [0, 1, 0x12345678, 0xffffffff]) {
      const modes = Array.from({ length: SLOT.machines }, (_, m) => slotMode(t, random, m)).sort();
      expect(modes).toEqual([...t.modes].sort());
    }
  });
});
