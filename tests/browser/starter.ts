/** The starter-choice scene in browser tests: its pixels and touch on its balls. */
import { expect, type Page } from '@playwright/test';

/** Waits until the scene shows the balls and the pointer (real time: the intro runs on the wall clock). */
export async function starterReady(page: Page): Promise<void> {
  await expect(page.locator('.starter')).toBeVisible();
  await page.waitForFunction(() => window.openSinnohStarter?.phase === 'choose', undefined, { timeout: 90_000 });
  await popped(page);
}

/** Waits until the disc is at rest (the 6-frame pop-up ran) and one more frame is drawn. */
export async function popped(page: Page): Promise<void> {
  await page.waitForFunction(() => window.openSinnohStarter?.popped === true, undefined, { timeout: 30_000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))));
}

/**
 * The Pokémon on the disc: opaque pixels inside the disc box that are not the disc's own colour (share
 * of the box), their distinct colours, and a hash of them (it changes with the species).
 */
export function starterSprite(page: Page): Promise<{ share: number; colours: number; hash: number }> {
  return page.evaluate(() => {
    const box = window.openSinnohStarter!.previewBox();
    const c = document.querySelector('.starter-2d') as HTMLCanvasElement;
    const px = c.getContext('2d')!.getImageData(box.x, box.y, box.width, box.height).data;
    // The disc's colour: a point inside its left rim.
    const at = ((box.height >> 1) * box.width + Math.round(box.width * 0.08)) * 4;
    const disc = [px[at], px[at + 1], px[at + 2]];
    let n = 0;
    let hash = 0;
    const colours = new Set<number>();
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] !== 255) continue;
      if (px[i] === disc[0] && px[i + 1] === disc[1] && px[i + 2] === disc[2]) continue;
      n++;
      const rgb = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!;
      colours.add(rgb);
      hash = (Math.imul(hash, 31) + rgb + i) | 0;
    }
    return { share: n / (box.width * box.height), colours: colours.size, hash };
  });
}

/** Taps (phone) or clicks (desktop) ball `i` of the scene. */
export async function tapBall(page: Page, i: number, phone: boolean): Promise<void> {
  const p = await page.evaluate((k) => window.openSinnohStarter!.ballPoint(k), i);
  if (phone) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Taps ball `i` and advances ticks (replay mode) until the VM's cursor is on it. */
export async function selectBall(page: Page, i: number, phone: boolean): Promise<void> {
  await tapBall(page, i, phone);
  for (let k = 0; k < 60 && (await page.evaluate(() => window.openSinnohStarter!.cursor)) !== i; k++) {
    // The scene presses one step per rendered frame; the tick takes it.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
    await page.evaluate(() => window.openSinnohGame!.advance(1));
  }
  expect(await page.evaluate(() => window.openSinnohStarter!.cursor)).toBe(i);
  await popped(page);
}
