/**
 * `pnpm perf`: the performance budgets (tools/perf-budgets.json). Not part of `pnpm check`: the
 * browser numbers need a quiet machine and the real GPU.
 *
 *   pnpm perf --bundle                 the built app's JS sizes (reads `dist`: run `pnpm build` first); no browser
 *   pnpm perf --fixture                heap growth over zone round trips on packs/fixture (no ROM; CI runs this)
 *   pnpm perf [--profiles=a,b]         the ROM run (OPENSINNOH_NDS_ROM; skipped without it): desktop, phone-4x, phone-6x
 *            [--scenes=a,b]           only these scenes (bedroom, route201, …, battle-single, battle-doubles): for
 *                                     a quick look; budgets that need the others then fail as not measured
 *
 * Flags combine. The ROM run, per profile (viewport, DPR and CPU throttle as §2 says):
 *   - desktop imports the ROM into a fresh browser profile (import seconds, IndexedDB size, the renderer's memory peak);
 *     the phones keep theirs in .opensinnoh-cache/perf/<profile> and import once;
 *   - field scenes and two battles, each from CONTINUE on a save placed there, in the real wall-clock loop: 10 s of
 *     walking (battles: the intro and a turn, A pressed every 300 ms), reading `openSinnohApp.loop` (frame work per
 *     display frame, each tick, dropped ticks); then a forced GC for the heap, the field's live WebGL texture and
 *     buffer bytes (counted by a WebGL hook in the page), the renderer process's private memory footprint;
 *   - load times: to an interactive title, CONTINUE to the field (at the profile's throttle), and a first visit to
 *     the production build's ROM page on Lighthouse's slow 4G (1.6 Mbps, 150 ms RTT);
 *   - heap growth over 20 round trips (Jubilife, then a wild battle on Route 201), a forced GC after each.
 * Writes test-artifacts/perf/<section>.json, prints each budget row, appends a table to $GITHUB_STEP_SUMMARY, and
 * exits 1 when any budget fails. OPENSINNOH_PERF_PORT (default 4391) picks the preview ports (it and the next one).
 */
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { browserExecutable } from './browser.ts';
import { bundleMetrics, checkBudgets, formatRows, markdownRows, summary, type BudgetRow, type Budgets, type Metrics } from './perf-check.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'test-artifacts/perf');
const BUDGETS = JSON.parse(readFileSync(join(ROOT, 'tools/perf-budgets.json'), 'utf8')) as Budgets;
const PORT = Number(process.env.OPENSINNOH_PERF_PORT ?? 4391);
const BASE = `http://127.0.0.1:${PORT}`;
const PROD = `http://127.0.0.1:${PORT + 1}`;
const ROM = process.env.OPENSINNOH_NDS_ROM;
const GL = process.env.OPENSINNOH_PERF_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const GL_ARGS = GL === 'metal' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

interface Profile {
  name: string;
  rate: number;
  viewport: { width: number; height: number };
  dpr: number;
  mobile: boolean;
}
const PROFILES: Profile[] = [
  { name: 'desktop', rate: 1, viewport: { width: 1280, height: 720 }, dpr: 1, mobile: false },
  { name: 'phone-4x', rate: 4, viewport: { width: 390, height: 844 }, dpr: 3, mobile: true },
  { name: 'phone-6x', rate: 6, viewport: { width: 390, height: 844 }, dpr: 3, mobile: true },
];

/** Field scenes: CONTINUE from a new game's save moved there. */
const FIELD: [string, string, number, number][] = [
  ['route201', 'platinum:MAP_HEADER_ROUTE_201', 115, 853],
  ['jubilife', 'platinum:MAP_HEADER_JUBILIFE_CITY', 174, 770],
  ['hearthome', 'platinum:MAP_HEADER_HEARTHOME_CITY', 504, 726],
  ['eterna', 'platinum:MAP_HEADER_ETERNA_CITY', 304, 567],
  ['canalave', 'platinum:MAP_HEADER_CANALAVE_CITY', 44, 750],
  ['dw-b1f', 'platinum:MAP_HEADER_DISTORTION_WORLD_B1F', 40, 54],
];
const WALK_MS = 10_000;
const BATTLE_MS = 15_000;
const ROUND_TRIPS = 20;

