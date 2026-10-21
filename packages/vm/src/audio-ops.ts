/**
 * The sound commands (decomp scrcmd_sound.c, scrcmd.c's bike music, scrcmd_trainer.c's eyes-meet music)
 * on the game's sound system (contracts `AudioHost`, 0.18.0). Waits poll the host once per tick, as the
 * decomp's ScriptContext_Pause checks do: the host is deterministic, so replays keep their timing.
 * Sequence operands are the decomp's numbers (`sequences` sourceIndex); 0 is SEQ_NONE.
 */
import type { Id } from '@opensinnoh/core';
import type { Handler, Runner, Thread } from './runner.ts';

/** decomp SEQ_BICYCLE (sourceIndex) and SEQ_BICYCLE_sseq_1 = SEQ_PL_BICYCLE (set_cycling_bgm). */
export const SEQ_BICYCLE = 1152;
export const SEQ_PL_BICYCLE = 1189;
/** decomp PLAYER_FIELD / PLAYER_BGM (set_bgm_player_paused). */
const PLAYER_FIELD = 1;
const PLAYER_BGM = 7;
const MAX_SPECIES = 493;

export function audioHandlers(r: Runner): Record<string, Handler> {
  const audio = r.audio;
  const val = (t: Thread, a: Parameters<Runner['val']>[1]) => r.val(t, a);
  const dest = (t: Thread, a: Parameters<Runner['ref']>[0], v: number) => r.setVar(t, r.ref(a, 'var'), v);
  /** The sequence of a decomp number; a pack without it plays nothing (logged). */
  const seq = (n: number): Id | null => {
    if (n === 0) return null;
    const id = r.source('sequences', n, false);
    if (!id) r.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
    return id ?? null;
  };
  const native = (id: Id | null) => (id === null ? 0 : (r.registries.sequences.get(id)?.sourceIndex ?? 0));
  const species = (n: number) => r.source('species', n);

  return {
    play_se: (t, _c, a) => {
      const s = seq(val(t, a[0]));
      if (s) audio.playSe(s);
      return 'continue';
    },
    stop_se: (t, _c, a) => {
      const s = seq(val(t, a[0]));
      if (s) audio.stopSe(s);
      return 'continue';
    },
    wait_se: (t, c, a) => {
      const s = seq(val(t, a[0]));
      if (!s) return 'continue';
      return r.pause(c, () => !audio.sePlaying(s));
    },
    play_cry: (t, _c, a) => {
      // Sound_PlayPokemonCry: SPECIES_NONE and numbers past MAX_SPECIES play Bulbasaur's cry.
      const n = val(t, a[0]);
      audio.playCry(species(n > 0 && n <= MAX_SPECIES ? n : 1)!);
      return 'continue';
    },
    wait_cry: (_t, c) => r.pause(c, () => !audio.cryPlaying()),
    play_fanfare: (t, _c, a) => {
      const s = seq(val(t, a[0]));
      if (s) audio.playFanfare(s);
      return 'continue';
    },
    // Sound_IsBGMPausedByFanfare: each check counts down the 15-check tail, then the BGM resumes.
    wait_fanfare: (_t, c) => r.pause(c, () => !audio.waitFanfare()),
    play_music: (t, _c, a) => {
      const s = seq(val(t, a[0]));
      if (s) audio.playBgm(s);
      return 'continue';
    },
    stop_music: () => (audio.stopBgm(), 'continue'),
    play_default_music: () => {
      const bgm = audio.fieldBgm(r.state.player.zone);
      if (bgm) audio.playBgm(bgm);
      return 'continue';
    },
    set_special_bgm: (t, _c, a) => (audio.setSpecialBgm(seq(val(t, a[0]))), 'continue'),
    fade_out_bgm: (t, c, a) => {
      audio.fadeOutBgm(val(t, a[0]), val(t, a[1]));
      return r.pause(c, () => !audio.fadeActive());
    },
    fade_in_bgm: (t, c, a) => {
      audio.fadeInBgm(val(t, a[0]));
      return r.pause(c, () => !audio.fadeActive());
    },
    set_bgm_player_paused: (t, _c, a) => {
      const player = val(t, a[0]);
      if (player !== PLAYER_FIELD && player !== PLAYER_BGM) return 'continue';
      audio.setBgmPaused(player === PLAYER_FIELD ? 'field' : 'bgm', val(t, a[1]) !== 0);
      return 'continue';
    },
    // Sound_SetBGM(SOUND_SCENE_FIELD): a BGM-player sequence started at once.
    set_bgm: (t, _c, a) => {
      const s = seq(val(t, a[0]));
      if (s) audio.playBgm(s);
      return 'continue';
    },
    set_bgm_fixed: (t, _c, a) => (audio.setBgmFixed(val(t, a[0]) !== 0), 'continue'),
    set_initial_volume_for_sequence: (t, _c, a) => {
      const s = seq(val(t, a[0]));
      if (s) audio.setPlayerVolume(s, val(t, a[1]));
      return 'continue';
    },
    is_sequence_playing: (t, _c, a) => {
      const s = seq(val(t, a[0]));
      dest(t, a[1], s && audio.sequencePlaying(s) ? 1 : 0);
      return 'continue';
    },
    // ScrCmd_SetCyclingBGM: only the override (Cycling Road gates play it on the next map load).
    set_cycling_bgm: () => (audio.setSpecialBgm(seq(SEQ_PL_BICYCLE)), 'continue'),
    get_current_bgm: (t, _c, a) => (dest(t, a[0], native(audio.currentBgm())), 'continue'),
  };
}

/** ScrCmd_SetPlayerBike's music: the bike BGM as the override, faded to (or back to the zone's). */
export function bikeMusic(r: Runner, ride: boolean): void {
  const bike = ride ? (r.source('sequences', SEQ_BICYCLE, false) ?? null) : null;
  r.audio.setSpecialBgm(bike);
  r.audio.fadeToBgm(ride ? bike : r.audio.effectiveBgm(r.state.player.zone));
}
