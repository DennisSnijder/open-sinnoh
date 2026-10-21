import { type Id, isId, isPackId } from './ids.ts';
import { applyPatch, type JsonValue, type PatchOp } from './json-patch.ts';
import type { ScriptIR, Command } from './ir.ts';
import { satisfies } from './versions.ts';

/** Game-agnostic pack model. Registry names and record schemas are supplied by the game layer. */
export interface PackManifest {
  id: string;
  name: string;
  version: string;
  engine: string;
  base?: string;
  dependencies: Record<string, string>;
  loadAfter: string[];
  /**
   * Changes only how the game looks (the game layer limits which registries it may touch). Saves ignore
   * it, so it can be added or removed without losing progress.
   */
  cosmetic?: boolean;
}

export interface RegistryRecord {
  id: Id;
  [key: string]: JsonValue;
}

export interface RecordPatch {
  registry: string;
  id: Id;
  operations: PatchOp[];
}

export interface PackData {
  manifest: PackManifest;
  registries: Record<string, RegistryRecord[]>;
  scripts: ScriptIR;
  patches: RecordPatch[];
  remove: { registry: string; id: Id }[];
  provenance: 'original' | 'rom-derived';
}

export type LabelBinding = { kind: 'ir'; commands: Command[] };

export interface LabelOverride {
  label: Id;
  previousPack: string;
  pack: string;
}

export interface LoadedPacks {
  order: { id: string; version: string; cosmetic?: true }[];
  registries: Record<string, Map<Id, RegistryRecord>>;
  labels: Map<Id, { pack: string; binding: LabelBinding }>;
  overrides: LabelOverride[];
}

/** Validates a record of a registry (throw on error). Supplied by the game layer. */
export type RecordValidator = (registry: string, record: RegistryRecord) => void;

export class PackError extends Error {}

export function validateManifest(m: unknown, where: string): PackManifest {
  const fail = (msg: string): never => {
    throw new PackError(`${where}: ${msg}`);
  };
  if (typeof m !== 'object' || m === null) return fail('manifest must be an object');
  const o = m as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!['id', 'name', 'version', 'engine', 'base', 'dependencies', 'loadAfter', 'cosmetic'].includes(k)) fail(`unknown field "${k}"`);
  if (typeof o.id !== 'string' || !isPackId(o.id)) fail('id must match /^[a-z][a-z0-9-]*$/');
  if (typeof o.name !== 'string') fail('name must be a string');
  if (typeof o.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(o.version)) fail('version must be x.y.z');
  if (typeof o.engine !== 'string') fail('engine must be a semver range');
  if (o.base !== undefined && typeof o.base !== 'string') fail('base must be a pack id');
  const deps = o.dependencies ?? {};
  if (typeof deps !== 'object' || deps === null || Object.values(deps).some((v) => typeof v !== 'string')) fail('dependencies must map pack ids to ranges');
  const loadAfter = o.loadAfter ?? [];
  if (!Array.isArray(loadAfter) || loadAfter.some((v) => typeof v !== 'string')) fail('loadAfter must be a list of pack ids');
  if (o.cosmetic !== undefined && typeof o.cosmetic !== 'boolean') fail('cosmetic must be a boolean');
  return {
    id: o.id as string,
    name: o.name as string,
    version: o.version as string,
    engine: o.engine as string,
    ...(o.base !== undefined ? { base: o.base as string } : {}),
    dependencies: deps as Record<string, string>,
    loadAfter: loadAfter as string[],
    ...(o.cosmetic === true ? { cosmetic: true } : {}),
  };
}

