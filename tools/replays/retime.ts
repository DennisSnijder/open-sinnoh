/**
 * Re-times a recorded replay (fixed `+N` waits, e.g. from the app's recorder) into the synced form of
 * docs/contracts.md "Replays": every input waits for the state it was recorded in, so timing shifts and
 * other seeds do not break it. Needs the ROM (OPENSINNOH_NDS_ROM); prints the new replay to stdout.
 *
 *   OPENSINNOH_NDS_ROM=… pnpm tsx tools/replays/retime.ts tests/rom-replays/cp2.replay [--trace]
 *
 * It plays the replay (after its `from` chain) once on seed 1, keeping the state after every tick, and
 * rewrites each timed line by what the game was doing when the line ran:
 * - a message waiting for input, a yes/no, a menu or the panel choice: `until message|yesno|menu|choice`
 *   then the line at +0; idle: `until idle` then +0 (only when an input came since the last wait);
 * - releasing a held direction after the player moved: `until position <x> <z>` (the tile at release);
 * - anything else (mid-scene asserts, screenshots, inputs mid-step): `+N` after the last sync point, with
 *   N taken from the recording (a sync point is a wait's first true tick or an input), so the scene
 *   timeline after it is the recorded one;
 * - A presses on messages until the scene ends idle or at a choice become one `advance text`;
 * - tile-by-tile walks (`until idle` after each step) become one leg per straight line.
 * Waits that took longer than 50 s in the recording get an explicit max (twice the recorded time).
 * `--trace` prints the recorded state before every line instead (for routing by hand).
 * The output is a draft: run it (tests/integration/checkpoints.rom.test.ts shifts and reseeds it) and
 * fix by hand what the recording did by luck (e.g. a wanderer that happened to be out of the way).
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parseReplay, type ReplayLine, type UntilCondition } from '@opensinnoh/core';
import { CountingStubLog, createGame, gameDriver, runReplay, runUntil, untilTarget, advanceMessage, advanceText, type Game, type ReplayDriver } from '@opensinnoh/game';
import { importPlatinum } from '@opensinnoh/importer';
import { createScriptRunner } from '@opensinnoh/vm';
import { createWorld } from '@opensinnoh/world';

type Cls = 'idle' | 'message' | 'yesno' | 'menu' | 'choice' | 'busy';
interface Tick {
  cls: Cls;
  zone: string;
  x: number;
  z: number;
}

function cls(game: Game): Cls {
  const v = game.scripts.view();
  if (v.yesNo) return 'yesno';
  if (v.menu) return 'menu';
  if (v.panel.kind === 'choice') return 'choice';
  if (v.message?.waitingForInput) return 'message';
  return game.canSave() ? 'idle' : 'busy';
}

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const romPath = process.env.OPENSINNOH_NDS_ROM;
if (!file || !romPath) {
  console.error('usage: OPENSINNOH_NDS_ROM=<rom> tsx tools/replays/retime.ts <file.replay> [--trace]');
  process.exit(2);
}
const dir = dirname(file);
const read = (f: string) => readFileSync(join(dir, f), 'utf8');
const text = readFileSync(file, 'utf8');
const replay = parseReplay(text);

const { pack } = await importPlatinum(new Uint8Array(readFileSync(romPath)), () => {}, { slice: true });
const game = createGame({ packs: [pack], createWorld, createScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => '1970-01-01T00:00:00.000Z' });
const resolve = (f: string) => ({ name: f, text: read(f) });

/** ticks[k]: the state after k ticks since reset (ticks[0]: after reset). */
const ticks: Tick[] = [];
const record = () => {
  const p = game.state.player;
  ticks.push({ cls: cls(game), zone: p.zone, x: p.x, z: p.z });
};
const tick = () => {
  game.tick();
  record();
};
const base = gameDriver(game);
const target = { ...untilTarget(game), tick };
const driver: ReplayDriver = {
  ...base,
  reset: (seed) => {
    base.reset(seed);
    // The runner resets again for its save round trip: keep the recording.
    if (ticks.length) return;
    record();
  },
  advance: (n) => {
    for (let i = 0; i < n; i++) tick();
  },
  until: (u: UntilCondition, max) => runUntil(target, u, max),
  advanceText: (max, close) => (close ? advanceMessage : advanceText)(target, max),
};

