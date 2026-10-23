/**
 * The Game Corner's slot machine (docs/research/game-corner.md; decomp overlay101 ov101_021D1A28.c, ov101_021D59AC.c,
 * ov101_021D0D80.c, unk_0203D1B8.c sub_0203E484), headless and stepped one 30 Hz frame at a time. Within a frame the
 * DS runs the app's state machine first, then its tasks by priority: the reels (129–131), the presentation sequence
 * (132), the Poké Ball (134), the sparkle (135), the Pikachu pair (136), Clefairy (137), the payout counter (138), the
 * 7-line flash (140), the counters (142), the palette effects (143) and the BGM switch (144). This model keeps that
 * order, so a reel lands from the frame of its press exactly as on the DS, and the presentation's waits (the ball, the
 * Clefairy and Pikachu animations, the payout count) take the DS's frames.
 *
 * The draws come from the session's own LCRNG (`seed`: one draw of the game's main stream at launch; the DS draws from
 * its global LCRNG), in the decomp's order (§4.2). Everything else is the tables (`SlotTables`).
 *
 * Sprite resources load on the vblank after they are asked for (SysTask_ExecuteOnVBlank, then AfterVBlank), so a sprite
 * created in frame F is drawn from F + 1 on; we take the DS's own task order for the frame they are created in
 * (a task started from a lower priority runs the same frame).
 */
import { SLOT, SLOT_SYMBOL as SYM, type SlotButton, type SlotTables, type SlotsView } from '@opensinnoh/contracts';
import type { Button } from '@opensinnoh/core';

/** sub_0203E484: the machine's mode for the day (the mode list shuffled with the daily random as the LCRNG's seed). */
export function slotMode(tables: Pick<SlotTables, 'modes'>, dailyRandom: number, machine: number): number {
  if (!Number.isInteger(machine) || machine < 0 || machine >= SLOT.machines) throw new Error(`slots: no machine ${machine}`);
  let x = dailyRandom >>> 0;
  const list = tables.modes.slice();
  for (let i = 0; i < SLOT.machines; i++)
    for (let j = i + 1; j < SLOT.machines; j++) {
      x = (Math.imul(x, 0x41c64e6d) + 0x6073) >>> 0;
      const k = (x >>> 16) % SLOT.machines;
      [list[i], list[k]] = [list[k]!, list[i]!];
    }
  return list[machine]!;
}

/** Flag bits (unk_74): each symbol's plain and bonus flag, then the two 7s of a standby spin. */
export const SLOT_FLAG = { replay: 0, replayBonus: 1, cherry: 2, cherryBonus: 3, pikachu: 4, pikachuBonus: 5, moon: 6, moonBonus: 7, galactic7: 8, red7: 9 } as const;
const BIT = (n: number) => 1 << n;
const BONUS_FLAGS = BIT(1) | BIT(3) | BIT(5) | BIT(7);
/** The flags that line up whatever the timing ("full slip"). */
const FULL_SLIP_FLAGS = BIT(0) | BIT(1) | BIT(4) | BIT(5);
/** The win flags in their check order (`SlotTables.winFlags` columns); bit 0 takes the rest. */
const WIN_ORDER = [3, 2, 7, 6, 5, 4, 1];
/** The five lines in check order: their bit (unk_48) and rows (left, middle, right). */
const LINES = [
  { bit: 1, rows: [1, 1, 1] },
  { bit: 0, rows: [2, 2, 2] },
  { bit: 2, rows: [3, 3, 3] },
  { bit: 3, rows: [1, 2, 3] },
  { bit: 4, rows: [3, 2, 1] },
];
const REEL_PX = SLOT.strip * 32;
/** The reels' speed (unk_8C): 16 px a frame. */
const SPEED = 16;
const BUTTON_OF: SlotButton[] = ['y', 'b', 'a'];
/** Messages (TEXT_BANK_UNK_0544). */
export const SLOT_MESSAGE = { noThree: 0, full: 1, noCoins: 2 } as const;

/** Sounds and music the model asks for; the app plays them (SDAT indexes in docs/research/game-corner.md §6). */
export type SlotSound = 'bet' | 'spin' | 'stop' | 'bonus-stop' | 'coin' | 'ball-rise' | 'ball-open' | 'clefairy-in' | 'moon';
export type SlotMusic = 'field' | 'standby' | 'bonus';
export type SlotEvent = { se: SlotSound } | { cry: true } | { music: 'stop' | 'play'; bgm: SlotMusic };

export interface SlotInput {
  pressed: readonly Button[];
  held: readonly Button[];
}

/** States (the decomp's state table, Unk_ov101_021D8838), by index. */
const ST = {
  idle: 0, bet: 1, lever: 2, spin: 3, spinDelay: 4, stops: 5, settle: 6, result: 7, miss: 8, missWait: 9, ballAway: 10, ballAwayWait: 11,
  pay: 12, payWait: 13, replay: 14, replayWait: 15, bonusMiss: 16, bonusMissWait: 17, clefairyWait: 18, bonusPay: 19, bonusPayWait: 20,
  bonusReplay: 21, bonusReplayWait: 22, toStandby: 23, toStandbySpin: 24,
  standbyIdle: 25, standbyBet: 26, standbyLever: 27, standbySpin: 28, standbySpinDelay: 29, standbyStops: 30, standbySettle: 31, standbyResult: 32,
  standbyMiss: 33, standbyMissWait: 34, standbyPay: 35, standbyPayWait: 36, standbyReplay: 37, standbyReplayWait: 38, sevens: 39, sevensWait: 40,
  bonusSetup: 41, roundStart: 42, roundIdle: 43, roundBet: 44, roundLever: 45, roundSpin: 46, roundSpinDelay: 47, roundStops: 48, roundSettle: 49,
  roundResult: 50, roundMiss: 51, roundPay: 52, roundPayWait: 53, roundEnd: 54, roundNext: 55, tellPikachu: 56, tellBall: 57, bonusEnd: 58,
  msgNoThree: 59, msgNoCoins: 60, msgFull: 61, msgWait: 62, quit: 63,
} as const;

/** What each waiting state asks for (`SlotsView.prompt`). */
const PROMPTS: Partial<Record<number, SlotsView['prompt']>> = {
  [ST.bet]: 'bet', [ST.standbyBet]: 'bet', [ST.roundBet]: 'bet',
  [ST.lever]: 'lever', [ST.standbyLever]: 'lever', [ST.roundLever]: 'lever',
  [ST.stops]: 'stops', [ST.standbyStops]: 'stops', [ST.roundStops]: 'stops',
};

interface Reel {
  /** The reel task (ov101_021D2C10): 0 still, 1 spinning, 2 stop pressed, 3 snapping and slipping, 4 bouncing. */
  task: number;
  /** Not yet settled (unk_04). */
  turning: boolean;
  /** The stop button: 1 armed, 2 pressed (unk_7C); 0 before the first spin. */
  stop: number;
  /** Scroll in px (unk_90, 0–671), the strip index at row 0 (unk_A8: 1–21 once moved), the bounce. */
  px: number;
  pos: number;
  bounce: number;
  bounceStep: number;
  bounceCount: number;
  /** The row the control aimed for (unk_14) and the symbols still to slip (unk_18). */
  target: number;
  slip: number;
}

/** A Poké Ball, Clefairy or Pikachu sprite's DS state (sub-screen y, i.e. y + 192 on the DS's joint OAM space). */
interface Ball {
  anim: number;
  step: number;
  done: boolean;
  loadAt: number;
  kind: number;
  base: { x: number; y: number };
  x: number;
  y: number;
  scale: number;
  rotation: number;
  rotStep: number;
  timer: number;
  sprite: { anim: number; frame: number; speed: number } | null;
  visible: boolean;
}
interface Clefairy {
  anim: number;
  step: number;
  done: boolean;
  loadAt: number;
  kind: number;
  y: number;
  scale: number;
  timer: number;
  sprite: { anim: number; frame: number; speed: number } | null;
}
interface Sparkle {
  loadAt: number;
  state: number;
  timer: number;
  frame: number;
  done: boolean;
}
interface Pikachu {
  loadAt: number;
  state: number;
  timer: number;
  count: number;
  at: { x: number; y: number };
  left: { x: number; y: number };
  right: { x: number; y: number };
  shown: boolean;
  done: boolean;
}
interface Flash {
  line: number;
  amount: number;
  level: number;
  phase: number;
  pulses: number;
  done: boolean;
}
interface Sevens {
  loadAt: number;
  state: number;
  timer: number;
  count: number;
  symbol: number;
  line: number;
  at: { x: number; y: number }[];
  from: number;
  visible: boolean;
  done: boolean;
}

/** Ball animations (UnkEnum_ov101_021D5D90): create, rise, open, bounce, roll away, wobble, still. */
const BALL = { create: 0, rise: 1, open: 2, bounce: 3, leave: 4, wobble: 5, still: 6 } as const;
/** Clefairy animations (UnkEnum_ov101_021D679C): create, pop out, into the ball, still, cheer, points B, Y, A, wave. */
const CLEF = { create: 0, pop: 1, into: 2, still: 3, cheer: 4, pointB: 5, pointY: 6, pointA: 7, wave: 8 } as const;
/** Clefairy's sprite animation (NANR sequence) per Clefairy animation. */
const CLEF_SPRITE: Record<number, number> = { [CLEF.pointB]: 5, [CLEF.pointY]: 4, [CLEF.pointA]: 3 };
/** Presentation sequences (Unk_ov101_021D8774). */
const SEQ = { none: 0, ballIn: 1, ballOut: 2, reveal: 3, intoBall: 4, tellPikachu: 5, point: 6, still: 7, end: 8, cheer: 9, wave: 10, ballStill: 11, tellBall: 12 } as const;
/** The wobble (ov101_021D61E0): rotation step (of 65536), x step and duration per phase. */
const WOBBLE = { rot: [-16, 0, 16, 0, 16, 0, -16, 0], x: [-2, 0, 2, 0, 2, 0, -2, 0], t: [4, 1, 4, 8, 4, 1, 4, 8] };
const BOUNCE_Y = [-8, 0, -6, 0, -4, 0, -2, 0];

