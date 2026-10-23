/**
 * The Dance Competition (decomp overlay017: DanceCompetition_Main and its states ov17_0223DAD0.c, the commands and the
 * per-measure task ov17_0224CFB8.c, the presentation ov17_0224A0FC.c, the AI ov17_0224E930.c; docs/research/contests.md
 * §6), one game tick a DS frame:
 *
 * 1. the MC's intro, the dressing-room BGM fading out, the player's dancer hopping;
 * 2. the song (`ContestDanceTables.choice[rank][type]`) starts and drives the beat clock (dance-rules.ts `DanceClock`);
 * 3. four rounds, each led by one dancer (contestants 3, 2, 1, then the player), of `measures` measures: the lead
 *    steps in the first half of a measure, the three backups copy in the second; each step is graded by the frame
 *    it lands on and scores 2, 1 or 0; between rounds the dancers rotate (the lead goes to the back);
 * 4. the song ends, the dancers are shaded by place, the dressing-room BGM returns, and (official contests) the MC
 *    names the leader of the visual and dance rounds. The outcome is each contestant's points (decomp unk_04).
 *
 * Each tick runs in the DS frame's order: the app's frame (one draw of the contest LCRNG, then the states and
 * commands), the per-measure task (the player's step gate, the NPCs), the steps' points (contestant order), the
 * presentation, and the VBlank that moves the beat clock. Steps are graded on the tick their input arrives.
 */
import { isShiny, monGender, type Id } from '@opensinnoh/core';
import { CONTEST_COMPETITION, dexOf, type AppMessage, type ContestDanceRoundView, type ContestDanceTables, type ContestDancerView, type ContestRound, type ContestRoundContext, type InputFrame } from '@opensinnoh/contracts';
import { contestTables, roundWeights, visualRaw } from '@opensinnoh/services';
import { plainPages, plainText } from '../strings.ts';
import { backupStep, DanceClock, DanceLog, danceTiming, gradeStep, leadStep, newDanceAi, planLead, resetDanceAi, roundStart, songTicks, stepPoints, type DanceAi, type DanceStep, type DanceTiming } from './dance-rules.ts';

/** TEXT_BANK_CONTEST_DANCE_COMPETITION names the round reads. */
const TEXT = {
  ready: 'DanceCompetition_Text_CompetitionIsReady',
  practice: 'DanceCompetition_Text_EveryoneHereForPracticeContest',
  lead: 'DanceCompetition_Text_PerformStepsAsMainDancer',
  copy: 'DanceCompetition_Text_CopyPokemonBeforeYou',
  leading: 'DanceCompetition_Text_AnnounceLeadingMon',
  grades: ['DanceCompetition_Text_Excellent', 'DanceCompetition_Text_Good', 'DanceCompetition_Text_Miss'],
  /** ov17_022498F4: the up button says JUMP for a Pokémon that jumps, else UP. */
  labels: ['DanceCompetition_Text_Jump', 'DanceCompetition_Text_Up', 'DanceCompetition_Text_Front', 'DanceCompetition_Text_Left', 'DanceCompetition_Text_Right'],
} as const;
export const CONTEST_DANCE_TEXTS = [TEXT.ready, TEXT.practice, TEXT.lead, TEXT.copy, TEXT.leading, ...TEXT.grades, ...TEXT.labels];

/** Sound effects by name; the BGM and the message box's confirm by SDAT index (SEQ_CON_TEST, SEQ_SE_CONFIRM). */
const SE = {
  open: 'SEQ_SE_DP_CON_007',
  turn: 'SEQ_SE_DP_CON_019',
  combo: ['SEQ_SE_DP_CON_021', 'SEQ_SE_DP_CON_022', 'SEQ_SE_DP_CON_023'],
  good: 'SEQ_SE_DP_CON_024',
  wrong: 'SEQ_SE_DP_CON_026',
  miss: 'SEQ_SE_DP_CARD10',
  beat: 'SEQ_SE_DP_CON_027_3',
  end: 'SEQ_SE_DP_CON_028',
  rotate: 'SEQ_SE_DP_CON_030',
  flash: 'SEQ_SE_DP_CON_031',
} as const;
export const CONTEST_DANCE_SOUNDS = [SE.open, SE.turn, ...SE.combo, SE.good, SE.wrong, SE.miss, SE.beat, SE.end, SE.rotate, SE.flash];
const DRESSING_ROOM = 1135;
const CONFIRM = 1500;

/** The stage's depths (ov17_0224B06C): the back row's −640 draws at 0xC0/0x100, the lead's −512 at full size. */
const Z_BACK = -0x200 - 0x80;
const Z_FRONT = -0x200;
/** ov17_0224C49C/ov17_0224C54C: the beat ball's floor. */
const BALL_Y = 0x12 * 8;
/**
 * ov17_02249DA0: ticks of a button's press animation until it ends (a task added from a higher-priority one runs from
 * the next frame: its three steps copy characters on ticks 1, 4 and 7 and it ends on tick 10). The gate takes no step
 * until then.
 */
const PRESS_TICKS = 10;
/** ov17_0224A8D4: a grade rises 4 px a tick for 5 ticks, then stays 15. */
const GRADE_RISE = 5;
const GRADE_TICKS = GRADE_RISE + 15;
/** ov17_0224CFA8: Diglett and Dugtrio sway instead of jumping. */
const NO_JUMP = [50, 51];

