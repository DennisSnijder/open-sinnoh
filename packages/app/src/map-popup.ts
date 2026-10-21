/**
 * Draws the map-name popup (`Game.mapPopup()`) on the field overlay canvas: the zone's ROM signboard at
 * the top-left of the field, scrolled up by the popup's offset, with the name in the message font
 * (the ROM's system font is the same file) in the signboard's text colours. Whole device pixels per DS
 * pixel: the DS proportions on phones, at most the UI's dot size on big screens, so it stays a modest
 * board in the corner.
 */
import type { AssetSource, LoadedFont, MapPopupView, Registries, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { drawText } from '@opensinnoh/text';

/** Where the name starts on the board (decomp MapNamePopUp_DrawWindowFrame: centred by its own rule). */
export function mapPopupTextX(width: number): number {
  const margin = Math.floor((width + 8) / 8) * 8 - width;
  const left = Math.floor(margin / 2);
  const spare = 4 + left >= 8 ? 0 : Math.floor(((8 - (4 + left)) * 2 + 7) / 8);
  const x = width <= 0 ? 0 : Math.floor(((Math.floor((width + 8) / 8) + spare) * 8 + 8 - width) / 2);
  return 4 + x;
}

/** The name's top on the board (decomp MapNamePopUp_PrintMapName: y 2 tiles). */
const TEXT_Y = 16;

/**
 * Device px per DS px: the overlay's DS scale (`fit`), capped at the UI's dot (2 CSS px, 3 when the
 * view's short side is ≥ 900 px, as in docs/ui/design.md).
 */
export function mapPopupScale(fit: number, view: { width: number; height: number }, dpr: number): number {
  const dot = Math.min(view.width, view.height) >= 900 ? 3 : 2;
  return Math.max(1, Math.min(fit, Math.round(dot * dpr)));
}

interface Board {
  image: ImageBitmap;
  sheet: Ui2dSheet;
  font: LoadedFont;
}

export class MapPopupLayer {
  private readonly boards = new Map<Id, Promise<Board>>();
  private readonly ready = new Map<Id, Board>();

  constructor(
    private readonly assets: AssetSource,
    private readonly registries: () => Registries,
    private readonly font: () => LoadedFont,
  ) {}

  /** Starts loading a board; it is drawn from the first frame after it has loaded. */
  private board(window: Id): Board | null {
    const got = this.ready.get(window);
    if (got) return got;
    if (!this.boards.has(window)) {
      const sheet = this.registries().ui2d.get(window);
      if (!sheet) throw new Error(`map popup: no ui2d sheet ${window}`);
      const colors = sheet.textColors?.[0];
      if (sheet.cells.length !== 1 || !colors) throw new Error(`map popup: ${window} is not a one-cell sheet with text colours`);
      const load = this.assets
        .get(sheet.atlas)
        .then((blob) => createImageBitmap(blob))
        .then((image) => {
          const board = { image, sheet, font: tint(this.font(), colors) };
          this.ready.set(window, board);
          return board;
        });
      load.catch((e: unknown) => console.error(`map popup: cannot load ${window}`, e));
      this.boards.set(window, load);
    }
    return null;
  }

  draw(ctx: CanvasRenderingContext2D, view: MapPopupView | null, scale: number): void {
    if (!view) return;
    const b = this.board(view.window);
    if (!b) return;
    const cell = b.sheet.cells[0]!;
    const y = -view.offset * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(b.image, cell.x, cell.y, cell.w, cell.h, 0, y, cell.w * scale, cell.h * scale);
    let width = 0;
    for (const c of view.name) width += b.font.glyph.get(c)?.width ?? b.font.cellWidth;
    drawText(ctx, b.font, view.name, mapPopupTextX(width) * scale, y + TEXT_Y * scale, scale);
    ctx.restore();
  }
}

/** The font atlas (dark foreground, light shadow inks) recoloured to the board's text colours. */
export function tint(font: LoadedFont, colors: { fg: string; shadow: string }): LoadedFont {
  const src = font.image as ImageBitmap | HTMLImageElement | HTMLCanvasElement;
  const canvas = document.createElement('canvas');
  canvas.width = src.width;
  canvas.height = src.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const rgb = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const fg = rgb(colors.fg);
  const shadow = rgb(colors.shadow);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    px.set(px[i]! < 140 ? fg : shadow, i);
  }
  ctx.putImageData(img, 0, 0);
  return { ...font, image: canvas };
}
