/**
 * Field edge marking in Twinleaf Town at day, twilight and night (OPENSINNOH_NDS_ROM; skipped without it).
 * The time of day comes from the ROM's area light templates (light set 0 at 12:00, 18:30, 22:00, the
 * field's first-template-ending-later rule), put into the light record before the town loads (until the
 * time-of-day clock is on main; then its `?time=` override replaces this).
 * Each frame is drawn three ways with no tick between: as usual, with edge marking off
 * (`openSinnohRenderDebug.edges`; the pixels that differ are the outline) and as the polygon ID buffer
 * (`openSinnohRenderDebug.polygonIds`). Checked: the outline is the DS colour (RGB555 4,4,4 = 33) blended
 * 17/32 over the far side (composite.ts `edgePixel`), darker than the scene around it at every time, one
 * DS pixel (4 device px at 720 px high) wide, and never inside the ground: all ground layers (grass,
 * paths, flower patches) are one polygon ID, so their seams carry no line.
 * Screenshots go to test-artifacts/edges (gitignored: ROM content, never commit).
 */
import { readFileSync } from 'node:fs';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { GameSnapshot, Light } from '@opensinnoh/contracts';
import { NitroFs, readNarc } from '@opensinnoh/nds';
import { readAreaLight, templateAt } from '../../packages/importer/src/formats/area-light.ts';
import { waitForScene } from '../../packages/cli/src/browser.ts';
import { seedRomImport } from './seed.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const SHOTS = process.env.OPENSINNOH_EDGE_SHOTS ?? 'test-artifacts/edges';

test.describe.configure({ mode: 'serial' });
test.skip(!ROM, 'OPENSINNOH_NDS_ROM is not set');

let context: BrowserContext;
let page: Page;
const errors: string[] = [];

test.beforeAll(async ({ browser }, info) => {
  const use = info.project.use;
  context = await browser.newContext({ baseURL: use.baseURL, viewport: use.viewport, hasTouch: use.hasTouch, isMobile: use.isMobile, deviceScaleFactor: use.deviceScaleFactor });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
});

test.afterAll(async () => {
  await context?.close();
});

/** Twinleaf's light set (area 6 → light 0) at a time of day, as the importer converts a template. */
function lightAt(seconds: number): Omit<Light, 'id' | 'sourceIndex'> {
  const fs = new NitroFs(new Uint8Array(readFileSync(ROM as string)));
  const t = templateAt(readAreaLight(readNarc(fs.file('/data/arealight.narc'))[0]!), seconds);
  const c31 = (c: readonly number[]) => c.map((x) => x / 31) as [number, number, number];
  return {
    lights: t.lights.map((l) => (l ? { color: c31(l.color), direction: l.direction.map((x) => x / 4096) as [number, number, number] } : null)),
    diffuse: c31(t.diffuse),
    ambient: c31(t.ambient),
    specular: c31(t.specular),
    emission: c31(t.emission),
  };
}

interface Frame {
  edgePixels: number;
  /** Edge pixels within 3 of the DS colour blended over their far neighbour. */
  matching: number;
  /** Edge pixels darker (sum of channels) than the far neighbour they outline. */
  darker: number;
  /** Edge pixels whose four neighbours one DS pixel away all carry their own ID (a line inside one ID). */
  insideOneId: number;
  /** Edge pixels of the old light-grey colour (123). */
  lightGrey: number;
  /** Share of the frame drawn with ID 0 (the ground layers and characters), and IDs present. */
  groundShare: number;
  ids: number[];
  /** Horizontal runs of edge pixels by length. */
  runs: Record<number, number>;
  meanEdge: number;
  meanScene: number;
  /** Edge pixels by "own ID>far ID", and frame pixels by ID. */
  pairs: Record<string, number>;
  idPixels: Record<number, number>;
  /** Device pixels per DS pixel (the edge pass's neighbour distance). */
  k: number;
}

