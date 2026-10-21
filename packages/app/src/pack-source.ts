/**
 * Where packs come from:
 * - dev/replay (`?packs=a,b`): the opensinnoh dev server (`pnpm opensinnoh dev <pack>...`, packages/cli plugin.ts)
 *     GET /__opensinnoh/packs.json[?packs=a,b] → { packs: PackData[] }, GET /__opensinnoh/assets/<pack>/<path>
 * - ROM: the imported base pack in IndexedDB (PackData JSON plus asset blobs, store.ts).
 * Mods (packs with a `base`) for the imported base: the original mods bundled into the build
 * (bundled-mods.ts), plus those the dev server serves when one runs (a served mod replaces a bundled
 * one with the same id, so it can be edited live).
 */
import type { PackData } from '@opensinnoh/core';
import type { AssetRef, AssetSource } from '@opensinnoh/contracts';
import { BUNDLED_MODS } from './bundled-mods.ts';
import { batchedReader, ImportIncompleteError, readFile, PACK_DATA_PATH } from './store.ts';

export interface ModInfo {
  id: string;
  name: string;
}

export interface PackSource {
  label: string;
  /** Mods enabled when the app opens (dev: the mod packs named in the URL). */
  initialMods: readonly string[];
  /** The base pack(s) plus the given mods (and their dependencies). */
  load(mods: readonly string[]): Promise<PackData[]>;
  /** Mods that fit this base. */
  mods(): Promise<ModInfo[]>;
  assets: AssetSource;
}

const DEV = '/__opensinnoh';

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${await res.text()}`);
  return res;
}

async function devPacks(ids?: readonly string[]): Promise<PackData[]> {
  const query = ids ? `?packs=${ids.map(encodeURIComponent).join(',')}` : '';
  return ((await (await fetchOk(`${DEV}/packs.json${query}`)).json()) as { packs: PackData[] }).packs;
}

/**
 * All packs the dev server serves, or [] when there is none: the request fails at the network level or
 * answers 404 (a production build). Any other failure (5xx, a body that is not the pack list) throws.
 */
export async function devPacksIfServed(get: typeof fetch = fetch): Promise<PackData[]> {
  const url = `${DEV}/packs.json`;
  let res: Response;
  try {
    // Asking for JSON only keeps SPA fallbacks (vite preview) from answering with index.html.
    res = await get(url, { headers: { accept: 'application/json' } });
  } catch (e) {
    if (e instanceof TypeError) return []; // fetch's network error
    throw e;
  }
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GET ${url}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`GET ${url}: not JSON (${res.headers.get('content-type') ?? 'no content type'})`);
  }
  const packs = (body as { packs?: unknown } | null)?.packs;
  if (!Array.isArray(packs)) throw new Error(`GET ${url}: no "packs" list`);
  return packs as PackData[];
}

const modsFor = (packs: readonly PackData[], bases: readonly string[]): ModInfo[] =>
  packs.filter((p) => p.manifest.base !== undefined && bases.includes(p.manifest.base)).map((p) => ({ id: p.manifest.id, name: p.manifest.name }));

/** The enabled mod list after toggling one mod on or off (order of enabling kept, no duplicates). */
export function toggleMod(enabled: readonly string[], id: string, on: boolean): string[] {
  const rest = enabled.filter((m) => m !== id);
  return on ? [...rest, id] : rest;
}

/**
 * Mods for one base pack: `bundled` mods, then `served()` ones (served wins on the same id).
 * `load([])` is the base (with its add-ons) alone; `load(ids)` appends those mods, failing on an unknown id.
 * Order: base, add-ons, mods (docs/decisions.md: mods override the HGSS follower add-on).
 */
export function modSource(base: PackData, bundled: readonly PackData[], served: () => Promise<PackData[]>, addons: readonly PackData[] = []): Pick<PackSource, 'load' | 'mods'> {
  const catalog = async () => {
    const all = new Map<string, PackData>();
    for (const p of [...bundled, ...(await served())]) if (p.manifest.base === base.manifest.id) all.set(p.manifest.id, p);
    return all;
  };
  return {
    async load(mods) {
      if (!mods.length) return [base, ...addons];
      const all = await catalog();
      return [base, ...addons, ...mods.map((id) => all.get(id) ?? fail(`mod ${id} is not available`))];
    },
    mods: async () => modsFor([...(await catalog()).values()], [base.manifest.id]),
  };
}

function splitRef(ref: AssetRef): { pack: string; path: string } {
  const i = ref.indexOf(':');
  if (i < 1) throw new Error(`bad asset ref ${ref}`);
  return { pack: ref.slice(0, i), path: ref.slice(i + 1) };
}

const devAsset = async (pack: string, path: string): Promise<Blob> =>
  (await fetchOk(`${DEV}/assets/${pack}/${path.split('/').map(encodeURIComponent).join('/')}`)).blob();

/** Packs named in the URL, served by the dev server. Base packs are fixed; mods among them start enabled. */
export async function devSource(ids: readonly string[]): Promise<PackSource> {
  if (!ids.length) throw new Error('?packs= needs at least one pack id');
  const named = await devPacks(ids);
  const bases = named.filter((p) => p.manifest.base === undefined).map((p) => p.manifest.id);
  const initialMods = named.filter((p) => p.manifest.base !== undefined && ids.includes(p.manifest.id)).map((p) => p.manifest.id);
  return {
    label: `dev packs ${ids.join(', ')}`,
    initialMods,
    load: (mods) => devPacks([...bases, ...mods]),
    mods: async () => modsFor(await devPacks(), bases),
    assets: { get: (ref) => devAsset(splitRef(ref).pack, splitRef(ref).path) },
  };
}

/**
 * The imported base pack in IndexedDB, the imported add-on (the HGSS follower art, `addonKey`) when there
 * is one, plus the bundled mods for that base and those of a running dev server.
 */
export async function importedSource(db: IDBDatabase, key: string, addonKey: string | null = null): Promise<PackSource> {
  const read = async (k: string) => {
    const blob = await readFile(db, k, PACK_DATA_PATH);
    if (!blob) throw new ImportIncompleteError('no pack data');
    return JSON.parse(await blob.text()) as PackData;
  };
  const base = await read(key);
  const addon = addonKey ? await read(addonKey) : null;
  // Each imported pack's assets come from its own import.
  const stored = new Map<string, string>([[base.manifest.id, key], ...(addon ? [[addon.manifest.id, addonKey!] as [string, string]] : [])]);
  const readAsset = batchedReader(db);
  return {
    label: `imported pack ${key}${addonKey ? ` with ${addonKey}` : ''}`,
    initialMods: [],
    ...modSource(base, BUNDLED_MODS, devPacksIfServed, addon ? [addon] : []),
    assets: {
      async get(ref) {
        const { pack, path } = splitRef(ref);
        const from = stored.get(pack);
        if (!from) return devAsset(pack, path);
        const b = await readAsset(from, path);
        if (!b) throw new ImportIncompleteError(`missing ${path} of pack ${pack}`);
        return b;
      },
    },
  };
}

function fail(message: string): never {
  throw new Error(message);
}
