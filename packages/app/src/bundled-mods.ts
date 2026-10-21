/**
 * Original mod packs bundled into the app build. They hold no ROM content (their records patch and
 * override the player's imported base pack), so they ship with the app. The Mods menu offers those
 * whose base is loaded: `platinum-demo` when the imported `platinum` base runs.
 * To bundle another original mod, add its folder to the glob below (assets are not bundled yet).
 */
import { readPackFolder, type PackData } from '@opensinnoh/core';

/** Groups `/packs/<folder>/<file>` sources by folder and reads each folder as a pack. */
export function packsFromFiles(files: Readonly<Record<string, string>>): PackData[] {
  const folders = new Map<string, Map<string, string>>();
  for (const [path, text] of Object.entries(files)) {
    const m = /^\/?packs\/([^/]+)\/([^/]+)$/.exec(path);
    if (!m) throw new Error(`bundled mod file outside packs/<folder>/: ${path}`);
    if (!folders.has(m[1]!)) folders.set(m[1]!, new Map());
    folders.get(m[1]!)!.set(m[2]!, text);
  }
  return [...folders].sort(([a], [b]) => (a < b ? -1 : 1)).map(([folder, f]) => readPackFolder((p) => f.get(p), `packs/${folder}`));
}

const FILES = import.meta.glob(['/packs/platinum-demo/*.json', '/packs/platinum-demo/*.ir'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const BUNDLED_MODS: readonly PackData[] = packsFromFiles(FILES);
