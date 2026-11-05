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

/**
 * Street lamps on the land whose material names do not say so, as material → texture: Jubilife's plaza lamps
 * (`c1_o02`, an atlas of the whole lamp, with white panes in it and in `c1_o02b`) and the lamp heads over Route 206's
 * cycling road (`lambert14`). Only the pair is a lamp: the road's centre dashes share `r206_cy6`, and `lambert14` names
 * unrelated parts elsewhere.
 */
const LAND_LAMPS = new Map([
  ['c1_o02', 'c1_o02'],
  ['c1_o02b', 'c1_o02b'],
  ['lambert14', 'r206_cy6'],
]);

export function glowKind(material: string, texture: string): GlowKind | null {
  const name = material.replace(/_lm\d+$/, '');
  return WINDOW.test(name) ? 'window' : LIGHT.test(name) || LAND_LAMPS.get(name) === texture ? 'lamp' : null;
}