export class SlotMachine {
  tick = 0;
  coins: number;
  readonly mode: number;
  /** The session's best streak (unk_20) and the bonus rounds played (unk_0C). */
  streak = 0;
  rounds = 0;
  /** Set when the app is to close (after the fade-out and the BGM switch). */
  done = false;
  readonly events: SlotEvent[] = [];
  /** The message shown (TEXT_BANK_UNK_0544 index), until A or B. */
  message: number | null = null;

  private rng: number;
  private fade = 16;
  /** 0 fading in, 1 running, 2 fading out, 3 waiting for the BGM. */
  private phase = 0;
  private state: number = ST.idle;
  private after: number = ST.quit;
  private payout = 0;
  private bonusMode = false;
  private timer = 0;
  private flags = 0;
  /** The last spin's flags (kept after the next bet clears `flags`) and its window when the lines were checked. */
  private spinFlags = 0;
  private resultWindow: number[][] = [];
  private resultFlags = 0;
  private fullSlip = false;
  private control = false;
  private result: number = SYM.none;
  private lines = 0;
  private bonusType = 0;
  private bonusClass = 0;
  private presses: SlotButton[] = [];
  private readonly reels: Reel[];
  // The bonus (unk_10 spins left, unk_14 coins gained, unk_18 continue chance, unk_1C round count, unk_24 blue moon,
  // unk_28 red moon: 0 none, 1 shown, 2 hit, 3 dodged; unk_2C last round; unk_34 the stop order).
  private spinsLeft = 0;
  private gained = 0;
  private chance = 0;
  private roundCount = 0;
  private blueMoon = false;
  private redMoon = 0;
  private lastRound = false;
  private order = 0;
  // The payout counter (unk_120).
  private pay = { state: 0, done: false, counter: 0, flashes: [] as Flash[] };
  // The presentation sequence (unk_13C).
  private seq = { id: 0, step: 0, done: false, hidden: false, timer: 0, hint: 4, kind: 0, pointed: 0 };
  private ball: Ball | null = null;
  private sparkle: Sparkle | null = null;
  private clefairy: Clefairy | null = null;
  private pikachu: Pikachu | null = null;
  private sevens: Sevens | null = null;
  private counters = false;
  private banner: { round: number; frame: number } | null = null;
  private summary: { rounds: number; gained: number; frame: number } | null = null;
  // The palette effects (unk_184): lamp levels, the attract light show, the field's bonus colouring and the moon.
  private lamps = [0, 0, 0, 0, 0];
  private lightShow: { index: number; first: boolean; wait: number } | null = null;
  private fieldBonus = 0;
  private fieldFade: 'in' | 'out' | null = null;
  private moon: { kind: 'red' | 'blue'; level: number; state: number } | null = null;
  // The BGM switch (unk_424).
  private music = { current: 'field' as SlotMusic, pending: null as SlotMusic | null, state: 0 };

  constructor(
    private readonly tables: SlotTables,
    mode: number,
    coins: number,
    seed: number,
  ) {
    if (!Number.isInteger(mode) || mode < 0 || mode >= SLOT.modes) throw new Error(`slots: no mode ${mode}`);
    this.mode = mode;
    this.coins = coins;
    this.rng = seed >>> 0;
    // ov101_021D1A68: each reel's starting index.
    this.reels = Array.from({ length: SLOT.reels }, () => {
      const pos = this.draw() % SLOT.strip;
      return { task: 0, turning: false, stop: 0, px: (REEL_PX - pos * 32) % REEL_PX, pos, bounce: 0, bounceStep: 0, bounceCount: 0, target: 0, slip: 0 };
    });
  }

  /** LCRNG_Next: the high half of the next state. */
  private draw(): number {
    this.rng = (Math.imul(this.rng, 0x41c64e6d) + 0x6073) >>> 0;
    return this.rng >>> 16;
  }
  private percent(): number {
    return this.draw() % 100;
  }

  private emit(e: SlotEvent): void {
    this.events.push(e);
  }

  /** One frame. The events of the frame are in `events` (cleared at the start of each step). */
  step(input: SlotInput): void {
    if (this.done) throw new Error('slots: stepped after the app closed');
    this.events.length = 0;
    this.tick++;
    const pressed = (b: Button) => input.pressed.includes(b);
    if (this.phase === 0) {
      // StartScreenFade(…, 8, 1): eight frames in, then the state machine.
      this.fade = Math.max(0, this.fade - 2);
      if (this.fade === 0) this.phase = 1;
    } else if (this.phase === 1) {
      let r;
      do r = this.run(input, pressed);
      while (r === 1);
      if (r === 2) {
        this.phase = 2;
        this.requestMusic('field');
      }
    } else if (this.phase === 2) {
      this.fade = Math.min(16, this.fade + 2);
      if (this.fade === 16) this.phase = 3;
    }
    if (this.phase === 3 && this.music.state === 0 && this.music.pending === null) {
      this.done = true;
      return;
    }
    for (let i = 0; i < SLOT.reels; i++) this.reelTask(i);
    this.sequenceTask();
    this.ballTask();
    this.sparkleTask();
    this.pikachuTask();
    this.clefairyTask();
    this.payTask(input, pressed);
    this.sevensTask();
    if (this.banner && ++this.banner.frame >= 60) this.banner = null;
    if (this.summary && ++this.summary.frame >= 45) this.summary = null;
    this.paletteTasks();
    this.musicTask();
  }

  // ------------------------------------------------------------------ the state machine

