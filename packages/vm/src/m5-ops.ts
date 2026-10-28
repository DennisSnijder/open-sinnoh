/**
 * The M5 commands: the Eterna City statue scene, the Galactic
 * Eterna Building fog and the blackout warp; Riley's collision, the Unown count, the orb flag and the library TV. Each follows its decomp handler (names and behaviour only);
 * 'continue' where the decomp returns FALSE, 'yield' where it returns TRUE.
 */
import { DISTRIBUTION_EVENT_MAGIC, DISTRIBUTION_EVENT_VAR } from '@opensinnoh/contracts';
import type { Handler, Runner } from './runner.ts';

/** Decomp OVERWORLD_WEATHER_26 (`weathers` sourceIndex): the dark blue-grey fog ScrCmd_2CD selects. */
export const WEATHER_GALACTIC_FOG = 26;
/** Decomp SPECIES_UNOWN. */
const SPECIES_UNOWN = 201;

export function m5Handlers(r: Runner): Record<string, Handler> {
  /**
   * The Eterna City statue scene (decomp ov5_021F6454.c ScrCmd_32D, 32E, 331, 332). On the DS a map object
   * whose terrain height is unknown (MAP_OBJ_STATUS_12: its map chunk is not loaded, the DS streams 2×2
   * chunks around the player) is not drawn; status 13 draws it anyway. 32D sets 13 on every object but the
   * player and puts the status-12 ones at the player's height; 331 sets 13 on locals 32 (Cyrus) and 2 and
   * puts them at 9 tiles (144 units); 32E and 332 clear 13 again. Our world loads every chunk of the matrix,
   * so no object ever has an unknown height: every object is already drawn on its terrain, and Eterna's
   * terrain under locals 32 and 2 is 144 units (tests/integration/m5-ops.rom.test.ts). Nothing to change.
   */
  const heightOverride: Handler = () => 'continue';
  return {
    scr_cmd_32d: heightOverride,
    scr_cmd_32e: heightOverride,
    scr_cmd_331: heightOverride,
    scr_cmd_332: heightOverride,

    /**
     * Decomp ScrCmd_2CD (scrcmd.c, sub_020462C0): starts a task that switches the field weather effect to 26
     * once the weather manager exists, and yields. It runs from TeamGalacticEternaBuilding4F's on-load
     * script, which the DS runs on every field init (warps, battles, continue), so the fog is always up in
     * 4F. The DS leaves the saved weather (CLEAR, the header's) alone; we set `GameState.weather` (FieldHost
     * has no drawn-only weather), which looks the same: our on-load runs on warps only, and the fog stays
     * across battles and saves as on the DS. No script in 4F reads the weather, and a warp out resets it.
     */
    scr_cmd_2cd: () => (r.field.setWeather(r.source('weathers', WEATHER_GALACTIC_FOG)!), 'yield'),

    /**
     * Decomp ScrCmd_SetBlackOutWarpId (FieldOverworldState_SetBlackOutWarpId): the blackout spawn becomes
     * spawn `warpId` (decomp sSpawnLocations, 1-based). `GameState.blackOut` names the zone of that spawn.
     */
    set_black_out_warp_id: (t, _c, a) => {
      const spawn = r.val(t, a[0]);
      const zone = [...r.registries.zones.values()].find((z) => z.blackOut?.spawn === spawn);
      if (!zone) throw new Error(`set_black_out_warp_id: no blackout spawn ${spawn}`);
      r.state.blackOut = zone.id;
      return 'continue';
    },

    /**
     * Decomp ScrCmd_2B6 → sub_02062D80 (Iron Island B2F, after Riley's tag battle and his egg): 1 clears the
     * object's MAP_OBJ_STATUS_18, which the follow type set, so the player and others collide with Riley again;
     * any other value sets it.
     */
    /** Decomp ScrCmd_StartLibraryTV: the library TV app (FieldSystem_StartLibraryTV); the script's ReturnToField waits for it. */
    start_library_tv: (_t, c) => r.openApp(c, { app: 'library-tv' }, () => {}),

    scr_cmd_2b6: (t, _c, a) => {
      r.field.setObjectPassThrough(r.val(t, a[0]), r.val(t, a[1]) !== 1);
      return 'continue';
    },

    /**
     * Decomp ScrCmd_GetUnownFormsSeenCount (Pokedex_NumFormsSeen_Unown): how many Unown forms the Pokédex has
     * recorded (the Route 214 gate's man and the Ruin Maniac's tunnel check for all 26).
     */
    get_unown_forms_seen_count: (t, _c, a) => {
      const seen = r.state.pokedex.forms[r.source('species', SPECIES_UNOWN)!] ?? [];
      r.setVar(t, r.ref(a[0], 'var'), new Set(seen.map((f) => f.form)).size);
      return 'continue';
    },

    /**
     * Decomp ScrCmd_TrySetUnusedCollectedOrbFlag: for the Adamant and Lustrous Orbs it sets the Underground's
     * `collectedOrbUnused`, which Platinum never reads (underground.c: in Diamond and Pearl it changed the
     * sphere odds). Nothing to keep.
     */
    try_set_unused_collected_orb_flag: () => 'continue',

    /**
     * Decomp ScrCmd_WaitABPadPress (ScriptContext_CheckABPadPress): waits for A, B or any d-pad press. Unlike
     * wait_button the d-pad does not turn the player and X does nothing (the Distortion World and Spear Pillar
     * acknowledgements). No arrow shows (ScriptView.waitsForAB).
     */
    wait_ab_pad_press: (_t, c) => {
      r.ui.abWait = true;
      return r.pause(c, (input) => {
        const done = input.pressed.some((b) => b === 'a' || b === 'b' || b === 'up' || b === 'down' || b === 'left' || b === 'right');
        if (done) r.ui.abWait = false;
        return done;
      });
    },

    /**
     * Decomp ScrCmd_CheckDistributionEvent (SystemVars_CheckDistributionEvent): TRUE when the event's var holds
     * its magic number. The Poké Mart deliveryman's Mystery Gift (`mystery_gift_give`) and the dev-only events
     * (contracts `grantDevEvent`) set the ROM's own var.
     */
    check_distribution_event: (t, _c, a) => {
      const n = r.int(a[0]);
      const magic = (DISTRIBUTION_EVENT_MAGIC as readonly number[])[n];
      if (magic === undefined) throw new Error(`check_distribution_event: bad event ${n}`);
      r.setVar(t, r.ref(a[1], 'var'), r.getVar(t, r.source('vars', DISTRIBUTION_EVENT_VAR + n)!) === magic ? 1 : 0);
      return 'continue';
    },
  };
}
