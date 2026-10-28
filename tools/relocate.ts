/**
 * Finds the importer's US-pinned ROM regions in another build of Platinum (the German CPUD first):
 *
 *   pnpm relocate <target.nds> [--us <us.nds>] [--out <dir>]     (default out: .opensinnoh-cache/relocate)
 *
 * Prints a summary and writes `<gameCode>-rev<n>.json` (every pin: status, US and target offsets, the target's
 * SHA-1) to the gitignored out dir. With `--layout`, also the importer's layout for that build (offsets and hashes
 * only, no ROM bytes: committed), from the pins found and the manual entries in tools/relocate-pins.ts. With the US ROM, tables with pointers are found by masking pointer
 * words; without it, by mapping the target's pointers back through the moved data (function pointers then fail).
 * Method and status meanings: tools/relocate-scan.ts; the migration plan: docs/research/german-rom.md.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import charmapFile from '../packages/importer/data/charmap.json' with { type: 'json' };
import namesFile from '../packages/importer/data/names.json' with { type: 'json' };
import { decodeText } from '../packages/importer/src/formats/text.ts';
import { charTable, type CharmapFile, type NamesFile } from '../packages/importer/src/names.ts';
import { decodeMessageBank, NitroFs, readNarc, SUPPORTED_ROMS } from '../packages/nds/src/index.ts';
import { MANUAL, PINS } from './relocate-pins.ts';
import { relocate, sha1, type Modules, type Where } from './relocate-scan.ts';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { us: { type: 'string' }, out: { type: 'string', default: '.opensinnoh-cache/relocate' }, layout: { type: 'string' } } });
const [targetPath] = positionals;
if (!targetPath) {
  console.error('usage: pnpm relocate <target.nds> [--us <us.nds>] [--out <dir>] [--layout <packages/importer/src/layouts/x.ts>]');
  process.exit(2);
}

const load = (path: string) => {
  const bytes = new Uint8Array(readFileSync(path));
  return { fs: new NitroFs(bytes), sha1: sha1(bytes) };
};
const target = load(targetPath);
const us = values.us ? load(values.us) : null;
if (us && !SUPPORTED_ROMS[us.sha1]) throw new Error(`--us: SHA-1 ${us.sha1} is not the supported US ROM`);

/** Each module the pins use, as loaded in RAM (decompressed), with its RAM address. */
const modules = (fs: NitroFs): Modules => {
  const out: Modules = new Map();
  const wanted = new Set<Where>(PINS.map((p) => p.where));
  wanted.add('arm9');
  for (const w of wanted) {
    if (w === 'arm9') out.set(w, { bytes: fs.arm9Code(), ram: fs.header.arm9RamAddress });
    else out.set(w, { bytes: fs.overlayCode(w), ram: fs.overlays().find((o) => o.id === w)!.ramAddress });
  }
  return out;
};
const targetModules = modules(target.fs);
const usModules = us ? modules(us.fs) : undefined;
/** Without the US ROM, only arm9's RAM address is known; relocate() solves the overlays' from their pointer tables. */
const usRam = new Map<Where, number>(usModules ? [...usModules].map(([w, m]) => [w, m.ram]) : [['arm9', 0x02000000]]);

const h = target.fs.header;
const compressed = { arm9: target.fs.arm9Code().length !== target.fs.arm9().length, overlays: target.fs.overlays().filter((o) => o.compressed).map((o) => o.id) };
console.log(`target: ${h.title} ${h.gameCode} rev ${h.version}, SHA-1 ${target.sha1}`);
console.log(`compressed: arm9 ${compressed.arm9 ? 'yes' : 'no'}, overlays ${compressed.overlays.length ? compressed.overlays.join(', ') : 'none'}`);
console.log(`pins: ${PINS.length}${us ? ' (with the US ROM)' : ' (target only)'}`);

// Text and files: the importer needs pl_msg.narc's banks and messages to line up with names.json, every
// character in charmap.json, and its `/resource/eng/` paths (a localized build may name the folder after its language).
const names = namesFile as NamesFile;
const chars = charTable(charmapFile as CharmapFile);
const banks = readNarc(target.fs.file('/msgdata/pl_msg.narc'));
const stats = { unknownChars: new Map<number, number>() };
const bankMismatches: string[] = [];
banks.forEach((member, b) => {
  const msgs = decodeMessageBank(member);
  for (const codes of msgs) decodeText(codes, chars, stats);
  const named = names.textBanks[b]?.messages;
  if (named && named.length !== msgs.length) bankMismatches.push(`${b} ${names.textBanks[b]!.bank}: ${msgs.length} messages, names.json ${named.length}`);
});
const resourceDirs = [...new Set(target.fs.listPaths().filter((p) => p.startsWith('/resource/')).map((p) => p.split('/')[2]))];
const text = { banks: banks.length, namesBanks: names.textBanks.length, bankMismatches, unknownChars: Object.fromEntries([...stats.unknownChars].map(([c, n]) => [`0x${c.toString(16)}`, n])), resourceDirs };
console.log(`text: ${banks.length} banks (names.json ${names.textBanks.length}), ${bankMismatches.length} with other message counts, ${stats.unknownChars.size} unknown characters; /resource/: ${resourceDirs.join(', ')}`);
for (const m of bankMismatches) console.log(`  bank ${m}`);
for (const [c, n] of stats.unknownChars) console.log(`  unknown character 0x${c.toString(16)} ×${n}`);

