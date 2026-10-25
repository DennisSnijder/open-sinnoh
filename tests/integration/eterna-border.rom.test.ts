import { fixtureAudio } from '../fixtures/audio.ts';
/**
 * The Route 205 north / Eterna City border on the real Platinum data (OPENSINNOH_NDS_ROM). Eterna lists
 * Route 205's arrow signpost at (281, 532) as a clone under local id 4, which its second Galactic grunt
 * (hidden by FLAG_HIDE_ETERNA_CITY_GALACTIC_GRUNTS) uses too. A save in Eterna restored the signpost as
 * that grunt; crossing west then drew the grunt (departed) on top of the respawned signpost.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, type Button, type Id } from '@opensinnoh/core';
import { setupPokemon, type ActorView, type GameState, type InputFrame, type Registries, type ScriptRunner } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { createWorld } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (name: string) => `platinum:${name}` as Id;
const ETERNA = P('MAP_HEADER_ETERNA_CITY');
const ROUTE = P('MAP_HEADER_ROUTE_205_NORTH');
const SIGNPOST = P('OBJ_EVENT_GFX_ARROW_SIGNPOST');
const GRUNT = P('OBJ_EVENT_GFX_GRUNT_M');
const HIDE_GRUNTS = P('FLAG_HIDE_ETERNA_CITY_GALACTIC_GRUNTS');
const tile = (a: ActorView) => [Math.floor(a.cur[0] / 16), Math.floor(a.cur[2] / 16)];

describe.skipIf(!romPath)('Route 205 north / Eterna City border (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let base: () => GameState;

  beforeAll(async () => {
    const { pack } = romSlice();
    const packs = loadGamePacks([pack]);
    reg = packs.registries;
    base = () => newGameState([...reg.newGame.values()][0]!, reg, packs.loaded.order, 1);
  }, 120_000);

  /** A world on `state` (a new game, or a loaded save): enter, then settle. */
  function boot(state: GameState) {
    const scripts: ScriptRunner = {
      start: () => {},
      runImmediate: () => {},
      running: () => false,
      step: () => {},
      view: () => ({ message: null, yesNo: null, menu: null, panel: { kind: 'idle', title: '' }, app: null }),
      takeStartMenuRequest: () => false,
      fieldReturn: () => {},
      appDone: () => {},
      ask: () => {
        throw new Error('no field questions');
      },
      notice: () => {
        throw new Error('no field messages here');
      },
    };
    const world = createWorld({ audio: fixtureAudio(reg, state), registries: reg, state, scripts, log: { stub: () => {} }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => DEFAULT_CLOCK });
    let last: Button[] = [];
    const tick = (held: Button[] = []) => {
      const input: InputFrame = { held, pressed: held.filter((b) => !last.includes(b)), touch: null };
      last = held;
      if (world.idle()) world.checkTriggers(input);
      world.step(input);
      state.tick++;
    };
    world.enter('arrival');
    for (let i = 0; i < 20; i++) tick();
    const walk = (dir: Button, tiles: number) => {
      for (let i = 0; i < tiles * 8; i++) tick([dir]);
      for (let i = 0; i < 20; i++) tick();
    };
    return { world, state, walk };
  }

  function start(zone: Id, x: number, hidden: boolean) {
    const state = base();
    state.player = { zone, x, z: 532, y: 0, facing: 'left' };
    state.party = [setupPokemon(state, reg, 0, P('SPECIES_PIPLUP'), 5)];
    if (hidden) state.flags[HIDE_GRUNTS] = true;
    return boot(state);
  }

  /** Everything drawn at the signpost's tile: live actors and departed objects. */
  function atSignpost(g: ReturnType<typeof boot>) {
    const view = g.world.view();
    return [...view.actors, ...(view.departed?.actors ?? [])].filter((a) => tile(a).join() === '281,532').map((a) => [a.home, a.localId, a.sprite]);
  }
  const signpost = [ROUTE, 4, SIGNPOST];

  /** Live and departed grunts (previews are other zones' objects on their own tiles). */
  function grunts(g: ReturnType<typeof boot>) {
    const view = g.world.view();
    return [...view.actors, ...(view.departed?.actors ?? []), ...view.previews].filter((a) => a.sprite === GRUNT);
  }

  for (const hidden of [true, false]) {
    describe(hidden ? 'grunts hidden' : 'grunts shown', () => {
      it('eastbound: Route 205 north → Eterna, save and load in Eterna, then west again', () => {
        const g = start(ROUTE, 285, hidden);
        expect(atSignpost(g)).toEqual([signpost]);
        g.walk('right', 6);
        expect(g.state.player).toMatchObject({ zone: ETERNA, x: 291 });
        expect(atSignpost(g)).toEqual([signpost]);
        expect(g.state.objects.filter((o) => o.localId === 4).map((o) => [o.zone, o.cloneOf])).toEqual(hidden ? [[ETERNA, ROUTE]] : [[ETERNA, undefined], [ETERNA, ROUTE]]);

        const loaded = boot(structuredClone(g.state));
        expect(atSignpost(loaded)).toEqual([signpost]);
        // Eterna's grunts: none when hidden, else on their own tiles.
        expect(grunts(loaded).map((a) => [a.home, tile(a).join()])).toEqual(hidden ? [] : [[ETERNA, '331,539'], [ETERNA, '301,529'], [ETERNA, '315,535']]);

        loaded.walk('left', 6);
        expect(loaded.state.player).toMatchObject({ zone: ROUTE, x: 285 });
        expect(atSignpost(loaded)).toEqual([signpost]);
        // In the route, a grunt is only ever an Eterna preview, in Eterna.
        for (const a of grunts(loaded)) expect([a.home, tile(a)[0]! >= 288]).toEqual([ETERNA, true]);
        if (hidden) expect(grunts(loaded)).toEqual([]);
      });

      it('westbound: Eterna → Route 205 north, from a fresh map and from a save made in Eterna', () => {
        const g = start(ETERNA, 291, hidden);
        expect(atSignpost(g)).toEqual([signpost]);
        const loaded = boot(structuredClone(g.state));
        for (const run of [g, loaded]) {
          run.walk('left', 6);
          expect(run.state.player).toMatchObject({ zone: ROUTE, x: 285 });
          expect(atSignpost(run)).toEqual([signpost]);
          for (const a of grunts(run)) expect([a.home, tile(a)[0]! >= 288]).toEqual([ETERNA, true]);
          if (hidden) expect(grunts(run)).toEqual([]);
        }
      });
    });
  }
});
