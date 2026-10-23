import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createUnderground, DEFAULT_CLOCK, Dex, monGender, type ClockTime, type Id, type Pokemon, type UndergroundState } from '@opensinnoh/core';
import { newFashionCase, newPoketchState, newSealCase, type SealCase, newRoamerState, setupPidIvs, setupPokemon, trainerIdFor } from '@opensinnoh/contracts';
import { createGame } from './game.ts';
import { clockChanged, newGameTime, updateGameTime } from './game-time.ts';
import { encounterSeed } from './save.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

/** A save without the v11 fields: no seen forms, no markings or ribbons. */
function stripV11(save: { state: Record<string, unknown> }): { state: Record<string, unknown> } {
  const state = save.state as { schemaVersion: number; pokedex: Record<string, unknown>; party: Record<string, unknown>[]; boxes: { slots: (Record<string, unknown> | null)[] }[] };
  delete state.pokedex.forms;
  delete (state as Record<string, unknown>).contestPhotos;
  delete (state as Record<string, unknown>).sealCase;
  const daycare = (state as unknown as { daycare: { mons: ({ mon: Record<string, unknown> } | null)[] } }).daycare.mons.map((d) => d?.mon ?? null);
  for (const m of [...state.party, ...state.boxes.flatMap((b) => b.slots), ...daycare]) {
    if (!m) continue;
    delete m.language;
    delete m.markings;
    delete m.ribbons;
    delete m.condition;
  }
  return save;
}

/** The current save with the old Pokétch (enabled, apps, current) and no v11 fields, as v2–v10 saves had it. */
const oldSave = (game: ReturnType<typeof createGame>) => {
  const save = JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> };
  const { enabled, apps, current } = save.state.poketch as { enabled: boolean; apps: string[]; current: string | null };
  save.state.poketch = { enabled, apps, current };
  delete (save.state.records as Record<string, unknown>).counts;
  delete save.state.mapFeatures;
  delete save.state.roamers;
  delete save.state.hallOfFame;
  delete save.state.fieldRng; // Added after v15: older save fixtures cannot carry it.
  delete save.state.berryPatches;
  delete save.state.poffins;
  delete save.state.fashionCase;
  return stripV11(save);
};

/** The current save as v18 had it: no condition, no Poffin Case, no Fashion Case. */
function asV18<T extends { state: Record<string, unknown> }>(save: T): T {
  delete save.state.contestPhotos;
  delete save.state.sealCase;
  delete save.state.poffins;
  delete save.state.fashionCase;
  const mons = [...(save.state.party as Record<string, unknown>[]), ...(save.state.boxes as { slots: (Record<string, unknown> | null)[] }[]).flatMap((b) => b.slots)];
  for (const m of mons) if (m) delete m.condition;
  save.state.schemaVersion = 18;
  return save;
}

const newGame = () => createGame({ packs: [readPack('fixture')], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => 'now' });

