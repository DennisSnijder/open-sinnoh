/** Original frame tables exercise the world → renderer seam without ROM art. */
import { expect, it } from 'vitest';
import type { BillboardSprite, Facing, FollowerSprite } from '@opensinnoh/contracts';
import { spriteFrame } from '../../packages/render/src/index.ts';
import { PARTY_FOLLOWER_LOCALID } from '../../packages/world/src/party-follower.ts';
import { f, mon, newState, registries, setup } from '../../packages/world/src/testing.ts';

it.each(['walk', 'loop'] as const)('%s follower holds its drawn idle frame in every facing, then animates during movement', (animation) => {
  const sprite: BillboardSprite = { id: f('SPRITE_TEST_FOLLOWER'), atlas: f('original.png'), frameSize: 32, frameCount: 8, animations: {} };
  for (const [i, dir] of (['up', 'down', 'left', 'right'] as const).entries()) {
    const frames = [{ frame: i * 2, ticks: 2 }, { frame: i * 2 + 1, ticks: 2 }];
    // HGSS's standing sequence also loops; holding requires a fixed tick as well as anim: stand.
    sprite.animations[`stand-${dir}`] = frames;
    sprite.animations[`walk-${dir}`] = frames;
  }
  const follower: FollowerSprite = { id: f('FOLLOWER_TEST'), species: f('SPECIES_MOSSLET'), form: 0, sprite: sprite.id, size: 'small', animation };
  const regs = { ...registries, followers: new Map([[follower.id, follower]]), sprites: new Map([...registries.sprites, [sprite.id, sprite]]) };
  for (const facing of ['up', 'down', 'left', 'right'] as Facing[]) {
    const state = newState();
    state.party = [mon('SPECIES_MOSSLET', 5)];
    state.runningShoes = true;
    state.partyFollower = { x: 14, z: 17, facing, waiting: false };
    let inPlace = false;
    const g = setup(state, { regs, followerWalkInPlace: () => inPlace });
    const drawn = () => {
      const v = g.world.view().actors.find((a) => a.localId === PARTY_FOLLOWER_LOCALID)!;
      return spriteFrame(sprite, v.anim, v.facing, v.animTick);
    };
    const idle = drawn();
    const sample = (ticks: number, held: Parameters<typeof g.tick>[0] = []) => Array.from({ length: ticks }, () => { g.tick(held); return drawn(); });
    expect(new Set(sample(48))).toEqual(new Set([idle]));
    inPlace = true;
    expect(new Set(sample(16)).size).toBe(2);
    inPlace = false;
    expect(new Set(sample(16))).toEqual(new Set([idle]));
    // The follower actually moves into the player's previous tiles, including after a stop.
    expect(new Set(sample(24, ['up']))).toEqual(new Set([0, 1]));
    sample(16);
    expect(new Set(sample(48)).size).toBe(1);
    expect(new Set(sample(16, ['up', 'b']))).toEqual(new Set([0, 1]));
  }
  const state = newState('ROUTE_W', 14, 12, 'down');
  state.party = [mon('SPECIES_MOSSLET', 5)];
  const g = setup(state, { regs });
  g.hold(['down'], 24);
  const hopFrames: number[] = [];
  for (let i = 0; i < 8; i++) {
    g.tick(['down']);
    const v = g.world.view().actors.find((a) => a.localId === PARTY_FOLLOWER_LOCALID)!;
    expect(v.cur[1]).toBeGreaterThan(0);
    hopFrames.push(spriteFrame(sprite, v.anim, v.facing, v.animTick));
  }
  expect(new Set(hopFrames)).toEqual(new Set([2, 3]));
});