const SETUP_DONE = { 'lantern-nds:setup': '["reports","addon","textSpeed"]', 'lantern-nds:error-reports': 'false' };

/**
 * Counts live WebGL texture, buffer and renderbuffer bytes per canvas (by its id): w×h×4 per texel level (a
 * mipmapped texture ×4/3), buffers by their data size. Installed before the app's scripts run.
 */
const GPU_HOOK = `(() => {
  const per = new Map();
  const of = (gl) => { let s = per.get(gl); if (!s) { s = { unit: 0, bound: new Map(), buffers: new Map(), rbBound: null, tex: new Map(), buf: new Map(), rb: new Map() }; per.set(gl, s); } return s; };
  const TEX2D = 0x0de1, CUBE = 0x8513, CUBE_FACES = [0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851a];
  const bindTarget = (t) => (CUBE_FACES.includes(t) ? CUBE : t);
  const dims = (src) => src ? [src.videoWidth || src.naturalWidth || src.width || 0, src.videoHeight || src.naturalHeight || src.height || 0] : [0, 0];
  const setLevel = (s, target, level, bytes) => {
    const t = s.bound.get(s.unit + ':' + bindTarget(target)); if (!t) return;
    let e = s.tex.get(t); if (!e) { e = new Map(); s.tex.set(t, e); }
    e.set(target + ':' + level, bytes);
  };
  for (const C of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!C) continue;
    const p = C.prototype, wrap = (name, f) => { const o = p[name]; if (o) p[name] = function (...a) { f(of(this), a, this); return o.apply(this, a); }; };
    wrap('activeTexture', (s, a) => { s.unit = a[0]; });
    wrap('bindTexture', (s, a) => { s.bound.set(s.unit + ':' + a[0], a[1]); });
    wrap('texImage2D', (s, a) => { const [w, h] = a.length >= 9 ? [a[3], a[4]] : dims(a[5]); setLevel(s, a[0], a[1], w * h * 4); });
    wrap('texImage3D', (s, a) => { setLevel(s, a[0], a[1], a[3] * a[4] * a[5] * 4); });
    wrap('texStorage2D', (s, a) => { setLevel(s, a[0], 0, a[3] * a[4] * 4 * (a[1] > 1 ? 4 / 3 : 1) * (a[0] === CUBE ? 6 : 1)); });
    wrap('texStorage3D', (s, a) => { setLevel(s, a[0], 0, a[3] * a[4] * a[5] * 4 * (a[1] > 1 ? 4 / 3 : 1)); });
    wrap('generateMipmap', (s, a) => { const t = s.bound.get(s.unit + ':' + a[0]); const e = t && s.tex.get(t); if (e) { let base = 0; for (const [k, v] of e) if (k.endsWith(':0')) base += v; e.set('mips', base / 3); } });
    wrap('deleteTexture', (s, a) => { s.tex.delete(a[0]); });
    wrap('bindBuffer', (s, a) => { s.buffers.set(a[0], a[1]); });
    wrap('bufferData', (s, a) => { const b = s.buffers.get(a[0]); if (b) s.buf.set(b, typeof a[1] === 'number' ? a[1] : a[1] ? a[1].byteLength : 0); });
    wrap('deleteBuffer', (s, a) => { s.buf.delete(a[0]); });
    wrap('bindRenderbuffer', (s, a) => { s.rbBound = a[1]; });
    wrap('renderbufferStorage', (s, a) => { if (s.rbBound) s.rb.set(s.rbBound, a[2] * a[3] * 4); });
    wrap('renderbufferStorageMultisample', (s, a) => { if (s.rbBound) s.rb.set(s.rbBound, a[3] * a[4] * 4 * Math.max(1, a[1])); });
    wrap('deleteRenderbuffer', (s, a) => { s.rb.delete(a[0]); });
  }
  const sum = (m) => { let n = 0; for (const v of m.values()) n += v instanceof Map ? sum(v) : v; return n; };
  globalThis.__openSinnohGpu = (id) => {
    for (const [gl, s] of per) if (gl.canvas && gl.canvas.id === id) return { textureBytes: sum(s.tex), bufferBytes: sum(s.buf), renderbufferBytes: sum(s.rb) };
    return null;
  };
})();`;