describe('save migration', () => {
  it('preserves foreign language through a save round trip, accepts older English saves and rejects invalid ids', () => {
    const game = newGame();
    game.state.party.push(setupPokemon(game.state, game.registries, 0, 'fixture:SPECIES_EMBERKIT' as Id, 5));
    game.state.party[0]!.language = 1;
    const save = game.save();
    game.load(JSON.parse(JSON.stringify(save)));
    expect(game.state.party[0]!.language).toBe(1);
    delete save.state.party[0]!.language;
    game.load(JSON.parse(JSON.stringify(save)));
    expect(game.state.party[0]!.language).toBeUndefined();
    save.state.party[0]!.language = 6;
    expect(() => game.load(save)).toThrow(/language/);
  });

  it('loads a v1 save as v19: objects belong to the player zone, the party becomes real Pokémon, new fields start empty', () => {
    const v1 = JSON.parse(readFileSync(join(import.meta.dirname, '../test/saves/v1-town.json'), 'utf8')) as unknown;
    const game = newGame();
    game.load(v1);
    expect(game.state).toMatchObject({
      schemaVersion: 22,
      seed: 12345,
      trainerId: trainerIdFor(12345),
      flags: { 'fixture:FLAG_TALKED_TO_HELPER': true },
      player: { zone: 'fixture:TOWN', x: 40, z: 16 },
      rng: { seed: 12345 },
      encounterRng: { seed: encounterSeed(12345) },
      badges: [],
      pokedex: { obtained: false, national: false, seen: ['fixture:SPECIES_EMBERKIT'], caught: ['fixture:SPECIES_EMBERKIT'] },
      poketch: { ...newPoketchState() },
      playerState: 'walk',
      runningShoes: true,
      currentBox: 0,
      tick: 900,
      playTime: { hours: 0, minutes: 0, seconds: 30 },
      startDate: null,
      repel: 0,
    });
    // The v1 party member: level 5 with its default moves, PID/IVs from (seed, slot), the player as OT, the pack's ball.
    const mon = game.state.party[0]!;
    expect(mon).toMatchObject({ species: 'fixture:SPECIES_EMBERKIT', level: 5, exp: 125, ...setupPidIvs(12345, 0), otName: 'Ari', otId: trainerIdFor(12345), ball: 'fixture:ITEM_CAPTURE_ORB' });
    expect(mon.moves).toEqual(['fixture:MOVE_BOP', 'fixture:MOVE_STARE']);
    expect(mon.hp).toBe(mon.stats.hp);
    expect(game.state.boxes.map((b) => [b.name, b.wallpaper, b.slots.length])).toEqual([
      ['CRATE 1', 0, 30],
      ['CRATE 2', 1, 30],
      ['CRATE 3', 2, 30],
      ['CRATE 4', 3, 30],
    ]);
    expect(Object.keys(game.state.bag)).toEqual(['items', 'medicine', 'balls', 'tmhms', 'berries', 'mail', 'battle_items', 'key_items']);
    expect(game.state.encounterRng.seed).not.toBe(12345);
    expect(game.state.objects.map((o) => [o.zone, o.localId])).toEqual([['fixture:TOWN', 0]]);
    expect(game.state).toMatchObject({ previousZone: null, platformLift: null });
    // The migrated state saves as v16 and loads again unchanged.
    const saved = game.save();
    expect(saved.state.schemaVersion).toBe(22);
    game.load(JSON.parse(JSON.stringify(saved)));
    expect(game.save()).toEqual(saved);
  });

  it('v2 → v16: no seed, so the main stream state stands in (trainer id and party PIDs follow it)', () => {
    const v1 = JSON.parse(readFileSync(join(import.meta.dirname, '../test/saves/v1-town.json'), 'utf8')) as { state: Record<string, unknown> };
    const v2 = structuredClone(v1);
    Object.assign(v2.state, { schemaVersion: 2, encounterRng: { seed: 5 }, badges: [], pokedex: { obtained: false, national: false }, poketch: { enabled: false, apps: [], current: null }, playerState: 'walk', rng: { seed: 777 } });
    v2.state.objects = (v2.state.objects as object[]).map((o) => ({ zone: 'fixture:TOWN', ...o }));
    v2.state.follower = null;
    const game = newGame();
    game.load(v2);
    expect(game.state).toMatchObject({ schemaVersion: 22, seed: 777, rng: { seed: 777 }, trainerId: trainerIdFor(777) });
    expect(game.state.party[0]!.pid).toBe(setupPidIvs(777, 0).pid);
  });

  it('v3 → v16: the zone header weather, gear 0, no special location', () => {
    const game = newGame();
    const v3 = oldSave(game);
    Object.assign(v3.state, { schemaVersion: 3, party: [], items: {}, pokedex: { obtained: false, national: false } });
    for (const k of ['cyclingGear', 'weather', 'specialLocation', 'trainerId', 'boxes', 'currentBox', 'bag', 'previousZone', 'platformLift', 'startDate', 'playTime', 'coins', 'registeredItem', 'wallpapersUnlocked', 'repel', 'records', 'signature', 'options', 'gameTime', 'daycare']) delete v3.state[k];
    game.load(v3);
    expect(game.state).toMatchObject({ schemaVersion: 22, cyclingGear: 0, weather: 'fixture:OVERWORLD_WEATHER_CLEAR', specialLocation: null });
    // A v3 save with v4 fields is not a v3 save.
    expect(() => game.load({ ...v3, state: { ...v3.state, cyclingGear: 0 } })).toThrow(/invalid save/);
  });

  it('v4 → v5 → v6: items go to their pockets (sorted pockets in item order), held items and moves are kept', () => {
    const game = newGame();
    const v4 = oldSave(game);
    Object.assign(v4.state, {
      schemaVersion: 4,
      party: [{ species: 'fixture:SPECIES_DRIPLING', level: 12, heldItem: 'fixture:ITEM_TONIC', moves: ['fixture:MOVE_SURF'] }],
      items: { 'fixture:ITEM_TOWN_GUIDE': 1, 'fixture:ITEM_TONIC': 4, 'fixture:ITEM_LAMP_OIL': 2, 'fixture:ITEM_LESSON_DIG': 1 },
      pokedex: { obtained: true, national: false },
    });
    for (const k of ['trainerId', 'boxes', 'currentBox', 'bag', 'previousZone', 'platformLift', 'startDate', 'playTime', 'coins', 'registeredItem', 'wallpapersUnlocked', 'repel', 'records', 'signature', 'options', 'gameTime', 'daycare']) delete v4.state[k];
    game.load(v4);
    expect(game.state.bag).toMatchObject({
      items: [{ item: 'fixture:ITEM_LAMP_OIL', count: 2 }],
      medicine: [{ item: 'fixture:ITEM_TONIC', count: 4 }],
      tmhms: [{ item: 'fixture:ITEM_LESSON_DIG', count: 1 }],
      key_items: [{ item: 'fixture:ITEM_TOWN_GUIDE', count: 1 }],
    });
    expect(game.state.party[0]).toMatchObject({ species: 'fixture:SPECIES_DRIPLING', level: 12, heldItem: 'fixture:ITEM_TONIC', moves: ['fixture:MOVE_SURF'], pp: [15], ppUps: [0] });
    expect(game.state.pokedex).toMatchObject({ obtained: true, national: false, seen: ['fixture:SPECIES_DRIPLING'], caught: ['fixture:SPECIES_DRIPLING'] });
  });

  it('v5 → v16: no previous zone and no platform lift yet; a v5 save with v6 fields is not a v5 save', () => {
    const game = newGame();
    const v5 = oldSave(game);
    v5.state.schemaVersion = 5;
    for (const k of ['previousZone', 'platformLift', 'startDate', 'playTime', 'coins', 'registeredItem', 'wallpapersUnlocked', 'repel', 'records', 'signature', 'options', 'gameTime', 'daycare']) delete v5.state[k];
    game.load(v5);
    expect(game.state).toMatchObject({ schemaVersion: 22, previousZone: null, platformLift: null });
    expect(() => game.load({ ...v5, state: { ...v5.state, previousZone: null } })).toThrow(/invalid save/);
  });

  it('v6 → v16: play time from the tick counter, the option defaults, no start date, coins, Repel or records', () => {
    const game = newGame();
    const v6 = oldSave(game);
    Object.assign(v6.state, { schemaVersion: 6, tick: 30 * (3600 * 2 + 61) + 29 });
    for (const k of ['startDate', 'playTime', 'coins', 'registeredItem', 'wallpapersUnlocked', 'repel', 'records', 'signature', 'options', 'gameTime', 'daycare']) delete v6.state[k];
    game.load(v6);
    expect(game.state).toMatchObject({
      schemaVersion: 22,
      startDate: null,
      playTime: { hours: 2, minutes: 1, seconds: 1 },
      coins: 0,
      registeredItem: null,
      wallpapersUnlocked: 0,
      repel: 0,
      records: { score: 0, hallOfFame: null, timesLinked: 0, linkBattleWins: 0, linkBattleLosses: 0, linkTrades: 0, counts: {} },
      signature: null,
      options: { sound: 0, battleScene: 0, battleStyle: 0, buttonMode: 0, frame: 0 },
    });
    // A v6 save with a v7 field is not a v6 save.
    expect(() => game.load({ ...v6, state: { ...v6.state, repel: 0 } })).toThrow(/invalid save/);
  });

  it('v8 → v16 (daycare): an empty daycare; a v8 save with a daycare is not a v8 save; v10 daycares are checked', () => {
    const game = newGame();
    const v8 = oldSave(game);
    v8.state.schemaVersion = 8;
    delete v8.state.daycare;
    game.load(v8);
    expect(game.state).toMatchObject({ schemaVersion: 22, daycare: { mons: [null, null], offspring: 0, stepCounter: 0 } });
    expect(() => game.load({ ...v8, state: { ...v8.state, daycare: game.state.daycare } })).toThrow(/invalid save/);
    const bad = JSON.parse(JSON.stringify(game.save())) as { state: { daycare: { mons: unknown[] } } };
    bad.state.daycare.mons = [null];
    expect(() => game.load(bad)).toThrow(/daycare has 2 slots/);
  });

  it('play time counts one second per 30 ticks and a new game records its start date', () => {
    const game = newGame();
    expect(game.state.startDate).toBe('2009-03-22');
    game.advance(95);
    expect(game.state.playTime).toEqual({ hours: 0, minutes: 0, seconds: 3 });
  });

  it('v10 → v16: the Pokétch keeps its apps and starts the rest afresh; a bad Pokétch is rejected', () => {
    const game = newGame();
    const v8 = oldSave(game);
    Object.assign(v8.state, { schemaVersion: 10, poketch: { enabled: true, apps: ['fixture:POKETCH_APPID_DIGITALWATCH', 'fixture:POKETCH_APPID_PEDOMETER'], current: null } });
    game.load(v8);
    expect(game.state.poketch).toEqual({ ...newPoketchState(), enabled: true, apps: ['fixture:POKETCH_APPID_DIGITALWATCH', 'fixture:POKETCH_APPID_PEDOMETER'], current: 'fixture:POKETCH_APPID_DIGITALWATCH' });
    expect(() => game.load({ ...v8, state: { ...v8.state, poketch: newPoketchState() } })).toThrow(/invalid save/);
    const bad = JSON.parse(JSON.stringify(game.save())) as { state: { poketch: Record<string, unknown> } };
    bad.state.poketch.current = 'fixture:POKETCH_APPID_CALCULATOR';
    expect(() => game.load(bad)).toThrow(/current is not a registered app/);
    bad.state.poketch.current = null;
    bad.state.poketch.steps = 100000;
    expect(() => game.load(bad)).toThrow(/invalid save/);
    bad.state.poketch.steps = 5;
    bad.state.poketch.dotArt = 'zz';
    expect(() => game.load(bad)).toThrow(/invalid save/);
  });

  it('v7 → v8: the saved clock starts at the default clock, and the load moves it to the game clock', () => {
    const clock = { date: '2026-10-14', hour: 21, minute: 5, second: 0 };
    const game = createGame({ packs: [readPack('fixture')], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => 'now', clock: () => clock });
    const v7 = oldSave(game);
    v7.state.schemaVersion = 7;
    delete v7.state.gameTime;
    delete v7.state.daycare;
    game.load(v7);
    expect(game.state.gameTime).toEqual({ now: clock, penaltyMinutes: 0 });
    expect(() => game.load({ ...v7, state: { ...v7.state, gameTime: game.state.gameTime } })).toThrow(/invalid save/);
    // A bad clock reading in a v11 save is rejected at the boundary.
    const bad = JSON.parse(JSON.stringify(game.save())) as { state: { gameTime: { now: { date: string } } } };
    bad.state.gameTime.now.date = '2026-02-30';
    expect(() => game.load(bad)).toThrow(/gameTime\.now: not a calendar date/);
    expect(DEFAULT_CLOCK.hour).toBe(12);
  });

  it('v10 → v11 → v16: Pokémon get no markings or ribbons; caught species get the forms and genders of the owned Pokémon', () => {
    const game = newGame();
    game.state.party.push(setupPokemon(game.state, game.registries, 0, 'fixture:SPECIES_EMBERKIT' as Id, 5));
    game.state.pokedex = { ...game.state.pokedex, seen: ['fixture:SPECIES_EMBERKIT' as Id, 'fixture:SPECIES_DRIPLING' as Id], caught: ['fixture:SPECIES_EMBERKIT' as Id], forms: {} };
    const v10 = oldSave(game);
    v10.state.schemaVersion = 10;
    game.load(v10);
    const mon = game.state.party[0]!;
    expect(game.state.schemaVersion).toBe(22);
    expect(mon).toMatchObject({ markings: 0, ribbons: [] });
    expect(game.state.pokedex.forms).toEqual({ 'fixture:SPECIES_EMBERKIT': [{ form: 0, gender: monGender(new Dex(game.registries), mon) }] });
    // A v10 save with a v11 field is not a v10 save; v11 ribbons are ascending ids.
    expect(() => game.load({ ...v10, state: { ...v10.state, pokedex: { ...(v10.state.pokedex as object), forms: {} } } })).toThrow(/invalid save/);
    const bad = JSON.parse(JSON.stringify(game.save())) as { state: { party: { ribbons: number[] }[] } };
    bad.state.party[0]!.ribbons = [3, 1];
    expect(() => game.load(bad)).toThrow(/ribbons must be ascending/);
    // A v11 save (seen forms, the old Pokétch) moves on to v12 and keeps its forms.
    const v11 = asV18(JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> });
    delete v11.state.berryPatches;
    const { enabled, apps, current } = v11.state.poketch as { enabled: boolean; apps: string[]; current: string | null };
    Object.assign(v11.state, { schemaVersion: 11, poketch: { enabled, apps, current } });
    delete (v11.state.records as Record<string, unknown>).counts;
    delete v11.state.mapFeatures;
    delete v11.state.roamers;
    delete v11.state.hallOfFame;
    game.load(v11);
    expect(game.state).toMatchObject({ schemaVersion: 22, poketch: { ...newPoketchState(), enabled, apps, current } });
    expect(game.state.pokedex.forms['fixture:SPECIES_EMBERKIT' as Id]).toHaveLength(1);
  });

  it('v12 → v16 (game records): no record counted; counts are checked by record id and kind', () => {
    const game = newGame();
    const v12 = asV18(JSON.parse(JSON.stringify(game.save()))) as { state: Record<string, unknown> & { records: Record<string, unknown> } };
    delete v12.state.berryPatches;
    v12.state.schemaVersion = 12;
    delete v12.state.fieldRng;
    delete v12.state.records.counts;
    delete v12.state.mapFeatures;
    delete v12.state.roamers;
    delete v12.state.hallOfFame;
    game.load(v12);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.records.counts).toEqual({});
    expect(() => game.load({ ...v12, state: { ...v12.state, records: { ...v12.state.records, counts: {} } } })).toThrow(/invalid save/);
    const save = (counts: Record<string, number>) => {
      const s = JSON.parse(JSON.stringify(game.save())) as { state: { records: { counts: Record<string, number> } } };
      s.state.records.counts = counts;
      return s;
    };
    game.load(save({ 34: 999999999, 80: 65535 }));
    expect(game.state.records.counts).toEqual({ 34: 999999999, 80: 65535 });
    expect(() => game.load(save({ 1: 5 }))).toThrow(/not a counted record id/);
    expect(() => game.load(save({ 148: 5 }))).toThrow(/not a counted record id/);
    expect(() => game.load(save({ 80: 65536 }))).toThrow(/u16 record 80/);
  });

  it('v13 → v16 (map features): none outside a gym; a v13 save with map features is not a v13 save; slots are checked', () => {
    const game = newGame();
    const v13 = asV18(JSON.parse(JSON.stringify(game.save()))) as { state: Record<string, unknown> };
    delete v13.state.berryPatches;
    v13.state.schemaVersion = 13;
    delete v13.state.fieldRng;
    delete v13.state.mapFeatures;
    delete v13.state.roamers;
    delete v13.state.hallOfFame;
    game.load(v13);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.mapFeatures).toBeNull();
    expect(() => game.load({ ...v13, state: { ...v13.state, mapFeatures: null } })).toThrow(/invalid save/);
    const save = (mapFeatures: unknown) => {
      const s = JSON.parse(JSON.stringify(game.save())) as { state: { mapFeatures: unknown } };
      s.state.mapFeatures = mapFeatures;
      return s;
    };
    game.load(save({ kind: 'eterna-gym', clock: 3 }));
    expect(game.state.mapFeatures).toEqual({ kind: 'eterna-gym', clock: 3 });
    game.load(save({ kind: 'veilstone-gym', initialized: true, bags: [{ x: 1, z: 2 }], stacks: [null, { x: 3, z: 4 }] }));
    expect(() => game.load(save({ kind: 'eterna-gym', clock: 5 }))).toThrow(/invalid save/);
    expect(() => game.load(save({ kind: 'hearthome-gym', initialized: true, correctDoor: 9, clueX: 1, clueZ: 1 }))).toThrow(/invalid save/);
    expect(() => game.load(save({ kind: 'pastoria-gym' }))).toThrow(/invalid save/);
  });

  it('v14 → v16 (roamers): none active; a v14 save with roamers is not a v14 save; roamers are checked', () => {
    const game = newGame();
    const v14 = asV18(JSON.parse(JSON.stringify(game.save()))) as { state: Record<string, unknown> };
    delete v14.state.berryPatches;
    v14.state.schemaVersion = 14;
    delete v14.state.fieldRng;
    delete v14.state.roamers;
    delete v14.state.hallOfFame;
    game.load(v14);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.roamers).toEqual(newRoamerState());
    expect(() => game.load({ ...v14, state: { ...v14.state, roamers: newRoamerState() } })).toThrow(/invalid save/);
    const save = (roamers: unknown) => {
      const s = JSON.parse(JSON.stringify(game.save())) as { state: { roamers: unknown } };
      s.state.roamers = roamers;
      return s;
    };
    const ivs = { hp: 1, attack: 2, defense: 3, speed: 4, spAttack: 5, spDefense: 31 };
    const mesprit = { species: 'fixture:SPECIES_EMBERKIT', level: 50, pid: 0xdeadbeef, ivs, hp: 120, status: 'sleep' };
    const roamers = { slots: [mesprit, null, null, null, null, null], routes: [3, 0, 0, 0, 0, 28], current: 'fixture:TOWN', previous: null };
    game.load(save(roamers));
    expect(game.state.roamers).toEqual(roamers);
    expect(() => game.load(save({ ...roamers, routes: [29, 0, 0, 0, 0, 0] }))).toThrow(/invalid save/);
    expect(() => game.load(save({ ...roamers, slots: [mesprit] }))).toThrow(/6 entries/);
    expect(() => game.load(save({ ...roamers, current: 'fixture:NOWHERE' }))).toThrow(/unknown zones/);
    expect(() => game.load(save({ ...roamers, slots: [{ ...mesprit, status: 'asleep' }, null, null, null, null, null] }))).toThrow(/invalid save/);
  });
});

