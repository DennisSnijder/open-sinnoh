import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { LoadedFont, ScriptView } from '@opensinnoh/contracts';
import { TextPrinter, toPrintOps, TEXT_SPEED, type PrinterInput } from './printer.ts';
import { layoutMessage, overflow, measureWith } from './layout.ts';
import { readNfgr, importFont } from './nfgr.ts';
import { encodePng } from './png.ts';
import { drawScriptOverlay, loadFont, choiceRects, hitChoice } from './overlay.ts';

const idle = { pressed: false, held: false };
const press = { pressed: true, held: true };

describe('TextPrinter', () => {
  it('prints one char per 4 render calls at normal speed (first char at once)', () => {
    const p = new TextPrinter(toPrintOps('abc'));
    const seen: string[] = [];
    for (let i = 0; i < 16 && !p.done; i++) {
      p.subStep(idle);
      seen.push(p.text());
    }
    expect(seen.slice(0, 9)).toEqual(['a', 'a', 'a', 'a', 'ab', 'ab', 'ab', 'ab', 'abc']);
    expect(p.done).toBe(true);
  });

  it('{clear} waits for A/B, then starts a new page; {scroll} keeps the last line', () => {
    const p = new TextPrinter(toPrintOps('a\nb{scroll}c{clear}d'), { speed: TEXT_SPEED.fast });
    const run = (n: number) => {
      for (let i = 0; i < n; i++) p.subStep(idle);
    };
    run(10);
    expect([p.text(), p.waiting]).toEqual(['a\nb', true]);
    p.subStep(press);
    run(10);
    expect(p.text()).toBe('b\nc');
    expect(p.waiting).toBe(true);
    p.subStep(press);
    run(10);
    expect([p.text(), p.done]).toEqual(['d', true]);
  });

  it('auto-scroll (battle): {clear} goes on after 100 render calls, or at a fresh press with skip', () => {
    const calls = (opts: ConstructorParameters<typeof TextPrinter>[1], input: PrinterInput = idle) => {
      const p = new TextPrinter(toPrintOps('a{clear}b'), { speed: TEXT_SPEED.fast, ...opts });
      let n = 0;
      while (!p.done) {
        p.subStep(n === 2 ? input : idle);
        n++;
      }
      return n;
    };
    // a, {clear}, 100 waiting calls, the 101st goes on, b, the end.
    expect(calls({ autoScroll: { skip: false } })).toBe(105);
    expect(calls({ autoScroll: { skip: false } }, press)).toBe(105);
    expect(calls({ autoScroll: { skip: true } }, press)).toBe(5);
    expect(calls({ autoScroll: { skip: true }, speedUpOnTouch: true }, { pressed: false, held: false, touchPressed: true, touchHeld: true })).toBe(5);
    expect(calls({ autoScroll: { skip: true } }, { pressed: false, held: false, touchPressed: true, touchHeld: true })).toBe(105);
  });

  it('reports a press that ends a {clear}/{scroll} wait (SE_CONFIRM), not a speed-up or a run-out auto-scroll', () => {
    const presses = (opts: ConstructorParameters<typeof TextPrinter>[1], pressAt: (n: number, p: TextPrinter) => boolean) => {
      const p = new TextPrinter(toPrintOps('abc{scroll}d{clear}e'), { speed: TEXT_SPEED.normal, canSpeedUp: true, ...opts });
      const continued: number[] = [];
      for (let n = 0; !p.done && n < 1000; n++) if (p.subStep(pressAt(n, p) ? press : idle)) continued.push(n);
      expect(p.done).toBe(true);
      return continued.length;
    };
    // A press at each wait: one per page break.
    expect(presses({}, (_n, p) => p.waiting)).toBe(2);
    // Pressing to speed up the printing (never at a wait) reports nothing; the waits still need their presses.
    expect(presses({}, (n, p) => p.waiting || n % 2 === 0 && !p.waiting && n < 6)).toBe(2);
    // Battle auto-scroll left to run out: silent; ended early by a press: reported.
    expect(presses({ autoScroll: { skip: true } }, () => false)).toBe(0);
    expect(presses({ autoScroll: { skip: false } }, (_n, p) => p.waiting)).toBe(0);
    expect(presses({ autoScroll: { skip: true } }, (_n, p) => p.waiting)).toBe(2);
  });

  it('touch (battle flag): a held touch prints a char per call without a fresh press', () => {
    const run = (opts: ConstructorParameters<typeof TextPrinter>[1]) => {
      const p = new TextPrinter(toPrintOps('abcd'), opts);
      let n = 0;
      while (!p.done) {
        p.subStep({ pressed: false, held: false, touchPressed: n === 0, touchHeld: true });
        n++;
      }
      return n;
    };
    // Without the flag a char every 4 calls (a on call 1, d on 13, the end on 17).
    expect(run({ canSpeedUp: true })).toBe(17);
    expect(run({ canSpeedUp: true, speedUpOnTouch: true })).toBe(5);
  });

  it('a {clear} empties the window only when the next char prints (a message ending in one keeps its text)', () => {
    const p = new TextPrinter(toPrintOps('ab{clear}'), { speed: TEXT_SPEED.fast });
    while (!p.waiting) p.subStep(idle);
    p.subStep(press);
    while (!p.done) p.subStep(idle);
    expect(p.text()).toBe('ab');
  });

  it('expands template slots and fails on a missing one', () => {
    expect(new TextPrinter(toPrintOps('Hi {var 0}!', ['Ari']), { speed: 0 }).text()).toBe('Hi Ari!');
    expect(() => toPrintOps('Hi {var 1}', ['Ari'])).toThrow(/slot 1/);
  });
});

