/**
 * The Dance Competition (decomp overlay017; docs/research/contests.md §6) on original tables: the timing, the beat
 * clock, the grading and points, the lead log, the NPC dancers' AI, and the round on the fixture pack.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { setupPokemon, type ContestDanceRoundView, type ContestDanceTables, type ContestSession, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { contestRandom } from '@opensinnoh/services';
import { CONTEST_DANCE_TEXTS, createDanceRound } from './dance.ts';
import { backupStep, classify, DanceClock, DanceLog, danceTiming, gradeStep, leadStep, newDanceAi, planLead, roundStart, sequencerTicks, snap, songTicks, stepPoints, type DanceStep } from './dance-rules.ts';

/** Our own song table: two songs, one measure variant of 8 beats (a 16-tile timeline) and one of 10. */
const TABLES: ContestDanceTables = {
  songs: [
    { sequence: 'test:SEQ_STEP' as Id, bpm: 120, measures: 2, moves: 3, leadIn: 2, gap: 3, windows: [1, 1, 3, 3] },
    { sequence: 'test:SEQ_SKIP' as Id, bpm: 90, measures: 1, moves: 2, leadIn: 3, gap: 1, windows: [0, 2, 2, 4] },
  ],
  choice: Array.from({ length: 4 }, (_, rank) => Array.from({ length: 5 }, () => ({ song: rank < 2 ? 0 : 1, variant: rank < 2 ? 0 : 1 }))),
  variants: [
    { tilemap: 1, beats: 8, tiles: 16 },
    { tilemap: 2, beats: 10, tiles: 20 },
  ],
  aiJitter: [0, 2, 4, 6],
  aiRepeat: [100, 50, 0, 0],
  stage: [
    { x: 100, y: 90, z: -512 },
    { x: 40, y: 30, z: -640 },
    { x: 100, y: 30, z: -640 },
    { x: 160, y: 30, z: -640 },
  ],
  grades: [
    { x: 100, y: 80 },
    { x: 40, y: 20 },
    { x: 100, y: 20 },
    { x: 160, y: 20 },
  ],
  noteRows: [170, 162, 170, 178],
  tints: [
    { color: 0, level: 0 },
    { color: 0x1f, level: 5 },
    { color: 0x7c00, level: 5 },
    { color: 0x3e0, level: 5 },
    { color: 0x3ff, level: 6 },
    { color: 0, level: 5 },
  ],
  shades: [0, 3, 6, 9],
  buttons: [
    { x: 90, y: 0, w: 70, h: 70 },
    { x: 90, y: 100, w: 70, h: 70 },
    { x: 10, y: 50, w: 70, h: 70 },
    { x: 170, y: 50, w: 70, h: 70 },
  ],
};
const T = danceTiming(TABLES.songs[0]!, TABLES, 0);

describe('the song timing (ov17_0223E9A4) and the round starts (ov17_0224C660)', () => {
  it('keeps the beat ×10000 and rounds the measure', () => {
    expect(T).toMatchObject({ beat: 150000, measure: 120, leadIn: 300000, gap: 450000, tickFrames: 3125, halfBeats: 16, width: 128, moves: 3, measures: 2 });
    const slow = danceTiming(TABLES.songs[1]!, TABLES, 1);
    expect(slow).toMatchObject({ beat: 200000, measure: 200, halfBeats: 20, width: 160 });
  });

  it('starts round r after r rounds of measures and r lead-ins and gaps', () => {
    expect([0, 1, 2, 3].map((r) => roundStart(T, r))).toEqual([30, 30 + 240 + 75, 30 + 480 + 150, 30 + 720 + 225]);
  });
});