describe('the Hall of Fame (v16)', () => {
  it('v15 → v16: no entry; entries are checked (at most 30, teams of 1–6, no more than the total)', () => {
    const game = newGame();
    const v15 = asV18(JSON.parse(JSON.stringify(game.save()))) as { state: Record<string, unknown> };
    delete v15.state.berryPatches;
    v15.state.schemaVersion = 15;
    delete v15.state.hallOfFame;
    game.load(v15);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.hallOfFame).toEqual({ total: 0, entries: [] });
    expect(() => game.load({ ...v15, state: { ...v15.state, hallOfFame: { total: 0, entries: [] } } })).toThrow(/invalid save/);
    const mon = { species: 'fixture:SPECIES_EMBERKIT', form: 0, level: 50, pid: 1, otId: 2, nickname: null, otName: 'Ari', moves: ['fixture:MOVE_BOP'] };
    const save = (hallOfFame: unknown) => {
      const s = JSON.parse(JSON.stringify(game.save())) as { state: { hallOfFame: unknown } };
      s.state.hallOfFame = hallOfFame;
      return s;
    };
    game.load(save({ total: 31, entries: [{ date: '2009-03-22', party: [mon] }] }));
    expect(game.state.hallOfFame.total).toBe(31);
    expect(() => game.load(save({ total: 0, entries: [{ date: '2009-03-22', party: [mon] }] }))).toThrow(/more entries than the total/);
    expect(() => game.load(save({ total: 1, entries: [{ date: '2009-03-22', party: [] }] }))).toThrow(/1–6/);
    expect(() => game.load(save({ total: 99, entries: Array.from({ length: 31 }, () => ({ date: '2009-03-22', party: [mon] })) }))).toThrow(/more than 30/);
    expect(() => game.load(save({ total: 1, entries: [{ date: '2009-03-22', party: [{ ...mon, species: 'fixture:SPECIES_NOPE' }] }] }))).toThrow(/unknown species/);
  });
});

