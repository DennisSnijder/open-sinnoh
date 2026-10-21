/**
 * RFC 6902 JSON Patch over plain JSON values. Returns a new value; the input is not mutated.
 * Packs are a boundary: a patch that does not apply throws with the failing op and path.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type PatchOp =
  | { op: 'add' | 'replace' | 'test'; path: string; value: JsonValue }
  | { op: 'remove'; path: string }
  | { op: 'move' | 'copy'; from: string; path: string };

export class PatchError extends Error {}

function parsePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new PatchError(`invalid JSON pointer "${pointer}"`);
  return pointer
    .slice(1)
    .split('/')
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

export function deepEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i] as JsonValue));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k] as JsonValue, b[k] as JsonValue));
  }
  return false;
}

function clone<T extends JsonValue>(v: T): T {
  return structuredClone(v);
}

function isObject(v: JsonValue | undefined): v is { [key: string]: JsonValue } {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getAt(doc: JsonValue, tokens: string[], pointer: string): JsonValue {
  let cur: JsonValue = doc;
  for (const t of tokens) {
    if (Array.isArray(cur)) {
      const i = arrayIndex(t, cur.length - 1, pointer);
      cur = cur[i] as JsonValue;
    } else if (isObject(cur) && Object.hasOwn(cur, t)) {
      cur = cur[t] as JsonValue;
    } else {
      throw new PatchError(`path "${pointer}" does not exist`);
    }
  }
  return cur;
}

function arrayIndex(token: string, max: number, pointer: string): number {
  if (!/^(0|[1-9][0-9]*)$/.test(token)) throw new PatchError(`bad array index in "${pointer}"`);
  const i = Number(token);
  if (i > max) throw new PatchError(`array index out of range in "${pointer}"`);
  return i;
}

function parentOf(doc: JsonValue, pointer: string): { parent: JsonValue; key: string } {
  const tokens = parsePointer(pointer);
  const key = tokens.pop();
  if (key === undefined) throw new PatchError('cannot target the document root here');
  return { parent: getAt(doc, tokens, pointer), key };
}

function add(doc: JsonValue, pointer: string, value: JsonValue): JsonValue {
  if (pointer === '') return value;
  const { parent, key } = parentOf(doc, pointer);
  if (Array.isArray(parent)) {
    if (key === '-') parent.push(value);
    else parent.splice(arrayIndex(key, parent.length, pointer), 0, value);
  } else if (isObject(parent)) {
    parent[key] = value;
  } else {
    throw new PatchError(`parent of "${pointer}" is not a container`);
  }
  return doc;
}

function remove(doc: JsonValue, pointer: string): { doc: JsonValue; removed: JsonValue } {
  const { parent, key } = parentOf(doc, pointer);
  if (Array.isArray(parent)) {
    const [removed] = parent.splice(arrayIndex(key, parent.length - 1, pointer), 1);
    return { doc, removed: removed as JsonValue };
  }
  if (isObject(parent) && Object.hasOwn(parent, key)) {
    const removed = parent[key] as JsonValue;
    delete parent[key];
    return { doc, removed };
  }
  throw new PatchError(`path "${pointer}" does not exist`);
}

export function applyPatch(input: JsonValue, ops: readonly PatchOp[]): JsonValue {
  let doc = clone(input);
  ops.forEach((op, index) => {
    try {
      switch (op.op) {
        case 'add':
          doc = add(doc, op.path, clone(op.value));
          break;
        case 'remove':
          doc = remove(doc, op.path).doc;
          break;
        case 'replace':
          getAt(doc, parsePointer(op.path), op.path);
          doc = op.path === '' ? clone(op.value) : add(remove(doc, op.path).doc, op.path, clone(op.value));
          break;
        case 'move': {
          if (op.path.startsWith(op.from + '/')) throw new PatchError('cannot move a value into itself');
          const r = remove(doc, op.from);
          doc = add(r.doc, op.path, r.removed);
          break;
        }
        case 'copy':
          doc = add(doc, op.path, clone(getAt(doc, parsePointer(op.from), op.from)));
          break;
        case 'test': {
          const actual = getAt(doc, parsePointer(op.path), op.path);
          if (!deepEqual(actual, op.value)) throw new PatchError(`test failed at "${op.path}"`);
          break;
        }
        default:
          throw new PatchError(`unknown op ${JSON.stringify(op)}`);
      }
    } catch (e) {
      if (e instanceof PatchError) throw new PatchError(`patch op #${index} (${op.op} ${op.path}): ${e.message}`);
      throw e;
    }
  });
  return doc;
}
