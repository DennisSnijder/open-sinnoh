/**
 * Prints the built app's JS chunks with gzip and brotli sizes (run after `pnpm build`):
 *
 *   pnpm tsx tools/bundle-size.ts [dist/assets]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dir = process.argv[2] ?? 'dist/assets';
const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
  const b = readFileSync(join(dir, f));
  const gz = gzipSync(b, { level: 9 }).length;
  const br = brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  console.log(`${f.padEnd(36)} ${kb(b.length).padStart(9)}  gzip ${kb(gz).padStart(7)}  brotli ${kb(br).padStart(7)}`);
}
