/**
 * Platinum's party follower sets and follow modes (docs/research/following-pokemon.md §1; docs/decisions.md). Platinum has no following Pokémon outside Amity Square: the sets are the Pokémon object
 * gfx with a full walking set, listed by gfx number with their species and form numbers. Nothing here
 * lists ROM data.
 */
import type { FollowerSprite, FollowMode, Sprite, Zone } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';

/** A walking set: 4 directions × 4 frames (the generic walk), as the importer converts walk sets. */
const WALK_FRAMES = 16;

/**
 * Our follow-mode policy for Platinum's map types (the DS has none; HGSS's map headers do): outdoors,
 * towns and caves allow, indoors restrict the large sets, the rest (the Underground, unnamed types)
 * prevent. Mods patch `Zone.follow` per zone.
 */
export const PLATINUM_FOLLOW_MODES: Readonly<Record<Zone['mapType'], FollowMode>> = {
  town: 'allow',
  city: 'allow',
  route: 'allow',
  outdoors: 'allow',
  cave: 'allow',
  indoors: 'height-restrict',
  other: 'prevent',
};

/**
 * The Pokémon object gfx with a full walking set and the species and form they show, by number: gfx index →
 * [species id (National Pokédex number), form]. From the decomp's object gfx list (`OBJ_EVENT_GFX_*`) and
 * species constants; research §1 lists them. Gfx 236 (PIKACHU_UNUSED) repeats gfx 71's set and is left out.
 */
export const PLATINUM_FOLLOWER_GFX: ReadonlyMap<number, readonly [species: number, form: number]> = new Map([
  [71, [25, 0]], // PIKACHU
  [72, [35, 0]], // CLEFAIRY
  [73, [39, 0]], // JIGGLYPUFF
  [74, [54, 0]], // PSYDUCK
  [78, [255, 0]], // TORCHIC
  [79, [300, 0]], // SKITTY
  [158, [492, 0]], // SHAYMIN (Land)
  [185, [425, 0]], // DRIFLOON
  [204, [417, 0]], // PACHIRISU
  [205, [285, 0]], // SHROOMISH
  [206, [427, 0]], // BUNEARY
  [207, [440, 0]], // HAPPINY
  [208, [66, 0]], // MACHOP
  [220, [387, 0]], // TURTWIG
  [221, [388, 0]], // GROTLE
  [222, [389, 0]], // TORTERRA
  [223, [390, 0]], // CHIMCHAR
  [224, [391, 0]], // MONFERNO
  [225, [392, 0]], // INFERNAPE
  [226, [393, 0]], // PIPLUP
  [227, [394, 0]], // PRINPLUP
  [228, [395, 0]], // EMPOLEON
  [229, [453, 0]], // CROAGUNK
  [237, [479, 1]], // ROTOM_HEAT
  [238, [479, 4]], // ROTOM_FAN
  [239, [479, 3]], // ROTOM_FROST
  [240, [479, 2]], // ROTOM_WASH
  [241, [479, 5]], // ROTOM_MOW
]);

/**
 * The follower sets: each gfx of `PLATINUM_FOLLOWER_GFX`, whose sprite must be a walking set (the import
 * fails otherwise). The record id names the gfx (`FOLLOWER_<gfx name>`); nothing is matched by name.
 */
export function platinumFollowers(
  gfxNames: ReadonlyMap<number, string>,
  sprites: readonly Sprite[],
  spriteId: (gfx: number) => Id,
  speciesId: (index: number) => Id,
): FollowerSprite[] {
  const byId = new Map(sprites.map((s) => [s.id, s]));
  return [...PLATINUM_FOLLOWER_GFX].map(([gfx, [species, form]]) => {
    const name = gfxNames.get(gfx);
    const sprite = byId.get(spriteId(gfx));
    if (!name || !sprite || !('atlas' in sprite) || sprite.frameCount !== WALK_FRAMES) {
      throw new Error(`followers: gfx ${gfx} (${name ?? 'unnamed'}) is not a ${WALK_FRAMES}-frame walking billboard`);
    }
    return { id: asId(`platinum:FOLLOWER_${name.replace(/^OBJ_EVENT_GFX_/, '')}`), species: speciesId(species), form, sprite: sprite.id, size: 'small', animation: 'walk' };
  });
}
