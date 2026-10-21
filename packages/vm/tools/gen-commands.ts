/**
 * Generates packages/vm/src/data/commands.json from the pokeplatinum decomp: names and operand layouts only
 * (no code). Run: pnpm tsx packages/vm/tools/gen-commands.ts <path-to-pokeplatinum>
 *
 * Sources:
 *  - include/data/scripts/scrcmd.h          opcode order → handler name (ScrCmd_X)
 *  - asm/macros/scrcmd.inc                  operand sizes and names (the macro starting with `.short SCRCMD_X`)
 *  - src/**\/scrcmd*.c, src/scrcmd.c         how each u16 is read (literal, var id, var-or-value)
 *  - generated/movement_actions.txt         movement action names
 *  - res/field/scripts/scripts.order        scr_seq member names
 *  - src/script_manager.c + include/script_manager.h + generated/text_banks.txt   global script id ranges
 *  - generated/moves.txt                    move constant names by move id (MOVE_SURF = 57)
 */
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root: string = process.argv[2] ?? '';
if (!root) throw new Error('usage: gen-commands.ts <pokeplatinum dir>');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Op naming rule (docs/contracts.md): split at CamelCase, lower-case. Unnamed handlers (ScrCmd_0A2) → scr_cmd_0a2. */
export function opName(handler: string): string {
  const base = handler.replace(/^ScrCmd_/, '');
  if (/^[0-9A-F]{3}$/.test(base)) return `scr_cmd_${base.toLowerCase()}`;
  return base
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/__+/g, '_')
    .toLowerCase();
}

// ---- opcode table
const handlers = [...read('include/data/scripts/scrcmd.h').matchAll(/ScriptCommand\((\w+),\s*(\w+)\)/g)].map((m) => ({ constant: m[1]!, handler: m[2]! }));

// ---- macros
interface Directive {
  size: 1 | 2 | 4;
  expr: string;
  cond: boolean;
}
const macros = new Map<string, { name: string; params: string[]; dirs: Directive[] }>();
{
  const lines = read('asm/macros/scrcmd.inc').split('\n');
  let cur: { name: string; params: string[]; body: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\/\/.*$|\/\*.*?\*\//g, '').trim();
    const m = /^\.macro\s+(\w+)\s*(.*)$/.exec(line);
    if (m) {
      cur = { name: m[1]!, params: m[2]!.split(',').map((p) => p.trim().split('=')[0]!.trim()).filter(Boolean), body: [] };
      continue;
    }
    if (line === '.endm' && cur) {
      const first = cur.body.find((l) => l);
      const sm = first && /^\.short\s+(SCRCMD_\w+|ScrCmd_[A-Z]+)$/.exec(first);
      const rest = cur.body.slice(cur.body.indexOf(first!) + 1).filter((l) => l);
      if (sm && rest.every((l) => /^\.(byte|short|long|if|else|endif)\b/.test(l))) {
        let depth = 0;
        const dirs: Directive[] = [];
        for (const l of rest) {
          if (l.startsWith('.if')) depth++;
          else if (l.startsWith('.endif')) depth--;
          else if (!l.startsWith('.else')) {
            const [kw, ...e] = l.split(/\s+/);
            dirs.push({ size: kw === '.byte' ? 1 : kw === '.short' ? 2 : 4, expr: e.join(' '), cond: depth > 0 });
          }
        }
        const key = sm[1]!;
        const prev = macros.get(key);
        // First macro wins; aliases with the same layout follow it.
        if (!prev) macros.set(key, { name: cur.name, params: cur.params, dirs });
        else if (prev.dirs.map((d) => d.size).join() !== dirs.map((d) => d.size).join()) throw new Error(`${key}: macros ${prev.name} and ${cur.name} disagree`);
      }
      cur = null;
      continue;
    }
    if (cur) cur.body.push(line);
  }
}