interface Dancer {
  id: number;
  /** Stage position (0 the lead). */
  pos: number;
  /** ×256 px and depth (decomp unk_04/08/0C). */
  x: number;
  y: number;
  z: number;
  /** The front picture's offset (Pokemon_DPSpriteYOffset). */
  yOffset: number;
  /** Turn in 1/65536 turns ×256 (ov22_0225B0E4). */
  turn: number;
  shade: number;
  jumps: boolean;
  /** ov17_0224B528: steps still to dance (codes), and the step being danced. */
  queue: number[];
  move: Move | null;
  /** The last step's position, last-step flag and the dancer's points (unk_21–23, shared by the queue). */
  movePos: number;
  moveLast: boolean;
  movePoints: number;
  /** The hearts flying from it (ov17_0224AD70, 16 at most). */
  hearts: Heart[];
}

interface Move {
  code: number;
  frame: number;
  /** Fixed point ×256: the start, the displaced point, and the per-tick speeds. */
  x0: number;
  y0: number;
  x: number;
  y: number;
  v: number[];
  phase: number;
  turn: number;
}

interface Heart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  anim: 0 | 1;
}

interface Note {
  x: number;
  y: number;
  code: number;
  anim: 0 | 1 | 2;
  born: number;
}

interface Grade {
  pos: number;
  grade: 0 | 1 | 2;
  x: number;
  y: number;
  age: number;
}

/** The measure task's state (ov17_0224D710). */
interface Measure {
  round: number;
  lead: number;
  state: 0 | 1 | 2 | 3;
  /** unk_1084: the frame the measure started on. */
  start: number;
  done: number;
  playerSteps: number;
  flashed: boolean;
  half: boolean;
}

type Gen = Generator<void, void, void>;

export function createDanceRound(ctx: ContestRoundContext): ContestRound {
  return new DanceRound(ctx);
}

class DanceRound implements ContestRound {
  readonly kind = 'dance' as const;
  readonly placeholder = false;
  private readonly tables: ContestDanceTables;
  private readonly timing: DanceTiming;
  private readonly song: Id;
  private readonly ns: string;
  private readonly flow: Gen;
  private input: InputFrame = { held: [], pressed: [], touch: null };
  private tick = 0;
  private result: number[] | null = null;

  private readonly dancers: Dancer[];
  /** unk_A3C.unk_05: the contestant at each stage position. */
  private readonly positions = [3, 2, 1, 0];
  private readonly points = [0, 0, 0, 0];
  private readonly ai: DanceAi[] = [];
  private readonly log = new DanceLog();
  private clock: DanceClock | null = null;
  /** Ticks since the song started (the clock's VBlank count). */
  private songTicks = -1;
  private measure: Measure | null = null;
  private readonly pending: (DanceStep | null)[] = [null, null, null, null];

  /** The player's step gate (ov17_0224DC1C) and the button layout (0 idle, 1 the steps). */
  private gate = { state: 0, cooldown: 0 };
  private layout = 0;
  private dim = true;
  private press: { dir: number; left: number } | null = null;

  /** The combo counters (unk_A19, A1D, A21, A25–27), per contestant where they are. */
  private readonly streak = [0, 0, 0, 0];
  private readonly clean = [0, 0, 0, 0];
  private readonly misses = [0, 0, 0, 0];
  private backups = [0, 0, 0];

  private notes: Note[] = [];
  private grades: Grade[] = [];
  private fill = 0;
  private ball = false;
  private cursor: number | null = null;
  private flash: { half: 0 | 1; level: number } | null = null;
  private tint = 0;
  private white = 0;
  private fade = 16;
  private banner: string | null = null;
  private message: { pages: string[]; page: number } | null = null;
  private idle = false;

  constructor(private readonly ctx: ContestRoundContext) {
    this.tables = contestTables(ctx.registries).dance;
    const s = ctx.session;
    const pick = this.tables.choice[s.rank]![s.type]!;
    const song = this.tables.songs[pick.song]!;
    this.timing = danceTiming(song, this.tables, pick.variant);
    this.song = song.sequence;
    this.ns = [...ctx.registries.newGame.values()][0]!.id.split(':')[0]!;
    const missing = CONTEST_DANCE_TEXTS.filter((n) => !ctx.registries.texts.has(this.id(n)));
    if (missing.length) throw new Error(`contest dance: the pack has no text ${missing.join(', ')}`);
    this.dancers = s.entrants.map((e, id) => {
      const species = ctx.registries.species.get(e.mon.species);
      const pics = ctx.registries.pokemonSprites.get(e.mon.species);
      const pos = this.positions.indexOf(id);
      const yOffset = (pics?.forms[e.mon.form] ?? pics?.forms[0])?.front.yOffset ?? 0;
      const at = this.tables.stage[pos]!;
      return {
        id, pos, x: at.x * 256, y: (at.y + yOffset) * 256, z: at.z, yOffset, turn: 0, shade: 0,
        jumps: !NO_JUMP.includes(species?.sourceIndex ?? 0),
        queue: [], move: null, movePos: 0, moveLast: false, movePoints: 0, hearts: [],
      };
    });
    this.flow = this.run();
    this.se(SE.open);
  }

  private id(name: string): Id {
    return `${this.ns}:${name}` as Id;
  }

