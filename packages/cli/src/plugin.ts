/**
 * Vite plugin that serves pack folders to the app:
 *   GET /__opensinnoh/packs.json[?packs=a,b]  → { packs: PackData[] } (the named packs plus their dependencies; default all)
 *   GET /__opensinnoh/assets/<pack>/<path>    → a file inside that pack (AssetRef `<pack>:<path>`)
 * and sends the HMR custom event `opensinnoh:packs-changed` when a pack file changes, so the app can
 * reload data and labels between scripts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import type { PackData } from '@opensinnoh/core';
import { loadWorkspace } from './workspace.ts';

export const PACKS_CHANGED_EVENT = 'opensinnoh:packs-changed';
const TYPES: Record<string, string> = { '.json': 'application/json', '.gltf': 'model/gltf+json', '.png': 'image/png', '.ir': 'text/plain', '.bin': 'application/octet-stream' };

export function openSinnohPacksPlugin(packDirs: readonly string[], dependencies: Record<string, string> = {}): Plugin {
  const workspaces = () => packDirs.map((d) => loadWorkspace(d, dependencies));
  // Folders by pack id, resolved once: a workspace load parses every pack (~100 ms for Platinum), too slow
  // per asset request (each model is several). packs.json still re-reads, so pack edits show on reload.
  let packFolders: Map<string, string> | null = null;
  const dirs = () => (packFolders ??= new Map(workspaces().flatMap((w) => [...w.dirs])));

  const packsFor = (ids: string[] | null): PackData[] => {
    const all = new Map<string, PackData>();
    for (const w of workspaces()) for (const p of w.packs) all.set(p.manifest.id, p);
    if (!ids) return [...all.values()];
    const out = new Map<string, PackData>();
    const add = (id: string) => {
      const p = all.get(id);
      if (!p) throw new Error(`unknown pack ${id} (served: ${[...all.keys()].join(', ')})`);
      if (out.has(id)) return;
      for (const dep of [...Object.keys(p.manifest.dependencies), ...(p.manifest.base ? [p.manifest.base] : [])]) add(dep);
      out.set(id, p);
    };
    ids.forEach(add);
    return [...out.values()];
  };

  const serve = (server: Pick<ViteDevServer, 'middlewares'>) => {
    server.middlewares.use((req, res, next) => {
      const url = new URL(req.url ?? '/', 'http://local');
      try {
        if (url.pathname === '/__opensinnoh/packs.json') {
          const ids = url.searchParams.get('packs');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ packs: packsFor(ids ? ids.split(',') : null) }));
          return;
        }
        const m = /^\/__opensinnoh\/assets\/([a-z][a-z0-9-]*)\/(.+)$/.exec(url.pathname);
        if (m) {
          const dir = dirs().get(m[1]!);
          const file = dir && resolve(dir, decodeURIComponent(m[2]!));
          if (!dir || !file || !file.startsWith(dir + sep) || !existsSync(file)) {
            res.statusCode = 404;
            res.end(`no asset ${m[1]}:${m[2]}`);
            return;
          }
          res.setHeader('content-type', TYPES[extname(file)] ?? 'application/octet-stream');
          res.end(readFileSync(file));
          return;
        }
      } catch (e) {
        res.statusCode = 500;
        res.end((e as Error).message);
        return;
      }
      next();
    });
  };

  return {
    name: 'opensinnoh-packs',
    configurePreviewServer: serve,
    configureServer(server) {
      for (const dir of dirs().values()) server.watcher.add(dir);
      server.watcher.on('change', (file) => {
        if ([...dirs().values()].some((d) => file.startsWith(d + sep))) server.ws.send({ type: 'custom', event: PACKS_CHANGED_EVENT, data: { file } });
      });
      serve(server);
    },
  };
}
