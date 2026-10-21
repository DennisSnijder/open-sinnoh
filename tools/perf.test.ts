import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { bundleMetrics, checkBudgets, formatRows, summary, type Budgets } from './perf-check.ts';
import budgetsFile from './perf-budgets.json' with { type: 'json' };

const budgets: Budgets = { _: { _: 'comment' }, 'phone-4x': { _: 'a note', 'frame.p95': 8, 'frame.p99': 12, dropped: 0 } };

describe('checkBudgets', () => {
  it('passes values at or under the budget and fails those over it', () => {
    const rows = checkBudgets('phone-4x', { 'frame.p95': 8, 'frame.p99': 12.5, dropped: 0 }, budgets);
    expect(rows.map((r) => [r.metric, r.pass])).toEqual([
      ['frame.p95', true],
      ['frame.p99', false],
      ['dropped', true],
    ]);
    expect(formatRows(rows)).toContain('FAIL phone-4x frame.p99');
  });

  it('fails a budgeted metric that was not measured, or measured as NaN', () => {
    const rows = checkBudgets('phone-4x', { 'frame.p95': NaN, dropped: 0 }, budgets);
    expect(rows.find((r) => r.metric === 'frame.p95')!.pass).toBe(false);
    expect(rows.find((r) => r.metric === 'frame.p99')).toMatchObject({ value: null, pass: false });
    expect(formatRows(rows)).toContain('not measured');
  });

  it('refuses an unknown section and a non-number budget', () => {
    expect(() => checkBudgets('tablet', {}, budgets)).toThrow('no section tablet');
    expect(() => checkBudgets('x', {}, { x: { a: 'nine' } })).toThrow('is not a number');
  });

  it('the budgets file has the sections pnpm perf writes, with numbers only', () => {
    for (const section of ['bundle', 'fixture', 'desktop', 'phone-4x', 'phone-6x']) expect(() => checkBudgets(section, {}, budgetsFile as Budgets)).not.toThrow();
  });
});

describe('summary', () => {
  it('nearest-rank percentiles', () => {
    expect(summary([4, 1, 3, 2])).toEqual({ n: 4, p50: 3, p95: 4, p99: 4, max: 4 });
  });
});

describe('bundleMetrics', () => {
  const dist = mkdtempSync(join(tmpdir(), 'opensinnoh-perf-test-'));
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it('counts the entry and its static imports as the ROM page, lazy chunks as the game, the worker and the Sentry chunk apart', () => {
    mkdirSync(join(dist, 'assets'));
    const write = (f: string, code: string) => writeFileSync(join(dist, 'assets', f), code);
    writeFileSync(join(dist, 'index.html'), '<script type="module" crossorigin src="/assets/index-a.js"></script>');
    write('index-a.js', 'import{a as b}from"./shared-b.js";const g=()=>import("./game-c.js");' + 'x'.repeat(100));
    write('shared-b.js', 'export const a=1;' + 'y'.repeat(100));
    write('game-c.js', 'import"./shared-b.js";' + 'z'.repeat(5000));
    write('import-worker-d.js', 'w'.repeat(100));
    write('sentry-e.js', 's'.repeat(100) + 'q'.repeat(100));
    const gz = (s: string) => gzipSync(s, { level: 9 }).length;
    const { metrics } = bundleMetrics(dist);
    expect(metrics['romPage.gzipKB']).toBeCloseTo((gz('import{a as b}from"./shared-b.js";const g=()=>import("./game-c.js");' + 'x'.repeat(100)) + gz('export const a=1;' + 'y'.repeat(100))) / 1000, 1);
    expect(metrics['game.gzipKB']).toBeGreaterThan(metrics['romPage.gzipKB']!);
    expect(metrics['importWorker.gzipKB']).toBeCloseTo(gz('w'.repeat(100)) / 1000, 1);
    expect(metrics['sentry.gzipKB']).toBeCloseTo(gz('s'.repeat(100) + 'q'.repeat(100)) / 1000, 1);
    const index = 'import{a as b}from"./shared-b.js";const g=()=>import("./game-c.js");' + 'x'.repeat(100);
    expect(metrics['game.gzipKB']).toBeCloseTo((gz(index) + gz('export const a=1;' + 'y'.repeat(100)) + gz('import"./shared-b.js";' + 'z'.repeat(5000))) / 1000, 1);
    rmSync(join(dist, 'assets', 'sentry-e.js'));
    expect(() => bundleMetrics(dist)).toThrow(/expected one sentry chunk, found 0/);
  });
});