  private text(name: string, ...slots: string[]): string {
    return plainText(this.ctx.registries.texts.get(this.id(name))!.text, slots);
  }

  private pages(name: string, ...slots: string[]): string[] {
    return plainPages(this.ctx.registries.texts.get(this.id(name))!.text, slots);
  }

  private se(name: string): void {
    const sound = this.ctx.host.sound;
    if (!sound) return;
    const id = this.id(name);
    if (this.ctx.registries.sequences.has(id)) sound.playSe(id);
    else this.ctx.log.stub('audio:sequence-missing', `no sequence ${id} in the packs: not played`);
  }

  private bySource(n: number): Id | null {
    return [...this.ctx.registries.sequences.values()].find((q) => q.sourceIndex === n)?.id ?? null;
  }

  private monName(id: number): string {
    const e = this.ctx.session.entrants[id]!;
    return e.mon.nickname ?? this.ctx.registries.species.get(e.mon.species)!.name;
  }

  // ------------------------------------------------------------------ the tick

  step(input: InputFrame): { kind: 'dance'; points: number[] } | null {
    if (this.result) throw new Error('contest dance: stepped after its outcome');
    this.input = input;
    // DanceCompetition_Main draws from the contest LCRNG every frame.
    this.ctx.rng();
    this.flow.next();
    if (this.press && this.press.left > 0) this.press.left--;
    this.measureTask();
    this.pointTasks();
    this.presentation();
    if (this.clock) this.clock.vblank(++this.songTicks);
    this.tick++;
    return this.result ? { kind: 'dance', points: this.result } : null;
  }

  /** The app's states (Unk_ov17_02253050) as one sequence; each `yield` ends a frame. */
  private *run(): Gen {
    const s = this.ctx.session;
    const sound = this.ctx.host.sound;
    const rooms = this.bySource(DRESSING_ROOM);
    if (sound && rooms && sound.currentBgm() !== rooms) sound.playBgm(rooms);
    // The circle fade-in.
    while (this.fade > 0) {
      this.fade = Math.max(0, this.fade - 2);
      yield;
    }
    // ov17_0223E8AC: the MC (practice: its own lines, the player's Pokémon in them).
    const practice = s.mode === 'practice';
    yield* this.say(practice ? this.pages(TEXT.practice, this.monName(0)) : this.pages(TEXT.ready));
    // Command 3 (ov17_0224D41C): the dressing-room BGM fades out over 30 frames, the stage lights, the player's dancer hops.
    sound?.fadeOutBgm(0, 30);
    for (let i = 0; i <= 30; i++) yield;
    sound?.stopBgm();
    this.se(SE.turn);
    for (let i = 0; i <= 30; i++) yield;
    yield* this.hop(this.dancers[0]!);
    // ov17_0223E9A4 and command 11: the song and the beat clock start.
    this.clock = new DanceClock(this.timing);
    this.songTicks = -1;
    sound?.playBgm(this.song);
    yield;
    for (let round = 0; round < 4; round++) {
      // ov17_0223EBB0: each NPC's AI seed for the round.
      const seeds = [1, 2, 3].map(() => this.ctx.rng());
      this.ai.length = 0;
      for (const c of [1, 2, 3]) this.ai[c] = newDanceAi(c, this.positions.indexOf(c), seeds[c - 1]!, s.entrants[c]!.aiLevel);
      // Command 7 (ov17_0224E4A8): the dancers start their idle dance; the touch screen shows the buttons, dimmed.
      for (const d of this.dancers) d.pos = this.positions.indexOf(d.id);
      this.idle = true;
      this.layout = 1;
      this.dim = true;
      yield;
      // Command 5: the round's measures.
      this.measure = { round, lead: this.positions[0]!, state: 0, start: 0, done: 0, playerSteps: 0, flashed: false, half: false };
      while (this.measure) yield;
      // Command 8 (ov17_0224E584): the dancers finish their steps and stop on the beat; the buttons go.
      while (this.dancers.some((d) => d.move || d.queue.length)) yield;
      yield* this.untilBeat();
      this.idle = false;
      this.layout = 0;
      this.press = null;
      if (round < 3) yield* this.rotate();
      // ov17_0223ED9C: the lead goes to the back.
      this.positions.push(this.positions.shift()!);
    }
    // Command 12 (ov17_0224E86C): the clock stops; the song plays out; the dancers are shaded by place.
    this.clock = null;
    const frames = this.ctx.registries.sequences.get(this.song)?.frames ?? null;
    if (frames === null) throw new Error(`contest dance: the song ${this.song} has no length`);
    const end = songTicks(frames);
    while (this.songTicks < end) {
      this.songTicks++;
      yield;
    }
    yield* this.shadeByPlace();
    for (let i = 0; i <= 60; i++) yield;
    if (sound && rooms) sound.playBgm(rooms);
    this.se(SE.open);
    // ov17_0223EEB8: the points, and the leader of the visual and dance rounds by their normalised sum (official).
    if (s.competition === CONTEST_COMPETITION.full) yield* this.say(this.pages(TEXT.leading, s.entrants[this.leader()]!.trainerName, this.monName(this.leader())));
    // Command 4, the fade out.
    while (this.fade < 16) {
      this.fade = Math.min(16, this.fade + 2);
      yield;
    }
    this.result = [...this.points];
  }

