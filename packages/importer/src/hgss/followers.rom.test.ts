import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { HGSS_PLAYER_SPRITES, type BillboardSprite, type FollowerSprite, type FollowerTalk } from '@opensinnoh/contracts';
import { importHgssFollowers, platinumSpeciesOf, type HgssFollowersResult } from './followers.ts';

const romPath = process.env.OPENSINNOH_HGSS_ROM;

describe.skipIf(!romPath)('HGSS follower add-on import (OPENSINNOH_HGSS_ROM)', () => {
  let r: HgssFollowersResult;
  beforeAll(async () => {
    r = await importHgssFollowers(new Uint8Array(readFileSync(romPath!)), platinumSpeciesOf);
  }, 120_000);

  it('gives every species a set: 566 sets with forms and female sets, shiny sprites, 31 large', () => {
    const followers = r.pack.registries.followers as unknown as FollowerSprite[];
    expect(followers).toHaveLength(566);
    expect(new Set(followers.map((f) => f.species)).size).toBe(493);
    expect(followers.filter((f) => f.gender === 'female')).toHaveLength(12);
    expect(followers.filter((f) => f.species === 'platinum:SPECIES_UNOWN')).toHaveLength(28);
    expect(followers.filter((f) => f.species === 'platinum:SPECIES_ROTOM').map((f) => f.form)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(followers.filter((f) => f.size === 'large')).toHaveLength(31);
    expect(followers.every((f) => f.shiny && f.animation === 'loop')).toBe(true);
    const keys = new Set(followers.map((f) => `${f.species}#${f.form}#${f.gender ?? 'any'}`));
    expect(keys.size).toBe(566);
  });

  it('writes a normal and a shiny atlas per set, 8 frames each, with the four directions', () => {
    const sprites = (r.pack.registries.sprites as unknown as BillboardSprite[]).filter((s) => s.id.includes('FOLLOWER'));
    expect(sprites).toHaveLength(1132);
    for (const s of sprites) {
      expect(s.frameCount).toBe(8);
      expect(r.assets.has(s.atlas.slice('hgss-followers:'.length))).toBe(true);
      for (const d of ['up', 'down', 'left', 'right']) expect(s.animations[`walk-${d}`]!.length).toBeGreaterThan(1);
    }
    expect(r.pack.manifest).toMatchObject({ id: 'hgss-followers', dependencies: { platinum: '*' } });
    expect(r.pack.provenance).toBe('rom-derived');
  });

  it('follower talk: the 70 global rules, their interactions, motions and messages, 14 bubbles', () => {
    const [talk] = r.pack.registries.followerTalk as unknown as FollowerTalk[];
    expect(talk!.rules).toHaveLength(70);
    expect(talk!.interactions).toHaveLength(new Set(talk!.rules.map((x) => x.interaction)).size);
    expect(talk!.messages.length).toBeGreaterThan(40);
    expect(talk!.messages.every((m) => m.text.length > 0 && !/{var [5-9]}/.test(m.text))).toBe(true);
    const motions = new Set(talk!.motions.map((m) => m.id));
    for (const i of talk!.interactions) for (const s of i.steps) if (s.motion) expect(motions.has(s.motion)).toBe(true);
    expect(talk!.emotes).toHaveLength(14);
    expect(talk!.emoteFrames).toEqual([{ frame: 0, ticks: 0 }, { frame: 1, ticks: 4 }, { frame: 0, ticks: 8 }, { frame: 1, ticks: 12 }]);
    for (const e of talk!.emotes) expect(r.assets.has(`talk/emote_${e.split('_').pop()}.png`)).toBe(true);
  });

  it('the HGSS player sprites: Ethan and Lyra on foot (walk, run) and on the bicycle (walk, the six bike poses)', () => {
    const sprites = new Map((r.pack.registries.sprites as unknown as BillboardSprite[]).map((s) => [s.id as string, s]));
    for (const id of Object.values(HGSS_PLAYER_SPRITES.walk)) {
      const s = sprites.get(id)!;
      expect(s.frameCount).toBe(32);
      for (const d of ['up', 'down', 'left', 'right']) for (const k of ['stand', 'walk', 'run']) expect(s.animations[`${k}-${d}`]!.length, `${id} ${k}-${d}`).toBeGreaterThan(0);
      expect(s.animations['run-down']!.map((f) => f.ticks)).toEqual([4, 4, 4, 4]);
    }
    for (const id of Object.values(HGSS_PLAYER_SPRITES.cycle)) {
      expect(Object.keys(sprites.get(id)!.animations).filter((k) => k.startsWith('pose-bike-')).sort()).toEqual([4, 5, 6, 7, 8, 9].map((k) => `pose-bike-${k}`));
    }
  });
});
