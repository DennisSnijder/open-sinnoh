/**
 * The M6 commands: the post-game field ops. Each follows its decomp handler
 * (names and behaviour only); 'continue' where the decomp returns FALSE, 'yield' where it returns TRUE.
 */
import { monGender } from '@opensinnoh/core';
import { dexOf, markSeen } from '@opensinnoh/contracts';
import { plainMarkup } from '@opensinnoh/text';
import type { Handler, Runner } from './runner.ts';

/** Decomp GENDER_FEMALE. */
const GENDER_FEMALE = 1;
/** Decomp ScrCmd_DrawPokemonPreview: DrawPokemonPreview(…, x 10, y 5, …), a 10×10-tile picture (POKEMON_SPRITE_FRAME_*_TILES). */
export const POKEMON_PREVIEW = { x: 10 * 8, y: 5 * 8, width: 10 * 8, height: 10 * 8 } as const;

/** Decomp MAP_HEADER_TURNBACK_CAVE_* (`zones` sourceIndex). */
export const TURNBACK = {
  entrance: 268,
  pillarRoom: 269,
  giratinaRoom: 270,
  /** sPillarRooms (InitTurnbackCave): six rooms before each of the three pillars. */
  rooms: [271, 272, 273, 518, 519, 520, 521, 522, 523, 524, 525, 526, 527, 528, 529, 530, 531, 532],
} as const;
/** Decomp BATTLEGROUND_TRAINER_NONE. */
export const BATTLEGROUND_TRAINER_NONE = 0xfff;
/** Decomp sBattlegroundGymLeaders and sBattlegroundStatTrainers: OBJ_EVENT_GFX_ROARK … VOLKNER, CHERYL … MIRA. */
export const BATTLEGROUND_GYM_LEADERS = [126, 127, 128, 129, 130, 131, 132, 133];
export const BATTLEGROUND_STAT_TRAINERS = [141, 142, 143, 144, 145];
/** Decomp RUINS_STATE_ACTIVATED_ALL_DOTS and DOT_TYPE_* (constants/regi_ruins.h) with the dot tiles of each ruin (ov5_021F6454.c). */
export const RUINS_STATE_ACTIVATED_ALL_DOTS = 260;
export const REGI_RUINS_DOTS: Record<number, [number, number][]> = {
  588: [[4, 7], [5, 5], [5, 9], [7, 7], [9, 5], [9, 9], [10, 7]],
  590: [[3, 7], [5, 7], [7, 5], [7, 7], [7, 9], [9, 7], [11, 7]],
  592: [[5, 5], [5, 7], [5, 9], [7, 7], [9, 5], [9, 7], [9, 9]],
};
const ALL_DOTS = 0x7f;
/** Decomp SEQ_SE_PL_JUMP2: the dot's sound. */
const SE_JUMP2 = 1487;
/** Decomp sBattleFrontierBanlist (pokemon.c), by species number: the Pokémon no Frontier facility accepts. */
export const BATTLE_FRONTIER_BANLIST = [150, 151, 249, 250, 251, 382, 383, 384, 385, 386, 483, 484, 487, 489, 490, 491, 492, 493];

