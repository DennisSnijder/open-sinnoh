/**
 * The battle soak at scale (not part of `pnpm check`): many seeded battles per facility through the real controller
 * and trainer AI (tests/battle-soak.ts), spread over worker processes. Findings are grouped by their message (numbers
 * stripped), each with the first seeds that reproduce it.
 *
 *   OPENSINNOH_NDS_ROM=/path/to/platinum.nds npx tsx tools/battle-soak.ts [--count 200] [--from 1] [--workers 6] [--only tower-single,hall-double]
 *
 * Reproduce one: `--only <facility> --from <seed> --count 1 --workers 1 --verbose`.
 */
import { fork } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { parseArgs } from 'node:util';
import { prepareRomCache, ROM, romSlice } from '../tests/rom.ts';
import { playSoak, SOAK_FACILITIES, soakCase, SoakFailure, soakWorld, type SoakFacility } from '../tests/battle-soak.ts';

interface Job {
  facility: SoakFacility;
  seed: number;
}
interface Outcome {
  facility: SoakFacility;
  seed: number;
  ok: boolean;
  outcome?: string;
  turns?: number;
  ms: number;
  error?: string;
  stack?: string;
  label?: string;
  recent?: string[];
  log?: string[];
  stubs?: Record<string, number>;
  events?: string[];
}

const { values } = parseArgs({ options: { count: { type: 'string', default: '50' }, from: { type: 'string', default: '1' }, workers: { type: 'string' }, only: { type: 'string' }, timeout: { type: 'string', default: '30' }, verbose: { type: 'boolean', default: false }, worker: { type: 'boolean', default: false } } });