const t0 = Date.now();
const { found, usRam: solvedRam } = relocate({ pins: PINS, target: targetModules, usRam, ...(usModules ? { us: usModules } : {}) });
const hex = (n: number | null) => (n === null ? null : `0x${n.toString(16)}`);
const signed = (n: number) => (n < 0 ? `-0x${(-n).toString(16)}` : `+0x${n.toString(16)}`);
const rows = found.map((f, i) => {
  const pin = PINS[i]!;
  const base = { key: f.key, where: pin.where, length: pin.length, us: hex(pin.offset), status: f.status };
  if (f.status === 'missing') return { ...base, predicted: hex(f.predicted), reason: f.reason };
  return { ...base, offset: hex(f.offset), shift: signed(f.offset - pin.offset), sha1: f.sha1, candidates: f.candidates, ...(f.status === 'relocated' ? { pointers: f.pointers } : {}) };
});

const count = (s: string) => found.filter((f) => f.status === s).length;
console.log(`same ${count('same')}, moved ${count('moved')}, relocated ${count('relocated')}, missing ${count('missing')} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const w of [...targetModules.keys()].sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))) {
  const mine = rows.filter((r) => r.where === w);
  if (!mine.length) continue;
  const shifts = new Set(mine.flatMap((r) => ('shift' in r ? [r.shift] : [])));
  console.log(`  ${w === 'arm9' ? 'arm9' : `ov${w}`}: ${mine.length} pins, shifts ${[...shifts].join(' ') || '—'}`);
}
for (const f of found) {
  if (f.status === 'missing') console.log(`  MISSING ${f.key} (predicted ${hex(f.predicted)}): ${f.reason}`);
  else if (f.candidates > 1) console.log(`  ambiguous ${f.key}: ${f.candidates} matches, took ${hex(f.offset)}`);
}

// Manual entries (tools/relocate-pins.ts) place the pins the scan can't prove.
const manual = MANUAL[`${h.gameCode}-rev${h.version}`] ?? {};
for (const key of Object.keys(manual)) if (!PINS.some((p) => p.key === key)) throw new Error(`manual entry ${key}: no such pin`);
const placed = found.map((f, i) => {
  const pin = PINS[i]!;
  const m = manual[f.key];
  if (!m) return f.status === 'missing' ? null : { key: f.key, offset: f.offset, sha1: f.sha1, count: null };
  if (f.status !== 'missing') throw new Error(`manual entry ${f.key}: the scan found it (${f.status} at ${hex(f.offset)}); remove the entry`);
  const length = (m.count ?? pin.length / pin.size) * pin.size;
  const bytes = targetModules.get(pin.where)!.bytes.subarray(m.offset, m.offset + length);
  if (bytes.length !== length) throw new Error(`manual entry ${f.key}: 0x${m.offset.toString(16)}+${length} is outside ${pin.where}`);
  console.log(`  manual ${f.key} at ${hex(m.offset)}${m.count === undefined ? '' : `, ${m.count} rows`}: ${m.why}`);
  return { key: f.key, offset: m.offset, sha1: sha1(bytes), count: m.count ?? null };
});

for (const [w, r] of solvedRam) if (!usRam.has(w)) console.log(`  solved US RAM address of ov${w}: ${hex(r)} (target ${hex(targetModules.get(w)!.ram)})`);

const outDir = resolve(values.out);
const outFile = join(outDir, `${h.gameCode}-rev${h.version}.json`);
try {
  execFileSync('git', ['check-ignore', '-q', outFile], { stdio: 'ignore' });
} catch {
  console.error(`refusing to write to ${outFile}: git check-ignore says it is not ignored`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const ramOf = (m: Modules) => Object.fromEntries([...m].map(([w, x]) => [w === 'arm9' ? 'arm9' : `ov${w}`, hex(x.ram)]));
writeFileSync(outFile, JSON.stringify({ rom: { gameCode: h.gameCode, revision: h.version, sha1: target.sha1 }, compressed, text, ram: { target: ramOf(targetModules), us: Object.fromEntries([...solvedRam].map(([w, r]) => [w === 'arm9' ? 'arm9' : `ov${w}`, hex(r)])) }, pins: rows }, null, 1) + '\n');
console.log(`wrote ${outFile}`);

if (values.layout) {
  const unplaced = PINS.filter((_, i) => !placed[i]);
  if (unplaced.length) {
    console.error(`no layout: ${unplaced.length} pins are neither found nor placed by hand (${unplaced.map((p) => p.key).join(', ')})`);
    process.exit(1);
  }
  // Only the pins that differ from US: the importer takes the rest from its own constants.
  const entries = placed.flatMap((p, i) => {
    const pin = PINS[i]!;
    if (p!.offset === pin.offset && p!.sha1 === pin.sha1 && p!.count === null) return [];
    return [`  '${p!.key}': { offset: 0x${p!.offset.toString(16)}, sha1: '${p!.sha1}'${p!.count === null ? '' : `, count: ${p!.count}`} },`];
  });
  const source = [
    '/**',
    ` * Where the importer's pinned tables are in ${h.title} ${h.gameCode} rev ${h.version} (whole-file SHA-1 ${target.sha1}), where`,
    ' * they differ from US rev 0. Generated by `pnpm relocate <rom> --layout <this file>` (tools/relocate.ts): do not edit;',
    ' * the pins placed by hand, and why, are in tools/relocate-pins.ts.',
    ' */',
    "import type { Layout } from '../layout.ts';",
    '',
    'export const LAYOUT: Layout = {',
    ...entries,
    '};',
    '',
  ].join('\n');
  writeFileSync(values.layout, source);
  console.log(`wrote ${values.layout} (${entries.length} of ${PINS.length} pins differ from US)`);
}
