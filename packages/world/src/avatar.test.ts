/**
 * Terrain and HMs on the fixture TERRAIN zone (layout: tools/fixtures/build-fixture-pack.ts `terrainTiles`).
 * Timings are the decomp movement actions (player_move.c, ov5_021DFB54.c) in 30 Hz ticks.
 */
import { describe, expect, it } from 'vitest';
import { RECORD_STEPS, type Button } from '@opensinnoh/core';
import type { Facing, GameState } from '@opensinnoh/contracts';
import { f, mon, newState, pos, setup, type Harness } from './testing.ts';
import { HM_CUT_IN_TICKS } from './avatar.ts';

const SURFER = mon('SPECIES_DRIPLING', 20, ['MOVE_SURF', 'MOVE_WATERFALL', 'MOVE_ROCK_CLIMB']);

function terrain(x: number, z: number, facing: Facing, edit: (s: GameState) => void = () => {}) {
  const s = newState('TERRAIN', x, z, facing);
  s.party = [SURFER];
  s.badges = [f('BADGE_ID_FEN')];
  edit(s);
  return setup(s);
}

/** Ticks until `done` (fails after `max`). */
function until(g: Harness, done: () => boolean, max = 400, held: Button[] = []): number {
  for (let i = 1; i <= max; i++) {
    g.tick(held);
    if (done()) return i;
  }
  throw new Error('condition not reached');
}

const effects = (g: Harness) => g.world.view().effects.map((e) => ({ effect: e.effect, anim: e.anim }));

describe('surfing (FieldTask_StartUseSurf, PlayerAvatar_SetMovement_Normal)', () => {
  it('A facing water starts the Surf script only with the Fen Badge and a party Pokémon that knows Surf', () => {
    const g = terrain(10, 5, 'left');
    g.tick(['a']);
    expect(g.scripts.starts.map((s) => s.label)).toEqual([f('FieldMoves_Surf')]);
    const noBadge = terrain(10, 5, 'left', (s) => (s.badges = []));
    noBadge.tick(['a']);
    expect(noBadge.scripts.starts).toEqual([]);
    const noMove = terrain(10, 5, 'left', (s) => (s.party = [mon('SPECIES_SKYLET', 5)]));
    noMove.tick(['a']);
    expect(noMove.scripts.starts).toEqual([]);
  });

  it('walking into water bumps; surf mounts after the cut-in with a jump, shows the blob and moves 4 ticks a tile', () => {
    const g = terrain(10, 5, 'left');
    g.hold(['left'], 16);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 10, 5, 'left']);
    g.tick();
    g.world.surf(0);
    expect(g.world.surfDone()).toBe(false);
    expect(until(g, () => g.world.surfDone())).toBe(HM_CUT_IN_TICKS + 8);
    expect(g.state.playerState).toBe('surf');
    expect(pos(g.state)).toEqual([f('TERRAIN'), 9, 5, 'left']);
    expect(effects(g)).toEqual([{ effect: f('FLDEFF_SURF_MOUNT'), anim: 'mount' }]);
    g.hold(['left'], 4);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 8, 5, 'left']);
    expect(g.world.view().effects[0]!.cur).toEqual(g.world.view().actors[0]!.cur);
    // Back to the shore (still moving: no turn), then the dismount jump; walking again without the blob.
    g.hold(['right'], 4);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 9, 5, 'right']);
    g.tick(['right']);
    // The task sets the jump next frame (8 ticks) and ends the frame after it lands.
    expect(until(g, () => g.world.idle())).toBe(9);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 10, 5, 'right']);
    expect(g.state.playerState).toBe('walk');
    expect(g.world.view().effects).toEqual([]);
  });

  it('a surfing save restores the blob and the surf movement', () => {
    const g = terrain(6, 5, 'left', (s) => (s.playerState = 'surf'));
    expect(effects(g)).toEqual([{ effect: f('FLDEFF_SURF_MOUNT'), anim: 'mount' }]);
    g.hold(['left'], 4);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 5, 5, 'left']);
  });

  it('the bridge has two layers: walked over from its BRIDGE_START, surfed under from the water', () => {
    const walker = terrain(11, 7, 'left');
    walker.hold(['left'], 8 * 10);
    expect(pos(walker.state)).toEqual([f('TERRAIN'), 1, 7, 'left']);
    const shore = terrain(10, 8, 'left');
    shore.hold(['left'], 16);
    expect(pos(shore.state)).toEqual([f('TERRAIN'), 10, 8, 'left']);
    const surfer = terrain(5, 9, 'up', (s) => (s.playerState = 'surf'));
    surfer.hold(['up'], 4 * 3);
    expect(pos(surfer.state)).toEqual([f('TERRAIN'), 5, 6, 'up']);
    // PlayerAvatar_IncrementStepsRecord: walked and surfed steps count; the shore's bumps do not.
    expect(walker.state.records.counts[RECORD_STEPS]).toBe(10);
    expect(shore.state.records.counts[RECORD_STEPS]).toBeUndefined();
    expect(surfer.state.records.counts[RECORD_STEPS]).toBe(3);
  });

  it('surfing rolls the surf table on the encounter rng', () => {
    const g = terrain(6, 5, 'left', (s) => (s.playerState = 'surf'));
    for (let i = 0; i < 40; i++) g.hold([i % 8 < 4 ? 'left' : 'right'], 4);
    expect(g.battles.length).toBeGreaterThan(0);
    for (const b of g.battles) expect([f('SPECIES_DRIPLING'), f('SPECIES_SKYLET')]).toContain(b.wild[0]!.species);
  });
});