// ---- C handlers: sequence of reads
type Read = { size: 1 | 2 | 4; how: 'literal' | 'var' | 'vov' };
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(join(root, dir))) {
    const p = join(dir, f);
    if (statSync(join(root, p)).isDirectory()) walk(p, out);
    else if (p.endsWith('.c')) out.push(p);
  }
  return out;
}
const cReads = new Map<string, Read[]>();
for (const file of walk('src')) {
  const src = read(file);
  if (!src.includes('ScrCmd_')) continue;
  for (const m of src.matchAll(/BOOL\s+(ScrCmd_\w+)\s*\(\s*ScriptContext\s*\*\s*\w+\s*\)\s*\{/g)) {
    let i = m.index! + m[0].length;
    let depth = 1;
    const start = i;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    const reads: Read[] = [];
    for (const r of body.matchAll(/(?:(\w+)\s*=\s*)?ScriptContext_(ReadByte|ReadHalfWord|ReadWord|GetVarPointer|TryGetVarPointer|GetVar)\s*\(/g)) {
      const fn = r[2]!;
      const prefix = body.slice(Math.max(0, r.index! - 40), r.index!);
      if (fn === 'ReadByte') reads.push({ size: 1, how: 'literal' });
      else if (fn === 'ReadWord') reads.push({ size: 4, how: 'literal' });
      else if (fn === 'GetVar') reads.push({ size: 2, how: 'vov' });
      else if (fn === 'GetVarPointer' || fn === 'TryGetVarPointer') reads.push({ size: 2, how: 'var' });
      else {
        // ReadHalfWord: a var id if it is passed straight (or via its variable) to a var lookup.
        let how: Read['how'] = 'literal';
        if (/TryGetVar\s*\([^;]*$/.test(prefix)) how = 'vov';
        else if (/GetVarPointer\s*\([^;]*$/.test(prefix)) how = 'var';
        const v = r[1];
        if (v) {
          const re = (fn2: string) => new RegExp(`${fn2}\\s*\\([^;]*\\b${v}\\b`);
          if (re('TryGetVar').test(body)) how = 'vov';
          else if (re('GetVarPointer').test(body) || re('GetVarAddress').test(body)) how = 'var';
        }
        reads.push({ size: 2, how });
      }
    }
    cReads.set(m[1]!, reads);
  }
}

// ---- merge
interface Operand {
  name: string;
  type: 'u8' | 'u16' | 'u32' | 'rel';
  /** u16 only: var = a var id (dest/src), vov = var-or-value (≥ 0x4000 → var), flag = flag id, msg = u8 message index. */
  kind?: 'var' | 'vov' | 'flag' | 'msg';
}
const VARIABLE: Record<string, string> = {
  SCRCMD_DOSTRENGTHFUNC: 'field_move',
  SCRCMD_DOFLASHFUNC: 'field_move',
  SCRCMD_DODEFOGFUNC: 'field_move',
  SCRCMD_DOGROUPCONNECTIONACTION: 'group_connection',
  SCRCMD_CALLTVBROADCAST: 'tv_broadcast',
  SCRCMD_MYSTERYGIFTGIVE: 'mystery_gift',
};
/**
 * Handlers whose reads the scan cannot follow, read by hand: ScrCmd_GivePoffin reads its dest var, then the five
 * flavours in a loop and the smoothness, each with ScriptContext_GetVar.
 */
const READS: Record<string, Read[]> = {
  ScrCmd_GivePoffin: [{ size: 2, how: 'var' }, ...Array.from({ length: 6 }, () => ({ size: 2 as const, how: 'vov' as const }))],
};
let unverified = 0;
const commands = handlers.map(({ constant, handler }, opcode) => {
  const mac = macros.get(constant);
  if (!mac) throw new Error(`no macro for ${constant}`);
  const reads = READS[handler] ?? cReads.get(handler) ?? [];
  const fixed = mac.dirs.filter((d) => !d.cond);
  const sizesMatch = reads.length >= fixed.length && fixed.every((d, i) => reads[i]!.size === d.size);
  if (!sizesMatch && fixed.length) unverified++;
  const operands: Operand[] = fixed.map((d, i) => {
    const param = /^\\(\w+)/.exec(d.expr)?.[1];
    const name = param ?? d.expr;
    if (/-\.-4$/.test(d.expr)) return { name, type: 'rel' };
    const type = d.size === 1 ? 'u8' : d.size === 2 ? 'u16' : 'u32';
    const op: Operand = { name, type };
    const how = sizesMatch ? reads[i]!.how : 'literal';
    if (type === 'u16') {
      if (how === 'var' || /(^|[a-z])(var|Var)(ID|Id)?\d?$|^varID/.test(name)) op.kind = how === 'vov' ? 'vov' : 'var';
      if (how === 'vov' || /valueOrVar/i.test(name)) op.kind = 'vov';
      if (!op.kind && /^flag(ID)?$|FlagID$/.test(name)) op.kind = 'flag';
    }
    if (type === 'u8' && /^(message|msg)(ID)?$/i.test(name)) op.kind = 'msg';
    return op;
  });
  return {
    opcode,
    name: opName(handler),
    macro: mac.name,
    operands,
    ...(VARIABLE[constant] ? { variable: VARIABLE[constant] } : {}),
    ...(sizesMatch || !fixed.length ? {} : { unverified: true }),
  };
});

// ---- movement actions
const movementActions: string[] = [];
let mv = 0;
for (const line of read('generated/movement_actions.txt').split('\n')) {
  const m = /^MOVEMENT_ACTION_(\w+)(?:\s*=\s*(\d+))?$/.exec(line.trim());
  if (!m) continue;
  if (m[2]) mv = Number(m[2]);
  movementActions[mv++] = m[1]!.toLowerCase();
}

// ---- script files and global ranges
const scriptFiles = read('res/field/scripts/scripts.order').split('\n').map((s) => s.trim()).filter(Boolean);
const textBanks = read('generated/text_banks.txt').split('\n').map((s) => s.trim()).filter(Boolean);
const offsets = new Map([...read('include/script_manager.h').matchAll(/#define (SCRIPT_ID_OFFSET_\w+)\s+(\d+)/g)].map((m) => [m[1]!, Number(m[2])]));
const scriptRanges = [...read('src/script_manager.c').matchAll(/Entry\((SCRIPT_ID_OFFSET_\w+),\s*(\w+),\s*(TEXT_BANK_\w+)\)/g)].map((m) => {
  const member = scriptFiles.indexOf(m[2]!);
  const textBank = textBanks.indexOf(m[3]!);
  if (member < 0 || textBank < 0 || !offsets.has(m[1]!)) throw new Error(`bad range ${m[0]}`);
  return { base: offsets.get(m[1]!)!, member, textBank };
});

// ---- move names (generated/moves.txt: one MOVE_* constant per line, in id order)
const moves = read('generated/moves.txt')
  .split('\n')
  .map((s) => s.trim())
  .filter((s) => s && s !== 'MAX_MOVES')
  .map((s) => {
    if (!/^MOVE_\w+$/.test(s)) throw new Error(`bad move line ${s}`);
    return s.slice('MOVE_'.length);
  });

const out = {
  note: 'Generated by packages/vm/tools/gen-commands.ts from pret/pokeplatinum: names and operand layouts only.',
  commands,
  movementActions: Array.from(movementActions, (m) => m ?? null),
  scriptFiles,
  scriptRanges,
  moves,
  dummyScript: { member: scriptFiles.indexOf('scripts_unk_0402'), textBank: textBanks.indexOf('TEXT_BANK_DUMMY_0355') },
};
// One entry per line keeps diffs readable.
const json = `{\n${Object.entries(out)
  .map(([k, v]) => `"${k}": ${Array.isArray(v) ? `[\n${v.map((x) => ' ' + JSON.stringify(x)).join(',\n')}\n]` : JSON.stringify(v)}`)
  .join(',\n')}\n}\n`;
writeFileSync(join(import.meta.dirname, '../src/data/commands.json'), json);
console.log(`${commands.length} commands (${unverified} with unverified C reads), ${movementActions.filter(Boolean).length} movement actions, ${scriptRanges.length} ranges`);
