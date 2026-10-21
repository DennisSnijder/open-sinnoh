/**
 * `pnpm perf`'s budget logic, pure so it is unit-tested (perf.test.ts): the measured
 * metrics of one section (a profile, `bundle` or `fixture`) against `perf-budgets.json`. Every budget is an upper
 * bound; a budgeted metric that was not measured fails (never passes silently).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Metric name → value (`frame.p95`, `heap.maxMB`, …). */
export type Metrics = Record<string, number>;
/** Section → metric → the most it may be. Keys starting with `_` are comments. */
export type Budgets = Record<string, Record<string, number | string>>;

export interface BudgetRow {
  section: string;
  metric: string;
  value: number | null;
  max: number;
  pass: boolean;
}

export function checkBudgets(section: string, metrics: Metrics, budgets: Budgets): BudgetRow[] {
  const limits = budgets[section];
  if (!limits) throw new Error(`perf-budgets.json has no section ${section}`);
  return Object.entries(limits)
    .filter(([metric]) => !metric.startsWith('_'))
    .map(([metric, max]) => {
      if (typeof max !== 'number') throw new Error(`perf-budgets.json ${section}.${metric}: ${JSON.stringify(max)} is not a number`);
      const value = metric in metrics ? metrics[metric]! : null;
      return { section, metric, value, max, pass: value !== null && Number.isFinite(value) && value <= max };
    });
}

export function formatRows(rows: readonly BudgetRow[]): string {
  return rows.map((r) => `${r.pass ? 'ok  ' : 'FAIL'} ${`${r.section} ${r.metric}`.padEnd(36)} ${r.value === null ? 'not measured' : String(r.value)} (budget ≤ ${r.max})`).join('\n');
}

/** A markdown table for the CI job summary. */
export function markdownRows(rows: readonly BudgetRow[]): string {
  return ['| | Metric | Value | Budget |', '|---|---|---|---|', ...rows.map((r) => `| ${r.pass ? 'ok' : '**FAIL**'} | ${r.section} ${r.metric} | ${r.value ?? 'not measured'} | ≤ ${r.max} |`)].join('\n');
}

/** Nearest-rank percentiles (2 decimals). */
export function summary(xs: readonly number[]): { n: number; p50: number; p95: number; p99: number; max: number } {
  const s = [...xs].sort((a, b) => a - b);
  const at = (p: number) => (s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]! * 100) / 100 : NaN);
  return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}

const kB = (n: number) => Math.round(n / 100) / 10;

/**
 * The built app's JS (Vite's `dist`): the ROM page's JS is what index.html loads before any dynamic import (its
 * entry and the entry's static imports, transitively); the import worker is its own; the error-report chunk
 * (Sentry, loaded only when the player allows reports) is its own; the game is every other JS file the app can load
 * (the lazy battle engine and the audio worklet included). gzip -9 kB.
 */
export function bundleMetrics(dist: string): { metrics: Metrics; files: Record<string, number> } {
  const assets = join(dist, 'assets');
  const gz = new Map<string, number>();
  for (const f of readdirSync(assets).filter((f) => f.endsWith('.js'))) gz.set(f, gzipSync(readFileSync(join(assets, f)), { level: 9 }).length);
  const html = readFileSync(join(dist, 'index.html'), 'utf8');
  const entries = [...html.matchAll(/<script[^>]+src="\/assets\/([^"]+\.js)"/g), ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/assets\/([^"]+\.js)"/g)].map((m) => m[1]!);
  if (!entries.length) throw new Error(`${dist}/index.html loads no /assets/*.js`);
  const rom = new Set<string>();
  const visit = (f: string) => {
    if (rom.has(f)) return;
    if (!gz.has(f)) throw new Error(`${f} is imported but not in ${assets}`);
    rom.add(f);
    const code = readFileSync(join(assets, f), 'utf8');
    // Static imports only (`import … from "./x.js"`, `import "./x.js"`); `import("./x.js")` is lazy.
    for (const m of code.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[\w$*{}\s,]+from\s*)?["']\.\/([^"']+\.js)["']/g)) visit(m[1]!);
  };
  for (const e of entries) visit(e);
  const worker = [...gz.keys()].filter((f) => f.startsWith('import-worker'));
  if (worker.length !== 1) throw new Error(`expected one import-worker chunk, found ${worker.length}`);
  const sentry = [...gz.keys()].filter((f) => f.startsWith('sentry-'));
  if (sentry.length !== 1) throw new Error(`expected one sentry chunk, found ${sentry.length}`);
  if (rom.has(sentry[0]!)) throw new Error(`${sentry[0]} is loaded by the ROM page: error reports must stay opt-in`);
  const sum = (fs: Iterable<string>) => [...fs].reduce((n, f) => n + gz.get(f)!, 0);
  const game = [...gz.keys()].filter((f) => !worker.includes(f) && !sentry.includes(f));
  return {
    metrics: { 'romPage.gzipKB': kB(sum(rom)), 'game.gzipKB': kB(sum(game)), 'importWorker.gzipKB': kB(sum(worker)), 'sentry.gzipKB': kB(sum(sentry)) },
    files: Object.fromEntries([...gz].sort((a, b) => b[1] - a[1]).map(([f, n]) => [`${rom.has(f) ? '[rom page] ' : ''}${f}`, kB(n)])),
  };
}