describe('waterfall and rock climb', () => {
  it('A facing the waterfall starts its script; use_waterfall climbs two tiles in 96 ticks after the cut-in', () => {
    const g = terrain(5, 4, 'up', (s) => (s.playerState = 'surf'));
    g.tick(['a']);
    expect(g.scripts.starts.map((s) => s.label)).toEqual([f('FieldMoves_Waterfall')]);
    g.tick();
    g.world.waterfall(0);
    expect(until(g, () => g.world.waterfallDone())).toBe(HM_CUT_IN_TICKS + 96);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 5, 2, 'up']);
    expect(g.world.idle()).toBe(true);
  });

  it('surfing down into a waterfall with Waterfall in the party descends without a cut-in', () => {
    const g = terrain(5, 2, 'down', (s) => (s.playerState = 'surf'));
    g.tick(['down']);
    expect(g.world.idle()).toBe(false);
    expect(until(g, () => g.world.idle())).toBe(96);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 5, 4, 'down']);
  });

  it('use_rock_climb hops on, climbs the wall at WALK_FAST and hops off past its end', () => {
    const g = terrain(20, 17, 'up');
    g.tick(['a']);
    expect(g.scripts.starts.map((s) => s.label)).toEqual([f('FieldMoves_RockClimb')]);
    g.tick();
    g.world.rockClimb(0);
    expect(until(g, () => g.world.rockClimbDone())).toBe(HM_CUT_IN_TICKS + 8 + 4 + 4 + 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 20, 13, 'up']);
    expect(g.world.view().effects).toEqual([]);
  });
});

