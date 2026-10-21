/**
 * `?perf` in any build: a small chip with the loop's frame work (p50/p95 ms over the last 2 s), the display
 * rate, dropped ticks, the field's render pixel ratio and, where the browser tells, the JS heap. This is how
 * real devices are read. It reads `LoopStats` only; it never touches the game.
 */
import type { LoopStats } from '../loop.ts';

export interface FrameStats {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Nearest-rank percentiles of frame times (ms, 2 decimals); NaN for no samples. */
export function frameStats(xs: readonly number[]): FrameStats {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 100) / 100 : NaN);
  return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}

/** Chromium's non-standard heap reading (MB), or null elsewhere. */
export function heapMB(): number | null {
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return m ? Math.round(m.usedJSHeapSize / 1e5) / 10 : null;
}

const WINDOW_MS = 2000;
const UPDATE_MS = 500;

export function mountPerfHud(root: HTMLElement, deps: { loop: LoopStats; renderDpr(): number }): void {
  const chip = document.createElement('output');
  chip.className = 'os-win perf-hud';
  chip.setAttribute('aria-label', 'Performance');
  Object.assign(chip.style, { position: 'fixed', left: 'calc(8px + env(safe-area-inset-left, 0px))', top: 'calc(8px + env(safe-area-inset-top, 0px))', zIndex: '50', padding: '4px 8px', font: '12px/16px ui-monospace, monospace', whiteSpace: 'pre', pointerEvents: 'none' });
  root.append(chip);
  let frames = deps.loop.frames;
  let at = performance.now();
  setInterval(() => {
    const now = performance.now();
    const fps = ((deps.loop.frames - frames) * 1000) / (now - at);
    frames = deps.loop.frames;
    at = now;
    const recent = deps.loop.frameMs.slice(-Math.max(1, Math.round((fps * WINDOW_MS) / 1000)));
    const s = frameStats(recent);
    const heap = heapMB();
    chip.textContent = [
      `frame ${s.p50.toFixed(1)} / ${s.p95.toFixed(1)} ms (p50/p95)`,
      `${fps.toFixed(0)} fps · dropped ${deps.loop.dropped} · ${deps.loop.effective.toFixed(2)}x`,
      `3D ${deps.renderDpr()}x of ${devicePixelRatio || 1}${heap === null ? '' : ` · heap ${heap.toFixed(0)} MB`}`,
    ].join('\n');
  }, UPDATE_MS);
}