  /** A message until A on its last page (the DS prints it; pages wait for A). */
  private *say(pages: string[]): Gen {
    this.message = { pages, page: 0 };
    for (;;) {
      yield;
      const m = this.message;
      if (this.input.pressed.includes('a') || this.input.pressed.includes('b') || this.input.tap === 'next') {
        const confirm = this.bySource(CONFIRM);
        if (confirm) this.ctx.host.sound?.playSe(confirm);
        if (m.page + 1 < m.pages.length) m.page++;
        else break;
      }
    }
    this.message = null;
  }

  /** ov17_0224C718 (two hops) or ov17_0224C7B8 (a sway for Diglett and Dugtrio): the player's dancer before the song. */
  private *hop(d: Dancer): Gen {
    if (d.jumps) {
      const base = d.y;
      for (let n = 0; n < 2; n++) {
        let v = 0x500;
        do {
          d.y -= v;
          v -= 0x200;
          yield;
        } while (d.y < base);
        d.y = base;
      }
      return;
    }
    const base = d.x;
    for (let angle = 0, turns = 0; turns <= 5; angle += 50) {
      d.x = base + Math.trunc(Math.sin((angle * Math.PI) / 180) * 4) * 256;
      if (angle + 50 >= 360) turns++;
      yield;
    }
    d.x = base;
  }

  /** ov17_0224BE64: the idle dance stops at the bottom of a beat. */
  private *untilBeat(): Gen {
    const at = () => ((this.clock?.frame ?? this.songTicks) * 10000) % this.timing.beat;
    let last = at();
    for (;;) {
      yield;
      const now = at();
      if (now < last) return;
      last = now;
    }
  }

  /**
   * Command 6 (ov17_0224DFF8, ov17_0224E1F4): the stage darkens, the dancers grey out and move one place (the lead
   * leaves to the back), the next round's instruction shows, then the stage lights up again.
   */
  private *rotate(): Gen {
    for (let i = 1; i <= 4; i++) {
      for (const d of this.dancers) d.shade = i * 4;
      this.fade = Math.min(6, i * 2);
      yield;
    }
    const n = Math.floor((Math.floor(this.timing.gap / 10000) * 40) / 100);
    const moves = this.dancers.map((d) => this.moveTo(d, d.pos === 0 ? 3 : d.pos - 1, n));
    const next = this.positions[1]!;
    this.banner = next === 0 ? this.text(TEXT.lead, String(this.timing.moves)) : this.text(TEXT.copy);
    this.se(SE.rotate);
    let busy = true;
    while (busy) {
      yield;
      busy = moves.map((m) => m.next().done).includes(false);
    }
    for (let i = 2; i >= 0; i--) {
      this.fade = i * 2;
      yield;
    }
  }

  /** ov17_0224E1F4: one dancer to stage position `to` over `n` frames; to or from the lead's place it goes round the side. */
  private *moveTo(d: Dancer, to: number, n: number): Generator<void, void, void> {
    const at = this.tables.stage[to]!;
    const goal = { x: at.x * 256, y: (at.y + d.yOffset) * 256, z: at.z * 256 };
    let z = d.z * 256;
    const around = to === 0 || to === 3;
    const half = Math.floor(n / 2);
    let vx: number;
    let vy: number;
    let vz: number;
    if (around) {
      vx = Math.trunc(((to === 0 ? -80 : 256 + 100) * 256 - d.x) / half);
      vy = 0;
      vz = 0;
    } else {
      vx = Math.trunc((goal.x - d.x) / n);
      vy = Math.trunc((goal.y - d.y) / n);
      vz = Math.trunc((goal.z - z) / n);
    }
    for (let k = 1; ; k++) {
      d.x += vx;
      d.y += vy;
      z += vz;
      if (around && k === half) {
        d.x = to === 0 ? -100 * 256 : (at.x + 80) * 256;
        d.y = goal.y;
        z = goal.z;
        const rest = n - k - 1;
        vx = Math.trunc((goal.x - d.x) / rest);
        vy = 0;
        vz = 0;
      } else if (!around && d.x < goal.x) d.x = goal.x;
      if (k >= n) {
        d.x = goal.x;
        d.y = goal.y;
        d.z = at.z;
        d.pos = to;
        return;
      }
      d.z = Math.trunc(z / 256);
      yield;
    }
  }

  /** ov17_0224CE28: the dancers grey by place over 30 frames (ties share a place). */
  private *shadeByPlace(): Gen {
    const order = [0, 1, 2, 3];
    const pts = [...this.points];
    for (let i = 0; i < 3; i++)
      for (let j = 3; j > i; j--)
        if (pts[j - 1]! < pts[j]!) {
          [pts[j - 1], pts[j]] = [pts[j]!, pts[j - 1]!];
          [order[j - 1], order[j]] = [order[j]!, order[j - 1]!];
        }
    const target = [0, 0, 0, 0];
    let shade = this.tables.shades[0]!;
    order.forEach((id, place) => {
      if (place > 0 && pts[place] !== pts[place - 1]) shade = this.tables.shades[place]!;
      target[id] = place === 0 ? this.tables.shades[0]! : shade;
    });
    for (const d of this.dancers) d.shade = 0;
    for (let f = 1; f <= 30; f++) {
      for (const d of this.dancers) d.shade = Math.min(target[d.id]!, Math.floor((f * ((target[d.id]! << 8) / 30)) / 256));
      yield;
    }
  }