describe('Strength (FLAG_STRENGTH_ACTIVE, ov5_021DFF1C)', () => {
  const boulder = (g: Harness) => g.state.objects.find((o) => o.localId === 0)!;

  it('pushes the boulder only while the flag is set, until something blocks it', () => {
    const g = terrain(11, 13, 'right');
    g.hold(['right'], 20);
    expect(boulder(g)).toMatchObject({ x: 12, z: 13 });
    g.hold([], 16);
    g.state.flags[f('FLAG_STRENGTH_ACTIVE')] = true;
    g.tick(['right']);
    // The boulder walks WALK_SLOW (16) from the next frame; the task ends the frame after.
    expect(until(g, () => g.world.idle(), 40, ['right'])).toBe(17);
    expect(boulder(g)).toMatchObject({ x: 13, z: 13 });
    expect(pos(g.state)).toEqual([f('TERRAIN'), 11, 13, 'right']);
    g.tick();
    g.hold(['right'], 16 + 8);
    expect(boulder(g)).toMatchObject({ x: 14, z: 13 });
    g.hold(['right'], 40);
    expect(boulder(g)).toMatchObject({ x: 14, z: 13 });
  });

  it('wears off on a zone connection and on every warp', () => {
    const g = setup(newState('ROUTE_W', 31, 16, 'right'));
    g.state.flags[f('FLAG_STRENGTH_ACTIVE')] = true;
    g.state.flags[f('FLAG_FLASH_ACTIVE')] = true;
    g.hold(['right'], 8);
    expect(g.state.player.zone).toBe(f('ROUTE_E'));
    expect(g.state.flags[f('FLAG_STRENGTH_ACTIVE')]).toBeUndefined();
    expect(g.state.flags[f('FLAG_FLASH_ACTIVE')]).toBe(true);
  });
});

describe('map change rules (FieldSystem_InitFlagsWarp)', () => {
  function warp(g: Harness, zone: string, x: number, z: number) {
    g.world.warp(f(zone), x, z, 'down');
    g.settle();
  }

  it('Flash and Defog stay on a warp into a cave and wear off elsewhere; Strength always wears off', () => {
    const g = terrain(12, 20, 'down');
    for (const fl of ['FLAG_STRENGTH_ACTIVE', 'FLAG_FLASH_ACTIVE', 'FLAG_DEFOG_ACTIVE']) g.state.flags[f(fl)] = true;
    warp(g, 'GROTTO', 16, 16);
    expect(g.state.flags).toMatchObject({ [f('FLAG_FLASH_ACTIVE')]: true, [f('FLAG_DEFOG_ACTIVE')]: true });
    expect(g.state.flags[f('FLAG_STRENGTH_ACTIVE')]).toBeUndefined();
    warp(g, 'TERRAIN', 12, 20);
    expect(g.state.flags[f('FLAG_FLASH_ACTIVE')]).toBeUndefined();
    expect(g.state.flags[f('FLAG_DEFOG_ACTIVE')]).toBeUndefined();
  });

  it('surfing becomes walking on a warp; cycling becomes walking where the bike is not allowed', () => {
    const surf = terrain(6, 5, 'left', (s) => (s.playerState = 'surf'));
    warp(surf, 'TERRAIN', 12, 20);
    expect(surf.state.playerState).toBe('walk');
    expect(surf.world.view().effects).toEqual([]);
    const bike = terrain(12, 20, 'down', (s) => (s.playerState = 'cycle'));
    warp(bike, 'TERRAIN', 12, 21);
    expect(bike.state.playerState).toBe('cycle');
    warp(bike, 'GROTTO', 16, 16);
    expect(bike.state.playerState).toBe('walk');
  });
});

