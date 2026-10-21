import { describe, expect, it } from 'vitest';
import type { NewGame, Model } from '@opensinnoh/contracts';
import { romSlice } from '../rom.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('ship scene import', () => {
  it('uses the separate directional archives and keeps every authored channel', () => {
    const pack = romSlice().pack;
    const boat = (pack.registries.newGame![0] as unknown as NewGame).boat!;
    const models = pack.registries.models as unknown as Model[];
    expect(boat.cinematicFrames).toEqual([90, 90, 90, 90]);
    expect(boat.scenes!.map(s => s.clip)).toEqual(['c_demo_D', 'g_demo_L', 'g_demo_R', 'c_demo_U']);
    expect(boat.scenes!.map(s => s.patterns.length)).toEqual([1, 0, 0, 1]);
    for (const s of boat.scenes!) {
      expect(models.find(m => m.id === s.model)).toBeDefined();
      expect(s.srt).toHaveLength(1);
      expect(s.colors).toHaveLength(1);
      expect(s.camera).toMatchObject({ target: [0, 0, 0], near: 150, far: 900, fovY: 1473 * 720 / 65536 });
      expect(s.colors[0]!.materials.some(m => Array.isArray(m.alpha))).toBe(true);
    }
  });
});
