/**
 * The Factory's and the Castle's pre-battle wipes on the real ROM (FrontierScrCmd_3F types 3 and 4): sys-factory-single
 * and sys-castle-single sampled per tick, the line pairs moving apart while the room darkens over 40 frames, then BG3
 * goes off and the screen is black.
 */
import { describe, expect, it } from 'vitest';
import { sampleFrontier, wipeRuns } from './frontier-effects.ts';

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Frontier line wipes (OPENSINNOH_NDS_ROM)', () => {
  for (const file of ['sys-factory-single', 'sys-castle-single']) {
    it(`${file}: each battle's wipe moves BG2 and BG3 line by line for 40 frames as the room darkens`, async () => {
      const { views, log } = await sampleFrontier(file);
      expect(log.report().filter((s) => s.key.startsWith('frontier:encounter-effect'))).toEqual([]);
      const runs = wipeRuns(views);
      expect(runs.length).toBeGreaterThan(0);
      for (const run of runs) {
        expect(run.every((v) => v.wipe?.kind === 'lines')).toBe(true);
        expect(run.length).toBeGreaterThanOrEqual(40);
        expect(run.length).toBeLessThanOrEqual(43);
        const first = run[0]!.wipe!;
        const last = run.at(-1)!.wipe!;
        if (first.kind !== 'lines' || last.kind !== 'lines') throw new Error('not lines');
        // The pairs spread apart: the rows they show lie further and further apart.
        const spread = (rows: { y: number }[]) => Math.max(...rows.map((r) => r.y)) - Math.min(...rows.map((r) => r.y));
        expect(spread(last.bg)).toBeGreaterThan(spread(first.bg));
        expect(last.bgHidden).toBe(true);
        expect(run[20]!.fade?.color).toBe('black');
        expect(run[20]!.fade!.alpha).toBeGreaterThan(0.3);
        expect(run[20]!.fade!.alpha).toBeLessThan(0.7);
      }
      const end = views.findIndex((v, i) => i > 0 && !v.wipe && views[i - 1]!.wipe);
      expect(views[end]?.fade).toEqual({ color: 'black', alpha: 1 });
    }, 600_000);
  }
});
