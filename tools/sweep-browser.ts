/**
 * Opt-in browser zone sweep (not part of `test:browser`, it takes minutes):
 *
 *   pnpm sweep:browser [packDir] [--zones regex] [--limit n]     (default packDir: .opensinnoh-cache/platinum)
 *
 * Serves the pack through the opensinnoh packs plugin, opens the app in replay mode, and for every
 * playable zone loads a state placed like the headless sweep (`opensinnoh sweep`), lets the fade-in
 * finish, waits for the scene, takes one screenshot into test-artifacts/sweep/ (ROM content: never
 * commit) and checks it is not blank. Records frame time per zone (rAF intervals over 20 frames) and the
 * renderer's own time per frame.
 * Writes test-artifacts/sweep/results.json; exits 1 when a zone throws or renders blank.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createServer } from 'vite';
import { loadGamePacks } from '@opensinnoh/game';
import { mainCanvasStats, openApp, REPO_ROOT, waitForScene } from '../packages/cli/src/browser.ts';
import { openSinnohPacksPlugin } from '../packages/cli/src/plugin.ts';
import { EXCLUDED_ZONE, spawnPoint } from '../packages/cli/src/sweep.ts';
import { loadWorkspace } from '../packages/cli/src/workspace.ts';
import { launchReplayBrowser } from './browser.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const zonesArg = flag('--zones');
const limitArg = flag('--limit');
const packDir = resolve(argv[0] ?? '.opensinnoh-cache/platinum');
const out = join(REPO_ROOT, 'test-artifacts/sweep');
mkdirSync(out, { recursive: true });

const ws = loadWorkspace(packDir);
const { registries } = loadGamePacks(ws.packs);
const re = zonesArg ? new RegExp(zonesArg) : null;
let zones = [...registries.zones.keys()].filter((id) => !EXCLUDED_ZONE.test(id) && (!re || re.test(id)));
if (limitArg) zones = zones.slice(0, Number(limitArg));

/** rAF intervals over 20 frames → mean and max ms. */
const FRAME_TIMES = `new Promise((done) => {
  const times = [];
  let last = performance.now();
  const frame = (now) => {
    times.push(now - last);
    last = now;
    if (times.length < 20) requestAnimationFrame(frame);
    else done({ mean: Math.round((times.reduce((a, b) => a + b, 0) / times.length) * 10) / 10, max: Math.round(Math.max(...times) * 10) / 10 });
  };
  requestAnimationFrame(frame);
})`;

/** The renderer's own time for the last 20 frames. */
const RENDER_TIMES = `(() => {
  const ms = globalThis.openSinnohRenderStats.renderMs.slice(-20);
  return { mean: Math.round((ms.reduce((a, b) => a + b, 0) / ms.length) * 100) / 100, max: Math.round(Math.max(...ms) * 100) / 100 };
})()`;

interface Row {
  zone: string;
  ok: boolean;
  error?: string;
  screenshot?: string;
  colours?: number;
  litShare?: number;
  frameMs?: { mean: number; max: number };
  /** Wall time for the 30 fade-in ticks and then for the scene-ready wait. */
  loadMs?: { advance: number; scene: number };
  /** Renderer time per frame (`openSinnohRenderStats.renderMs`) over the sampled frames. */
  renderMs?: { mean: number; max: number };
}

const server = await createServer({ root: REPO_ROOT, plugins: [openSinnohPacksPlugin([packDir])], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const address = server.httpServer?.address();
if (!address || typeof address === 'string') throw new Error('vite: no server port');
const session = await launchReplayBrowser();
const rows: Row[] = [];
const started = Date.now();
try {
  const context = await session.browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const errors: string[] = [];
  await openApp(page, `http://127.0.0.1:${address.port}`, [...ws.dirs.keys()], errors);
  const base = await page.evaluate(() => JSON.parse(JSON.stringify(window.openSinnohGame!.snapshot().state)) as { player: unknown; objects: unknown[]; follower: unknown });
  for (const [i, zone] of zones.entries()) {
    const z = registries.zones.get(zone)!;
    const spawn = spawnPoint(z, registries.matrices.get(z.matrix)!, registries);
    const row: Row = { zone, ok: false };
    errors.length = 0;
    try {
      const state = { ...base, player: { zone, x: spawn.x, z: spawn.z, y: 0, facing: 'down' }, objects: [], follower: null };
      await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '1970-01-01T00:00:00.000Z', state }));
      const t0 = Date.now();
      await page.evaluate(() => window.openSinnohGame!.advance(30));
      const t1 = Date.now();
      await waitForScene(page);
      row.loadMs = { advance: t1 - t0, scene: Date.now() - t1 };
      // A string, not a function: tsx would wrap the inner callback in a `__name` helper the page lacks.
      row.frameMs = (await page.evaluate(FRAME_TIMES)) as { mean: number; max: number };
      row.renderMs = (await page.evaluate(RENDER_TIMES)) as { mean: number; max: number };
      const stats = await mainCanvasStats(page);
      row.colours = stats.colours;
      row.litShare = Math.round(stats.litShare * 1000) / 1000;
      row.screenshot = join(out, `${zone.replace(/^platinum:MAP_HEADER_/, '').replace(/[^A-Za-z0-9_-]/g, '_')}.png`);
      await page.screenshot({ path: row.screenshot });
      if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
      // A dark map (DARK_FLASH) is black outside the circle around the player.
      const dark = await page.evaluate(() => window.openSinnohApp!.game.world.view().darkness !== null);
      if (stats.colours <= 8 || stats.litShare <= (dark ? 0.01 : 0.05)) throw new Error(`blank scene (${stats.colours} colours, lit ${row.litShare})`);
      row.ok = true;
    } catch (e) {
      row.error = (e as Error).message.split('\n')[0];
    }
    rows.push(row);
    process.stderr.write(`\r${i + 1}/${zones.length} ${row.ok ? 'ok  ' : 'FAIL'} ${zone.padEnd(60)}`);
  }
  await context.close();
} finally {
  try {
    await session.close();
  } finally {
    await server.close();
  }
}
const frames = rows.flatMap((r) => (r.frameMs ? [r.frameMs.mean] : [])).sort((a, b) => a - b);
const renders = rows.flatMap((r) => (r.renderMs ? [r.renderMs.mean] : [])).sort((a, b) => a - b);
const result = {
  pack: ws.pack,
  zones: zones.length,
  ok: rows.filter((r) => r.ok).length,
  failed: rows.filter((r) => !r.ok).length,
  seconds: Math.round((Date.now() - started) / 1000),
  frameMeanMs: { p50: frames[Math.floor(frames.length / 2)] ?? 0, p95: frames[Math.floor(frames.length * 0.95)] ?? 0 },
  renderMeanMs: { p50: renders[Math.floor(renders.length / 2)] ?? 0, p95: renders[Math.floor(renders.length * 0.95)] ?? 0 },
  rows,
};
writeFileSync(join(out, 'results.json'), JSON.stringify(result, null, 2) + '\n');
process.stderr.write(`\n${result.pack}: ${result.ok}/${result.zones} zones rendered (${result.failed} failed) in ${result.seconds} s; frame ms p50 ${result.frameMeanMs.p50}, p95 ${result.frameMeanMs.p95}; render ms p50 ${result.renderMeanMs.p50}, p95 ${result.renderMeanMs.p95}\n`);
for (const r of rows.filter((x) => !x.ok).slice(0, 20)) process.stderr.write(`  ${r.zone}: ${r.error}\n`);
process.exit(result.failed ? 1 : 0);
