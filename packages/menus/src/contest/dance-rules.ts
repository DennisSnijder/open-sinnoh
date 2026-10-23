/**
 * The Dance Competition's rules (decomp overlay017; docs/research/contests.md §6): the song's timing, the beat clock,
 * the grading of a step, the points, the lead-step log and the NPC dancers' AI. Pure functions and small state objects
 * over the imported `ContestDanceTables`; the round (dance.ts) runs them once per game tick.
 *
 * Frames are game ticks. Quantities the decomp keeps ×10000 (the beat, the lead-in and gap, the sequencer tick) keep that
 * scale here, with the decomp's integer division and rounding.
 */
import { SOUND_FRAME_CYCLES, type ContestDanceSong, type ContestDanceTables } from '@opensinnoh/contracts';

/** The ARM7 clock (GBATEK: 33.513982 MHz): one sound frame lasts SOUND_FRAME_CYCLES of it. */
const ARM7_HZ = 33513982;
/** Game ticks a second (the game's fixed clock). */
const TICKS_PER_SECOND = 30;
/** NNS sequencer: a tick when the tempo counter passes 240 (the counter starts full: the first frame ticks at once). */
const TEMPO_TICK = 240;
/** Sequencer ticks a beat (the decomp's `beat / 48`). */
const TICKS_PER_BEAT = 48;
/** VBlank handler ov17_0223E09C: a lagging frame counter is resynced after this many frames. */
const RESYNC_FRAMES = 18;

/** The song's timing (ov17_0223E9A4), ×10000 where the decomp keeps it so. */
export interface DanceTiming {
  /** Frames a beat ×10000 (unk_18: 1800·10000 / BPM). */
  beat: number;
  /** Frames a measure (unk_1C, rounded). */
  measure: number;
  /** The lead-in and the gap ×10000 (unk_20, unk_24). */
  leadIn: number;
  gap: number;
  /** Frames a sequencer tick ×10000 (unk_28). */
  tickFrames: number;
  bpm: number;
  measures: number;
  moves: number;
  windows: readonly [number, number, number, number];
  variant: number;
  /** Half-beats a measure (ov17_0223F0BC case 4). */
  halfBeats: number;
  /** The timeline's width in px (case 3). */
  width: number;
}

export function danceTiming(song: ContestDanceSong, tables: ContestDanceTables, variant: number): DanceTiming {
  const v = tables.variants[variant]!;
  const beat = Math.floor((1800 * 10000) / song.bpm);
  return {
    beat,
    measure: Math.floor((beat * v.beats + 5000) / 10000),
    leadIn: beat * song.leadIn,
    gap: beat * song.gap,
    tickFrames: Math.floor(beat / TICKS_PER_BEAT),
    bpm: song.bpm,
    measures: song.measures,
    moves: song.moves,
    windows: song.windows,
    variant,
    halfBeats: v.beats * 2,
    width: v.tiles * 8,
  };
}

/** The frame a round (0–3) starts on, counted from the song's start (ov17_0224C660 without the counter). */
export function roundStart(t: DanceTiming, round: number): number {
  return t.measure * t.measures * round + Math.floor(((t.leadIn + t.gap) * round + t.leadIn) / 10000);
}

/**
 * The sequencer ticks the song has played `ticks` game ticks after it started: the sound frames run in that time
 * (ARM7 time, the first at the start), each adding the song's tempo to a counter that ticks at 240.
 */
export function sequencerTicks(ticks: number, bpm: number): number {
  const frames = Math.floor((ticks * ARM7_HZ) / (TICKS_PER_SECOND * SOUND_FRAME_CYCLES));
  return frames === 0 ? 0 : Math.floor((TEMPO_TICK + (frames - 1) * bpm) / TEMPO_TICK);
}

/** A sequence's length in sound frames as game ticks on the beat clock's time base (rounded up). */
export function songTicks(frames: number): number {
  return Math.ceil((frames * TICKS_PER_SECOND * SOUND_FRAME_CYCLES) / ARM7_HZ);
}

