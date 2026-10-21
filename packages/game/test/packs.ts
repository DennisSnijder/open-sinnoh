import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readPackFolder, type PackData } from '@opensinnoh/core';

export const PACKS_DIR = join(import.meta.dirname, '../../../packs');

export function readPack(name: string): PackData {
  const root = join(PACKS_DIR, name);
  return readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), `packs/${name}`);
}

export function readReplay(pack: string, file: string): string {
  return readFileSync(join(PACKS_DIR, pack, 'replays', file), 'utf8');
}
