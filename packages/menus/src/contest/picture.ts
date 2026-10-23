/**
 * Contest photos as drawn (contracts `ContestPicture`; decomp ov22_0225AF8C.c): the Pokémon and the accessories of a
 * `ContestDressUp` in the photo's coordinates, moved to where a screen shows them. A photo's coordinates are the
 * dress-up screen's moved by (−64, +40) (VisualCompetition_Main state 20, ov22_02257AB0): the stage's frame has its
 * top-left at (72, 56) and the Pokémon its centre at (128, 141 + its picture's height offset) (GetMonXYPositions).
 */
import type { ContestDressUp, ContestPicture, PokemonFace, Registries } from '@opensinnoh/contracts';
import { dexOf } from '@opensinnoh/contracts';
import { genderOf, isShiny, type Id } from '@opensinnoh/core';

/** The photo's stage frame (ov22_0225B490: the dress-up stage at (136, 16), moved by (−64, +40)). */
export const PHOTO_FRAME = { x: 72, y: 56 } as const;
/** The dress-up screen's stage frame and the Pokémon's centre x on it (ov22_02256790). */
export const STAGE_FRAME = { x: 136, y: 16 } as const;
export const PHOTO_SHIFT = { x: PHOTO_FRAME.x - STAGE_FRAME.x, y: PHOTO_FRAME.y - STAGE_FRAME.y } as const;
export const STAGE_MON_X = 192;
/** The Pokémon's centre y on the dress-up stage: (16 + 129) − (80 / 2 − height) − 4. */
export const stageMonY = (height: number): number => 16 + 129 - (40 - height) - 4;

/** A photographed Pokémon (the parts of `ContestPhoto.mon` a picture needs). */
export interface PhotoMon {
  species: Id;
  form: number;
  pid: number;
  otId: number;
}

/** The Pokémon's front face as the photo draws it: the female picture where it differs (decomp BuildPokemonSpriteTemplate). */
export function photoFace(registries: Registries, mon: PhotoMon): { face: PokemonFace; female: boolean; shiny: boolean } {
  const sprites = registries.pokemonSprites.get(mon.species);
  const form = sprites?.forms[mon.form] ?? sprites?.forms[0];
  if (!form) throw new Error(`contest photo: no sprites for ${mon.species}`);
  const female = genderOf(dexOf(registries).form(mon.species, mon.form).genderRatio, mon.pid) === 'female';
  return { face: (female && form.frontFemale) || form.front, female, shiny: isShiny(mon.otId, mon.pid) };
}

/**
 * The photo `dressUp` of `mon` moved by (dx, dy) from the photo's coordinates, back to front by priority (the DS draws
 * a higher priority nearer), the backdrop at the frame (null: none drawn).
 */
export function contestPicture(registries: Registries, mon: PhotoMon, dressUp: ContestDressUp, dx: number, dy: number, backdrop: boolean): ContestPicture {
  const { face, female, shiny } = photoFace(registries, mon);
  const order = dressUp.accessories.map((a, i) => ({ a, i })).sort((p, q) => p.a.priority - q.a.priority || q.i - p.i);
  return {
    mon: { species: mon.species, form: mon.form, female, shiny, x: PHOTO_FRAME.x + 56 + dx, y: stageMonY(face.yOffset) + PHOTO_SHIFT.y + dy },
    accessories: order.map(({ a }) => ({ accessory: a.accessory, x: a.x + dx, y: a.y + dy })),
    monAt: order.filter(({ a }) => a.priority < dressUp.monPriority).length,
    backdrop: backdrop ? dressUp.backdrop : null,
    backdropX: PHOTO_FRAME.x + dx,
    backdropY: PHOTO_FRAME.y + dy,
  };
}