/** Dependency order: base and dependencies are required, loadAfter is honoured when present. Stable for independent packs. */
export function resolvePackOrder(packs: readonly PackData[], engineVersion: string): PackData[] {
  const byId = new Map<string, PackData>();
  for (const p of packs) {
    if (byId.has(p.manifest.id)) throw new PackError(`duplicate pack id ${p.manifest.id}`);
    byId.set(p.manifest.id, p);
  }
  const out: PackData[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (p: PackData, chain: string[]): void => {
    const m = p.manifest;
    if (state.get(m.id) === 'done') return;
    if (state.get(m.id) === 'visiting') throw new PackError(`dependency cycle: ${[...chain, m.id].join(' -> ')}`);
    state.set(m.id, 'visiting');
    if (!satisfies(engineVersion, m.engine)) throw new PackError(`${m.id} needs engine ${m.engine}, have ${engineVersion}`);
    const required = { ...m.dependencies, ...(m.base && !(m.base in m.dependencies) ? { [m.base]: '*' } : {}) };
    for (const [dep, range] of Object.entries(required)) {
      const d = byId.get(dep);
      if (!d) throw new PackError(`${m.id} requires missing pack ${dep}`);
      if (!satisfies(d.manifest.version, range)) throw new PackError(`${m.id} requires ${dep} ${range}, have ${d.manifest.version}`);
      visit(d, [...chain, m.id]);
    }
    for (const after of m.loadAfter) {
      const d = byId.get(after);
      if (d) visit(d, [...chain, m.id]);
    }
    state.set(m.id, 'done');
    out.push(p);
  };
  for (const p of packs) visit(p, []);
  return out;
}

/**
 * Applies packs in order: add/replace records (later packs win), remove, patch, bind labels.
 * Disabling a pack = loading again without it; nothing is reverse-patched.
 */
export function loadPacks(
  packs: readonly PackData[],
  engineVersion: string,
  validate: RecordValidator,
): LoadedPacks {
  const ordered = resolvePackOrder(packs, engineVersion);
  const registries: Record<string, Map<Id, RegistryRecord>> = {};
  const labels = new Map<Id, { pack: string; binding: LabelBinding }>();
  const overrides: LabelOverride[] = [];
  const reg = (name: string) => (registries[name] ??= new Map());
  const bind = (pack: string, label: Id, binding: LabelBinding) => {
    const prev = labels.get(label);
    if (prev) overrides.push({ label, previousPack: prev.pack, pack });
    labels.set(label, { pack, binding });
  };

  for (const p of ordered) {
    const pid = p.manifest.id;
    for (const [name, records] of Object.entries(p.registries)) {
      const seen = new Set<Id>();
      for (const r of records) {
        if (!isId(r.id)) throw new PackError(`${pid}: ${name} record has invalid id "${r.id}"`);
        if (seen.has(r.id)) throw new PackError(`${pid}: duplicate ${name} record ${r.id}`);
        seen.add(r.id);
        reg(name).set(r.id, r);
      }
    }
    for (const { registry, id } of p.remove) {
      if (!reg(registry).delete(id)) throw new PackError(`${pid}: cannot remove missing ${registry} record ${id}`);
    }
    for (const patch of p.patches) {
      const current = reg(patch.registry).get(patch.id);
      if (!current) throw new PackError(`${pid}: cannot patch missing ${patch.registry} record ${patch.id}`);
      const next = applyPatch(current, patch.operations) as RegistryRecord;
      if (next.id !== patch.id) throw new PackError(`${pid}: patch may not change id of ${patch.id}`);
      reg(patch.registry).set(patch.id, next);
    }
    for (const [label, commands] of Object.entries(p.scripts.labels)) bind(pid, label as Id, { kind: 'ir', commands });
  }

  for (const [name, records] of Object.entries(registries)) {
    for (const r of records.values()) {
      try {
        validate(name, r);
      } catch (e) {
        throw new PackError(`${name} ${r.id}: ${(e as Error).message}`);
      }
    }
  }
  return { order: ordered.map((p) => ({ id: p.manifest.id, version: p.manifest.version, ...(p.manifest.cosmetic ? { cosmetic: true as const } : {}) })), registries, labels, overrides };
}
