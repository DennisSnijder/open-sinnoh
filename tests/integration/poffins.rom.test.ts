/**
 * Poffins on the ROM: Poffins, condition, the Fashion Case, Amity Square. The imported tables
 * are checked against the decomp; cooking a Poffin replays here, Feebas and Amity Square in their own files.
 */
import { describe, expect, it } from 'vitest';
import type { NewGame } from '@opensinnoh/contracts';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Poffins, condition, Amity Square (OPENSINNOH_NDS_ROM)', () => {
  it("imports the berry flavours, the trades' conditions and Amity Square's tables", () => {
    const { pack } = romSlice();
    const ng = (pack.registries.newGame as unknown as NewGame[])[0]!;
    // nuts_data: Cheri Berry 10 spicy, smoothness 25.
    expect(ng.berries!.berries[0]).toMatchObject({ item: 'platinum:ITEM_CHERI_BERRY', flavors: [10, 0, 0, 0, 0], smoothness: 25 });
    // NPCTradeMon: Chatot comes with 20 in each condition, the others with none.
    expect(ng.npcTrades!.map((t) => t.condition.cool)).toEqual([0, 20, 0, 0]);
    expect(ng.npcTrades![1]!.condition).toEqual({ cool: 20, beauty: 20, cute: 20, smart: 20, tough: 20 });
    const a = ng.amitySquare!;
    expect(a.stepVar).toBe('platinum:VAR_AMITY_SQUARE_STEP_COUNT');
    expect(a.gifts).toEqual([176, 175, 177, 178, 179, 180, 181, 182, 183, 11, 7, 10, 16, 27, 32, 33]);
    expect(a.itemGifts).toBe(9);
    expect(a.finds.map((f) => f.accessories[0])).toEqual([0, 2, 9, 12, 5, 12]);
    expect(a.finds[4]!.species).toEqual(['platinum:SPECIES_PIKACHU', 'platinum:SPECIES_CLEFAIRY', 'platinum:SPECIES_PACHIRISU', 'platinum:SPECIES_HAPPINY']);
    expect(ng.contestHallFlag).toBe('platinum:FLAG_CONTEST_HALL_VISITED');
  });

  poffinReplay('sys-poffin-cook');
});