const chainTicks = replay.from ? (await runReplay(gameDriver(game), read(replay.from.file), { registries: game.registries, name: replay.from.file, resolve, repeat: false })).ticks : 0;
const at = new Map<number, { tick: number; before: Cls; line: ReplayLine }>();
const result = await runReplay(driver, text, {
  registries: game.registries,
  name: basename(file),
  resolve,
  repeat: false,
  beforeLine: (line, t) => void at.set(line.line, { tick: t, before: ticks[t]!.cls, line }),
});
if (!result.ok) throw new Error(`the recording does not pass: ${result.error}`);

const lines = text.split('\n');
const inputTicks = new Set([...at.values()].filter(({ line }) => ['press', 'release', 'touch', 'untouch'].includes(line.action.type)).map(({ tick: t }) => t));
if (args.includes('--trace')) {
  for (const [n, { tick: t, before }] of [...at].sort(([a], [b]) => a - b)) {
    const s = ticks[t]!;
    console.log(`L${n} t${t} ${lines[n - 1]!.trim().padEnd(40)} | ${s.zone.replace(/^.*MAP_HEADER_/, '')} ${s.x},${s.z} ${before}`);
  }
  process.exit(0);
}

/** First tick in (from, to] where `ok` holds (idle: two idle ticks in a row), else `to`. */
function firstTick(from: number, to: number, ok: (s: Tick, k: number) => boolean): number {
  for (let k = from + 1; k <= to; k++) if (ok(ticks[k]!, k)) return k;
  return to;
}
const isIdle = (_: Tick, k: number) => ticks[k]!.cls === 'idle' && ticks[k - 1]?.cls === 'idle';
const maxFor = (ticksTaken: number) => (ticksTaken > 1500 ? ` ${Math.ceil((ticksTaken * 2) / 100) * 100}` : '');
const DIRS = new Set(['up', 'down', 'left', 'right']);

/** `tick`: the recorded tick the op stands for (a wait: its first true tick). */
type Op = { kind: 'text' | 'a'; text: string; tick: number } | { kind: 'wait'; until: Cls; text: string; tick: number };
const out: Op[] = [];
/** Recorded tick of the last sync point (a wait's first true tick, or an input). */
let anchor = chainTicks;
/** An input came since the last wait. */
let dirty = true;
/** Held directions: recorded position at the press. */
const held = new Map<string, Tick>();
let index = 0;

for (let n = 1; n <= lines.length; n++) {
  const raw = lines[n - 1]!;
  const rec = at.get(n);
  if (!rec) {
    // Comments, blank lines, `from`, setup lines; and timed lines the runner did not report (none).
    if (replay.lines[index]?.line === n) throw new Error(`line ${n}: not traced`);
    out.push({ kind: 'text', text: raw, tick: anchor });
    continue;
  }
  index++;
  const { tick: t, before, line } = rec;
  const a = line.action;
  const body = raw.trim().replace(/^(\+?\d+)\s+/, '');
  const rel = (k: number) => `+${k - anchor} ${body}`;

  if (a.type === 'until') {
    // Recorded waits stay; they sync.
    anchor = firstTick(t, ticks.length - 1, a.until.kind === 'idle' ? isIdle : () => true);
    out.push({ kind: 'wait', until: a.until.kind === 'idle' ? 'idle' : 'busy', text: body, tick: anchor });
    dirty = false;
    continue;
  }
  if (a.type === 'advance-text') throw new Error(`line ${n}: already synced`);

  if (a.type === 'release' && DIRS.has(a.button)) {
    const from = held.get(a.button);
    held.delete(a.button);
    const now = ticks[t]!;
    if (from && (from.x !== now.x || from.z !== now.z || from.zone !== now.zone)) {
      const s = firstTick(anchor, t, (k) => k.x === now.x && k.z === now.z && k.zone === now.zone);
      const early = ticks.slice(anchor + 1, s).some((k) => k.x === now.x && k.z === now.z);
      out.push({ kind: 'wait', until: 'busy', text: `until position ${now.x} ${now.z}${maxFor(s - anchor)}${early ? '  # CHECK: same tile in another zone first' : ''}`, tick: s });
      out.push({ kind: 'text', text: `+0 ${body}`, tick: s });
      anchor = s;
      dirty = true;
      continue;
    }
  }

  const input = a.type === 'press' || a.type === 'release' || a.type === 'touch' || a.type === 'untouch';
  // The state has not moved on since the last wait (no input, the same state every tick since).
  const steady = !dirty && ticks.slice(anchor + 1, t + 1).every((k) => k.cls === before);
  if (t === anchor || (steady && before !== 'busy')) {
    out.push({ kind: 'text', text: `+0 ${body}`, tick: t });
  } else if (before === 'busy' || a.type === 'release') {
    // Mid-scene, or the end of a press: the recorded delay after the last sync point.
    out.push({ kind: 'text', text: rel(t), tick: t });
    anchor = t;
  } else {
    const s = firstTick(anchor, t, before === 'idle' ? isIdle : (k) => k.cls === before);
    // `until idle` needs two idle ticks; a line recorded in a one-tick gap between scenes needs a hand fix.
    const gap = before === 'idle' && !isIdle(ticks[s]!, s) && s + 1 < ticks.length && ticks[s + 1]!.cls !== 'idle' && !inputTicks.has(s) ? '  # CHECK: idle for one tick only' : '';
    out.push({ kind: 'wait', until: gap ? 'busy' : before, text: `until ${before}${maxFor(s - anchor)}${gap}`, tick: s });
    out.push({ kind: a.type === 'press' && a.button === 'a' && before === 'message' ? 'a' : 'text', text: `+0 ${body}`, tick: t });
    anchor = t;
    dirty = false;
  }
  if (a.type === 'press' && DIRS.has(a.button)) held.set(a.button, ticks[t]!);
  if (input) {
    anchor = t;
    dirty = true;
  }
}