describe('layout', () => {
  const measure = (s: string) => s.length * 6;
  it('splits pages on {clear} and {scroll}', () => {
    const pages = layoutMessage('one\ntwo{scroll}three{clear}four {var 0}', ['Bo'], measure);
    expect(pages.map((p) => [p.lines.map((l) => l.text), p.end])).toEqual([
      [['one', 'two'], 'scroll'],
      [['two', 'three'], 'clear'],
      [['four Bo'], 'end'],
    ]);
    expect(pages[0]!.lines[0]!.width).toBe(18);
  });
  it('reports overflow', () => {
    expect(overflow(layoutMessage('a\nb\nc', [], measure))).toHaveLength(1);
    expect(overflow(layoutMessage('x'.repeat(40), [], measure))).toHaveLength(1);
    expect(overflow(layoutMessage('fits', [], measure))).toEqual([]);
  });
  it('measures with font widths', () => {
    const m = measureWith({ cellWidth: 8, glyph: new Map([['a', { index: 0, width: 5 }]]) });
    expect(m('aa?')).toBe(18);
  });
});

/** Synthetic NFGR (our own writer): 2 glyphs of 2×2 tiles. */
function makeNfgr(): Uint8Array {
  const glyphs = 2;
  const header = 16;
  const widthOffset = header + glyphs * 64;
  const b = new Uint8Array(widthOffset + glyphs);
  const v = new DataView(b.buffer);
  v.setUint32(0, header, true);
  v.setUint32(4, widthOffset, true);
  v.setUint32(8, glyphs, true);
  b.set([16, 16, 2, 2], 12);
  // glyph 0, tile 0, row 0: pixels 0..3 = 1,2,3,0 (second byte), pixels 4..7 = 1,0,0,0 (first byte)
  b[header + 1] = 0b01_10_11_00;
  b[header] = 0b01_00_00_00;
  // glyph 1, tile 3 (bottom right), row 7: pixel 7 = 2
  b[header + 64 + 3 * 16 + 7 * 2] = 0b00_00_00_10;
  b[widthOffset] = 6;
  b[widthOffset + 1] = 9;
  return b;
}

describe('NFGR', () => {
  it('reads 2bpp glyphs', () => {
    const f = readNfgr(makeNfgr());
    expect([f.numGlyphs, f.cellWidth, f.cellHeight, f.widths]).toEqual([2, 16, 16, [6, 9]]);
    expect([...f.pixels.subarray(0, 8)]).toEqual([1, 2, 3, 0, 1, 0, 0, 0]);
    expect(f.pixels[256 + 15 * 16 + 15]).toBe(2);
  });
  it('imports a font record and a valid PNG atlas', () => {
    const { record, png, skipped } = importFont(makeNfgr(), new Map([[1, 'A'], [2, 'B']]));
    expect(record).toMatchObject({ cellWidth: 16, cellHeight: 16, chars: 'AB', widths: [6, 9] });
    expect(skipped).toBe(0);
    const { width, height, rgba } = decodePng(png);
    expect([width, height]).toEqual([256, 16]);
    expect([...rgba.subarray(0, 4)]).toEqual([72, 72, 72, 255]);
    expect(rgba[3 * 4 + 3]).toBe(0);
  });
});

/** Test-only PNG reader for our own encoder's output (filter 0). */
function decodePng(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset);
  const width = v.getUint32(16);
  const height = v.getUint32(20);
  let o = 8;
  let idat: Uint8Array = new Uint8Array();
  while (o < png.length) {
    const len = v.getUint32(o);
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8));
    if (type === 'IDAT') idat = png.subarray(o + 8, o + 8 + len);
    o += 12 + len;
  }
  const raw = inflateSync(idat);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
}

