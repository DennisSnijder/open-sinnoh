/**
 * Original fixture art for the starter-choice scene (designed here; the ROM's scene is a briefcase with
 * three Poké Balls): a wooden crate whose lid lies open in front, three small lanterns on the lid, a
 * grass patch, an amber pointer, a cream disc for the pop-up, the message colours, and front/back
 * pictures plus icons for the three starters (Mosslet, Emberkit, Dripling). Shapes follow the records
 * the importer writes for Platinum (models `MODEL_CHOOSE_STARTER_*`, sheets `ui2d/choose_starter/*`,
 * `pokemonSprites` atlases of 160×160 with two 80×80 frames per face).
 */
import { box, writeGltf } from './gltf.ts';
import { encodePng } from './png.ts';

type Rgb = [number, number, number];

class Pixels {
  readonly rgba: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rgba = new Uint8Array(width * height * 4);
  }
  set(x: number, y: number, c: Rgb): void {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.rgba.set([...c, 255], (y * this.width + x) * 4);
  }
  opaque(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height && this.rgba[(y * this.width + x) * 4 + 3] !== 0;
  }
  /** Fills the pixels whose centre lies inside the ellipse. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Rgb | ((x: number, y: number) => Rgb)): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) this.set(x, y, typeof c === 'function' ? c(x, y) : c);
  }
  rect(x0: number, y0: number, w: number, h: number, c: Rgb): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c);
  }
  /** A filled triangle (barycentric test on pixel centres). */
  triangle(a: [number, number], b: [number, number], c: [number, number], col: Rgb): void {
    const [minX, maxX] = [Math.floor(Math.min(a[0], b[0], c[0])), Math.ceil(Math.max(a[0], b[0], c[0]))];
    const [minY, maxY] = [Math.floor(Math.min(a[1], b[1], c[1])), Math.ceil(Math.max(a[1], b[1], c[1]))];
    const edge = (p: [number, number], q: [number, number], x: number, y: number) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const [px, py] = [x + 0.5, y + 0.5];
        const e = [edge(a, b, px, py), edge(b, c, px, py), edge(c, a, px, py)];
        if (e.every((v) => v >= 0) || e.every((v) => v <= 0)) this.set(x, y, col);
      }
  }
  /** Draws a 1-px outline in `c` around the opaque pixels of the region. */
  outline(c: Rgb, x0 = 0, y0 = 0, w = this.width, h = this.height): void {
    const edge: [number, number][] = [];
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++)
        if (!this.opaque(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => x + dx! >= x0 && x + dx! < x0 + w && y + dy! >= y0 && y + dy! < y0 + h && this.opaque(x + dx!, y + dy!))) edge.push([x, y]);
    for (const [x, y] of edge) this.set(x, y, c);
  }
  png(): Buffer {
    return encodePng(this.width, this.height, this.rgba);
  }
}

// ---------- models ----------

const WOOD: [number, number, number, number] = [0.55, 0.36, 0.2, 1];
const WOOD_DARK: [number, number, number, number] = [0.38, 0.24, 0.13, 1];
const LINING: [number, number, number, number] = [0.72, 0.2, 0.22, 1];
const BRASS: [number, number, number, number] = [0.93, 0.74, 0.32, 1];

function merge(...gs: { positions: number[]; uvs: number[] }[]) {
  return { positions: gs.flatMap((g) => g.positions), uvs: gs.flatMap((g) => g.uvs) };
}

/** The closed crate: body, lid, bands and a brass clasp at the front. */
function crateClosed(): string {
  return writeGltf(
    'choose-starter-briefcase',
    [
      { name: 'wood', color: WOOD },
      { name: 'band', color: WOOD_DARK },
      { name: 'brass', color: BRASS },
    ],
    [
      { material: 0, ...box([-60, -12, -24], [60, 30, 24]) },
      { material: 1, ...merge(box([-62, 26, -26], [62, 34, 26]), box([-62, -12, -26], [-50, 30, 26]), box([50, -12, -26], [62, 30, 26])) },
      { material: 2, ...box([-8, 14, 24], [8, 28, 27]) },
    ],
  );
}

/** The open crate: the body at the back, the lid lying flat in front (lined in red), where the lanterns stand. */
function crateOpen(): string {
  return writeGltf(
    'choose-starter-briefcase-open',
    [
      { name: 'wood', color: WOOD },
      { name: 'band', color: WOOD_DARK },
      { name: 'lining', color: LINING },
      { name: 'brass', color: BRASS },
    ],
    [
      { material: 0, ...merge(box([-60, -12, -24], [60, 26, 24]), box([-62, -16, 24], [62, -12, 112])) },
      { material: 1, ...merge(box([-62, -12, -26], [-50, 28, 26]), box([50, -12, -26], [62, 28, 26]), box([-60, 20, -24], [60, 26, 24], 1, ['py'])) },
      { material: 2, ...box([-54, -12, 30], [54, -11.5, 106], 1, ['py']) },
      { material: 3, ...box([-8, -12, 106], [8, -11, 112]) },
    ],
  );
}

