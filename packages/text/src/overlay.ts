/**
 * Draws the VM's message, yes/no, scripted-menu, current-floor, money and signpost boxes on a 2D canvas over the field, at an
 * integer scale. Geometry is in DS pixels of the 256×192 main screen, anchored bottom-centre in the canvas.
 * Frames are the ROM's window frames when given (`OverlayFrames`: the message box by the FRAME option, the
 * standard field frame for menus and the yes/no box), else original drawn borders (packs without them).
 * Signposts keep original looks.
 */
import { menuRects, type DrawScriptOverlay, type LoadedFont, type MenuView, type NineSliceArt, type SignpostKind } from '@opensinnoh/contracts';
import { LINE_HEIGHT } from './printer.ts';
import { MESSAGE_BOX } from './layout.ts';

export const SCREEN = { width: 256, height: 192 } as const;
/** Yes/no window interior (decomp: tiles 25,13, 6×4). */
export const YES_NO_BOX = { x: 200, y: 104, width: 48, height: 32 } as const;

/**
 * Signpost windows (decomp FieldMessage_AddSignpostWindow, DrawSignpostTiles): map and arrow signs have a
 * 6×4-tile picture left of a 20-tile text window; landmark and scrolling signs use the message window.
 */
export const SIGNPOST_BOX = {
  picture: { x: 16, y: 152, width: 48, height: 32 },
  map: { x: 72, y: 152, width: 160, height: 32 },
  arrow: { x: 72, y: 152, width: 160, height: 32 },
  landmark: MESSAGE_BOX,
  scrolling: MESSAGE_BOX,
} as const;

const FRAME = { fill: '#f8f8f8', border: '#484850', inner: '#a8b0b8' };
type Frame = typeof FRAME;
/** Original signpost looks: wooden map/arrow boards, a stone landmark plate, a parchment scrolling sign. */
const SIGN_FRAMES: Record<SignpostKind, Frame> = {
  map: { fill: '#f8f0d8', border: '#704828', inner: '#b08048' },
  arrow: { fill: '#f8f0d8', border: '#704828', inner: '#b08048' },
  landmark: { fill: '#f0f4f8', border: '#38485c', inner: '#7890a8' },
  scrolling: { fill: '#fcf4dc', border: '#806030', inner: '#d0b070' },
};

type Rect = { x: number; y: number; width: number; height: number };