  /** One state: 0 waits for the next frame, 1 runs the next state now, 2 quits. */
  private run(input: SlotInput, pressed: (b: Button) => boolean): 0 | 1 | 2 {
    const s = ST;
    switch (this.state) {
      case s.idle:
        return this.enterIdle(s.bet, false);
      case s.bet:
      case s.standbyBet:
        if (pressed('start')) {
          this.stopLightShow();
          this.state = s.quit;
          return 0;
        }
        if (pressed('x')) {
          this.coins -= 3;
          this.state = this.state === s.bet ? s.lever : s.standbyLever;
          this.emit({ se: 'bet' });
          this.stopLightShow();
          this.lampsBet();
        }
        return 0;
      case s.lever:
      case s.standbyLever:
        if (pressed('start')) {
          this.coins += 3;
          this.state = s.quit;
          return 0;
        }
        if (pressed('down') || pressed('x')) {
          this.state = this.state === s.lever ? s.spin : s.standbySpin;
          return 1;
        }
        return 0;
      case s.spin:
        this.drawFlags();
        this.startSpin(s.spinDelay);
        return 1;
      case s.spinDelay:
      case s.standbySpinDelay:
        if (++this.timer >= 8) {
          this.timer = 0;
          this.state = this.state === s.spinDelay ? s.stops : s.standbyStops;
          return 1;
        }
        return 0;
      case s.stops:
      case s.standbyStops:
        this.stops(input, false, this.state === s.stops ? s.settle : s.standbySettle);
        return 0;
      case s.settle:
      case s.standbySettle:
      case s.roundSettle:
        if (this.reels.some((r) => r.turning)) return 0;
        this.lampsOff();
        this.state = this.state === s.settle ? s.result : this.state === s.standbySettle ? s.standbyResult : s.roundResult;
        return 1;
      case s.result: {
        this.checkLines();
        if (this.result === SYM.none) {
          this.state = this.flags & BONUS_FLAGS ? s.bonusMiss : this.flags ? s.ballAway : s.miss;
          return 1;
        }
        if (this.flags & BONUS_FLAGS) this.state = this.flags & BIT(1) ? s.bonusReplay : s.bonusPay;
        else this.state = this.result === SYM.replay ? s.replay : s.pay;
        return 1;
      }
      case s.miss:
        this.lampsOff();
        this.timer = 0;
        this.state = s.missWait;
        return 1;
      case s.missWait:
        if (++this.timer >= 8) {
          this.timer = 0;
          this.state = s.idle;
        }
        return 0;
      case s.ballAway:
        this.lampsOff();
        this.startSeq(SEQ.ballOut);
        this.state = s.ballAwayWait;
        return 0;
      case s.ballAwayWait:
        if (this.seq.done) {
          this.startSeq(SEQ.none);
          this.state = s.idle;
          return 1;
        }
        return 0;
      case s.pay:
        this.payout = this.linePayout();
        this.timer = 0;
        this.state = s.payWait;
        this.startPay();
        this.startSeq(SEQ.ballStill);
        return 0;
      case s.payWait:
      case s.replayWait: {
        const at = this.state === s.payWait ? 30 : 15;
        if (++this.timer === at) this.startSeq(SEQ.ballOut);
        else if (this.timer > at && this.pay.done && this.seq.done) {
          this.startSeq(SEQ.none);
          this.timer = 0;
          this.state = this.state === s.payWait ? s.idle : s.spin;
          return 1;
        }
        return 0;
      }
      case s.replay:
        this.payout = 0;
        this.timer = 0;
        this.state = s.replayWait;
        this.startPay();
        this.startSeq(SEQ.ballStill);
        return 0;
      case s.bonusMiss:
        this.lampsOff();
        this.drawBonus();
        this.startSeq(SEQ.ballStill);
        this.timer = 0;
        this.state = s.bonusMissWait;
        return 0;
      case s.bonusMissWait:
        if (++this.timer >= 8) {
          this.startSeq(SEQ.reveal);
          this.requestMusic('standby');
          this.state = s.clefairyWait;
        }
        return 0;
      case s.clefairyWait:
        if (this.seq.done) {
          this.state = s.toStandby;
          return 1;
        }
        return 0;
      case s.bonusPay:
        this.payout = this.linePayout();
        this.timer = 0;
        this.state = s.bonusPayWait;
        this.startPay();
        this.drawBonus();
        this.startSeq(SEQ.ballStill);
        return 0;
      case s.bonusPayWait:
      case s.bonusReplayWait: {
        const at = this.state === s.bonusPayWait ? 30 : 8;
        if (++this.timer === at) {
          this.requestMusic('standby');
          this.startSeq(SEQ.reveal);
        } else if (this.timer >= at && this.pay.done && this.seq.done) {
          this.timer = 0;
          this.state = this.state === s.bonusPayWait ? s.toStandby : s.toStandbySpin;
          return 1;
        }
        return 0;
      }
      case s.bonusReplay:
        this.timer = 0;
        this.state = s.bonusReplayWait;
        this.startPay();
        this.startSeq(SEQ.ballStill);
        this.drawBonus();
        return 0;
      case s.toStandby:
        this.state = s.standbyIdle;
        return 1;
      case s.toStandbySpin:
        this.state = s.standbySpin;
        return 1;
      case s.standbyIdle:
        this.startSeq(SEQ.still);
        return this.enterIdle(s.standbyBet, true);
      case s.standbySpin:
        this.drawStandbyFlags();
        this.startSpin(s.standbySpinDelay);
        this.startSeq(SEQ.cheer);
        return 1;
      case s.standbyResult:
        this.checkLines();
        if (this.result === SYM.none) this.state = s.standbyMiss;
        else if (this.flags & (BIT(8) | BIT(9))) this.state = s.sevens;
        else this.state = this.result === SYM.replay ? s.standbyReplay : s.standbyPay;
        return 1;
      case s.standbyMiss:
        this.lampsOff();
        this.startSeq(SEQ.still);
        this.timer = 0;
        this.state = s.standbyMissWait;
        return 1;
      case s.standbyMissWait:
        if (++this.timer >= 8) {
          this.timer = 0;
          this.state = s.standbyIdle;
          return 1;
        }
        return 0;
      case s.standbyPay:
        this.payout = this.linePayout();
        this.timer = 0;
        this.state = s.standbyPayWait;
        this.startPay();
        this.startSeq(SEQ.wave);
        return 0;
      case s.standbyPayWait:
        if (this.pay.done) {
          this.startSeq(SEQ.still);
          this.state = s.standbyIdle;
          return 1;
        }
        return 0;
      case s.standbyReplay:
        this.payout = 0;
        this.timer = 0;
        this.state = s.standbyReplayWait;
        this.startPay();
        this.startSeq(SEQ.wave);
        return 0;
      case s.standbyReplayWait:
        if (++this.timer > 15 && this.pay.done) {
          this.startSeq(SEQ.still);
          this.lampsOff();
          this.timer = 0;
          this.state = s.standbySpin;
          return 1;
        }
        return 0;
      case s.sevens:
        this.payout = this.linePayout();
        this.timer = 0;
        this.state = s.sevensWait;
        this.startPay();
        this.startSeq(SEQ.wave);
        this.fieldFade = 'in';
        this.requestMusic('bonus');
        this.startSevens();
        return 0;
      case s.sevensWait:
        if (this.pay.done) {
          this.sevens = null;
          this.startSeq(SEQ.still);
          this.state = s.bonusSetup;
          return 1;
        }
        return 0;
      case s.bonusSetup:
        this.seq.hidden = false;
        this.counters = true;
        this.roundCount = 0;
        this.gained = 0;
        this.bonusMode = true;
        this.state = s.roundStart;
        return 1;
      case s.roundStart:
        this.rounds++;
        this.roundCount = Math.min(999, this.roundCount + 1);
        this.banner = { round: this.roundCount, frame: 0 };
        this.spinsLeft = 16;
        this.blueMoon = false;
        this.redMoon = 0;
        this.lastRound = !(this.percent() < this.chance);
        this.state = s.roundIdle;
        return 1;
      case s.roundIdle:
        this.spinsLeft--;
        if (this.spinsLeft < 1) throw new Error('slots: a bonus round ran past its 15 spins');
        this.armStops();
        this.lampsOff();
        this.startLightShow();
        this.startSeq(SEQ.still);
        this.state = s.roundBet;
        if (this.coins === 0) this.showMessage(s.msgNoCoins, s.quit);
        else if (this.coins >= SLOT.maxCoins) this.showMessage(s.msgFull, s.roundBet);
        return 1;
      case s.roundBet:
        if (pressed('start')) {
          this.state = s.quit;
          return 0;
        }
        if (pressed('x')) {
          this.coins -= 1;
          this.gained = Math.max(0, this.gained - 1);
          this.state = s.roundLever;
          this.emit({ se: 'bet' });
          this.stopLightShow();
          this.lamps[0] = 12;
        }
        return 0;
      case s.roundLever:
        if (pressed('start')) {
          this.coins += 1;
          this.state = s.quit;
          return 0;
        }
        if (pressed('down') || pressed('x')) {
          this.state = s.roundSpin;
          return 1;
        }
        return 0;
      case s.roundSpin:
        this.flags = BIT(SLOT_FLAG.replay);
        this.spinFlags = this.flags;
        this.control = true;
        this.fullSlip = true;
        this.armStops();
        this.lamps[0] = 12;
        for (const r of this.reels) this.startReel(r);
        this.presses = [];
        this.order = this.draw() % 6;
        for (const r of this.reels) r.stop = 1;
        this.timer = 0;
        this.state = s.roundSpinDelay;
        this.emit({ se: 'spin' });
        if (!this.blueMoon && !this.redMoon) {
          if (this.percent() < this.tables.redMoon[this.mode]!) this.redMoon = 1;
          if (this.redMoon === 1) this.startMoon('red');
        }
        if (!this.blueMoon && !this.redMoon) {
          if (this.percent() < this.tables.blueMoon[this.mode]!) this.blueMoon = true;
          if (this.blueMoon) this.startMoon('blue');
        }
        return 1;
      case s.roundSpinDelay:
        if (++this.timer >= 8) {
          this.timer = 0;
          this.state = s.roundStops;
          this.startSeq(SEQ.point);
          return 1;
        }
        return 0;
      case s.roundStops:
        this.stops(input, true, s.roundSettle);
        return 0;
      case s.roundResult: {
        this.resultWindow = this.window();
        this.resultFlags = this.flags;
        const middle = this.lineSymbol(LINES[1]!.rows);
        this.lines = 0;
        if (middle !== SYM.none) {
          if (middle !== SYM.replay) throw new Error(`slots: a bonus round lined up symbol ${middle}`);
          this.lines = BIT(0);
        }
        this.result = middle;
        if (middle === SYM.none) {
          if (this.redMoon === 1) this.redMoon = 3;
          this.state = s.roundMiss;
        } else {
          if (this.redMoon === 1) this.redMoon = 2;
          this.state = s.roundPay;
        }
        return 1;
      }
      case s.roundMiss:
        this.lampsOff();
        this.startSeq(SEQ.still);
        this.state = this.spinsLeft <= 1 ? s.roundEnd : s.roundIdle;
        return 0;
      case s.roundPay:
        this.payout = this.tables.bonusPayouts[this.result]!;
        this.startPay();
        this.startSeq(SEQ.wave);
        this.timer = 0;
        this.state = s.roundPayWait;
        return 0;
      case s.roundPayWait:
        if (!this.pay.done) return 0;
        this.startSeq(SEQ.still);
        this.state = this.spinsLeft <= 1 ? s.roundEnd : s.roundIdle;
        return 1;
      case s.roundEnd:
        this.spinsLeft--;
        if (this.spinsLeft !== 0) throw new Error('slots: a bonus round ended before its 15th spin');
        if (this.lastRound && !this.blueMoon) {
          this.startSeq(SEQ.end);
          this.state = s.bonusEnd;
          return 0;
        }
        this.state = s.roundNext;
        return 1;
      case s.roundNext: {
        this.dropChance();
        let tell = this.drawTell();
        if (this.blueMoon) tell = 'pikachu';
        if (tell === 'pikachu') {
          this.startSeq(SEQ.tellPikachu);
          this.state = s.tellPikachu;
          return 0;
        }
        if (tell === 'ball') {
          this.startSeq(SEQ.tellBall);
          this.state = s.tellBall;
          return 0;
        }
        this.emit({ cry: true });
        this.state = s.roundStart;
        return 0;
      }
      case s.tellPikachu:
      case s.tellBall:
        if (!this.seq.done) return 0;
        this.state = s.roundStart;
        return 1;
      case s.bonusEnd:
        if (!this.seq.done) return 0;
        this.streak = Math.max(this.streak, this.roundCount);
        this.requestMusic('field');
        this.fieldFade = 'out';
        this.state = s.idle;
        return 1;
      case s.msgNoThree:
        return this.messageState(SLOT_MESSAGE.noThree);
      case s.msgNoCoins:
        return this.messageState(SLOT_MESSAGE.noCoins);
      case s.msgFull:
        return this.messageState(SLOT_MESSAGE.full);
      case s.msgWait:
        if (pressed('a') || pressed('b')) {
          this.message = null;
          this.state = this.after;
        }
        return 0;
      case s.quit:
        this.stopLightShow();
        return 2;
    }
    throw new Error(`slots: no state ${this.state}`);
  }