async function twinleafAt(name: string, seconds: number, project: string): Promise<Frame> {
  await page.goto('/?replay');
  await page.waitForFunction(() => window.openSinnohGame?.ready === true, undefined, { timeout: 60_000 });
  // The new game starts in the bedroom (another area): Twinleaf's chunks are built after the light is set.
  await page.evaluate((light) => {
    const record = window.openSinnohApp!.game.registries.lights.get('platinum:light/0' as never)!;
    Object.assign(record, light);
  }, lightAt(seconds));
  const { state } = JSON.parse(await page.evaluate(() => JSON.stringify(window.openSinnohGame!.snapshot()))) as GameSnapshot;
  // On the north–south path between the player's and Barry's houses, the sign and a mailbox in view.
  const moved = { ...state, player: { zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN', x: 112, z: 882, y: 0, facing: 'down' }, objects: [], follower: null };
  await page.evaluate((json) => window.openSinnohGame!.load(json, 'arrival'), JSON.stringify({ format: 'lantern-nds-save', version: 1, savedAt: '2026-01-01T00:00:00.000Z', state: moved }));
  await waitForScene(page);
  // Past the load's fade in and the map name popup.
  await page.evaluate(() => window.openSinnohGame!.advance(240));
  await waitForScene(page);
  await page.screenshot({ path: `${SHOTS}/${project}-twinleaf-${name}.png` });
  const set = (edges: boolean, polygonIds: boolean) =>
    page.evaluate(([e, p]) => {
      const debug = (globalThis as unknown as { openSinnohRenderDebug: { edges: boolean; polygonIds: boolean } }).openSinnohRenderDebug;
      debug.edges = e;
      debug.polygonIds = p;
    }, [edges, polygonIds] as const);
  // The canvas itself (device pixels, no page UI over it), read in the frame that drew it.
  await page.evaluate(() => void ((globalThis as unknown as { edgeShots: ImageData[] }).edgeShots = []));
  for (const [edges, ids] of [[true, false], [false, false], [true, true]] as const) {
    await set(edges, ids);
    await waitForScene(page);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            const src = document.getElementById('main-canvas') as HTMLCanvasElement;
            const g = new OffscreenCanvas(src.width, src.height).getContext('2d')!;
            g.drawImage(src, 0, 0);
            (globalThis as unknown as { edgeShots: ImageData[] }).edgeShots.push(g.getImageData(0, 0, src.width, src.height));
            resolve();
          }),
        ),
    );
  }
  await set(true, false);
  return page.evaluate(
    () => {
      const images = (globalThis as unknown as { edgeShots: ImageData[] }).edgeShots;
      const src = document.getElementById('main-canvas') as HTMLCanvasElement;
      // Device pixels per DS pixel, as the renderer rounds it.
      const k = Math.max(1, Math.round(src.width / src.height >= 4 / 3 ? src.height / 192 : src.width / 256));
      const { width, height } = images[0]!;
      const [shown, plain, idView] = images.map((m) => m.data) as [Uint8ClampedArray, Uint8ClampedArray, Uint8ClampedArray];
      const id = (p: number) => Math.round((idView[p * 4]! * 63) / 255);
      const sum = (a: Uint8ClampedArray, p: number) => a[p * 4]! + a[p * 4 + 1]! + a[p * 4 + 2]!;
      const grey = 33; // RGB555 4 expanded (c << 3 | c >> 2)
      const out = { k, pairs: {} as Record<string, number>, idPixels: {} as Record<number, number>, edgePixels: 0, matching: 0, darker: 0, insideOneId: 0, lightGrey: 0, groundShare: 0, ids: [] as number[], runs: {} as Record<number, number>, meanEdge: 0, meanScene: 0 };
      const ids = new Set<number>();
      let edgeSum = 0;
      let sceneSum = 0;
      for (let y = k; y < height - k; y++) {
        let run = 0;
        for (let x = k; x < width - k; x++) {
          const p = y * width + x;
          const own = id(p);
          ids.add(own);
          out.idPixels[own] = (out.idPixels[own] ?? 0) + 1;
          if (own === 0) out.groundShare++;
          sceneSum += sum(plain, p);
          const edge = [0, 1, 2].some((c) => shown[p * 4 + c] !== plain[p * 4 + c]);
          if (!edge) {
            if (run) out.runs[run] = (out.runs[run] ?? 0) + 1;
            run = 0;
            continue;
          }
          run++;
          out.edgePixels++;
          edgeSum += sum(shown, p);
          if (shown[p * 4] === 123 && shown[p * 4 + 1] === 123 && shown[p * 4 + 2] === 123) out.lightGrey++;
          // The far side: the first neighbour one DS pixel away with another ID (the shader's order).
          const far = [p + k, p - k, p + k * width, p - k * width].find((n) => id(n) !== own);
          if (far === undefined) {
            out.insideOneId++;
            continue;
          }
          out.pairs[`${own}>${id(far)}`] = (out.pairs[`${own}>${id(far)}`] ?? 0) + 1;
          // Against the rear plane (ID 63, alpha 0) the edge colour is not blended.
          const expected = [0, 1, 2].map((c) => (id(far) === 63 ? grey : (grey * 17 + plain[far * 4 + c]! * 15) / 32));
          if (expected.every((v, c) => Math.abs(v - shown[p * 4 + c]!) <= 3)) out.matching++;
          if (sum(shown, p) < sum(plain, far)) out.darker++;
        }
        if (run) out.runs[run] = (out.runs[run] ?? 0) + 1;
      }
      const area = (width - 2 * k) * (height - 2 * k);
      out.groundShare /= area;
      out.ids = [...ids].sort((a, b) => a - b);
      out.meanEdge = edgeSum / Math.max(1, out.edgePixels) / 3;
      out.meanScene = sceneSum / area / 3;
      return out;
    },
  );
}

