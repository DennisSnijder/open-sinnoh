/**
 * Hidden items on the real ROM (OPENSINNOH_NDS_ROM): pressing A at one runs the shared hidden-item script with
 * its item, quantity and flag as script parameters 0–2 (decomp ScriptManager_SetHiddenItem); the item lands
 * in the bag and the flag is set. A found item is no event any more (BgEvent_IsHiddenItemAvailable).
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@opensinnoh/contracts';
import { bagCount } from '@opensinnoh/core';
import { createBattle } from '@opensinnoh/battle';
import { cloneState, CountingStubLog, createGame } from '@opensinnoh/game';
import { createApp, createPoketch } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('hidden items (OPENSINNOH_NDS_ROM)', () => {
  it('pressing A gives the item and sets its flag; a found one no longer answers', () => {
    const { pack } = romSlice();
    const game = createGame({ packs: [pack], createWorld, createScriptRunner, createApp, createBattle, createPoketch, seed: 1, log: new CountingStubLog(() => {}), now: () => '1970-01-01T00:00:00.000Z' });
    const reg = game.registries;
    const zone = [...reg.zones.values()].find((z) => z.events.bgs.some((b) => b.hiddenItem));
    const bg = zone!.events.bgs.find((b) => b.hiddenItem)!;
    expect(bg, 'a hidden item').toBeDefined();
    const h = bg.hiddenItem!;
    const state: GameState = cloneState(game.state);
    state.player = { zone: zone!.id, x: bg.x, z: bg.z + 1, y: bg.y, facing: 'up' };
    for (const row of zone!.mapScripts.onFrame) state.vars[row.var] = 0x7fff;
    game.load({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state });
    for (let i = 0; i < 30; i++) game.tick();
    const before = bagCount(game.state.bag, h.item);
    const pressA = () => {
      game.press('a');
      game.tick();
      game.release('a');
      for (let i = 0; i < 20; i++) game.tick();
    };
    pressA();
    for (let i = 0; i < 40 && !game.canSave(); i++) pressA();
    expect(game.canSave()).toBe(true);
    expect(bagCount(game.state.bag, h.item)).toBe(before + h.quantity);
    expect(game.state.flags[h.flag]).toBe(true);
    pressA();
    expect(game.canSave()).toBe(true);
    expect(bagCount(game.state.bag, h.item)).toBe(before + h.quantity);
  }, 300_000);
});
