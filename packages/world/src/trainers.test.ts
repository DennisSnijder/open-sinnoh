import { describe, expect, it } from 'vitest';
import type { Facing } from '@opensinnoh/contracts';
import { f, mon, newState, registries, setup, type Harness } from './testing.ts';

/**
 * ROUTE_E trainers: hiker 0 at 42,10 looking south (sight 4); twins 1+2 at 50,10 / 51,10 (one double
 * trainer, sight 3); camper 3 at 56,20 looking west (sight 3) and picnicker 4 at 53,24 looking north (sight 4).
 */
function route(x: number, z: number, facing: Facing, party = 1, regs = registries, flags: string[] = []) {
  const state = newState('ROUTE_E', x, z, facing);
  for (const fl of flags) state.flags[f(fl)] = true;
  for (let i = 0; i < party; i++) state.party.push(mon('SPECIES_SKYLET', 5));
  const g = setup(state, { regs });
  g.scripts.hold = true;
  g.tick();
  return g;
}
const obj = (g: Harness, id: number) => g.state.objects.find((o) => o.localId === id)!;

/** Runs the approaches the script would start, returning the ticks until trainerApproachDone. */
function approach(g: Harness, ids: number[]): number {
  for (const id of ids) g.world.trainerApproach(id);
  let ticks = 0;
  while (!g.world.trainerApproachDone()) {
    g.tick();
    ticks++;
    if (ticks > 500) throw new Error('approach never finished');
  }
  return ticks;
}

describe('trainer sight (decomp src/trainer_encounter.c)', () => {
  it('a trainer spots the player who steps into its line of sight and starts the approach script', () => {
    const g = route(42, 15, 'up');
    expect(g.scripts.starts).toEqual([]);
    g.hold(['up'], 8);
    g.tick();
    expect(g.scripts.starts).toEqual([
      { label: f('Battles_ApproachingTrainer'), zone: f('ROUTE_E'), source: 'trainer', trainer: { localIds: [0], trainers: [f('TRAINER_HIKER')], sightType: 0 } },
    ]);
  });

  it('the approach: face, "!" for 30 ticks, walk to the adjacent tile, 8 ticks, turn the player; then movement type NONE', () => {
    const g = route(42, 14, 'left');
    g.tick();
    expect(g.scripts.starts).toHaveLength(1);
    let emoteTicks = 0;
    g.world.trainerApproach(0);
    let ticks = 0;
    while (!g.world.trainerApproachDone()) {
      g.tick();
      ticks++;
      if (g.world.view().actors.find((a) => a.localId === 0)!.emote) emoteTicks++;
    }
    expect(emoteTicks).toBe(29);
    // 1 (face) + 30 ("!") + 3 × 8 (walk) + 8 (pause) + 1 (player turn) + 1 (done).
    expect(ticks).toBe(1 + 30 + 24 + 8 + 1 + 1);
    expect(obj(g, 0)).toMatchObject({ x: 42, z: 13, facing: 'down', movementType: 0 });
    expect(g.state.player.facing).toBe('up');
  });

  it('no sighting when the trainer flag is set, out of range, off the line, or the line is blocked', () => {
    expect(route(42, 14, 'up', 1, registries, ['FLAG_TRAINER_HIKER']).scripts.starts).toEqual([]);
    expect(route(42, 15, 'up').scripts.starts).toEqual([]);
    expect(route(43, 13, 'up').scripts.starts).toEqual([]);
    const regs = structuredClone(registries);
    const chunk = regs.chunks.get(f('CHUNK_ROUTE_EAST'))!;
    chunk.tiles[10 + 12 * 32] = 0x8000;
    expect(route(42, 14, 'up', 1, regs).scripts.starts).toEqual([]);
  });

  it('a double trainer needs two Pokémon that can fight, or the walking partner (decomp Party_HasTwoAliveMons, SystemFlag_CheckHasPartner)', () => {
    const at = (edit: (state: ReturnType<typeof newState>) => void) => {
      const state = newState('ROUTE_E', 50, 13, 'up');
      state.party.push(mon('SPECIES_SKYLET', 5), mon('SPECIES_SKYLET', 5));
      edit(state);
      const g = setup(state);
      g.scripts.hold = true;
      g.tick();
      return g.scripts.starts.map((st) => st.trainer?.sightType);
    };
    expect(at(() => {})).toEqual([1]);
    expect(at((st) => (st.party[1]!.hp = 0))).toEqual([]);
    expect(at((st) => (st.party[1]!.isEgg = true))).toEqual([]);
    expect(
      at((st) => {
        st.party.pop();
        st.hasPartner = true;
      }),
    ).toEqual([1]);
  });

  it('a double trainer needs two Pokémon; its partner walks the same way as the one that saw the player', () => {
    expect(route(50, 13, 'up', 1).scripts.starts).toEqual([]);
    const g = route(50, 13, 'up', 2);
    expect(g.scripts.starts[0]!.trainer).toEqual({ localIds: [1, 2], trainers: [f('TRAINER_TWINS'), f('TRAINER_TWINS')], sightType: 1 });
    approach(g, [1, 2]);
    expect(obj(g, 1)).toMatchObject({ x: 50, z: 12 });
    expect(obj(g, 2)).toMatchObject({ x: 51, z: 12 });
  });

  it('two singles in sight with two Pokémon: both approach (sight type 2), the first found first', () => {
    const g = route(52, 20, 'right', 2);
    g.hold(['right'], 8);
    g.tick();
    expect(g.scripts.starts[0]!.trainer).toEqual({ localIds: [3, 4], trainers: [f('TRAINER_CAMPER'), f('TRAINER_PICNICKER')], sightType: 2 });
    approach(g, [3]);
    expect(obj(g, 3)).toMatchObject({ x: 54, z: 20 });
    expect(g.state.player.facing).toBe('right');
    approach(g, [4]);
    expect(obj(g, 4)).toMatchObject({ x: 53, z: 21 });
    expect(g.state.player.facing).toBe('down');
    // With one Pokémon only the camper (first in object order) battles.
    const h = route(52, 20, 'right', 1);
    h.hold(['right'], 8);
    h.tick();
    expect(h.scripts.starts[0]!.trainer).toEqual({ localIds: [3], trainers: [f('TRAINER_CAMPER')], sightType: 0 });
  });

  it('a finished approach does not hold its trainer: a script may remove it afterwards (LakeVerity_Mars)', () => {
    const g = route(42, 14, 'left');
    g.tick();
    approach(g, [0]);
    g.world.removeObject(0);
    expect(() => g.tick()).not.toThrow();
  });

  it('trainerApproach needs a sighting', () => {
    const g = route(34, 16, 'up');
    expect(() => g.world.trainerApproach(0)).toThrow(/spotted/);
    expect(g.world.trainerApproachDone()).toBe(true);
  });
});

