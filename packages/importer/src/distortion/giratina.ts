import { decodeTexture, type SpriteAtlas, type Tex0 } from '@opensinnoh/g3d';

/** mmodel 393: two 128×64 frames. The model's quad is [-64,64] × [0,64].
 * Pad above the quad to retain its pixel scale and feet anchor in the square sprite renderer.
 */
export function giratinaAtlas(tex: Tex0): SpriteAtlas {
  if (tex.textures.length !== 2 || tex.palettes.length !== 2) throw new Error('Giratina: expected two textures and palettes');
  const rgba = new Uint8Array(256 * 128 * 4);
  const frameOfTexture: number[] = [];
  for (let frame = 0; frame < 2; frame++) {
    const index = tex.textures.findIndex(t => t.name.endsWith(`.${frame + 1}`));
    const t = tex.textures[index];
    const palette = tex.palettes[frame]!;
    if (!t || t.width !== 128 || t.height !== 64) throw new Error('Giratina: expected 128×64 numbered frames');
    frameOfTexture[index] = frame;
    const pixels = decodeTexture(tex, t, palette);
    for (let y = 0; y < 64; y++) rgba.set(pixels.subarray(y * 128 * 4, (y + 1) * 128 * 4), ((y + 64) * 256 + frame * 128) * 4);
  }
  return { frameSize: 128, frameCount: 2, width: 256, rgba, frameOfTexture };
}
