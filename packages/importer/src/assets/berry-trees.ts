import { decodeTexture, type SpriteAtlas, type Tex0 } from '@opensinnoh/g3d';

/**
 * The berry sprout and trees (decomp BILLBOARD_MODEL_BERRY_SPROUT 16×16 and BILLBOARD_MODEL_BERRY_TREE 16×32, frame
 * sequence `berry_tree`): numbered frames, each with its own palette `<texture>_pl`. Each frame sits in a square
 * cell as wide as the frame is tall, centred and on the cell's bottom edge, so the square sprite renderer keeps
 * the DS pixel scale and the plant stands on its tile.
 */
export function berryTreeAtlas(tex: Tex0): SpriteAtlas {
  const frames = tex.textures.map((t, dictIndex) => {
    const m = /\.(\d+)$/.exec(t.name);
    if (!m) throw new Error(`berry tree: texture ${t.name} has no frame number`);
    const palette = tex.palettes.find((p) => p.name === `${t.name}_pl`);
    if (!palette) throw new Error(`berry tree: texture ${t.name} has no palette ${t.name}_pl`);
    return { t, dictIndex, n: Number(m[1]), palette };
  });
  frames.sort((a, b) => a.n - b.n);
  const [first] = frames;
  if (!first) throw new Error('berry tree: no textures');
  const { width: w, height: h } = first.t;
  if (w > h) throw new Error(`berry tree: ${w}×${h} frames are wider than tall`);
  const size = h;
  const width = size * frames.length;
  const rgba = new Uint8Array(width * size * 4);
  const frameOfTexture: number[] = [];
  frames.forEach(({ t, dictIndex, n, palette }, slot) => {
    if (n !== slot + 1) throw new Error(`berry tree: frame numbers are not 1..${frames.length} (found ${t.name})`);
    if (t.width !== w || t.height !== h) throw new Error(`berry tree: ${t.name} is ${t.width}×${t.height}, expected ${w}×${h}`);
    frameOfTexture[dictIndex] = slot;
    const px = decodeTexture(tex, t, palette);
    const x0 = slot * size + (size - w) / 2;
    for (let y = 0; y < h; y++) rgba.set(px.subarray(y * w * 4, (y + 1) * w * 4), ((y + size - h) * width + x0) * 4);
  });
  return { frameSize: size, frameCount: frames.length, width, rgba, frameOfTexture };
}
