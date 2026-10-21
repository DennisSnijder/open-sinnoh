/**
 * Runs the asset import on a ROM and writes the files to a gitignored folder (default `rom-out/assets`).
 * Usage: OPENSINNOH_NDS_ROM=... pnpm tsx tools/model-viewer/import-assets.ts [--slice] [outDir]
 * Prints timing, counts and sizes. Output is ROM-derived: never commit it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NitroFs } from '@opensinnoh/nds';
import { importAssets } from '../../packages/importer/src/assets/index.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
if (!romPath) throw new Error('set OPENSINNOH_NDS_ROM');
const args = process.argv.slice(2);
const slice = args.includes('--slice');
const out = args.find((a) => !a.startsWith('--')) ?? join(import.meta.dirname, '../../rom-out/assets');

const fs = new NitroFs(new Uint8Array(readFileSync(romPath)));
const t0 = performance.now();
const result = importAssets(fs, { slice, log: (m) => console.log(m) });
const ms = performance.now() - t0;

const sizes = new Map<string, { files: number; bytes: number }>();
let total = 0;
for (const [path, bytes] of result.assets) {
  const parts = path.split('/');
  const kind = parts.length > 2 ? parts.slice(0, 2).join('/') : (parts[0] as string);
  const s = sizes.get(kind) ?? { files: 0, bytes: 0 };
  s.files++;
  s.bytes += bytes.length;
  sizes.set(kind, s);
  total += bytes.length;
  const file = join(out, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}
const records = JSON.stringify(result.records);
writeFileSync(join(out, 'records.json'), records);
console.log(`import ${slice ? '(slice)' : '(full)'}: ${ms.toFixed(0)} ms`);
console.log(`models ${result.records.models.length}, sprites ${result.records.sprites.length}, texture animations ${result.records.textureAnimations.length}`);
for (const [k, s] of sizes) console.log(`  ${k}: ${s.files} files, ${(s.bytes / 1e6).toFixed(2)} MB`);
console.log(`total assets ${(total / 1e6).toFixed(2)} MB in ${result.assets.size} files; records ${(records.length / 1e6).toFixed(2)} MB`);
for (const w of result.warnings) console.log(`warning: ${w}`);