describe('the fateful-encounter bit and the tablet name (v17)', () => {
  it('v16 → v17: nothing fateful, no tablet name; both round-trip and are checked', () => {
    const game = newGame();
    game.state.party.push(setupPokemon(game.state, game.registries, 0, 'fixture:SPECIES_EMBERKIT' as Id, 5));
    const v16 = asV18(JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> });
    delete v16.state.berryPatches;
    v16.state.schemaVersion = 16;
    game.load(v16);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.party[0]!.fatefulEncounter).toBeUndefined();
    expect(game.state.tabletName).toBeUndefined();
    expect(() => game.load({ ...v16, state: { ...v16.state, tabletName: 'Ari' } })).toThrow(/invalid save/);

    game.state.party[0]!.fatefulEncounter = true;
    game.state.tabletName = 'Thank you';
    game.load(JSON.parse(JSON.stringify(game.save())));
    expect(game.state.party[0]!.fatefulEncounter).toBe(true);
    expect(game.state.tabletName).toBe('Thank you');
    const save = (mon: Record<string, unknown>, tabletName?: unknown) => {
      const s = JSON.parse(JSON.stringify(game.save())) as { state: { party: Record<string, unknown>[]; tabletName?: unknown } };
      Object.assign(s.state.party[0]!, mon);
      if (tabletName !== undefined) s.state.tabletName = tabletName;
      return s;
    };
    expect(() => game.load(save({ fatefulEncounter: false }))).toThrow(/invalid save/);
    expect(() => game.load(save({}, 'eleven chars'))).toThrow(/invalid save/);
    expect(() => game.load(save({}, ''))).toThrow(/invalid save/);
  });
});