  /** ov17_0223EEB8: the contestant leading the visual and dance rounds by their normalised points (ties: the lower id). */
  private leader(): number {
    const s = this.ctx.session;
    const weights = roundWeights(s.competition);
    const norm = (raw: number[], w: number) => {
      const top = Math.max(...raw);
      // The decomp divides by the top score with no guard; a round nobody scored in counts 0 here.
      const f = top > 0 ? Math.floor(w / top) : 0;
      return raw.map((v) => Math.floor((v * f + 50) / 100));
    };
    const scores = s.scores;
    if (!scores?.dressUp) throw new Error('contest dance: the leader needs the visual round');
    const visual = norm(visualRaw(scores, s.rank), weights[0]);
    const dance = norm(this.points, weights[1]);
    const sum = visual.map((v, i) => v + dance[i]!);
    const ids = [0, 1, 2, 3];
    for (let i = 0; i < 3; i++)
      for (let j = 3; j > i; j--)
        if (sum[j - 1]! < sum[j]!) {
          [sum[j - 1], sum[j]] = [sum[j]!, sum[j - 1]!];
          [ids[j - 1], ids[j]] = [ids[j]!, ids[j - 1]!];
        }
    return ids[0]!;
  }

  // ------------------------------------------------------------------ the measure task (ov17_0224D710)

  private measureTask(): void {
    const m = this.measure;
    const clock = this.clock;
    if (!m || !clock) return;
    const timing = this.timing;
    const playerLead = m.lead === 0;
    const t = (clock.frame - m.start) >>> 0;
    const half = t < timing.measure >> 1 ? 0 : 1;
    switch (m.state) {
      case 0: {
        this.log.clear();
        this.planLeader(m);
        this.ball = true;
        this.cursor = -1;
        this.tint = 0;
        this.banner = playerLead ? this.text(TEXT.lead, String(timing.moves)) : this.text(TEXT.copy);
        m.state = 1;
        return;
      }
      case 1: {
        const start = roundStart(timing, m.round);
        if (start - clock.frame > 0) return;
        this.banner = null;
        m.start = start;
        if (playerLead) this.flashHalf(m, 0);
        this.spotlight(m.lead, 0);
        m.state = 2;
        return;
      }
      case 2:
        break;
      case 3: {
        if (this.gate.state === 2) {
          if (this.press?.left === 0) this.gate.state = 1;
          return;
        }
        this.notes = [];
        this.fill = 0;
        this.ball = false;
        this.cursor = null;
        this.tint = 0;
        this.flash = null;
        if (this.layout !== 0) this.dim = true;
        this.measure = null;
        return;
      }
    }
    this.fill = Math.min(timing.width, Math.floor((t * timing.width) / timing.measure));
    this.cursor = Math.floor((t * timing.width) / timing.measure) - 1 + (256 - timing.width) / 2;
    if (t >= timing.measure) {
      m.done++;
      m.start = clock.frame;
      m.flashed = false;
      m.half = false;
      for (let c = 0; c < 4; c++) {
        this.clean[c] = 0;
        this.misses[c] = 0;
      }
      this.backups = [0, 0, 0];
      m.playerSteps = 0;
      for (const ai of this.ai.slice(1)) resetDanceAi(ai);
      this.notes = [];
      this.log.clear();
      this.planLeader(m);
      this.tint = 0;
      if (m.done >= timing.measures) {
        for (const d of this.dancers) d.shade = 0;
        m.state = 3;
        return;
      }
      this.spotlight(m.lead, 0);
      if (playerLead) this.flashHalf(m, 0);
      return;
    }
    const quarter = Math.floor(Math.floor(Math.floor(timing.beat / 2) / 2) / 10000);
    const player = this.dancers[0]!;
    if (playerLead) {
      const open = half === 0 && m.playerSteps < timing.moves && t < Math.floor(timing.measure / 2) - quarter;
      const dir = this.gateStep(open);
      if (dir !== null) this.pending[0] = gradeStep(0, dir, t, timing, null, player.pos, m.playerSteps++);
    } else {
      const open = half === 1 && m.playerSteps < timing.moves && t < timing.measure - quarter;
      const dir = this.gateStep(open);
      if (open) this.flashHalf(m, 1);
      if (dir !== null) this.pending[0] = gradeStep(0, dir, t, timing, this.log, player.pos, m.playerSteps++);
    }
    const rank = this.ctx.session.rank;
    for (const ai of this.ai.slice(1)) {
      const s = ai.position === 0 ? (half === 0 ? leadStep(ai, t, timing) : null) : half === 1 ? backupStep(ai, t, timing, this.log, this.tables, rank) : null;
      if (s) this.pending[ai.contestant] = s;
    }
    if (half === 1 && !m.half) {
      this.spotlight(m.lead, 1);
      m.half = true;
    }
    // ov17_0224C8E8: the stage takes each lead step's colour again when its copy is due.
    if (half === 1)
      for (const e of this.log.entries)
        if (Math.floor(((e.k + timing.halfBeats / 2) * Math.floor(timing.beat / 2)) / 10000) === t) {
          this.tintFor(e);
          break;
        }
  }

  /** ov17_0224E990 for the round's lead when it is an NPC. */
  private planLeader(m: Measure): void {
    const ai = this.ai[m.lead];
    if (ai) planLead(ai, this.tables, this.timing, this.ctx.session.rank);
  }

