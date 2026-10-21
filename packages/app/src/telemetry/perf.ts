/**
 * The performance summary: once per session, players who allow error reports also
 * send an anonymous summary: the device class, the pixel ratios, frame work percentiles, dropped ticks and,
 * after an import, its seconds. No game state. It goes through the same path as error reports and only when
 * they are on (index.ts `sendSummary`).
 */
import { frameStats } from '../debug/perf.ts';
import type { LoopStats } from '../loop.ts';
import { sendSummary } from './index.ts';

/** Game ticks before the summary is sent (2 minutes of play at 30 Hz). */
export const SUMMARY_TICKS = 3600;
/** sessionStorage: the last import's seconds, kept across the reload that follows it (main.ts). */
export const IMPORT_SECONDS_KEY = 'lantern-nds:import-seconds'; // pre-rename name, kept: players' stored data uses it

export type DeviceClass = 'phone' | 'tablet' | 'desktop';

export function deviceClass(coarse: boolean, screenMin: number): DeviceClass {
  return !coarse ? 'desktop' : screenMin < 600 ? 'phone' : 'tablet';
}

export function perfSummary(loop: LoopStats, env: { coarse: boolean; screenMin: number; dpr: number; renderDpr: number; importSeconds: number | null }): Record<string, string | number | boolean> {
  const s = frameStats(loop.frameMs);
  return {
    device: deviceClass(env.coarse, env.screenMin),
    dpr: env.dpr,
    renderDpr: env.renderDpr,
    frameP50: s.p50,
    frameP95: s.p95,
    frameP99: s.p99,
    frames: loop.frames,
    ticks: loop.ticks,
    dropped: loop.dropped,
    ...(env.importSeconds === null ? {} : { importSeconds: env.importSeconds }),
  };
}

/** Sends the summary once the game has run `SUMMARY_TICKS` (checked every 10 s). */
export function watchPerf(loop: LoopStats, renderDpr: () => number): void {
  const timer = setInterval(() => {
    if (loop.ticks < SUMMARY_TICKS) return;
    clearInterval(timer);
    let importSeconds: number | null = null;
    try {
      const raw = sessionStorage.getItem(IMPORT_SECONDS_KEY);
      sessionStorage.removeItem(IMPORT_SECONDS_KEY);
      if (raw !== null && Number.isFinite(Number(raw))) importSeconds = Number(raw);
    } catch {
      // Blocked storage: no import time.
    }
    sendSummary('perf', perfSummary(loop, { coarse: matchMedia('(pointer: coarse)').matches, screenMin: Math.min(screen.width, screen.height), dpr: devicePixelRatio || 1, renderDpr: renderDpr(), importSeconds }));
  }, 10_000);
}
