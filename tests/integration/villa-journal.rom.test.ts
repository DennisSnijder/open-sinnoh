/**
 * The Villa, the journal and the diplomas on the ROM (docs/research/villa-journal.md): the imported tables against the
 * note's values, the furniture the Villa's map load builds, the daily visitor and its object in the Villa, the journal
 * and diploma screens, and the replays (each twice on seeds 1–3 with the save round trip).
 */
import { describe, expect, it } from 'vitest';
import { JOURNAL_EVENT, journalDate, type JournalView, type DiplomaView, type NewGame, type GameState, type JournalPage } from '@opensinnoh/contracts';
import type { Button, Id } from '@opensinnoh/core';
import { createBattle, createContestMoveAnimation } from '@opensinnoh/battle';
import { CountingStubLog, createGame, gameDriver, runReplay, type Game } from '@opensinnoh/game';
import { createApp } from '@opensinnoh/menus';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';
import { romSlice } from '../rom.ts';
import { readReplay, resolveReplay } from '../rom-replays/sys-replays.ts';

const ng = () => (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!;
const newGame = (seed = 1, log = new CountingStubLog(() => {})) =>
  createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, createContestAnimation: createContestMoveAnimation, seed, log, now: () => '2009-03-22T12:00:00Z' });
/** Plays a replay's text once (no repeat, no round trip check of its own) on `game`. */
const play = async (game: Game, text: string) => {
  const r = await runReplay(gameDriver(game), text, { name: 'inline', registries: game.registries, resolve: resolveReplay, seed: 1, repeat: false });
  expect(r.error).toBeUndefined();
};
const press = (game: Game, b: Button, ticks = 1) => {
  game.step({ held: [b], pressed: [b], touch: null });
  for (let i = 1; i < ticks; i++) game.step({ held: [b], pressed: [], touch: null });
  game.step({ held: [], pressed: [], touch: null });
};
const idle = (game: Game, n: number) => {
  for (let i = 0; i < n; i++) game.step({ held: [], pressed: [], touch: null });
};
/** World units of the note's c (tile centre ×16 + 8) and e (tile edge ×16). */
const c = (t: number) => t * 16 + 8;
const e = (t: number) => t * 16;

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the Villa, the journal and the diplomas (OPENSINNOH_NDS_ROM)', () => {
  it('imports the Villa tables as the note reads them', () => {
    const v = ng().villa!;
    expect(v.zone).toBe('platinum:MAP_HEADER_VILLA');
    expect(v.resortArea).toBe('platinum:MAP_HEADER_RESORT_AREA');
    expect(v.furniture.map((f) => f.prop)).toEqual(Array.from({ length: 20 }, (_, i) => `platinum:prop/${559 + i}`));
    expect(v.furniture[0]).toEqual({ flag: 'platinum:FLAG_VILLA_FURNITURE_TABLE', prop: 'platinum:prop/559', label: 'platinum:Villa_Furniture_Table' });
    expect(v.furniture[5]!.label).toBe('platinum:TVBroadcast_Interact');
    expect(v.furniture[8]!.label).toBe('platinum:Villa_Furniture_Rack');
    expect(v.rows).toHaveLength(23);
    expect(v.rows.map((r) => r.type)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(v.rows.map((r) => [r.position[0], r.position[2]])).toEqual([
      [c(12), e(7)], [e(15), e(7)], [c(13), c(10)], [c(18), e(8)], [c(20), c(7)], [e(12), c(3)], [c(14), c(3)], [e(17), c(3)], [e(19), c(3)],
      [c(1), c(3)], [c(20), c(3)], [c(1), c(11)], [c(20), c(11)], [e(2), c(8)], [c(18), c(3)], [c(2), c(3)], [c(6), c(3)], [c(2), c(5)],
      [e(6), e(10)], [c(11), c(1)], [c(8), c(1)], [c(6), c(10)], [c(7), c(6)],
    ]);
    expect(v.rows.every((r) => r.position[1] === 0)).toBe(true);
    expect(v.rows.filter((r) => !r.collision).map((r) => r.type)).toEqual([11, 16, 17, 18, 19]);
    expect(v.rows[0]!.box).toEqual({ left: 11, top: 5, right: 13, bottom: 8 });
    expect(v.rows[4]!.box).toEqual({ left: 17, top: 6, right: 17, bottom: 7 });
    expect(v.rows[17]!.box).toEqual({ left: 1, top: 4, right: 2, bottom: 6 });
    expect(v.visitors).toMatchObject({ chances: [25, 75, 90], counts: [4, 12, 15], visitorVar: 'platinum:VAR_RESORT_VILLA_VISITOR', messageVar: 'platinum:VAR_RESORT_VILLA_VISITOR_MESSAGE_NUM' });
  });

  it('imports the journal and diploma tables as the note reads them', () => {
    const j = ng().journal!;
    expect(j.gyms.map((g) => [g.trainer, g.zone])).toEqual([
      ['platinum:TRAINER_LEADER_ROARK', 'platinum:MAP_HEADER_OREBURGH_CITY_GYM'], ['platinum:TRAINER_LEADER_GARDENIA', 'platinum:MAP_HEADER_ETERNA_CITY_GYM'],
      ['platinum:TRAINER_LEADER_WAKE', 'platinum:MAP_HEADER_PASTORIA_CITY_GYM'], ['platinum:TRAINER_LEADER_MAYLENE', 'platinum:MAP_HEADER_VEILSTONE_CITY_GYM'],
      ['platinum:TRAINER_LEADER_FANTINA', 'platinum:MAP_HEADER_HEARTHOME_CITY_GYM_ENTRANCE_ROOM'], ['platinum:TRAINER_LEADER_CANDICE', 'platinum:MAP_HEADER_SNOWPOINT_CITY_GYM'],
      ['platinum:TRAINER_LEADER_BYRON', 'platinum:MAP_HEADER_CANALAVE_CITY_GYM'], ['platinum:TRAINER_LEADER_VOLKNER', 'platinum:MAP_HEADER_SUNYSHORE_CITY_GYM_ROOM_1'],
    ]);
    expect(j.buildings.map((b) => b.label)).toEqual([90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 71, 103, 64, 104, 105, 80, 106, 107, 108, 109, 110, 47, 49, 70]);
    expect(j.caveDeparted).toEqual([47, 64, 49]);
    expect(j.pageTurn).toHaveLength(9);
    expect(j.pageTurn[0]).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(j.pageTurn[8]).toEqual(Array.from({ length: 32 }, () => 0xff));
    expect(j.art).toEqual({ male: 'platinum:ui2d/journal/page-male', female: 'platinum:ui2d/journal/page-female' });
    const sheets = romSlice().pack.registries.ui2d as unknown as { id: Id; cells: unknown[] }[];
    expect(sheets.find((s) => s.id === j.art!.male)!.cells).toHaveLength(10);
    expect(ng().diploma).toMatchObject({ sinnoh: 'platinum:ui2d/diploma/sinnoh', national: 'platinum:ui2d/diploma/national', texts: { player: 'platinum:Diploma_Text_Player' } });
  });

  it('a Villa map load builds every owned piece\'s props; the furniture blocks the player and talks', async () => {
    const game = newGame();
    const flags = ng().villa!.furniture.map((f) => `set flag ${f.flag} true`).join('\n');
    await play(game, `party 0 platinum:SPECIES_GARCHOMP 60 platinum:MOVE_EARTHQUAKE\nset var platinum:VAR_RESORT_AREA_STATE 1\nset var platinum:VAR_VILLA_STATE 2\n${flags}\nwarp platinum:MAP_HEADER_VILLA 10 6 down\nuntil idle\n`);
    expect(game.state.mapFeatures).toEqual({ kind: 'villa' });
    const models = game.world.view().features!.models;
    expect(models).toHaveLength(23);
    expect(models.map((m) => m.prop)).toEqual(ng().villa!.rows.map((r) => ng().villa!.furniture[r.type]!.prop));
    expect(models[13]).toMatchObject({ prop: 'platinum:prop/569', position: [e(2), 0, c(8)], rotation: [0, 0, 0] });
  });

  it('the daily visitor is chosen away from the Resort Area and shows in the Villa (seeds 1–3)', async () => {
    for (const seed of [1, 2, 3]) {
      const game = newGame(seed);
      const flags = ng().villa!.furniture.slice(0, 13).map((f) => `set flag ${f.flag} true`).join('\n');
      await play(game, `party 0 platinum:SPECIES_GARCHOMP 60 platinum:MOVE_EARTHQUAKE\nset flag platinum:FLAG_GAME_COMPLETED true\nset var platinum:VAR_RESORT_AREA_STATE 1\nset var platinum:VAR_VILLA_STATE 2\nset var platinum:VAR_RESORT_VILLA_VISITOR 255\n${flags}\ndate 2009-03-22 23:59\nwarp platinum:MAP_HEADER_SURVIVAL_AREA 296 449 down\nuntil idle\n+0 date 2009-03-23 00:01\n+3 press down\n+1 release down\n`);
      const visitor = game.state.vars['platinum:VAR_RESORT_VILLA_VISITOR' as Id] ?? 0;
      expect(visitor === 0xff || visitor < 15).toBe(true);
      expect(game.state.vars['platinum:VAR_RESORT_VILLA_VISITOR_MESSAGE_NUM' as Id] ?? 0).toBeLessThan(5);
    }
    // A chosen in-Villa visitor (Volkner, 11) is shown by the Villa's onTransition; the knockers wait outside the door.
    const game = newGame();
    await play(game, `party 0 platinum:SPECIES_GARCHOMP 60 platinum:MOVE_EARTHQUAKE\nset var platinum:VAR_RESORT_AREA_STATE 1\nset var platinum:VAR_VILLA_STATE 2\nset flag platinum:FLAG_VILLA_FURNITURE_TABLE true\nset var platinum:VAR_RESORT_VILLA_VISITOR 11\nwarp platinum:MAP_HEADER_VILLA 10 6 down\nuntil idle\n`);
    expect(game.state.objects.some((o) => o.localId === 11 && o.zone === 'platinum:MAP_HEADER_VILLA')).toBe(true);
    expect(game.state.flags['platinum:FLAG_HIDE_VILLA_VOLKNER' as Id]).toBeFalsy();
  });

  it('the journal screen prints every location event line, turns pages and closes', () => {
    const game = newGame();
    const page = (day: number, events: JournalPage['events']): JournalPage => ({
      date: { year: 9, month: 3, day, weekday: day % 7 },
      zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN' as Id,
      events,
      mon: { result: 'caught', variant: 2, timeOfDay: 1, gender: 1, species: 'platinum:SPECIES_BIDOOF' as Id },
      trainer: { trainer: 'platinum:TRAINER_YOUNGSTER_TRISTAN' as Id, zone: 'platinum:MAP_HEADER_ROUTE_202' as Id },
    });
    const types = Object.values(JOURNAL_EVENT).filter((t) => t !== JOURNAL_EVENT.none && t !== JOURNAL_EVENT.unused);
    const value = (t: number) => (t === JOURNAL_EVENT.leftCave ? 47 : t === JOURNAL_EVENT.leftBuilding ? 90 : t === JOURNAL_EVENT.item ? 1 : t === JOURNAL_EVENT.gymTooTough || t === JOURNAL_EVENT.gymLeader ? 2 : 411);
    const pages: JournalPage[] = [];
    for (let i = 0; i < types.length; i += 4) pages.push(page(1 + pages.length, types.slice(i, i + 4).map((t) => ({ type: t, value: value(t), trainer: t >= 10 && t <= 12 ? 246 : 0 }))));
    (game.state as GameState).journal = pages.slice(0, 10);
    (game.state as GameState).flags['platinum:FLAG_JOURNAL_ACQUIRED' as Id] = true;
    const app = createApp({ app: 'journal' }, { registries: game.registries, state: game.state, log: new CountingStubLog(() => {}), host: { sound: undefined } as never });
    const frame = (pressed: Button[] = []) => app.step({ held: pressed, pressed, touch: null });
    const view = () => app.view() as JournalView;
    expect(view().black).toBe(16);
    for (let i = 0; i < 6; i++) frame();
    // The texts are the ROM's (checked by their sources, not their words): the month name and day, the weekday message.
    const text = (id: string) => game.registries.texts.get(id as Id)!.text;
    const date = text('platinum:JournalEntries_Text_Date').replace('{var 0}', text('platinum:pl_msg_00000414_00002')).replace('{var 1}', '1');
    expect(view()).toMatchObject({ black: 0, page: { index: 0, title: date, weekday: text('platinum:JournalEntries_Text_Monday') }, newer: false, older: true });
    expect(view().page.rows[0]!.y).toBe(0);
    expect(view().page.rows[0]!.text).toContain(game.registries.zones.get('platinum:MAP_HEADER_TWINLEAF_TOWN' as Id)!.name);
    expect(view().page.rows.find((r) => r.y === 80)!.text).toContain(game.registries.species.get('platinum:SPECIES_BIDOOF' as Id)!.name);
    expect(view().page.rows.find((r) => r.y === 96)!.text).toContain(game.registries.zones.get('platinum:MAP_HEADER_ROUTE_202' as Id)!.name);
    // Every page of every event type prints (a missing text or slot would throw).
    for (let p = 1; p < Math.min(pages.length, 10); p++) {
      frame(['right']);
      for (let i = 0; i < 10; i++) frame();
      expect(view().page.index).toBe(p);
    }
    frame(['left']);
    frame();
    expect(view().turn).toMatchObject({ step: 0 });
    for (let i = 0; i < 9; i++) frame();
    expect(view().turn).toBeNull();
    while (view().page.index > 0) {
      frame(['b']);
      for (let i = 0; i < 10; i++) frame();
    }
    frame(['b']);
    let closed = null;
    for (let i = 0; i < 6 && !closed; i++) closed = frame();
    expect(closed).toEqual({ app: 'journal' });
    expect(journalDate({ date: '2009-03-22', hour: 0, minute: 0, second: 0 })).toEqual({ year: 9, month: 3, day: 22, weekday: 0 });
  });

  it('the director shows the Sinnoh diploma once the Sinnoh Pokédex is complete', async () => {
    const game = newGame();
    await play(game, `party 0 platinum:SPECIES_GARCHOMP 60 platinum:MOVE_EARTHQUAKE\nwarp platinum:MAP_HEADER_GRAND_LAKE_VALOR_LAKEFRONT_WEST_HOUSE 5 4 up\nuntil idle\n`);
    game.state.pokedex.seen = [...game.registries.species.values()].filter((s) => s.regionalDex !== undefined).map((s) => s.id);
    let view: DiplomaView | null = null;
    for (let i = 0; i < 3000 && !view; i++) {
      const app = game.app();
      if (app?.app === 'diploma') view = app;
      else {
        press(game, 'a');
        idle(game, 2);
      }
    }
    expect(view).toMatchObject({ sheet: 'platinum:ui2d/diploma/sinnoh', lines: [{ x: 48, y: 32 }, { x: 64, y: 64 }, { x: 138, y: 144 }] });
    expect(view!.lines[0]!.text).toContain(game.state.names.player);
    expect(game.state.flags['platinum:FLAG_RECEIVED_LOCAL_DEX_DIPLOMA' as Id]).toBe(true);
    idle(game, 6 + 60 + 48 + 2);
    press(game, 'a');
    idle(game, 8);
    expect(game.app()).toBeNull();
  });
});

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('the Villa and journal replays', () => {
  for (const file of ['sys-villa-free', 'sys-villa-buy', 'sys-journal'])
    for (const seed of [1, 2, 3])
      it(`${file}: twice on seed ${seed}, save round trip`, async () => {
        const log = new CountingStubLog(() => {});
        const game = newGame(seed, log);
        const result = await runReplay(gameDriver(game), readReplay(`${file}.replay`), { name: `${file}.replay`, registries: game.registries, resolve: resolveReplay, seed, repeat: true });
        expect(result.error).toBeUndefined();
        expect(result).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical' });
        const stubs = [...log.counts.keys()];
        for (const op of ['init_persisted_map_features_for_villa', 'check_met_furniture_requirements', 'show_list_menu_set_width', 'give_journal', 'create_journal_event']) expect(stubs.some((k) => k.includes(op)), op).toBe(false);
        // The Villa's TV segments are recorded (FieldSystem_SaveTVSegment_HomeAndManor*), no longer stubs.
        expect(stubs.some((k) => k.startsWith('stub:save_tv_segment'))).toBe(false);
        if (file.startsWith('sys-villa')) expect(game.state.tv.sightings.some((r) => r?.data.kind.startsWith('villa'))).toBe(true);
      }, 300_000);
});
