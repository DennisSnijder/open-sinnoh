import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import type { Facing, ObjectEvent, Registries } from '@opensinnoh/contracts';
import { f, mon, newState, registries, setup, type Harness } from './testing.ts';
import { parseAction } from './movement.ts';

/** ROUTE_E (an open field, x 32–62, z 1–30) with only these objects; the player stands at 34,16. */
function withObjects(objects: Partial<ObjectEvent>[], regs: Registries = structuredClone(registries)): Registries {
  const zone = regs.zones.get(f('ROUTE_E'))!;
  zone.events.objects = [];
  for (const o of objects) {
    zone.events.objects.push({
      localId: 20,
      sprite: f('SPRITE_GUIDE'),
      movementType: 0,
      trainerType: 0,
      facing: 'down',
      data: [0, 0, 0],
      range: { x: 0, z: 0 },
      x: 44,
      z: 20,
      y: 0,
      ...o,
    } as ObjectEvent);
  }
  return regs;
}
const route = (regs: Registries, x = 34, z = 16, facing: Facing = 'up') => setup(newState('ROUTE_E', x, z, facing), { regs });
const obj = (g: Harness, id: number) => g.state.objects.find((o) => o.localId === id)!;
const actor = (g: Harness, id: number) => g.world.view().actors.find((a) => a.localId === id)!;

/** The tiles an object visits (each new tile once per arrival) over `ticks`, from its tile now (the setup's fade-in already ran its first step). */
function path(g: Harness, id: number, ticks: number): string[] {
  const seen: string[] = [`${obj(g, id).x},${obj(g, id).z}`];
  for (let i = 0; i < ticks; i++) {
    g.tick();
    const o = obj(g, id);
    const key = `${o.x},${o.z}`;
    if (seen[seen.length - 1] !== key) seen.push(key);
  }
  return seen;
}

describe('walk loops 21–44 (decomp sub_02064EEC, sub_020651A4)', () => {
  it('type 21 (N, E, W, S; leg 2 ends on the origin x) walks out to the range and back to its origin', () => {
    const g = route(withObjects([{ movementType: 21, range: { x: 2, z: 2 } }]));
    expect(path(g, 20, 8 * 8)).toEqual(['44,19', '44,18', '45,18', '46,18', '45,18', '44,18', '44,19', '44,20', '44,19']);
    expect(g.world.idle()).toBe(true);
  });

  it('type 44 (E, S, W, N; family 37–44) traces its rectangle: east and south to the range, west to the origin x, north home', () => {
    const g = route(withObjects([{ movementType: 44, range: { x: 1, z: 1 } }]));
    expect(path(g, 20, 4 * 8)).toEqual(['45,20', '45,21', '44,21', '44,20', '45,20']);
    expect(obj(g, 20).facing).toBe('right');
  });

  it('a blocked step walks on the spot and keeps the leg', () => {
    const regs = withObjects([
      { movementType: 21, range: { x: 2, z: 2 } },
      { localId: 21, x: 44, z: 19 },
    ]);
    const g = route(regs);
    for (let i = 0; i < 40; i++) g.tick();
    expect(obj(g, 20)).toMatchObject({ x: 44, z: 20, facing: 'up' });
  });

  it('a spin trainer (trainer type 7) turns a quarter each step instead of facing it (sub_02065568)', () => {
    const g = route(withObjects([{ movementType: 44, trainerType: 7, facing: 'up', range: { x: 1, z: 1 } }]));
    const facings: Facing[] = [];
    // The setup's fade-in ran the first step (east, now facing west).
    facings.push(obj(g, 20).facing);
    for (let i = 0; i < 4 * 8; i++) {
      g.tick();
      if (i % 8 === 7) facings.push(obj(g, 20).facing);
    }
    expect(facings).toEqual(['left', 'down', 'right', 'up', 'left']);
    expect(obj(g, 20)).toMatchObject({ x: 45, z: 20 });
  });

  it('every type Platinum places (21, 24, 28, 29, 36, 37–44) stays within its range and comes back to its origin', () => {
    // The other route lists (22, 23, 25–27, 30–35) walk off their last leg (the DS reads past the list).
    for (const type of [21, 24, 28, 29, 36, 37, 38, 39, 40, 41, 42, 43, 44]) {
      const g = route(withObjects([{ movementType: type, range: { x: 2, z: 3 } }]));
      let home = 0;
      for (let i = 0; i < 400; i++) {
        g.tick();
        const o = obj(g, 20);
        expect(Math.abs(o.x - 44)).toBeLessThanOrEqual(2);
        expect(Math.abs(o.z - 20)).toBeLessThanOrEqual(3);
        if (o.x === 44 && o.z === 20) home++;
      }
      expect(home, `type ${type}`).toBeGreaterThan(8);
      expect(g.stubs.filter((s) => s.startsWith('movement-type:'))).toEqual([]);
    }
  });
});