/**
 * The dance's frame counter (decomp unk_107C), driven by the song as the VBlank handler ov17_0223E09C drives it: one a
 * frame, re-set to the sequencer's position (+1) when it runs ahead of it, falls two behind, or stays one behind for
 * more than 18 frames. `vblank(n)` runs at the end of the n-th tick since the song started (0 the tick it started on).
 */
export class DanceClock {
  /** unk_107C. */
  frame = 0;
  /** unk_108C: frames the counter has differed from the sequencer by one. */
  private lag = 0;
  constructor(private readonly t: DanceTiming) {}

  vblank(n: number): void {
    this.frame++;
    const seq = Math.floor((this.t.tickFrames * sequencerTicks(n, this.t.bpm) + 5000) / 10000) + 1;
    if (seq === this.frame) {
      this.lag = 0;
      return;
    }
    // u32 arithmetic: a sequencer behind the counter is a huge difference.
    if (this.lag > RESYNC_FRAMES || ((seq - this.frame) >>> 0) > 1) {
      this.frame = seq;
      this.lag = 0;
    } else this.lag++;
  }
}

/** One graded step (decomp UnkStruct_ov17_0224EDE0). */
export interface DanceStep {
  contestant: number;
  /** Frames into the measure. */
  t: number;
  /** 1 up, 2 down, 3 left, 4 right (ov17_0224DD28: direction index + 1). */
  code: number;
  /** 0 excellent, 1 good, 2 miss. */
  grade: 0 | 1 | 2;
  /** 0–4: the windows' sub-grade (4 a miss). */
  sub: number;
  /** The half-beat the step snapped to (u8). */
  k: number;
  /** The dancer's stage position (0 the lead). */
  position: number;
  /** The measure's last step (unk_08_0). */
  last: boolean;
  /** A backup in time but with the wrong direction (unk_08_1). */
  wrong: boolean;
}

/** ov17_0224DDE4: snaps `t` to the nearest half-beat; the earlier one wins a tie. Returns the distance and the half-beat. */
export function snap(t: number, beat: number): { d: number; k: number } {
  const at = t * 10000;
  const half = Math.floor(beat / 2);
  let prev = 0;
  let count = 0;
  let next = 0;
  for (; next < at; next += half) {
    prev = next;
    count++;
  }
  const p = Math.floor((prev + 5000) / 10000);
  const n = Math.floor((next + 5000) / 10000);
  const dp = Math.abs(t - p);
  const dn = Math.abs(t - n);
  return dp <= dn ? { d: dp, k: count - 1 } : { d: dn, k: count };
}

/** ov17_0224DD90: the windows' class and sub-grade of a distance. */
export function classify(d: number, w: DanceTiming['windows']): { grade: 0 | 1 | 2; sub: number } {
  if (d <= w[0]) return { grade: 0, sub: 0 };
  if (d <= w[1]) return { grade: 0, sub: 1 };
  if (d <= w[2]) return { grade: 1, sub: 2 };
  if (d <= w[3]) return { grade: 1, sub: 3 };
  return { grade: 2, sub: 4 };
}

/**
 * ov17_0224DE54: grades a step in direction `dir` (0–3) at `t` frames into the measure. A backup (`log` given) copies
 * the lead's step logged at its half-beat less half a measure: none there is a miss, and a step in time in another
 * direction is a miss marked wrong.
 */
export function gradeStep(contestant: number, dir: number, t: number, timing: DanceTiming, log: DanceLog | null, position: number, steps: number): DanceStep {
  const code = dir + 1;
  const s = snap(t, timing.beat);
  let d = s.d;
  let lead: DanceStep | undefined;
  if (log) {
    const want = s.k - timing.halfBeats / 2;
    lead = log.entries.find((e) => e.k === want);
    if (!lead) d = 0xff;
  }
  let { grade, sub } = classify(d, timing.windows);
  let wrong = false;
  if (lead && grade < 2 && lead.code !== code) {
    grade = 2;
    sub = 4;
    wrong = true;
  }
  return { contestant, t, code, grade, sub, k: s.k & 0xff, position, last: steps >= timing.moves - 1, wrong };
}

