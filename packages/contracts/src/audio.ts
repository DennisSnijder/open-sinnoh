/**
 * Audio (contracts 0.18.0; docs/research/audio.md). Two seams:
 * - `AudioHost`: the game's sound system (decomp sound_system.c, sound.c, sound_playback.c, field_bgm.c),
 *   which the VM, the world, battles and menus call. It is deterministic and runs headless: it knows what
 *   plays from the records (sequence lengths in `Sequence.frames`), never from the audio clock. Waits on
 *   sound (fanfares, cries, sound effects, fades) are counted in game ticks.
 * - `AudioOutput`: where the host sends what to play (the browser's AudioWorklet synth). Output only:
 *   nothing comes back, so game timing never depends on it. Headless games have none.
 *
 * Records (registries `sequences`, `soundBanks`, `waveArchives`, `soundPlayers`, `cries`) keep the DS
 * sound data procedural: sequences are SSEQ bytecode, banks are instrument tables, wave archives are
 * the SWAR samples (PCM8/PCM16/IMA-ADPCM). Nothing is pre-rendered.
 */
import type { Id } from '@opensinnoh/core';
import type { AssetRef } from './records.ts';

/** One sound frame: the DS sound library updates every 2728 × 64 ARM7 cycles (≈ 5.2095 ms). */
export const SOUND_FRAME_CYCLES = 2728 * 64;
/** One 30 Hz game tick: two vblanks of 355 × 263 dots at 6 ARM7 cycles each (≈ 33.43 ms). */
export const GAME_TICK_CYCLES = 2 * 6 * 355 * 263;

/** Sound frames → whole game ticks, rounded up (the game sees a sequence end on the next tick). */
export function soundFramesToTicks(frames: number): number {
  return Math.ceil((frames * SOUND_FRAME_CYCLES) / GAME_TICK_CYCLES);
}

/**
 * A sound player (SDAT PLAYER, decomp PLAYER_*): sequences at once and the hardware channels it may take. */
export interface SoundPlayer {
  id: Id;
  /** The decomp PLAYER_* number: 0 PV (cries), 1 FIELD, 2 ME (fanfares), 3–6 SE_1–4, 7 BGM. The game picks the handle by it. */
  sourceIndex: number;
  maxSequences: number;
  /** Bit n = hardware channel n (0–15). */
  channels: number;
}

/** A sequence (SDAT SEQ, decomp SEQ_*): BGM, fanfares, sound effects and the cry sequence. */
export interface Sequence {
  id: Id;
  sourceIndex?: number;
  /** The SSEQ event bytecode (the DS sequence format, docs/research/audio.md §2). */
  data: AssetRef;
  bank: Id;
  /** Initial player volume, 0–127. */
  volume: number;
  /** Added to every track's priority when allocating channels. */
  channelPriority: number;
  playerPriority: number;
  player: Id;
  /**
   * Sound frames (2728 × 64 ARM7 cycles, ≈ 5.21 ms) until every track has reached its end, computed by
   * the sequencer at import; null when the sequence never ends (it loops). The game times waits on it.
   */
  frames: number | null;
}

/** One key range of an instrument (SBNK; drum sets and key splits have several). */
export interface InstrumentRegion {
  /** Keys played by this region, inclusive. */
  low: number;
  high: number;
  type: 'pcm' | 'psg' | 'noise';
  /** pcm: the bank's wave archive slot (0–3) and the wave in that archive. */
  archive?: number;
  wave?: number;
  /** psg: duty cycle 0–7 (high for (duty + 1) / 8 of the period). */
  duty?: number;
  /** The key that plays the wave at its own rate (psg and noise: at C4). */
  baseKey: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  /** 0–127, 64 = centre. */
  pan: number;
}

/** An instrument bank (SDAT BANK / SBNK). `instruments[program]`: null = no instrument. */
export interface SoundBank {
  id: Id;
  sourceIndex?: number;
  /** Up to 4 wave archive slots. */
  waveArchives: (Id | null)[];
  instruments: (InstrumentRegion[] | null)[];
}

/** A wave archive (SDAT WAVEARC): the SWAR file. */
export interface WaveArchive {
  id: Id;
  sourceIndex?: number;
  data: AssetRef;
}

/**
 * A Pokémon's cry (decomp Sound_PlayPokemonCry): the cry sequence played with the species' bank. Keyed
 * by species id. `forms` maps a form number to its own bank (Shaymin Sky); other forms use `bank`.
 */
export interface Cry {
  id: Id;
  sequence: Id;
  bank: Id;
  /** Sound frames the plain cry plays (the cry sequence with this bank, measured at import). */
  frames: number;
  forms?: Record<string, { bank: Id; frames: number }>;
}

/**
 * Cry variations (decomp enum PokemonCryMod, Sound_PlayPokemonCryEx): pitch, length and the echo
 * (chorus) by use. `pokedex` is the plain cry; `pokedex-chorus` adds the echo.
 */
export type CryMod =
  | 'normal'
  | 'half'
  | 'field-event'
  | 'faint'
  | 'pinch'
  | 'pinch-half'
  | 'mid-move'
  | 'howl-1'
  | 'howl-2'
  | 'hyper-voice-2'
  | 'uproar-2'
  | 'pokedex'
  | 'pokedex-chorus';

