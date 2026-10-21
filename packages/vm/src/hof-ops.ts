/**
 * The Hall of Fame commands (decomp src/scrcmd.c; docs/research/hall-of-fame-credits.md §2–3): `clear_game` asks
 * for the record screen and never resumes (the game's clear task saves, plays the credits and resets),
 * `open_pc_hall_of_fame_screen` the PC's viewer, `get_league_victories` the entries ever added,
 * `check_is_hall_of_fame_corrupted` (our history is part of the save: never corrupt), and the Hall of Fame
 * machine's balls.
 */
import type { Handler, Runner } from './runner.ts';

export function hofHandlers(r: Runner): Record<string, Handler> {
  return {
    // Decomp ScrCmd_ClearGame → ClearGame (a field task that ends in OS_ResetSystem).
    clear_game: (_t, c) =>
      r.openApp(c, { app: 'hall-of-fame', mode: 'record' }, () => {
        throw new Error('clear_game: the script never resumes (the game resets after the credits)');
      }),
    // Decomp ScrCmd_OpenPCHallOfFameScreen: the viewer over the saved history; the script waits.
    open_pc_hall_of_fame_screen: (_t, c) => r.openApp(c, { app: 'hall-of-fame', mode: 'pc' }, () => {}),
    // Decomp ScrCmd_GetLeagueVictories: the newest entry's number (the total ever added); returns TRUE (yields).
    get_league_victories: (t, _c, a) => (r.setVar(t, r.ref(a[0], 'var'), r.state.hallOfFame.total), 'yield'),
    check_is_hall_of_fame_corrupted: (t, _c, a) => (r.setVar(t, r.ref(a[0], 'var'), 0), 'continue'),
    // Decomp ScrCmd_PlayHallOfFameHealingAnimation → FieldSystem_PlayHealingAnimation_HallOfFame.
    play_hall_of_fame_healing_animation: (t, c, a) => {
      r.field.healAnimation(r.val(t, a[0]), 'hall-of-fame');
      return r.pause(c, () => r.field.healAnimationDone());
    },
  };
}
