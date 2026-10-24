/**
 * The frontier scenes' particles and room effects on the real ROM (frontier_particle_system.c through the SPL port;
 * BF_FUNC_UPDATE_BACKGROUND; the Hall battle room's light animation): each facility's sys replay, sampled per tick.
 */
import { describe, expect, it } from 'vitest';
import { newGameRecord } from '@opensinnoh/contracts';
import { sampleFrontier } from './frontier-effects.ts';

const summary = (views: { scene: number; particles?: unknown[]; bgPatch?: { sheet: string }; bg: { sheet: string } | null }[]) => {
  const out: Record<number, { particles: number; frames: number; patches: string[]; bgs: string[] }> = {};
  for (const v of views) {
    const s = (out[v.scene] ??= { particles: 0, frames: 0, patches: [], bgs: [] });
    if (v.particles?.length) {
      s.frames++;
      s.particles = Math.max(s.particles, v.particles.length);
    }
    if (v.bgPatch && !s.patches.includes(v.bgPatch.sheet)) s.patches.push(v.bgPatch.sheet);
    if (v.bg && !s.bgs.includes(v.bg.sheet)) s.bgs.push(v.bg.sheet);
  }
  return out;
};

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('frontier scene effects (OPENSINNOH_NDS_ROM)', () => {
  for (const file of ['sys-factory-single', 'sys-hall-single', 'sys-castle-single', 'sys-arcade-single']) {
    it(file, async () => {
      const { game, views, log } = await sampleFrontier(file);
      console.log(file, JSON.stringify(summary(views)), JSON.stringify(log.report().filter((s) => s.key.startsWith('frontier:'))));
      expect(newGameRecord(game.registries).frontier?.effects).toBeDefined();
    }, 600_000);
  }
});