/** ov17_0224B20C: a step's points (sub-grades 0–1 two, 2–3 one). */
export const stepPoints = (s: DanceStep): number => (s.sub <= 1 ? 2 : s.sub <= 3 ? 1 : 0);

/** The lead's steps of the measure (decomp unk_1AD4[8]): every lead step, misses too, once per half-beat. */
export class DanceLog {
  readonly entries: DanceStep[] = [];
  /** ov17_0224B20C's write. */
  add(s: DanceStep): void {
    if (s.position !== 0 || this.entries.length >= 8 || this.entries.some((e) => e.k === s.k)) return;
    this.entries.push(s);
  }
  /** ov17_0224BC4C. */
  clear(): void {
    this.entries.length = 0;
  }
}

/** Contest_GetSeededRNGNext: ARNG_Next on the dancer's own seed, high 16 bits. */
function arng(ai: { seed: number }): number {
  ai.seed = (Math.imul(ai.seed, 0x6c078965) + 1) >>> 0;
  return ai.seed >>> 16;
}

/** An NPC dancer's AI state (decomp UnkStruct_ov17_0224E958), reset each measure but for its seed. */
export interface DanceAi {
  contestant: number;
  position: number;
  level: number;
  seed: number;
  /** As lead: the planned steps' frames, directions (0–3) and which are still to dance. */
  times: number[];
  dirs: number[];
  pending: boolean[];
  /** As backup: the planned step (unk_00_val2). */
  plan: { at: number; dir: number } | null;
  cooldown: number;
  steps: number;
}

/** ov17_0224E930. */
export function newDanceAi(contestant: number, position: number, seed: number, level: number): DanceAi {
  return { contestant, position, level, seed, times: [], dirs: [], pending: [], plan: null, cooldown: 0, steps: 0 };
}

/** ov17_0224E958: a new measure. */
export function resetDanceAi(ai: DanceAi): void {
  Object.assign(ai, { times: [], dirs: [], pending: [], plan: null, cooldown: 0, steps: 0 });
}

/** ov17_0224EBE0: the lead's timing spread by level and rank. */
function leadJitter(tables: ContestDanceTables, rank: number, level: number): number {
  const j = tables.aiJitter[level]!;
  return rank === 0 ? j * 2 : rank === 1 ? j : rank === 2 ? Math.floor(j / 2) : Math.floor(j / 3);
}

/**
 * ov17_0224E990: the lead's steps for a measure. Positions in the first half (whole beats at Normal and Great, else
 * half-beats with no two adjacent and an off-beat kept half the time; never the first), a jitter after each (the
 * decomp's unsigned compare turns an early step into the latest the window allows), and the directions (repeated
 * with the rank's chance, the last always drawn).
 */
export function planLead(ai: DanceAi, tables: ContestDanceTables, timing: DanceTiming, rank: number): void {
  const half = timing.halfBeats;
  const limit = timing.variant === 0 ? Math.floor((Math.floor(timing.beat / 4) + 5000) / 10000) : Math.floor((Math.floor(timing.beat / 6) + 5000) / 10000);
  const whole = rank <= 1;
  const slots = whole ? Math.floor(half / 4) : Math.floor(half / 2);
  const spacing = whole ? timing.beat : Math.floor(timing.beat / 2);
  // Slots past the cleared ones read as free (the decomp reads one past its array there).
  const used: number[] = Array.from({ length: slots + 2 }, () => 0);
  let count = 0;
  for (;;) {
    const s = arng(ai) % slots;
    if (s === 0 || used[s]) continue;
    if (!whole) {
      if (s === slots - 1 && used[s - 1]) continue;
      if (used[s - 1] || used[s + 1]) continue;
      if (s & 1 && (arng(ai) & 0xff) < 128) continue;
    }
    used[s] = 1;
    if (++count >= timing.moves) break;
  }
  ai.times = [];
  for (let s = 0; s < half / 2; s++) if (used[s]) ai.times.push(Math.floor((s * spacing + 5000) / 10000));
  const j = leadJitter(tables, rank, ai.level);
  for (let i = 0; i < timing.moves; i++) {
    const base = ai.times[i]!;
    let t = base + (arng(ai) % (2 + j)) - (1 + Math.floor(j / 2));
    if (t < 0) t = 0;
    if ((t - base) >>> 0 >= limit) t = base + limit - 1;
    ai.times[i] = t;
  }
  ai.pending = ai.times.map(() => true);
  const repeat = tables.aiRepeat[rank]!;
  ai.dirs = [arng(ai) % 4];
  for (let i = 1; i < timing.moves; i++) ai.dirs.push(i < timing.moves - 1 && repeat > arng(ai) % 100 ? ai.dirs[i - 1]! : arng(ai) % 4);
}

