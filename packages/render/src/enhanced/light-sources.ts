/** What a light source glows as: a lamp, sign or beacon in its own texel colour, or a window in warm light. */
export type GlowKind = 'lamp' | 'window';

/**
 * The map's light sources, by the material names the map models give them (an `_lmN` suffix is the importer's): the
 * buildings' `light` parts (porch lamps, the Poké Mart's and the Pokémon Center's signs, street lamp props), street
 * lamps and beacons on the land (`c1_lamp01`, `lamp03`, `c2_light_a`), and windows (`h_mado`, `gingamado`,
 * `window01_mat`). Only their bright texels glow (lamps.ts), so the dark frame of a lamp or a window stays as drawn.
 * Glows draw outdoors only (pipeline.ts): a cave's `dun_light` and a room's lights never do.
 */
const LIGHT = /^(light|lamp)|_(lamp|light)/i;
const WINDOW = /mado|^window/i;

export function glowKind(material: string): GlowKind | null {
  const name = material.replace(/_lm\d+$/, '');
  return WINDOW.test(name) ? 'window' : LIGHT.test(name) ? 'lamp' : null;
}
