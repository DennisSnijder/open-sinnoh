/** Finds a pack folder and its dependencies on disk (sibling folders by manifest id, or --dependency). */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { ReplayResolver } from '@opensinnoh/game';
import { PackError, readPackFolder, type Id, type PackData } from '@opensinnoh/core';

export interface Workspace {
  /** Requested pack id. */
  pack: string;
  /** All packs (requested + dependencies), in discovery order; loadPacks orders them. */
  packs: PackData[];
  /** Pack id → folder. */
  dirs: Map<string, string>;
}

export function readPackDir(dir: string): PackData {
  const read = (p: string) => {
    const file = join(dir, p);
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  };
  return readPackFolder(read, dir);
}

function siblingPacks(parent: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(parent)) {
    const dir = join(parent, name);
    const manifest = join(dir, 'pack.json');
    if (!statSync(dir).isDirectory() || !existsSync(manifest)) continue;
    const id = (JSON.parse(readFileSync(manifest, 'utf8')) as { id?: unknown }).id;
    if (typeof id === 'string') out.set(id, dir);
  }
  return out;
}

/** `overrides`: pack id → folder (from `--dependency id=path`). */
export function loadWorkspace(packDir: string, overrides: Record<string, string> = {}): Workspace {
  const root = resolve(packDir);
  if (!existsSync(join(root, 'pack.json'))) throw new PackError(`${packDir}: no pack.json`);
  const siblings = siblingPacks(dirname(root));
  const dirs = new Map<string, string>();
  const packs: PackData[] = [];
  const visit = (dir: string) => {
    const pack = readPackDir(dir);
    const id = pack.manifest.id;
    if (dirs.has(id)) return;
    dirs.set(id, dir);
    packs.push(pack);
    const deps = [...Object.keys(pack.manifest.dependencies), ...(pack.manifest.base ? [pack.manifest.base] : [])];
    for (const dep of deps) {
      if (dirs.has(dep)) continue;
      const depDir = overrides[dep] ? resolve(overrides[dep]) : siblings.get(dep);
      if (!depDir) throw new PackError(`${id} requires pack ${dep}: not found next to ${packDir}; pass --dependency ${dep}=<folder>`);
      visit(depDir);
    }
  };
  visit(root);
  return { pack: packs[0]!.manifest.id, packs, dirs };
}

/** Does `<pack>:<path>` name a file or folder inside that pack? */
export function assetExists(ws: Workspace, ref: Id): boolean {
  const [pack, path] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  const dir = ws.dirs.get(pack);
  if (!dir) return false;
  const file = resolve(dir, path);
  return file.startsWith(dir + '/') && existsSync(file);
}

/** `from <file>` in a replay: a path relative to the replay that names it (or to the working directory). */
export const fileReplayResolver: ReplayResolver = (file, base) => {
  const path = resolve(base ? dirname(resolve(base)) : process.cwd(), file);
  if (!existsSync(path)) throw new Error(`${base ?? 'replay'}: from ${file}: no such file ${path}`);
  return { name: relative(process.cwd(), path), text: readFileSync(path, 'utf8') };
};

export function replayFiles(packDir: string): string[] {
  const dir = join(resolve(packDir), 'replays');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.replay'))
    .sort()
    .map((f) => join(dir, f));
}