describe('png', () => {
  it('round-trips through zlib', () => {
    const rgba = new Uint8Array(70000 * 4).map((_, i) => i & 0xff);
    const back = decodePng(encodePng(70000, 1, rgba));
    // Compare all 280,000 bytes natively; generic deep equality walks every typed-array property.
    expect(Buffer.from(back.rgba).equals(Buffer.from(rgba))).toBe(true);
  }, 30_000);
});

describe('drawScriptOverlay', () => {
  it('an ASCII apostrophe draws as the font\'s typographic one ("DON\'T" had a cell-wide gap)', () => {
    const font = loadFont({ chars: 'DNT\u2019', widths: [6, 6, 6, 2], cellWidth: 8, cellHeight: 16 }, { width: 64 } as unknown as CanvasImageSource);
    expect(font.glyph.get("'")).toEqual(font.glyph.get('\u2019'));
  });

  it('draws message glyphs and the yes/no box at integer scale, bottom-centred', () => {
    const calls: unknown[][] = [];
    const ctx = {
      canvas: { width: 512, height: 384 },
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      imageSmoothingEnabled: true,
      fillStyle: '',
      fillRect: (...a: unknown[]) => calls.push(['fillRect', ...a]),
      drawImage: (...a: unknown[]) => calls.push(['drawImage', ...a.slice(1)]),
    } as unknown as CanvasRenderingContext2D;
    const font: LoadedFont = loadFont({ chars: 'HiYESNO', widths: [6, 3, 6, 6, 6, 6, 6], cellWidth: 8, cellHeight: 16 }, { width: 64 } as unknown as CanvasImageSource);
    const view: ScriptView = { message: { text: 'Hi', waitingForInput: true }, yesNo: { yes: 'YES', no: 'NO', cursor: 1 }, menu: null, panel: { kind: 'idle', title: '' }, app: null };
    drawScriptOverlay(ctx, view, font, 2);
    const glyphs = calls.filter((c) => c[0] === 'drawImage');
    // 'H' at message box (16,152) → canvas (32,304), 'i' after 6 px → x 44.
    expect(glyphs[0]).toEqual(['drawImage', 0, 0, 8, 16, 32, 304, 16, 32]);
    expect(glyphs[1]).toEqual(['drawImage', 8, 0, 8, 16, 44, 304, 16, 32]);
    expect(glyphs).toHaveLength(2 + 3 + 2);
    expect(() => drawScriptOverlay(ctx, view, font, 1.5)).toThrow();
  });

  it('draws a scripted menu: entries 12 px in, the cursor on its row, and list scroll marks', () => {
    const calls: unknown[][] = [];
    const ctx = fakeCtx(calls);
    const font: LoadedFont = loadFont({ chars: 'YESNO', widths: [6, 6, 6, 6, 6], cellWidth: 8, cellHeight: 16 }, { width: 64 } as unknown as CanvasImageSource);
    const view: ScriptView = { message: null, yesNo: null, menu: { entries: ['YES', 'NO', 'NO'], cursor: 1, columns: 1, rows: 2, top: 1, x: 200, y: 8, width: 40 }, panel: { kind: 'idle', title: '' }, app: null };
    drawScriptOverlay(ctx, view, font, 2);
    const glyphs = calls.filter((c) => c[0] === 'drawImage');
    // Entries 1 and 2 are visible (top = 1): 'N' of entry 1 at (212, 8) → canvas (424, 16).
    expect(glyphs).toHaveLength(4);
    expect(glyphs[0]).toEqual(['drawImage', 24, 0, 8, 16, 424, 16, 16, 32]);
    // The up scroll mark is drawn above the window (a 7 px row at y 8 - 5 + 3 = 6 → canvas 12).
    expect(calls).toContainEqual(['fillRect', 2 * (200 + 40 - 8), 12, 14, 2]);
  });

  it('draws the current-floor window: framed, each line at its offset in the interior', () => {
    const calls: unknown[][] = [];
    const ctx = fakeCtx(calls);
    const font: LoadedFont = loadFont({ chars: 'C2F', widths: [6, 6, 6], cellWidth: 8, cellHeight: 16 }, { width: 64 } as unknown as CanvasImageSource);
    const floorWindow = { x: 160, y: 8, width: 88, height: 32, lines: [{ text: 'C', x: 0, y: 0 }, { text: '2F', x: 32, y: 16 }] };
    drawScriptOverlay(ctx, { message: null, yesNo: null, menu: null, floorWindow, panel: { kind: 'idle', title: '' }, app: null }, font, 2);
    const glyphs = calls.filter((c) => c[0] === 'drawImage');
    // 'C' at (160, 8) → canvas (320, 16); '2' at (192, 24) → canvas (384, 48).
    expect(glyphs).toEqual([
      ['drawImage', 0, 0, 8, 16, 320, 16, 16, 32],
      ['drawImage', 8, 0, 8, 16, 384, 48, 16, 32],
      ['drawImage', 16, 0, 8, 16, 396, 48, 16, 32],
    ]);
    // The frame's border, 6 px around the interior.
    expect(calls).toContainEqual(['fillRect', 2 * (160 - 6), 2 * (8 - 6), 2 * (88 + 12), 2 * (32 + 12)]);
  });

  it('draws the money window: framed, the label at the top left and the amount right-aligned on line 2', () => {
    const calls: unknown[][] = [];
    const ctx = fakeCtx(calls);
    const font: LoadedFont = loadFont({ chars: 'M$12 ', widths: [7, 5, 6, 6, 4], cellWidth: 8, cellHeight: 16 }, { width: 64 } as unknown as CanvasImageSource);
    const moneyWindow = { x: 8, y: 8, width: 80, height: 32, label: 'M', amount: '$  12' };
    drawScriptOverlay(ctx, { message: null, yesNo: null, menu: null, moneyWindow, panel: { kind: 'idle', title: '' }, app: null }, font, 2);
    const glyphs = calls.filter((c) => c[0] === 'drawImage');
    // 'M' at (8, 8) → canvas (16, 16). The amount is 5 + 4 + 4 + 6 + 6 = 25 px wide: it starts at 8 + 80 - 25 = 63, y 24.
    expect(glyphs[0]).toEqual(['drawImage', 0, 0, 8, 16, 16, 16, 16, 32]);
    expect(glyphs[1]).toEqual(['drawImage', 8, 0, 8, 16, 126, 48, 16, 32]);
    expect(glyphs.at(-1)).toEqual(['drawImage', 24, 0, 8, 16, 2 * (88 - 6), 48, 16, 32]);
    expect(calls).toContainEqual(['fillRect', 2 * (8 - 6), 2 * (8 - 6), 2 * (80 + 12), 2 * (32 + 12)]);
  });

  it('draws signposts distinctly: a map sign has its picture board and slides with its offset', () => {
    const calls: unknown[][] = [];
    const ctx = fakeCtx(calls);
    const fills: string[] = [];
    Object.defineProperty(ctx, 'fillStyle', { set: (v: string) => fills.push(v), get: () => '' });
    const font: LoadedFont = loadFont({ chars: 'Hi', widths: [6, 3], cellWidth: 8, cellHeight: 16 }, { width: 64 } as unknown as CanvasImageSource);
    const sign = (kind: 'map' | 'landmark', offset: number): ScriptView => ({ message: { text: 'Hi', waitingForInput: false, signpost: { kind, offset } }, yesNo: null, menu: null, panel: { kind: 'idle', title: '' }, app: null });
    drawScriptOverlay(ctx, sign('map', 16), font, 2);
    // Map sign text window at (72, 152), 16 px low → canvas (144, 336).
    expect(calls.filter((c) => c[0] === 'drawImage')[0]).toEqual(['drawImage', 0, 0, 8, 16, 144, 336, 16, 32]);
    expect(fills).toContain('#704828');
    expect(fills).toContain('#c05030'); // the map picture
    fills.length = 0;
    calls.length = 0;
    drawScriptOverlay(ctx, sign('landmark', 0), font, 2);
    expect(calls.filter((c) => c[0] === 'drawImage')[0]).toEqual(['drawImage', 0, 0, 8, 16, 32, 304, 16, 32]);
    expect(fills).toContain('#38485c');
    expect(fills).not.toContain('#704828');
  });

  it('panel choice hit-testing', () => {
    const rects = choiceRects(3);
    expect(rects).toHaveLength(3);
    expect(hitChoice(3, { x: rects[1]!.x + 2, y: rects[1]!.y + 2 })).toBe(1);
    expect(hitChoice(3, { x: 0, y: 0 })).toBe(-1);
  });
});

function fakeCtx(calls: unknown[][]): CanvasRenderingContext2D {
  return {
    canvas: { width: 512, height: 384 },
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    imageSmoothingEnabled: true,
    fillStyle: '',
    fillRect: (...a: unknown[]) => calls.push(['fillRect', ...a]),
    drawImage: (...a: unknown[]) => calls.push(['drawImage', ...a.slice(1)]),
  } as unknown as CanvasRenderingContext2D;
}
