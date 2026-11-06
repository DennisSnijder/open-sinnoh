/**
 * Browser replays through the app (packages/app) and `window.openSinnohGame` (contracts bridge.ts), at
 * 1280×720 and 390×844. The app is opened at `/?packs=<ids>&replay` and reads the packs from the
 * opensinnoh packs plugin.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { createServer } from 'vite';
import type { UntilCondition } from '@opensinnoh/core';
import type { GameSnapshot, OpenSinnohBridge, Registries } from '@opensinnoh/contracts';
import { failedReplay, runReplay, type ReplayDriver } from '@opensinnoh/game';
import { launchReplayBrowser } from '../../../tools/browser.ts';
import { openSinnohPacksPlugin } from './plugin.ts';
import { fileReplayResolver } from './workspace.ts';
import type { ReplayRun } from './test-command.ts';

export const REPO_ROOT = resolve(import.meta.dirname, '../../..');
export const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
] as const;

/** The app adds `until` and `advanceText` (the same loops as the headless driver, run in the page) to the contracts bridge. */
type BridgeWindow = Window & { openSinnohGame?: OpenSinnohBridge & { until(until: UntilCondition, max: number): number | null; advanceText(max: number, close?: boolean): number | null; battleAuto(max: number, move?: number): number | null; battleCatch(ball: string, max: number): number | null; grind(slot: number, level: number, dirs: ["up" | "down" | "left" | "right", "up" | "down" | "left" | "right"], max: number): number | null } };

export function appAvailable(): boolean {
  return existsSync(join(REPO_ROOT, 'index.html'));
}

/** Replay driver over the bridge in a Playwright page. */
export function pageDriver(page: Page, screenshotDir: string, prefix: string): ReplayDriver {
  // Each callback runs in the page, so it names the bridge itself.
  return {
    reset: (seed) => page.evaluate(async (s) => await (window as BridgeWindow).openSinnohGame!.reset(s), seed),
    advance: (n) => page.evaluate((t) => (window as BridgeWindow).openSinnohGame!.advance(t), n),
    press: (button) => page.evaluate((b) => (window as BridgeWindow).openSinnohGame!.press(b), button),
    release: (button) => page.evaluate((b) => (window as BridgeWindow).openSinnohGame!.release(b), button),
    touch: (x, y) => page.evaluate(([a, b]) => (window as BridgeWindow).openSinnohGame!.touch(a, b), [x, y] as const),
    untouch: () => page.evaluate(() => (window as BridgeWindow).openSinnohGame!.untouch()),
    tap: (id) => page.evaluate((t) => (window as BridgeWindow).openSinnohGame!.tap(t), id),
    // JSON transport: the snapshot is plain data.
    snapshot: async () => JSON.parse(await page.evaluate(() => JSON.stringify((window as BridgeWindow).openSinnohGame!.snapshot()))) as GameSnapshot,
    save: () => page.evaluate(() => (window as BridgeWindow).openSinnohGame!.save()),
    load: (json, entry) => page.evaluate(([j, e]) => (window as BridgeWindow).openSinnohGame!.load(j, e), [json, entry] as const),
    resetSave: () => page.evaluate(() => (window as BridgeWindow).openSinnohGame!.resetSave()),
    until: (until, max) => page.evaluate(([u, m]) => (window as BridgeWindow).openSinnohGame!.until(u, m), [until, max] as const),
    advanceText: (max, close) => page.evaluate(([m, c]) => (window as BridgeWindow).openSinnohGame!.advanceText(m, c), [max, close] as const),
    fieldMove: (slot, move) => page.evaluate(([s, m]) => (window as BridgeWindow).openSinnohGame!.useFieldMove(s, m), [slot, move] as const),
    setClock: (date, time) => page.evaluate(([d, t]) => (window as BridgeWindow).openSinnohGame!.setClock(d ?? undefined, t ?? undefined), [date ?? null, time ?? null] as const),
    battleChoose: (choice) => page.evaluate((c) => (window as BridgeWindow).openSinnohGame!.battleChoose(c), choice),
    setWildBattles: (mode) => page.evaluate((m) => (window as BridgeWindow).openSinnohGame!.setWildBattles(m), mode),
    setEvolutions: (mode) => page.evaluate((m) => (window as BridgeWindow).openSinnohGame!.setEvolutions(m), mode),
    openMysteryGift: () => page.evaluate(() => (window as BridgeWindow).openSinnohGame!.openMysteryGift()),
    battleAuto: (max, move) => page.evaluate(([m, s]) => (window as BridgeWindow).openSinnohGame!.battleAuto(m, s), [max, move] as const),
    grind: (slot, level, dirs, max) => page.evaluate(([s, l, d, m]) => (window as BridgeWindow).openSinnohGame!.grind(s, l, d, m), [slot, level, dirs, max] as const),
    battleCatch: (ball, max) => page.evaluate(([b, m]) => (window as BridgeWindow).openSinnohGame!.battleCatch(b, m), [ball, max] as const),
    async screenshot(name) {
      await waitForScene(page);
      mkdirSync(screenshotDir, { recursive: true });
      const path = join(screenshotDir, `${prefix}-${name}.png`);
      await page.screenshot({ path });
      return path;
    },
    viewport: (width, height) => page.setViewportSize({ width, height }),
  };
}