const sections: { section: string; metrics: Metrics; detail: unknown }[] = [];
const MB = (bytes: number) => Math.round(bytes / 1e5) / 10;

// ---- bundle ----------------------------------------------------------------------------------------------------

if (flag('bundle')) {
  const dist = join(ROOT, 'dist');
  if (!existsSync(join(dist, 'index.html'))) throw new Error('pnpm perf --bundle reads dist: run `pnpm build` first');
  const { metrics, files } = bundleMetrics(dist);
  sections.push({ section: 'bundle', metrics, detail: { files } });
}

// ---- browser helpers -------------------------------------------------------------------------------------------

let server: ChildProcess | null = null;
async function startServer(): Promise<void> {
  if (server) return;
  server = spawn('pnpm', ['exec', 'tsx', 'tools/browser-server.ts', String(PORT)], { cwd: ROOT, env: { ...process.env, OPENSINNOH_TEST_SHARD: 'perf' }, stdio: ['ignore', 'inherit', 'inherit'] });
  // A failed run must not leave the server holding the port.
  process.on('exit', () => server?.kill());
  const until = Date.now() + 180_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`the preview server exited (${server.exitCode}); is port ${PORT} free? (OPENSINNOH_PERF_PORT)`);
    try {
      if ((await fetch(`${BASE}/__opensinnoh/packs.json`)).ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() > until) throw new Error('the preview server did not start within 180 s');
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function launch(profile: Profile, dir: string): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await chromium.launchPersistentContext(dir, {
    executablePath: browserExecutable(),
    args: GL_ARGS,
    headless: true,
    viewport: profile.viewport,
    deviceScaleFactor: profile.dpr,
    isMobile: profile.mobile,
    hasTouch: profile.mobile,
  });
  // esbuild's keepNames helper, for functions passed to page.evaluate from tsx.
  await context.addInitScript('globalThis.__name = (f) => f');
  await context.addInitScript(GPU_HOOK);
  await context.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, SETUP_DONE);
  const page = context.pages()[0] ?? (await context.newPage());
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

const throttle = (cdp: CDPSession, rate: number) => cdp.send('Emulation.setCPUThrottlingRate', { rate });

async function heapAfterGc(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('HeapProfiler.collectGarbage');
  return MB((await cdp.send('Runtime.getHeapUsage')).usedSize);
}

/**
 * Memory (MB) of this run's renderer and GPU processes (the browser process found by the profile directory on its
 * command line, the rest as its children). `renderer`/`gpu`: the private footprint (macOS `phys_footprint`, what
 * Activity Monitor and the OS's memory pressure count; Linux: RssAnon); `rendererPeak`: the renderer's lifetime peak
 * (macOS `phys_footprint_peak`; Linux: VmHWM). Read once, not sampled: reading a footprint stalls the process, and
 * sampling every second made the import take 37 s instead of 15. `rendererRss`: plain RSS, which on macOS also counts
 * shared mappings and freed pages the allocator keeps until pressure (informational only).
 */
function processMemory(dir: string): { renderer: number; rendererPeak: number; gpu: number; rendererRss: number } {
  const lines = execSync('ps -axo pid=,ppid=,rss=,command=', { maxBuffer: 64 * 1024 * 1024 }).toString().split('\n');
  const procs = lines.map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l)).filter((m): m is RegExpExecArray => !!m).map((m) => ({ pid: +m[1]!, ppid: +m[2]!, rss: +m[3]! / 1024, cmd: m[4]! }));
  const root = procs.find((p) => p.cmd.includes(`--user-data-dir=${dir}`) && !p.cmd.includes('--type='));
  if (!root) throw new Error(`no Chromium process with --user-data-dir=${dir}`);
  const tree = new Set([root.pid]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of procs) {
      if (tree.has(p.pid) || !tree.has(p.ppid)) continue;
      tree.add(p.pid);
      grew = true;
    }
  }
  const mine = procs.filter((p) => tree.has(p.pid));
  const renderers = mine.filter((p) => p.cmd.includes('--type=renderer')).map((p) => ({ ...p, ...footprint(p.pid) }));
  const gpu = mine.filter((p) => p.cmd.includes('--type=gpu-process')).map((p) => footprint(p.pid));
  const max = (xs: number[]) => Math.round(Math.max(0, ...xs));
  return { renderer: max(renderers.map((p) => p.now)), rendererPeak: max(renderers.map((p) => p.peak)), gpu: max(gpu.map((p) => p.now)), rendererRss: max(renderers.map((p) => p.rss)) };
}

