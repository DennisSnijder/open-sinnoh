/**
 * The evolution scene's art (decomp evolution.c Evolution_InitGraphics, unk_0207C63C.c):
 * - the background, BG3 of the main screen: demo/egg/data/egg_data.narc tiles (member 0) and tilemap
 *   (member 1), with the two palettes of member 8 from palette 0 (the members the decomp names with
 *   diploma.naix constants); transparent pixels show colour 0, the backdrop → `evolution/background`;
 * - the sparkles: demo/shinka/data/particle/shinka_demo_particle.narc member 0, a SPA file (NARC 124 in
 *   sub_0207C894). Its textures are the cells of `evolution/particles` and its emitter headers its
 *   `emitters` (contracts `Ui2dEmitter`), which the scene runs with a small SPL port.
 */
import type { Ui2dEmitter } from '@opensinnoh/contracts';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import type { CellImage } from './compose.ts';
import { PaletteRam, readNcgr, readNclr, readNscr, renderScreen, rgb555 } from './nitro2d.ts';
import type { Sheets } from './sheets.ts';
import { readSpa, spaTexture, type Spa, type SpaEmitter } from './spa.ts';

const EGG_DATA = { path: '/demo/egg/data/egg_data.narc', count: 11, tiles: 0, screen: 1, palette: 8 };
const PARTICLES = { path: '/demo/shinka/data/particle/shinka_demo_particle.narc', count: 2, member: 0, emitters: 13 };
/** SPLResourceFlags bits (lib/spl spl_resource.h). */
const FLAG = { scaleAnim: 8, colorAnim: 9, alphaAnim: 10, child: 16, hideParent: 22 } as const;

