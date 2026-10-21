/** `opensinnoh import <rom> --output <dir>`: imports the ROM and writes the base pack folder (ROM-derived: git-ignored only). */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { printIR, type PackData } from '@opensinnoh/core';
import { formatDistortionAudit, importPlatinum, type ImportReport } from '@opensinnoh/importer';

export interface ImportResult {
  output: string;
  report: ImportReport;
  /** Bytes written per file kind. */
  bytes: { data: number; scripts: number; assets: number };
  assetFiles: number;
  writeMs: number;
}

export function assertIgnored(output: string): void {
  try {
    execFileSync('git', ['check-ignore', '-q', resolve(output)], { stdio: 'ignore' });
  } catch (e) {
    throw new Error(`${output} is not git-ignored; ROM-derived output must never be committed (try .opensinnoh-cache/)`, { cause: e });
  }
}

/** Writes pack.json, data.json, scripts.ir and every asset file (pack-relative paths) into `dir`. */
export function writePackFolder(dir: string, pack: PackData, assets: ReadonlyMap<string, Uint8Array>): ImportResult['bytes'] & { files: number } {
  const write = (path: string, data: string | Uint8Array) => {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
    return typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  };
  write('pack.json', JSON.stringify(pack.manifest, null, 1) + '\n');
  const data = write('data.json', JSON.stringify(pack.registries));
  const scripts = write('scripts.ir', printIR(pack.scripts));
  let bytes = 0;
  for (const [path, file] of assets) bytes += write(path.replace(/^[a-z0-9-]+:/, ''), file);
  return { data, scripts, assets: bytes, files: assets.size };
}

export async function importRom(rom: string, output: string, progress: (line: string) => void = () => {}): Promise<ImportResult> {
  if (!existsSync(rom)) throw new Error(`no such ROM file: ${rom}`);
  if (existsSync(output)) throw new Error(`refusing to overwrite ${output}`);
  assertIgnored(output);
  const { pack, assets, report } = await importPlatinum(new Uint8Array(readFileSync(rom)), (stage, done, total) => progress(`${stage} ${done}/${total}`));
  const t0 = Date.now();
  const written = writePackFolder(output, pack, assets);
  return { output, report, bytes: { data: written.data, scripts: written.scripts, assets: written.assets }, assetFiles: written.files, writeMs: Date.now() - t0 };
}

export function importSummary(r: ImportResult): string {
  const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
  const unknowns = Object.entries(r.report.unknowns).map(([k, v]) => `${k} ${v.length}`);
  return [
    `imported ${r.report.rom} into ${r.output} in ${r.report.ms} ms (+${r.writeMs} ms writing)`,
    `  data.json ${mb(r.bytes.data)}, scripts.ir ${mb(r.bytes.scripts)}, ${r.assetFiles} asset files ${mb(r.bytes.assets)}`,
    `  ${Object.entries(r.report.counts).map(([k, v]) => `${k} ${v}`).join(', ')}`,
    `  unknowns: ${unknowns.join(', ') || 'none'}`,
    formatDistortionAudit(r.report.distortionWorld),
  ].join('\n');
}
