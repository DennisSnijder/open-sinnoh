/**
 * The frontier scene checks the frontier specs share (frontier.rom.spec.ts, frontier-factory.rom.spec.ts,
 * frontier-hall.rom.spec.ts): a running scene's DS frame at the layout's unit, centred in the room, clear of the
 * controls, nothing drawn outside it.
 */
import type { Page } from '@playwright/test';

/** Two animation frames: the overlay has drawn the current view. */
export const frame = (page: Page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/**
 * The running frontier scene's frame problems (null when no scene runs), after a frame is drawn: device px throughout.
 * The frame is at the layout's unit, inside the room and centred in it, the largest whole scale that fits on touch
 * layouts (the phone's game area), inside the viewport and clear of the on-screen controls; nothing is drawn on the
 * overlay outside it (the rest is black).
 */
export async function sceneProblems(page: Page): Promise<{ scene: number; problems: string[] } | null> {
  if (!(await page.evaluate(() => !!window.openSinnohApp!.game.scripts.view().frontier))) return null;
  await frame(page);
  return page.evaluate(() => {
    const fr = window.openSinnohApp!.game.scripts.view().frontier;
    if (!fr) return null;
    const out: string[] = [];
    const l = window.openSinnohApp!.layout;
    const dpr = devicePixelRatio || 1;
    const f = window.openSinnohApp!.overlayFrame();
    const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;
    const [W, H, s] = [canvas.width, canvas.height, f.scale];
    const [w, h] = [256 * s, 192 * s];
    const [L, T, R, B] = [l.room.left, l.room.top, l.room.right, l.room.bottom].map((v) => Math.round(v * dpr)) as [number, number, number, number];
    const at = `${w}×${h} at ${f.x},${f.y} in the room ${L},${T}–${W - R},${H - B}`;
    if (s !== Math.max(1, Math.round(l.ui.unit * dpr))) out.push(`scale ${s} is not the layout's unit ${l.ui.unit} × ${dpr}`);
    if (f.x < L || f.y < T || f.x + w > W - R || f.y + h > H - B) out.push(`frame ${at} leaves the room`);
    if (Math.abs(f.x - L - (W - R - f.x - w)) > 1 || Math.abs(f.y - T - (H - B - f.y - h)) > 1) out.push(`frame ${at} is off centre`);
    if (l.controls && 256 * (s + 1) <= W - L - R && 192 * (s + 1) <= H - T - B) out.push(`frame ${at}: scale ${s + 1} fits too`);
    const box = canvas.getBoundingClientRect();
    const css = new DOMRect(box.left + f.x / dpr, box.top + f.y / dpr, w / dpr, h / dpr);
    if (css.left < -0.5 || css.top < -0.5 || css.right > innerWidth + 0.5 || css.bottom > innerHeight + 0.5) out.push(`frame ${at} leaves the ${innerWidth}×${innerHeight} viewport`);
    for (const b of document.querySelectorAll<HTMLElement>('.controls button, .hud-button')) {
      const r = b.getBoundingClientRect();
      if (!r.width || getComputedStyle(b).visibility === 'hidden' || b.closest('[hidden]')) continue;
      if (r.left < css.right && css.left < r.right && r.top < css.bottom && css.top < r.bottom) out.push(`frame ${at} is under the ${b.dataset.button ?? b.getAttribute('aria-label')} button`);
    }
    const px = canvas.getContext('2d')!.getImageData(0, 0, W, H).data;
    let outside = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (x >= f.x && x < f.x + w && y >= f.y && y < f.y + h) continue;
        const i = (y * W + x) * 4;
        if (px[i]! + px[i + 1]! + px[i + 2]! > 0 || px[i + 3] !== 255) outside++;
      }
    if (outside) out.push(`${outside} px drawn outside the frame ${at} (or not black)`);
    return { scene: fr.scene, problems: out };
  });
}

