import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadPacks, readPackFolder, type Id, type JsonValue } from '@opensinnoh/core';
import { REGISTRIES } from '@opensinnoh/contracts';

const root = join(import.meta.dirname, '../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);

/** Collects every string that looks like a fixture id or a `kind(id)` arg, to check references resolve (trainer classes, egg groups, battle effects (moves' and the AI script's) and an objective's badge are ids without a registry). */
function refs(v: JsonValue, out: Set<string>): Set<string> {
  if (typeof v === 'string' && /^fixture:[A-Z]/.test(v)) out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => refs(x, out));
  else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => k !== 'id' && k !== 'class' && k !== 'eggGroups' && k !== 'effect' && k !== 'battleEffects' && k !== 'badge' && refs(x, out));
  return out;
}

it('fixture pack loads and every reference resolves', () => {
  const pack = readPackFolder(read, 'packs/fixture');
  const loaded = loadPacks([pack], '0.1.0', (registry) => {
    if (!(REGISTRIES as readonly string[]).includes(registry)) throw new Error(`unknown registry ${registry}`);
  });
  const known = new Set<string>([...Object.values(loaded.registries).flatMap((m) => [...m.keys()]), ...loaded.labels.keys()]);
  const missing: string[] = [];
  for (const records of Object.values(loaded.registries)) for (const r of records.values()) for (const ref of refs(r, new Set())) if (!known.has(ref)) missing.push(`${r.id} -> ${ref}`);
  for (const [label, { binding }] of loaded.labels) {
    if (binding.kind !== 'ir') continue;
    for (const c of binding.commands) for (const a of c.args) if ('id' in a && !known.has(a.id)) missing.push(`${label} -> ${a.id}`);
  }
  expect(missing).toEqual([]);
  // Asset refs point at files in the pack.
  for (const m of loaded.registries.models!.values()) expect(existsSync(join(root, (m.gltf as Id).split(':')[1]!))).toBe(true);
  for (const s of loaded.registries.sprites!.values()) expect(existsSync(join(root, (s.atlas as Id).split(':')[1]!))).toBe(true);
  for (const f of loaded.registries.fonts!.values()) expect(existsSync(join(root, (f.atlas as Id).split(':')[1]!))).toBe(true);
});
