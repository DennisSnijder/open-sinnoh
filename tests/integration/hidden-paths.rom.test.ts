/**
 * The overworld matrix's map-load edits on the real Platinum data (OPENSINNOH_NDS_ROM): Route 214's way into the Spring
 * Path stays closed until the hidden location is found (decomp MapMatrix_RevealSpringPath), and the Seabreak Path's
 * land appears once Oak's Letter found it (MapMatrix_RevealSeabreakPath). The VM is a fake that runs nothing.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, type Button, type Id } from '@opensinnoh/core';
import { setupPokemon, type GameState, type InputFrame, type Registries, type ScriptRunner } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { createWorld, type WorldDeps } from '@opensinnoh/world';
import { fixtureAudio } from '../fixtures/audio.ts';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (name: string) => `platinum:${name}` as Id;
const SPRING = P('VAR_HIDDEN_LOCATION_SPRING_PATH');
const SEABREAK = P('VAR_HIDDEN_LOCATION_SEABREAK_PATH');

describe.skipIf(!romPath)('hidden paths on Platinum data (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let base: () => GameState;

  beforeAll(async () => {
    const { pack } = romSlice();
    const packs = loadGamePacks([pack]);
    reg = packs.registries;
    base = () => newGameState([...reg.newGame.values()][0]!, reg, packs.loaded.order, 1);
  }, 120_000);

  function run(zone: string, x: number, z: number, vars: Record<string, number>) {
    const state = base();
    state.player = { zone: P(`MAP_HEADER_${zone}`), x, z, y: 0, facing: 'right' };
    state.party = [setupPokemon(state, reg, 0, P('SPECIES_PIPLUP'), 5)];
    Object.assign(state.vars, vars);
    const scripts: ScriptRunner = {
      start: () => {},
      runImmediate: () => {},
      running: () => false,
      step: () => {},
      view: () => ({ message: null, yesNo: null, menu: null, panel: { kind: 'idle', title: '' }, app: null }),
      takeStartMenuRequest: () => false,
      appDone: () => {},
      ask: () => {
        throw new Error('no field questions');
      },
      notice: () => {
        throw new Error('no field messages here');
      },
    };
    const audio = fixtureAudio(reg, state);
    const deps: WorldDeps = { audio, registries: reg, state, scripts, log: { stub: () => {} }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => ({ ...DEFAULT_CLOCK }) };
    const world = createWorld(deps);
    let last: Button[] = [];
    const tick = (held: Button[] = []) => {
      const input: InputFrame = { held, pressed: held.filter((b) => !last.includes(b)), touch: null };
      last = held;
      if (world.idle()) world.checkTriggers(input);
      audio.tick();
      world.step(input);
      state.tick++;
    };
    world.enter('arrival');
    for (let i = 0; i < 20; i++) tick();
    return { world, state, tick };
  }

  it('closes the Spring Path off Route 214 until it is found, and opens it after', () => {
    const closed = run('ROUTE_214', 735, 706, {});
    expect(closed.world.view().matrix).toBe(P('matrix/0/spring-path-closed'));
    for (let i = 0; i < 40; i++) closed.tick(['right']);
    expect(closed.state.player).toMatchObject({ zone: P('MAP_HEADER_ROUTE_214'), x: 735, z: 706 });

    const open = run('ROUTE_214', 735, 706, { [SPRING]: 0x312 });
    expect(open.world.view().matrix).toBe(P('matrix/0'));
    for (let i = 0; i < 40; i++) open.tick(['right']);
    expect(open.state.player.x).toBeGreaterThan(736);
    expect(open.state.player.zone).toBe(P('MAP_HEADER_SPRING_PATH'));
  });

  it('loads the Seabreak Path land once found, with or without the Spring Path', () => {
    expect(run('ROUTE_214', 735, 706, { [SEABREAK]: 0x1028 }).world.view().matrix).toBe(P('matrix/0/spring-path-closed-seabreak-path'));
    expect(run('ROUTE_214', 735, 706, { [SPRING]: 0x312, [SEABREAK]: 0x1028 }).world.view().matrix).toBe(P('matrix/0/seabreak-path'));
    const m = (id: string) => reg.matrices.get(P(id))!;
    const cell = (x: number, z: number) => x + z * m('matrix/0').width;
    expect([m('matrix/0').chunks[cell(28, 15)], m('matrix/0/seabreak-path').chunks[cell(28, 15)]]).toEqual([P('chunk/115'), P('chunk/119')]);
    expect(m('matrix/0/spring-path-closed').altitudes![cell(23, 21)]).toBe(2);
  });
});