/** A small lantern standing on its base (origin at its centre, like the ROM's balls). */
function lantern(): string {
  return writeGltf(
    'choose-starter-lantern',
    [
      { name: 'metal', color: [0.23, 0.26, 0.34, 1] },
      { name: 'glass', color: [1, 0.8, 0.4, 1] },
    ],
    [
      { material: 0, ...merge(box([-8, -11, -8], [8, -8, 8]), box([-9, 6, -9], [9, 9, 9]), box([-3, 9, -3], [3, 12, 3])) },
      { material: 1, ...box([-6, -8, -6], [6, 6, 6]) },
    ],
  );
}

/** The grass patch: a 64×64 texture of a lighter clearing on dark grass, mapped once over the floor quad. */
function floor(): { gltf: string; texture: Buffer } {
  const t = new Pixels(64, 64);
  t.rect(0, 0, 64, 64, [40, 92, 52]);
  t.ellipse(32, 32, 30, 30, (x, y) => (((x * 7 + y * 13) ^ (x * y)) % 11 === 0 ? [104, 168, 88] : [128, 192, 104]));
  const quad = { positions: [-160, 0, -304, -160, 0, 208, 160, 0, 208, -160, 0, -304, 160, 0, 208, 160, 0, -304], uvs: [0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0] };
  return { gltf: writeGltf('choose-starter-floor', [{ name: 'grass', texture: '../textures/choose-starter-grass.png' }], [{ material: 0, ...quad }]), texture: t.png() };
}

export function fixtureChooseStarterModels(): { models: Record<string, string>; textures: Record<string, Buffer> } {
  const f = floor();
  const l = lantern();
  return {
    models: {
      'choose-starter-briefcase.gltf': crateClosed(),
      'choose-starter-briefcase-open.gltf': crateOpen(),
      'choose-starter-ball-0.gltf': l,
      'choose-starter-ball-1.gltf': l,
      'choose-starter-ball-2.gltf': l,
      'choose-starter-floor.gltf': f.gltf,
    },
    textures: { 'choose-starter-grass.png': f.texture },
  };
}

// ---------- 2D ----------

const INK: Rgb = [44, 40, 52];

/** A downward amber pointer (32×32, origin at its centre). */
function pointer(): Buffer {
  const p = new Pixels(32, 32);
  p.rect(12, 4, 8, 12, [255, 200, 96]);
  p.triangle([5, 15], [27, 15], [16, 28], [242, 160, 48]);
  p.rect(14, 6, 2, 8, [255, 236, 180]);
  p.outline(INK);
  return p.png();
}

/** The pop-up disc: a cream circle with a soft amber rim (128×128). */
function disc(): Buffer {
  const p = new Pixels(128, 128);
  p.ellipse(64, 64, 46, 44, [255, 214, 140]);
  p.ellipse(64, 64, 43, 41, [255, 248, 230]);
  return p.png();
}

/** Message colours by index: 1/2 ink and shadow, 3/4 red, 5/6 blue, 7/8 green, 15 paper. */
function textColors(): Buffer {
  const p = new Pixels(16, 1);
  const colours: Record<number, Rgb> = { 0: [0, 0, 0], 1: [56, 52, 64], 2: [176, 172, 184], 3: [208, 64, 48], 4: [248, 184, 168], 5: [48, 96, 216], 6: [168, 200, 248], 7: [56, 144, 72], 8: [176, 224, 168], 15: [252, 250, 244] };
  for (let i = 0; i < 16; i++) p.set(i, 0, colours[i] ?? [0, 0, 0]);
  return p.png();
}

export function fixtureChooseStarterImages(): Record<string, Buffer> {
  return { 'ui2d/choose_starter/cursor.png': pointer(), 'ui2d/choose_starter/preview_window.png': disc(), 'ui2d/choose_starter/text_colors.png': textColors() };
}

// ---------- Pokémon pictures ----------

type Draw = (p: Pixels, ox: number, oy: number, squash: number, back: boolean) => void;

const eyes = (p: Pixels, cx: number, cy: number, gap: number) => {
  for (const s of [-1, 1]) {
    p.rect(cx + s * gap - 2, cy - 3, 4, 6, INK);
    p.set(cx + s * gap - 1, cy - 2, [255, 255, 255]);
  }
};

/** A round moss blob with a two-leaf sprout. */
const mosslet: Draw = (p, ox, oy, s, back) => {
  const cx = ox + 40;
  const by = oy + 70;
  p.ellipse(cx, by - 18 + s, 24, 18 - s, (x, y) => ((x + y) % 7 === 0 ? [72, 150, 72] : [96, 184, 88]));
  p.ellipse(cx, by - 12 + s, 16, 8 - s / 2, [152, 208, 120]);
  p.rect(cx - 1, by - 46 + s * 2, 3, 12, [80, 120, 48]);
  p.ellipse(cx - 8, by - 46 + s * 2, 8, 4, [72, 168, 64]);
  p.ellipse(cx + 8, by - 48 + s * 2, 8, 4, [96, 192, 72]);
  if (!back) eyes(p, cx, by - 22 + s, 8);
  p.outline(INK, ox, oy, 80, 80);
};

