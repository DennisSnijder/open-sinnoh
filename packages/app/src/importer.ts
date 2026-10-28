/** The ROM importer as the import worker runs it (kept apart from boot.ts so the worker does not load the engine). */
import type { PackData } from '@opensinnoh/core';
import type { HashedRom } from '@opensinnoh/nds';
import { HGSS_FOLLOWERS_VERSION, importHgssFollowers, importPlatinum, platinumSpeciesOf } from '@opensinnoh/importer';

export interface ImportProgress {
  stage: string;
  done: number;
  total: number;
}

/** Bump whenever the importer's output changes (records, assets, file layout): cached imports are then redone. */
export const IMPORTER_VERSION = 'platinum-112';

/** The ROM → the base pack's PackData and its assets (pack path → bytes). */
export async function runImporter(rom: HashedRom, onProgress: (p: ImportProgress) => void): Promise<{ pack: PackData; assets: Map<string, Uint8Array> }> {
  const { pack, assets } = await importPlatinum(rom, (stage, done, total) => onProgress({ stage, done, total }), {});
  return { pack, assets };
}

/** The HeartGold/SoulSilver follower add-on's version (its own cache key; importer `hgss/followers.ts`). */
export const ADDON_VERSION = HGSS_FOLLOWERS_VERSION;

/** The HGSS ROM → the `hgss-followers` add-on pack for a Platinum base, and its assets. */
export async function runAddonImporter(rom: HashedRom, onProgress: (p: ImportProgress) => void): Promise<{ pack: PackData; assets: Map<string, Uint8Array>; romName: string }> {
  const { pack, assets, rom: id } = await importHgssFollowers(rom, platinumSpeciesOf, (stage, done, total) => onProgress({ stage, done, total }));
  return { pack, assets, romName: id.name };
}