  /** ov101_021D1AD0 / ov101_021D212C: a new bet; the coin checks. */
  private enterIdle(next: number, standby: boolean): 0 | 1 {
    this.payout = 0;
    this.flags = 0;
    if (!standby) this.bonusMode = false;
    this.state = next;
    this.armStops();
    this.lampsOff();
    this.startLightShow();
    if (this.coins === 0) this.showMessage(ST.msgNoCoins, ST.quit);
    else if (this.coins < 3) this.showMessage(ST.msgNoThree, ST.quit);
    else if (this.coins >= SLOT.maxCoins) this.showMessage(ST.msgFull, next);
    return 1;
  }
  private showMessage(state: number, after: number): void {
    this.state = state;
    this.after = after;
  }
  private messageState(index: number): 0 {
    this.message = index;
    this.state = ST.msgWait;
    return 0;
  }

  // ------------------------------------------------------------------ spins and stops

  /** ov101_021D1BD0 / ov101_021D2228: the switches, the hint, the reels start. */
  private startSpin(next: number): void {
    this.spinFlags = this.flags;
    this.fullSlip = (this.flags & FULL_SLIP_FLAGS) !== 0;
    this.control = this.flags !== 0;
    this.armStops();
    this.lampsBet();
    for (const r of this.reels) this.startReel(r);
    this.presses = [];
    for (const r of this.reels) r.stop = 1;
    this.timer = 0;
    this.state = next;
    this.emit({ se: 'spin' });
  }
  private startReel(r: Reel): void {
    r.task = 1;
    r.turning = true;
  }

  /** The stop buttons (ov101_021D1CBC, ov101_021D2850): Y, then B, then A, one stop a frame. */
  private stops(input: SlotInput, bonus: boolean, next: number): void {
    const i = [0, 1, 2].find((n) => this.reels[n]!.stop === 1 && input.pressed.includes(BUTTON_OF[n]!));
    if (i !== undefined) {
      const r = this.reels[i]!;
      r.stop = 2;
      this.stopPalettes[i] = 'pressed';
      this.presses.push(BUTTON_OF[i]!);
      const order = bonus ? this.tables.bonusOrders[this.order]!.buttons : BUTTON_OF;
      if (this.presses.some((b, k) => b !== order[k])) {
        this.fullSlip = false;
        if (bonus) this.control = false;
      }
      r.task = 2;
      this.emit({ se: bonus ? 'bonus-stop' : 'stop' });
    }
    if (this.reels.every((r) => r.stop === 2)) this.state = next;
  }

  /** The symbol at row `k` of reel `r` (ov101_021D55D4: a reel half a symbol past a boundary reads row k − 1). */
  private sym(r: number, k: number): number {
    const reel = this.reels[r]!;
    const at = reel.pos + k + (reel.px % 32 ? -1 : 0);
    return this.tables.reels[r]![((at % SLOT.strip) + SLOT.strip) % SLOT.strip]!;
  }

  /** The symbols in the window: [reel][row 1–3]. */
  private window(): number[][] {
    return [0, 1, 2].map((r) => [1, 2, 3].map((k) => this.sym(r, k)));
  }

  private lineSymbol(rows: number[]): number {
    return lineSymbol(rows.map((k, r) => this.sym(r, k)));
  }

  private checkLines(): void {
    this.resultWindow = this.window();
    this.resultFlags = this.flags;
    const w = slotLines(this.resultWindow);
    this.result = w.result;
    this.lines = w.lines;
  }

  private linePayout(): number {
    return slotPayout(this.tables.payouts, this.result, this.lines);
  }

  // ------------------------------------------------------------------ lotteries (the pure draws are below the class)

  private drawFlags(): void {
    const gate = this.percent();
    this.flags = this.tables.winChance[this.mode]! > gate ? winFlag(this.tables, this.mode, this.percent()) : 0;
    if (this.flags) {
      this.seq.hint = this.percent() < this.tables.hintChance[this.mode]! ? hintKind(this.flags) : 4;
      this.startSeq(SEQ.ballIn);
    }
  }

  private drawStandbyFlags(): void {
    const pick = this.percent();
    this.flags = standbyFlag(this.tables, this.mode, this.bonusType, pick, this.percent());
  }

  private drawBonus(): void {
    const b = bonusDraw(this.tables, this.mode, this.percent());
    this.bonusType = b.type;
    this.bonusClass = b.class;
    this.chance = this.tables.continueStart[b.type]!;
    this.seq.kind = clefairyKind(this.tables, this.mode, b.class, this.percent());
  }

  private dropChance(): void {
    this.chance = continueDrop(this.tables, this.mode, this.chance, this.redMoon === 2, this.percent());
  }

  private drawTell(): SlotTell {
    return endTell(this.tables, this.mode, this.chance, this.percent());
  }

  // ------------------------------------------------------------------ the reels

  private move(reel: Reel, d: number): void {
    reel.px = (reel.px + d) % REEL_PX;
    reel.pos = SLOT.strip - Math.floor(reel.px / 32);
  }

  private reelTask(i: number): void {
    const reel = this.reels[i]!;
    for (;;) {
      switch (reel.task) {
        case 0:
          return;
        case 1:
          this.move(reel, SPEED);
          return;
        case 2:
          reel.task = 3;
          reel.target = 0;
          reel.slip = 0;
          this.control_(i);
          continue;
        case 3: {
          let moved = false;
          let rem = reel.px % 32;
          if (rem) {
            moved = true;
            this.move(reel, Math.min(rem, SPEED));
            rem = reel.px % 32;
          } else if (reel.slip) {
            moved = true;
            reel.slip--;
            this.move(reel, SPEED);
            rem = reel.px % 32;
          }
          if (rem === 0 && reel.slip === 0) {
            reel.bounceStep = 4 * 4096;
            reel.bounceCount = 0;
            reel.task = 4;
            if (!moved) continue;
          }
          return;
        }
        case 4:
          reel.bounce = reel.bounceStep / 4096;
          reel.bounceStep = -reel.bounceStep;
          reel.bounceCount++;
          if (!(reel.bounceCount & 1)) reel.bounceStep >>= 2;
          if (reel.bounceStep === 0) {
            reel.task = 0;
            reel.turning = false;
            reel.bounce = 0;
          }
          return;
      }
    }
  }

  /** ov101_021D2C4C: aim (or, in a bonus round, aim for REPLAY on the middle row), else avoid. */
  private control_(i: number): void {
    if (this.control) {
      if (!(this.bonusMode ? this.aimBonus(i) : this.aim(i))) {
        if (this.bonusMode) this.avoidBonus(i);
        else this.avoid(i);
        this.control = false;
      }
    } else if (this.bonusMode) this.avoidBonus(i);
    else this.avoid(i);
  }

  private set(i: number, target: number, slip: number): true {
    this.reels[i]!.target = target;
    this.reels[i]!.slip = slip;
    return true;
  }
  private limit(): number {
    return this.fullSlip ? SLOT.strip : 4;
  }
  /** ov101_021D3AF0 == 0: no cherry in the left reel's window after slipping `s`. */
  private noCherry(s: number): boolean {
    return [1, 2, 3].every((k) => this.sym(0, k - s) !== SYM.cherry);
  }
  /** ov101_021D3B34: a cherry flag ignores the cherry test. */
  private okLeft(s: number, t: number): boolean {
    return t === SYM.cherry || this.noCherry(s);
  }
  private stoppedFirst(i: number): boolean {
    return this.reels.every((r, k) => k === i || r.stop === 1);
  }

  /** ov101_021D2D88. */
  private aim(i: number): boolean {
    if (!this.flags) return false;
    const t = flagSymbol(this.flags);
    if (t === SYM.none) return false;
    if (i === 0) return this.stoppedFirst(i) ? this.aimLeftFirst(t) : this.aimLeftLater(t);
    return this.stoppedFirst(i) ? this.aimOtherFirst(i, t) : this.aimOtherLater(i, t);
  }

  /** ov101_021D2E94: the left reel stopped first. */
  private aimLeftFirst(t: number): boolean {
    for (let v = 1; v <= 3; v++) {
      if (this.sym(0, v) !== t) continue;
      for (let s = 0; v + s <= 3; s++) if (this.okLeft(s, t)) return this.set(0, v + s, s);
    }
    const pos = this.reels[0]!.pos;
    for (let d = 1; d <= this.limit(); d++) {
      if (this.sym(0, 1 - d) !== t) continue;
      for (let e = 0; e < 3; e++) {
        if (!this.okLeft(d + e, t)) continue;
        if (e === 0 && pos % 4 === 0 && this.okLeft(d + 2, t)) return this.set(0, 3, d + 2);
        if (e === 1 && pos % 6 < 2 && this.okLeft(d + 2, t)) return this.set(0, 3, d + 2);
        return this.set(0, 1 + e, d + e);
      }
    }
    return false;
  }

  /** ov101_021D2FAC: the left reel stopped second or third. */
  private aimLeftLater(t: number): boolean {
    const [c1, c2, c3] = this.candidates(0);
    if (this.okLeft(0, t)) {
      if (this.sym(0, c1) === t) return this.set(0, c1, 0);
      if (c2 && this.sym(0, c2) === t) return this.set(0, c2, 0);
      if (c3 && this.sym(0, c3) === t) return this.set(0, c3, 0);
    }
    const tryRow = (c: number, d: number) => this.sym(0, c - d) === t && this.okLeft(d, t);
    for (let d = 1; d <= this.limit(); d++) {
      const order = !c2 ? [c1] : !c3 ? (d & 1 ? [c1, c2] : [c2, c1]) : [[c1, c2, c3], [c2, c1], [c3, c1, c2], [c3, c1, c2]][d & 3]!;
      for (const c of order) if (tryRow(c, d)) return this.set(0, c, d);
    }
    return false;
  }

  /** ov101_021D32EC: the middle or right reel stopped first (these slips can pass the limit). */
  private aimOtherFirst(i: number, t: number): boolean {
    for (let v = 1; v <= 3; v++) if (this.sym(i, v) === t) return this.set(i, v, 0);
    for (let d = 1; d <= this.limit(); d++) {
      if (this.sym(i, 1 - d) !== t) continue;
      const m = d % 4;
      if (m === 1) return this.set(i, 3, d + 2);
      if (m === 2 || m === 3) return this.set(i, 2, d + 1);
      return this.set(i, 1, d);
    }
    return false;
  }

