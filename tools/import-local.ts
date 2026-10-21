/**
 * Imports a Platinum ROM into a pack folder for inspection and local dev serving:
 *
 *   pnpm tsx tools/import-local.ts <rom.nds> [outDir]     (default outDir: .opensinnoh-cache/platinum)
 *
 * Writes pack.json, data.json and scripts.ir (plus any asset files) and prints an import report.
 * The output is ROM-derived, so the directory must be gitignored; anything else is refused.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { printIR } from '@opensinnoh/core';
import { importPlatinum } from '../packages/importer/src/index.ts';

const [romPath, outArg = '.opensinnoh-cache/platinum'] = process.argv.slice(2);
if (!romPath) {
  console.error('usage: tsx tools/import-local.ts <rom.nds> [outDir]');
  process.exit(2);
}
const outDir = resolve(outArg);
try {
  execFileSync('git', ['check-ignore', '-q', join(outDir, 'pack.json')], { stdio: 'ignore' });
} catch {
  console.error(`refusing to write ROM-derived files to ${outDir}: git check-ignore says it is not ignored`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const rom = new Uint8Array(readFileSync(romPath));
let last = '';
const { pack, assets, report } = await importPlatinum(rom, (stage, done, total) => {
  const line = `${stage} ${done}/${total}`;
  if (line !== last) process.stderr.write(`\r${line.padEnd(30)}`);
  last = line;
});
process.stderr.write('\n');

const write = (path: string, data: string | Uint8Array) => {
  const full = join(outDir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  return typeof data === 'string' ? Buffer.byteLength(data) : data.length;
};
const t0 = Date.now();
write('pack.json', JSON.stringify(pack.manifest, null, 1) + '\n');
const dataBytes = write('data.json', JSON.stringify(pack.registries));
const irBytes = write('scripts.ir', printIR(pack.scripts));
let assetBytes = 0;
for (const [ref, bytes] of assets) assetBytes += write(ref.replace(/^[^:]+:/, ''), bytes);
const sizes = Object.fromEntries(Object.entries(pack.registries).map(([k, v]) => [k, `${(JSON.stringify(v).length / 1e6).toFixed(2)} MB`]));

console.log(`import report (${report.rom})`);
console.log(`  import time  ${report.ms} ms (+${Date.now() - t0} ms writing)`);
console.log(`  data.json    ${(dataBytes / 1e6).toFixed(2)} MB, scripts.ir ${irBytes} B, ${assets.size} assets ${(assetBytes / 1e6).toFixed(2)} MB`);
console.log('  counts       ' + Object.entries(report.counts).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('  sizes        ' + Object.entries(sizes).map(([k, v]) => `${k} ${v}`).join(', '));
const unknownKinds = Object.entries(report.unknowns);
console.log(`  unknowns     ${unknownKinds.length ? '' : 'none'}`);
for (const [kind, list] of unknownKinds) {
  console.log(`    ${kind} (${list.length}): ${list.slice(0, 5).join('; ')}${list.length > 5 ? '; …' : ''}`);
}
console.log(`  wrote ${outDir}`);