describe('the berry patches (v18)', () => {
  it('v17 → v18: the patches a new game has (none in the fixture); patches round-trip and are checked', () => {
    const game = newGame();
    const v17 = asV18(JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> });
    delete v17.state.berryPatches;
    v17.state.schemaVersion = 17;
    game.load(v17);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.berryPatches).toEqual([]);
    expect(() => game.load({ ...v17, state: { ...v17.state, berryPatches: [] } })).toThrow(/invalid save/);
    const item = [...game.registries.items.keys()][0]!;
    const patch = { berry: item, stage: 'growing', stageMinutes: 30, moistureMinutes: 5, replants: 1, yield: 0, moisture: 40, yieldRating: 4, mulch: null, growing: true };
    const save = (p: Record<string, unknown>) => ({ ...v17, state: { ...v17.state, schemaVersion: 18, berryPatches: [p] } });
    game.load(save(patch));
    expect(game.state.berryPatches).toEqual([patch]);
    expect(() => game.load(save({ ...patch, berry: null }))).toThrow(/berry exactly when it has a stage/);
    expect(() => game.load(save({ ...patch, stage: 'ripe' }))).toThrow(/invalid save/);
    expect(() => game.load(save({ ...patch, moisture: 101 }))).toThrow(/invalid save/);
    expect(() => game.load(save({ ...patch, berry: 'fixture:ITEM_NOPE' }))).toThrow(/unknown items/);
  });
});

