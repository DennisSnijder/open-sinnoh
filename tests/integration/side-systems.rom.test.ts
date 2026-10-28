/**
 * The side systems on the ROM: berry patches, the shard tutors, the relearner and the deleter, the in-game trades.
 * The imported tables are checked against what the decomp says, and each `sys-` replay runs twice on seeds 1–3 with
 * the driver's save round trip.
 */
import { describe, expect, it } from 'vitest';
import type { NewGame } from '@opensinnoh/contracts';
import { createGame, CountingStubLog, gameDriver, runReplay } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

export const SIDE_REPLAYS = ['sys-trade-abra', 'sys-trade-chatot', 'sys-tutor-shards', 'sys-relearner', 'sys-move-deleter', 'sys-berries', 'sys-berries-bag'];

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('side systems (OPENSINNOH_NDS_ROM)', () => {
  it('imports the berry, tutor and trade tables', () => {
    const { pack } = romSlice();
    const ng = (pack.registries.newGame as unknown as NewGame[])[0]!;
    const b = ng.berries!;
    expect(b.berries).toHaveLength(64);
    expect(b.berries[0]).toMatchObject({ item: 'platinum:ITEM_CHERI_BERRY', stageHours: 3, drain: 15, baseYield: 1, sprites: { growing: 'platinum:OBJ_EVENT_GRAPHICS_CHERI_GROWING' } });
    // sBerryInitTable: one entry per placed patch (Floaroma's two first: Oran, Cheri).
    expect(b.patches).toHaveLength(118);
    expect(b.patches.slice(0, 2)).toEqual([{ item: 'platinum:ITEM_ORAN_BERRY', yield: 1 }, { item: 'platinum:ITEM_CHERI_BERRY', yield: 1 }]);
    expect(b.mulches).toEqual(['platinum:ITEM_GROWTH_MULCH', 'platinum:ITEM_DAMP_MULCH', 'platinum:ITEM_STABLE_MULCH', 'platinum:ITEM_GOOEY_MULCH']);
    const t = ng.moveTutors!;
    expect(t.moves).toHaveLength(38);
    expect(t.moves[0]).toEqual({ move: 'platinum:MOVE_DIVE', cost: [2, 4, 2, 0], location: 0 });
    expect(t.moves.filter((m) => m.location === 0)).toHaveLength(13);
    // TEXT_BANK_NPC_TRADE_NAMES: nickname n, then the OT names from MAX_NPC_TRADES.
    const names = new Map((pack.registries.texts as { id: string; text: string }[]).map((x) => [x.id, x.text]));
    const name = (n: number) => names.get(`platinum:text/370/${n}`);
    expect(ng.npcTrades!.map((x) => [x.species, x.requested, x.nickname, x.otName])).toEqual([
      ['platinum:SPECIES_ABRA', 'platinum:SPECIES_MACHOP', name(0), name(4)],
      ['platinum:SPECIES_CHATOT', 'platinum:SPECIES_BUIZEL', name(1), name(5)],
      ['platinum:SPECIES_HAUNTER', 'platinum:SPECIES_MEDICHAM', name(2), name(6)],
      ['platinum:SPECIES_MAGIKARP', 'platinum:SPECIES_FINNEON', name(3), name(7)],
    ]);
    for (const t of ng.npcTrades!) expect(t.nickname).toMatch(/\S/);
    // Haunter holds an Everstone: the trade does not evolve it (the DS checks no evolution after an NPC trade either).
    expect(ng.npcTrades![2]!.heldItem).toBe('platinum:ITEM_EVERSTONE');
    const species = new Map((pack.registries.species as { id: string; tutorMoves?: string[]; forms?: { form: number; tutorMoves?: string[] }[] }[]).map((s) => [s.id, s]));
    expect(species.get('platinum:SPECIES_BULBASAUR')!.tutorMoves).toEqual(['platinum:MOVE_MUD_SLAP', 'platinum:MOVE_FURY_CUTTER', 'platinum:MOVE_SNORE', 'platinum:MOVE_SYNTHESIS', 'platinum:MOVE_SEED_BOMB', 'platinum:MOVE_KNOCK_OFF']);
    // Forms have their own masks (MOVESET_FORM_ROTOM_HEAT …).
    expect(species.get('platinum:SPECIES_ROTOM')!.forms!.find((f) => f.form === 1)!.tutorMoves).toContain('platinum:MOVE_TRICK');
  });

  for (const file of SIDE_REPLAYS) for (const seed of [1, 2, 3]) {
    it(`${file}: twice on seed ${seed}, save round trip`, async () => {
      const { pack } = romSlice();
      const game = createGame({ packs: [pack], createWorld, createScriptRunner, createBattle, createApp, seed, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
      const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, resolve: resolveReplay, registries: game.registries, seed, repeat: true });
      expect(result.error).toBeUndefined();
      expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
    }, 180000);
  }
});
