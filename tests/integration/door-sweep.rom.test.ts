/**
 * Every door warp on the real ROM (OPENSINNOH_NDS_ROM): stand south of the door, push north, and the door
 * prop opens (decomp DoorAnimation_FindDoorAndLoad: the 3×1 hitbox against the door models, over the
 * loaded chunks). Catches a door whose prop sits in a neighbouring chunk (the Sunyshore Mart door) or
 * outside the hitbox, and a door model without imported clips. The zone's frame scripts are kept from
 * firing (their vars set past every row), so nothing but the door runs. A story-locked door (its warp
 * moved away on load) is opened as a script would (`playDoor`).
 */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import type { GameState } from '@opensinnoh/contracts';
import { createBattle } from '@opensinnoh/battle';
import { cloneState, CountingStubLog, createGame } from '@opensinnoh/game';
import { createApp, createPoketch } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld, gridOffset, MapGrid } from '@opensinnoh/world';
import { EXCLUDED_ZONE } from '../../packages/cli/src/sweep.ts';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('door sweep (OPENSINNOH_NDS_ROM)', () => {
  it('pushing into every door warp plays its door prop’s open clip', () => {
    const { pack } = romSlice();
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, createBattle, createPoketch, seed: 1, log: new CountingStubLog(() => {}), now: () => '1970-01-01T00:00:00.000Z' });
    const reg = game.registries;
    const base: GameState = cloneState(game.state);
    const failures: string[] = [];
    const gated: Id[] = [];
    let doors = 0;
    for (const zone of reg.zones.values()) {
      if (EXCLUDED_ZONE.test(zone.id)) continue;
      const grid = new MapGrid(reg, reg.matrices.get(zone.matrix)!, gridOffset(reg, zone.id));
      for (const w of zone.events.warps) {
        if (grid.behaviour(w.x, w.z) !== 'DOOR') continue;
        doors++;
        const where = `${zone.id} (${w.x},${w.z})`;
        const state = cloneState(base);
        state.player = { zone: zone.id, x: w.x, z: w.z + 1, y: 0, facing: 'up' };
        for (const row of zone.mapScripts.onFrame) state.vars[row.var] = 0x7fff;
        try {
          game.load({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state });
          for (let i = 0; i < 30; i++) game.tick();
          game.press('up');
          let opened = false;
          for (let i = 0; i < 60 && !opened; i++) {
            game.tick();
            opened = !!game.world.view().doors?.some((d) => d.anim === 'open' && d.z === w.z && Math.abs(d.x - w.x) <= 1);
          }
          game.release('up');
          if (!opened) {
            // A story-locked door: the zone's load script moved its warp away (set_warp_event_pos), so the
            // push is refused. Its prop must still play when a script opens it.
            gated.push(zone.id);
            game.world.playDoor(w.x, w.z, 'open');
            opened = !!game.world.view().doors?.some((d) => d.anim === 'open' && d.z === w.z && Math.abs(d.x - w.x) <= 1);
            if (!opened) failures.push(`${where}: no door opened`);
          }
        } catch (e) {
          game.release('up');
          failures.push(`${where}: ${(e as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(doors).toBe(177);
    // The locked doors on a new game: the Harbor Inn (until the Darkrai event), the Windworks (the Works Key),
    // the Battleground (until Charon's arrest).
    expect(gated.map((z) => z.replace('platinum:MAP_HEADER_', ''))).toEqual(['CANALAVE_CITY', 'VALLEY_WINDWORKS_OUTSIDE', 'SURVIVAL_AREA']);
  }, 600_000);
});
