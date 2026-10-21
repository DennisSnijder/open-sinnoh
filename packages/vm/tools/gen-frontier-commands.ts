/**
 * Generates packages/vm/src/data/frontier-commands.json from the pokeplatinum decomp: the Battle Frontier's script
 * commands (overlay 104), names and operand layouts only (no code). Run:
 * pnpm tsx packages/vm/tools/gen-frontier-commands.ts <path-to-pokeplatinum>
 *
 * Sources:
 *  - include/data/scripts/frscrcmd.h        opcode order → handler name (FrontierScrCmd_X)
 *  - asm/macros/frscrcmd.inc                operand sizes and names (the macro starting with `.short FRSCRCMD_X`)
 *  - src/overlay104/*.c                     how each operand is read: ReadByte / ReadHalfWord (a literal), GetVar
 *                                            (a var or a value: decomp FrontierScriptContext_GetVar), TryGetVarPointer
 *                                            (a var), ReadWord after the opcode (an offset)
 *  - include/constants/battle_frontier_movements.h   the frontier movement actions
 *  - res/field/frontier_scripts/fr_script.order       fr_script member names
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root: string = process.argv[2] ?? '';
if (!root) throw new Error('usage: gen-frontier-commands.ts <pokeplatinum dir>');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** FrontierScrCmd_CallBattleTowerFunction → fr_call_battle_tower_function; FrontierScrCmd_22 → fr_cmd_22. */
export function frontierOpName(handler: string): string {
  const base = handler.replace(/^FrontierScrCmd_/, '');
  if (/^[0-9A-F]{2}$/.test(base)) return `fr_cmd_${base.toLowerCase()}`;
  return `fr_${base
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/__+/g, '_')
    .toLowerCase()}`;
}

const handlers = [...read('include/data/scripts/frscrcmd.h').matchAll(/ScriptCommand\((\w+),\s*(\w+)\)/g)].map((m) => ({ constant: m[1]!, handler: m[2]! }));