/** ov17_0224EDE0: the lead dances its next planned step once its frame has come. */
export function leadStep(ai: DanceAi, t: number, timing: DanceTiming): DanceStep | null {
  if (ai.position !== 0 || ai.steps >= timing.moves) return null;
  if (ai.cooldown > 0) {
    ai.cooldown--;
    return null;
  }
  const i = ai.pending.indexOf(true);
  if (i < 0 || ai.times[i]! > t) return null;
  const step = gradeStep(ai.contestant, ai.dirs[i]!, t, timing, null, ai.position, ai.steps);
  ai.pending[i] = false;
  ai.steps++;
  ai.cooldown = Math.floor(timing.beat / 10000) - 2;
  return step;
}

/** ov17_0224EC24: the backup's timing spread (its spacing terms are computed and then overwritten). */
function backupJitter(tables: ContestDanceTables, rank: number, level: number): number {
  const j = tables.aiJitter[level]!;
  return rank <= 1 ? j * 2 : rank === 2 ? j + Math.floor(j / 2) : j;
}

/** ov17_0224ECC4: the backup's extra chance (%) of a wrong direction. */
function mistakeChance(rank: number, level: number, k: number, prevK: number, code: number, prevCode: number): number {
  let m = code === [1, 2, 4, 3][level] ? 3 : 0;
  if (prevCode !== 0 && code !== prevCode) m += 8;
  if (prevK !== -1) {
    if ((k & 1) !== (prevK & 1)) m += 2;
    if (k - prevK >= 8) m += 5;
  }
  return rank <= 1 ? m * 2 : rank === 2 ? m + Math.floor(m / 2) : m;
}

/**
 * ov17_0224EE90: a backup copies the lead's next logged step: it aims at the lead's half-beat in the second half with a
 * jitter, and picks another direction with the chance of its spread plus its mistake chance.
 */
export function backupStep(ai: DanceAi, t: number, timing: DanceTiming, log: DanceLog, tables: ContestDanceTables, rank: number): DanceStep | null {
  const lead = log.entries[ai.steps];
  if (ai.position === 0 || ai.steps >= timing.moves || !lead) return null;
  if (ai.cooldown > 0) {
    ai.cooldown--;
    return null;
  }
  if (!ai.plan) {
    const prev = ai.steps === 0 ? null : log.entries[ai.steps - 1]!;
    const j = backupJitter(tables, rank, ai.level);
    const m = mistakeChance(rank, ai.level, lead.k, prev ? prev.k : -1, lead.code, prev ? prev.code : 0);
    let at = Math.floor((lead.k * Math.floor(timing.beat / 2) + 5000) / 10000);
    const off = (arng(ai) % (2 + j)) - (1 + Math.floor(j / 2));
    at = off + at < 0 ? 0 : at + off;
    let dir: number;
    if (arng(ai) % 100 < j + m) {
      do dir = arng(ai) % 4;
      while (dir + 1 === lead.code);
    } else dir = lead.code - 1;
    ai.plan = { at, dir };
  }
  if (ai.plan.at > t - Math.floor(timing.measure / 2)) return null;
  const step = gradeStep(ai.contestant, ai.plan.dir, t, timing, log, ai.position, ai.steps);
  ai.plan = null;
  ai.steps++;
  ai.cooldown = Math.floor(timing.beat / 10000) - 2;
  return step;
}
