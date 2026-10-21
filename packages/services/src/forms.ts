/**
 * Form rules outside battle (decomp pokemon.c Pokemon_SetRotomForm, BoxPokemon_SetGiratinaForm,
 * BoxPokemon_SetArceusForm, Pokemon_SetShayminForm; their callers in the party menu, the PC and the scripts).
 * Each changes the stored Pokémon: form, ability and stats (and Rotom's appliance move), so battles and saves
 * see the new form. Records are found by their decomp constant (`sourceIndex`), as the VM finds them.
 */
import { abilityFor, MAX_MOVES, recalc, type ClockTime, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type GameState, type Registries } from '@opensinnoh/contracts';

/** Decomp SPECIES_* of the species with form rules or party checks. */
export const SPECIES = { regirock: 377, regice: 378, registeel: 379, regigigas: 486, rotom: 479, giratina: 487, shaymin: 492, arceus: 493 } as const;
/** Decomp ITEM_GRISEOUS_ORB, ITEM_GRACIDEA, ABILITY_MULTITYPE, MOVE_THUNDER_SHOCK. */
const ITEM_GRISEOUS_ORB = 112;
export const ITEM_GRACIDEA = 466;
const ABILITY_MULTITYPE = 121;
const MOVE_THUNDER_SHOCK = 84;
/** Decomp rotomFormMoves by ROTOM_FORM_* (base, heat, wash, frost, fan, mow): none, Overheat, Hydro Pump, Blizzard, Air Slash, Leaf Storm. */
export const ROTOM_FORM_MOVES = [null, 315, 56, 59, 403, 437] as const;
/** Decomp GIRATINA_FORM_ORIGIN, SHAYMIN_FORM_SKY. */
export const GIRATINA_ORIGIN = 1;
export const SHAYMIN_SKY = 1;
/** Decomp Pokemon_GetArceusTypeOf: the form is the type of the plate's HOLD_EFFECT_ARCEUS_* (enum PokemonType values), else Normal (0). */
const ARCEUS_TYPES: Record<string, number> = {
  ARCEUS_FIGHTING: 1, ARCEUS_FLYING: 2, ARCEUS_POISON: 3, ARCEUS_GROUND: 4, ARCEUS_ROCK: 5, ARCEUS_BUG: 6, ARCEUS_GHOST: 7, ARCEUS_STEEL: 8,
  ARCEUS_FIRE: 10, ARCEUS_WATER: 11, ARCEUS_GRASS: 12, ARCEUS_ELECTRIC: 13, ARCEUS_PSYCHIC: 14, ARCEUS_ICE: 15, ARCEUS_DRAGON: 16, ARCEUS_DARK: 17,
};
/** The Distortion World's map headers (decomp MAP_HEADER_DISTORTION_WORLD_1F … _TURNBACK_CAVE_ROOM): the party menu's give and take leave Giratina's form there. */
const DISTORTION_WORLD = /^MAP_HEADER_DISTORTION_WORLD_/;

const local = (id: Id) => id.slice(id.indexOf(':') + 1);
const caches = new WeakMap<object, Map<number, Id>>();

/** The record of a registry with that decomp constant (`sourceIndex`), or undefined. */
export function bySource(registries: Registries, kind: 'species' | 'moves' | 'items' | 'abilities', index: number): Id | undefined {
  const records = registries[kind] as ReadonlyMap<Id, { id: Id; sourceIndex?: number }>;
  let ids = caches.get(records);
  if (!ids) caches.set(records, (ids = new Map([...records.values()].flatMap((r) => (r.sourceIndex === undefined ? [] : [[r.sourceIndex, r.id] as const])))));
  return ids.get(index);
}

/** Whether the Pokémon is of the species with decomp constant `index`. */
export function isSpecies(registries: Registries, mon: Pokemon, index: number): boolean {
  return bySource(registries, 'species', index) === mon.species;
}

function move(registries: Registries, index: number): Id {
  const id = bySource(registries, 'moves', index);
  if (!id) throw new Error(`forms: no move ${index}`);
  return id;
}

function reform(registries: Registries, mon: Pokemon, form: number): void {
  const dex = dexOf(registries);
  mon.form = form;
  mon.ability = abilityFor(dex.form(mon.species, form), mon.pid);
  recalc(dex, mon);
}

/**
 * Decomp Pokemon_SetRotomForm: a Rotom's form and its appliance move. An appliance move it knows becomes the new
 * form's (or goes, for the base form); without one the new form's move takes the first free slot, else `moveSlot`.
 * A Rotom left with no move first learns Thunder Shock. Not a Rotom: false, nothing changes.
 */
export function setRotomForm(registries: Registries, mon: Pokemon, form: number, moveSlot: number): boolean {
  if (!isSpecies(registries, mon, SPECIES.rotom)) return false;
  if (!Number.isInteger(form) || form < 0 || form >= ROTOM_FORM_MOVES.length) throw new Error(`forms: Rotom form ${form}`);
  const dex = dexOf(registries);
  const appliance = new Set(ROTOM_FORM_MOVES.slice(1).map((m) => move(registries, m!)));
  const formMove = ROTOM_FORM_MOVES[form];
  let pending: Id | null = formMove ? move(registries, formMove) : null;
  const reset = (slot: number, id: Id) => {
    mon.moves[slot] = id;
    mon.pp[slot] = dex.move(id).pp;
    mon.ppUps[slot] = 0;
  };
  for (let i = 0; i < mon.moves.length; i++) {
    if (!appliance.has(mon.moves[i]!)) continue;
    if (pending) {
      reset(i, pending);
      pending = null;
    } else {
      // Decomp Pokemon_ClearMoveSlot: the later moves close up.
      mon.moves.splice(i, 1);
      mon.pp.splice(i, 1);
      mon.ppUps.splice(i, 1);
      i--;
    }
  }
  if (pending) reset(mon.moves.length < MAX_MOVES ? mon.moves.length : moveSlot, pending);
  if (!mon.moves.length) reset(0, move(registries, MOVE_THUNDER_SHOCK));
  reform(registries, mon, form);
  return true;
}

