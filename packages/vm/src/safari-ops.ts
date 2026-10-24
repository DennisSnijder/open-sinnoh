/**
 * The Great Marsh's commands: the Safari Game, the quick tram and the gate's binoculars (decomp scrcmd.c
 * ScrCmd_StartEndSafariGame, ScrCmd_InitGreatMarshTram, ScrCmd_MoveGreatMarshTram, ScrCmd_CheckGreatMarshTramLocation,
 * ScrCmd_StartGreatMarshLookout; scrcmd_tv_broadcast.c ScrCmd_GetCurrentSafariGameCaughtNum). Names and behaviour only.
 */
import { JOURNAL_EVENT, journalEvent } from '@opensinnoh/contracts';
import { newGameRecord, saveTvSegment } from '@opensinnoh/contracts';
import type { Handler, Runner } from './runner.ts';

/** Decomp SAFARI_GAME_ACTIVE / SAFARI_GAME_INACTIVE. */
const SAFARI_GAME_ACTIVE = 0;
const SAFARI_GAME_INACTIVE = 1;
/** Decomp ScrCmd_StartEndSafariGame: the balls a game starts with. */
const SAFARI_BALLS = 30;
/** Decomp GREAT_MARSH_TRAM_AT_LOCATION / _NOT_AT_LOCATION, GREAT_MARSH_TRAM_MOVEMENT_CALL / _RIDE. */
export const GREAT_MARSH_TRAM = { atLocation: 5, notAtLocation: 6, call: 3, ride: 4 } as const;

export function safariHandlers(r: Runner): Record<string, Handler> {
  const marsh = () => {
    const g = newGameRecord(r.registries).greatMarsh;
    if (!g) throw new Error('safari: the packs have no Great Marsh (NewGame.greatMarsh)');
    return g;
  };
  const tram = () => {
    const f = r.state.mapFeatures;
    if (f?.kind !== 'great-marsh') throw new Error(`great marsh tram: the map features are ${f?.kind ?? 'none'}, not the Great Marsh's (InitGreatMarshTram first)`);
    return f;
  };
  return {
    /**
     * ScrCmd_StartEndSafariGame: start sets FLAG_SAFARI_GAME_ACTIVE, 30 balls, 0 steps and resets the game's catch
     * count (TVBroadcast_ResetSafariGameData); end clears the flag, balls and steps (the catch count stays for
     * get_current_safari_game_caught_num). The end writes the journal's Safari Game entry; the TV bulletin is the TV's.
     */
    start_end_safari_game: (t, _c, a) => {
      const g = marsh();
      const mode = r.val(t, a[0]);
      if (mode === SAFARI_GAME_ACTIVE) {
        r.setFlag(g.flag, true);
        r.state.safari = { balls: SAFARI_BALLS, steps: 0, caught: 0 };
        // TVBroadcast_ResetSafariGameData.
        r.state.tv.pending.safari = null;
      } else if (mode === SAFARI_GAME_INACTIVE) {
        r.setFlag(g.flag, false);
        r.state.safari = { balls: 0, steps: 0, caught: r.state.safari?.caught ?? 0 };
        // FieldSystem_SaveTVSegment_SafariGameSpecialNewsBulletin: the first catch and the count, if any.
        const first = r.state.tv.pending.safari;
        if (r.state.safari.caught > 0 && first) saveTvSegment(r.state, { kind: 'safari', species: first, caught: Math.min(0xff, r.state.safari.caught) });
        journalEvent(r.registries, r.state, JOURNAL_EVENT.safari);
      } else throw new Error(`start_end_safari_game: mode ${mode}`);
      return 'continue';
    },
    /** ScrCmd_GetCurrentSafariGameCaughtNum: the Pokémon caught in the last game started. */
    get_current_safari_game_caught_num: (t, _c, a) => {
      r.setVar(t, r.ref(a[0], 'var'), r.state.safari?.caught ?? 0);
      return 'continue';
    },
    /** ScrCmd_InitGreatMarshTram (PersistedMapFeatures_InitForGreatMarsh): the tram starts at areas 5 and 6 unless already set. */
    init_great_marsh_tram: () => (r.field.initMapFeatures('great-marsh'), 'continue'),
    /** ScrCmd_CheckGreatMarshTramLocation. */
    check_great_marsh_tram_location: (t, _c, a) => {
      r.setVar(t, r.ref(a[1], 'var'), tram().tram === r.val(t, a[0]) ? GREAT_MARSH_TRAM.atLocation : GREAT_MARSH_TRAM.notAtLocation);
      return 'continue';
    },
    /** ScrCmd_MoveGreatMarshTram: the tram task (called to the player, or ridden with the player aboard); the script waits. */
    move_great_marsh_tram: (t, c, a) => {
      tram();
      const location = r.val(t, a[0]);
      const type = r.val(t, a[1]);
      if (location < 0 || location > 2) throw new Error(`move_great_marsh_tram: location ${location}`);
      if (type !== GREAT_MARSH_TRAM.call && type !== GREAT_MARSH_TRAM.ride) throw new Error(`move_great_marsh_tram: movement ${type}`);
      r.field.moveGreatMarshTram(location, type === GREAT_MARSH_TRAM.call ? 'call' : 'ride');
      return r.pause(c, () => r.field.greatMarshTramDone());
    },
    /** ScrCmd_StartGreatMarshLookout: the binoculars' five views of the marsh; the script waits. */
    start_great_marsh_lookout: (_t, c) => {
      r.field.greatMarshLookout();
      return r.pause(c, () => r.field.greatMarshLookoutDone());
    },
  };
}