  /** ov101_021D3394: the middle or right reel stopped second or third. */
  private aimOtherLater(i: number, t: number): boolean {
    const [c1, c2, c3] = this.candidates(i);
    if (this.sym(i, c1) === t) return this.set(i, c1, 0);
    if (c2 && this.sym(i, c2) === t) return this.set(i, c2, 0);
    if (c3 && this.sym(i, c3) === t) return this.set(i, c3, 0);
    const search = (c: number) => {
      for (let d = 1; d <= this.limit(); d++) if (this.sym(i, c - d) === t) return this.set(i, c, d);
      return false;
    };
    const pos = this.reels[i]!.pos;
    const order = !c2 ? [c1] : !c3 ? (pos & 1 ? [c1, c2] : [c2, c1]) : [[c1, c2, c3], [c2, c3, c1], [c3, c1, c2]][pos % 3]!;
    return order.some((c) => search(c));
  }

  /** ov101_021D394C: the rows a reel stopped second or third may land the symbol on (0 = none). */
  private candidates(i: number): [number, number, number] {
    const [l, m, r] = this.reels.map((x) => x.stop !== 1);
    const [tl, tm, tr] = this.reels.map((x) => x.target) as [number, number, number];
    if (i === 0) {
      if (m && r) return [tm === tr ? tm : tr === 1 ? 3 : 1, 0, 0];
      if (m) return tm === 2 ? [1, 2, 3] : [tm, 0, 0];
      return tr === 2 ? [tr, 0, 0] : [1, 3, 0];
    }
    if (i === 1) {
      if (l && r) return [tl === tr ? tl : 2, 0, 0];
      const other = l ? tl : tr;
      return other === 2 ? [2, 0, 0] : other === 1 ? [1, 2, 0] : [2, 3, 0];
    }
    if (l && m) return [tl === tm ? tl : tl === 1 ? 3 : 1, 0, 0];
    if (l) return tl === 2 ? [2, 0, 0] : [1, 3, 0];
    return tm === 2 ? [1, 2, 3] : [tm, 0, 0];
  }

  /** ov101_021D2DC0 → ov101_021D3738: REPLAY onto the middle row. */
  private aimBonus(i: number): boolean {
    if (!this.flags) return false;
    const t = flagSymbol(this.flags);
    for (let s = 0; s <= this.limit(); s++) if (this.sym(i, 2 - s) === t) return this.set(i, 2, s);
    return false;
  }

  private stoppedCount(): number {
    return this.reels.filter((r) => r.stop !== 1).length;
  }

  /** ov101_021D3780: no win (the first stop: the left reel shows no cherry; later stops slip at least once). */
  private avoid(i: number): void {
    const first = this.stoppedCount() < 2;
    if (first && i !== 0) return;
    const reel = this.reels[i]!;
    if (first) {
      for (let s = 0; s <= SLOT.strip; s++)
        if (this.noCherry(s)) {
          reel.slip = s;
          return;
        }
      throw new Error('slots: no slip keeps cherries off the left reel');
    }
    for (let s = 1; s <= SLOT.strip; s++)
      if (!this.anyLineWith(i, s, i === 0)) {
        reel.slip = s;
        return;
      }
    throw new Error(`slots: no slip avoids a line on reel ${i}`);
  }

  /** ov101_021D3B50 / 3C9C / 3DD4: a line would win with reel `i` slipped `s` (the others at their remaining slip). */
  private anyLineWith(i: number, s: number, cherry: boolean): boolean {
    const slip = this.reels.map((r, k) => (k === i ? s : r.slip));
    return LINES.some(({ rows }) => {
      const [a, b, c] = rows.map((k, r) => this.sym(r, k - slip[r]!)) as [number, number, number];
      return (cherry && a === SYM.cherry) || (a === b && a === c);
    });
  }

  /** ov101_021D3830: no middle-row line in a bonus round. */
  private avoidBonus(i: number): void {
    const first = this.stoppedCount() < 2;
    if (first && i !== 0) return;
    const reel = this.reels[i]!;
    if (first) {
      for (let s = 0; s < SLOT.strip; s++)
        if (this.sym(0, 2 - s) !== SYM.cherry) {
          reel.slip = s;
          return;
        }
      throw new Error('slots: no slip keeps a cherry off the middle row');
    }
    const slip = this.reels.map((r) => r.slip);
    const max = i === 0 ? SLOT.strip - 1 : SLOT.strip;
    for (let s = 0; s <= max; s++) {
      slip[i] = s;
      const [a, b, c] = [0, 1, 2].map((r) => this.sym(r, 2 - slip[r]!)) as [number, number, number];
      if (!((i === 0 && a === SYM.cherry) || (a === b && a === c))) {
        reel.slip = s;
        return;
      }
    }
    throw new Error(`slots: no slip avoids the middle line on reel ${i}`);
  }

  // ------------------------------------------------------------------ the payout counter (ov101_021D4614)

  private startPay(): void {
    this.pay.done = false;
    this.pay.counter = 0;
    this.pay.state = 1;
  }

  private payTask(input: SlotInput, pressed: (b: Button) => boolean): void {
    const p = this.pay;
    if (p.state === 1) {
      if (!this.lines) throw new Error('slots: a payout count without a line');
      for (let b = 0; b < LINES.length; b++) {
        if (!(this.lines & BIT(b))) continue;
        if (p.flashes.length >= 2) throw new Error('slots: more than two lines to flash');
        p.flashes.push({ line: b, amount: this.payout, level: 0, phase: 0, pulses: 0, done: false });
      }
      p.state = 2;
      return;
    }
    if (p.state === 2) {
      if (p.flashes.some((f) => !f.done)) return;
      p.state = 3;
    }
    if (p.state !== 3) return;
    if (pressed('x') || this.payout === 0) {
      this.emit({ se: 'coin' });
      this.coins = Math.min(SLOT.maxCoins, this.coins + this.payout);
      if (this.bonusMode) this.gained += this.payout;
      this.payout = 0;
      for (const f of p.flashes) this.lamps[f.line] = 0;
      p.flashes = [];
      p.done = true;
      p.state = 0;
      return;
    }
    const mask = (['a', 'b', 'x', 'y'] as const).some((b) => input.held.includes(b)) ? 1 : 3;
    p.counter++;
    if ((p.counter & mask) === 0) {
      this.payout--;
      this.coins = Math.min(SLOT.maxCoins, this.coins + 1);
      this.emit({ se: 'coin' });
      if (this.bonusMode) this.gained++;
    }
  }

  // ------------------------------------------------------------------ the presentation sequence (ov101_021D4824)

  private startSeq(id: number): void {
    this.seq.id = id;
    this.seq.step = 0;
    this.seq.done = false;
    this.seq.timer = 0;
  }

  private needBall(): Ball {
    if (!this.ball) throw new Error(`slots: presentation ${this.seq.id} needs the Poké Ball`);
    return this.ball;
  }
  private needClefairy(): Clefairy {
    if (!this.clefairy) throw new Error(`slots: presentation ${this.seq.id} needs Clefairy`);
    return this.clefairy;
  }

  private sequenceTask(): void {
    const q = this.seq;
    for (let guard = 0; guard < 8; guard++) {
      const next = this.sequenceStep(q);
      if (!next) return;
    }
    throw new Error('slots: the presentation sequence did not settle');
  }

