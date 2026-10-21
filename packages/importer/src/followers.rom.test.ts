import { describe, expect, it } from 'vitest';
import type { FollowerSprite, Sprite, Zone } from '@opensinnoh/contracts';
import { ROM, romSlice } from '../../../tests/rom.ts';

describe.skipIf(!ROM)('Platinum follower sets (OPENSINNOH_NDS_ROM)', () => {
  it('are the 24 species with a walking set (28 sets: Rotom by its five appliance forms), all small walk sets', () => {
    const { pack } = romSlice();
    const followers = pack.registries.followers as unknown as FollowerSprite[];
    const sprites = new Map((pack.registries.sprites as unknown as Sprite[]).map((s) => [s.id, s]));
    expect(followers).toHaveLength(28);
    expect(new Set(followers.map((f) => f.species)).size).toBe(24);
    expect(followers.filter((f) => f.species === 'platinum:SPECIES_ROTOM').map((f) => f.form).sort()).toEqual([1, 2, 3, 4, 5]);
    for (const starter of ['TURTWIG', 'CHIMCHAR', 'PIPLUP', 'PIKACHU']) expect(followers.some((f) => f.species === `platinum:SPECIES_${starter}` && f.form === 0)).toBe(true);
    for (const f of followers) {
      expect(f).toMatchObject({ size: 'small', animation: 'walk' });
      const s = sprites.get(f.sprite)!;
      expect('atlas' in s && s.frameCount).toBe(16);
    }
  });

  it('give every zone a follow mode by map type', () => {
    const { pack } = romSlice();
    const zones = pack.registries.zones as unknown as Zone[];
    expect(zones.every((z) => z.follow)).toBe(true);
    const bedroom = zones.find((z) => z.id === 'platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F')!;
    expect(bedroom.follow).toBe('height-restrict');
    expect(zones.find((z) => z.id === 'platinum:MAP_HEADER_ROUTE_201')!.follow).toBe('allow');
  });
});
