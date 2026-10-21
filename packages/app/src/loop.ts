/**
 * Fixed 30 Hz simulation clock. `stepClock` is the pure accumulator; `startLoop` drives it on
 * requestAnimationFrame. Rendering interpolates with `alpha` and never moves simulation time.
 *
 * Game speed (fast-forward) is presentation only: at speed N the loop runs N ticks per 30 Hz of wall time
 * (the same ticks, the same input sampling, so the game, its RNG, replays and saves are unchanged) and still
 * draws once per display frame. A machine that cannot keep up drops the ticks it has no time for (the game
 * runs slower, never spirals) and says so in `LoopStats`.
 *
 * A hidden page stops the loop (no frames, no ticks), and showing it again starts the clock afresh: the hidden
 * time is not played back, not even as a capped burst.
 */
export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ;
/** After a long stall (a debugger, a slow machine) at most this many ticks (times the speed) are caught up; the rest is dropped. */
export const MAX_CATCH_UP = 5;
/**
 * Fast-forward ticks beyond the 1x share of a frame run only while the frame's tick work is under this
 * (the render and the browser need the rest of a 60 Hz frame).
 */
export const FAST_TICK_BUDGET_MS = 10;
/** Frame timings kept in `LoopStats.frameMs`. */
const FRAME_SAMPLES = 2048;

/** `capped`: the ticks over the catch-up cap, dropped. */
export function stepClock(accumulator: number, elapsedMs: number, speed = 1): { ticks: number; capped: number; accumulator: number; alpha: number } {
  let acc = accumulator + Math.max(0, elapsedMs) * speed;
  const due = Math.floor(acc / TICK_MS);
  acc -= due * TICK_MS;
  const ticks = Math.min(due, MAX_CATCH_UP * speed);
  return { ticks, capped: due - ticks, accumulator: acc, alpha: acc / TICK_MS };
}

/**
 * Runs `count` ticks of a frame at `speed`: the 1x share (`ceil(count / speed)`) always, the rest while
 * `now() - start` stays under `budgetMs`. Returns the ticks run; the others are dropped.
 */
export function runTicks(count: number, speed: number, tick: () => void, now: () => number, budgetMs = FAST_TICK_BUDGET_MS): number {
  const start = now();
  const guaranteed = Math.ceil(count / speed);
  for (let i = 0; i < count; i++) {
    if (i >= guaranteed && now() - start >= budgetMs) return i;
    tick();
  }
  return count;
}

/** The wall-clock loop's perf stats (`window.openSinnohApp.loop`). */
export interface LoopStats {
  /** The speed asked for (1 = normal). */
  speed: number;
  /** Ticks per 30 Hz of wall time over the last full second (1 = normal speed). */
  effective: number;
  /** The last full second dropped ticks: the machine runs below `speed`. */
  behind: boolean;
  frames: number;
  ticks: number;
  /** Ticks dropped, in all: over the catch-up cap (slow frames, stalls) or fast ones over the tick budget. */
  dropped: number;
  /** Milliseconds of tick and render work per display frame, most recent last (at most 2048). */
  frameMs: number[];
  /** Milliseconds per tick, most recent last (at most 2048). */
  tickMs: number[];
  /** The page is hidden: the loop is stopped. */
  paused: boolean;
}

export interface LoopHooks {
  /** Runs one simulation tick. */
  tick(): void;
  /** Draws a frame; alpha in [0, 1) between the last two ticks. */
  render(alpha: number): void;
  /** A tick or frame threw: the loop has stopped. */
  onError(e: Error): void;
  /** The speed for this frame (default 1). */
  speed?(): number;
}

export function newLoopStats(): LoopStats {
  return { speed: 1, effective: 1, behind: false, frames: 0, ticks: 0, dropped: 0, frameMs: [], tickMs: [], paused: false };
}

/**
 * `wallClock: false` (replay mode) renders every frame but never ticks; only the bridge advances time.
 * `stats` is updated in place (pass one object to keep counting across restarts).
 */
export function startLoop(hooks: LoopHooks, wallClock: boolean, stats: LoopStats = newLoopStats()): () => void {
  let acc = 0;
  let last: number | null = null;
  let handle = 0;
  let windowStart: number | null = null;
  let windowTicks = 0;
  let windowDropped = 0;
  const timedTick = () => {
    const t = performance.now();
    hooks.tick();
    stats.tickMs.push(performance.now() - t);
    if (stats.tickMs.length > FRAME_SAMPLES) stats.tickMs.shift();
  };
  let stopped = false;
  const frame = (now: number) => {
    handle = requestAnimationFrame(frame);
    try {
      const t0 = performance.now();
      if (wallClock) {
        const speed = hooks.speed?.() ?? 1;
        if (speed !== stats.speed) {
          stats.speed = stats.effective = speed;
          stats.behind = false;
          // A new speed starts a new measuring window.
          windowStart = null;
          windowTicks = windowDropped = 0;
        }
        const step = stepClock(acc, last === null ? 0 : now - last, speed);
        last = now;
        acc = step.accumulator;
        const ran = runTicks(step.ticks, speed, timedTick, () => performance.now());
        const dropped = step.capped + step.ticks - ran;
        stats.ticks += ran;
        stats.dropped += dropped;
        windowStart ??= now;
        windowTicks += ran;
        windowDropped += dropped;
        if (now - windowStart >= 1000) {
          stats.effective = (windowTicks * TICK_MS) / (now - windowStart);
          stats.behind = windowDropped > 0;
          windowStart = now;
          windowTicks = windowDropped = 0;
        }
        hooks.render(step.alpha);
      } else hooks.render(1);
      stats.frames++;
      stats.frameMs.push(performance.now() - t0);
      if (stats.frameMs.length > FRAME_SAMPLES) stats.frameMs.shift();
    } catch (e) {
      stop();
      hooks.onError(e as Error);
    }
  };
  const visibility = () => {
    if (stopped) return;
    const visible = document.visibilityState !== 'hidden';
    stats.paused = !visible;
    cancelAnimationFrame(handle);
    if (visible) {
      // The clock starts afresh: nothing is caught up for the time the page was hidden.
      acc = 0;
      last = null;
      windowStart = null;
      windowTicks = windowDropped = 0;
      handle = requestAnimationFrame(frame);
    }
  };
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(handle);
    document.removeEventListener('visibilitychange', visibility);
  };
  document.addEventListener('visibilitychange', visibility);
  stats.paused = document.visibilityState === 'hidden';
  if (!stats.paused) handle = requestAnimationFrame(frame);
  return stop;
}
