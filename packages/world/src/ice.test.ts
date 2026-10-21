import { audioTrace, withFieldSounds } from '../../../tests/fixtures/audio.ts';
import { describe, expect, it } from 'vitest';
import type { Chunk, ObjectEvent, Registries, Zone } from '@opensinnoh/contracts';
import { f, newState, registries, setup } from './testing.ts';

/**
 * Ice on slopes (decomp player_move.c PlayerAvatar_TileMove_Ice, PlayerAvatar_CheckIceHeightChange; Snowpoint
 * Gym) on an original fixture: the ROOM's floor tilted so the height falls 1 unit every 4 going south, ice on
 * column 13 from z 13 to 19, and snowballs (object gfx 0x76) where a test puts them.
 */
const ICE = 32;

function room(slope: number, balls: [number, number][] = []): Registries {
  const regs = { ...registries } as Registries;
  const zone: Zone = structuredClone(registries.zones.get(f('ROOM'))!);
  const chunkId = registries.matrices.get(zone.matrix)!.chunks[0]!;
  const chunk: Chunk = structuredClone(registries.chunks.get(chunkId)!);
  // y = −(n.x·x + n.z·z + c) / n.y: n.z = slope makes the height fall going south.
  chunk.terrain.normals = [[0, 1, slope]];
  for (let z = 13; z <= 19; z++) chunk.tiles[13 + z * 32] = ICE;
  regs.chunks = new Map([...registries.chunks, [chunk.id, chunk]]);
  const snowball = [...registries.sprites.values()].find((s) => s.sourceIndex === 0x76);
  const sprite = snowball?.id ?? f('SPRITE_SNOWBALL');
  if (!snowball) regs.sprites = new Map([...registries.sprites, [sprite, { id: sprite, sourceIndex: 0x76, model: null }]]);
  const template = zone.events.objects[0]!;
  balls.forEach(([x, z], i) => zone.events.objects.push({ ...template, localId: 40 + i, sprite, x, z, movementType: 0, trainerType: 0, label: undefined, hideFlag: undefined } as unknown as ObjectEvent));
  regs.zones = new Map([...registries.zones, [zone.id, zone]]);
  return regs;
}

/** Walks down from 13,12 onto the ice and records each step's length and the tile it ends on. */
function slide(slope: number, balls: [number, number][] = []) {
  const g = setup(newState('ROOM', 13, 12, 'down'), { regs: withFieldSounds(room(slope, balls)) });
  g.settle();
  const sounds = audioTrace(g.audio, withFieldSounds(room(slope, balls)), () => g.state.tick);
  const start = g.state.tick;
  const hero = () => (g.world as unknown as { hero: { x: number; z: number; motion: { ticks: number } | null } }).hero;
  const steps: { z: number; ticks: number }[] = [];
  let last: unknown = null;
  g.hold(['down'], 1);
  for (let i = 0; i < 200; i++) {
    const m = hero().motion;
    if (m && m !== last) steps.push({ z: hero().z, ticks: m.ticks });
    last = m;
    g.tick();
  }
  return { g, steps, sounds, start };
}

describe('ice on slopes (Snowpoint Gym)', () => {
  it('flat ice slides at WALK_FAST (4 ticks a tile) until blocked', () => {
    const { g, steps } = slide(0);
    expect(steps.slice(1).map((s) => s.ticks)).toEqual([4, 4, 4, 4, 4, 4]);
    expect(g.state.player).toMatchObject({ x: 13, z: 19 });
  });

  it('downhill each tile speeds up a step: 3, then 2 ticks a tile (speed capped at 3)', () => {
    const { steps } = slide(0.25);
    expect(steps.slice(1).map((s) => s.ticks)).toEqual([3, 2, 2, 2, 2, 2]);
  });

  it('a snowball ahead breaks at speed 1 or more (deleted, no hide flag); at speed 0 it stops the slide', () => {
    const fast = slide(0.25, [[13, 17]]);
    expect(fast.g.state.objects.some((o) => o.localId === 40)).toBe(false);
    expect(fast.g.state.player).toMatchObject({ z: 19 });
    const slow = slide(0, [[13, 17]]);
    expect(slow.g.state.objects.some((o) => o.localId === 40)).toBe(true);
    expect(slow.g.state.player).toMatchObject({ z: 16 });
  });

  it('uphill at speed 0 steps back one tile WALK_SLOW (16 ticks) with the facing kept', () => {
    // Rising going south: the first ice step finds the height going up at speed 0.
    const { g, steps } = slide(-0.25);
    expect(steps[1]).toMatchObject({ z: 12, ticks: 16 });
    expect(g.state.player.facing).toBe('down');
  });
});

it('ice stays silent; a fast snowball collision sounds on the deletion tick, a slow collision stays silent', () => {
  const fast = slide(0.25, [[13, 17]]);
  expect(fast.sounds.map(({ tick, op, source }) => [tick - fast.start, op, source])).toEqual([[15, 'start', 1627]]);
  expect(slide(0).sounds).toEqual([]);
  expect(slide(0, [[13, 17]]).sounds).toEqual([]);
});