describe('FOLLOW_PARTNER_TRAINER 50 (decomp sub_02069E1C)', () => {
  it('steps into the tile its double-battle partner leaves', () => {
    const trainer = { id: f('TRAINER_TWINS') as Id, battler: 0 as const };
    const regs = withObjects([
      { localId: 20, movementType: 44, range: { x: 1, z: 1 }, trainer },
      { localId: 21, movementType: 50, x: 43, z: 20, trainer: { ...trainer, battler: 1 } },
    ]);
    const g = route(regs);
    const trail: string[] = [`${obj(g, 20).x},${obj(g, 20).z}|${obj(g, 21).x},${obj(g, 21).z}`];
    for (let i = 0; i < 4 * 8; i++) {
      g.tick();
      if (i % 8 === 7) trail.push(`${obj(g, 20).x},${obj(g, 20).z}|${obj(g, 21).x},${obj(g, 21).z}`);
    }
    expect(trail).toEqual(['45,20|44,20', '45,21|45,20', '44,21|45,21', '44,20|44,21', '45,20|44,20']);
  });
});

describe('disguises 51–54 and reveal_trainer (decomp sub_0206A0BC, MovementAction_RevealTrainer)', () => {
  const disguised = (movementType = 53) =>
    withObjects([{ localId: 20, movementType, trainerType: 2, data: [3, 0, 0], x: 44, z: 12, trainer: { id: f('TRAINER_HIKER'), battler: 0 } }]);

  it('a disguised trainer sits 32 units down until it hops out; it then approaches the player', () => {
    const state = newState('ROUTE_E', 44, 16, 'up');
    state.party.push(mon('SPECIES_SKYLET', 5));
    const g = setup(state, { regs: disguised() });
    g.scripts.hold = true;
    const ground = () => g.world.view().actors.find((a) => a.localId === 255)!.cur[1];
    expect(actor(g, 20).cur[1]).toBe(ground() - 32);
    g.hold(['up'], 8);
    g.tick();
    expect(g.scripts.starts.map((s) => s.source)).toEqual(['trainer']);
    g.world.trainerApproach(20);
    let ticks = 0;
    const heights: number[] = [];
    while (!g.world.trainerApproachDone()) {
      g.tick();
      heights.push(actor(g, 20).cur[1] - ground());
      expect(actor(g, 20).emote).toBe(false);
      if (++ticks > 300) throw new Error('approach never finished');
    }
    // Reveal (8 ticks of hop) + 30 + walk 2 × 8 + 8 + player turn + done.
    expect(ticks).toBe(8 + 30 + 16 + 8 + 1 + 1);
    expect(Math.max(...heights.slice(0, 8))).toBeGreaterThan(0);
    expect(heights.slice(8)).toEqual(heights.slice(8).map(() => 0));
    expect(obj(g, 20)).toMatchObject({ x: 44, z: 14, movementType: 0 });
  });

  it('types 51–54 are known; a disguise does not move or turn by itself', () => {
    for (const type of [51, 52, 53, 54]) {
      const g = route(disguised(type));
      for (let i = 0; i < 200; i++) g.tick();
      expect(obj(g, 20)).toMatchObject({ x: 44, z: 12, facing: 'down' });
      expect(g.stubs).toEqual([]);
    }
  });
});