describe('the beat clock (the sequencer and the VBlank handler ov17_0223E09C)', () => {
  it('counts sequencer ticks from the sound frames played, the first ticking at once', () => {
    expect(sequencerTicks(0, 120)).toBe(0);
    // One tick (1/30 s) is 6 sound frames: 1 + 5 · 120 / 240.
    expect(sequencerTicks(1, 120)).toBe(3);
    expect(sequencerTicks(30, 120)).toBe(Math.floor((240 + (191 - 1) * 120) / 240));
    expect(songTicks(192)).toBe(31);
  });

  it('runs one frame a tick and stays within one of the sequencer, which resyncs it', () => {
    const clock = new DanceClock(T);
    let last = 0;
    for (let n = 0; n < 6000; n++) {
      clock.vblank(n);
      const seq = Math.floor((T.tickFrames * sequencerTicks(n, 120) + 5000) / 10000) + 1;
      expect(Math.abs(clock.frame - seq)).toBeLessThanOrEqual(1);
      expect(clock.frame - last).toBeGreaterThanOrEqual(0);
      expect(clock.frame - last).toBeLessThanOrEqual(2);
      last = clock.frame;
    }
    expect(Math.abs(last - 6000)).toBeLessThan(5);
  });
});

describe('grading (ov17_0224DDE4, ov17_0224DD90, ov17_0224DE54) and points (ov17_0224B20C)', () => {
  it('snaps to the nearest half-beat, the earlier on a tie', () => {
    // Half-beats at 0, 7.5 → 8, 15, 22.5 → 23 frames.
    expect(snap(7, 150000)).toEqual({ d: 1, k: 1 });
    expect(snap(8, 150000)).toEqual({ d: 0, k: 1 });
    expect(snap(4, 150000)).toEqual({ d: 4, k: 0 });
    expect(snap(12, 150000)).toEqual({ d: 3, k: 2 });
    expect(snap(11, 150000)).toEqual({ d: 3, k: 1 });
  });

  it('grades by the windows: excellent, good, miss', () => {
    expect([0, 1, 2, 3, 4].map((d) => classify(d, [1, 1, 3, 3]))).toEqual([
      { grade: 0, sub: 0 },
      { grade: 0, sub: 0 },
      { grade: 1, sub: 2 },
      { grade: 1, sub: 2 },
      { grade: 2, sub: 4 },
    ]);
    expect(classify(2, [0, 2, 2, 4])).toEqual({ grade: 0, sub: 1 });
    expect(classify(4, [0, 2, 2, 4])).toEqual({ grade: 1, sub: 3 });
  });

  it('a lead step is graded on its timing alone; a backup copies the lead step half a measure before', () => {
    const lead = gradeStep(3, 2, 15, T, null, 0, 0);
    expect(lead).toMatchObject({ contestant: 3, code: 3, grade: 0, k: 2, position: 0, last: false, wrong: false });
    expect(stepPoints(lead)).toBe(2);
    const log = new DanceLog();
    log.add(lead);
    // In time on the copy (k 2 + 8): excellent; the wrong direction: a wrong miss; late: good; nothing to copy: a miss.
    expect(gradeStep(0, 2, 75, T, log, 3, 0)).toMatchObject({ grade: 0, k: 10 });
    expect(gradeStep(0, 1, 75, T, log, 3, 0)).toMatchObject({ grade: 2, wrong: true });
    const late = gradeStep(0, 2, 78, T, log, 3, 0);
    expect(late).toMatchObject({ grade: 1, k: 10 });
    expect(stepPoints(late)).toBe(1);
    const none = gradeStep(0, 2, 90, T, log, 3, 2);
    expect(none).toMatchObject({ grade: 2, wrong: false, last: true });
    expect(stepPoints(none)).toBe(0);
    // Out of the windows the direction does not matter.
    expect(gradeStep(0, 1, 79, T, log, 3, 0)).toMatchObject({ grade: 2, wrong: false });
  });

  it('logs every lead step once per half-beat, backups never', () => {
    const log = new DanceLog();
    const step = (k: number, position = 0): DanceStep => ({ contestant: 1, t: 0, code: 1, grade: 2, sub: 4, k, position, last: false, wrong: false });
    log.add(step(2));
    log.add(step(2));
    log.add(step(9, 1));
    log.add(step(4));
    expect(log.entries.map((e) => e.k)).toEqual([2, 4]);
    log.clear();
    expect(log.entries).toEqual([]);
  });
});