describe('the condition, the Poffin Case and the Fashion Case (v19)', () => {
  it('v18 → v19: every condition 0, no Poffins, an empty Fashion Case; all round-trip and are checked', () => {
    const game = newGame();
    game.state.party.push(setupPokemon(game.state, game.registries, 0, 'fixture:SPECIES_EMBERKIT' as Id, 5));
    const v18 = asV18(JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> });
    game.load(v18);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.party[0]!.condition).toEqual({ cool: 0, beauty: 0, cute: 0, smart: 0, tough: 0, sheen: 0 });
    expect(game.state.poffins).toEqual([]);
    expect(game.state.fashionCase).toEqual(newFashionCase());
    expect(() => game.load({ ...v18, state: { ...v18.state, poffins: [] } })).toThrow(/invalid save/);

    game.state.party[0]!.condition.beauty = 170;
    game.state.poffins.push({ type: 6, flavors: [0, 25, 0, 0, 0], smoothness: 20 });
    game.state.fashionCase.accessories[3] = 9;
    game.state.fashionCase.backdrops.push(4, 0);
    const saved = JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> };
    game.load(saved);
    expect(game.save()).toEqual(saved);
    const bad = (edit: (s: { state: { party: { condition: Record<string, number> }[]; poffins: unknown[]; fashionCase: { accessories: number[]; backdrops: number[] } } }) => void) => {
      const s = JSON.parse(JSON.stringify(saved)) as Parameters<typeof edit>[0];
      edit(s);
      return () => game.load(s);
    };
    expect(bad((s) => (s.state.party[0]!.condition.sheen = 256))).toThrow(/invalid save/);
    expect(bad((s) => s.state.poffins.push({ type: 29, flavors: [0, 0, 0, 0, 0], smoothness: 0 }))).toThrow(/invalid save/);
    expect(bad((s) => (s.state.poffins = Array.from({ length: 101 }, () => ({ type: 27, flavors: [2, 2, 2, 0, 0], smoothness: 30 }))))).toThrow(/more than 100 Poffins/);
    expect(bad((s) => (s.state.fashionCase.accessories[70] = 2))).toThrow(/unique accessory/);
    expect(bad((s) => s.state.fashionCase.backdrops.push(4))).toThrow(/backdrop is held twice/);
    expect(bad((s) => s.state.fashionCase.accessories.pop())).toThrow(/accessories has 99 entries/);
  });
});

describe('the contest photos (v20)', () => {
  it('v19 → v20: no photo; a photo round-trips and is checked', () => {
    const game = newGame();
    const v19 = JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> };
    delete v19.state.contestPhotos;
    delete v19.state.sealCase;
    v19.state.schemaVersion = 19;
    game.load(v19);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.contestPhotos).toEqual([null, null, null, null, null]);
    expect(() => game.load({ ...v19, state: { ...v19.state, contestPhotos: [null, null, null, null, null] } })).toThrow(/invalid save/);

    game.state.contestPhotos[2] = {
      mon: { species: 'fixture:SPECIES_EMBERKIT' as Id, form: 0, pid: 7, otId: 9, nickname: null },
      trainerName: 'Ash',
      rank: 1,
      dressUp: { accessories: [{ accessory: 72, x: 120, y: 140, priority: -1 }], monPriority: -2, backdrop: 3 },
    };
    const saved = JSON.parse(JSON.stringify(game.save())) as { state: { contestPhotos: { rank: number }[] } };
    game.load(saved);
    expect(game.save()).toEqual(saved);
    const bad = (edit: (s: typeof saved) => void) => {
      const s = JSON.parse(JSON.stringify(saved)) as typeof saved;
      edit(s);
      return () => game.load(s);
    };
    expect(bad((s) => s.state.contestPhotos.pop())).toThrow(/contestPhotos must have 5 slots/);
    expect(bad((s) => (s.state.contestPhotos[2]!.rank = 4))).toThrow(/invalid save/);
    expect(() => game.load({ ...saved, state: { ...saved.state, contest: {} } })).toThrow(/invalid save/);
  });
});