if (values.worker) {
  const world = soakWorld(romSlice().pack);
  process.on('message', (job: Job | 'done') => {
    if (job === 'done') process.exit(0);
    const t0 = Date.now();
    let out: Outcome;
    try {
      const c = soakCase(world, job.facility, job.seed);
      try {
        const r = playSoak(world, c);
        out = { ...job, ok: true, outcome: r.outcome, turns: r.turns, ms: Date.now() - t0, stubs: r.stubs, events: r.events, ...(values.verbose ? { label: c.label } : {}) };
      } catch (e) {
        if (!(e instanceof SoakFailure)) throw e;
        const cause = e.cause as Error;
        out = { ...job, ok: false, ms: Date.now() - t0, error: cause?.message ?? String(cause), stack: cause?.stack, label: c.label, recent: e.recent, log: e.log, outcome: `turn ${e.turn}` };
      }
    } catch (e) {
      out = { ...job, ok: false, ms: Date.now() - t0, error: `setup: ${(e as Error).message}`, stack: (e as Error).stack };
    }
    process.send!(out);
  });
  process.send!('ready');
} else {
  if (!ROM) throw new Error('OPENSINNOH_NDS_ROM is not set');
  await prepareRomCache();
  const facilities = values.only ? (values.only.split(',') as SoakFacility[]) : [...SOAK_FACILITIES];
  for (const f of facilities) if (!SOAK_FACILITIES.includes(f)) throw new Error(`no facility ${f}`);
  const count = Number(values.count);
  const from = Number(values.from);
  const jobs: Job[] = [];
  for (let i = 0; i < count; i++) for (const facility of facilities) jobs.push({ facility, seed: from + i });
  const workers = Math.min(jobs.length, Number(values.workers ?? Math.max(1, availableParallelism() - 2)));
  const results: Outcome[] = [];
  const t0 = Date.now();
  const timeout = Number(values.timeout) * 1000;
  // One worker per lane; a battle past the timeout is a hang: the worker is killed and the lane starts another.
  const lane = (): Promise<void> =>
    new Promise<void>((resolve) => {
      const child = fork(import.meta.filename, ['--worker', ...(values.verbose ? ['--verbose'] : [])], { env: process.env, execArgv: ['--import', 'tsx'] });
      let current: Job | undefined;
      let timer: NodeJS.Timeout | undefined;
      let started = 0;
      const next = () => {
        current = jobs.shift();
        child.send(current ?? 'done');
        if (!current) return;
        started = Date.now();
        clearTimeout(timer);
        timer = setTimeout(() => {
          const m: Outcome = { ...current!, ok: false, ms: Date.now() - started, error: `hang: no end in ${values.timeout} s` };
          results.push(m);
          console.log(`FAIL ${m.facility} ${m.seed} ${m.error}`);
          child.kill('SIGKILL');
        }, timeout);
      };
      child.on('message', (m: Outcome | 'ready') => {
        if (m !== 'ready') {
          clearTimeout(timer);
          results.push(m);
          if (!m.ok || values.verbose) console.log(`${m.ok ? 'ok  ' : 'FAIL'} ${m.facility} ${m.seed} ${m.outcome ?? ''} ${m.turns ?? ''} ${m.ms}ms ${m.error ?? ''}${values.verbose && m.label ? `\n     ${m.label}` : ''}`);
          if (results.length % 500 === 0) console.log(`… ${results.length} battles, ${Math.round((Date.now() - t0) / 1000)} s`);
        }
        next();
      });
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        if (signal === 'SIGKILL' && jobs.length) void lane().then(resolve);
        else {
          if (code) console.log(`worker exited ${code}`);
          resolve();
        }
      });
    });
  await Promise.all(Array.from({ length: workers }, lane));
  const by = new Map<string, Outcome[]>();
  for (const r of results.filter((x) => !x.ok)) {
    const key = r.error!.replace(/\d+/g, 'N').slice(0, 200);
    by.set(key, [...(by.get(key) ?? []), r]);
  }
  console.log(`\n${results.length} battles in ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const f of facilities) {
    const mine = results.filter((x) => x.facility === f);
    console.log(`${f.padEnd(15)} ${mine.length} battles, ${mine.filter((x) => !x.ok).length} failed, ${mine.filter((x) => x.outcome === 'turn-cap').length} turn-capped, avg ${Math.round(mine.reduce((a, x) => a + x.ms, 0) / Math.max(1, mine.length))} ms`);
  }
  const stubs: Record<string, number> = {};
  // The battle's own fallbacks (protocol lines without a message are left out: they are display gaps, not decisions).
  for (const r of results) for (const [k, n] of Object.entries(r.stubs ?? {})) {
    if (k.includes('battle:protocol:') || k.includes('anim:')) continue;
    const key = k.split(':').slice(0, 3).join(':');
    stubs[key] = (stubs[key] ?? 0) + n;
  }
  console.log('\nstubs:', stubs);
  // Coverage of the mechanics the soak is meant to reach: battles in which each happened.
  const seen = new Map<string, number>();
  for (const r of results) for (const e of r.events ?? []) seen.set(e, (seen.get(e) ?? 0) + 1);
  const watch = ['Encore', 'Disable', 'Taunt', 'Imprison', 'Transform', 'Baton Pass', 'U-turn', 'Perish Song', 'Destiny Bond', 'Explosion', 'Self-Destruct', 'Trick', 'Switcheroo', 'Roar', 'Whirlwind', 'Pursuit', 'Hyper Beam', 'Giga Impact', 'Solar Beam', 'Fly', 'Dig', 'Bounce', 'Outrage', 'Thrash', 'Petal Dance', 'Rollout', 'Bide', 'Uproar', 'Mean Look', 'Block', 'Ingrain', 'Trick Room', 'Gravity', 'Sunny Day', 'Rain Dance', 'Sandstorm', 'Hail', 'Metronome', 'Mimic', 'Copycat', 'Me First', 'Sleep Talk', 'Snatch', 'Magic Coat', 'Future Sight', 'Doom Desire', 'Focus Punch', 'Counter', 'Mirror Coat', 'Metal Burst', 'Fling', 'Natural Gift', 'Struggle'];
  console.log(`\nmoves seen (battles): ${watch.map((m) => `${m} ${seen.get(`move:${m}`) ?? 0}`).join(', ')}`);
  console.log(`other: ${[...seen].filter(([k]) => !k.startsWith('move:')).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`distinct moves used: ${[...seen.keys()].filter((k) => k.startsWith('move:')).length}`);
  console.log(`\n${by.size} distinct findings`);
  for (const [key, rs] of by) {
    console.log(`\n### ${rs.length}× ${key}\n  seeds: ${rs.slice(0, 8).map((x) => `${x.facility}:${x.seed}`).join(' ')}`);
    const first = rs[0]!;
    console.log(`  ${first.label ?? ''}\n  recent: ${(first.recent ?? []).slice(-6).join(' ')}\n  ${(first.stack ?? '').split('\n').slice(1, 9).join('\n  ')}`);
    if (values.verbose) console.log(`  sim log:\n    ${(first.log ?? []).join('\n    ')}`);
  }
}
