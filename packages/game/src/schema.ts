/**
 * A tiny strict JSON schema used at the boundaries (pack records, saves). Objects are closed (unknown
 * fields fail). `ref` fields are namespaced ids that must name a record of a registry, a script label
 * or a pack asset; `collectRefs` lists them for the reference check.
 */
import { isId, type Id } from '@opensinnoh/core';
import type { RegistryName } from '@opensinnoh/contracts';

export type RefTarget = RegistryName | 'labels' | 'assets';

export type Schema =
  | { t: 'str'; re?: RegExp }
  | { t: 'int'; min?: number; max?: number }
  | { t: 'num' }
  | { t: 'bool' }
  | { t: 'lit'; values: readonly (string | number)[] }
  | { t: 'id' }
  | { t: 'ref'; to: RefTarget }
  | { t: 'arr'; of: Schema }
  | { t: 'tuple'; of: Schema[] }
  | { t: 'obj'; fields: Record<string, Schema>; check?: (v: Record<string, unknown>) => string | undefined }
  | { t: 'opt'; of: Schema }
  | { t: 'nullable'; of: Schema }
  | { t: 'dict'; key: Schema; of: Schema }
  | { t: 'union'; of: Schema[] }
  | { t: 'tagged'; tag: string; cases: Record<string, Schema & { t: 'obj' }> };

export const str = (re?: RegExp): Schema => (re ? { t: 'str', re } : { t: 'str' });
export const int = (min?: number, max?: number): Schema => ({ t: 'int', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) });
export const num: Schema = { t: 'num' };
export const bool: Schema = { t: 'bool' };
export const lit = (...values: (string | number)[]): Schema => ({ t: 'lit', values });
export const id: Schema = { t: 'id' };
export const ref = (to: RefTarget): Schema => ({ t: 'ref', to });
export const arr = (of: Schema): Schema => ({ t: 'arr', of });
export const tuple = (...of: Schema[]): Schema => ({ t: 'tuple', of });
export const obj = (fields: Record<string, Schema>, check?: (v: Record<string, unknown>) => string | undefined): Schema & { t: 'obj' } =>
  check ? { t: 'obj', fields, check } : { t: 'obj', fields };
export const opt = (of: Schema): Schema => ({ t: 'opt', of });
export const nullable = (of: Schema): Schema => ({ t: 'nullable', of });
export const dict = (key: Schema, of: Schema): Schema => ({ t: 'dict', key, of });
export const union = (...of: Schema[]): Schema => ({ t: 'union', of });
export const tagged = (tag: string, cases: Record<string, Schema & { t: 'obj' }>): Schema => ({ t: 'tagged', tag, cases });

export class ValidationError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const show = (v: unknown) => (v === undefined ? 'nothing' : JSON.stringify(v)?.slice(0, 60));

function describe(s: Schema): string {
  switch (s.t) {
    case 'lit':
      return `one of ${s.values.map((v) => JSON.stringify(v)).join(', ')}`;
    case 'ref':
      return `an id (${s.to})`;
    case 'id':
      return 'an id (namespace:NAME)';
    case 'arr':
      return 'an array';
    case 'tuple':
      return `an array of ${s.of.length}`;
    case 'obj':
    case 'dict':
    case 'tagged':
      return 'an object';
    case 'union':
      return s.of.map(describe).join(' or ');
    case 'opt':
    case 'nullable':
      return describe(s.of) + (s.t === 'nullable' ? ' or null' : '');
    case 'str':
      return s.re ? `a string matching ${s.re}` : 'a string';
    case 'int':
      return `an integer${s.min !== undefined ? ` >= ${s.min}` : ''}${s.max !== undefined ? ` <= ${s.max}` : ''}`;
    case 'num':
      return 'a number';
    case 'bool':
      return 'a boolean';
  }
}

/**
 * Throws ValidationError naming the field path (e.g. `events.objects[0].sprite`). A value that passes (nearly always:
 * a whole pack's records at every start) is checked without building paths or errors; only a failing one is walked
 * again for the message.
 */
export function validate(s: Schema, v: unknown, path = ''): void {
  if (valid(s, v)) return;
  explain(s, v, path);
  throw new Error(`schema: explain() found nothing wrong with a value valid() refused, at ${path || '(root)'}`);
}

/** Whether `v` passes `s`: `explain` without paths or errors. */
function valid(s: Schema, v: unknown): boolean {
  switch (s.t) {
    case 'str':
      return typeof v === 'string' && (!s.re || s.re.test(v));
    case 'int':
      return Number.isInteger(v) && (s.min === undefined || (v as number) >= s.min) && (s.max === undefined || (v as number) <= s.max);
    case 'num':
      return typeof v === 'number' && Number.isFinite(v);
    case 'bool':
      return typeof v === 'boolean';
    case 'lit':
      return s.values.includes(v as string | number);
    case 'id':
    case 'ref':
      return typeof v === 'string' && isId(v);
    case 'arr':
      if (!Array.isArray(v)) return false;
      for (const x of v) if (!valid(s.of, x)) return false;
      return true;
    case 'tuple':
      if (!Array.isArray(v) || v.length !== s.of.length) return false;
      for (let i = 0; i < s.of.length; i++) if (!valid(s.of[i]!, v[i])) return false;
      return true;
    case 'obj': {
      if (!isObj(v)) return false;
      for (const k in v) if (!(k in s.fields)) return false;
      for (const k in s.fields) {
        const f = s.fields[k]!;
        if (f.t === 'opt') {
          if (v[k] !== undefined && !valid(f.of, v[k])) return false;
        } else if (!(k in v) || !valid(f, v[k])) return false;
      }
      return !s.check?.(v);
    }
    case 'opt':
      return v === undefined || valid(s.of, v);
    case 'nullable':
      return v === null || valid(s.of, v);
    case 'dict':
      if (!isObj(v)) return false;
      for (const k in v) if (!valid(s.key, k) || !valid(s.of, v[k])) return false;
      return true;
    case 'union':
      return s.of.some((u) => valid(u, v));
    case 'tagged': {
      if (!isObj(v)) return false;
      const c = s.cases[v[s.tag] as string];
      return !!c && valid(c, v);
    }
  }
}