describe("the Underground's traps and secret base (v21)", () => {
  it('v20 → v21: no laid traps, no base, no traps set off or base moves; a base round-trips and is checked', () => {
    const game = newGame();
    const u = createUnderground(game.state, 1);
    u.goodsPc.push(9, 12);
    const v20 = JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> & { underground: Record<string, unknown> & { records: Record<string, number> } } };
    v20.state.schemaVersion = 20;
    delete v20.state.sealCase;
    delete v20.state.underground.placedTraps;
    delete v20.state.underground.base;
    delete v20.state.underground.records.trapsTriggered;
    delete v20.state.underground.records.baseMoves;
    game.load(v20);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.underground).toMatchObject({ placedTraps: [], base: null, records: { trapsTriggered: 0, baseMoves: 0 } });
    expect(() => game.load({ ...v20, state: { ...v20.state, underground: { ...v20.state.underground, base: null } } })).toThrow(/invalid save/);

    const ug = game.state.underground!;
    ug.placedTraps.push({ trap: 11, x: 100, z: 120 });
    ug.base = { entrance: { x: 101, z: 120, dir: 'down' }, goods: Array.from({ length: 15 }, () => null), boulders: Array.from({ length: 16 }, (_, i) => (i < 2 ? { x: 10, z: 12 + i * 2 } : null)) };
    ug.base.goods[0] = { good: 12, x: 16, z: 13, slot: 1 };
    const saved = JSON.parse(JSON.stringify(game.save())) as { state: { underground: UndergroundState } };
    game.load(saved);
    expect(game.save()).toEqual(saved);
    const bad = (edit: (s: UndergroundState) => void) => {
      const s = JSON.parse(JSON.stringify(saved)) as typeof saved;
      edit(s.state.underground);
      return () => game.load(s);
    };
    expect(bad((s) => s.base!.goods.pop())).toThrow(/15 goods and 16 boulder slots/);
    expect(bad((s) => (s.base!.goods[1] = { good: 9, x: 18, z: 13, slot: 1 }))).toThrow(/one PC slot twice/);
    expect(bad((s) => (s.base!.goods[0]!.slot = 5))).toThrow(/PC slot is empty/);
    expect(bad((s) => (s.placedTraps = Array.from({ length: 17 }, (_, i) => ({ trap: 1, x: 100 + i, z: 100 }))))).toThrow(/placedTraps is over its limit/);
    expect(bad((s) => (s.placedTraps[0]!.trap = 33))).toThrow(/invalid save/);
  });
});

describe('the Seal Case and Ball Capsules (v22)', () => {
  it('v21 → v22: an empty Seal Case; capsules round-trip on party Pokémon and are checked', () => {
    const game = newGame();
    game.state.party.push(setupPokemon(game.state, game.registries, 0, 'fixture:SPECIES_EMBERKIT' as Id, 5));
    const v21 = JSON.parse(JSON.stringify(game.save())) as { state: Record<string, unknown> };
    v21.state.schemaVersion = 21;
    delete v21.state.sealCase;
    game.load(v21);
    expect(game.state.schemaVersion).toBe(22);
    expect(game.state.sealCase).toEqual(newSealCase());
    expect(() => game.load({ ...v21, state: { ...v21.state, sealCase: newSealCase() } })).toThrow(/invalid save/);

    game.state.sealCase.counts[4] = 3;
    game.state.sealCase.capsules[2] = [{ seal: 5, x: 190, y: 70 }];
    game.state.party[0]!.capsule = { id: 3, seals: [{ seal: 5, x: 190, y: 70 }] };
    type Saved = { state: { sealCase: SealCase; party: Pokemon[]; boxes: { slots: (Pokemon | null)[] }[] } };
    const saved = JSON.parse(JSON.stringify(game.save())) as Saved;
    game.load(saved);
    expect(game.save()).toEqual(saved);
    const bad = (edit: (s: Saved['state']) => void) => {
      const s = JSON.parse(JSON.stringify(saved)) as Saved;
      edit(s.state);
      return () => game.load(s);
    };
    expect(bad((s) => s.sealCase.counts.pop())).toThrow(/80 counts and 12 capsules/);
    expect(bad((s) => (s.sealCase.counts[0] = 100))).toThrow(/invalid save/);
    expect(bad((s) => (s.sealCase.capsules[0] = Array.from({ length: 9 }, () => ({ seal: 1, x: 190, y: 70 }))))).toThrow(/at most 8 seals/);
    expect(bad((s) => (s.party[0]!.capsule!.id = 13))).toThrow(/invalid save/);
    expect(bad((s) => (s.party[0]!.capsule!.seals[0]!.seal = 81))).toThrow(/invalid save/);
    expect(bad((s) => (s.party[0]!.capsule!.seals[0]!.y = 256))).toThrow(/invalid save/);
    expect(bad((s) => (s.party[0]!.capsule!.seals = Array.from({ length: 9 }, () => ({ seal: 1, x: 190, y: 70 }))))).toThrow(/at most 8 seals/);
    expect(bad((s) => s.party.push({ ...s.party[0]! }))).toThrow(/same Ball Capsule/);
    expect(bad((s) => (s.boxes[0]!.slots[0] = s.party[0]!))).toThrow(/box or the Day-Care has a Ball Capsule/);
  });
});