// `until message`, A down, A up … until the scene is idle or at a choice → `advance text`.
const final: string[] = [];
for (let i = 0; i < out.length; ) {
  const run: number[] = [];
  let j = i;
  const comments: string[] = [];
  for (;;) {
    let k = j;
    const skipped: string[] = [];
    while (out[k]?.kind === 'text' && /^\s*(#.*)?$/.test(out[k]!.text)) skipped.push(out[k++]!.text);
    const w = out[k];
    const p = out[k + 1];
    const r = out[k + 2];
    if (w?.kind === 'wait' && w.until === 'message' && p?.kind === 'a' && r?.kind === 'text' && /^\+\d+ release a$/.test(r.text)) {
      comments.push(...skipped);
      run.push(p.tick);
      j = k + 3;
      continue;
    }
    break;
  }
  let k = j;
  while (out[k]?.kind === 'text' && /^\s*(#.*)?$/.test(out[k]!.text)) k++;
  const next = out[k];
  const ends = next === undefined || (next.kind === 'wait' && next.until !== 'message' && next.until !== 'busy');
  if (run.length && ends) {
    final.push(...comments);
    final.push(`advance text${maxFor((next?.tick ?? ticks.length - 1) - run[0]!)}`);
    // advance text ends idle or at a choice: the wait after it is implied when it is `until idle`.
    for (let m = j; m < k; m++) final.push(out[m]!.text);
    i = next?.kind === 'wait' && next.until === 'idle' ? k + 1 : k;
    continue;
  }
  final.push(out[i]!.text);
  i++;
}
// Walks: one tile per leg with `until idle` between (how the recordings step) → one leg per straight
// line, and turns without stopping (the same tiles; a leg that triggered a script would not be followed
// by `until idle`).
const leg = (i: number) => {
  const m = /^\+0 press (up|down|left|right)$/.exec(final[i] ?? '');
  return m && /^until position /.test(final[i + 1] ?? '') && final[i + 2] === `+0 release ${m[1]}` ? m[1] : null;
};
for (let i = 0; i < final.length; i++) {
  // Keep B (running) held from one leg to the next.
  if (final[i] === '+0 release b' && (final[i + 1] === 'until idle' ? final[i + 2] === '+0 press b' : /^\+\d+ press b$/.test(final[i + 1] ?? ''))) {
    final.splice(i, final[i + 1] === 'until idle' ? 3 : 2);
    i = Math.max(-1, i - 5);
    continue;
  }
  const d = leg(i);
  if (!d || final[i + 3] !== 'until idle') continue;
  const next = leg(i + 4);
  if (!next) continue;
  if (next === d) final.splice(i + 1, 4);
  else final.splice(i + 3, 1);
  i--;
}
process.stdout.write(final.join('\n'));