/** Throws the ValidationError for a value `valid` refuses. */
function explain(s: Schema, v: unknown, path: string): void {
  const fail = (): never => {
    throw new ValidationError(`${path || '(root)'}: expected ${describe(s)}, got ${show(v)}`);
  };
  switch (s.t) {
    case 'str':
      if (typeof v !== 'string' || (s.re && !s.re.test(v))) fail();
      return;
    case 'int':
      if (!Number.isInteger(v) || (s.min !== undefined && (v as number) < s.min) || (s.max !== undefined && (v as number) > s.max)) fail();
      return;
    case 'num':
      if (typeof v !== 'number' || !Number.isFinite(v)) fail();
      return;
    case 'bool':
      if (typeof v !== 'boolean') fail();
      return;
    case 'lit':
      if (!s.values.includes(v as string | number)) fail();
      return;
    case 'id':
    case 'ref':
      if (typeof v !== 'string' || !isId(v)) fail();
      return;
    case 'arr':
      if (!Array.isArray(v)) fail();
      (v as unknown[]).forEach((x, i) => explain(s.of, x, `${path}[${i}]`));
      return;
    case 'tuple':
      if (!Array.isArray(v) || v.length !== s.of.length) fail();
      s.of.forEach((e, i) => explain(e, (v as unknown[])[i], `${path}[${i}]`));
      return;
    case 'obj': {
      if (!isObj(v)) fail();
      const o = v as Record<string, unknown>;
      for (const k of Object.keys(o)) if (!(k in s.fields)) throw new ValidationError(`${join(path, k)}: unknown field`);
      for (const [k, f] of Object.entries(s.fields)) {
        if (f.t === 'opt') {
          if (o[k] !== undefined) explain(f.of, o[k], join(path, k));
        } else if (!(k in o)) throw new ValidationError(`${join(path, k)}: missing (expected ${describe(f)})`);
        else explain(f, o[k], join(path, k));
      }
      const msg = s.check?.(o);
      if (msg) throw new ValidationError(`${path || '(root)'}: ${msg}`);
      return;
    }
    case 'opt':
      if (v !== undefined) explain(s.of, v, path);
      return;
    case 'nullable':
      if (v !== null) explain(s.of, v, path);
      return;
    case 'dict':
      if (!isObj(v)) fail();
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        explain(s.key, k, `${join(path, k)} (key)`);
        explain(s.of, x, join(path, k));
      }
      return;
    case 'union':
      if (!s.of.some((u) => valid(u, v))) fail();
      return;
    case 'tagged': {
      if (!isObj(v)) fail();
      const c = s.cases[(v as Record<string, unknown>)[s.tag] as string];
      if (!c) throw new ValidationError(`${join(path, s.tag)}: expected one of ${Object.keys(s.cases).map((k) => JSON.stringify(k)).join(', ')}`);
      explain(c, v, path);
      return;
    }
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

export interface RefUse {
  to: RefTarget;
  id: Id;
  path: string;
}

/** Lists every `ref` in an already validated value. */
export function collectRefs(s: Schema, v: unknown, path = '', out: RefUse[] = []): RefUse[] {
  switch (s.t) {
    case 'ref':
      out.push({ to: s.to, id: v as Id, path });
      break;
    case 'arr':
      (v as unknown[]).forEach((x, i) => collectRefs(s.of, x, `${path}[${i}]`, out));
      break;
    case 'tuple':
      s.of.forEach((e, i) => collectRefs(e, (v as unknown[])[i], `${path}[${i}]`, out));
      break;
    case 'obj':
      for (const [k, f] of Object.entries(s.fields)) if ((v as Record<string, unknown>)[k] !== undefined) collectRefs(f, (v as Record<string, unknown>)[k], join(path, k), out);
      break;
    case 'opt':
      if (v !== undefined) collectRefs(s.of, v, path, out);
      break;
    case 'nullable':
      if (v !== null) collectRefs(s.of, v, path, out);
      break;
    case 'dict':
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        collectRefs(s.key, k, `${join(path, k)} (key)`, out);
        collectRefs(s.of, x, join(path, k), out);
      }
      break;
    case 'union': {
      const u = s.of.find((c) => valid(c, v));
      if (u) collectRefs(u, v, path, out);
      break;
    }
    case 'tagged':
      collectRefs(s.cases[(v as Record<string, unknown>)[s.tag] as string]!, v, path, out);
      break;
    default:
      break;
  }
  return out;
}