  /** ov17_0224C9F0 (once a measure): the player's half of the timeline flashes white, with SE CON_031. */
  private flashHalf(m: Measure, half: 0 | 1): void {
    if (m.flashed) return;
    m.flashed = true;
    this.flash = { half, level: 10 };
    this.se(SE.flash);
  }

  /** ov17_0224CDC0: the dancing side is lit (the lead in the first half, the backups in the second), with SE CON_019. */
  private spotlight(lead: number, half: 0 | 1): void {
    for (const d of this.dancers) d.shade = (d.id === lead) === (half === 0) ? 0 : 16;
    this.se(SE.turn);
  }

  /** ov17_0224DC1C: the player's step gate. `open`: the step window is open. Returns the step's direction (0–3). */
  private gateStep(open: boolean): number | null {
    const g = this.gate;
    let refused = false;
    let dir: number | null = null;
    if (open && g.cooldown > 0 && --g.cooldown === 0) this.dim = false;
    switch (g.state) {
      case 0:
        if (open) {
          g.cooldown = 0;
          this.dim = false;
          g.state = 1;
        } else refused = true;
        break;
      case 1:
        if (!open || g.cooldown > 0) {
          refused = true;
          break;
        }
        dir = this.readStep();
        if (dir === null) refused = true;
        else {
          g.cooldown = Math.floor(this.timing.beat / 10000) - 2;
          g.state = 2;
          this.press = { dir, left: PRESS_TICKS };
        }
        break;
      case 2:
        if (this.press?.left === 0) {
          if (g.cooldown > 0) this.dim = true;
          g.state = 1;
        }
        break;
    }
    if (!open && refused && this.layout !== 0) {
      this.dim = true;
      g.state = 0;
    }
    return dir;
  }

  /** ov17_02249760: a touched button first, then the keys (A/→, B/↓, X/↑, Y/←). */
  private readStep(): number | null {
    const tap = /^step:([0-3])$/.exec(this.input.tap ?? '');
    if (tap) return Number(tap[1]);
    const p = this.input.pressed;
    if (p.includes('a') || p.includes('right')) return 3;
    if (p.includes('b') || p.includes('down')) return 1;
    if (p.includes('x') || p.includes('up')) return 0;
    if (p.includes('y') || p.includes('left')) return 2;
    return null;
  }

  // ------------------------------------------------------------------ the steps' points (ov17_0224B20C)

  private pointTasks(): void {
    for (let c = 0; c < 4; c++) {
      const s = this.pending[c];
      if (!s) continue;
      this.pending[c] = null;
      this.score(s);
    }
  }

  private score(s: DanceStep): void {
    const c = s.contestant;
    this.points[c]! += stepPoints(s);
    if (s.position === 0) this.log.add(s);
    if (s.grade === 0) {
      this.streak[c]!++;
      this.clean[c]!++;
    } else {
      this.streak[c] = 0;
      this.clean[c] = 0;
    }
    if (s.grade === 2) this.misses[c]!++;
    if (s.position > 0) this.backups[s.grade]!++;
    // ov17_0224A7E0: the grade pops up over the dancer's place (the lead shares the first slot).
    const slot = s.position === 0 ? 0 : s.position - 1;
    this.grades = this.grades.filter((g) => (g.pos === 0 ? 0 : g.pos - 1) !== slot);
    const at = this.tables.grades[s.position]!;
    this.grades.push({ pos: s.position, grade: s.grade, x: at.x, y: at.y, age: 0 });
    this.addNote(s);
    const d = this.dancers[c]!;
    d.queue.push(s.code);
    d.movePos = s.position;
    d.moveLast = s.last;
    d.movePoints = this.points[c]!;
    if (s.grade !== 2 && this.points[c]! > 0) this.hearts(d, s.position);
    if (s.position === 0) this.tintFor(s);
    const moves = this.timing.moves;
    if (s.position === 0 && s.last) {
      if (this.clean[c] === moves) this.white = 16;
      else if (this.misses[c] === 0) this.white = 16;
    } else if (s.position > 0 && s.last && this.backups[0]! + this.backups[1]! + this.backups[2]! === moves * 3) {
      if (this.backups[0] === moves * 3 || this.backups[2] === 0) this.white = 16;
    }
    if (this.white === 16) this.se(SE.open);
    this.se(s.last ? SE.end : SE.beat);
    const player = this.dancers[0]!.pos;
    if (player === 0 || s.position === 0 || c === 0) {
      if (s.grade === 0) this.se(this.clean[c] === moves ? SE.combo[2] : this.clean[c] === moves - 1 ? SE.combo[1] : SE.combo[0]);
      else if (s.grade === 1) this.se(SE.good);
      else this.se(s.wrong ? SE.wrong : SE.miss);
    }
  }

  /** ov17_0224B0E8: the step's note on the timeline (one per place and row), and for a rival lead the player's note to copy. */
  private addNote(s: DanceStep): void {
    const t = this.timing;
    const offset = (256 - t.width) / 2;
    const x = Math.floor(256 / t.halfBeats) * s.k + offset;
    const y = this.tables.noteRows[s.position]!;
    if (this.notes.some((n) => n.x === x && n.y === y && n.anim !== 2)) return;
    const own = s.contestant === 0;
    this.notes.push({ x, y, code: s.code, anim: own ? 0 : 1, born: this.tick });
    if (s.position === 0 && !own) this.notes.push({ x: x + 128 - offset, y: this.tables.noteRows[this.dancers[0]!.pos]!, code: s.code, anim: 2, born: this.tick });
  }