  /** One step of the running sequence; true runs the next step in the same frame. */
  private sequenceStep(q: SlotMachine['seq']): boolean {
    switch (q.id) {
      case SEQ.ballIn:
        if (q.step === 0) {
          this.ball = newBall(this.tick, q.hint);
          q.step++;
        } else if (q.step === 1 && this.needBall().done) {
          setBall(this.ball!, BALL.rise);
          q.step++;
        } else if (q.step === 2 && this.needBall().done) {
          setBall(this.ball!, BALL.wobble);
          q.done = true;
          q.step++;
        }
        return false;
      case SEQ.ballOut:
        if (q.step === 0) {
          setBall(this.needBall(), BALL.leave);
          q.step++;
        } else if (q.step === 1 && this.needBall().done) {
          this.ball = null;
          q.done = true;
          q.step++;
        }
        return false;
      case SEQ.reveal:
        if (q.step === 0) {
          setBall(this.needBall(), BALL.open);
          q.step++;
        } else if (q.step === 1 && this.needBall().done) {
          this.sparkle = newSparkle(this.tick);
          this.clefairy = newClefairy(this.tick, q.kind);
          q.step++;
        } else if (q.step === 2 && this.needClefairy().done) {
          setClefairy(this.clefairy!, CLEF.pop);
          this.ball!.visible = false;
          q.step++;
        } else if (q.step === 3 && this.needClefairy().done) {
          this.sparkle = null;
          q.done = true;
          q.step++;
        }
        return false;
      case SEQ.tellPikachu:
        if (q.step === 0) {
          setClefairy(this.needClefairy(), CLEF.still);
          this.pikachu = newPikachu(this.tick);
          q.timer = 0;
          q.step++;
        } else if (q.step === 1) {
          if (++q.timer >= 48) {
            q.timer = 0;
            q.step++;
            this.emit({ cry: true });
            setClefairy(this.needClefairy(), CLEF.cheer);
          }
        } else if (q.step === 2 && this.pikachu?.done) {
          setClefairy(this.needClefairy(), CLEF.still);
          this.pikachu = null;
          q.step++;
          q.timer = 0;
          q.done = true;
        }
        return false;
      case SEQ.point: {
        const order = this.tables.bonusOrders[this.order]!;
        if (q.step === 0) {
          q.step++;
          q.pointed = 0;
          setClefairy(this.needClefairy(), order.clefairy[0]!);
          return false;
        }
        const stopped = this.reels.filter((r) => r.stop !== 1).length;
        if (q.step === 1 && q.pointed < 2 && q.pointed !== stopped) {
          q.pointed = stopped;
          setClefairy(this.needClefairy(), order.clefairy[q.pointed]!);
        }
        return false;
      }
      case SEQ.still:
        if (q.step === 0) {
          setClefairy(this.needClefairy(), CLEF.still);
          q.step++;
        }
        return false;
      case SEQ.end:
        if (q.step === 0) {
          q.hidden = true;
          this.counters = false;
          this.sparkle = newSparkle(this.tick);
          setClefairy(this.needClefairy(), CLEF.into);
          q.step++;
        } else if (q.step === 1 && this.needClefairy().done) {
          this.clefairy = null;
          this.sparkle = null;
          const ball = this.needBall();
          ball.visible = true;
          setBall(ball, BALL.bounce);
          q.step++;
        } else if (q.step === 2 && this.needBall().done) {
          this.summary = { rounds: this.roundCount, gained: this.gained, frame: 0 };
          q.step++;
        } else if (q.step === 3) {
          if (++q.timer >= 45) {
            q.timer = 0;
            setBall(this.needBall(), BALL.leave);
            q.step++;
          }
        } else if (q.step === 4 && this.needBall().done) {
          this.ball = null;
          q.done = true;
          q.step++;
        }
        return false;
      case SEQ.cheer:
        if (q.step === 0) {
          setClefairy(this.needClefairy(), CLEF.cheer);
          q.done = true;
          q.step++;
        }
        return false;
      case SEQ.wave:
        if (q.step === 0) {
          setClefairy(this.needClefairy(), CLEF.wave);
          q.done = true;
          q.step++;
        }
        return false;
      case SEQ.ballStill:
        if (q.step === 0) {
          setBall(this.needBall(), BALL.still);
          q.step++;
          q.done = true;
        }
        return false;
      case SEQ.tellBall:
        if (q.step === 0) {
          this.sparkle = newSparkle(this.tick);
          setClefairy(this.needClefairy(), CLEF.into);
          q.hidden = true;
          q.step++;
        } else if (q.step === 1 && this.needClefairy().done) {
          this.sparkle = null;
          this.clefairy = null;
          const ball = this.needBall();
          ball.visible = true;
          setBall(ball, BALL.bounce);
          q.timer = 0;
          q.step++;
        } else if (q.step === 2) {
          if (++q.timer >= 30) {
            q.timer = 0;
            q.step++;
            setBall(this.needBall(), BALL.open);
          }
        } else if (q.step === 3 && this.needBall().done) {
          this.sparkle = newSparkle(this.tick);
          this.clefairy = newClefairy(this.tick, q.kind);
          q.hidden = false;
          q.step++;
        } else if (q.step === 4 && this.needClefairy().done) {
          setClefairy(this.clefairy!, CLEF.pop);
          this.ball!.visible = false;
          q.step++;
        } else if (q.step === 5 && this.needClefairy().done) {
          this.sparkle = null;
          q.done = true;
          q.step++;
        }
        return false;
    }
    return false;
  }

  // ------------------------------------------------------------------ the sprites

  /** The Poké Ball (ov101_021D5E04): its animation steps. */
  private ballTask(): void {
    const b = this.ball;
    if (!b) return;
    if (b.sprite) b.sprite.frame += b.sprite.speed;
    for (let guard = 0; guard < 4; guard++) if (!ballStep(b, this.tick, (e) => this.emit(e))) return;
  }

  private sparkleTask(): void {
    const s = this.sparkle;
    if (!s) return;
    if (s.state === 0) {
      if (this.tick <= s.loadAt) return;
      s.state = 1;
    }
    if (s.state === 1) {
      s.frame++;
      if (++s.timer < 15) return;
      s.state = 2;
      s.done = true;
    }
  }

  /** The Pikachu pair (ov101_021D6EC8): in from both sides, two peeks each, then away. */
  private pikachuTask(): void {
    const p = this.pikachu;
    if (!p) return;
    const leftAt = () => ({ x: -32 + p.at.x, y: 228 - p.at.y });
    const rightAt = () => ({ x: 288 - p.at.x, y: 228 - p.at.y });
    const nudge = (dx: number, dy: number, which: 'left' | 'right' | 'both') => {
      p.at.x += dx;
      p.at.y += dy;
      if (which !== 'right') p.left = leftAt();
      if (which !== 'left') p.right = rightAt();
    };
    switch (p.state) {
      case 0:
        if (this.tick <= p.loadAt) return;
        p.shown = true;
        p.state = 1;
      // falls through
      case 1: {
        let n = 0;
        p.at.x += 8;
        p.at.y += 8;
        if (p.at.x >= 64) {
          p.at.x = 64;
          n++;
        }
        if (p.at.y >= 56) {
          p.at.y = 64;
          n++;
        }
        p.left = leftAt();
        p.right = rightAt();
        if (n === 2) p.state++;
        return;
      }
      case 2:
        if (++p.timer < 8) return;
        p.timer = 0;
        p.state = 3;
      // falls through
      case 3:
      case 4:
      case 5:
      case 6: {
        const up = p.state === 3 || p.state === 5;
        nudge(up ? -2 : 2, up ? -4 : 4, p.state <= 4 ? 'left' : 'right');
        if (++p.timer < 4) return;
        p.timer = 0;
        if (p.state === 6) {
          p.state = ++p.count < 2 ? 3 : 7;
          if (p.state === 7) p.count = 0;
        } else p.state++;
        return;
      }
      case 7:
        if (++p.timer < 8) return;
        p.timer = 0;
        p.state = 8;
      // falls through
      case 8:
      case 9: {
        const up = p.state === 8;
        nudge(up ? -2 : 2, up ? -4 : 4, 'left');
        p.right = rightAt();
        if (++p.timer < 4) return;
        p.timer = 0;
        if (p.state === 9) {
          p.state = ++p.count < 2 ? 8 : 10;
          if (p.state === 10) p.count = 0;
        } else p.state++;
        return;
      }
      case 10:
        nudge(-8, -8, 'left');
        p.right = rightAt();
        p.state++;
        p.done = true;
        return;
    }
  }

  /** Clefairy (ov101_021D6808). */
  private clefairyTask(): void {
    const c = this.clefairy;
    if (!c) return;
    for (let guard = 0; guard < 4; guard++) if (!clefairyStep(c, this.tick, (e) => this.emit(e))) return;
  }

  /** ov101_021D7B08: the three 7s of the winning line slide from the reels to the field, wait, blink three times. */
  private startSevens(): void {
    let line = 0;
    while (line < LINES.length && !(this.lines & BIT(line))) line++;
    if (line >= LINES.length) throw new Error('slots: a 7 flash without a line');
    this.sevens = { loadAt: this.tick, state: 0, timer: 0, count: 0, symbol: this.result, line, at: [], from: 0, visible: true, done: false };
  }

  private sevensTask(): void {
    const s = this.sevens;
    if (!s) return;
    switch (s.state) {
      case 0:
        if (this.tick <= s.loadAt) return;
        s.at = this.tables.lineFlash[s.line]!.map((p) => ({ ...p }));
        s.from = Math.max(...s.at.map((p) => p.y));
        s.state++;
        return;
      case 1: {
        let moving = false;
        for (const p of s.at) {
          p.y += 4;
          if (p.y >= 192 + 48) p.y = 192 + 48;
          else moving = true;
        }
        if (!moving) s.state++;
        return;
      }
      case 2:
      case 4:
        if (++s.timer >= 30) {
          s.timer = 0;
          s.state++;
        }
        return;
      case 3:
        s.timer++;
        s.visible = s.timer >= 12;
        if (s.timer >= 30) {
          s.timer = 0;
          if (++s.count >= 3) {
            s.count = 0;
            s.state++;
          }
        }
        return;
      case 5:
        s.visible = false;
        s.done = true;
        s.state++;
        return;
    }
  }

  // ------------------------------------------------------------------ palettes (lamps, light show, field)

  private lampsOff(): void {
    this.lamps = [0, 0, 0, 0, 0];
  }
  /** ov101_021D5010: every line lit to 10/16 after a bet. */
  private lampsBet(): void {
    this.lamps = [10, 10, 10, 10, 10];
  }
  /** ov101_021D5938 × 3: every stop button's BG palette back to armed. */
  private armStops(): void {
    this.stopPalettes = ['armed', 'armed', 'armed'];
  }
  /** The stop buttons' BG palettes (ov101_021D58F4 pressed, ov101_021D5938 armed). */
  private stopPalettes: ('armed' | 'pressed')[] = ['armed', 'armed', 'armed'];

  private startLightShow(): void {
    if (this.lightShow) throw new Error('slots: the light show started twice');
    this.lightShow = { index: 0, first: true, wait: 0 };
  }
  private stopLightShow(): void {
    this.lightShow = null;
    this.lampsOff();
  }

