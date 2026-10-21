import { fixtureAudio } from '../fixtures/audio.ts';
/**
 * Terrain and HMs on the real Platinum data (OPENSINNOH_NDS_ROM), on the target zones:
 * Surf at Lake Verity, Waterfall on Route 210 North, Rock Climb on Route 211
 * East and Route 207, ice in Snowpoint Temple B3F, spin tiles in the Fuego Ironworks, deep mud on Route
 * 212 South, snow on Route 216, the bike slope on Route 207, the ramp in Oreburgh Gate B1F, the bike
 * bridge on Route 210 North, the Strength boulders in Oreburgh Gate B1F, and the undecoded behaviours.
 * The VM is a fake: the HM tasks are started the way `use_surf`/`use_waterfall`/`use_rock_climb` do.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, type Button, type Id } from '@opensinnoh/core';
import { setupPokemon, type BattleSetup, type Facing, type GameState, type InputFrame, type Registries, type ScriptRunner, type ScriptStart, type World } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { HM_CUT_IN_TICKS, INERT_UNKNOWN, createWorld, isSurfable } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (name: string) => `platinum:${name}` as Id;
const DELTA: Record<Facing, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

describe.skipIf(!romPath)('Terrain and HMs on Platinum data (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let base: () => GameState;

  beforeAll(async () => {
    const { pack } = romSlice();
    const packs = loadGamePacks([pack]);
    reg = packs.registries;
    base = () => newGameState([...reg.newGame.values()][0]!, reg, packs.loaded.order, 1);
  }, 120_000);


  function run(zone: string, x: number, z: number, facing: Facing, edit: (s: GameState) => void = () => {}, from?: GameState) {
    const state = from ?? base();
    if (!from) {
      state.player = { zone: P(`MAP_HEADER_${zone}`), x, z, y: 0, facing };
      state.party = [setupPokemon(state, reg, 0, P('SPECIES_BIBAREL'), 30, [P('MOVE_SURF'), P('MOVE_WATERFALL'), P('MOVE_ROCK_CLIMB'), P('MOVE_STRENGTH')])];
      for (const fl of reg.flags.values()) if ((fl.sourceIndex ?? 0) > 0x550 && (fl.sourceIndex ?? 0) < 0x8f0) state.flags[fl.id] = true;
      edit(state);
    }
    const starts: ScriptStart[] = [];
    const battles: BattleSetup[] = [];
    const scripts: ScriptRunner = {
      start: (s) => void starts.push(s),
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
    const stubs: string[] = [];
    const deps = { audio: fixtureAudio(reg, state), registries: reg, state, scripts, log: { stub: (k: string) => void stubs.push(k) }, battleLog: () => {}, battles: { start: (b: BattleSetup) => void battles.push(b), done: () => null, blackOut: () => {} }, clock: () => DEFAULT_CLOCK };
    const world: World = createWorld(deps);
    let last: Button[] = [];
    const tick = (held: Button[] = []) => {
      const input: InputFrame = { held, pressed: held.filter((b) => !last.includes(b)), touch: null };
      last = held;
      if (world.idle()) world.checkTriggers(input);
      deps.audio.tick();
      world.step(input);
      state.tick++;
    };
    world.enter('arrival');
    for (let i = 0; i < 20; i++) tick();
    const until = (done: () => boolean, max: number, held: Button[] = []) => {
      for (let i = 1; i <= max; i++) {
        tick(held);
        if (done()) return i;
      }
      throw new Error(`not reached in ${max} ticks (at ${state.player.x},${state.player.z})`);
    };
    return { world, state, starts, battles, stubs, tick, until };
  }

  const zoneOf = (zone: string) => reg.zones.get(P(`MAP_HEADER_${zone}`))!;
  /** Tile word at a matrix tile (bit 15 blocked, bits 0–7 behaviour), or null outside. */
  function tile(zone: string, x: number, z: number): number | null {
    const m = reg.matrices.get(zoneOf(zone).matrix)!;
    if (x < 0 || z < 0 || x >= m.width * 32 || z >= m.height * 32) return null;
    const chunk = m.chunks[Math.floor(x / 32) + Math.floor(z / 32) * m.width];
    return chunk ? reg.chunks.get(chunk)!.tiles[(x % 32) + (z % 32) * 32]! : null;
  }
  const names = () => new Map([...reg.tileBehaviors.values()].map((b) => [b.sourceIndex, b.name]));
  const behaviour = (zone: string, x: number, z: number) => names().get((tile(zone, x, z) ?? 0) & 0xff)!;
  const free = (zone: string, x: number, z: number) => {
    const t = tile(zone, x, z);
    return t !== null && (t & 0x8000) === 0;
  };
  /** The zone's tiles with a behaviour, row by row. */
  function find(zone: string, test: (b: string) => boolean): [number, number][] {
    const id = P(`MAP_HEADER_${zone}`);
    const m = reg.matrices.get(zoneOf(zone).matrix)!;
    const byte = names();
    const out: [number, number][] = [];
    for (let z = 0; z < m.height * 32; z++)
      for (let x = 0; x < m.width * 32; x++) {
        const cell = Math.floor(x / 32) + Math.floor(z / 32) * m.width;
        if (m.zones && m.zones[cell] !== id) continue;
        const t = tile(zone, x, z);
        if (t !== null && test(byte.get(t & 0xff)!)) out.push([x, z]);
      }
    return out;
  }

  it('the undecoded behaviours are inert: no predicate reads them, and the free ones walk like plain ground', () => {
    for (const b of INERT_UNKNOWN) expect([...reg.tileBehaviors.values()].some((r) => r.name === b)).toBe(true);
    // Most of the 76 tiles are blocked furniture (x88 in houses); walk onto a free one from a free neighbour.
    let walked = 0;
    for (const zone of reg.zones.values()) {
      const name = zone.id.slice('platinum:MAP_HEADER_'.length);
      if (!zone.id.startsWith('platinum:MAP_HEADER_') || name.startsWith('UNKNOWN') || zone.mapType === 'other') continue;
      for (const [x, z] of find(name, (b) => INERT_UNKNOWN.has(b)))
        for (const dir of ['up', 'down', 'left', 'right'] as const) {
          const [dx, dz] = DELTA[dir];
          if (walked || !free(name, x, z) || !free(name, x - dx, z - dz) || behaviour(name, x - dx, z - dz) !== 'NONE') continue;
          const g = run(name, x - dx, z - dz, dir);
          g.until(() => g.state.player.x === x && g.state.player.z === z && g.world.idle(), 20, [dir]);
          expect(g.stubs.filter((k) => k.includes('behaviour'))).toEqual([]);
          walked++;
        }
    }
    expect(walked).toBe(1);
  });

  it('Lake Verity: surf from (50, 36) west, the blob, surf encounters, a save mid-surf, walking again after a warp', () => {
    const g = run('LAKE_VERITY', 50, 36, 'left', (s) => (s.vars[P('VAR_LAKE_VERITY_PROF_ROWAN_STATE')] = 1));
    expect(isSurfable(behaviour('LAKE_VERITY', 49, 36))).toBe(true);
    g.tick(['left']);
    g.until(() => g.world.idle(), 40);
    expect(g.state.player).toMatchObject({ x: 50, z: 36 });
    g.world.surf(0);
    expect(g.until(() => g.world.surfDone(), 100)).toBe(HM_CUT_IN_TICKS + 8);
    expect(g.state).toMatchObject({ playerState: 'surf', player: { x: 49, z: 36 } });
    const blob = g.world.view().effects.length === 1 || g.stubs.includes('fldeff:0xf');
    expect(blob).toBe(true);
    g.until(() => g.state.player.x === 45 && g.world.idle(), 40, ['left']);
    // A save mid-surf restores the surf state.
    const saved = structuredClone(g.state);
    const h = run('LAKE_VERITY', 0, 0, 'left', () => {}, saved);
    expect(h.state.playerState).toBe('surf');
    h.until(() => h.state.player.x === 44 && h.world.idle(), 20, ['left']);
    // Wild encounters on the water roll the lake's surf table.
    const table = reg.encounters.get(zoneOf('LAKE_VERITY').encounters!)!;
    for (let i = 0; i < 3000 && h.battles.length < 3; i++) h.tick([h.state.player.x === 44 ? 'right' : 'left']);
    expect(h.battles.length).toBeGreaterThan(0);
    for (const b of h.battles) expect(table.surf.map((s) => s.species)).toContain(b.wild[0]!.species);
    const [tx, tz] = find('TWINLEAF_TOWN', (b) => b === 'NONE').find(([x, z]) => free('TWINLEAF_TOWN', x, z) && free('TWINLEAF_TOWN', x, z + 1))!;
    h.world.warp(P('MAP_HEADER_TWINLEAF_TOWN'), tx, tz, 'down');
    h.until(() => h.world.warpDone(), 40);
    expect(h.state.playerState).toBe('walk');
  });

  it('Route 210 North: the waterfall up two tiles and back down', () => {
    const zone = 'ROUTE_210_NORTH';
    const [x, z] = find(zone, (b) => b === 'WATERFALL').find(([x, z]) => behaviour(zone, x, z + 1) !== 'WATERFALL' && isSurfable(behaviour(zone, x, z + 1)))!;
    const g = run(zone, x, z + 1, 'up', (s) => (s.playerState = 'surf'));
    g.world.waterfall(0);
    expect(g.until(() => g.world.waterfallDone(), 400)).toBe(HM_CUT_IN_TICKS + 96);
    expect(g.state.player).toMatchObject({ x, z: z - 1 });
    expect(isSurfable(behaviour(zone, x, z - 1))).toBe(true);
    g.tick();
    g.world.waterfall(0);
    expect(() => g.world.waterfall(0)).toThrow(/waterfall during waterfall/);
    g.until(() => g.world.waterfallDone(), 400);
    expect(g.state.player).toMatchObject({ x, z: z - 3 });
    // Facing down at the top with Waterfall in the party, surfing south descends on its own. The party check
    // reads the behaviour's field move (set here as FieldMoves_SetUsableMoves has it).
    const rec = [...reg.tileBehaviors.values()].find((b) => b.name === 'WATERFALL')!;
    (rec as { fieldMove?: unknown }).fieldMove ??= { move: P('MOVE_WATERFALL'), label: P('scripts_field_moves/6') };
    const top = find(zone, (b) => b === 'WATERFALL').find(([wx, wz]) => wx === x && behaviour(zone, wx, wz - 1) !== 'WATERFALL')!;
    const d = run(zone, x, top[1] - 1, 'down', (s) => (s.playerState = 'surf'));
    d.tick(['down']);
    expect(d.until(() => d.world.idle(), 200)).toBe(96);
    expect(d.state.player).toMatchObject({ x, z: top[1] + 1 });
  });

  it('Rock Climb: Route 211 East north-south and Route 207 east-west, ending past the wall', () => {
    for (const [zone, dir] of [
      ['ROUTE_211_EAST', 'up'],
      ['ROUTE_207', 'left'],
    ] as const) {
      const wall = find(zone, (b) => b.startsWith('ROCK_CLIMB'));
      const [dx, dz] = DELTA[dir];
      // The wall's end opposite the climbing direction, and the free tile before it.
      const [ex, ez] = wall.find(([x, z]) => !wall.some(([a, b]) => a === x - dx && b === z - dz))!;
      const sx = ex - dx;
      const sz = ez - dz;
      expect(free(zone, sx, sz)).toBe(true);
      const g = run(zone, sx, sz, dir);
      g.world.rockClimb(0);
      g.until(() => g.world.rockClimbDone(), 400);
      const p = g.state.player;
      expect(behaviour(zone, p.x, p.z).startsWith('ROCK_CLIMB')).toBe(false);
      expect(free(zone, p.x, p.z)).toBe(true);
      expect(wall.some(([x, z]) => x === p.x - dx && z === p.z - dz)).toBe(true);
    }
  });

  it('Snowpoint Temple B3F: ice slides until something blocks the way', () => {
    const zone = 'SNOWPOINT_TEMPLE_B3F';
    const ice = find(zone, (b) => b === 'ICE');
    let tried = 0;
    for (const [x, z] of ice) {
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const [dx, dz] = DELTA[dir];
        if (!free(zone, x - dx, z - dz) || behaviour(zone, x - dx, z - dz) === 'ICE' || !free(zone, x, z)) continue;
        if (tried++ > 3) break;
        const g = run(zone, x - dx, z - dz, dir);
        g.until(() => g.state.player.x === x && g.state.player.z === z, 20, [dir]);
        for (let i = 0; i < 200; i++) g.tick();
        // The slide stops off the ice, or on ice where the way ahead is blocked (no objects on this floor).
        let [ex, ez] = [x, z];
        while (behaviour(zone, ex, ez) === 'ICE' && free(zone, ex + dx, ez + dz)) [ex, ez] = [ex + dx, ez + dz];
        expect(g.state.player).toMatchObject({ x: ex, z: ez, facing: dir });
      }
    }
    expect(tried).toBeGreaterThan(0);
  });

  it('Fuego Ironworks: a spin tile carries the player on until blocked', () => {
    const zone = 'FUEGO_IRONWORKS_BUILDING';
    const spins = find(zone, (b) => b.startsWith('SLIDE_'));
    const SLIDE: Record<string, Facing> = { SLIDE_EASTWARD: 'right', SLIDE_WESTWARD: 'left', SLIDE_NORTHWARD: 'up', SLIDE_SOUTHWARD: 'down' };
    const start = spins.find(([x, z]) => {
      const [dx, dz] = DELTA[SLIDE[behaviour(zone, x, z)]!];
      return free(zone, x - dx, z - dz) && !behaviour(zone, x - dx, z - dz).startsWith('SLIDE_');
    })!;
    const dir = SLIDE[behaviour(zone, start[0], start[1])]!;
    const [dx, dz] = DELTA[dir];
    const g = run(zone, start[0] - dx, start[1] - dz, dir);
    g.until(() => g.state.player.x === start[0] && g.state.player.z === start[1] && g.world.idle(), 20, [dir]);
    g.tick();
    expect(g.world.idle()).toBe(false);
    g.until(() => g.world.idle(), 600);
    const p = g.state.player;
    const [fx, fz] = DELTA[p.facing];
    expect(free(zone, p.x + fx, p.z + fz) && !behaviour(zone, p.x + fx, p.z + fz).startsWith('SLIDE_')).toBe(false);
  });

  it('Route 212 South: deep mud holds the player for five direction changes', () => {
    const zone = 'ROUTE_212_SOUTH';
    let start: [number, number, Facing] | null = null;
    for (const [x, z] of find(zone, (b) => b === 'MUD_DEEP'))
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const [dx, dz] = DELTA[dir];
        const b = behaviour(zone, x - dx, z - dz);
        if (!start && free(zone, x, z) && free(zone, x - dx, z - dz) && !b.startsWith('MUD')) start = [x - dx, z - dz, dir];
      }
    const [sx, sz, dir] = start!;
    const g = run(zone, sx, sz, dir, (s) => (s.party = []));
    const [dx, dz] = DELTA[dir];
    g.until(() => g.state.player.x === sx + dx && g.state.player.z === sz + dz && g.world.idle(), 20, [dir]);
    g.tick([dir]);
    g.tick([dir]);
    expect(g.world.idle()).toBe(false);
    const other: Facing[] = dir === 'up' || dir === 'down' ? ['left', 'right'] : ['up', 'down'];
    for (let i = 0; i < 5; i++) g.until(() => g.state.player.facing === other[i % 2], 20, [other[i % 2]!]);
    g.until(() => g.world.idle(), 20);
    expect(g.state.player).toMatchObject({ x: sx + dx, z: sz + dz });
  });

  it('Route 216: deep snow slows walking to WALK_NORMAL and the deeper levels further', () => {
    const zone = 'ROUTE_216';
    const deep = find(zone, (b) => b === 'SNOW_DEEP').find(([x, z]) => free(zone, x, z) && free(zone, x + 1, z) && behaviour(zone, x + 1, z) === 'SNOW_DEEP' && free(zone, x + 2, z))!;
    const g = run(zone, deep[0], deep[1], 'right', (s) => ((s.runningShoes = true), (s.party = [])));
    expect(g.until(() => g.state.player.x === deep[0] + 1 && g.world.idle(), 40, ['right', 'b'])).toBe(8);
  });

  it('Route 207: the bike slope climbs in gear 1 after a run-up and slides back from a standstill', () => {
    const zone = 'ROUTE_207';
    const [x, z] = find(zone, (b) => b === 'BIKE_SLOPE_BOTTOM')[0]!;
    let run_up = 0;
    while (free(zone, x, z + run_up + 1) && run_up < 6) run_up++;
    expect(run_up).toBeGreaterThanOrEqual(4);
    const cycle = (s: GameState) => {
      s.playerState = 'cycle';
      s.cyclingGear = 1;
      s.party = [];
    };
    const g = run(zone, x, z + run_up, 'up', cycle);
    const top = find(zone, (b) => b === 'BIKE_SLOPE_TOP')[0]!;
    g.until(() => g.state.player.z === top[1] - 1 && g.world.idle(), 80, ['up']);
    const s = run(zone, x, z + 1, 'up', cycle);
    s.until(() => s.state.player.z === z, 20, ['up']);
    s.until(() => s.state.player.z === z + 1 && s.world.idle(), 40, ['up']);
    expect(s.state.player.facing).toBe('up');
  });

  it('Oreburgh Gate B1F: the ramp jumps three tiles in gear 1 at full speed; B does not change gear on it', () => {
    const zone = 'OREBURGH_GATE_B1F';
    const [x, z] = find(zone, (b) => b === 'BIKE_RAMP_EASTWARD')[0]!;
    let back = 0;
    while (free(zone, x - back - 1, z) && back < 6) back++;
    expect(back).toBeGreaterThanOrEqual(3);
    const g = run(zone, x - back, z, 'right', (s) => {
      s.playerState = 'cycle';
      s.cyclingGear = 1;
      s.party = [];
    });
    // The Rock Smash rock in the run-up (cp4 smashes it).
    g.world.removeObject(5);
    g.until(() => g.state.player.x === x, 30, ['right']);
    g.tick(['right', 'b']);
    expect(g.state.cyclingGear).toBe(1);
    g.until(() => g.world.idle(), 40);
    expect(g.state.player).toMatchObject({ x: x + 3, z });
    expect(free(zone, x + 3, z)).toBe(true);
  });

  it('Route 210 North: the bike bridge holds the bike to its axis; a walker on the elevated bridge cannot step on it', () => {
    const zone = 'ROUTE_210_NORTH';
    const bridge = find(zone, (b) => b.startsWith('BIKE_BRIDGE_E_W'));
    const [bx, bz] = bridge.find(([x, z]) => behaviour(zone, x - 1, z) === 'BRIDGE_START' && free(zone, x - 2, z))!;
    const g = run(zone, bx - 2, bz, 'right', (s) => {
      s.playerState = 'cycle';
      s.party = [];
    });
    g.until(() => g.state.player.x === bx + 2 && g.world.idle(), 40, ['right']);
    g.tick();
    g.tick(['up']);
    g.tick(['up']);
    expect(g.state.player).toMatchObject({ x: bx + 2, z: bz, facing: 'right' });
    const w = run(zone, bx - 2, bz, 'right', (s) => (s.party = []));
    w.until(() => w.world.idle() && w.state.player.x === bx - 1, 40, ['right']);
    w.tick(['right']);
    w.until(() => w.world.idle(), 40);
    expect(w.state.player.x).toBe(bx - 1);
  });

  it('Oreburgh Gate B1F: a Strength boulder moves only while FLAG_STRENGTH_ACTIVE is set; a warp clears the flag', () => {
    const zone = 'OREBURGH_GATE_B1F';
    const boulders = zoneOf(zone).events.objects.filter((o) => typeof o.sprite === 'string' && reg.sprites.get(o.sprite)?.sourceIndex === 0x54);
    expect(boulders.length).toBeGreaterThan(0);
    let pushed = false;
    for (const o of boulders)
      for (const dir of ['up', 'down', 'left', 'right'] as const) {
        const [dx, dz] = DELTA[dir];
        if (pushed || !free(zone, o.x - dx, o.z - dz) || !free(zone, o.x + dx, o.z + dz)) continue;
        const strength = reg.flags.get(P('FLAG_STRENGTH_ACTIVE'))!;
        expect(strength.sourceIndex).toBe(2402);
        const g = run(zone, o.x - dx, o.z - dz, dir, (s) => (s.party = []));
        for (let i = 0; i < 30; i++) g.tick([dir]);
        for (let i = 0; i < 20; i++) g.tick();
        expect(g.state.objects.find((b) => b.localId === o.localId)).toMatchObject({ x: o.x, z: o.z });
        g.state.flags[strength.id] = true;
        g.tick([dir]);
        g.until(() => g.world.idle(), 40, [dir]);
        expect(g.state.objects.find((b) => b.localId === o.localId)).toMatchObject({ x: o.x + dx, z: o.z + dz });
        g.world.warp(P(`MAP_HEADER_${zone}`), o.x - dx, o.z - dz, dir);
        g.until(() => g.world.warpDone(), 40);
        expect(g.state.flags[strength.id]).toBeUndefined();
        pushed = true;
      }
    expect(pushed).toBe(true);
  });
});
