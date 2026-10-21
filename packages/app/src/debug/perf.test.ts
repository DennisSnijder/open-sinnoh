import { describe, expect, it } from 'vitest';
import { newLoopStats } from '../loop.ts';
import { deviceClass, perfSummary } from '../telemetry/perf.ts';
import { frameStats } from './perf.ts';

describe('frameStats', () => {
  it('nearest-rank percentiles', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(frameStats(xs)).toEqual({ n: 100, p50: 51, p95: 96, p99: 100, max: 100 });
    expect(frameStats([]).p95).toBeNaN();
  });
});

describe('the performance summary', () => {
  it('names the device class and carries numbers only', () => {
    expect(deviceClass(false, 390)).toBe('desktop');
    expect(deviceClass(true, 390)).toBe('phone');
    expect(deviceClass(true, 820)).toBe('tablet');
    const loop = { ...newLoopStats(), frames: 4, ticks: 3600, dropped: 2, frameMs: [1, 2, 3, 10] };
    expect(perfSummary(loop, { coarse: true, screenMin: 390, dpr: 3, renderDpr: 2, importSeconds: 41.5 })).toEqual({
      device: 'phone', dpr: 3, renderDpr: 2, frameP50: 3, frameP95: 10, frameP99: 10, frames: 4, ticks: 3600, dropped: 2, importSeconds: 41.5,
    });
    expect(perfSummary(loop, { coarse: false, screenMin: 900, dpr: 1, renderDpr: 1, importSeconds: null })).not.toHaveProperty('importSeconds');
  });
});