describe('ice, spin tiles, mud and snow', () => {
  it('ice slides at WALK_FAST in the moving direction until blocked, facing locked', () => {
    const g = terrain(17, 3, 'right');
    g.hold(['right'], 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 18, 3, 'right']);
    g.tick();
    expect(g.world.view().actors[0]!.anim).toBe('stand');
    g.hold([], 4 * 4 - 1);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 22, 3, 'right']);
    g.hold([], 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 22, 3, 'right']);
    expect(g.world.idle()).toBe(true);
    // Stopped on ice, the player walks off normally.
    g.hold(['down'], 2 + 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 22, 4, 'down']);
  });

  it('is never idle on the ice until the slide stops: no start menu or save between forced steps', () => {
    // PlayerAvatar_UpdatePlayerMoveState keeps PLAYER_MOVE_STATE_MOVING on a forcing tile, so
    // FieldInput_Update takes no X (start menu) there; the stopped slide's ignore-tile flag ends it.
    const g = terrain(17, 3, 'right');
    const idleAt: number[] = [];
    for (let i = 0; i < 8 + 4 * 4 + 8; i++) {
      g.tick(i < 8 ? ['right'] : []);
      if (g.world.idle()) idleAt.push(g.state.player.x);
    }
    expect(pos(g.state)).toEqual([f('TERRAIN'), 22, 3, 'right']);
    expect(new Set(idleAt)).toEqual(new Set([22]));
  });

  it('spin tiles carry the player on, spinning, until something blocks the way', () => {
    const g = terrain(17, 7, 'right');
    g.hold(['right'], 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 18, 7, 'right']);
    g.tick();
    expect(g.world.idle()).toBe(false);
    until(g, () => g.world.idle());
    // Four quarter turns a tile: off the spin tiles the player keeps going straight until blocked.
    expect(pos(g.state)).toEqual([f('TERRAIN'), 30, 7, 'right']);
  });

  it('deep mud holds the player until the d-pad changes direction five times', () => {
    const g = terrain(13, 10, 'up');
    g.hold(['up'], 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 13, 9, 'up']);
    expect(effects(g)).toContainEqual({ effect: f('FLDEFF_MUD'), anim: 'mud' });
    g.hold(['up'], 30);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 13, 9, 'up']);
    for (const d of ['left', 'right', 'left', 'right'] as const) g.hold([d], 3);
    expect(g.world.idle()).toBe(false);
    g.hold(['left'], 9);
    expect(g.world.idle()).toBe(true);
    // The move state stays "moving" through the task: no turn in place.
    g.hold(['up'], 8);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 13, 8, 'up']);
  });

  it('snow slows the step by the underfoot depth and stops running; tracks are left behind', () => {
    const g = terrain(11, 7, 'right', (s) => (s.runningShoes = true));
    const steps: number[] = [];
    const tracks: (string | undefined)[][] = [];
    for (let x = 12; x <= 17; x++) {
      steps.push(until(g, () => g.state.player.x === x && g.world.idle(), 60, ['right', 'b']));
      tracks.push(g.world.view().effects.map((e) => e.anim));
    }
    expect(steps).toEqual([4, 4, 4, 8, 16, 32]);
    // Each track appears on the tile left and lasts 32 ticks (the one left by the 32-tick step is gone on arrival).
    expect(tracks.map((t) => t.at(-1))).toEqual([undefined, 'snow-shallow', 'snow-shallow', 'snow-deep', 'snow-deep', undefined]);
  });

  it('sand leaves footprints for 32 ticks; puddles splash; shallow water ripples while standing in it', () => {
    const g = terrain(11, 4, 'right');
    g.hold(['right'], 16);
    const prints = g.world.view().effects.filter((e) => e.anim === 'footprints');
    expect(prints).toHaveLength(1);
    expect(prints[0]).toMatchObject({ cur: [12 * 16 + 8, 0, 4 * 16 + 8], facing: 'right' });
    g.hold([], 32);
    expect(g.world.view().effects).toEqual([]);
    const w = terrain(11, 2, 'right');
    w.hold(['right'], 8);
    expect(effects(w)).toEqual([{ effect: f('FLDEFF_SPLASH'), anim: 'splash' }]);
    w.hold(['right'], 8);
    expect(effects(w)).toContainEqual({ effect: f('FLDEFF_RIPPLE'), anim: 'ripple' });
    w.hold(['down'], 2 + 8);
    expect(effects(w).filter((e) => e.anim === 'ripple')).toEqual([]);
  });

  it('the undecoded behaviours (UNKNOWN_x3C …) walk like plain ground', () => {
    const g = terrain(15, 9, 'right');
    g.hold(['right'], 8 * 2);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 17, 9, 'right']);
  });

  it('BLOCK_EASTWARD walls the east side of its tile both ways', () => {
    const g = terrain(12, 16, 'right');
    g.hold(['right'], 20);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 12, 16, 'right']);
    const h = terrain(13, 16, 'left');
    h.hold(['left'], 20);
    expect(pos(h.state)).toEqual([f('TERRAIN'), 13, 16, 'left']);
  });
});