export const drawScriptOverlay: DrawScriptOverlay = (ctx, view, font, scale, frames, unown) => {
  if (!Number.isInteger(scale) || scale < 1) throw new Error(`drawScriptOverlay: scale must be a positive integer, got ${scale}`);
  const ox = Math.floor((ctx.canvas.width / scale - SCREEN.width) / 2);
  const oy = Math.floor(ctx.canvas.height / scale - SCREEN.height);
  const px = (r: Rect, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect((ox + r.x) * scale, (oy + r.y) * scale, r.width * scale, r.height * scale);
  };
  const drawn = (r: Rect, f: Frame = FRAME) => {
    px({ x: r.x - 6, y: r.y - 6, width: r.width + 12, height: r.height + 12 }, f.border);
    px({ x: r.x - 4, y: r.y - 4, width: r.width + 8, height: r.height + 8 }, f.inner);
    px({ x: r.x - 3, y: r.y - 3, width: r.width + 6, height: r.height + 6 }, f.fill);
  };
  /** A ROM frame around the interior `r`: corners once, edges and centre repeated whole (as the DS tiles them). */
  const sliced = (r: Rect, art: NineSliceArt) => {
    const [l, t, rr, b] = art.slice;
    const cw = art.width - l - rr;
    const ch = art.height - t - b;
    const blit = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) => {
      for (let y = 0; y < dh; y += sh)
        for (let x = 0; x < dw; x += sw) {
          const w = Math.min(sw, dw - x);
          const h = Math.min(sh, dh - y);
          ctx.drawImage(art.image, sx, sy, w, h, (ox + dx + x) * scale, (oy + dy + y) * scale, w * scale, h * scale);
        }
    };
    const [x0, y0, x1, y1] = [r.x - l, r.y - t, r.x + r.width, r.y + r.height];
    blit(0, 0, l, t, x0, y0, l, t);
    blit(l, 0, cw, t, r.x, y0, r.width, t);
    blit(l + cw, 0, rr, t, x1, y0, rr, t);
    blit(0, t, l, ch, x0, r.y, l, r.height);
    blit(l, t, cw, ch, r.x, r.y, r.width, r.height);
    blit(l + cw, t, rr, ch, x1, r.y, rr, r.height);
    blit(0, t + ch, l, b, x0, y1, l, b);
    blit(l, t + ch, cw, b, r.x, y1, r.width, b);
    blit(l + cw, t + ch, rr, b, x1, y1, rr, b);
  };
  const frame = (r: Rect) => (frames ? sliced(r, frames.window) : drawn(r));
  const messageFrame = (r: Rect) => (frames ? sliced(r, frames.message) : drawn(r));
  const text = (s: string, x: number, y: number) => drawText(ctx, font, s, (ox + x) * scale, (oy + y) * scale, scale);

  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (view.message) {
    const sign = view.message.signpost;
    // A signpost slides below its resting place while it scrolls in or out; the screen edge clips it.
    const dy = sign?.offset ?? 0;
    const box = sign ? SIGNPOST_BOX[sign.kind] : MESSAGE_BOX;
    const at = { ...box, y: box.y + dy };
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox * scale, oy * scale, SCREEN.width * scale, SCREEN.height * scale);
    ctx.clip();
    if (sign) drawSignpost(px, drawn, sign.kind, at, dy);
    else messageFrame(at);
    // Decomp ScrCmd_MessageUnown prints with FONT_UNOWN.
    const messageFont = view.message.font === 'unown' ? unown : font;
    if (!messageFont) throw new Error('drawScriptOverlay: an Unown message without the Unown font');
    view.message.text.split('\n').slice(0, 2).forEach((line, i) => drawText(ctx, messageFont, line, (ox + at.x) * scale, (oy + at.y + i * LINE_HEIGHT) * scale, scale));
    // The DS draws the "more" arrow inside the box, at its bottom-right corner, clear of the frame.
    if (view.message.waitingForInput) drawArrow(px, at.x + at.width - 8, at.y + at.height - 5, 'down');
    ctx.restore();
  }
  if (view.frontier?.infoWindow) {
    // Decomp BattleCastle_ShowPlayerInfoWindows: the standard frame, each line at its place inside it.
    const w = view.frontier.infoWindow;
    frame(w);
    for (const line of w.lines) text(line.text, w.x + line.x, w.y + line.y);
  }
  if (view.floorWindow) {
    const w = view.floorWindow;
    frame(w);
    for (const line of w.lines) text(line.text, w.x + line.x, w.y + line.y);
  }
  if (view.moneyWindow) {
    // Decomp FieldMenu_PrintMoneyToWindow: the label at 0,0, the amount right-aligned on the second line.
    const w = view.moneyWindow;
    frame(w);
    text(w.label, w.x, w.y);
    text(w.amount, w.x + w.width - textWidth(font, w.amount), w.y + LINE_HEIGHT);
  }
  if (view.bpWindow) {
    // Decomp FieldMenu_PrintBPToWindow: the BP right-aligned on the window's one line.
    const w = view.bpWindow;
    frame(w);
    text(w.text, w.x + w.width - textWidth(font, w.text), w.y);
  }
  if (view.coinWindow) {
    // Decomp FieldMenu_PrintCoinsToWindow: the coins right-aligned on the window's one line.
    const w = view.coinWindow;
    frame(w);
    text(w.text, w.x + w.width - textWidth(font, w.text), w.y);
  }
  if (view.saveInfo) {
    // Decomp SaveInfoWindow_PrintText: the map name, then each label at the left and its value right-aligned.
    const w = view.saveInfo;
    frame(w);
    text(w.title, w.x, w.y);
    w.lines.forEach((l, i) => {
      text(l.label, w.x, w.y + (i + 1) * LINE_HEIGHT);
      text(l.value, w.x + w.width - textWidth(font, l.value), w.y + (i + 1) * LINE_HEIGHT);
    });
  }
  // Decomp DrawPokemonPreviewWindow: the standard frame around a 10×10-tile window; the app draws the picture in it.
  if (view.pokemonPreview) frame(view.pokemonPreview);
  if (view.menu) drawMenu(view.menu, frame, px, text);
  if (view.yesNo) {
    frame(YES_NO_BOX);
    [view.yesNo.yes, view.yesNo.no].forEach((label, i) => text(label, YES_NO_BOX.x + 12, YES_NO_BOX.y + i * LINE_HEIGHT));
    drawArrow(px, YES_NO_BOX.x + 2, YES_NO_BOX.y + view.yesNo.cursor * LINE_HEIGHT + 4, 'right');
  }
  ctx.restore();
};

type Px = (r: Rect, color: string) => void;

function drawArrow(px: Px, x: number, y: number, dir: 'down' | 'right' | 'up', color = FRAME.border) {
  for (let i = 0; i < 4; i++) {
    const len = 7 - i * 2;
    if (dir === 'down') px({ x: x + i, y: y + i, width: len, height: 1 }, color);
    else if (dir === 'up') px({ x: x + i, y: y + 3 - i, width: len, height: 1 }, color);
    else px({ x: x + i, y: y + i, width: 1, height: len }, color);
  }
}

/** A scripted menu: frame around all columns, entries 12 px in, the cursor 2 px in, list scroll marks. */
function drawMenu(menu: MenuView, frame: (r: Rect) => void, px: Px, text: (s: string, x: number, y: number) => void) {
  frame({ x: menu.x, y: menu.y, width: menu.width * menu.columns, height: menu.rows * 16 });
  menuRects(menu).forEach((r, i) => {
    if (!r) return;
    text(menu.entries[i]!, r.x + 12, r.y);
    if (i === menu.cursor) drawArrow(px, r.x + 2, r.y + 4, 'right');
  });
  const right = menu.x + menu.width * menu.columns - 8;
  if (menu.top > 0) drawArrow(px, right, menu.y - 5, 'up');
  if (menu.top + menu.rows < menu.entries.length) drawArrow(px, right, menu.y + menu.rows * 16 + 2, 'down');
}