describe('VS_SEEKER_SPIN 49 (decomp sub_02064AFC)', () => {
  it('turns a quarter every 25 ticks, reversing each time it is back at its initial facing', () => {
    const g = route(withObjects([{ movementType: 49, facing: 'up' }]));
    const facings: Facing[] = [];
    for (let i = 0; i < 25 * 8; i++) {
      g.tick();
      const fc = obj(g, 20).facing;
      if (facings[facings.length - 1] !== fc) facings.push(fc);
    }
    expect(facings).toEqual(['up', 'right', 'down', 'left', 'up', 'left', 'down', 'right', 'up']);
  });
});

describe('further movement actions (decomp unk_020655F4.c)', () => {
  const run = (steps: { op: string; count: number }[]) => {
    const regs = withObjects([{ localId: 20 }]);
    const mv = { id: f('MV_W2'), steps };
    (regs.movements as Map<Id, typeof mv>).set(mv.id, mv);
    const g = route(regs);
    g.world.applyMovement(20, mv.id);
    return g;
  };

  it('parses every action the scripts use, the Distortion World ones included', () => {
    for (const op of ['warp_out', 'warp_in', 'pause_animation', 'resume_animation', 'walk_slightly_fast_north', 'walk_slightly_faster_west', 'reveal_trainer', '106', '107', '153', 'jump_distortion_world_north']) {
      expect(parseAction(op), op).not.toBeNull();
    }
    // sub_02066968 / sub_02066998: one tile down (−y) facing right, one tile +z facing down, 8 frames each.
    expect(parseAction('106')).toEqual({ kind: 'walk3d', d: [0, -1, 0], face: 'right', ticks: 8, anim: 'walk' });
    expect(parseAction('107')).toEqual({ kind: 'walk3d', d: [0, 0, 1], face: 'down', ticks: 8, anim: 'walk' });
    expect(parseAction('jump_distortion_world_north')).toEqual({ kind: 'hop', dir: 'up', tiles: 3, ticks: 24, rate: 0xa0, sound: 0 });
    expect(parseAction('133')).toBeNull();
  });

  it('warp_out lifts the sprite 16 units a tick to 320 (20 ticks) and leaves it there', () => {
    const g = run([{ op: 'warp_out', count: 1 }]);
    const base = actor(g, 20).cur[1];
    let ticks = 0;
    while (!g.world.movementDone(20)) {
      g.tick();
      ticks++;
    }
    expect(ticks).toBe(20);
    expect(actor(g, 20).cur[1] - base).toBe(320);
  });

  it('walk_slightly_fast_north takes 6 ticks per tile; 153 is a 30-tick "!"', () => {
    const g = run([{ op: 'walk_slightly_fast_north', count: 2 }, { op: '153', count: 1 }]);
    let ticks = 0;
    let emote = 0;
    while (!g.world.movementDone(20)) {
      g.tick();
      ticks++;
      if (actor(g, 20).emote) emote++;
    }
    expect(ticks).toBe(12 + 30);
    expect(emote).toBe(29);
    expect(obj(g, 20)).toMatchObject({ x: 44, z: 18 });
  });

  it('pause_animation holds the walk frame until resume_animation', () => {
    const g = run([{ op: 'pause_animation', count: 1 }, { op: 'walk_normal_west', count: 2 }, { op: 'resume_animation', count: 1 }, { op: 'walk_normal_west', count: 1 }]);
    const ticks: number[] = [];
    while (!g.world.movementDone(20)) {
      g.tick();
      if (actor(g, 20).anim === 'walk') ticks.push(actor(g, 20).animTick);
    }
    // Two paused walks hold frame 0 (7 walking ticks each are seen; the 8th ends the step), then it animates.
    expect(ticks).toEqual([...Array<number>(14).fill(0), 1, 2, 3, 4, 5, 6, 7]);
    expect(obj(g, 20)).toMatchObject({ x: 41, z: 20 });
  });
});