/** What the VM, world, battles and menus ask of the game's sound system. Every method is deterministic. */
export interface AudioHost {
  /** Sound_PlayBGM: start a BGM now (field BGM on the field player, others on the BGM player). Null stops. */
  playBgm(seq: Id | null): void;
  /** Sound_StopBGM(current): stop the current BGM. */
  stopBgm(): void;
  /** Sound_FadeOutBGM: move the BGM volume to `volume` (0–127) over `ticks`. */
  fadeOutBgm(volume: number, ticks: number): void;
  /** Sound_FadeInBGM(127, ticks, from zero). */
  fadeInBgm(ticks: number): void;
  /** Sound_IsFadeActive: a fade started by the two above (or a BGM change) is still running. */
  fadeActive(): boolean;
  /** The BGM playing now (Sound_GetCurrentBGM), or null. */
  currentBgm(): Id | null;
  /** FieldBGM_GetForMapHeader: the zone's BGM for the time of day (and the special BGM override rules). */
  fieldBgm(zone: Id): Id | null;
  /** FieldBGM_GetEffective: surfing music, then the special BGM, over the zone's BGM. */
  effectiveBgm(zone: Id): Id | null;
  /**
   * FieldBGM_TryFadeOut(mode 1): unless the BGM is fixed or already `seq`, the BGM fades out over 60 ticks
   * and `seq` starts (on the bike it fades in over 30). Zone connections and the bike use it.
   */
  fadeToBgm(seq: Id | null): void;
  /** FieldBGM_SetOverride (`set_special_bgm`, the bike): null clears it. */
  setSpecialBgm(seq: Id | null): void;
  /** Sound_SetBGMFixed: while fixed, zone changes do not change the BGM. */
  setBgmFixed(fixed: boolean): void;
  /** Sound_SetBGMPlayerPaused. */
  setBgmPaused(player: 'field' | 'bgm', paused: boolean): void;
  /** Sound_SwapBGM: pause the field BGM and play another (trainer eyes-meet themes). */
  swapBgm(seq: Id): void;
  /** Sound_PlayEffect. */
  playSe(seq: Id): void;
  /** Sound_StopEffect. */
  stopSe(seq: Id): void;
  /** Sound_IsEffectPlaying: a sequence plays on that sound effect's player. */
  sePlaying(seq: Id): boolean;
  /** Sound_IsSequencePlaying (`is_sequence_playing`): any sequence plays on its player. */
  sequencePlaying(seq: Id): boolean;
  /** Sound_SetInitialVolumeForSequence: the volume (0–127) of that sequence's player. */
  setPlayerVolume(seq: Id, volume: number): void;
  /**
   * 0.28.1. Sound_SetPlayerVolume(PLAYER_FIELD, volume) (`set_player_volume`, Route 224's tablet scene): the field
   * player's own volume (0–127, NNS_SndPlayerSetPlayerVolume), kept for every sequence it plays until set again.
   */
  setFieldVolume(volume: number): void;
  /** Sound_PlayFanfare: pauses the BGM and plays the fanfare on the ME player. */
  playFanfare(seq: Id): void;
  /**
   * Sound_IsBGMPausedByFanfare (`wait_fanfare`): true while the fanfare plays and for 15 checks after;
   * each call counts one check. When it returns false the BGM has resumed.
   */
  waitFanfare(): boolean;
  /** Spear Pillar's two panned cry handles (0.27.20): on stops the cries and alternates handles; off restores one. */
  setDualCry(enabled: boolean): void;
  /** Sound_PlayPokemonCryEx (default `normal`). `pan` −127..127 is halved to the channel pan, `volume` 0–127. */
  playCry(species: Id, form?: number, mod?: CryMod, pan?: number, volume?: number): void;
  /** Sound_IsPokemonCryPlaying. */
  cryPlaying(): boolean;
}

/**
 * One instruction to the synth. `handle` names an NNS sound handle (decomp SoundHandleType: 'field-bgm',
 * 'bgm', 'fanfare', 'se-1'..'se-4', 'cry', 'echo'); each plays one sequence at a time and starting
 * another stops it. Tick counts are the game's 30 Hz ticks (one NNS_SndMain call each).
 */
export type AudioCommand =
  /** Start `seq` on `handle` (with `bank` instead of the sequence's own: cries). */
  | { op: 'start'; handle: string; seq: Id; bank?: Id }
  /** Stop, after a fade to silence over `ticks` (0 = now, the notes release). */
  | { op: 'stop'; handle: string; ticks: number }
  /** NNS_SndPlayerMoveVolume: the handle's volume to `volume` (0–127) over `ticks`. */
  | { op: 'volume'; handle: string; volume: number; ticks: number }
  /** NNS_SndPlayerSetInitialVolume (0–127). */
  | { op: 'initial-volume'; handle: string; volume: number }
  /** 0.28.1. NNS_SndPlayerSetPlayerVolume: the volume (0–127) of every sequence on the sound player `player` (a `soundPlayers` id), now and later. */
  | { op: 'player-volume'; player: Id; volume: number }
  | { op: 'pause'; handle: string; paused: boolean }
  /** NNS_SndPlayerSetTrackPitch on every track: 1/64 semitones. */
  | { op: 'pitch'; handle: string; pitch: number }
  /** NNS_SndPlayerSetTrackPan on every track: −128..127. */
  | { op: 'pan'; handle: string; pan: number }
  /** Stop every handle now. */
  | { op: 'stop-all' };

export interface AudioOutput {
  send(command: AudioCommand): void;
}