const hex = (c: number) => `#${rgb555(c).map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * A particle texture as the quad shows it: an emitter (or child) tiles its texture `1 << tileS` × `1 << tileT`
 * times across the quad (SPLEmitter textureS/T), and the texture's own repeat and flip bits (SPLTextureParam
 * bits 12–15: repeat S, repeat T, flip S, flip T) mirror or clamp the copies. The glow (texture 0) is a quarter
 * that mirrors into a round glow; the ray (texture 2) a half. Each distinct tiling is its own cell.
 */
class TiledTextures {
  readonly cells: CellImage[] = [];
  private readonly keys = new Map<string, number>();
  constructor(private readonly spa: Spa) {}

  cell(texture: number, tileS: number, tileT: number): number {
    const key = `${texture}/${tileS}/${tileT}`;
    const known = this.keys.get(key);
    if (known !== undefined) return known;
    const src = spaTexture(this.spa, texture);
    const bits = (this.spa.reader.u32(this.spa.textures[texture]! + 4) >>> 12) & 15;
    const [repeatS, repeatT, flipS, flipT] = [bits & 1, bits & 2, bits & 4, bits & 8].map(Boolean);
    const w = src.width << tileS;
    const h = src.height << tileT;
    const rgba = new Uint8Array(w * h * 4);
    const fold = (v: number, size: number, repeat: boolean, flip: boolean) => {
      if (!repeat) return Math.min(v, size - 1);
      const copy = Math.floor(v / size);
      const at = v % size;
      return flip && copy % 2 ? size - 1 - at : at;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const sx = fold(x, src.width, repeatS!, flipS!);
        const sy = fold(y, src.height, repeatT!, flipT!);
        rgba.set(src.rgba.subarray((sy * src.width + sx) * 4, (sy * src.width + sx) * 4 + 4), (y * w + x) * 4);
      }
    this.cells.push({ width: w, height: h, rgba, originX: 0, originY: 0 });
    this.keys.set(key, this.cells.length - 1);
    return this.cells.length - 1;
  }
}

function emitter(spa: Spa, e: SpaEmitter, tiled: TiledTextures): Ui2dEmitter {
  const r = spa.reader;
  const o = e.offset;
  const fx = (at: number) => r.i32(at) / 4096;
  const fx16 = (at: number) => r.i16(at) / 4096;
  const bit = (b: number) => ((e.flags >>> b) & 1) === 1;
  const block = (b: number) => {
    const at = e.blocks.get(b);
    if (at === undefined) throw new Error(`evolution particles: emitter flag ${b} without its block`);
    return at;
  };
  const misc2 = r.u32(o + 72);
  const out: Ui2dEmitter = {
    emission: e.emission,
    drawType: (e.flags >>> 4) & 3,
    aspect: fx16(o + 48),
    // misc.dbbScale (bits 8–23 of the second misc word), used as an fx32 (SPLDraw_DirectionalBillboard).
    dbbScale: ((misc2 >>> 8) & 0xffff) / 4096,
    scaleAnimDir: (misc2 >>> 28) & 7,
    circleAxis: (e.flags >>> 6) & 3,
    axis: [fx16(o + 28), fx16(o + 30), fx16(o + 32)],
    position: [fx(o + 4), fx(o + 8), fx(o + 12)],
    count: e.count,
    radius: e.radius,
    velPos: e.velPos,
    velAxis: e.velAxis,
    scale: e.scale,
    color: hex(e.color),
    alpha: r.u8(o + 69) & 31,
    startDelay: r.u16(o + 50),
    life: r.u16(o + 60),
    particleLife: e.particleLife,
    interval: r.u8(o + 68),
    // SPLEmitter_Update: airResistance + FX32_CONST(0.09375), applied as v · air >> 9.
    air: e.air + 384,
    texture: tiled.cell(e.texture, (r.u32(o + 72) >>> 24) & 3, (r.u32(o + 72) >>> 26) & 3),
    hideParent: bit(FLAG.hideParent),
  };
  if (bit(FLAG.scaleAnim)) {
    const b = block(FLAG.scaleAnim);
    out.scaleAnim = { start: fx16(b), mid: fx16(b + 2), end: fx16(b + 4), in: r.u8(b + 6), out: r.u8(b + 7) };
  }
  if (bit(FLAG.colorAnim)) {
    const b = block(FLAG.colorAnim);
    out.colorAnim = { start: hex(r.u16(b)), end: hex(r.u16(b + 2)), in: r.u8(b + 4), peak: r.u8(b + 5), out: r.u8(b + 6), interpolate: ((r.u16(b + 8) >>> 2) & 1) === 1 };
  }
  if (bit(FLAG.alphaAnim)) {
    const b = block(FLAG.alphaAnim);
    const a = r.u16(b);
    out.alphaAnim = { start: a & 31, mid: (a >>> 5) & 31, end: (a >>> 10) & 31, in: r.u8(b + 4), out: r.u8(b + 5) };
  }
  if (bit(FLAG.child)) {
    const b = block(FLAG.child);
    const flags = r.u16(b);
    const misc = r.u32(b + 12);
    out.child = {
      life: r.u16(b + 6),
      texture: tiled.cell((misc >>> 24) & 255, r.u32(b + 16) & 3, (r.u32(b + 16) >>> 2) & 3),
      color: (flags >>> 6) & 1 ? hex(r.u16(b + 10)) : null,
      scaleRatio: r.u8(b + 9),
      velocityRatio: r.u8(b + 8),
      endScale: (flags >>> 1) & 1 ? fx16(b + 4) : null,
      fade: ((flags >>> 2) & 1) === 1,
      count: misc & 255,
      delay: (misc >>> 8) & 255,
      every: (misc >>> 16) & 255,
    };
  }
  return out;
}

export function importEvolutionArt(fs: NitroFs, sheets: Sheets): void {
  const egg = readNarc(fs.file(EGG_DATA.path));
  if (egg.length !== EGG_DATA.count) throw new Error(`${EGG_DATA.path}: ${egg.length} members, expected ${EGG_DATA.count}`);
  const screen = readNscr(egg[EGG_DATA.screen]!);
  const palette = readNclr(egg[EGG_DATA.palette]!);
  const ram = new PaletteRam().load(palette, 0, Math.min(512, palette.colors.length * 2));
  const rgba = renderScreen(screen, readNcgr(egg[EGG_DATA.tiles]!), ram);
  const [r, g, b] = rgb555(ram.colors[0]!);
  for (let p = 3; p < rgba.length; p += 4) if (!rgba[p]) rgba.set([r, g, b, 255], p - 3);
  sheets.image('evolution/background', { width: screen.width, height: screen.height, rgba });

  const particles = readNarc(fs.file(PARTICLES.path));
  if (particles.length !== PARTICLES.count) throw new Error(`${PARTICLES.path}: ${particles.length} members, expected ${PARTICLES.count}`);
  const spa = readSpa(particles[PARTICLES.member]!);
  if (spa.emitters.length !== PARTICLES.emitters) throw new Error(`${PARTICLES.path}: ${spa.emitters.length} emitters, expected ${PARTICLES.emitters}`);
  const tiled = new TiledTextures(spa);
  const emitters = spa.emitters.map((e) => emitter(spa, e, tiled));
  sheets.add('evolution/particles', tiled.cells, { emitters });
}
