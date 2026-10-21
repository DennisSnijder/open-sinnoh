import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openSinnohPacksPlugin } from './plugin.ts';

type Middleware = (req: { url: string }, res: Response, next: () => void) => void;
interface Response {
  statusCode: number;
  body: string;
  setHeader(name: string, value: string): void;
  end(body: string | Buffer): void;
}

/** The same pack middleware over stub dev and preview servers. */
function middleware(packDir: string, hook: 'configureServer' | 'configurePreviewServer'): (url: string) => Response {
  let use: Middleware | undefined;
  const server = { watcher: { add() {}, on() {} }, ws: { send() {} }, middlewares: { use: (fn: Middleware) => void (use = fn) } };
  (openSinnohPacksPlugin([packDir])[hook] as unknown as (s: typeof server) => void)(server);
  return (url) => {
    const res: Response = { statusCode: 200, body: '', setHeader() {}, end: (b) => void (res.body = b.toString()) };
    use!({ url }, res, () => {
      throw new Error(`not served: ${url}`);
    });
    return res;
  };
}

describe.each(['configureServer', 'configurePreviewServer'] as const)('opensinnoh packs plugin %s', (hook) => {
  it('serves assets without re-reading the packs per request (a Platinum pack takes ~100 ms to read)', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'opensinnoh-plugin-')), 'fixture');
    cpSync(join(import.meta.dirname, '../../../packs/fixture'), dir, { recursive: true });
    const get = middleware(dir, hook);
    expect(JSON.parse(get('/__opensinnoh/packs.json?packs=fixture').body).packs[0].manifest.id).toBe('fixture');
    const house = readFileSync(join(dir, 'models/house.gltf'), 'utf8');
    expect(get('/__opensinnoh/assets/fixture/models/house.gltf').body).toBe(house);
    // A pack that no longer parses: asset requests resolve the folder they already know.
    writeFileSync(join(dir, 'data.json'), '{ not json');
    expect(get('/__opensinnoh/assets/fixture/models/house.gltf')).toMatchObject({ statusCode: 200, body: house });
    expect(get('/__opensinnoh/assets/fixture/models/nope.gltf').statusCode).toBe(404);
    // packs.json still reads the folder each time, so pack edits show on reload.
    expect(get('/__opensinnoh/packs.json').statusCode).toBe(500);
  });
});