describe('the NPC dancers (ov17_0224E930.c)', () => {
  it('a lead plans its moves on whole beats of the first half (never the first), all in one direction but the last', () => {
    for (let seed = 1; seed < 40; seed++) {
      const ai = newDanceAi(2, 0, seed, 0);
      planLead(ai, TABLES, T, 0);
      expect(ai.times).toHaveLength(3);
      // Jitter 0 at level 0: rand % 2 − 1 is −1 (which the unsigned compare turns into the latest, + limit − 1) or 0.
      const limit = Math.floor((Math.floor(T.beat / 4) + 5000) / 10000);
      for (const t of ai.times) expect([0, limit - 1]).toContain(t % 15);
      expect(ai.times.every((t) => t >= 15 && t < 60 + limit)).toBe(true);
      expect(new Set(ai.times).size).toBe(3);
      expect(ai.dirs[0]).toBe(ai.dirs[1]);
      expect(ai.dirs.every((d) => d >= 0 && d < 4)).toBe(true);
    }
  });

  it('at Ultra a lead uses half-beats, never two adjacent ones', () => {
    const slow = danceTiming(TABLES.songs[1]!, TABLES, 1);
    for (let seed = 1; seed < 40; seed++) {
      const ai = newDanceAi(1, 0, seed, 3);
      planLead(ai, TABLES, slow, 2);
      const ks = ai.times.map((t) => snap(t, slow.beat).k);
      expect(ks.every((k) => k > 0 && k < slow.halfBeats / 2)).toBe(true);
      for (let i = 1; i < ks.length; i++) expect(ks[i]! - ks[i - 1]!).toBeGreaterThanOrEqual(2);
    }
  });

  it('a lead dances its plan with the cooldown between steps, and the same seed dances the same', () => {
    const run = (seed: number) => {
      const ai = newDanceAi(3, 0, seed, 1);
      planLead(ai, TABLES, T, 1);
      const steps: DanceStep[] = [];
      for (let t = 1; t < 60; t++) {
        const s = leadStep(ai, t, T);
        if (s) steps.push(s);
      }
      return steps;
    };
    const a = run(5);
    expect(a).toHaveLength(3);
    expect(a.at(-1)!.last).toBe(true);
    for (let i = 1; i < a.length; i++) expect(a[i]!.t - a[i - 1]!.t).toBeGreaterThanOrEqual(T.beat / 10000 - 1);
    expect(run(5)).toEqual(a);
  });

  it('a backup with no spread copies the lead exactly or a frame early; a sloppy one picks wrong directions', () => {
    // Down (code 2): level 0's own slip is up, so a calm copy has no chance of a wrong step.
    const lead: DanceStep[] = [gradeStep(1, 1, 15, T, null, 0, 0), gradeStep(1, 1, 30, T, null, 0, 1), gradeStep(1, 1, 45, T, null, 0, 2)];
    const log = new DanceLog();
    for (const s of lead) log.add(s);
    const copy = (level: number, seed: number) => {
      const ai = newDanceAi(2, 2, seed, level);
      const steps: DanceStep[] = [];
      for (let t = 60; t < 120; t++) {
        const s = backupStep(ai, t, T, log, TABLES, 3);
        if (s) steps.push(s);
      }
      return steps;
    };
    for (let seed = 1; seed < 20; seed++) {
      const steps = copy(0, seed);
      expect(steps.map((s) => s.code)).toEqual([2, 2, 2]);
      expect(steps.every((s) => s.grade === 0)).toBe(true);
    }
    const sloppy = Array.from({ length: 30 }, (_, seed) => copy(3, seed + 1)).flat();
    expect(sloppy.some((s) => s.wrong)).toBe(true);
    expect(sloppy.some((s) => s.grade === 0)).toBe(true);
  });
});

/** Our own wording for the round's messages (the vars as the ROM's: the steps; the player's Pokémon; the leader's trainer and Pokémon). */
const TEXTS: Record<string, string> = {
  DanceCompetition_Text_CompetitionIsReady: 'Ready?{clear}Go!',
  DanceCompetition_Text_PerformStepsAsMainDancer: 'Lead {var 0}!',
  DanceCompetition_Text_EveryoneHereForPracticeContest: 'Practice, {var 0}!',
  DanceCompetition_Text_AnnounceLeadingMon: 'Ahead: {var 0} and {var 1}.',
};

