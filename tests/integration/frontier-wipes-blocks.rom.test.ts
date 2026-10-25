/**
 * The Hall's and the Arcade's pre-battle wipes on the real ROM (FrontierScrCmd_3F types 1 and 2): sys-hall-single and
 * sys-arcade-single sampled per tick, the black blocks over the whole room, then black.
 */
import { describe, expect, it } from 'vitest';
import type { FrontierView } from '@opensinnoh/contracts';
import { sampleFrontier, wipeRuns } from './frontier-effects.ts';

/** The share of the 256 × 192 screen a blocks wipe has covered. */
function covered(v: FrontierView): number {
  if (v.wipe?.kind !== 'blocks') return 0;
  const px = new Uint8Array(256 * 192);
  for (const r of v.wipe.rects) for (let y = r.y; y < Math.min(192, r.y + r.h); y++) px.fill(1, y * 256 + r.x, y * 256 + r.x + r.w);
  return px.reduce((a, b) => a + b, 0) / px.length;
}

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Frontier block wipes (OPENSINNOH_NDS_ROM)', () => {
  for (const file of ['sys-hall-single', 'sys-arcade-single']) {
    it(`${file}: each battle's wipe covers the room block by block, then the screen is black`, async () => {
      const { views, log } = await sampleFrontier(file);
      expect(log.report().filter((s) => s.key.startsWith('frontier:encounter-effect'))).toEqual([]);
      const runs = wipeRuns(views);
      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) {
        expect(run.length).toBeGreaterThanOrEqual(25);
        expect(run.length).toBeLessThanOrEqual(27);
        expect(covered(run[Math.floor(run.length / 2)]!)).toBeLessThan(0.8);
        expect(covered(run.at(-1)!)).toBe(1);
      }
      // After a wipe the screen is black until the battle.
      const end = views.findIndex((v, i) => i > 0 && !v.wipe && views[i - 1]!.wipe);
      expect(views[end]?.fade).toEqual({ color: 'black', alpha: 1 });
    }, 600_000);
  }
});
