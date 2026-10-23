/**
 * The Dance Competition's tables from overlay 17 (decomp ov17_0223DAD0.c, ov17_0224E930.c, ov17_0224A0FC.c,
 * ov17_022492DC.c; docs/research/contests.md §6). The caller verifies each table's bytes by SHA-1; this reads them and
 * fails on a value the round cannot use.
 */
import { CONTEST_RANKS, CONTEST_TYPES, type ContestDanceTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Reader } from '@opensinnoh/nds';

/** Bytes of a song row (UnkStruct_ov17_02253084), a choice (two u32) and a variant (UnkStruct_ov17_02252FC4). */
export const DANCE_SONG_SIZE = 12;
export const DANCE_CHOICE_SIZE = 8;
export const DANCE_VARIANT_SIZE = 4;
/** Rows of the per-level and per-rank AI tables, of the stage (CONTEST_NUM_PARTICIPANTS) and of the step buttons. */
export const DANCE_LEVELS = 4;
export const DANCE_POSITIONS = 4;
export const DANCE_BUTTONS = 4;
/** Unk_ov17_022546DC: none, the four step codes, a miss. */
export const DANCE_TINTS = 6;

export interface DanceTableBytes {
  songs: Uint8Array;
  choice: Uint8Array;
  variants: Uint8Array;
  aiJitter: Uint8Array;
  aiRepeat: Uint8Array;
  /** Unk_ov17_022546F4: s16 x, y, depth per stage position. */
  stage: Uint8Array;
  /** Unk_ov17_022546CC: s16 x, y per stage position. */
  grades: Uint8Array;
  /** Unk_ov17_022549BC: u8 y per stage position. */
  noteRows: Uint8Array;
  /** Unk_ov17_022546DC: {u16 colour, u16 level} per tint. */
  tints: Uint8Array;
  /** Unk_ov17_022549C0: u8 shade per place. */
  shades: Uint8Array;
  /** Unk_ov17_02254564: TouchScreenRect {u8 top, bottom, left, right} per button, then the 0xFF terminator row. */
  buttons: Uint8Array;
}

/** `sequence`: the sequence id of an SDAT sequence index (throws for one the import does not have). */
export function readContestDance(b: DanceTableBytes, sequence: (sdatIndex: number) => Id): ContestDanceTables {
  const songs = Array.from({ length: b.songs.length / DANCE_SONG_SIZE }, (_, i) => {
    const r = new Reader(b.songs.subarray(i * DANCE_SONG_SIZE, (i + 1) * DANCE_SONG_SIZE));
    const windows: [number, number, number, number] = [r.u8(8), r.u8(9), r.u8(10), r.u8(11)];
    if (windows.some((w, k) => k > 0 && w < windows[k - 1]!)) throw new Error(`dance song ${i}: grading windows ${windows.join(',')} are not in order`);
    const song = { sequence: sequence(r.u16(0)), bpm: r.u16(2), measures: r.u8(4), moves: r.u8(5), leadIn: r.u8(6), gap: r.u8(7), windows };
    if (!song.bpm || !song.measures || !song.moves) throw new Error(`dance song ${i}: ${song.bpm} BPM, ${song.measures} measures, ${song.moves} moves`);
    return song;
  });
  const variants = Array.from({ length: b.variants.length / DANCE_VARIANT_SIZE }, (_, i) => {
    const r = new Reader(b.variants.subarray(i * DANCE_VARIANT_SIZE, (i + 1) * DANCE_VARIANT_SIZE));
    const v = { tilemap: r.u16(0), beats: r.u8(2), tiles: r.u8(3) };
    if (!v.beats || !v.tiles || v.tiles > 32) throw new Error(`dance variant ${i}: ${v.beats} beats, a ${v.tiles}-tile timeline`);
    return v;
  });
  // The lead's steps must fit the slots its AI draws from (ov17_0224E990: half a measure's beats less the first).
  for (const [i, s] of songs.entries()) if (variants.some((v) => s.moves > v.beats / 2 - 1)) throw new Error(`dance song ${i}: ${s.moves} moves do not fit a measure`);
  const c = new Reader(b.choice);
  const choice = CONTEST_RANKS.map((_, rank) =>
    CONTEST_TYPES.map((_, type) => {
      const o = (rank * CONTEST_TYPES.length + type) * DANCE_CHOICE_SIZE;
      const pick = { song: c.u32(o), variant: c.u32(o + 4) };
      if (pick.song >= songs.length || pick.variant >= variants.length) throw new Error(`dance choice rank ${rank} type ${type}: song ${pick.song}, variant ${pick.variant}`);
      return pick;
    }),
  );
  const st = new Reader(b.stage);
  const stage = Array.from({ length: DANCE_POSITIONS }, (_, i) => ({ x: st.i16(i * 6), y: st.i16(i * 6 + 2), z: st.i16(i * 6 + 4) }));
  const buttons = Array.from({ length: DANCE_BUTTONS }, (_, i) => {
    const [top, bottom, left, right] = b.buttons.subarray(i * 4, i * 4 + 4);
    if (bottom! <= top! || right! <= left!) throw new Error(`dance button ${i}: rect ${top},${bottom},${left},${right}`);
    return { x: left!, y: top!, w: right! - left!, h: bottom! - top! };
  });
  if (b.buttons[DANCE_BUTTONS * 4] !== 0xff) throw new Error('dance buttons: no terminator row');
  const g = new Reader(b.grades);
  const grades = Array.from({ length: DANCE_POSITIONS }, (_, i) => ({ x: g.i16(i * 4), y: g.i16(i * 4 + 2) }));
  const tr = new Reader(b.tints);
  const tints = Array.from({ length: DANCE_TINTS }, (_, i) => ({ color: tr.u16(i * 4), level: tr.u16(i * 4 + 2) }));
  if (tints.some((x) => x.level > 16 || x.color > 0x7fff)) throw new Error('dance tints: a level past 16 or a colour past RGB555');
  return { songs, choice, variants, aiJitter: [...b.aiJitter], aiRepeat: [...b.aiRepeat], stage, grades, noteRows: [...b.noteRows], tints, shades: [...b.shades], buttons };
}