  /** ov17_0224AF3C / ov17_0224AD70: hearts fly from a dancer, one per two points (16 at most), each with two LCRNG draws. */
  private hearts(d: Dancer, position: number): void {
    const n = Math.min(16, Math.floor(this.points[d.id]! / 2));
    for (let i = 0; i < n && d.hearts.length < 16; i++) {
      let vx = this.ctx.rng() % 0x500;
      if (vx & 1) vx = -vx;
      const vy = -(0x400 + (this.ctx.rng() % 0xf00));
      // A new task first runs the next frame: age −1 skips this one.
      d.hearts.push({ x: Math.trunc(d.x / 256) * 256, y: Math.trunc(d.y / 256) * 256, vx, vy, age: -1, anim: position === 0 ? 0 : 1 });
    }
  }

  /** ov17_0224C89C: the stage's colour after a lead step (its direction's, or a miss's). */
  private tintFor(s: DanceStep): void {
    this.tint = s.grade === 2 ? 5 : s.code;
  }

  // ------------------------------------------------------------------ presentation

  private presentation(): void {
    for (const g of this.grades) g.age++;
    this.grades = this.grades.filter((g) => g.age <= GRADE_TICKS);
    if (this.flash && --this.flash.level <= 0) this.flash = null;
    if (this.white > 0) this.white = Math.max(0, this.white - 2);
    const beatTicks = Math.floor(this.timing.beat / 10000) - 1;
    for (const d of this.dancers) {
      // ov17_0224AE84: each heart moves and falls; it goes after 10 frames or off the screen.
      for (const h of d.hearts) {
        if (h.age < 0) {
          h.age = 0;
          continue;
        }
        h.x += h.vx;
        h.y += h.vy;
        h.vy += 0x200;
        h.age++;
      }
      d.hearts = d.hearts.filter((h) => h.age <= 10 && h.x <= (256 + 16) * 256 && h.x >= (-256 - 16) * 256 && h.y <= (192 + 16) * 256);
      // ov17_0224B5F0: the dancer's queued steps, one at a time.
      if (!d.move && d.queue.length) d.move = this.startMove(d, d.queue.shift()!, beatTicks);
      if (d.move && this.moveFrame(d, d.move)) d.move = null;
    }
  }

  private startMove(d: Dancer, code: number, ticks: number): Move {
    const at = this.tables.stage[d.pos]!;
    const x0 = at.x * 256;
    const y0 = (at.y + d.yOffset) * 256;
    const last = d.moveLast;
    const k = last ? 2 : 1;
    const v: number[] = [];
    if (code === 1 && d.jumps) {
      const accel = Math.trunc(0x500 / Math.floor(ticks / 2));
      v.push(-0x500 * k, accel * k);
    } else {
      const a = Math.floor((ticks * 30) / 100);
      const b = ticks - a;
      v.push(Math.trunc((16 * 256) / a), Math.trunc((16 * 256) / b), Math.trunc((182 * 5 * 256) / a), Math.trunc((182 * 5 * 256) / b));
    }
    return { code, frame: 0, x0, y0, x: x0, y: y0, v, phase: 1, turn: 0 };
  }

  /** ov17_0224B7BC (a jump), ov17_0224B8D0 (up for a dancer that cannot jump, front), ov17_0224BA50 (left, right); true when done. */
  private moveFrame(d: Dancer, m: Move): boolean {
    const last = d.moveLast;
    const k = (n: number) => (last ? Math.trunc((n * 200) / 100) : n);
    const reach = (last ? 32 : 16) * 256;
    let done = false;
    if (m.code === 1 && d.jumps) {
      m.y += m.v[0]!;
      m.v[0] = m.v[0]! + m.v[1]!;
      if (m.y >= m.y0) {
        m.y = m.y0;
        done = true;
      }
    } else if (m.code <= 2) {
      const down = m.code === 2;
      const sign = down ? 1 : -1;
      if (m.phase === 1) {
        m.y += sign * k(m.v[0]!);
        if (Math.abs(m.y - m.y0) >= reach) {
          m.y = m.y0 + sign * reach;
          m.phase = 2;
        }
      } else {
        m.y -= sign * k(m.v[1]!);
        if ((down && m.y <= m.y0) || (!down && m.y >= m.y0)) {
          m.y = m.y0;
          done = true;
        }
      }
    } else {
      const left = m.code === 3;
      const sign = left ? -1 : 1;
      if (m.phase === 1) {
        m.x += sign * k(m.v[0]!);
        m.turn += sign * k(m.v[2]!);
        if (Math.abs(m.x - m.x0) >= reach) {
          m.x = m.x0 + sign * reach;
          m.y = m.y0;
          m.phase = 2;
        }
      } else {
        m.x -= sign * k(m.v[1]!);
        m.turn -= sign * k(m.v[3]!);
        if ((left && m.x >= m.x0) || (!left && m.x <= m.x0)) {
          m.x = m.x0;
          m.turn = 0;
          done = true;
        }
      }
    }
    // The inline in ov17_0224B7BC: the lead moves fully, a backup 40 %, both 2 % more per point (100 % more at most).
    const amp = (d.movePos === 0 ? 100 : 40) + Math.min(2 * d.movePoints, 100);
    d.x = m.x0 + Math.trunc(((m.x - m.x0) * amp) / 100);
    d.y = m.y0 + Math.trunc(((m.y - m.y0) * amp) / 100);
    d.turn = m.turn;
    return done;
  }

