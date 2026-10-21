/**
 * The Pastoria gate's binoculars (decomp src/great_marsh_lookout.c Task_GreatMarshLookout,
 * src/overlay006/great_marsh_binoculars.c, great_marsh_lookout_sprite.c). Five random spots of the Great Marsh
 * (encdata_ex member 11, drawn with replacement), each a temporary map change (no warp flags) with the player hidden:
 * the iris opens on the spot with a Pokémon of its area in the screen's centre (KASYA), stays 60 frames or until A,
 * and closes (KASYA). Then the player is back where they stood, facing north, and the screen fades in. The Pokétch is
 * hidden throughout.
 */
import { GENDER_RATIO, type DayPeriod, type Id } from '@opensinnoh/core';
import type { EncounterTable, Facing, GameState, Registries } from '@opensinnoh/contracts';
import { landSlot } from './encounters.ts';
import { dailyMarshSpecies, greatMarsh } from './safari.ts';

/** BINOCULARS_CYCLE_COUNT. */
const VIEWS = 5;
/** Task_GreatMarshLookout state 5: frames each view stays without an A press. */
const VIEW_FRAMES = 60;
/** The brightness fades and the circle fades: 6 steps of 1 frame. */
export const LOOKOUT_FADE = 6;
/** SEQ_SE_DP_KASYA: the binoculars' click as the iris opens or closes. */
const SE_KASYA = 1657;

export interface LookoutHost {
  readonly reg: Registries;
  readonly state: GameState;
  /** LCRNG_Next (the main stream). */
  random(): number;
  /** The brightness fade (both screens) and its end. */
  fade(kind: 'in' | 'out', frames: number): void;
  fadeDone(): boolean;
  /** FieldTask_ChangeMapByLocation with SetTemporaryMapChange: the map loads at once, no warp flags, no fade. */
  changeMap(zone: Id, x: number, z: number, facing: Facing): void;
  /** The zone of a Great Marsh matrix tile (the map matrix's header for the tile's cell). */
  marshZone(x: number, z: number): Id;
  hidePlayer(hidden: boolean): void;
  hidePoketch(hidden: boolean): void;
  encounters(zone: Id): EncounterTable;
  period(): DayPeriod;
  pressedA(): boolean;
  playSe(source: number): void;
}

/** What the screen shows of the lookout (the app's overlay): the Pokémon and the iris (0 closed … 1 open, null none). */
export interface LookoutView {
  pokemon: { species: Id; female: boolean } | null;
  iris: number | null;
}

export class GreatMarshLookout {
  private readonly spots: { zone: Id | null; x: number; z: number; facing: Facing }[];
  private views = 0;
  private state = 0;
  private timer = 0;
  private iris: { from: number; to: number; t: number } | null = null;
  private irisValue: number | null = null;
  private pokemon: LookoutView['pokemon'] = null;

  constructor(private readonly h: LookoutHost) {
    const g = greatMarsh(h.reg);
    if (!g) throw new Error('great marsh lookout: the packs have no Great Marsh (NewGame.greatMarsh)');
    const p = h.state.player;
    // GreatMarshBinoculars_InitData: five spots by LCRNG_RandMod(36), then the player's own tile.
    this.spots = Array.from({ length: VIEWS }, () => {
      const s = g.lookout[(h.random() >>> 0) % g.lookout.length]!;
      return { zone: null, x: s.x, z: s.z, facing: 'up' as Facing };
    });
    this.spots.push({ zone: p.zone, x: p.x, z: p.z, facing: 'up' });
  }

  view(): LookoutView {
    return { pokemon: this.pokemon, iris: this.irisValue };
  }

  /** One tick; true once the task is over. */
  step(): boolean {
    const h = this.h;
    if (this.iris) {
      const i = this.iris;
      i.t++;
      this.irisValue = i.from + ((i.to - i.from) * Math.min(i.t, LOOKOUT_FADE)) / LOOKOUT_FADE;
      if (i.t < LOOKOUT_FADE) return false;
      this.iris = null;
    }
    switch (this.state) {
      case 0:
        h.fade('out', LOOKOUT_FADE);
        this.state = 1;
        return false;
      case 1:
        if (!h.fadeDone()) return false;
        this.state = 2;
        return false;
      case 2: {
        // State 2: the Pokétch hides before the first view and comes back with the return.
        if (this.views === 0) h.hidePoketch(true);
        if (this.views === VIEWS) h.hidePoketch(false);
        const s = this.spots[this.views]!;
        h.changeMap(s.zone ?? h.marshZone(s.x, s.z), s.x, s.z, s.facing);
        this.state = 4;
        return false;
      }
      case 4:
        this.views++;
        if (this.views <= VIEWS) {
          h.hidePlayer(true);
          this.pokemon = this.pickPokemon();
          this.timer = 0;
          h.playSe(SE_KASYA);
          this.irisValue = 0;
          this.iris = { from: 0, to: 1, t: 0 };
          this.state = 5;
        } else {
          h.hidePlayer(false);
          this.irisValue = null;
          h.fade('in', LOOKOUT_FADE);
          this.state = 8;
        }
        return false;
      case 5:
        if (++this.timer < VIEW_FRAMES && !h.pressedA()) return false;
        h.playSe(SE_KASYA);
        this.iris = { from: 1, to: 0, t: 0 };
        this.state = 7;
        return false;
      case 7:
        // The sprite goes once the iris has closed; the screen stays black for the next map change.
        this.pokemon = null;
        this.state = 2;
        return false;
      case 8:
        return h.fadeDone();
    }
    throw new Error(`great marsh lookout: state ${this.state}`);
  }

  /**
   * GreatMarshBinoculars_GetMonSpecies and the sprite's gender: the area's 12 land slots with the daily species in
   * slots 6 and 7 (whether or not a Safari Game runs) and the period's slots 2 and 3, one of them uniformly
   * (LCRNG_RandMod(12)); a mixed gender ratio draws the gender (LCRNG_Next odd: male).
   */
  private pickPokemon(): { species: Id; female: boolean } {
    const h = this.h;
    const g = greatMarsh(h.reg)!;
    const zone = h.state.player.zone;
    const table = h.encounters(zone);
    if (table.land.length !== 12) throw new Error(`great marsh lookout: ${zone} has ${table.land.length} land slots`);
    const daily = dailyMarshSpecies(g, h.state, zone);
    const slot = (h.random() >>> 0) % 12;
    const species = slot === 6 || slot === 7 ? daily : landSlot(table, slot, h.period());
    const ratio = h.reg.species.get(species)?.genderRatio;
    if (ratio === undefined) throw new Error(`great marsh lookout: unknown species ${species}`);
    const female = ratio === GENDER_RATIO.femaleOnly || (ratio !== GENDER_RATIO.maleOnly && ratio !== GENDER_RATIO.genderless && (h.random() >>> 0) % 2 === 0);
    return { species, female };
  }
}