test('Twinleaf outlines are the DS dark grey blended over the far side, at day, twilight and night', async () => {
  test.setTimeout(240_000);
  await seedRomImport(page);
  for (const [name, seconds] of [['day', 12 * 3600], ['twilight', 18.5 * 3600], ['night', 22 * 3600]] as const) {
    const f = await twinleafAt(name, seconds, test.info().project.name);
    expect(f.edgePixels, `${name}: outlines drawn`).toBeGreaterThan(500);
    expect(f.lightGrey, `${name}: no light-grey (15,15,15) outline`).toBe(0);
    expect(f.insideOneId, `${name}: no line inside one polygon ID (ground seams, path and flower edges)`).toBe(0);
    expect(f.matching / f.edgePixels, `${name}: DS colour blended 17/32 over the far side`).toBeGreaterThan(0.98);
    expect(f.darker / f.edgePixels, `${name}: lines darker than what they outline`).toBeGreaterThan(0.9);
    expect(f.meanEdge, `${name}: lines darker than the scene`).toBeLessThan(f.meanScene);
    // Every ground layer (grass, paths, flower patches, trees) and the characters are ID 0, most of the
    // frame; the houses are 8, the sign and mailbox models 32 and 40, the rear plane 63 (a few pixels no polygon covers, at the
    // frame's edge). So ground pixels carry a line only against the rear plane: none on path or flower seams.
    expect(f.groundShare, `${name}: ground share`).toBeGreaterThan(0.5);
    expect(f.ids, `${name}: IDs`).toEqual([0, 8, 32, 40, 63]);
    expect(Object.keys(f.pairs).filter((p) => p.startsWith('0>') && p !== '0>63'), `${name}: ground lines`).toEqual([]);
    // One DS pixel wide: the vertical house walls give runs of exactly k device pixels, the commonest run.
    const [common] = Object.entries(f.runs).sort((a, b) => b[1] - a[1])[0]!;
    expect(Number(common), `${name}: commonest horizontal run`).toBe(f.k);
  }
  expect(errors).toEqual([]);
});