describe('destroyObstacle', () => {
  const effect = (g: Harness) => g.world.view().effects.find((e) => e.effect === f('FLDEFF_CUT') || e.effect === f('FLDEFF_ROCK_SMASH'));

  it('plays Cut on the tile the player faces and completes after 45 ticks', () => {
    const g = route(34, 16, 'up');
    g.world.destroyObstacle(0);
    expect(g.world.destroyObstacleDone()).toBe(false);
    g.tick();
    const e = effect(g)!;
    expect(e).toMatchObject({ effect: f('FLDEFF_CUT'), anim: 'cut', tick: 1 });
    expect([e.cur[0], e.cur[2]]).toEqual([34 * 16 + 8, 15 * 16 + 8]);
    g.hold([], 43);
    expect(g.world.destroyObstacleDone()).toBe(false);
    expect(effect(g)?.tick).toBe(44);
    g.tick();
    expect(g.world.destroyObstacleDone()).toBe(true);
    expect(effect(g)).toBeUndefined();
  });

  it('plays Rock Smash for obstacle 1 in front of the player, and for 2 in front of local object 0', () => {
    const g = route(34, 16, 'left');
    g.world.destroyObstacle(1);
    g.tick();
    expect(effect(g)).toMatchObject({ effect: f('FLDEFF_ROCK_SMASH'), anim: 'smash' });
    expect([effect(g)!.cur[0], effect(g)!.cur[2]]).toEqual([33 * 16 + 8, 16 * 16 + 8]);
    g.hold([], 45);
    // The hiker (local id 0) stands at 42,10 looking south.
    g.world.destroyObstacle(2);
    g.tick();
    expect([effect(g)!.cur[0], effect(g)!.cur[2]]).toEqual([42 * 16 + 8, 11 * 16 + 8]);
    expect(() => g.world.destroyObstacle(3)).toThrow(/0–2/);
  });
});
