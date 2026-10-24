/**
 * The TV schedule (docs/research/tv.md; decomp ov6_022465FC.c TVBroadcast_GetScheduledProgramID, TVBroadcast_GetProgramType,
 * TVBroadcast_LoadProgramSegmentIDsFromNarc): arc/tv.narc member 0 holds a programme id per quarter hour from 5:00 and per
 * day (Monday first), member 1 a 12-byte row per programme: its type, then up to eleven segment ids ended by 0.
 */
import type { TvTables } from '@opensinnoh/contracts';
import { readNarc } from '@opensinnoh/nds';

/** Decomp TV_BROADCAST_PROGRAMS_PER_HOUR × HOURS_PER_DAY, RTC_WEEK_MAX, TV_BROADCAST_MAX_PROGRAM, TV_BROADCAST_MAX_PROGRAM_SEGMENTS. */
const SLOTS = 96;
const DAYS = 7;
const PROGRAMS = 9;
const SEGMENTS = 11;
/** Decomp TV_PROGRAM_TYPE_MAX and each type's segment count (TV_PROGRAM_TYPE_*_NUM_SEGMENTS). */
const SEGMENT_COUNTS = [0, 19, 26, 11, 17, 8];

export function readTvTables(narc: Uint8Array): TvTables {
  const m = readNarc(narc);
  const [sched, rows] = [m[0], m[1]];
  if (!sched || sched.length < SLOTS * DAYS || !rows || rows.length !== PROGRAMS * (1 + SEGMENTS)) throw new Error(`tv.narc: members of ${m.map((x) => x.length).join(', ')} bytes`);
  const schedule = Array.from({ length: SLOTS }, (_, slot) => [...sched.subarray(slot * DAYS, slot * DAYS + DAYS)]);
  const bad = schedule.flat().find((p) => p < 1 || p > PROGRAMS);
  if (bad !== undefined) throw new Error(`tv.narc: programme ${bad} in the schedule`);
  const programs = Array.from({ length: PROGRAMS }, (_, i) => {
    const row = rows.subarray(i * (1 + SEGMENTS), (i + 1) * (1 + SEGMENTS));
    const type = row[0]!;
    const end = row.indexOf(0, 1);
    const segments = [...row.subarray(1, end < 0 ? undefined : end)];
    if (type < 1 || type >= SEGMENT_COUNTS.length || segments.some((s) => s > SEGMENT_COUNTS[type]!)) throw new Error(`tv.narc: programme ${i + 1} of type ${type} lists ${segments.join(' ')}`);
    return { type, segments };
  });
  return { schedule, programs };
}