  private paletteTasks(): void {
    for (const f of this.pay.flashes) {
      const step = f.phase >= 2 ? 8 : 4;
      if (f.phase === 0 || f.phase === 2) {
        f.level = Math.min(16, f.level + step);
        if (f.level === 16) f.phase++;
      } else if (f.phase === 1 || f.phase === 3) {
        f.level = Math.max(0, f.level - step);
        if (f.level === 0) {
          if (f.phase === 3) f.phase = 2;
          else if (++f.pulses >= 4) {
            f.phase = f.amount ? 2 : 4;
            f.done = true;
          } else f.phase = 0;
        }
      }
      this.lamps[f.line] = f.level;
    }
    const show = this.lightShow;
    if (show) {
      const e = this.tables.lightShow[show.index]!;
      let done = true;
      for (let i = 0; i < 5; i++) {
        if (!(e.mask & BIT(i))) continue;
        if (show.first) {
          this.lamps[i] = e.from;
          done = false;
        } else if (e.from < e.to) {
          this.lamps[i] = this.lamps[i]! + e.step;
          if (this.lamps[i]! >= e.to) this.lamps[i] = e.to;
          else done = false;
        } else {
          this.lamps[i] = this.lamps[i]! - e.step;
          if (this.lamps[i]! <= e.to) this.lamps[i] = e.to;
          else done = false;
        }
      }
      if (e.mask & BIT(5)) {
        if (++show.wait >= e.from) show.wait = 0;
        else done = false;
      }
      show.first = false;
      if (done) {
        show.first = true;
        show.index++;
        if (this.tables.lightShow[show.index]!.mask === BIT(6)) show.index = 0;
      }
    }
    if (this.fieldFade === 'in') {
      this.fieldBonus = Math.min(16, this.fieldBonus + 0.5);
      if (this.fieldBonus === 16 || this.state === ST.quit) this.fieldFade = null;
    } else if (this.fieldFade === 'out') {
      this.fieldBonus = Math.max(0, this.fieldBonus - 0.5);
      if (this.fieldBonus === 0 || this.state === ST.quit) this.fieldFade = null;
    }
    const m = this.moon;
    if (m) {
      if (this.state === ST.quit) this.moon = null;
      else if (m.state === 0) {
        m.level += 1;
        if (m.level > 16) {
          m.level = 16;
          m.state = 1;
        }
      } else {
        m.level = Math.max(0, m.level - 0.25);
        if (m.level === 0) this.moon = null;
      }
    }
  }

  /** ov101_021D53F8: the moon pulse (from 8/16 up to 16 in a frame per step, then down a quarter a frame) and its sound. */
  private startMoon(kind: 'red' | 'blue'): void {
    this.moon = { kind, level: 8, state: 0 };
    this.emit({ se: 'moon' });
  }

  // ------------------------------------------------------------------ the BGM switch (ov101_021D18F4)

  private requestMusic(bgm: SlotMusic): void {
    if (this.music.current === bgm || this.music.pending === bgm) return;
    this.music.pending = bgm;
    this.music.state = 1;
  }

  private musicTask(): void {
    const m = this.music;
    if (m.state === 1) {
      this.emit({ music: 'stop', bgm: m.current });
      m.state = 2;
    } else if (m.state === 2) {
      this.emit({ music: 'play', bgm: m.pending! });
      m.current = m.pending!;
      m.pending = null;
      m.state = 0;
    }
  }

  // ------------------------------------------------------------------ the view

  view(message: SlotsView['message']): SlotsView {
    const reels = this.reels.map((reel, r) =>
      Array.from({ length: 5 }, (_, i) => {
        const v = (reel.px + 32 * i) % 160;
        const k = Math.floor(v / 32);
        return { y: v + 16 + reel.bounce, symbol: this.tables.reels[r]![(reel.pos + k) % SLOT.strip]! };
      }),
    );
    const b = this.ball;
    const c = this.clefairy;
    return {
      app: 'slots',
      tick: this.tick,
      fade: this.fade,
      prompt: this.phase !== 1 || this.message !== null ? null : PROMPTS[this.state] ?? null,
      reels,
      stops: [...this.stopPalettes],
      lamps: this.lamps.map((l) => Math.floor(l)),
      credit: this.coins,
      payout: this.payout,
      ball: b?.sprite && b.visible ? { kind: b.kind, anim: b.sprite.anim, frame: Math.floor(b.sprite.frame), x: b.x, y: b.y, scale: b.scale, rotation: (b.rotation * 360) / 65536 } : null,
      sparkle: this.sparkle && this.sparkle.state === 1 ? { frame: this.sparkle.frame } : null,
      clefairy: c?.sprite ? { kind: c.kind, anim: c.sprite.anim, frame: Math.floor(c.sprite.frame), y: c.y, scale: c.scale } : null,
      pikachu: this.pikachu?.shown ? { left: { ...this.pikachu.left }, right: { ...this.pikachu.right } } : null,
      sevens: this.sevens && this.sevens.state >= 1 && this.sevens.visible ? { symbol: this.sevens.symbol, from: this.sevens.from, at: this.sevens.at.map((p) => ({ ...p })) } : null,
      counters: this.counters && !this.seq.hidden ? { spins: Math.min(99, this.spinsLeft), gained: Math.min(SLOT.maxCoins, this.gained) } : null,
      banner: this.banner ? { ...this.banner } : null,
      summary: this.summary ? { rounds: this.summary.rounds, gained: this.summary.gained } : null,
      field: { bonus: Math.floor(this.fieldBonus), moon: this.moon ? { kind: this.moon.kind, level: Math.floor(this.moon.level) } : null },
      message,
    };
  }

  /** For tests and the app: where the machine is (state index, the decomp's), the flags drawn, the bonus. */
  /**
   * For tests and tools: the decomp state index, the flags (cleared at each bet; `spinFlags` keeps the last spin's), the
   * lines and symbol of the last result, the bonus, each reel's index, scroll, target row and slip, and the window of the last result ([reel][row 1–3]).
   */
  debug(): { state: number; flags: number; spinFlags: number; resultFlags: number; lines: number; result: number; chance: number; roundCount: number; bonusType: number; bonusClass: number; spinsLeft: number; gained: number; reels: { pos: number; px: number; target: number; slip: number }[]; window: number[][] } {
    return {
      state: this.state, flags: this.flags, spinFlags: this.spinFlags, resultFlags: this.resultFlags, lines: this.lines, result: this.result, chance: this.chance, roundCount: this.roundCount, bonusType: this.bonusType,
      bonusClass: this.bonusClass, spinsLeft: this.spinsLeft, gained: this.gained, reels: this.reels.map((r) => ({ pos: r.pos, px: r.px, target: r.target, slip: r.slip })), window: this.resultWindow,
    };
  }
}

/** One line's symbol (left, middle, right): it wins when its left symbol is cherries or all three are equal. */
export function lineSymbol(symbols: readonly number[]): number {
  const [a, b, c] = symbols as [number, number, number];
  return a === SYM.cherry || (a === b && a === c) ? a : SYM.none;
}

/**
 * ov101_021D5778 over the window ([reel][row 1–3]): the lines that won (bits, unk_48) and the symbol of the last winning
 * line in check order (top, middle, bottom, diagonal down, diagonal up).
 */
export function slotLines(window: readonly (readonly number[])[]): { result: number; lines: number } {
  let result: number = SYM.none;
  let lines = 0;
  for (const line of LINES) {
    const s = lineSymbol(line.rows.map((k, r) => window[r]![k - 1]!));
    if (s === SYM.none) continue;
    result = s;
    lines |= BIT(line.bit);
  }
  return { result, lines };
}

/** ov101_021D597C: the result symbol's rate times the lines won (even when they won with different symbols). */
export function slotPayout(payouts: readonly number[], result: number, lines: number): number {
  if (result === SYM.none) throw new Error('slots: a payout without a line');
  let n = 0;
  for (let b = 0; b < LINES.length; b++) if (lines & BIT(b)) n++;
  return payouts[result]! * n;
}

/** ov101_021D406C's walk: the first share the roll falls under (each share taken off the roll in turn, not below 0), or -1. */
function share(shares: readonly number[], roll: number): number {
  let v = roll;
  for (let i = 0; i < shares.length; i++) {
    if (v < shares[i]!) return i;
    v = Math.max(0, v - shares[i]!);
  }
  return -1;
}

/** ov101_021D40A8 after its gate: the win flag for a `pick` roll (0–99); what the shares leave is REPLAY (bit 0). */
export function winFlag(tables: Pick<SlotTables, 'winFlags'>, mode: number, pick: number): number {
  const i = share(tables.winFlags[mode]!, pick);
  return BIT(i < 0 ? SLOT_FLAG.replay : WIN_ORDER[i]!);
}

/**
 * ov101_021D4394: a standby spin's flag from its `pick` roll and its `gate` roll (drawn in that order). Under the gate
 * (`standbySmall`) a small flag: cherries, Moon Stone, then Pikachu by the table's shares, entry 1 checked twice as the
 * DS does; else REPLAY. Over it, the bonus type's 7 (types 0–2 red, 3–5 Galactic).
 */
export function standbyFlag(tables: Pick<SlotTables, 'standbyFlags' | 'standbySmall'>, mode: number, bonusType: number, pick: number, gate: number): number {
  if (!(gate < tables.standbySmall[mode]!)) return BIT(bonusType < 3 ? SLOT_FLAG.red7 : SLOT_FLAG.galactic7);
  const s = tables.standbyFlags[mode]!;
  const i = share([s[0]!, s[1]!, s[1]!], pick);
  return BIT(i < 0 ? SLOT_FLAG.replay : [SLOT_FLAG.cherry, SLOT_FLAG.moon, SLOT_FLAG.pikachu][i]!);
}

/** ov101_021D4210: the bonus type and class for a roll. */
export function bonusDraw(tables: Pick<SlotTables, 'bonusTypes'>, mode: number, roll: number): { type: number; class: number } {
  const rows = tables.bonusTypes[mode]!;
  const i = share(rows.map((r) => r.chance), roll);
  if (i < 0) throw new Error('slots: the bonus type draw found no row');
  return { type: rows[i]!.type, class: rows[i]!.class };
}

/** ov101_021D42D0: Clefairy's kind for the bonus class and a roll. */
export function clefairyKind(tables: Pick<SlotTables, 'clefairyKinds'>, mode: number, cls: number, roll: number): number {
  const rows = tables.clefairyKinds[mode]![cls]!;
  const i = share(rows.map((r) => r.chance), roll);
  if (i < 0) throw new Error('slots: the Clefairy draw found no kind');
  return rows[i]!.kind;
}

