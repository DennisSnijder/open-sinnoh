/**
 * The Town Map in fly mode (contracts `TownMapView`; packages/menus town-map.ts owns the cursor and the timing): one
 * 256×192 DS screen on a canvas at a whole number of device pixels per DS pixel, laid out as the other DS screen
 * scenes (evolution.ts `layoutScene`). Back to front: the top screen (`town_map/screen`), the found hidden places'
 * patches, the fly location blocks, the player icon, the cursor (its NANR at twice the speed, as
 * Sprite_SetAnimSpeed(…, 2)), the circle wipe; then the name window's text in the game font at its DS places
 * ("Fly to where?" at (24, 174), the hovered name at (146, 174)). Each unlocked block is a tap target (`town:<i>`),
 * 16 DS px square around it.
 */
import { newGameRecord, type TownMapView, type Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { DrawContext } from './apps.ts';
import type { Art } from './art.ts';
import { el } from './core.ts';
import { layoutScene, place, sceneContext } from './evolution.ts';
import './evolution.css';
import { S } from '../strings/index.ts';

const W = 256;
const H = 192;
/** The name window's text (graphics.c PrintLocationName: window at tile (3, 21), y 6; the name at x 15 tiles + 2). */
const PROMPT = { x: 24, y: 174, w: 120, h: 16 };
const NAME = { x: 146, y: 174, w: 110, h: 16 };
/** A block's tap area: 16 DS px square around its position. */
const HIT = 16;

type Img = HTMLImageElement;

class TownMapScene {
  readonly root = el('section', 'ds-scene town-map-scene');
  private readonly stage = el('div', 'ds-scene-stage');
  private readonly canvas = document.createElement('canvas');
  private readonly boxes = el('div', 'ds-scene-boxes');
  private readonly g: CanvasRenderingContext2D;
  private readonly images = new Map<string, Img | null>();
  private boxesKey = '';
  private last: { d: DrawContext; v: TownMapView } | null = null;

  constructor(private readonly art: Art) {
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.className = 'ds-scene-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.stage.append(this.canvas, this.boxes);
    this.root.append(this.stage);
    this.root.setAttribute('aria-label', S.aria.townMap);
  }

  private image(ref: Id): Img | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    void this.art.image(ref).then((img) => {
      this.images.set(ref, img);
      if (this.last && this.root.isConnected) this.draw(this.last.d, this.last.v);
    });
    return null;
  }

  /** Draws cell `cell` of a sheet with its origin at (x, y) (nothing while its atlas loads). */
  private cell(sheet: Ui2dSheet | undefined, cell: number, x: number, y: number): void {
    const c = sheet?.cells[cell];
    const img = sheet && c ? this.image(sheet.atlas) : null;
    if (!img || !c) return;
    this.g.drawImage(img, c.x, c.y, c.w, c.h, Math.trunc(x) - c.ox, Math.trunc(y) - c.oy, c.w, c.h);
  }

  draw(ctx: DrawContext, v: TownMapView): void {
    this.last = { d: ctx, v };
    const d = sceneContext(ctx, layoutScene(ctx, this.root, this.stage));
    const g = this.g;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const map = newGameRecord(d.registries).townMap;
    const path = (id: Id) => id.slice(id.indexOf(':') + 'ui2d/'.length + 1);
    if (!map) throw new Error('ui: the Town Map without NewGame.townMap');
    this.cell(this.art.sheet(path(map.screen)), 0, 0, 0);
    for (const i of v.hidden) {
      const h = map.hidden[i]!;
      this.cell(this.art.sheet(path(h.patch)), 0, h.x, h.y);
    }
    for (const b of v.blocks) this.cell(this.art.sheet(path(map.blocks[b.palette - 5]!)), b.shape, b.x, b.y);
    const player = this.art.sheet(path(map.player[v.player.gender]));
    this.cell(player, v.player.gender === 'male' ? 0 : 1, v.player.x, v.player.y);
    const cursor = this.art.sheet(path(map.cursor));
    this.cell(cursor, cursorCell(cursor, v.tick), v.cursor.x, v.cursor.y);
    if (v.fade) wipe(g, v.fade);
    this.drawBoxes(d, v);
  }

  private drawBoxes(d: DrawContext, v: TownMapView): void {
    const key = JSON.stringify([v.prompt, v.name, v.blocks.filter((b) => b.unlocked).map((b) => [b.location, b.x, b.y]), d.scale]);
    if (key === this.boxesKey) return;
    this.boxesKey = key;
    const parts: HTMLElement[] = [];
    const label = (text: string, r: typeof PROMPT, className: string) => {
      const e = el('div', `town-map-text ${className}`, d.text(text, 'ink'));
      place(e, r);
      parts.push(e);
    };
    label(v.prompt, PROMPT, 'town-map-prompt');
    if (v.name) label(v.name, NAME, 'town-map-name');
    for (const b of v.blocks) {
      if (!b.unlocked) continue;
      const button = el('button', 'town-map-town');
      button.type = 'button';
      // Keys move the map's own cursor (A flies): the blocks are for pointers and touch, not browser focus.
      button.tabIndex = -1;
      button.dataset.tap = `town:${b.location}`;
      button.setAttribute('aria-label', S.aria.flyTo(d.registries.zones.get(newGameRecord(d.registries).townMap!.locations[b.location]!.zone)?.name ?? null));
      button.addEventListener('click', () => d.tap(`town:${b.location}`));
      place(button, { x: b.x - HIT / 2, y: b.y - HIT / 2, w: HIT, h: HIT });
      parts.push(button);
    }
    this.boxes.replaceChildren(...parts);
  }
}

/** The cursor's animation 0 at twice its speed, from the view's tick (frames are 30 Hz ticks). */
function cursorCell(sheet: Ui2dSheet | undefined, tick: number): number {
  const frames = sheet?.animations?.[0]?.frames;
  if (!frames?.length) return 0;
  const total = frames.reduce((n, f) => n + f.ticks, 0);
  let t = (tick * 2) % total;
  for (const f of frames) {
    if (t < f.ticks) return f.cell;
    t -= f.ticks;
  }
  return frames[0]!.cell;
}

/** The circle wipe (FADE_TYPE_CIRCLE_IN / _OUT): black outside a circle about the centre that shrinks with `fade`. */
function wipe(g: CanvasRenderingContext2D, fade: number): void {
  const r = Math.hypot(W / 2, H / 2) * (1 - fade / 16);
  g.save();
  g.fillStyle = '#000';
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(W / 2, H / 2, r, 0, Math.PI * 2, true);
  g.fill('evenodd');
  g.restore();
}

const scenes = new WeakMap<Art, TownMapScene>();

/** The scene's root, redrawn in place. */
export function townMap(d: DrawContext, v: TownMapView): HTMLElement {
  let scene = scenes.get(d.art);
  if (!scene || !scene.root.isConnected) scenes.set(d.art, (scene = new TownMapScene(d.art)));
  scene.draw(d, v);
  return scene.root;
}
