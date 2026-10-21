/** Pack boundary: core loadPacks + strict record validation, then typed registries and labels. */
import { loadPacks, PackError, type Id, type LoadedPacks, type PackData, type RefKind } from '@opensinnoh/core';
import { REGISTRIES, type Labels, type Registries, type RegistryName } from '@opensinnoh/contracts';
import { recordRefs, validateRecord } from './record-schemas.ts';

export const ENGINE_VERSION = '0.1.0';

export interface GamePacks {
  loaded: LoadedPacks;
  registries: Registries;
  labels: Labels;
}

const known = (name: string) => (REGISTRIES as readonly string[]).includes(name);

/** What a cosmetic pack may touch: art only, nothing game state or rules read. */
const COSMETIC_REGISTRIES: readonly RegistryName[] = ['sprites', 'followers', 'followerTalk'];

/** The packs a save records and must match: cosmetic packs come and go without touching progress. */
export function savedPacks(loaded: LoadedPacks): { id: string; version: string }[] {
  return loaded.order.filter((p) => !p.cosmetic).map(({ id, version }) => ({ id, version }));
}

export function loadGamePacks(packs: readonly PackData[]): GamePacks {
  for (const p of packs) {
    const where = p.manifest.id;
    for (const name of Object.keys(p.registries)) if (!known(name)) throw new PackError(`${where}: unknown registry "${name}"`);
    for (const r of [...p.patches, ...p.remove]) if (!known(r.registry)) throw new PackError(`${where}: unknown registry "${r.registry}" (record ${r.id})`);
    if (p.manifest.cosmetic) {
      const touched = [...Object.keys(p.registries), ...p.patches.map((r) => r.registry), ...p.remove.map((r) => r.registry)];
      const bad = touched.find((name) => !(COSMETIC_REGISTRIES as readonly string[]).includes(name));
      if (bad) throw new PackError(`${where}: a cosmetic pack may only touch ${COSMETIC_REGISTRIES.join(', ')}, not "${bad}"`);
      if (Object.keys(p.scripts.labels).length > 0) throw new PackError(`${where}: a cosmetic pack may not bind script labels`);
    }
  }
  const loaded = loadPacks(packs, ENGINE_VERSION, validateRecord);
  const registries = Object.fromEntries(REGISTRIES.map((name) => [name, loaded.registries[name] ?? new Map()])) as unknown as Registries;
  const labels: Labels = new Map([...loaded.labels].map(([label, { pack, binding }]) => [label, { pack, commands: binding.commands }]));
  return { loaded, registries, labels };
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  location: string;
  message: string;
}

/** IR ref kinds → registries (`label` → labels). */
export const REF_KIND_TARGET: Record<RefKind, RegistryName | 'labels'> = {
  var: 'vars',
  flag: 'flags',
  label: 'labels',
  text: 'texts',
  movement: 'movements',
  species: 'species',
  item: 'items',
  map: 'zones',
  trainer: 'trainers',
};

/**
 * Static reference check (used by `opensinnoh check`): every record ref and IR `kind(id)` arg resolves,
 * assets exist (when `assetExists` is given), exactly one newGame record; unreachable labels warn.
 */
export function checkReferences(game: GamePacks, assetExists?: (ref: Id) => boolean): Diagnostic[] {
  const out: Diagnostic[] = [];
  const has = (to: RegistryName | 'labels', target: Id) => (to === 'labels' ? game.labels.has(target) : game.registries[to].has(target));
  const roots = new Set<Id>();
  for (const name of REGISTRIES) {
    for (const record of game.registries[name].values()) {
      for (const use of recordRefs(name, record as never)) {
        const location = `${name} ${record.id}${use.path ? ' ' + use.path : ''}`;
        if (use.to === 'assets') {
          if (assetExists && !assetExists(use.id)) out.push({ severity: 'error', location, message: `missing asset ${use.id}` });
          continue;
        }
        if (use.to === 'labels') roots.add(use.id);
        if (!has(use.to, use.id)) out.push({ severity: 'error', location, message: `unknown ${use.to} ${use.id}` });
      }
    }
  }
  const calls = new Map<Id, Id[]>();
  for (const [label, { commands }] of game.labels) {
    const targets: Id[] = [];
    commands.forEach((c, i) => {
      for (const a of c.args) {
        if (!('id' in a)) continue;
        const to = REF_KIND_TARGET[a.kind];
        if (to === 'labels') targets.push(a.id);
        if (!has(to, a.id)) out.push({ severity: 'error', location: `label ${label} #${i} ${c.op}`, message: `unknown ${to} ${a.id}` });
      }
    });
    calls.set(label, targets);
  }
  const reached = new Set<Id>();
  const queue = [...roots];
  while (queue.length) {
    const l = queue.pop()!;
    if (reached.has(l)) continue;
    reached.add(l);
    queue.push(...(calls.get(l) ?? []));
  }
  for (const label of game.labels.keys()) {
    if (!reached.has(label)) out.push({ severity: 'warning', location: `label ${label}`, message: 'unreachable: no record or reachable label refers to it' });
  }
  const newGames = game.registries.newGame.size;
  if (newGames !== 1) out.push({ severity: 'error', location: 'newGame', message: `expected exactly one newGame record, found ${newGames}` });
  const pockets = new Set([...game.registries.newGame.values()].flatMap((n) => n.pockets.map((p) => p.name)));
  for (const item of game.registries.items.values()) {
    if (!pockets.has(item.pocket)) out.push({ severity: 'error', location: `items ${item.id}`, message: `pocket "${item.pocket}" is not a newGame pocket` });
  }
  return out;
}
