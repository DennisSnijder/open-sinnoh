import type { Page } from '@playwright/test';

/** Distinct colours and opaque share of a canvas (2D or a WebGL one with a preserved buffer). */
export function canvasStats(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const src = document.querySelector(sel) as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    const colours = new Set<number>();
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
      if (px[i]! + px[i + 1]! + px[i + 2]! > 60) lit++;
    }
    return { colours: colours.size, lit: lit / (px.length / 4) };
  }, selector);
}

/** `canvasStats` of the battle canvas within the scene's rect (in window mode the rest is the dimmed field). */
export function battleSceneStats(page: Page) {
  return page.evaluate(() => {
    const info = window.openSinnohApp!.battleScene();
    const src = document.getElementById('battle-canvas') as HTMLCanvasElement;
    const box = src.getBoundingClientRect();
    const dpr = src.width / box.width;
    const x = Math.max(0, Math.round((info.rect.x - box.x) * dpr));
    const y = Math.max(0, Math.round((info.rect.y - box.y) * dpr));
    const w = Math.min(src.width - x, Math.round(info.rect.width * dpr));
    const h = Math.min(src.height - y, Math.round(info.rect.height * dpr));
    const px = src.getContext('2d')!.getImageData(x, y, w, h).data;
    const colours = new Set<number>();
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
      if (px[i]! + px[i + 1]! + px[i + 2]! > 60) lit++;
    }
    return { colours: colours.size, lit: lit / (px.length / 4) };
  });
}

/** Light pixels (all channels > 220, opaque) in a DS-px rect of the battle scene, counted in DS px. */
export function battleRegionLight(page: Page, ds: { x: number; y: number; w: number; h: number }) {
  return page.evaluate((r) => {
    const info = window.openSinnohApp!.battleScene();
    const src = document.getElementById('battle-canvas') as HTMLCanvasElement;
    const box = src.getBoundingClientRect();
    const dpr = src.width / box.width;
    const k = info.scale;
    const x0 = Math.round((info.rect.x - box.x) * dpr) + r.x * k;
    const y0 = Math.round((info.rect.y - box.y) * dpr) + r.y * k;
    const px = src.getContext('2d')!.getImageData(x0, y0, r.w * k, r.h * k).data;
    let light = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i + 3] === 255 && px[i]! > 220 && px[i + 1]! > 220 && px[i + 2]! > 220) light++;
    return light / (k * k);
  }, ds);
}

/**
 * The thrown ball's pixels on the battle canvas (the frame differs from the same view with `ball` patched
 * out, or with only its stars patched out): their top and bottom rows' centre x (DS px, a third of the
 * mask's height each), and how many DS px changed in all.
 */
export function ballMask(page: Page, only: 'ball' | 'stars' = 'ball') {
  return page.evaluate(async (what) => {
    type View = { ball: { x: number; y: number; stars: number | null } | null };
    const battle = window.openSinnohApp!.game.battle as unknown as { view(): View };
    const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const info = window.openSinnohApp!.battleScene();
    const src = document.getElementById('battle-canvas') as HTMLCanvasElement;
    const box = src.getBoundingClientRect();
    const dpr = src.width / box.width;
    const k = info.scale;
    const ball = battle.view().ball!;
    const r = what === 'ball' ? 16 : 64;
    const x0 = Math.round((info.rect.x - box.x) * dpr) + (ball.x - r) * k;
    const y0 = Math.round((info.rect.y - box.y) * dpr) + (ball.y - r) * k;
    const read = () => src.getContext('2d')!.getImageData(x0, y0, 2 * r * k, 2 * r * k).data;
    await frame();
    const shown = read();
    const view = battle.view.bind(battle);
    battle.view = () => {
      const v = view();
      return { ...v, ball: what === 'ball' ? null : v.ball && { ...v.ball, stars: null } };
    };
    await frame();
    const hidden = read();
    battle.view = view;
    await frame();
    const rows = new Map<number, number[]>();
    let changed = 0;
    for (let y = 0; y < 2 * r * k; y++)
      for (let x = 0; x < 2 * r * k; x++) {
        const i = (y * 2 * r * k + x) * 4;
        if (shown[i] === hidden[i] && shown[i + 1] === hidden[i + 1] && shown[i + 2] === hidden[i + 2]) continue;
        changed++;
        const row = ball.y - r + y / k;
        rows.set(Math.floor(row), [...(rows.get(Math.floor(row)) ?? []), ball.x - r + x / k]);
      }
    const ys = [...rows.keys()].sort((a, b) => a - b);
    const third = Math.max(1, Math.floor(ys.length / 3));
    const centre = (list: number[]) => {
      const xs = list.flatMap((y) => rows.get(y)!);
      return xs.reduce((a, b) => a + b, 0) / xs.length;
    };
    const size = 2 * r * k;
    return { top: centre(ys.slice(0, third)), bottom: centre(ys.slice(-third)), changed: changed / (k * k), rows: ys.length, k, size, x: ball.x, pixels: Array.from(shown) };
  }, only);
}

/**
 * How many of `a`'s ball pixels (opaque in both) differ from `b`'s moved by the balls' x difference: 0 for a
 * pure sideways move, more when the ball also turned.
 */
export function turnedPixels(a: { k: number; size: number; x: number; pixels: number[] }, b: { k: number; size: number; x: number; pixels: number[] }): number {
  const dx = (b.x - a.x) * a.k;
  let differ = 0;
  for (let y = 0; y < a.size; y++)
    for (let x = Math.max(0, -dx); x < Math.min(a.size, a.size - dx); x++) {
      const i = (y * a.size + x) * 4;
      const j = (y * a.size + x + dx) * 4;
      if (a.pixels[i] !== b.pixels[j] || a.pixels[i + 1] !== b.pixels[j + 1] || a.pixels[i + 2] !== b.pixels[j + 2]) differ++;
    }
  return differ / (a.k * a.k);
}

/**
 * Window mode, right after a frame: the field canvas in the strip left of the battle window (distinct
 * colours, lit share) and the battle canvas's alpha there (the dim).
 */
export function aroundBattleWindow(page: Page) {
  return page.evaluate(
    () =>
      new Promise<{ colours: number; lit: number; dimAlpha: number }>((resolve) => {
        requestAnimationFrame(() => {
          const info = window.openSinnohApp!.battleScene();
          const field = document.getElementById('main-canvas') as HTMLCanvasElement;
          const battle = document.getElementById('battle-canvas') as HTMLCanvasElement;
          const dpr = field.width / field.getBoundingClientRect().width;
          const w = Math.floor((info.rect.x - 16) * dpr);
          const h = field.height;
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d')!;
          g.drawImage(field, 0, 0, w, h, 0, 0, w, h);
          const px = g.getImageData(0, 0, w, h).data;
          const colours = new Set<number>();
          let lit = 0;
          for (let i = 0; i < px.length; i += 4) {
            colours.add((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!);
            if (px[i]! + px[i + 1]! + px[i + 2]! > 60) lit++;
          }
          const dim = battle.getContext('2d')!.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data[3]!;
          resolve({ colours: colours.size, lit: lit / (w * h), dimAlpha: dim / 255 });
        });
      }),
  );
}