/** An orange kit with pointed ears and a flame tail. */
const emberkit: Draw = (p, ox, oy, s, back) => {
  const cx = ox + 38;
  const by = oy + 72;
  p.ellipse(cx + 18, by - 30, 7, 12 - s, [255, 196, 64]);
  p.ellipse(cx + 18, by - 26, 4, 7 - s, [255, 240, 160]);
  p.ellipse(cx, by - 14 + s, 16, 13 - s, [232, 112, 48]);
  p.ellipse(cx, by - 36 + s, 15, 13, [240, 128, 56]);
  p.triangle([cx - 14, by - 40 + s], [cx - 4, by - 46 + s], [cx - 14, by - 58 + s], [216, 88, 40]);
  p.triangle([cx + 14, by - 40 + s], [cx + 4, by - 46 + s], [cx + 14, by - 58 + s], [216, 88, 40]);
  p.ellipse(cx, by - 30 + s, 8, 5, [255, 220, 176]);
  if (!back) eyes(p, cx, by - 38 + s, 6);
  p.outline(INK, ox, oy, 80, 80);
};

/** A blue droplet with a curl on top. */
const dripling: Draw = (p, ox, oy, s, back) => {
  const cx = ox + 40;
  const by = oy + 72;
  p.ellipse(cx, by - 20 + s, 20, 20 - s, [72, 136, 232]);
  p.triangle([cx - 16, by - 30 + s], [cx + 16, by - 30 + s], [cx, by - 60 + s], [72, 136, 232]);
  p.ellipse(cx - 7, by - 28 + s, 5, 8, [168, 208, 255]);
  p.ellipse(cx + 2, by - 60 + s, 4, 3, [120, 176, 248]);
  if (!back) eyes(p, cx + 2, by - 22 + s, 7);
  p.outline(INK, ox, oy, 80, 80);
};

function atlas(draw: Draw, hue: (c: Rgb) => Rgb = (c) => c): Buffer {
  const p = new Pixels(160, 160);
  for (const [row, back] of [[0, false], [80, true]] as const) {
    draw(p, 0, row, 0, back);
    draw(p, 80, row, 2, back);
  }
  for (let i = 0; i < p.rgba.length; i += 4) {
    if (!p.rgba[i + 3]) continue;
    const [r, g, b] = hue([p.rgba[i]!, p.rgba[i + 1]!, p.rgba[i + 2]!]);
    p.rgba.set([r, g, b], i);
  }
  return p.png();
}

function icon(draw: Draw): Buffer {
  const big = new Pixels(80, 80);
  draw(big, 0, 0, 0, false);
  const p = new Pixels(32, 64);
  for (const [frame, dy] of [[0, 0], [1, -1]] as const)
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const sx = Math.floor((x * 80) / 32);
        const sy = Math.floor((y * 80) / 32);
        if (big.opaque(sx, sy)) p.rgba.set(big.rgba.subarray((sy * 80 + sx) * 4, (sy * 80 + sx) * 4 + 4), ((frame * 32 + y + dy + 1) * 32 + x) * 4);
      }
  return p.png();
}

const STARTERS: [string, Draw][] = [
  ['mosslet', mosslet],
  ['emberkit', emberkit],
  ['dripling', dripling],
];

/** Pack path → PNG for each starter's atlas, shiny atlas and icon. */
export function fixtureStarterPictures(): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const [name, draw] of STARTERS) {
    out[`pokemon/${name}.png`] = atlas(draw);
    out[`pokemon/${name}-shiny.png`] = atlas(draw, ([r, g, b]) => [b, r, g]);
    out[`pokemon/${name}-icon.png`] = icon(draw);
  }
  return out;
}

/** `pokemonSprites` records for the pictures (species `fixture:SPECIES_<NAME>`). */
export function fixtureStarterSprites(species: { id: string; sourceIndex: number }[]) {
  return STARTERS.map(([name]) => {
    const sp = species.find((s) => s.id === `fixture:SPECIES_${name.toUpperCase()}`);
    if (!sp) throw new Error(`fixture sprites: no species ${name}`);
    const anim = { frames: [{ frame: 0, ticks: 8, dx: 0, dy: 0 }, { frame: 1, ticks: 8, dx: 0, dy: 0 }, { frame: 0, ticks: 8, dx: 0, dy: 0 }], animation: 0, startDelay: 0, cryDelay: 0 };
    return {
      id: sp.id,
      sourceIndex: sp.sourceIndex,
      forms: [{ atlas: `fixture:pokemon/${name}.png`, shinyAtlas: `fixture:pokemon/${name}-shiny.png`, front: { y: 0, yOffset: 0 }, back: { y: 80, yOffset: 0 }, icon: `fixture:pokemon/${name}-icon.png` }],
      front: anim,
      back: anim,
      yOffset: 0,
      shadow: { x: 0, size: 1 },
    };
  });
}