function footprint(pid: number): { now: number; peak: number } {
  if (process.platform === 'linux') {
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    return { now: +/RssAnon:\s+(\d+)/.exec(status)![1]! / 1024, peak: +/VmHWM:\s+(\d+)/.exec(status)![1]! / 1024 };
  }
  const out = execSync(`footprint --noCategories -f bytes ${pid}`).toString();
  const now = /phys_footprint: (\d+) B/.exec(out);
  const peak = /phys_footprint_peak: (\d+) B/.exec(out);
  if (!now || !peak) throw new Error(`footprint: no figures for ${pid} in ${JSON.stringify(out)}`);
  return { now: +now[1]! / 1e6, peak: +peak[1]! / 1e6 };
}

async function writeSave(page: Page, json: string): Promise<void> {
  await page.evaluate(
    (json) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('lantern-nds-saves', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('saves');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('saves', 'readwrite');
          tx.objectStore('saves').put(json, 'main');
          tx.oncomplete = () => (open.result.close(), resolve());
          tx.onerror = () => reject(tx.error);
        };
      }),
    json,
  );
}

/** A save once the game can save (a new game's bedroom after a reset), or after `ticks` more. */
async function bridgeSave(page: Page): Promise<string> {
  return page.evaluate(() => {
    for (let i = 0; i < 1800; i++) {
      try {
        return window.openSinnohGame!.save();
      } catch {
        window.openSinnohGame!.advance(1);
      }
    }
    throw new Error('the game never became saveable');
  });
}

async function openReplay(page: Page, query = ''): Promise<void> {
  await page.goto(`${BASE}/?replay${query}`);
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 300_000 });
}

const moved = (save: string, zone: string, x: number, z: number, facing?: string) => {
  const env = JSON.parse(save) as { state: Record<string, unknown> & { player: Record<string, unknown> } };
  env.state.player = { ...env.state.player, zone, x, z, y: 0, ...(facing ? { facing } : {}) };
  env.state.objects = [];
  env.state.follower = null;
  env.state.partyFollower = null;
  return JSON.stringify(env);
};

/** Battle saves, made with the dev build's debug panel (`?debug=1`): Pokémon given and the player warped. */
async function battleSave(page: Page, party: [string, number][], zone: string, x: number, z: number, facing: string): Promise<string> {
  await openReplay(page, '&debug=1');
  await page.evaluate(() => window.openSinnohGame!.reset(1));
  await bridgeSave(page);
  await page.locator('#dev-debug > summary').click();
  for (const [species, level] of party) {
    await page.getByLabel('Species', { exact: true }).fill(species);
    await page.getByLabel('Level', { exact: true }).fill(String(level));
    await page.getByRole('button', { name: 'Give Pokémon' }).click();
    await page.locator('#dev-debug output').filter({ hasText: 'Done.' }).waitFor();
  }
  await page.getByLabel('Map', { exact: true }).fill(zone);
  await page.getByLabel('Tile X', { exact: true }).fill(String(x));
  await page.getByLabel('Tile Z', { exact: true }).fill(String(z));
  await page.getByRole('button', { name: 'Warp' }).click();
  await page.locator('#dev-debug output').filter({ hasText: 'Done.' }).waitFor();
  const idle = await page.evaluate(() => window.openSinnohGame!.until({ kind: 'idle' }, 3000));
  if (idle === null) throw new Error(`${zone}: not idle after the warp`);
  return moved(await bridgeSave(page), zone, x, z, facing);
}

