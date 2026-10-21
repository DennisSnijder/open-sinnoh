/** pnpm exec tsx tools/browser-profile.ts <before.json> [after.json]: timings, no ROM data. */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { JSONReport, JSONReportSuite } from '@playwright/test/reporter';

interface Row { file: string; title: string; project: string; ms: number; status: string }
interface Timing { kind: 'test' | 'hook'; name: string; ms: number }
function rows(report: JSONReport): Row[] {
  const out: Row[] = [];
  const walk = (suite: JSONReportSuite, parents: string[]) => {
    for (const spec of suite.specs) for (const test of spec.tests) for (const result of test.results) {
      if (result.status === 'skipped') continue;
      out.push({ file: spec.file, title: [...parents, spec.title].join(' › '), project: test.projectName, ms: result.duration, status: result.status ?? 'unknown' });
    }
    for (const child of suite.suites ?? []) walk(child, [...parents, child.title]);
  };
  for (const suite of report.suites) walk(suite, []);
  return out;
}
const read = (path: string): JSONReport => JSON.parse(readFileSync(path, 'utf8')) as JSONReport;
const seconds = (ms: number) => (ms / 1000).toFixed(1);
const cell = (s: string) => s.replaceAll('|', '\\|').replaceAll('\n', ' ');

/** Only shared hooks are extra: beforeEach/afterEach are already in test.duration. */
function sharedHooks(path: string): Map<string, number> {
  const file = join(dirname(path), 'browser.json');
  const totals = new Map<string, number>();
  if (!existsSync(file)) {
    console.log(`Shared-hook timings not recorded (${file}); spec totals include test durations only.\n`);
    return totals;
  }
  const entries = JSON.parse(readFileSync(file, 'utf8')) as Timing[];
  for (const entry of entries) {
    if (entry.kind !== 'hook' || !/ > (beforeAll|afterAll) hook$/.test(entry.name)) continue;
    const spec = entry.name.split(' > ').find((part) => part.endsWith('.spec.ts'));
    if (!spec) throw new Error(`timing hook has no spec: ${entry.name}`);
    const key = basename(spec);
    totals.set(key, (totals.get(key) ?? 0) + entry.ms);
  }
  return totals;
}

function printRun(label: string, path: string, report: JSONReport): void {
  const timing = join(dirname(path), 'time.txt');
  if (existsSync(timing)) {
    const line = readFileSync(timing, 'utf8').split('\n').find((line) => line.includes('Elapsed (wall clock) time'));
    if (!line) throw new Error(`${timing}: no complete /usr/bin/time wall-clock measurement`);
    const elapsed = line.slice(line.lastIndexOf(': ') + 2).trim();
    const ms = elapsed.split(':').reduce((n, part) => n * 60 + Number(part), 0) * 1000;
    if (!Number.isFinite(ms)) throw new Error(`${timing}: invalid elapsed time ${elapsed}`);
    console.log(`${label} full command: ${seconds(ms)} s (${elapsed}).`);
  }
  console.log(`${label} Playwright report: ${seconds(report.stats.duration)} s; ${report.stats.expected} passed, ${report.stats.unexpected} failed, ${report.stats.skipped} skipped.\n`);
}

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath) throw new Error('usage: browser-profile.ts <before.json> [after.json]');
const before = read(beforePath);
const first = rows(before);
printRun('Before', beforePath, before);
console.log('| Rank | Project | Spec / test | Test seconds | Status |\n| ---: | --- | --- | ---: | --- |');
for (const [i, r] of [...first].sort((a, b) => b.ms - a.ms).slice(0, 30).entries()) console.log(`| ${i + 1} | ${r.project} | ${cell(r.file)}: ${cell(r.title)} | ${seconds(r.ms)} | ${r.status} |`);
if (afterPath) {
  const after = read(afterPath);
  const last = rows(after);
  console.log('');
  printRun('After', afterPath, after);
  const key = (r: Row) => JSON.stringify([r.project, r.file, r.title]);
  const passingBefore = new Map(first.filter(r => r.status === 'passed').map(r => [key(r), r]));
  const matched = last.filter(r => r.status === 'passed' && passingBefore.has(key(r)));
  const matchedBefore = matched.reduce((ms, r) => ms + passingBefore.get(key(r))!.ms, 0);
  const matchedAfter = matched.reduce((ms, r) => ms + r.ms, 0);
  console.log(`Matched passing test bodies: ${matched.length} cases; before ${seconds(matchedBefore)} s, after ${seconds(matchedAfter)} s (shared hooks excluded).\n`);
  const beforeHooks = sharedHooks(beforePath), afterHooks = sharedHooks(afterPath);
  // These are sums of occupied-worker wall time: parallel tests overlap, so not suite elapsed time.
  console.log('| Spec | Before test + suite hooks s | After test + suite hooks s | Change | Before executed | After executed | Before shared hooks s | After shared hooks s |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const sum = (all: Row[], file: string, hooks: Map<string, number>) => all.filter((r) => r.file === file).reduce((ms, r) => ms + r.ms, hooks.get(basename(file)) ?? 0);
  for (const file of [...new Set([...first, ...last].map(r => r.file))].sort()) {
    const b = sum(first, file, beforeHooks), a = sum(last, file, afterHooks);
    const change = b === 0 ? 'new' : `${((a / b - 1) * 100).toFixed(1)}%`;
    console.log(`| ${cell(file)} | ${seconds(b)} | ${seconds(a)} | ${change} | ${first.filter(r => r.file === file).length} | ${last.filter(r => r.file === file).length} | ${seconds(beforeHooks.get(basename(file)) ?? 0)} | ${seconds(afterHooks.get(basename(file)) ?? 0)} |`);
  }
}