describe('the bike (PlayerAvatar_SetMovement_Bike)', () => {
  const cycle = (x: number, z: number, facing: Facing, gear: 0 | 1 = 0) =>
    terrain(x, z, facing, (s) => {
      s.playerState = 'cycle';
      s.cyclingGear = gear;
    });

  it('B toggles the gear; gear 0 rides 3 ticks a tile, gear 1 accelerates 6, 4, 3, 2', () => {
    const g = cycle(12, 20, 'down');
    g.tick(['b']);
    expect(g.state.cyclingGear).toBe(1);
    g.tick();
    g.tick(['b']);
    expect(g.state.cyclingGear).toBe(0);
    const slow: number[] = [];
    for (let z = 21; z <= 23; z++) slow.push(until(g, () => g.state.player.z === z && g.world.idle(), 30, ['down']));
    expect(slow).toEqual([3, 3, 3]);
    const fast = cycle(12, 18, 'down', 1);
    const ticks: number[] = [];
    for (let z = 19; z <= 23; z++) ticks.push(until(fast, () => fast.state.player.z === z && fast.world.idle(), 30, ['down']));
    expect(ticks).toEqual([6, 4, 3, 2, 2]);
  });

  it('the slope climbs in gear 1 after a run-up and slides back from a standstill', () => {
    const g = cycle(26, 20, 'up', 1);
    until(g, () => g.state.player.z === 9 && g.world.idle(), 80, ['up']);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 26, 9, 'up']);
    const s = cycle(26, 12, 'up', 1);
    s.hold(['up'], 6);
    expect(s.state.player.z).toBe(11);
    s.hold(['up'], 16);
    expect(pos(s.state)).toEqual([f('TERRAIN'), 26, 12, 'up']);
    const w = terrain(26, 12, 'up');
    w.hold(['up'], 8 + 16);
    expect(pos(w.state)).toEqual([f('TERRAIN'), 26, 12, 'up']);
  });

  it('the ramp jumps three tiles in gear 1 at full speed, one tile in gear 0; B is ignored on the ramp', () => {
    const g = cycle(20, 24, 'right', 1);
    const onRamp = until(g, () => g.state.player.x === 24, 30, ['right']);
    expect(onRamp).toBe(6 + 4 + 3 + 1);
    g.tick(['right', 'b']);
    expect(g.state.cyclingGear).toBe(1);
    until(g, () => g.world.idle(), 30);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 27, 24, 'right']);
    const slow = cycle(23, 24, 'right', 0);
    until(slow, () => slow.state.player.x === 24, 30, ['right']);
    until(slow, () => slow.world.idle() && slow.state.player.x !== 24, 30);
    expect(pos(slow.state)).toEqual([f('TERRAIN'), 25, 24, 'right']);
  });

  it('the bike cannot enter water, snow or mud', () => {
    for (const [x, z, d] of [
      [10, 5, 'left'],
      [11, 7, 'right'],
      [11, 9, 'right'],
    ] as const) {
      const g = cycle(x, z, d);
      g.hold([d], 20);
      expect(pos(g.state)).toEqual([f('TERRAIN'), x, z, d]);
    }
  });

  it('on the elevated bike bridge the bike rides along it only, and walkers cannot get on it', () => {
    const g = cycle(29, 25, 'up');
    until(g, () => g.state.player.z === 21 && g.world.idle(), 40, ['up']);
    g.tick();
    g.hold(['right'], 10);
    expect(pos(g.state)).toEqual([f('TERRAIN'), 29, 21, 'up']);
    until(g, () => g.state.player.z === 18 && g.world.idle(), 40, ['up']);
    const w = terrain(29, 25, 'up');
    w.hold(['up'], 8 + 20);
    expect(pos(w.state)).toEqual([f('TERRAIN'), 29, 24, 'up']);
    // From the ground beside it the bridge tile is the ground under the bridge.
    const under = terrain(28, 21, 'right');
    under.hold(['right'], 8);
    expect(pos(under.state)).toEqual([f('TERRAIN'), 29, 21, 'right']);
  });
});