/** ov101_021D44FC: the continue chance after a round: −10 when the red moon was hit, else by the roll (−10, −5); not below 0. */
export function continueDrop(tables: Pick<SlotTables, 'continueDrop'>, mode: number, chance: number, redMoonHit: boolean, roll: number): number {
  const [p10, p5] = tables.continueDrop[mode]! as [number, number];
  let v = chance;
  if (redMoonHit) v -= 10;
  else if (roll < p10) v -= 10;
  else if (roll - p10 < p5) v -= 5;
  return Math.max(0, v);
}

/** The tell between rounds (presentation only): Clefairy back into the ball, only its cry, or the Pikachu pair. */
export type SlotTell = 'ball' | 'cry' | 'pikachu';
/** ov101_021D4550: the tell from the first row whose minimum the chance reaches. */
export function endTell(tables: Pick<SlotTables, 'endTells'>, mode: number, chance: number, roll: number): SlotTell {
  const row = tables.endTells[mode]!.find((t) => chance >= t.min);
  if (!row) throw new Error(`slots: no end tell row for ${chance}%`);
  const i = share([row.a, row.b], roll);
  return i === 0 ? 'ball' : i === 1 ? 'cry' : 'pikachu';
}

/** ov101_021D5618: the symbol a flag lines up. */
export function flagSymbol(flags: number): number {
  if (flags & (BIT(0) | BIT(1))) return SYM.replay;
  if (flags & (BIT(2) | BIT(3))) return SYM.cherry;
  if (flags & (BIT(4) | BIT(5))) return SYM.pikachu;
  if (flags & (BIT(6) | BIT(7))) return SYM.moonStone;
  if (flags & BIT(8)) return SYM.galactic7;
  if (flags & BIT(9)) return SYM.red7;
  return SYM.none;
}

/** ov101_021D5814: the Poké Ball for a flag (0 cherries, 1 REPLAY, 2 Pikachu, 3 Moon Stone). */
function hintKind(flags: number): number {
  if (flags & (BIT(0) | BIT(1))) return 1;
  if (flags & (BIT(2) | BIT(3))) return 0;
  if (flags & (BIT(4) | BIT(5))) return 2;
  if (flags & (BIT(6) | BIT(7))) return 3;
  throw new Error(`slots: no Poké Ball for flags ${flags}`);
}

function newBall(tick: number, kind: number): Ball {
  return { anim: BALL.create, step: 0, done: false, loadAt: tick, kind, base: { x: 128, y: 160 }, x: 0, y: 224, scale: 1, rotation: 0, rotStep: 0, timer: 0, sprite: null, visible: true };
}
function setBall(b: Ball, anim: number): void {
  b.anim = anim;
  b.step = 0;
  b.done = false;
  b.timer = 0;
}
function playBall(b: Ball, anim: number): void {
  b.sprite = { anim, frame: 0, speed: 1 };
}

/** One step of the ball's animation; true runs the next step in the same frame. */
function ballStep(b: Ball, tick: number, emit: (e: SlotEvent) => void): boolean {
  switch (b.anim) {
    case BALL.create:
      if (b.step === 0) {
        b.loadAt = tick;
        b.step++;
      } else if (b.step === 1 && tick > b.loadAt) b.step++;
      else if (b.step === 2) {
        b.x = 0;
        b.y = 224;
        playBall(b, 0);
        b.done = true;
        b.step++;
      }
      return false;
    case BALL.rise:
      if (b.step === 0) {
        b.x = 128;
        b.y = 192;
        b.scale = 2;
        b.rotation = 0;
        playBall(b, 0);
        emit({ se: 'ball-rise' });
        b.step++;
      } else if (b.step === 1) {
        b.y -= 4;
        b.scale -= 0x1c7 / 4096;
        if (++b.timer >= 9) {
          b.y = 160;
          b.scale = 1;
          b.timer = 0;
          b.step++;
        }
      } else if (b.step === 2 && ++b.timer >= 3) {
        b.timer = 0;
        b.done = true;
        b.step++;
      }
      return false;
    case BALL.open:
      if (b.step === 0) {
        playBall(b, 1);
        emit({ se: 'ball-open' });
        b.step++;
      } else if (b.step === 1 && ++b.timer >= 4) {
        b.timer = 0;
        b.done = true;
        b.step++;
      }
      return false;
    case BALL.bounce:
      if (b.step === 0) {
        b.base = { x: 128, y: 160 };
        b.x = 128;
        b.y = 160;
        b.scale = 1;
        b.rotation = 0;
        playBall(b, 3);
        b.step++;
        return true;
      }
      if (b.step === 1) {
        b.y = b.base.y + BOUNCE_Y[b.timer >> 1]!;
        if (++b.timer >= 16) {
          b.timer = 0;
          b.done = true;
          b.step++;
        }
      }
      return false;
    case BALL.leave:
      if (b.step === 0) {
        b.base = { x: 128, y: 160 };
        b.x = 128;
        b.y = 160;
        b.scale = 1;
        b.rotation = 0;
        playBall(b, 4);
        b.step++;
        return true;
      }
      if (b.step === 1) {
        b.y += 4;
        b.scale += 0x1c7 / 4096;
        if (++b.timer >= 10) {
          b.y = 256;
          b.scale = 1;
          b.timer = 0;
          b.done = true;
          b.step++;
        }
      }
      return false;
    case BALL.wobble:
      if (b.step === 0) {
        b.base = { x: 128, y: 160 };
        b.x = 128;
        b.y = 160;
        b.scale = 1;
        b.rotation = 0;
        b.rotStep = 0;
        b.timer = 0;
        b.done = true;
        playBall(b, 2);
        b.step++;
        return true;
      }
      b.rotation += WOBBLE.rot[b.rotStep]!;
      b.x += WOBBLE.x[b.rotStep]!;
      if (++b.timer >= WOBBLE.t[b.rotStep]!) {
        b.rotStep = (b.rotStep + 1) % 8;
        b.timer = 0;
      }
      return false;
    case BALL.still:
      if (b.step === 0) {
        b.base = { x: 128, y: 160 };
        b.x = 128;
        b.y = 160;
        b.scale = 1;
        b.rotation = 0;
        b.done = true;
        playBall(b, 2);
        b.step++;
      }
      return false;
  }
  throw new Error(`slots: no ball animation ${b.anim}`);
}

function newSparkle(tick: number): Sparkle {
  return { loadAt: tick, state: 0, timer: 0, frame: 0, done: false };
}
function newPikachu(tick: number): Pikachu {
  return { loadAt: tick, state: 0, timer: 0, count: 0, at: { x: 0, y: 0 }, left: { x: -32, y: 256 }, right: { x: 288, y: 256 }, shown: false, done: false };
}
function newClefairy(tick: number, kind: number): Clefairy {
  return { anim: CLEF.create, step: 0, done: false, loadAt: tick, kind, y: 256, scale: 1, timer: 0, sprite: null };
}
function setClefairy(c: Clefairy, anim: number): void {
  c.anim = anim;
  c.step = 0;
  c.done = false;
  c.timer = 0;
}

/** One step of Clefairy's animation (Unk_ov101_021D9330); true runs the next step in the same frame. */
function clefairyStep(c: Clefairy, tick: number, emit: (e: SlotEvent) => void): boolean {
  const sprite = c.sprite;
  switch (c.anim) {
    case CLEF.create:
      if (c.step === 0 && tick > c.loadAt) {
        c.sprite = { anim: 0, frame: 0, speed: 1 };
        c.y = 256;
        c.done = true;
        c.step++;
      }
      return false;
    case CLEF.pop:
      if (!sprite) throw new Error('slots: Clefairy pops out before it is drawn');
      if (c.step === 0) {
        c.scale = 0.25;
        c.y = 128;
        c.sprite = { anim: 1, frame: 0, speed: 0 };
        c.step++;
      } else if (c.step === 1) {
        c.scale += 0xc0 / 4096;
        if (++c.timer >= 16) {
          c.scale = 1;
          c.timer = 0;
          c.step++;
          emit({ cry: true });
        }
      } else if (c.step === 2) {
        sprite.frame += 1;
        if (++c.timer >= 9) {
          c.timer = 0;
          c.step++;
          c.done = true;
        }
      }
      return false;
    case CLEF.into:
      if (c.step === 0) {
        c.scale = 1;
        c.y = 128;
        c.sprite = { anim: 1, frame: 0, speed: 0 };
        emit({ se: 'clefairy-in' });
        c.step++;
      } else if (c.step === 1) {
        c.scale -= 0x180 / 4096;
        if (++c.timer >= 8) {
          c.y = 272;
          c.scale = 1;
          c.timer = 0;
          c.step++;
          c.done = true;
        }
      }
      return false;
    case CLEF.still:
    case CLEF.cheer:
    case CLEF.pointB:
    case CLEF.pointY:
    case CLEF.pointA:
    case CLEF.wave:
      if (c.step === 0) {
        c.scale = 1;
        c.y = 128;
        if (c.anim === CLEF.still) c.sprite = { anim: 0, frame: 0, speed: 0 };
        else if (c.anim === CLEF.cheer) c.sprite = sprite?.anim === 2 ? { ...sprite, speed: 0.5 } : { anim: 2, frame: 0, speed: 0.5 };
        else if (c.anim === CLEF.wave) c.sprite = { anim: 5, frame: 0, speed: 1 };
        else c.sprite = { anim: CLEF_SPRITE[c.anim]!, frame: 0, speed: 1 };
        c.done = true;
        c.step++;
        return false;
      }
      if (c.sprite) c.sprite.frame += c.sprite.speed;
      return false;
  }
  throw new Error(`slots: no Clefairy animation ${c.anim}`);
}
