import { describe, expect, it } from 'vitest';
import type { Sprite } from '@opensinnoh/contracts';
import { PLATINUM_FOLLOWER_GFX, platinumFollowers } from './followers.ts';

describe('platinumFollowers', () => {
  const sprite = (gfx: number, frameCount: number): Sprite => ({ id: `x:${gfx}` as never, atlas: 'x:a.png' as never, frameSize: 32, frameCount, animations: {} });
  const gfxNames = new Map([...PLATINUM_FOLLOWER_GFX.keys()].map((g) => [g, `OBJ_EVENT_GFX_G${g}`]));
  const run = (sprites: Sprite[]) => platinumFollowers(gfxNames, sprites, (g) => `x:${g}` as never, (i) => `x:SPECIES_${i}` as never);

  it('gives each listed gfx its species and form by number, whatever the names', () => {
    const out = run([...PLATINUM_FOLLOWER_GFX.keys()].map((g) => sprite(g, 16)));
    expect(out).toHaveLength(28);
    expect(new Set(out.map((f) => f.species)).size).toBe(24);
    expect(out.find((f) => f.sprite === 'x:71')).toMatchObject({ id: 'platinum:FOLLOWER_G71', species: 'x:SPECIES_25', form: 0 });
    expect(out.find((f) => f.sprite === 'x:240')).toMatchObject({ species: 'x:SPECIES_479', form: 2 });
  });

  it('fails loudly when a listed gfx is not a walking set', () => {
    expect(() => run([...PLATINUM_FOLLOWER_GFX.keys()].map((g) => sprite(g, g === 72 ? 2 : 16)))).toThrow(/gfx 72/);
  });
});