describe('saved objects', () => {
  it('may carry a pass-through mark (0.27.13, decomp MAP_OBJ_STATUS_18; the world test restores it); older saves have none; it must be a boolean', () => {
    const game = newGame();
    const save = (extra: Record<string, unknown>) => {
      const s = JSON.parse(JSON.stringify(game.save())) as { state: { objects: unknown[] } };
      s.state.objects = [{ zone: 'fixture:TOWN', localId: 0, x: 44, z: 16, y: 0, facing: 'down', movementType: 0, ...extra }];
      return s;
    };
    expect(() => game.load(save({ passThrough: true }))).not.toThrow();
    expect(() => game.load(save({}))).not.toThrow();
    expect(() => game.load(save({ passThrough: 'yes' }))).toThrow(/invalid save/);
  });
});

describe('game clock (decomp GameTime)', () => {
  const clockGame = (clock: () => ClockTime) => createGame({ packs: [readPack('fixture')], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => 'now', clock });

  it('the saved clock follows the clock by whole minutes, and straight back when it goes back (sub_020559DC)', () => {
    const log = new CountingStubLog(() => {});
    const start: ClockTime = { date: '2026-10-14', hour: 9, minute: 59, second: 30 };
    const t = newGameTime(start);
    expect(t).toEqual({ now: start, penaltyMinutes: 0 });
    updateGameTime(t, { ...start, second: 59 }, log);
    expect(t.now).toEqual(start); // under a minute: unchanged
    const later = { ...start, hour: 10, minute: 0, second: 31 };
    updateGameTime(t, later, log);
    expect(t.now).toEqual(later);
    expect(log.counts.get('clock:timed-events')).toBe(1);
    // A new day runs the daily events once, even within the minute.
    const midnight = { date: '2026-10-15', hour: 0, minute: 0, second: 0 };
    updateGameTime(t, { date: '2026-10-14', hour: 23, minute: 59, second: 59 }, log);
    updateGameTime(t, midnight, log);
    expect(t.now).toEqual(midnight);
    expect(log.counts.get('clock:daily-events')).toBe(1);
    // Back: straight back, no penalty while playing.
    const back = { ...start, hour: 3 };
    updateGameTime(t, back, log);
    expect(t).toMatchObject({ now: back, penaltyMinutes: 0 });
  });

  it('the penalty: 24 h when a save loads with the clock behind it, counted down by the minutes that pass', () => {
    const t = newGameTime({ date: '2026-10-14', hour: 12, minute: 0, second: 0 });
    clockChanged(t, { date: '2026-10-14', hour: 12, minute: 30, second: 0 });
    expect(t.penaltyMinutes).toBe(0); // later: time away, not a change
    const behind = { date: '2026-10-14', hour: 11, minute: 0, second: 0 };
    clockChanged(t, behind);
    expect(t).toMatchObject({ now: behind, penaltyMinutes: 1440 });
    const log = new CountingStubLog(() => {});
    updateGameTime(t, { ...behind, hour: 13, minute: 30 }, log);
    expect(t.penaltyMinutes).toBe(1440 - 150);
    updateGameTime(t, { ...behind, date: '2026-10-16' }, log);
    expect(t.penaltyMinutes).toBe(0);
  });

  it('a game starts its saved clock and start date at the clock, and a load applies the penalty rule', () => {
    let clock: ClockTime = { date: '2026-10-14', hour: 12, minute: 0, second: 0 };
    const game = clockGame(() => clock);
    expect(game.state.gameTime).toEqual({ now: clock, penaltyMinutes: 0, dailyRandom: expect.any(Number) });
    expect(game.state.startDate).toBe('2026-10-14');
    const save = game.save();
    clock = { ...clock, hour: 11 };
    game.load(save);
    expect(game.state.gameTime).toMatchObject({ now: clock, penaltyMinutes: 1440 });
    clock = { ...clock, date: '2026-10-20' };
    game.load(save);
    expect(game.state.gameTime).toMatchObject({ now: clock, penaltyMinutes: 0 });
  });

  it('setClock freezes the clock until a reset restores the option', () => {
    const game = clockGame(() => ({ date: '2026-10-14', hour: 9, minute: 1, second: 2 }));
    game.setClock(undefined, '21:30');
    expect(game.clock()).toEqual({ date: '2026-10-14', hour: 21, minute: 30, second: 0 });
    game.setClock('2024-02-29');
    expect(game.clock()).toEqual({ date: '2024-02-29', hour: 21, minute: 30, second: 0 });
    expect(() => game.setClock('2023-02-29')).toThrow(/invalid date/);
    game.reset();
    expect(game.clock()).toEqual({ date: '2026-10-14', hour: 9, minute: 1, second: 2 });
  });
});