  // ------------------------------------------------------------------ the view

  view(): ContestDanceRoundView {
    const t = this.timing;
    const frame = this.clock?.frame ?? 0;
    const dex = dexOf(this.ctx.registries);
    const dancers: ContestDancerView[] = [...this.dancers]
      .sort((a, b) => a.z - b.z || a.id - b.id)
      .map((d) => {
        const e = this.ctx.session.entrants[d.id]!;
        // ov17_0224BE64/ov17_0224BF58: the backups bob to the beat; everyone sways over two beats while not stepping.
        let x = d.x / 256;
        let z = d.z;
        if (this.idle && !d.move) {
          const sway = (((frame * 10000) % (t.beat * 2)) * 360) / (t.beat * 2);
          x += Math.trunc(Math.cos((sway * Math.PI) / 180) * 3) - 3;
          if (d.pos !== 0) {
            const p = (frame * 10000) % t.beat;
            let v = Math.floor((p * 0x2000) / Math.floor(t.beat / 2));
            if (p >= Math.floor(t.beat / 2)) v = 0x2000 - (v - 0x2000);
            z = Z_BACK + Math.trunc(v / 256);
          }
        }
        const scale = Math.round(depthScale(z));
        return {
          id: d.id,
          species: e.mon.species,
          form: e.mon.form,
          shiny: isShiny(e.mon.otId, e.mon.pid),
          female: monGender(dex, e.mon) === 'female',
          x: Math.round(x),
          y: Math.round(d.y / 256),
          scale,
          angle: ((d.turn / 256) * 360) / 65536,
          ground: Math.round((d.move ? d.move.y0 : d.y) / 256 + ((40 - d.yOffset) * scale) / 256),
          shade: d.shade,
          player: d.id === 0,
        };
      });
    const offset = (256 - t.width) / 2;
    const m = this.measure;
    const tt = m && m.state === 2 && this.clock ? (this.clock.frame - m.start) >>> 0 : 0;
    let ball: ContestDanceRoundView['timeline']['ball'] = null;
    if (this.ball) {
      const x = Math.floor((tt * t.width) / t.measure);
      const span = t.variant === 0 ? Math.floor((t.width * 10000) / (t.halfBeats / 2)) : Math.floor((t.width * 10000) / 8);
      const deg = Math.floor((180 * ((x * 10000) % span)) / span);
      ball = { x: x + offset, y: BALL_Y - Math.trunc(Math.sin((deg * Math.PI) / 180) * 10), frame: this.tick };
    }
    const player = this.dancers[0]!;
    const species = this.ctx.registries.species.get(this.ctx.session.entrants[0]!.mon.species);
    const labels = [this.text(NO_JUMP.includes(species?.sourceIndex ?? 0) ? TEXT.labels[1] : TEXT.labels[0]), ...TEXT.labels.slice(2).map((n) => this.text(n))];
    const press = this.press;
    let pressView: NonNullable<ContestDanceRoundView['buttons']>['press'] = null;
    if (press && press.left > 0) {
      const e = PRESS_TICKS - press.left;
      pressView = { dir: press.dir, step: e >= 1 && e < 4 ? 0 : e >= 4 && e < 7 ? 1 : null, label: e >= 1 && e < 4 ? 16 : e >= 4 && e < 7 ? 12 : 0 };
    }
    const tint = this.tables.tints[this.tint]!;
    const message: AppMessage | null = this.message ? { text: this.message.pages[this.message.page]!, waiting: true } : null;
    return {
      round: 'dance',
      placeholder: false,
      variant: t.variant,
      dancers,
      timeline: {
        fill: this.fill,
        flash: this.flash ? { ...this.flash } : null,
        notes: this.notes.map((n) => ({ x: n.x, y: n.y, code: n.code, anim: n.anim, frame: this.tick - n.born })),
        ball,
        cursor: this.cursor,
      },
      grades: this.grades.map((g) => ({ x: g.x, y: g.y - 4 * Math.min(g.age, GRADE_RISE), grade: g.grade, text: this.text(TEXT.grades[g.grade]), frame: g.age })),
      hearts: this.dancers.flatMap((d) => d.hearts.map((h) => ({ x: Math.trunc(h.x / 256), y: Math.trunc(h.y / 256), anim: h.anim }))),
      tint: tint.level ? { ...tint } : null,
      flash: this.white,
      fade: this.fade,
      buttons: this.layout === 1 ? { dim: this.dim, press: pressView, labels } : null,
      arrow: { x: Math.round(player.x / 256), y: Math.round(player.y / 256) - 40 },
      banner: this.banner,
      message,
    };
  }
}

/** ov17_0224B06C: a depth's scale ×256 (0xC0 at the back row, 0x100 at the lead's place). */
function depthScale(z: number): number {
  if (z <= Z_BACK) return 0xc0;
  if (z >= Z_FRONT) return 0x100;
  return 0xc0 + Math.trunc(((z - Z_BACK) * (0x100 - 0xc0)) / (Z_FRONT - Z_BACK));
}
