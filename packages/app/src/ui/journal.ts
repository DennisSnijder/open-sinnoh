/**
 * The journal and the diplomas (contracts `JournalView`, `DiplomaView`; packages/menus journal.ts and diploma.ts own the
 * timing): one 256×192 DS screen on a canvas at a whole number of device pixels per DS pixel, laid out as the other DS
 * screen scenes (evolution.ts `layoutScene`).
 *
 * - Journal: each page is drawn whole (its paper, `NewGame.journal.art` cell = the page number, and its lines in the game
 *   font, colours 1/2 of the system font: the title at (16, 16), the weekday 12 px after it, the rows from (32, 32)),
 *   then a turning page goes on top through the wipe's tile columns (`JournalTables.pageTurn`). Tap zones: the left and
 *   right edges turn to the newer and older page, the top-right corner closes.
 * - Diploma: the document sheet and its three lines.
 */
import { journalTables, type DiplomaView, type JournalPageView, type JournalView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { layoutScene, place } from './evolution.ts';
import './evolution.css';
import { S } from '../strings/index.ts';

const W = 256;
const H = 192;
const BLACK = 16;
/** journal_printer.c Unk_ov81_021D3508: the title window at tile (2, 2), the events window at (4, 4). */
const TITLE = { x: 16, y: 16 };
const EVENTS = { x: 32, y: 32 };
const WEEKDAY_GAP = 12;
/** Tap zones (DS px): the edges turn pages, the corner closes. */
const ZONES = [
  { id: 'prev', x: 0, y: 24, w: 32, h: H - 24, label: () => S.aria.newerPage },
  { id: 'next', x: W - 32, y: 24, w: 32, h: H - 24, label: () => S.aria.olderPage },
  { id: 'back', x: W - 40, y: 0, w: 40, h: 24, label: () => S.aria.close },
] as const;

const sheetPath = (id: Id) => id.slice(id.indexOf(':') + 'ui2d/'.length + 1);

export class DsScene {
  readonly root: HTMLElement;
  readonly stage = el('div', 'ds-scene-stage');
  readonly canvas = document.createElement('canvas');
  readonly boxes = el('div', 'ds-scene-boxes');
  readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, HTMLImageElement | null>();
  boxesKey = '';
  redraw: (() => void) | null = null;

  constructor(
    private readonly art: Art,
    className: string,
    label: string,
  ) {
    this.root = el('section', `ds-scene ${className}`);
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', label);
  }

  /** A sheet's atlas image, or null while it loads (the scene redraws once it has). */
  image(sheet: Id): { img: HTMLImageElement; cells: { x: number; y: number; w: number; h: number }[] } | null {
    const s = this.art.sheet(sheetPath(sheet));
    if (!s) return null;
    if (!this.images.has(s.atlas)) {
      this.images.set(s.atlas, null);
      void this.art.image(s.atlas).then((img) => {
        this.images.set(s.atlas, img);
        if (this.root.isConnected) this.redraw?.();
      });
    }
    const img = this.images.get(s.atlas);
    return img ? { img, cells: s.cells } : null;
  }

  fade(black: number): void {
    if (!black) return;
    this.g.fillStyle = `rgb(0 0 0 / ${black / BLACK})`;
    this.g.fillRect(0, 0, W, H);
  }
}

const journals = new WeakMap<Art, { scene: DsScene; pages: Map<string, HTMLCanvasElement> }>();

/** One page, paper and text, on its own canvas (kept while its lines stay the same). */
function pageCanvas(d: DrawContext, scene: DsScene, pages: Map<string, HTMLCanvasElement>, v: JournalView, p: JournalPageView): HTMLCanvasElement | null {
  const art = journalTables(d.registries)?.art?.[v.gender];
  const key = JSON.stringify([v.gender, p]);
  const kept = pages.get(key);
  if (kept) return kept;
  const paper = art ? scene.image(art) : null;
  if (art && !paper) return null;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const cell = paper?.cells[p.index];
  if (paper && cell) g.drawImage(paper.img, cell.x, cell.y, W, H, 0, 0, W, H);
  else {
    g.fillStyle = '#e8f0f8';
    g.fillRect(0, 0, W, H);
  }
  if (d.paint) {
    d.paint(g, p.title, 'ink', TITLE.x, TITLE.y);
    d.paint(g, p.weekday, 'ink', TITLE.x + d.measure(p.title) + WEEKDAY_GAP, TITLE.y);
    for (const r of p.rows) d.paint(g, r.text, 'ink', EVENTS.x, EVENTS.y + r.y);
  }
  pages.set(key, c);
  if (pages.size > 8) pages.delete(pages.keys().next().value!);
  return c;
}

export function journal(d: DrawContext, v: JournalView): HTMLElement {
  let s = journals.get(d.art);
  if (!s || !s.scene.root.isConnected) journals.set(d.art, (s = { scene: new DsScene(d.art, 'journal-scene', 'Journal'), pages: new Map() }));
  const { scene, pages } = s;
  scene.redraw = () => journal(d, v);
  layoutScene(d, scene.root, scene.stage);
  const g = scene.g;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  const under = pageCanvas(d, scene, pages, v, v.page);
  if (under) g.drawImage(under, 0, 0);
  if (v.turn) {
    const top = pageCanvas(d, scene, pages, v, v.turn.page);
    const columns = journalTables(d.registries)?.pageTurn[v.turn.step];
    if (top && columns) {
      columns.forEach((src, i) => {
        if (src !== 0xff) g.drawImage(top, src * 8, 0, 8, H, i * 8, 0, 8, H);
      });
    }
  }
  scene.fade(v.black);
  // The page's text for assistive technology, and the tap zones.
  const key = JSON.stringify([v.page, v.newer, v.older]);
  if (key !== scene.boxesKey) {
    scene.boxesKey = key;
    const text = el('div', 'sr-only');
    text.textContent = [`${v.page.title} ${v.page.weekday}`, ...v.page.rows.map((r) => r.text)].join('. ');
    const zones = ZONES.filter((z) => z.id === 'back' || (z.id === 'prev' ? v.newer : v.older)).map((z) => {
      const b = el('button', `journal-zone journal-${z.id}`);
      b.type = 'button';
      b.tabIndex = -1;
      b.dataset.tap = z.id;
      b.setAttribute('aria-label', z.label());
      b.addEventListener('click', () => d.tap(z.id));
      place(b, z);
      return b;
    });
    scene.boxes.replaceChildren(text, ...zones);
  }
  return scene.root;
}

const diplomas = new WeakMap<Art, DsScene>();

export function diploma(d: DrawContext, v: DiplomaView): HTMLElement {
  let scene = diplomas.get(d.art);
  if (!scene || !scene.root.isConnected) diplomas.set(d.art, (scene = new DsScene(d.art, 'diploma-scene', 'Diploma')));
  const s = scene;
  s.redraw = () => diploma(d, v);
  layoutScene(d, s.root, s.stage);
  const g = s.g;
  g.imageSmoothingEnabled = false;
  const doc = s.image(v.sheet);
  const cell = doc?.cells[0];
  if (doc && cell) g.drawImage(doc.img, cell.x, cell.y, W, H, 0, 0, W, H);
  else {
    g.fillStyle = '#d8d8f8';
    g.fillRect(0, 0, W, H);
  }
  if (d.paint) for (const l of v.lines) l.text.split('\n').forEach((line, i) => d.paint!(g, line, 'ink', Math.round(l.x), l.y + i * 16));
  s.fade(v.black);
  const key = JSON.stringify(v.lines);
  if (key !== s.boxesKey) {
    s.boxesKey = key;
    const text = el('div', 'sr-only');
    text.textContent = v.lines.map((l) => l.text.replace(/\n/g, ' ')).join('. ');
    const next = el('button', 'diploma-next');
    next.type = 'button';
    next.tabIndex = -1;
    next.dataset.tap = 'next';
    next.setAttribute('aria-label', S.aria.close);
    next.addEventListener('click', () => d.tap('next'));
    place(next, { x: 0, y: 0, w: W, h: H });
    s.boxes.replaceChildren(text, next);
  }
  return s.root;
}