/** Signpost frame and, for map and arrow signs, the picture board to the left (original drawings). */
function drawSignpost(px: Px, frame: (r: Rect, f: Frame) => void, kind: SignpostKind, box: Rect, dy: number) {
  const f = SIGN_FRAMES[kind];
  frame(box, f);
  if (kind === 'landmark') {
    // A small pin marks a landmark plate.
    px({ x: box.x - 2, y: box.y + 2, width: 4, height: 4 }, f.border);
    return;
  }
  if (kind === 'scrolling') {
    px({ x: box.x - 6, y: box.y - 8, width: box.width + 12, height: 2 }, f.inner);
    px({ x: box.x - 6, y: box.y + box.height + 6, width: box.width + 12, height: 2 }, f.inner);
    return;
  }
  const pic = { ...SIGNPOST_BOX.picture, y: SIGNPOST_BOX.picture.y + dy };
  frame(pic, f);
  if (kind === 'map') {
    // A folded town map: three panels and a route line.
    for (let i = 0; i < 3; i++) px({ x: pic.x + 4 + i * 14, y: pic.y + 4, width: 12, height: 24 }, i % 2 ? '#a8d090' : '#c8e0a8');
    px({ x: pic.x + 6, y: pic.y + 15, width: 36, height: 2 }, '#c05030');
  } else {
    // An arrow board pointing the way.
    px({ x: pic.x + 6, y: pic.y + 13, width: 26, height: 6 }, f.border);
    for (let i = 0; i < 9; i++) px({ x: pic.x + 32 + i, y: pic.y + 7 + i, width: 1, height: 18 - 2 * i }, f.border);
  }
}

/** A string's advance width in font pixels (Font_CalcStringWidth; unknown chars count their cell width, as drawText skips them). */
export function textWidth(font: LoadedFont, s: string): number {
  let w = 0;
  for (const c of s) w += font.glyph.get(c)?.width ?? font.cellWidth;
  return w;
}

/** Draws a string with a bitmap font at canvas pixel (x, y). Unknown chars are skipped by their cell width. */
export function drawText(ctx: CanvasRenderingContext2D, font: LoadedFont, s: string, x: number, y: number, scale: number): void {
  const cols = Math.floor((font.image as { width: number }).width / font.cellWidth);
  let cx = x;
  for (const c of s) {
    const g = font.glyph.get(c);
    if (!g) {
      cx += font.cellWidth * scale;
      continue;
    }
    const sx = (g.index % cols) * font.cellWidth;
    const sy = Math.floor(g.index / cols) * font.cellHeight;
    ctx.drawImage(font.image, sx, sy, font.cellWidth, font.cellHeight, cx, y, font.cellWidth * scale, font.cellHeight * scale);
    cx += g.width * scale;
  }
}

/** Builds a LoadedFont from a Font record's fields and its decoded atlas image. */
export function loadFont(record: { chars: string; widths: number[]; cellWidth: number; cellHeight: number }, image: CanvasImageSource): LoadedFont {
  const chars = Array.from(record.chars);
  if (chars.length !== record.widths.length) throw new Error(`font: ${chars.length} chars but ${record.widths.length} widths`);
  const glyph = new Map(chars.map((c, index) => [c, { index, width: record.widths[index]! }]));
  // The DS font has the typographic apostrophe only; our own UI strings type the ASCII one ("DON'T").
  const apostrophe = glyph.get('\u2019');
  if (!glyph.has("'") && apostrophe) glyph.set("'", apostrophe);
  return { image, cellWidth: record.cellWidth, cellHeight: record.cellHeight, glyph };
}

// Local copy of contracts 0.3.1 `choiceRects` / `hitChoice` (packages/contracts/src/ui.ts on main);
// replace with the contracts import at merge.
const CHOICE_TITLE_HEIGHT = 28;
const CHOICE_MARGIN = 8;
const CHOICE_GAP = 6;
const CHOICE_MAX_HEIGHT = 44;

/** Option rectangles of a 'choice' panel (256×192 panel coordinates). */
export function choiceRects(count: number): Rect[] {
  if (count < 1) return [];
  const avail = SCREEN.height - CHOICE_TITLE_HEIGHT - CHOICE_MARGIN;
  const height = Math.min(CHOICE_MAX_HEIGHT, Math.floor((avail - CHOICE_GAP * (count - 1)) / count));
  return Array.from({ length: count }, (_, i) => ({ x: CHOICE_MARGIN, y: CHOICE_TITLE_HEIGHT + i * (height + CHOICE_GAP), width: SCREEN.width - 2 * CHOICE_MARGIN, height }));
}

/** Index of the choice option under a panel point, or -1. */
export function hitChoice(count: number, point: { x: number; y: number }): number {
  return choiceRects(count).findIndex((r) => point.x >= r.x && point.x < r.x + r.width && point.y >= r.y && point.y < r.y + r.height);
}