/** Title → CONTINUE → the field drawn. Returns the seconds to an interactive title and from CONTINUE to the field. */
async function continueGame(page: Page): Promise<{ titleS: number; continueS: number }> {
  const t0 = Date.now();
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 300_000 });
  const titleS = (Date.now() - t0) / 1000;
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.openSinnohTitle?.phase === 'menu', undefined, { timeout: 60_000 });
  await page.waitForFunction(() => window.openSinnohTitle?.focused === 'continue', undefined, { timeout: 60_000 });
  await page.waitForTimeout(600);
  const t1 = Date.now();
  await page.keyboard.press('KeyZ');
  await page.waitForFunction(() => !window.openSinnohTitle && window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 300_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return { titleS, continueS: (Date.now() - t1) / 1000 };
}

const resetLoop = (page: Page) =>
  page.evaluate(() => {
    const l = window.openSinnohApp!.loop;
    l.frameMs.length = 0;
    l.tickMs.length = 0;
    (window as unknown as { perfDropped: number }).perfDropped = l.dropped;
  });
const readLoop = (page: Page) =>
  page.evaluate(() => {
    const l = window.openSinnohApp!.loop;
    return { frameMs: [...l.frameMs], tickMs: [...l.tickMs], dropped: l.dropped - (window as unknown as { perfDropped: number }).perfDropped };
  });

interface SceneResult {
  frame: ReturnType<typeof summary>;
  tick: ReturnType<typeof summary>;
  dropped: number;
  heapMB: number;
  gpu: { textureMB: number; bufferMB: number; renderbufferMB: number } | null;
  memoryMB: ReturnType<typeof processMemory> | null;
  fieldDpr: number;
  load: { titleS: number; continueS: number };
}

async function measureScene(page: Page, cdp: CDPSession, profile: Profile, dir: string, save: string, play: (page: Page) => Promise<void>): Promise<SceneResult> {
  await throttle(cdp, 1);
  await page.goto(`${BASE}/__opensinnoh/packs.json`);
  await writeSave(page, save);
  await throttle(cdp, profile.rate);
  const load = await continueGame(page);
  await page.waitForTimeout(1000);
  await resetLoop(page);
  await play(page);
  const loop = await readLoop(page);
  await throttle(cdp, 1);
  const heapMB = await heapAfterGc(cdp);
  const gpu = await page.evaluate(() => (globalThis as unknown as { __openSinnohGpu(id: string): { textureBytes: number; bufferBytes: number; renderbufferBytes: number } | null }).__openSinnohGpu('main-canvas'));
  const fieldDpr = await page.evaluate(() => window.openSinnohApp!.renderScale().pixelRatio);
  return {
    frame: summary(loop.frameMs),
    tick: summary(loop.tickMs),
    dropped: loop.dropped,
    heapMB,
    gpu: gpu && { textureMB: MB(gpu.textureBytes), bufferMB: MB(gpu.bufferBytes), renderbufferMB: MB(gpu.renderbufferBytes) },
    memoryMB: profile.name === 'desktop' ? processMemory(dir) : null,
    fieldDpr,
    load,
  };
}

async function walk(page: Page): Promise<void> {
  const end = Date.now() + WALK_MS;
  while (Date.now() < end) {
    for (const k of ['ArrowRight', 'ArrowLeft']) {
      await page.keyboard.down(k);
      await page.waitForTimeout(1000);
      await page.keyboard.up(k);
    }
  }
}

/** Holds the keys (and presses A) until a battle starts, then A every 300 ms for BATTLE_MS; the loop is read from the battle's start. */
function battle(keys: string[]): (page: Page) => Promise<void> {
  return async (page) => {
    const until = Date.now() + 120_000;
    let k = 0;
    while (!(await page.evaluate(() => window.openSinnohApp!.game.inBattle()))) {
      if (Date.now() > until) throw new Error('no battle started within 120 s');
      const key = keys[k++ % keys.length]!;
      await page.keyboard.down(key);
      await page.waitForTimeout(700);
      await page.keyboard.up(key);
      await page.keyboard.press('KeyZ');
    }
    await resetLoop(page);
    const end = Date.now() + BATTLE_MS;
    while (Date.now() < end) {
      await page.keyboard.press('KeyZ');
      await page.waitForTimeout(300);
    }
    if (!(await page.evaluate(() => window.openSinnohApp!.game.inBattle()))) console.log('  (the battle ended within the window)');
  };
}