interface Directive {
  size: 1 | 2 | 4;
  expr: string;
}
const macros = new Map<string, { name: string; params: string[]; dirs: Directive[] }>();
{
  let cur: { name: string; params: string[]; body: string[] } | null = null;
  for (const raw of read('asm/macros/frscrcmd.inc').split('\n')) {
    const line = raw.replace(/\/\/.*$|\/\*.*?\*\//g, '').trim();
    const m = /^\.macro\s+(\w+)\s*(.*)$/.exec(line);
    if (m) {
      cur = { name: m[1]!, params: m[2]!.split(',').map((p) => p.trim().split('=')[0]!.trim()).filter(Boolean), body: [] };
      continue;
    }
    if (line === '.endm' && cur) {
      const body = cur.body.filter((l) => l);
      // SetVar and CompareVar pick one of two opcodes by their operand (an .if around two .short lines).
      if (body[0]?.startsWith('.if')) {
        const ops = body.filter((l) => /^\.short\s+FRSCRCMD_\w+$/.test(l)).map((l) => l.split(/\s+/)[1]!);
        const rest = body.slice(body.indexOf('.endif') + 1);
        for (const op of ops) if (!macros.has(op)) macros.set(op, { name: cur.name, params: cur.params, dirs: rest.map(directive) });
      } else {
        const sm = body[0] && /^\.short\s+(FRSCRCMD_\w+)$/.exec(body[0]);
        const rest = body.slice(1);
        if (sm && rest.every((l) => /^\.(byte|short|long)\b/.test(l)) && !macros.has(sm[1]!)) macros.set(sm[1]!, { name: cur.name, params: cur.params, dirs: rest.map(directive) });
      }
      cur = null;
      continue;
    }
    if (cur) cur.body.push(line);
  }
}
function directive(l: string): Directive {
  const [kw, ...e] = l.split(/\s+/);
  return { size: kw === '.byte' ? 1 : kw === '.short' ? 2 : 4, expr: e.join(' ') };
}

// ---- C handlers: the reads in order
type How = 'literal' | 'vov' | 'var' | 'word';
const cReads = new Map<string, How[]>();
const dir = 'src/overlay104';
for (const f of readdirSync(join(root, dir)).filter((n) => n.endsWith('.c'))) {
  const src = read(join(dir, f));
  for (const m of src.matchAll(/BOOL\s+(FrontierScrCmd_\w+)\s*\(\s*FrontierScriptContext\s*\*\s*(\w+)\s*\)\s*\{/g)) {
    let i = m.index! + m[0].length;
    let depth = 1;
    const start = i;
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    const body = src.slice(start, i - 1);
    const ctx = m[2]!;
    const reads: How[] = [];
    for (const r of body.matchAll(new RegExp(`(?:(\\w+)\\s*=\\s*)?FrontierScriptContext_(ReadByte|ReadHalfWord|ReadWord|GetVar|TryGetVarPointer)\\s*\\(\\s*${ctx}\\s*\\)`, 'g'))) {
      const fn = r[2]!;
      if (fn === 'ReadByte') reads.push('literal');
      else if (fn === 'ReadWord') reads.push('word');
      else if (fn === 'GetVar') reads.push('vov');
      else if (fn === 'TryGetVarPointer') reads.push('var');
      else {
        // ReadHalfWord: a var id when the read value is passed to a var lookup (WaitTime, the menus' result var).
        const v = r[1];
        reads.push(v && new RegExp(`GetVarPointer\\s*\\(\\s*${ctx}\\s*,\\s*${v}\\b`).test(body) ? 'var' : 'literal');
      }
    }
    cReads.set(m[1]!, reads);
  }
}

interface Operand {
  name: string;
  type: 'u8' | 'u16' | 'u32' | 'rel';
  /**
   * u16: `vov` a var or a value (decomp FrontierScriptContext_GetVar: 0x8000–0x8013 are the frontier's vars), `var` a
   * frontier var, `sysvar` a field var (Set/GetSystemVar), `msg` a message of the scene's text bank. rel: `code` a
   * branch target, `movement` a movement list, `table` an inline table the command reads (`table` names its rows).
   */
  kind?: 'vov' | 'var' | 'sysvar' | 'msg' | 'code' | 'movement' | 'table';
}
/** The inline tables (decomp FrontierScrCmd_22/24/2A/2C): their rows, read until a 0xFD13 first field. */
const TABLES: Record<string, string> = {
  FRSCRCMD_22: 'objects',
  FRSCRCMD_24: 'actors',
  FRSCRCMD_2A: 'sprite-resources',
  FRSCRCMD_2C: 'sprites',
};
const BRANCHES = new Set(['FRSCRCMD_GOTO', 'FRSCRCMD_GOTOIF', 'FRSCRCMD_CALL', 'FRSCRCMD_CALLIF']);
const MESSAGES = new Set(['FRSCRCMD_MESSAGE', 'FRSCRCMD_MESSAGEINSTANT', 'FRSCRCMD_MESSAGENOSKIP']);
const SYSVARS = new Set(['FRSCRCMD_SETSYSTEMVAR', 'FRSCRCMD_GETSYSTEMVAR']);
let unverified = 0;
const commands = handlers.map(({ constant, handler }, opcode) => {
  const mac = macros.get(constant);
  if (!mac) throw new Error(`no macro for ${constant}`);
  const reads = cReads.get(handler);
  const sizesMatch = reads !== undefined && reads.length >= mac.dirs.length && mac.dirs.every((d, i) => (reads[i] === 'word') === (d.size === 4));
  if (!sizesMatch && mac.dirs.length) unverified++;
  const operands: Operand[] = mac.dirs.map((d, i) => {
    const name = /^\\(\w+)/.exec(d.expr)?.[1] ?? d.expr;
    if (/-\.-4$/.test(d.expr)) return { name, type: 'rel', kind: BRANCHES.has(constant) ? 'code' : constant === 'FRSCRCMD_APPLYMOVEMENT' ? 'movement' : TABLES[constant] ? 'table' : 'code' };
    const type = d.size === 1 ? 'u8' : d.size === 2 ? 'u16' : 'u32';
    const op: Operand = { name, type };
    if (type === 'u16') {
      if (MESSAGES.has(constant)) op.kind = 'msg';
      else if (SYSVARS.has(constant) && i === 0) op.kind = 'sysvar';
      else {
        // A var id read as a literal and kept for the resume (ShowYesNoMenu's ctx->data[0]) is a var too.
        const how = sizesMatch && !(reads[i] === 'literal' && /^destVar/.test(name)) ? reads[i] : /dest|result|var/i.test(name) ? 'var' : 'literal';
        if (how === 'vov' || how === 'var') op.kind = how;
      }
    }
    return op;
  });
  return { opcode, name: frontierOpName(handler), macro: mac.name, operands, ...(TABLES[constant] ? { table: TABLES[constant] } : {}), ...(sizesMatch || !mac.dirs.length ? {} : { unverified: true }) };
});

// ---- movement actions (FRONTIER_MOVEMENT_*)
const movementActions: string[] = [];
for (const m of read('include/constants/battle_frontier_movements.h').matchAll(/#define FRONTIER_MOVEMENT_(\w+)\s+(\d+)\b/g)) {
  if (m[1] === 'DELAY_OFFSET') continue;
  movementActions[Number(m[2])] = m[1]!.toLowerCase();
}

const scriptFiles = read('res/field/frontier_scripts/fr_script.order').split('\n').map((s) => s.trim().replace(/\.bin$/, '')).filter(Boolean);

const out = {
  note: 'Generated by packages/vm/tools/gen-frontier-commands.ts from pret/pokeplatinum: names and operand layouts only.',
  commands,
  movementActions: Array.from(movementActions, (m) => m ?? null),
  scriptFiles,
};
const json = `{\n${Object.entries(out)
  .map(([k, v]) => `"${k}": ${Array.isArray(v) ? `[\n${v.map((x) => ' ' + JSON.stringify(x)).join(',\n')}\n]` : JSON.stringify(v)}`)
  .join(',\n')}\n}\n`;
writeFileSync(join(import.meta.dirname, '../src/data/frontier-commands.json'), json);
console.log(`${commands.length} frontier commands (${unverified} with unverified C reads), ${movementActions.filter(Boolean).length} movement actions, ${scriptFiles.length} script files`);
