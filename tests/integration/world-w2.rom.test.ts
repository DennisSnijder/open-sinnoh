import { fixtureAudio } from '../fixtures/audio.ts';
/**
 * World systems on the real Platinum data (OPENSINNOH_NDS_ROM): walk loops on Route 205 South, the disguised
 * trainers of Route 210 North, map-change weather on the target zones with a frozen date, and the
 * Veilstone Department Store elevator's special location. The VM is a fake that records script starts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, type Button, type Id } from '@opensinnoh/core';
import { setupPokemon, type Facing, type GameState, type InputFrame, type Registries, type ScriptRunner, type ScriptStart } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { createWorld, type WorldDeps } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (name: string) => `platinum:${name}` as Id;
const ZONE = (name: string) => P(`MAP_HEADER_${name}`);
const WEATHER = (name: string) => P(`OVERWORLD_WEATHER_${name}`);

describe.skipIf(!romPath)('World W2 on Platinum data (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let base: () => GameState;

  beforeAll(async () => {
    const { pack } = romSlice();
    const packs = loadGamePacks([pack]);
    reg = packs.registries;
    base = () => newGameState([...reg.newGame.values()][0]!, reg, packs.loaded.order, 1);
  }, 120_000);

  function run(zone: string, x: number, z: number, facing: Facing, { date = '2009-03-22', edit = (_: GameState) => {}, regs = reg } = {}) {
    const state = base();
    state.player = { zone: ZONE(zone), x, z, y: 0, facing };
    state.party = [setupPokemon(state, reg, 0, P('SPECIES_PIPLUP'), 5)];
    state.gameTime.now = { ...DEFAULT_CLOCK, date };
    edit(state);
    const starts: ScriptStart[] = [];
    const scripts: ScriptRunner = {
      start: (s) => void starts.push(s),
      runImmediate: () => {},
      running: () => starts.some((s) => s.source === 'trainer'),
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
    const stubs: string[] = [];
    const audio = fixtureAudio(regs, state);
    const deps: WorldDeps = { audio, registries: regs, state, scripts, log: { stub: (k) => void stubs.push(k) }, battleLog: () => {}, battles: { start: () => {}, done: () => null, blackOut: () => {} }, clock: () => ({ ...DEFAULT_CLOCK, date }) };
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
    return { world, state, starts, stubs, tick };
  }
  const object = (s: GameState, zone: string, localId: number) => s.objects.find((o) => o.zone === ZONE(zone) && o.localId === localId)!;

  it('Route 205 South walk loops (types 39 and 44) trace their rectangles and return to their origins', () => {
    const g = run('ROUTE_205_SOUTH', 214, 595, 'down');
    const loops = [
      { id: 5, origin: [207, 598], range: [2, 5] },
      { id: 21, origin: [206, 625], range: [3, 3] },
    ];
    const home = new Map<number, number>();
    const tiles = new Map<number, Set<string>>();
    for (let i = 0; i < 1200; i++) {
      g.tick();
      for (const l of loops) {
        const o = object(g.state, 'ROUTE_205_SOUTH', l.id);
        expect(Math.abs(o.x - l.origin[0]!)).toBeLessThanOrEqual(l.range[0]!);
        expect(Math.abs(o.z - l.origin[1]!)).toBeLessThanOrEqual(l.range[1]!);
        if (o.x === l.origin[0] && o.z === l.origin[1]) home.set(l.id, (home.get(l.id) ?? 0) + 1);
        (tiles.get(l.id) ?? tiles.set(l.id, new Set()).get(l.id)!).add(`${o.x},${o.z}`);
      }
    }
    for (const l of loops) {
      expect(home.get(l.id), `object ${l.id}`).toBeGreaterThan(2);
      expect(tiles.get(l.id)!.size, `object ${l.id}`).toBeGreaterThan(4);
    }
    expect(g.stubs.filter((s) => s.startsWith('movement-type:'))).toEqual([]);
    // Positions after N ticks are deterministic (no random rolls in walk loops).
    const again = run('ROUTE_205_SOUTH', 214, 595, 'down');
    for (let i = 0; i < 1200; i++) again.tick();
    for (const l of loops) expect(object(again.state, 'ROUTE_205_SOUTH', l.id)).toEqual(object(g.state, 'ROUTE_205_SOUTH', l.id));
  });

  it('Route 210 North: a disguised ninja boy hides 32 units down, reveals himself when the player steps next to him', () => {
    const g = run('ROUTE_210_NORTH', 564, 533, 'up');
    const ninja = () => g.world.view().actors.find((a) => a.localId === 2)!;
    const groundAt = ninja().cur[1] + 32;
    expect(g.starts).toEqual([]);
    for (let i = 0; i < 8; i++) g.tick(['up']);
    g.tick();
    expect(g.starts.map((s) => [s.source, s.trainer?.localIds])).toEqual([['trainer', [2]]]);
    expect(ninja().cur[1]).toBe(groundAt - 32);
    g.world.trainerApproach(2);
    const lifts: number[] = [];
    for (let i = 0; i < 200 && !g.world.trainerApproachDone(); i++) {
      g.tick();
      lifts.push(Math.round(ninja().cur[1] - groundAt));
    }
    expect(g.world.trainerApproachDone()).toBe(true);
    expect(Math.max(...lifts)).toBeGreaterThan(0);
    expect(lifts[lifts.length - 1]).toBe(0);
    expect(object(g.state, 'ROUTE_210_NORTH', 2)).toMatchObject({ x: 564, z: 531, movementType: 0 });
  });

  it('weather on the target zones with a frozen date; yearly zones follow the day; Defog and Flash clear theirs', () => {
    const weather = (zone: string, date = '2009-03-22', flag?: string) => {
      const z = reg.zones.get(ZONE(zone))!;
      const at = z.events.warps[0] ?? { x: 0, z: 0 };
      return run(zone, at.x, at.z, 'down', { date, edit: (s) => void (flag && (s.flags[P(flag)] = true)) }).state.weather;
    };
    expect(weather('ROUTE_217')).toBe(WEATHER('BLIZZARD'));
    expect(weather('ROUTE_215')).toBe(WEATHER('RAINING'));
    expect(weather('ROUTE_228')).toBe(WEATHER('SANDSTORM'));
    expect(weather('STARK_MOUNTAIN_OUTSIDE')).toBe(WEATHER('SLOW_ASHFALL'));
    expect(weather('ETERNA_FOREST')).toBe(WEATHER('23'));
    expect(weather('OLD_CHATEAU')).toBe(WEATHER('27'));
    expect(weather('ROUTE_210_NORTH')).toBe(WEATHER('FOG'));
    expect(weather('ROUTE_210_NORTH', undefined, 'FLAG_DEFOG_ACTIVE')).toBe(WEATHER('CLEAR'));
    expect(weather('WAYWARD_CAVE_1F')).toBe(WEATHER('DARK_FLASH'));
    expect(weather('WAYWARD_CAVE_1F', undefined, 'FLAG_FLASH_ACTIVE')).toBe(WEATHER('CLEAR'));
    // sYearlyWeather: Mar 22 (the default date), Jan 1, and Feb 29 of a leap year.
    const yearly = ['ROUTE_212_SOUTH', 'ROUTE_213', 'ROUTE_216', 'ACUITY_LAKEFRONT', 'SNOWPOINT_CITY'];
    expect(yearly.map((z) => weather(z))).toEqual(['RAINING', 'CLEAR', 'HEAVY_SNOW', 'HEAVY_SNOW', 'SNOWING'].map(WEATHER));
    expect(yearly.map((z) => weather(z, '2009-01-01'))).toEqual(['RAINING', 'CLEAR', 'HEAVY_SNOW', 'SNOWING', 'SNOWING'].map(WEATHER));
    expect(yearly.map((z) => weather(z, '2008-02-29'))).toEqual(['HEAVY_RAIN', 'CLOUDY', 'BLIZZARD', 'SNOWING', 'HAILING'].map(WEATHER));
  });

  it('Veilstone Department Store elevator: entering records the floor; its dynamic exit leads to the special location', () => {
    // The slice import has no Veilstone door props: their doors act as plain blocked warp tiles here.
    const noDoors: Registries = { ...reg, tileBehaviors: new Map([...reg.tileBehaviors].map(([id, b]) => [id, b.name === 'DOOR' ? { ...b, name: 'DOOR_UNDRAWN' } : b])) };
    const g = run('VEILSTONE_STORE_1F', 15, 3, 'up', { regs: noDoors });
    for (let i = 0; i < 60 && g.state.player.zone === ZONE('VEILSTONE_STORE_1F'); i++) g.tick(['up']);
    for (let i = 0; i < 60 && !g.world.idle(); i++) g.tick();
    expect(g.state.player.zone).toBe(ZONE('VEILSTONE_STORE_ELEVATOR'));
    // Arriving at the elevator's dynamic warp copies the entrance (1F warp 2) into the special location.
    expect(g.state.specialLocation).toEqual({ zone: ZONE('VEILSTONE_STORE_1F'), warp: 2, x: 15, z: 2, facing: 'up' });
    // The elevator script picks the floor (set_special_location 3F, warp 2), then the ride.
    g.state.specialLocation = { zone: ZONE('VEILSTONE_STORE_3F'), warp: 2, x: 18, z: 2, facing: 'down' };
    g.world.elevator('up', 4);
    for (let i = 0; i < 200 && !g.world.elevatorDone(); i++) g.tick();
    expect(g.world.elevatorDone()).toBe(true);
    for (let i = 0; i < 120 && g.state.player.zone === ZONE('VEILSTONE_STORE_ELEVATOR'); i++) g.tick(['down']);
    for (let i = 0; i < 60 && !g.world.idle(); i++) g.tick();
    expect(g.state.player.zone).toBe(ZONE('VEILSTONE_STORE_3F'));
    expect(Math.abs(g.state.player.x - 15) + Math.abs(g.state.player.z - 2)).toBeLessThanOrEqual(1);
  });
});