/** Opens the app in `page` and waits for the bridge. Page errors are collected into `errors`. */
export async function openApp(page: Page, baseUrl: string, packIds: readonly string[], errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl}/?packs=${packIds.join(',')}&replay`);
  await page.waitForFunction(() => (window as BridgeWindow).openSinnohGame?.ready === true, undefined, { timeout: 30_000 });
}

export async function runBrowserReplays(args: { files: string[]; dirs: Map<string, string>; registries: Registries; seed: number; output: string }): Promise<ReplayRun[]> {
  if (!appAvailable()) throw new Error(`browser replays need the app: no index.html in ${REPO_ROOT}`);
  const server = await createServer({ root: REPO_ROOT, plugins: [openSinnohPacksPlugin([...args.dirs.values()])], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('vite: no server port');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const session = await launchReplayBrowser();
  const results: ReplayRun[] = [];
  try {
    for (const viewport of VIEWPORTS) {
      for (const file of args.files) {
        const mode = `${viewport.width}x${viewport.height}`;
        const context = await session.browser.newContext({ viewport, hasTouch: viewport.width < 768 });
        const errors: string[] = [];
        try {
          const page = await context.newPage();
          await openApp(page, baseUrl, [...args.dirs.keys()], errors);
          const r = await runReplay(pageDriver(page, join(args.output, 'screenshots'), `${basename(file, '.replay')}-${mode}`), readFileSync(file, 'utf8'), {
            registries: args.registries,
            seed: args.seed,
            name: relative(process.cwd(), file),
            resolve: fileReplayResolver,
          });
          if (errors.length) Object.assign(r, { ok: false, error: `page errors: ${errors.join('; ')}` });
          results.push({ file: relative(process.cwd(), file), mode, ...r });
        } catch (e) {
          results.push({ file: relative(process.cwd(), file), mode, ...failedReplay((e as Error).message) });
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    try {
      await session.close();
    } finally {
      await server.close();
    }
  }
  return results;
}

/** Waits until the app's renderer has loaded everything for the current view, then one more frame. */
export async function waitForScene(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as { openSinnohApp?: { sceneLoading(): boolean } }).openSinnohApp?.sceneLoading() === false, undefined, { timeout: 30_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

/** Samples the main WebGL canvas right after a frame: distinct colours and share of non-black pixels. */
export async function mainCanvasStats(page: Page): Promise<{ colours: number; litShare: number }> {
  return page.evaluate(
    () =>
      new Promise<{ colours: number; litShare: number }>((resolve) => {
        requestAnimationFrame(() => {
          const src = document.getElementById('main-canvas') as HTMLCanvasElement;
          const copy = document.createElement('canvas');
          copy.width = src.width;
          copy.height = src.height;
          const g = copy.getContext('2d')!;
          g.drawImage(src, 0, 0);
          const px = g.getImageData(0, 0, copy.width, copy.height).data;
          const colours = new Set<number>();
          let lit = 0;
          let n = 0;
          for (let i = 0; i < px.length; i += 4 * 7) {
            n++;
            colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
            if (px[i]! + px[i + 1]! + px[i + 2]! > 30) lit++;
          }
          resolve({ colours: colours.size, litShare: lit / n });
        });
      }),
  );
}