/** Opponents 1–3 wear outfit 1, 2 or 0 for theme 0 (only their `dressUps` are read here). */
const OPPONENTS = [0, 1, 2, 0].map((d) => ({ dressUps: [d] })) as never[];
const DRESS_UPS = [
  { accessories: [], monPriority: 0, backdrop: 0 },
  { accessories: [{ accessory: 7, x: 120, y: 90, priority: 2 }, { accessory: 8, x: 110, y: 140, priority: -1 }], monPriority: 0, backdrop: 3 },
  { accessories: [{ accessory: 9, x: 128, y: 50, priority: 0 }], monPriority: 0, backdrop: 0 },
];

describe('the round on the fixture pack', () => {
  const root = join(import.meta.dirname, '../../../../packs/fixture');
  const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
  const { registries, loaded } = loadGamePacks([pack]);
  const record = [...registries.newGame.values()][0]!;
  const reg = {
    ...registries,
    newGame: new Map([[record.id, { ...record, contests: { opponents: OPPONENTS, judges: [], dressUps: DRESS_UPS, themes: [], playerGfx: { male: 0, female: 0 }, playerSprite: { male: record.id, female: record.id }, dance: TABLES } }]]),
    texts: new Map([...registries.texts, ...CONTEST_DANCE_TEXTS.map((n) => [`fixture:${n}` as Id, { id: `fixture:${n}` as Id, text: TEXTS[n] ?? n.slice(26) }] as const)]),
    sequences: new Map([...registries.sequences, ...TABLES.songs.map((s) => [s.sequence, { id: s.sequence, data: 'fixture:x' as Id, bank: 'fixture:BANK_CHIPTUNE' as Id, volume: 100, channelPriority: 0, playerPriority: 0, player: 'fixture:PLAYER_BGM' as Id, frames: 1500 * 192 / 30 }] as const)]),
  } as unknown as Registries;
  const state = newGameState(record, registries, loaded.order, 1);
  /** The player's photo in an official session (photo coordinates: the Pokémon's centre is (128, 141 + its offset)). */
  const PHOTO = { accessories: [{ accessory: 5, x: 100, y: 60, priority: 1 }], monPriority: 0, backdrop: 0 };
  const species = ['fixture:SPECIES_MOSSLET', 'fixture:SPECIES_SKYLET', 'fixture:SPECIES_BURROWBIT', 'fixture:SPECIES_MOSSLET'] as Id[];
  /** A full contest has outfits, so its Pokémon need pictures (the fixture draws Mosslet, Dripling and Emberkit). */
  const pictured = ['fixture:SPECIES_MOSSLET', 'fixture:SPECIES_DRIPLING', 'fixture:SPECIES_EMBERKIT', 'fixture:SPECIES_MOSSLET'] as Id[];
  const session = (seed: number, mode: 'official' | 'practice' = 'official', kinds = mode === 'official' ? pictured : species): ContestSession => ({
    mode, rank: 0, type: 0, competition: mode === 'official' ? 2 : 5, partySlot: 0, theme: 0, rng: seed, judges: [0, 1, 2], result: null, placement: null, dressUp: mode === 'official' ? PHOTO : null,
    entrants: kinds.map((s, i) => ({ opponent: i ? i : null, trainerName: `T${i}`, gender: 'male', mon: setupPokemon(state, registries, 0, s, 10), fame: 1, gfx: 0, aiLevel: i % 4 })),
    scores: { condition: [10, 10, 10, 10], dressUp: [0, 0, 0, 0], dance: null, acting: null },
  });
  const idle: InputFrame = { held: [], pressed: [], touch: null };

  /** Runs a round with a player who leads on the beats and copies the logged steps (keys or taps), A on messages. */
  function dance(s: ContestSession, by: 'keys' | 'taps') {
    const round = createDanceRound({ session: s, registries: reg, state, host: {} as never, log: { stub: () => {} }, rng: () => contestRandom(s) });
    const r = round as unknown as { measure: { round: number; state: number; start: number } | null; clock: { frame: number } | null; log: DanceLog };
    const dirs: Button[] = ['up', 'down', 'left', 'right'];
    const views: ContestDanceRoundView[] = [];
    let lead = 0;
    let prev = 0;
    let last = -100;
    for (let tick = 0; tick < 4000; tick++) {
      const v = round.view() as ContestDanceRoundView;
      views.push(v);
      let input: InputFrame = v.message && tick % 3 === 0 ? { ...idle, pressed: ['a'] } : idle;
      const m = r.measure;
      if (m && m.state === 2 && r.clock && !v.message) {
        const at = (r.clock.frame - m.start) >>> 0;
        if (at < prev) lead = 0;
        prev = at;
        const sn = snap(at, T.beat);
        let dir: number | null = null;
        if (m.round === 3 && at < T.measure / 2 && sn.d === 0 && sn.k % 2 === 0 && sn.k > 0 && tick - last >= 15 && lead < T.moves) {
          dir = lead++ % 4;
          last = tick;
        }
        if (m.round < 3) for (const e of r.log.entries) if (sn.d === 0 && sn.k === e.k + T.halfBeats / 2) dir = e.code - 1;
        if (dir !== null) input = by === 'keys' ? { ...idle, pressed: [dirs[dir]!] } : { ...idle, tap: `step:${dir}` };
      }
      const out = round.step(input);
      if (out?.kind === 'dance') return { out, views, ticks: tick };
    }
    throw new Error('the dance did not end');
  }

  it('a perfect dancer scores every step, by keys or by taps; the same seed dances the same', () => {
    const keys = dance(session(9), 'keys');
    expect(keys.out.points[0]).toBe(4 * T.measures * T.moves * 2);
    expect(keys.out.points.slice(1).every((p) => p >= 0 && p <= 48)).toBe(true);
    const taps = dance(session(9), 'taps');
    expect(taps.out).toEqual(keys.out);
    expect(dance(session(9), 'keys').views).toEqual(keys.views);
  });

  it('shows the buttons only while a round dances, dimmed while they take no step; the notes to copy and grades appear', () => {
    const { views } = dance(session(3), 'keys');
    expect(views.some((v) => v.buttons?.dim === false)).toBe(true);
    expect(views.some((v) => v.buttons?.dim === true)).toBe(true);
    expect(views[0]!.buttons).toBeNull();
    expect(views.some((v) => v.timeline.notes.some((n) => n.anim === 2))).toBe(true);
    expect(views.some((v) => v.grades.some((g) => g.grade === 0))).toBe(true);
    expect(views.some((v) => v.banner === 'Lead 3!')).toBe(true);
    expect(views.some((v) => v.dancers.some((d) => d.shade === 16))).toBe(true);
  });

  it('dresses the dancers in their visual-round outfits in a full contest, about their centres; a practice dance in none', () => {
    const offset = (id: Id) => registries.pokemonSprites.get(id)!.forms[0]!.front.yOffset;
    const official = dance(session(4), 'keys').views;
    for (const v of [official[0]!, official.at(-1)!]) {
      const by = new Map(v.dancers.map((d) => [d.id, d]));
      // The player's photo; entrant 1 wears outfit 1 (back to front by priority: the −1 behind the Pokémon), 2 outfit 2, 3 none.
      expect(by.get(0)).toMatchObject({ accessories: [{ accessory: 5, x: 100 - 128, y: 60 - 141 - offset(pictured[0]!) }], monAt: 0 });
      expect(by.get(1)).toMatchObject({ accessories: [{ accessory: 8, x: 110 - 128, y: 140 - 141 - offset(pictured[1]!) }, { accessory: 7, x: 120 - 128, y: 90 - 141 - offset(pictured[1]!) }], monAt: 1 });
      expect(by.get(2)!.accessories.map((a) => a.accessory)).toEqual([9]);
      expect(by.get(3)!.accessories).toEqual([]);
    }
    expect(dance(session(4, 'practice'), 'keys').views.every((v) => v.dancers.every((d) => !d.accessories.length && d.monAt === 0))).toBe(true);
  });

  it('an official dance names the leader at the end; a practice does not', () => {
    const official = dance(session(4), 'keys').views.map((v) => v.message?.text).filter(Boolean);
    const practice = dance(session(4, 'practice'), 'keys').views.map((v) => v.message?.text).filter(Boolean);
    expect(official.at(-1)).toMatch(/^Ahead: T\d and /);
    expect(practice.at(-1)).toMatch(/^Practice, /);
  });
});
