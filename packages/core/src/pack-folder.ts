import { parseIR } from './ir.ts';
import { validateManifest, PackError, type PackData, type RecordPatch, type RegistryRecord } from './packs.ts';
import type { Id } from './ids.ts';

/**
 * Reads a pack folder through `read(path)` (undefined = missing). Files: pack.json (required),
 * data.json, scripts.ir, patches.json, remove.json. Assets are read separately by AssetRef.
 */
export function readPackFolder(read: (path: string) => string | undefined, where: string): PackData {
  const json = <T>(path: string, fallback: T): T => {
    const text = read(path);
    if (text === undefined) return fallback;
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      throw new PackError(`${where}/${path}: ${(e as Error).message}`);
    }
  };
  const manifestText = read('pack.json');
  if (manifestText === undefined) throw new PackError(`${where}: missing pack.json`);
  const manifest = validateManifest(json('pack.json', null), `${where}/pack.json`);
  const registries = json<Record<string, RegistryRecord[]>>('data.json', {});
  for (const [name, records] of Object.entries(registries)) {
    if (!Array.isArray(records)) throw new PackError(`${where}/data.json: registry ${name} must be an array`);
  }
  const ir = read('scripts.ir');
  return {
    manifest,
    registries,
    scripts: ir === undefined ? { labels: {} } : parseIR(ir, `${where}/scripts.ir`),
    patches: json<RecordPatch[]>('patches.json', []),
    remove: json<{ registry: string; id: Id }[]>('remove.json', []),
    provenance: 'original',
  };
}
