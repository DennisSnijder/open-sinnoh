import { isId, type Id } from './ids.ts';

/**
 * Script IR: labelled command lists, one command per line. Text form:
 *
 *   fixture:Greeting::
 *     lock_all
 *     message text(fixture:Text_Welcome)
 *     set_var_from_value var(fixture:VAR_VISITS), 1
 *     end
 *
 * Args: integers, JSON strings, or `kind(Id)` references.
 */
export const REF_KINDS = ['var', 'flag', 'label', 'text', 'movement', 'species', 'item', 'map', 'trainer'] as const;
export type RefKind = (typeof REF_KINDS)[number];

export type Arg = { kind: 'int'; value: number } | { kind: 'string'; value: string } | { kind: RefKind; id: Id };
export interface Command {
  op: string;
  args: Arg[];
}
export interface ScriptIR {
  labels: Record<Id, Command[]>;
}

const OP_RE = /^[a-z][a-z0-9_]*$/;

function splitArgs(s: string, where: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (inStr) {
      cur += c;
      if (c === '\\') cur += s[++i] ?? '';
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      cur += c;
    } else if (c === ',') {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  if (inStr) throw new Error(`${where}: unterminated string`);
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseArg(s: string, where: string): Arg {
  if (/^-?\d+$/.test(s)) return { kind: 'int', value: Number(s) };
  if (/^0x[0-9a-fA-F]+$/.test(s)) return { kind: 'int', value: Number(s) };
  if (s.startsWith('"')) return { kind: 'string', value: JSON.parse(s) as string };
  const m = /^([a-z]+)\((.+)\)$/.exec(s);
  if (m && (REF_KINDS as readonly string[]).includes(m[1] as string) && isId(m[2] as string)) {
    return { kind: m[1] as RefKind, id: m[2] as Id };
  }
  throw new Error(`${where}: bad argument "${s}"`);
}

export function parseIR(text: string, source = 'ir'): ScriptIR {
  const labels: Record<Id, Command[]> = {};
  let current: Command[] | undefined;
  text.split('\n').forEach((raw, i) => {
    const where = `${source}:${i + 1}`;
    const line = raw.replace(/\s+$/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    if (trimmed.endsWith('::') && !/^\s/.test(line)) {
      const id = trimmed.slice(0, -2);
      if (!isId(id)) throw new Error(`${where}: bad label "${id}"`);
      if (labels[id]) throw new Error(`${where}: duplicate label ${id}`);
      current = labels[id] = [];
      return;
    }
    if (!current) throw new Error(`${where}: command outside a label`);
    const sp = trimmed.indexOf(' ');
    const op = sp < 0 ? trimmed : trimmed.slice(0, sp);
    if (!OP_RE.test(op)) throw new Error(`${where}: bad command "${op}"`);
    const args = sp < 0 ? [] : splitArgs(trimmed.slice(sp + 1), where).map((a) => parseArg(a, where));
    current.push({ op, args });
  });
  return { labels };
}

function printArg(a: Arg): string {
  if (a.kind === 'int') return String(a.value);
  if (a.kind === 'string') return JSON.stringify(a.value);
  return `${a.kind}(${a.id})`;
}

export function printIR(ir: ScriptIR): string {
  return Object.entries(ir.labels)
    .map(([id, cmds]) => `${id}::\n${cmds.map((c) => `  ${c.op}${c.args.length ? ' ' + c.args.map(printArg).join(', ') : ''}`).join('\n')}\n`)
    .join('\n');
}
