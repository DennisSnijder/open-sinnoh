/** node tools/timing-summary.ts test-artifacts/timing/before */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = { kind: string; name: string; ms: number; state?: string };
const dir = process.argv[2];
if (!dir) throw new Error('usage: node tools/timing-summary.ts <timing directory>');
const unit = JSON.parse(readFileSync(join(dir, 'vitest.json'), 'utf8')) as Row[];
const browser = JSON.parse(readFileSync(join(dir, 'browser.json'), 'utf8')) as Row[];
const specs = new Map<string, number>();
for (const row of browser.filter((row) => row.kind === 'test' && row.state !== 'skipped')) {
  const name = row.name.split(' > ').filter(Boolean).slice(0, 2).join(' > ');
  specs.set(name, (specs.get(name) ?? 0) + row.ms);
}
for (const [title, rows] of [
  ['Unit files', unit.filter((row) => row.kind === 'file')],
  ['Unit tests', unit.filter((row) => row.kind === 'test')],
  ['Unit hooks (reporter-observed elapsed time)', unit.filter((row) => row.kind === 'hook')],
  ['Browser specs (sum of test durations)', [...specs].map(([name, ms]) => ({ name, ms }))],
  ['Browser tests', browser.filter((row) => row.kind === 'test')],
  ['Browser hooks', browser.filter((row) => row.kind === 'hook')],
] as const) {
  process.stdout.write(`\n### ${title}\n\n| Seconds | Name |\n| ---: | --- |\n`);
  for (const row of [...rows].sort((a, b) => b.ms - a.ms).slice(0, 10)) {
    process.stdout.write(`| ${(row.ms / 1000).toFixed(3)} | ${row.name.replace(/^ > /, '').replaceAll('|', '\\|')} |\n`);
  }
}