/** Heap growth over ROUND_TRIPS round trips in the replay page: `trip` once per round, a forced GC after each. */
async function heapGrowth(page: Page, cdp: CDPSession, trip: () => Promise<void>): Promise<{ growthMB: number; heapMB: number[] }> {
  const heapMB: number[] = [];
  for (let i = 0; i < ROUND_TRIPS; i++) {
    await trip();
    heapMB.push(await heapAfterGc(cdp));
  }
  // The first round fills the caches that every later one reuses; growth is counted from there.
  return { growthMB: Math.round((heapMB.at(-1)! - heapMB[0]!) * 10) / 10, heapMB };
}

async function loadZone(page: Page, save: string): Promise<void> {
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), save);
  await page.evaluate(() => window.openSinnohGame!.advance(5));
  await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
}

// ---- fixture ---------------------------------------------------------------------------------------------------

if (flag('fixture')) {
  await startServer();
  const dir = join(tmpdir(), `opensinnoh-perf-fixture-${process.pid}`);
  const { context, page, cdp } = await launch(PROFILES[0]!, dir);
  try {
    await page.goto(`${BASE}/?packs=fixture&replay`);
    await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 120_000 });
    const base = await bridgeSave(page);
    // Each zone at its first warp (the sweep's spawn point).
    const at = (zone: string) => page.evaluate((id) => window.openSinnohApp!.game.registries.zones.get(id as never)!.events.warps[0]!, zone);
    const [t, r] = [await at('fixture:TOWN'), await at('fixture:TERRAIN')];
    const town = moved(base, 'fixture:TOWN', t.x, t.z);
    const terrain = moved(base, 'fixture:TERRAIN', r.x, r.z);
    const g = await heapGrowth(page, cdp, async () => {
      await loadZone(page, town);
      await loadZone(page, terrain);
    });
    sections.push({ section: 'fixture', metrics: { 'heap.growthMB': g.growthMB }, detail: g });
  } finally {
    await context.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---- ROM -------------------------------------------------------------------------------------------------------

const romRun = !flag('bundle') && !flag('fixture');
if (romRun && !ROM) console.log('pnpm perf: OPENSINNOH_NDS_ROM is not set; the ROM run is skipped.');
if (romRun && ROM) {
  const names = (option('profiles') ?? PROFILES.map((p) => p.name).join(',')).split(',');
  const profiles = names.map((n) => PROFILES.find((p) => p.name === n) ?? (() => { throw new Error(`unknown profile ${n} (${PROFILES.map((p) => p.name).join(', ')})`); })());
  await startServer();
  // The production build for the first visit: the browser-test build carries dev hooks and its own entries.
  execSync('pnpm exec vite build', { cwd: ROOT, stdio: 'ignore' });
  const prod = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT + 1), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  process.on('exit', () => prod.kill());
  try {
    for (const profile of profiles) {
      console.log(`\n== ${profile.name} (CPU ${profile.rate}x, ${GL}) — load average ${execSync('sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg').toString().trim()}`);
      const metrics: Metrics = {};
      const detail: Record<string, unknown> = {};
      const fresh = profile.name === 'desktop';
      const dir = fresh ? join(tmpdir(), `opensinnoh-perf-${process.pid}`) : join(ROOT, '.opensinnoh-cache/perf', profile.name);
      if (fresh) rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      const { context, page, cdp } = await launch(profile, dir);
      try {
        // The import (desktop: always, timed; the phones: when their profile has none for this importer).
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => !!window.openSinnohTitle || document.getElementById('picker')?.hidden === false, undefined, { timeout: 300_000 });
        if (!(await page.evaluate(() => !!window.openSinnohTitle))) {
          const t0 = Date.now();
          await page.locator('#rom-input').setInputFiles(ROM);
          await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title', undefined, { timeout: 900_000 });
          // The import worker ran in the page's renderer, which the reload to the title keeps (same site).
          const peak = processMemory(dir).rendererPeak;
          if (fresh) {
            metrics['import.s'] = (Date.now() - t0) / 1000;
            metrics['memory.importPeakMB'] = peak;
            const storage = await page.evaluate(
              () =>
                new Promise<{ files: number; bytes: number; addon?: string }[]>((resolve) => {
                  const req = indexedDB.open('lantern-nds');
                  req.onsuccess = () => {
                    const g = req.result.transaction('imports').objectStore('imports').getAll();
                    g.onsuccess = () => resolve(g.result as { files: number; bytes: number }[]);
                  };
                }),
            );
            const base = storage.find((m) => !m.addon)!;
            metrics['storage.baseMB'] = MB(base.bytes);
            detail.storage = { files: base.files, estimateMB: await page.evaluate(async () => Math.round((await navigator.storage.estimate()).usage! / 1e5) / 10) };
          }
        }
        // The title's own frames (its 3D scene), at the profile's throttle.
        await throttle(cdp, profile.rate);
        await page.goto(`${BASE}/`);
        await page.waitForFunction(() => window.openSinnohTitle?.phase === 'title' && !window.openSinnohTitle.inputBlocked, undefined, { timeout: 300_000 });
        await page.evaluate(() => (window.openSinnohTitle!.frameMs.length = 0));
        await page.waitForTimeout(3000);
        detail.title = summary(await page.evaluate(() => [...window.openSinnohTitle!.frameMs]));
        await throttle(cdp, 1);

        // Saves: a new game's, moved to each scene; the battles' from the debug panel.
        await openReplay(page);
        await page.evaluate(() => window.openSinnohGame!.reset(1));
        const base = await bridgeSave(page);
        const single = await battleSave(page, [['platinum:SPECIES_MONFERNO', 25]], 'platinum:MAP_HEADER_ROUTE_201', 118, 853, 'right');
        const doubles = await battleSave(page, [['platinum:SPECIES_STARAVIA', 25], ['platinum:SPECIES_MONFERNO', 25]], 'platinum:MAP_HEADER_ROUTE_204_NORTH', 176, 685, 'up');

        const scenes: Record<string, SceneResult> = {};
        const scenePlan: [string, string, (page: Page) => Promise<void>][] = [
          ['bedroom', base, walk],
          ...FIELD.map(([name, zone, x, z]): [string, string, (page: Page) => Promise<void>] => [name, moved(base, zone, x, z), walk]),
          ['battle-single', single, battle(['ArrowLeft', 'ArrowRight'])],
          ['battle-doubles', doubles, battle(['ArrowUp'])],
        ];
        const only = option('scenes')?.split(',');
        for (const [name, save, play] of scenePlan.filter(([name]) => !only || only.includes(name))) {
          const r = await measureScene(page, cdp, profile, dir, save, play);
          scenes[name] = r;
          console.log(`  ${name.padEnd(15)} frame p50/p95/p99/max ${r.frame.p50}/${r.frame.p95}/${r.frame.p99}/${r.frame.max} ms · tick p99/max ${r.tick.p99}/${r.tick.max} · dropped ${r.dropped} · heap ${r.heapMB} MB · tex ${r.gpu?.textureMB} MB · load ${r.load.titleS}/${r.load.continueS} s${r.memoryMB ? ` · renderer ${r.memoryMB.renderer} MB (rss ${r.memoryMB.rendererRss}) gpu ${r.memoryMB.gpu} MB` : ''}`);
        }
        detail.scenes = scenes;
        const all = Object.values(scenes);
        const max = (f: (r: SceneResult) => number) => Math.max(...all.map(f));
        metrics['frame.p95'] = max((r) => r.frame.p95);
        metrics['frame.p99'] = max((r) => r.frame.p99);
        metrics['tick.p99'] = max((r) => r.tick.p99);
        metrics['tick.max'] = max((r) => r.tick.max);
        metrics.dropped = all.reduce((n, r) => n + r.dropped, 0);
        metrics['heap.maxMB'] = max((r) => r.heapMB);
        metrics['gpu.textureMB'] = max((r) => r.gpu?.textureMB ?? NaN);
        metrics['gpu.bufferMB'] = max((r) => r.gpu?.bufferMB ?? NaN);
        metrics['load.titleS'] = max((r) => r.load.titleS);
        metrics['load.continueS'] = max((r) => r.load.continueS);
        metrics['fieldDpr.max'] = max((r) => r.fieldDpr);
        if (profile.name === 'desktop') metrics['memory.gameMB'] = max((r) => r.memoryMB!.renderer);

        // Heap growth: round trips as play makes them (replay page, unthrottled): warp to Jubilife, warp back to the
        // Route 201 grass, a wild battle there. One renderer throughout: chunks, actors, the battle scene and card go.
        if (profile.name === 'desktop') {
          await openReplay(page);
          await loadZone(page, single);
          const warp = async (zone: string, x: number, z: number) => {
            await page.evaluate(({ zone, x, z }) => {
              window.openSinnohApp!.game.world.warp(zone as never, x, z, 'right');
              if (window.openSinnohGame!.until({ kind: 'idle' }, 3000) === null) throw new Error(`${zone}: not idle after the warp`);
            }, { zone, x, z });
            await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
          };
          const g = await heapGrowth(page, cdp, async () => {
            await warp('platinum:MAP_HEADER_JUBILIFE_CITY', 174, 770);
            await warp('platinum:MAP_HEADER_ROUTE_201', 118, 853);
            const ticks = await page.evaluate(() => {
              const g = window.openSinnohGame!;
              g.setWildBattles('battle');
              // Pace two tiles each way in the grass until a wild battle starts.
              for (let step = 0; !window.openSinnohApp!.game.inBattle(); step++) {
                if (step >= 500) return null;
                const dir = step % 2 ? 'left' : 'right';
                g.press(dir);
                g.advance(16);
                g.release(dir);
              }
              return g.battleAuto(30_000);
            });
            if (ticks === null) throw new Error('round trip: no wild battle on Route 201, or it did not finish');
            await page.evaluate(() => window.openSinnohGame!.advanceText(3000));
            await page.waitForFunction(() => window.openSinnohApp?.sceneLoading() === false, undefined, { timeout: 120_000 });
          });
          metrics['heap.growthMB'] = g.growthMB;
          detail.heapGrowth = g;
          detail.renderStats = await page.evaluate(() => {
            const s = (globalThis as { openSinnohRenderStats?: { geometries: number; textures: number; cachedModels: number; chunks: number } }).openSinnohRenderStats!;
            return { geometries: s.geometries, textures: s.textures, cachedModels: s.cachedModels, chunks: s.chunks };
          });
        }
      } finally {
        await context.close();
        if (fresh) rmSync(dir, { recursive: true, force: true });
      }

      // A first visit to the production build's ROM page on slow 4G, at the profile's throttle.
      const visitDir = join(tmpdir(), `opensinnoh-perf-visit-${process.pid}`);
      rmSync(visitDir, { recursive: true, force: true });
      const visit = await launch(profile, visitDir);
      try {
        await visit.cdp.send('Network.enable');
        await visit.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (750e3 / 8) * 0.9 });
        await throttle(visit.cdp, profile.rate);
        const t0 = Date.now();
        await visit.page.goto(`${PROD}/`, { waitUntil: 'load' });
        await visit.page.locator('#rom-input').waitFor({ state: 'attached' });
        await visit.page.waitForFunction(() => document.getElementById('picker')?.hidden === false && document.fonts.status === 'loaded');
        metrics['firstVisit.s'] = (Date.now() - t0) / 1000;
      } finally {
        await visit.context.close();
        rmSync(visitDir, { recursive: true, force: true });
      }
      sections.push({ section: profile.name, metrics, detail });
    }
  } finally {
    prod.kill();
  }
}

(server as ChildProcess | null)?.kill();

// ---- report ----------------------------------------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });
const rows: BudgetRow[] = [];
for (const s of sections) {
  const r = checkBudgets(s.section, s.metrics, BUDGETS);
  rows.push(...r);
  writeFileSync(join(OUT, `${s.section}.json`), JSON.stringify({ section: s.section, at: new Date().toISOString(), gl: GL, metrics: s.metrics, budgets: r, detail: s.detail }, null, 1) + '\n');
}
if (rows.length) {
  console.log(`\n${formatRows(rows)}\n\nwritten to ${OUT}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Budgets\n\n${markdownRows(rows)}\n`);
}
const failed = rows.filter((r) => !r.pass);
if (failed.length) {
  console.error(`\n${failed.length} budget(s) failed`);
  process.exit(1);
}
process.exit(0);
