/**
 * The Underground on the ROM: its tables and art are imported and checked against the
 * decomp; getting the Explorer Kit, going down and reviving a fossil replay here, mining and spheres in
 * underground-mining.rom.test.ts.
 */
import { describe, expect, it } from 'vitest';
import type { NewGame, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { romSlice } from '../rom.ts';
import { undergroundReplay } from './underground-replays.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the Underground (OPENSINNOH_NDS_ROM)', () => {
  it("imports the Underground's tables and art", () => {
    const { pack } = romSlice();
    const u = (pack.registries.newGame as unknown as NewGame[])[0]!.underground!;
    expect(u.zone).toBe('platinum:MAP_HEADER_UNDERGROUND');
    // sMiningObjects: 85 entries, the Small Prism Sphere first (2×2), the rocks last.
    expect(u.miningObjects).toHaveLength(85);
    expect(u.miningObjects[0]).toMatchObject({ id: 1, width: 2, height: 2, shape: null });
    expect(u.miningObjects.at(-1)!.id).toBe(66);
    // sMiningItems from MINING_ID.treasures on: the Heart Scale is mining id 35.
    expect(u.treasureItems).toHaveLength(49);
    expect(u.treasureItems[35 - 11]).toBe('platinum:ITEM_HEART_SCALE');
    // sFossilItemToSpeciesMapping (scrcmd_fossil.c), in order.
    expect(u.fossils.map((f) => f.species.replace('platinum:SPECIES_', ''))).toEqual(['AERODACTYL', 'OMANYTE', 'KABUTO', 'LILEEP', 'ANORITH', 'SHIELDON', 'CRANIDOS']);
    expect(u.fossils[6]!.item).toBe('platinum:ITEM_SKULL_FOSSIL');
    expect(u.trapPrices).toHaveLength(34);
    expect(u.goods).toHaveLength(139);
    expect(u.vendors).toHaveLength(20);
    expect(u.vendors[8]).toEqual({ kind: 'traps', x: 232, z: 87 });
    expect(u.spawnTraps).toHaveLength(26);
    expect(u.flags.digging).toBe('platinum:FLAG_DIGGING_FOR_FOSSILS');
    expect(u.vars.spiritomb).toBe('platinum:VAR_SPIRITOMB_COUNTER');
    const ui2d = new Map((pack.registries.ui2d as unknown as Ui2dSheet[]).map((s) => [s.id, s]));
    for (const sheet of ['mining_interface', 'mining_crack', 'mining_buttons', 'mining_dirt', 'mining_objects', 'mining_anims', 'mining_crack_end', 'radar_map', 'radar_markers'])
      expect(ui2d.get(`platinum:ui2d/underground/${sheet}` as Id), sheet).toBeDefined();
    expect(ui2d.get('platinum:ui2d/underground/mining_dirt' as Id)!.names).toEqual(['0', '1', '2', '3', '4', '5', '6']);
  });

  undergroundReplay('sys-underground-kit');
  undergroundReplay('sys-underground-enter');
  undergroundReplay('sys-fossil-revival');
});
