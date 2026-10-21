/**
 * Static and legendary battles (docs/research/scrcmd-m5.md): the
 * script's own wild battles, their raw result, Giratina's forms and the roamers. Names and behaviour follow the
 * decomp handlers (scrcmd.c, scrcmd_trainer.c, encounter.c); 'continue' where they return FALSE, 'yield' where
 * they return TRUE.
 *
 * The field's return after the battle (on-load and on-resume, which remove the Pokémon's object through
 * FLAG_MAP_LOCAL_REMOVE_OBJECT) is the game's, for every battle (game.ts `fieldReturn`).
 */
import { abilityFor, recalc, type Arg } from '@opensinnoh/core';
import { dexOf, markCaught, type BattleKind, type BattleOutcome } from '@opensinnoh/contracts';
import { battleOutcome, scriptBattle } from './m2a-ops.ts';
import type { Context, Handler, Result, Runner, Thread } from './runner.ts';

/** Decomp BATTLE_RESULT_* (include/constants/battle.h): the value GetBattleResult writes. */
export const BATTLE_RESULT_VALUES: Record<BattleOutcome, number> = { won: 1, lost: 2, draw: 3, caught: 4, fled: 5, 'enemy-fled': 6 };

/** Decomp SPECIES_GIRATINA, ITEM_GRISEOUS_ORB, GIRATINA_FORM_ORIGIN. */
const SPECIES_GIRATINA = 487;
const ITEM_GRISEOUS_ORB = 112;
const GIRATINA_FORM_ORIGIN = 1;

export function staticHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);

  /**
   * Decomp Encounter_NewVsSpeciesAtLevel / Encounter_NewVsGiratinaOrigin: one scripted wild Pokémon (the level
   * narrowed to u8), the encounter task, the raw result kept for the script.
   */
  const staticBattle = (t: Thread, c: Context, a: Arg[], kind: BattleKind, giratina = false): Result => {
    const species = r.source('species', val(t, a[0]))!;
    const level = val(t, a[1]) & 0xff;
    // Pokemon_SetGiratinaOriginForm: Origin only for Giratina; the status bits and terrain whatever the species.
    const form = giratina && r.source('species', SPECIES_GIRATINA, false) === species ? { form: GIRATINA_FORM_ORIGIN } : {};
    return scriptBattle(r, t, c, { kind, trainers: [], wild: [{ species, level, ...form }], ...(giratina ? { giratina } : {}) });
  };

  return {
    /** ScrCmd_StartWildBattle: without the legendary status. */
    start_wild_battle: (t, c, a) => staticBattle(t, c, a, 'static'),
    /** ScrCmd_StartLegendaryBattle: BATTLE_STATUS_LEGENDARY (read by no battle code; the music is by species). */
    start_legendary_battle: (t, c, a) => staticBattle(t, c, a, 'legendary'),
    /** ScrCmd_StartGiratinaOriginBattle: Origin form, the legendary, Giratina and Distortion status, TERRAIN_GIRATINA. */
    start_giratina_origin_battle: (t, c, a) => staticBattle(t, c, a, 'legendary', true),

    /** ScrCmd_GetBattleResult: the raw result (1–6), not cleared; TRUE. */
    get_battle_result: (t, _c, a) => {
      r.setVar(t, r.ref(a[0], 'var'), BATTLE_RESULT_VALUES[battleOutcome(t, 'get_battle_result')]);
      return 'yield';
    },

    /**
     * ScrCmd_SetPartyGiratinaForm (Party_SetGiratinaForm): any nonzero form makes every party Giratina Origin; 0 sets
     * each by its held item (the Griseous Orb keeps Origin, else Altered). The ability and stats follow; each
     * Giratina that is not an egg is recorded in the Pokédex with its form (Pokedex_Capture).
     */
    set_party_giratina_form: (t, _c, a) => {
      const origin = val(t, a[0]) !== 0;
      const giratina = r.source('species', SPECIES_GIRATINA, false);
      const orb = r.source('items', ITEM_GRISEOUS_ORB, false);
      const dex = dexOf(r.registries);
      for (const mon of r.state.party) {
        if (mon.species !== giratina) continue;
        mon.form = origin || (orb !== undefined && mon.heldItem === orb) ? GIRATINA_FORM_ORIGIN : 0;
        mon.ability = abilityFor(dex.form(mon.species, mon.form), mon.pid);
        recalc(dex, mon);
        if (!mon.isEgg) markCaught(r.state, r.registries, mon);
      }
      return 'continue';
    },

    /** ScrCmd_ActivateRoamingPokemon: the slot's roamer starts roaming (the world's roamers.ts). */
    activate_roaming_pokemon: (t, _c, a) => {
      r.field.activateRoamer(val(t, a[0]));
      return 'continue';
    },
  };
}