/** Decomp BoxPokemon_SetGiratinaForm: a Giratina holding the Griseous Orb is Origin, else Altered. Returns the form, or null for another species. */
export function setGiratinaFormByItem(registries: Registries, mon: Pokemon): number | null {
  if (!isSpecies(registries, mon, SPECIES.giratina)) return null;
  const form = mon.heldItem !== null && mon.heldItem === bySource(registries, 'items', ITEM_GRISEOUS_ORB) ? GIRATINA_ORIGIN : 0;
  reform(registries, mon, form);
  return form;
}

/** Decomp BoxPokemon_SetArceusForm: an Arceus with Multitype takes the type of its plate (none: Normal). */
export function setArceusForm(registries: Registries, mon: Pokemon): void {
  if (!isSpecies(registries, mon, SPECIES.arceus) || mon.ability === null || mon.ability !== bySource(registries, 'abilities', ABILITY_MULTITYPE)) return;
  mon.form = ARCEUS_TYPES[dexOf(registries).holdEffect(mon.heldItem).holdEffect] ?? 0;
}

/** Decomp Pokemon_SetShayminForm. */
export function setShayminForm(registries: Registries, mon: Pokemon, form: number): void {
  if (!isSpecies(registries, mon, SPECIES.shaymin)) throw new Error(`forms: ${mon.species} is not Shaymin`);
  reform(registries, mon, form);
}

/**
 * Decomp Pokemon_CanShayminSkyForm (the Gracidea): a Land Forme Shaymin met in a fateful encounter, not fainted, not
 * frozen, between 4:00 and 19:59 on the clock.
 */
export function canShayminSky(registries: Registries, mon: Pokemon, clock: ClockTime): boolean {
  return isSpecies(registries, mon, SPECIES.shaymin) && mon.form === 0 && mon.hp > 0 && mon.fatefulEncounter === true && mon.status !== 'freeze' && clock.hour >= 4 && clock.hour < 20;
}

/** Decomp Party_SetShayminLandForm: every Sky Forme Shaymin in the party back to Land. */
export function shayminToLand(registries: Registries, party: Pokemon[]): void {
  for (const mon of party) if (isSpecies(registries, mon, SPECIES.shaymin) && mon.form === SHAYMIN_SKY) setShayminForm(registries, mon, 0);
}

/**
 * Decomp Party_SetShayminForm, as the clock moves on by `minutes` to `clock`: when those minutes reach back past 20:00
 * (at night) or past 4:00 (by day), the night came, and party Sky Forme Shaymin turn back to Land.
 */
export function shayminClockRevert(registries: Registries, party: Pokemon[], minutes: number, clock: ClockTime): void {
  const night = clock.hour >= 20 || clock.hour < 4;
  const since = night ? clock.minute + (((clock.hour < 4 ? clock.hour + 24 : clock.hour) - 20) * 60) : clock.minute + (clock.hour - 4) * 60;
  if (since < (night ? minutes + 1 : minutes)) shayminToLand(registries, party);
}

/**
 * After a party Pokémon's held item changed in the party menu (decomp UpdatePokemonWithItem, the take callbacks,
 * SwapPokemonItem): Arceus follows its plate; Giratina follows the Griseous Orb, except that a give or take inside
 * the Distortion World leaves its form (a swap does not check). Returns true when Giratina's form changed, which the
 * party menu shows (PARTY_MENU_STATE_12 / PRINTING_FORM_CHANGE).
 */
export function heldItemChanged(state: GameState, registries: Registries, mon: Pokemon, change: 'give' | 'take' | 'swap'): boolean {
  setArceusForm(registries, mon);
  if (change !== 'swap' && DISTORTION_WORLD.test(local(state.player.zone))) return false;
  const before = mon.form;
  const form = setGiratinaFormByItem(registries, mon);
  return form !== null && form !== before;
}

/** The PC's MOVE ITEMS (decomp the box app's held-item change): Arceus by its plate, Giratina by the Griseous Orb, anywhere. */
export function boxHeldItemChanged(registries: Registries, mon: Pokemon): void {
  setArceusForm(registries, mon);
  setGiratinaFormByItem(registries, mon);
}

/** Decomp ScrCmd_TryRevertPokemonForm's revert (the Day Care): Giratina by its held item, Rotom and Shaymin to their base form. */
export function revertForm(registries: Registries, mon: Pokemon): void {
  if (mon.form === 0) return;
  if (isSpecies(registries, mon, SPECIES.giratina)) setGiratinaFormByItem(registries, mon);
  else if (isSpecies(registries, mon, SPECIES.rotom)) setRotomForm(registries, mon, 0, 0);
  else if (isSpecies(registries, mon, SPECIES.shaymin)) setShayminForm(registries, mon, 0);
}
