import { fixtureAudio } from '../fixtures/audio.ts';
/**
 * World systems on the real Platinum data (OPENSINNOH_NDS_ROM): trainer sight on Route 202, a ledge jump,
 * wild encounters in grass, tile-behaviour scripts, and a zone connection between two areas. The VM is
 * a fake that records script starts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, type Button, type Id } from '@opensinnoh/core';
import { setupPokemon, type BattleSetup, type Facing, type GameState, type InputFrame, type Registries, type ScriptRunner, type ScriptStart } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { romSlice } from '../rom.ts';
import { createWorld, isSurfable } from '@opensinnoh/world';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (name: string) => `platinum:${name}` as Id;

describe.skipIf(!romPath)('World on Platinum data (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let labels: ReadonlySet<Id>;
  let base: () => GameState;

  beforeAll(async () => {
    const { pack } = romSlice();
    const packs = loadGamePacks([pack]);
    reg = packs.registries;
    labels = new Set(packs.labels.keys());
    base = () => newGameState([...reg.newGame.values()][0]!, reg, packs.loaded.order, 1);
  }, 120_000);

  function run(zone: string, x: number, z: number, facing: Facing, edit: (s: GameState) => void = () => {}) {
    const state = base();
    state.player = { zone: P(zone), x, z, y: 0, facing };
    state.party = [setupPokemon(state, reg, 0, P('SPECIES_PIPLUP'), 5)];
    edit(state);
    const starts: ScriptStart[] = [];
    const battles: BattleSetup[] = [];
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
    const world = createWorld({ audio: fixtureAudio(reg, state), registries: reg, state, scripts, log: { stub: (k) => void stubs.push(k) }, battleLog: () => {}, battles: { start: (b) => void battles.push(b), done: () => null, blackOut: () => {} }, clock: () => DEFAULT_CLOCK });
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
    return { world, state, starts, battles, stubs, tick };
  }

  it('Route 204 has one drawn instance per NPC or sign, including neighbouring previews', () => {
    for (const name of ['MAP_HEADER_ROUTE_204_SOUTH', 'MAP_HEADER_ROUTE_204_NORTH']) {
      const zone = reg.zones.get(P(name))!;
      // An unscripted border stand-in and its scripted source may use different native local ids.
      const objects = zone.events.objects;
      const spawn = objects.find(o => o.label && !o.cloneOf)!;
      const { world } = run(name, spawn.x + 1, spawn.z, 'left');
      const view = world.view();
      const drawn = [...view.actors.filter(a => a.home), ...view.previews];
      const tiles = drawn.map(a => `${a.sprite}:${Math.round(a.cur[0] / 16)}:${Math.round(a.cur[2] / 16)}`);
      expect(new Set(tiles).size, `${name}: live actors and previews must not double an NPC`).toBe(tiles.length);
    }
  });

  /** Tile word at a matrix tile (bit 15 blocked, bits 0–7 behaviour). */
  function tile(matrix: Id, x: number, z: number): number | null {
    const m = reg.matrices.get(matrix)!;
    if (x < 0 || z < 0 || x >= m.width * 32 || z >= m.height * 32) return null;
    const chunk = m.chunks[Math.floor(x / 32) + Math.floor(z / 32) * m.width];
    return chunk ? reg.chunks.get(chunk)!.tiles[(x % 32) + (z % 32) * 32]! : null;
  }
  const behaviour = (name: string) => [...reg.tileBehaviors.values()].find((b) => b.name === name)!.sourceIndex;
  const free = (matrix: Id, x: number, z: number) => {
    const t = tile(matrix, x, z);
    return t !== null && (t & 0x8000) === 0;
  };
  /** Free and not water (a walking player bumps into water). */
  const land = (matrix: Id, x: number, z: number) => free(matrix, x, z) && !isSurfable([...reg.tileBehaviors.values()].find((b) => b.sourceIndex === (tile(matrix, x, z)! & 0xff))!.name);
  /** Tiles of a zone's cells in its matrix, row by row. */
  function* zoneTiles(zone: Id): Generator<[number, number]> {
    const m = reg.matrices.get(reg.zones.get(zone)!.matrix)!;
    for (let z = 0; z < m.height * 32; z++)
      for (let x = 0; x < m.width * 32; x++) if (m.zones?.[Math.floor(x / 32) + Math.floor(z / 32) * m.width] === zone) yield [x, z];
  }
  const trainerFlags = (s: GameState) => {
    for (const fl of reg.flags.values()) if ((fl.sourceIndex ?? 0) > 0x550 && (fl.sourceIndex ?? 0) < 0x8f0) s.flags[fl.id] = true;
  };

  it('trainer objects name a trainer with a flag; newGame names the approach script; behaviour scripts exist', () => {
    const ng = [...reg.newGame.values()][0]!;
    expect(ng.trainerApproach).toBe(P('scripts_battles/928'));
    expect(labels.has(ng.trainerApproach!)).toBe(true);
    let trainers = 0;
    const flagIndexes = new Set([...reg.flags.values()].map((fl) => fl.sourceIndex));
    for (const zone of reg.zones.values())
      for (const o of zone.events.objects) {
        if (!o.trainer) continue;
        trainers++;
        const t = reg.trainers.get(o.trainer.id)!;
        expect(t).toBeDefined();
        expect(flagIndexes.has(0x550 + t.sourceIndex!)).toBe(true);
      }
    expect(trainers).toBeGreaterThan(400);
    const interact = [...reg.tileBehaviors.values()].filter((b) => b.interact);
    expect(interact.map((b) => b.name).sort()).toEqual(
      ['BOOKSHELF_1', 'BOOKSHELF_2', 'MART_SHELF_1', 'MART_SHELF_2', 'MART_SHELF_3', 'PC', 'SMALL_BOOKSHELF_1', 'SMALL_BOOKSHELF_2', 'TOWN_MAP', 'TRASH_CAN', 'TV'].sort(),
    );
    for (const b of interact) expect(labels.has(b.interact!.label)).toBe(true);
  });

  it('a Route 202 trainer spots the player two tiles ahead, approaches, and ignores them once defeated', () => {
    const zone = reg.zones.get(P('MAP_HEADER_ROUTE_202'))!;
    const ev = zone.events.objects.find((o) => o.trainer && o.trainerType === 1)!;
    expect(ev).toMatchObject({ facing: 'down' });
    const g = run('MAP_HEADER_ROUTE_202', ev.x, ev.z + 2, 'up');
    expect(g.starts[0]).toMatchObject({ label: P('scripts_battles/928'), source: 'trainer', trainer: { localIds: [ev.localId], trainers: [ev.trainer!.id], sightType: 0 } });
    g.world.trainerApproach(ev.localId);
    for (let i = 0; i < 200 && !g.world.trainerApproachDone(); i++) g.tick();
    expect(g.world.trainerApproachDone()).toBe(true);
    expect(g.state.objects.find((o) => o.localId === ev.localId)).toMatchObject({ x: ev.x, z: ev.z + 1, movementType: 0 });
    const flag = [...reg.flags.values()].find((fl) => fl.sourceIndex === 0x550 + reg.trainers.get(ev.trainer!.id)!.sourceIndex!)!;
    expect(run('MAP_HEADER_ROUTE_202', ev.x, ev.z + 2, 'up', (s) => (s.flags[flag.id] = true)).starts).toEqual([]);
  });

  it('a ledge on Route 202 jumps the player two tiles', () => {
    const zone = P('MAP_HEADER_ROUTE_202');
    const matrix = reg.zones.get(zone)!.matrix;
    const south = behaviour('JUMP_SOUTH');
    const at = [...zoneTiles(zone)].find(([x, z]) => ((tile(matrix, x, z) ?? 0) & 0xff) === south && free(matrix, x, z - 1) && free(matrix, x, z + 1));
    expect(at).toBeDefined();
    const [x, z] = at!;
    const g = run('MAP_HEADER_ROUTE_202', x, z - 1, 'down', trainerFlags);
    for (let i = 0; i < 16; i++) g.tick(['down']);
    expect(g.state.player).toMatchObject({ x, z: z + 1 });
  });

  it('walking in Route 202 grass meets wild Pokémon from its table (battles on grass terrain, plain backdrop)', () => {
    const zone = P('MAP_HEADER_ROUTE_202');
    const matrix = reg.zones.get(zone)!.matrix;
    const grass = behaviour('TALL_GRASS');
    const isGrass = (x: number, z: number) => free(matrix, x, z) && ((tile(matrix, x, z) ?? 0) & 0xff) === grass;
    const at = [...zoneTiles(zone)].find(([x, z]) => isGrass(x, z) && isGrass(x + 1, z));
    expect(at).toBeDefined();
    const [x, z] = at!;
    const g = run('MAP_HEADER_ROUTE_202', x, z, 'right', trainerFlags);
    const table = reg.encounters.get(reg.zones.get(zone)!.encounters!)!;
    const species = new Set([...table.land.map((s) => s.species), ...(table.variants['day'] ?? []).map((v) => v.species)]);
    for (let i = 0; i < 4000; i++) g.tick([g.state.player.x === x ? 'right' : 'left']);
    expect(g.battles.length).toBeGreaterThan(3);
    for (const b of g.battles) {
      expect(b).toMatchObject({ kind: 'wild', background: P('BACKGROUND_PLAIN'), terrain: P('TERRAIN_GRASS'), time: 'day' });
      expect(species.has(b.wild[0]!.species)).toBe(true);
    }
  });

  it('crossing between overworld zones of different areas switches the zone but keeps the area of the last load', () => {
    const m = reg.matrices.get(P('matrix/0'))!;
    const zoneAt = (x: number, z: number) => m.zones?.[Math.floor(x / 32) + Math.floor(z / 32) * m.width] ?? null;
    let seam: [number, number] | null = null;
    for (let z = 0; z < m.height * 32 && !seam; z++)
      for (let x = 0; x < m.width * 32 - 1 && !seam; x++) {
        const a = zoneAt(x, z);
        const b = zoneAt(x + 1, z);
        if (a && b && a !== b && reg.zones.get(a)!.area !== reg.zones.get(b)!.area && free(m.id, x, z) && free(m.id, x + 1, z)) seam = [x, z];
      }
    expect(seam).not.toBeNull();
    const [x, z] = seam!;
    const from = zoneAt(x, z)!;
    const to = zoneAt(x + 1, z)!;
    // The first such seam in the sliced import is open sea (Route 222 → Sunyshore): cross it surfing.
    const water = !land(m.id, x + 1, z);
    const g = run(from.slice('platinum:'.length), x, z, 'right', (s) => {
      trainerFlags(s);
      if (water) s.playerState = 'surf';
    });
    g.tick(['right']);
    expect(g.state.player).toMatchObject({ zone: to, x: x + 1 });
    expect(g.world.view()).toMatchObject({ zone: to, area: reg.zones.get(from)!.area });
    for (const o of g.state.objects) expect(o.zone).toBe(to);
  });
});