export function m6Handlers(r: Runner): Record<string, Handler> {
  /** Decomp LCRNG_Next() % n. */
  const random = (n: number) => (r.rng() >>> 0) % n;
  /**
   * Decomp GetRandomBattlegroundGymLeaderID / GetRandomBattlegroundStatTrainerID: a draw in 0…count where count
   * means none; a taken index draws again, up to 8 tries, then none.
   */
  const pickOther = (count: number, taken: number[]) => {
    for (let tries = 1; ; tries++) {
      const n = random(count + 1);
      if (n === count) return n;
      if (tries >= 8) return count;
      if (!taken.includes(n)) return n;
    }
  };
  return {
    /**
     * Decomp ScrCmd_DrawPokemonPreview: the framed front picture of `species` (BuildPokemonSpriteTemplate: form 0,
     * not shiny, the gender's face) on the main screen, and FieldSystem_WriteSpeciesSeen (species only, as
     * set_species_seen). It does not wait; the scripts follow it with wait_ab_press (the Pokémon Mansion book,
     * Verity Cavern's Mesprit, Fullmoon Island's Cresselia).
     */
    draw_pokemon_preview: (t, _c, a) => {
      if (r.ui.pokemonPreview) throw new Error('draw_pokemon_preview: a preview is already shown');
      const species = r.source('species', r.val(t, a[0]))!;
      r.ui.pokemonPreview = { ...POKEMON_PREVIEW, species, female: r.val(t, a[1]) === GENDER_FEMALE };
      markSeen(r.state, species, null);
      return 'continue';
    },
    /**
     * Decomp ScrCmd_DrawPokemonPreviewFromPartySlot (Chatter's script): the preview of the party Pokémon in the slot
     * (DrawPokemonPreviewFromStruct) and FieldSystem_WriteSpeciesSeen. The view has no form or shiny colours: form 0,
     * not shiny, the gender's face, as `draw_pokemon_preview`.
     */
    draw_pokemon_preview_from_party_slot: (t, _c, a) => {
      if (r.ui.pokemonPreview) throw new Error('draw_pokemon_preview_from_party_slot: a preview is already shown');
      const slot = r.val(t, a[0]);
      const mon = r.state.party[slot];
      if (!mon) throw new Error(`draw_pokemon_preview_from_party_slot: no Pokémon in party slot ${slot}`);
      r.ui.pokemonPreview = { ...POKEMON_PREVIEW, species: mon.species, female: monGender(dexOf(r.registries), mon) === 'female' };
      markSeen(r.state, mon.species, null);
      return 'continue';
    },
    /**
     * Decomp ScrCmd_SetPokemonPreviewAnim / ScrCmd_WaitPokemonPreviewAnim: the preview's Pokémon plays its front-sprite
     * animation and the script waits for it. The animation is not drawn (the preview shows frame 0), so the wait ends at
     * once; logged.
     */
    set_pokemon_preview_anim: () => {
      if (!r.ui.pokemonPreview) throw new Error('set_pokemon_preview_anim: no preview is shown');
      r.log.stub('render:preview-anim', "the Pokémon preview's front animation is not drawn; its wait ends at once");
      return 'yield';
    },
    wait_pokemon_preview_anim: () => 'continue',
    /** Decomp ScrCmd_RemovePokemonPreview: PREVIEW_STATE_REMOVE (the preview task erases it), and yields. */
    remove_pokemon_preview: () => {
      if (!r.ui.pokemonPreview) throw new Error('remove_pokemon_preview: no preview is shown');
      r.ui.pokemonPreview = null;
      return 'yield';
    },

    /**
     * Decomp ScrCmd_InitTurnbackCave, from each Turnback Cave room's onTransition: picks where the room's four
     * doors lead. Three pillars seen: the Giratina room; else 30 rooms visited: back to the entrance; else a 25%
     * chance of the pillar room; else one of the six rooms before the next pillar. The door the player came in by
     * (from the arrival tile) keeps its target; each warp keeps its destination warp.
     */
    init_turnback_cave: (t, _c, a) => {
      const pillars = r.val(t, a[0]);
      const rooms = r.val(t, a[1]);
      const header = pillars >= 3 ? TURNBACK.giratinaRoom : rooms >= 30 ? TURNBACK.entrance : random(100) < 25 ? TURNBACK.pillarRoom : TURNBACK.rooms[random(6) + pillars * 6];
      if (header === undefined) throw new Error(`init_turnback_cave: no room for ${pillars} pillars seen`);
      const zone = r.source('zones', header)!;
      const { x, z } = r.field.player();
      const entry = x === 11 ? (z === 1 ? 0 : z === 20 ? 2 : 5) : x === 20 ? 1 : 3;
      for (let warp = 0; warp < 4; warp++) if (warp !== entry) r.field.setWarpDestination(warp, zone);
      return 'continue';
    },

    /**
     * Decomp ScrCmd_GetRandomBattlegroundTrainers, from the Battleground's onTransition once a day: one to three
     * distinct gym leaders and maybe one stat trainer, as OBJ_EVENT_GFX ids (the room's var sprites), else
     * BATTLEGROUND_TRAINER_NONE. As on the DS, the stat trainer's draw only excludes the none index, so the four
     * draws use the same LCRNG stream as the decomp.
     */
    get_random_battleground_trainers: (t, _c, a) => {
      const out = [BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE];
      const leaders = BATTLEGROUND_GYM_LEADERS.length;
      const first = random(leaders);
      out[0] = BATTLEGROUND_GYM_LEADERS[first]!;
      const second = pickOther(leaders, [first, BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE]);
      if (second !== leaders) out[1] = BATTLEGROUND_GYM_LEADERS[second]!;
      const third = pickOther(leaders, [first, second, BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE]);
      if (third !== leaders) out[2] = BATTLEGROUND_GYM_LEADERS[third]!;
      const stat = pickOther(BATTLEGROUND_STAT_TRAINERS.length, [BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE, BATTLEGROUND_TRAINER_NONE]);
      if (stat !== BATTLEGROUND_STAT_TRAINERS.length) out[3] = BATTLEGROUND_STAT_TRAINERS[stat]!;
      out.forEach((v, i) => r.setVar(t, r.ref(a[i], 'var'), v));
      return 'continue';
    },

    /**
     * Decomp ScrCmd_ActivateRegiRuinsDot (a Regi ruin's coord events): when x/z is one of the ruin's seven dot
     * tiles, the jump sound plays and its bit is set in the var; all seven make it RUINS_STATE_ACTIVATED_ALL_DOTS.
     */
    activate_regi_ruins_dot: (t, _c, a) => {
      const dest = r.ref(a[0], 'var');
      const type = r.val(t, a[1]);
      const x = r.val(t, a[2]);
      const z = r.val(t, a[3]);
      const dots = REGI_RUINS_DOTS[type];
      if (!dots) throw new Error(`activate_regi_ruins_dot: bad dot type ${type}`);
      let value = r.getVar(t, dest);
      const i = dots.findIndex(([dx, dz]) => dx === x && dz === z);
      if (i >= 0) {
        r.playFieldSe(SE_JUMP2);
        value |= 1 << i;
      }
      r.setVar(t, dest, value === ALL_DOTS ? RUINS_STATE_ACTIVATED_ALL_DOTS : value);
      return 'continue';
    },

    /** Decomp ScrCmd_CheckShouldShowGhost (the Old Chateau): TRUE when LCRNG_Next() % 101 ≤ the chance (capped at 100). */
    check_should_show_ghost: (t, _c, a) => {
      const chance = Math.min(100, r.int(a[0]));
      r.setVar(t, r.ref(a[1], 'var'), random(101) <= chance ? 1 : 0);
      return 'continue';
    },

    /**
     * Decomp ScrCmd_TurnOnPokedexLanguageDetection (Pokedex_TurnOnLanguageDetection): the Pokédex's foreign-entry
     * page. Its only caller (the Meister, Route 226 house) sets FLAG_ENABLED_POKEDEX_LANGUAGE_DETECTION right after,
     * which is saved and is where the Pokédex reads it; the op itself keeps nothing more.
     */
    turn_on_pokedex_language_detection: () => 'continue',

    /**
     * Decomp ScrCmd_MessageSeenBanlistSpecies (BattleFrontier_MakeSeenBanlistSpeciesMsg): a Frontier receptionist's
     * "not eligible" message. Slot 0 is the number of Pokémon required, slots 1… the banned species the Pokédex has
     * seen; the message is the script bank's `start` + that count. It waits until printed. The facilities are out of
     * Their eligibility checks are stubs that answer "not enough", so this is the decline every
     * receptionist ends on.
     */
    message_seen_banlist_species: (t, c, a) => {
      const bank = a[4];
      if (bank?.kind !== 'int') throw new Error('message_seen_banlist_species: no text bank operand');
      t.slots[0] = String(r.val(t, a[1]));
      // A pack without one of these species (a mod's or the fixture's) cannot have seen it.
      const seen = BATTLE_FRONTIER_BANLIST.filter((n) => {
        const id = r.source('species', n, false);
        return id !== undefined && r.state.pokedex.seen.includes(id);
      });
      seen.forEach((n, i) => (t.slots[i + 1] = plainMarkup(r.speciesName(n))));
      const p = r.showMessage(t, r.bankText(bank.value, r.int(a[0]) + seen.length), r.textSpeed());
      return r.pause(c, () => p.done);
    },
  };
}
