/**
 * Seals and Ball Capsules on the ROM (docs/research/seals.md): the imported seal tables against the decomp's
 * (mart_items.h, the send-out delays), the editor placing a seal on the ROM's art and texts and its Test playing the
 * seal's particles, an NPC trainer's capsule in battle, and the seal replays.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, type Id, type Pokemon } from '@opensinnoh/core';
import { DEFAULT_DEVICE_OPTIONS, SEALS, setupPokemon, type AppHost, type CapsuleEditorView, type NewGame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks, newGameState } from '@opensinnoh/game';
import { createBattle } from '@opensinnoh/battle';
import { createApp, MenuText } from '@opensinnoh/menus';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

const tables = () => (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!.seals!;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Seals (OPENSINNOH_NDS_ROM)', () => {
  it('imports the seal table, the Sunyshore seal marts, the trainer capsules and the send-out delays', () => {
    const t = tables();
    expect(t.types).toHaveLength(SEALS.count + 1);
    // mart_items.h SunyshoreMarketDailyStocks, Monday … Sunday.
    expect(t.marts).toEqual([
      [1, 8, 29, 43, 15, 22, 36],
      [2, 9, 30, 37, 44, 16, 23],
      [3, 10, 31, 38, 45, 17, 24],
      [4, 25, 32, 39, 46, 11, 18],
      [26, 33, 40, 47, 5, 12, 19],
      [27, 34, 41, 48, 6, 13, 20],
      [7, 49, 28, 42, 14, 21, 35],
    ]);
    // Every non-alphabet seal 1–49 is sold on exactly one day, and only those have a price.
    expect(t.marts.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 49 }, (_, i) => i + 1));
    for (let id = 1; id <= SEALS.count; id++) {
      expect(t.types[id]!.price > 0, `seal ${id}`).toBe(id <= 49);
      expect(t.types[id]!.alphabet, `seal ${id}`).toBe(id >= 50 && id <= 77);
    }
    // The send-out delays (ov12_02237EA0) and the 128 trainer capsules of at most 8 seals.
    expect(t.delays).toEqual([0, 8, 14, 20, 20, 16, 16]);
    // The default bursts (Unk_ov12_0223AD70): {ball_particle member, emitters} per ball; rows 17–19 unused.
    expect(t.ballOpen.map((r) => [r.particle, r.emitters])).toEqual([
      [1, 5], [2, 4], [3, 3], [4, 3], [5, 3], [6, 4], [7, 3], [8, 4], [9, 3], [10, 5], [11, 4], [12, 3], [13, 3], [14, 3], [15, 4], [16, 4], [17, 3], [1, 5], [1, 5], [36, 2],
    ]);
    expect(t.trainerCapsules).toHaveLength(128);
    expect(t.trainerCapsules.every((c) => c.length <= SEALS.perCapsule)).toBe(true);
    expect(t.trainerCapsules.some((c) => c.length > 0)).toBe(true);
  });

  it("an NPC trainer's Pokémon with a cbSeal carries capsule id 1 and a copy of its trainer capsule in battle", () => {
    const { registries, loaded } = loadGamePacks([romSlice().pack]);
    const trainer = [...registries.trainers.values()].find((t) => !t.double && t.party.some((m) => m.ballSeal > 0));
    expect(trainer).toBeDefined();
    const s = newGameState([...registries.newGame.values()][0]!, registries as Registries, loaded.order, 1);
    const mon = setupPokemon(s, registries, 0, 'platinum:SPECIES_PIPLUP' as Id, 50);
    const b = createBattle(
      { kind: 'trainer', trainers: [trainer!.id], wild: [], background: null, terrain: null, time: 'day' },
      { registries, party: [mon], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed: 1, textSpeed: 1, log: new CountingStubLog(() => {}) },
    ) as unknown as { foe: { party: Pokemon[] } };
    trainer!.party.forEach((m, i) => {
      expect(b.foe.party[i]!.capsule).toEqual(m.ballSeal ? { id: 1, seals: tables().trainerCapsules[m.ballSeal - 1] } : undefined);
    });
  });

  it('the editor places a seal on a capsule with the ROM texts and saves it on CONFIRM', () => {
    const { registries, loaded } = loadGamePacks([romSlice().pack]);
    const record = [...registries.newGame.values()][0]!;
    const s = newGameState(record, registries as Registries, loaded.order, 1);
    s.party.push(setupPokemon(s, registries, 0, 'platinum:SPECIES_PIPLUP' as Id, 10));
    s.sealCase.counts[49] = 1;
    const host: AppHost = { options: () => ({ ...DEFAULT_DEVICE_OPTIONS }), setOption: () => {}, save: () => {}, fieldMoveCheck: () => 'location', useFieldMove: () => {}, fieldItemCheck: () => null, useFieldItem: () => {}, clock: () => DEFAULT_CLOCK };
    const app = createApp({ app: 'capsule-editor' }, { registries, state: s, log: { stub: () => {} }, host });
    const idle = { held: [], pressed: [], touch: null };
    const press = (b: 'a') => (app.step({ held: [b], pressed: [b], touch: null }), app.step(idle));
    const tap = (t: string) => app.step({ ...idle, tap: t });
    const v = () => app.view() as CapsuleEditorView;
    const t = new MenuText(registries as Registries);
    expect(v().message!.text).toBe(t.t('capsuleChoose'));
    press('a');
    expect(v().menu!.entries.map((e) => e.label)).toEqual([t.t('capsuleEdit'), t.t('capsuleShift'), t.t('capsuleQuit')]);
    press('a');
    expect(v()).toMatchObject({ screen: 'edit', list: [{ cell: tables().types[50]!.sheet - 184, count: '  1' }] });
    tap('seal:16,24');
    // Its name (TEXT_BANK_SEAL_NAMES, pl_msg 12).
    expect(v().status).toBe(t.message(`pl_msg_00000012_${String(tables().types[50]!.name).padStart(5, '0')}`));
    tap('seal:200,60');
    tap('seal-up');
    // Test: Piplup comes out of its ball with the A Seal's `ball_particle.narc` system (the battle's send-out effect) and
    // goes back in; the editor goes on with nothing saved.
    tap('seal:32,171');
    tap('seal-up');
    const frames: CapsuleEditorView[] = [];
    while (frames.length < 1000 && (v().screen !== 'edit' || v().message)) {
      app.step(idle);
      frames.push(v());
    }
    const sheets = new Set(frames.flatMap((f) => f.test?.particles.map((q) => q.textures) ?? []));
    expect(sheets).toContain(`platinum:ui2d/battle/ball_particles/${tables().types[50]!.particle}`);
    expect(frames.some((f) => f.test?.sprite?.scale === 1)).toBe(true);
    expect(frames.length).toBeGreaterThan(100);
    expect(frames.length).toBeLessThan(400);
    expect(s.sealCase.capsules[0]).toEqual([]);
    expect(v()).toMatchObject({ screen: 'edit', seals: [{ x: 200, y: 60 }] });
    tap('seal:104,171');
    tap('seal-up');
    expect(s.sealCase.capsules[0]).toEqual([{ seal: 50, x: 200, y: 60 }]);
    expect(s.sealCase.counts[49]).toBe(0);
    expect(v().message!.text).toBe(t.t('capsuleFinished'));
  });

  poffinReplay('sys-seals-solaceon');
  poffinReplay('sys-seals-sunyshore');
  poffinReplay('sys-seals-capsule');
});
