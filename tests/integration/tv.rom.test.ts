/**
 * The TV on the ROM (docs/research/tv.md): the imported schedule, a broadcast's messages from the ROM's text banks, and
 * the `sys-tv-*` replays twice on seeds 1–3 with the save round trip.
 */
import { describe, expect, it } from 'vitest';
import type { NewGame } from '@opensinnoh/contracts';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('TV (OPENSINNOH_NDS_ROM)', () => {
  it('imports tv.narc: 96 quarter hours × 7 days of programmes 1–9 and the nine programmes', () => {
    const tv = (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!.tv!;
    expect(tv.schedule).toHaveLength(96);
    expect(tv.schedule.every((d) => d.length === 7 && d.every((p) => p >= 1 && p <= 9))).toBe(true);
    // Every hour opens with Sinnoh Now's news (programme 7) on every day.
    expect(tv.schedule.filter((_, slot) => slot % 4 === 0).every((d) => d.every((p) => p === 7))).toBe(true);
    expect(tv.programs.map((p) => p.type)).toEqual([1, 1, 2, 2, 2, 3, 4, 4, 5]);
    // The Contest Hall's interview segment airs on programme 1.
    expect(tv.programs[0]!.segments).toContain(7);
  });

  poffinReplay('sys-tv-contest');
  poffinReplay('sys-tv-contest-watch');
});
