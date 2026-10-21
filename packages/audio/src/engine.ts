import type { InstrumentRegion } from '@opensinnoh/contracts';
import { PREFIX_IF, PREFIX_RANDOM, PREFIX_VAR } from './commands.ts';
import {
  attackRate,
  CHANNEL_CLOCK,
  channelAmplitude,
  decibelSquare,
  ENVELOPE_MIN,
  fallRate,
  GAME_TICK_CYCLES,
  PSG_BASE_TIMER,
  sinIdx,
  SOUND_FRAME_CYCLES,
  SOUND_FRAME_SECONDS,
  SoundRandom,
  sustainLevel,
  timerFor,
} from './tables.ts';
import type { Wave } from './wave.ts';

/**
 * The DS sound engine (docs/research/audio.md §2–3): the NITRO sequencer (players, tracks, the SSEQ
 * commands, tempo at 240 per tick), the 16 hardware channels with their envelopes, LFO, sweep and
 * portamento, channel allocation by priority, and the NNS handle layer the game drives (volume fades,
 * pause, stop). One `frame()` is one sound frame (≈ 5.21 ms). `render()` mixes PCM/PSG/noise at the
 * output rate with the DS's sample-and-hold (no interpolation) and runs frames in between. Without a
 * sample rate (`silent`) the channels only advance by frame: the importer measures sequence lengths so.
 */

export interface SequenceData {
  data: Uint8Array;
  bank: string;
  volume: number;
  channelPriority: number;
  playerPriority: number;
  player: string;
}

export interface BankData {
  waveArchives: (string | null)[];
  instruments: (InstrumentRegion[] | null)[];
}

export interface PlayerData {
  maxSequences: number;
  channels: number;
}

export interface EngineData {
  sequence(id: string): SequenceData;
  bank(id: string): BankData;
  waves(archive: string): Wave[];
  player(id: string): PlayerData;
}

const ATTACK = 0;
const DECAY = 1;
const SUSTAIN = 2;
const RELEASE = 3;
const PSG_CHANNELS = 0x3f00;
const NOISE_CHANNELS = 0xc000;
/** SND's channel allocation order: channels 0–3 last among the PCM-only ones. */
const ALLOCATION_ORDER = [4, 5, 6, 7, 2, 0, 3, 1, 8, 9, 10, 11, 14, 12, 15, 13];
/** Sound frames per game tick (NNS fades count game ticks: one NNS_SndMain per tick). */
const FRAMES_PER_TICK = GAME_TICK_CYCLES / SOUND_FRAME_CYCLES;
const MAX_COMMANDS_PER_TICK = 10_000;

interface Lfo {
  type: number;
  speed: number;
  depth: number;
  range: number;
  delay: number;
}

class Channel {
  active = false;
  type: InstrumentRegion['type'] = 'pcm';
  wave: Wave | null = null;
  duty = 0;
  priority = 0;
  track: Track | null = null;
  key = 60;
  baseKey = 60;
  velocity = 127;
  /** Ticks until the note releases; ≤ 0 = until stopped (a 0-length note plays its wave to the end). */
  length = 0;
  /** Not updated since its note-on (a fast-forwarded sequencer can end a note before it has sounded). */
  fresh = false;
  envState = ATTACK;
  envLevel = ENVELOPE_MIN;
  attack = 0;
  decay = 0;
  sustain = 0;
  release = 0;
  instPan = 0;
  lfo: Lfo = { type: 0, speed: 16, depth: 0, range: 1, delay: 0 };
  lfoCounter = 0;
  lfoDelay = 0;
  sweepPitch = 0;
  sweepLength = 0;
  sweepCounter = 0;
  autoSweep = true;
  /** Track and player parts, set by the track every frame. */
  userVolume = 0;
  userPitch = 0;
  userPan = 0;
  // Output, recomputed every frame.
  amplitude = 0;
  left = 0;
  right = 0;
  /** Source steps (samples, or PSG/noise steps) per second. */
  rate = 0;
  // Playback.
  pos = 0;
  lfsr = 0x7fff;
  noiseOut = 1;

  constructor(readonly index: number) {}
}

interface Track {
  data: Uint8Array;
  pc: number;
  ended: boolean;
  wait: number;
  stack: { pc: number; count: number }[];
  program: number;
  volume: number;
  expression: number;
  pan: number;
  pitchBend: number;
  bendRange: number;
  priority: number;
  transpose: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  lfo: Lfo;
  portamento: boolean;
  portaKey: number;
  portaTime: number;
  sweepPitch: number;
  tie: boolean;
  noteWait: boolean;
  cmp: boolean;
  channels: Set<Channel>;
  /** NNS_SndPlayerSetTrackPitch / Pan. */
  extPitch: number;
  extPan: number;
}

interface Player {
  handle: string;
  seq: string;
  data: SequenceData;
  bank: BankData;
  channels: number;
  priority: number;
  tracks: (Track | null)[];
  tempo: number;
  tempoCounter: number;
  volume: number;
  vars: Int16Array;
  paused: boolean;
  initialVolume: number;
  fade: { from: number; to: number; ticks: number; elapsed: number };
  stopAfterFade: boolean;
  /** Sequence ticks run (NNS_SndPlayerGetTick). */
  tickCounter: number;
}

function newTrack(data: Uint8Array, pc: number): Track {
  return {
    data,
    pc,
    ended: false,
    wait: 0,
    stack: [],
    program: 0,
    volume: 127,
    expression: 127,
    pan: 0,
    pitchBend: 0,
    bendRange: 2,
    priority: 64,
    transpose: 0,
    attack: 255,
    decay: 255,
    sustain: 255,
    release: 255,
    lfo: { type: 0, speed: 16, depth: 0, range: 1, delay: 0 },
    portamento: false,
    portaKey: 60,
    portaTime: 0,
    sweepPitch: 0,
    tie: false,
    noteWait: true,
    cmp: true,
    channels: new Set(),
    extPitch: 0,
    extPan: 0,
  };
}

const s16 = (v: number) => (v << 16) >> 16;

export class SoundEngine {
  readonly channels = Array.from({ length: 16 }, (_, i) => new Channel(i));
  private readonly players = new Map<string, Player>();
  /** NNS player volumes (NNS_SndPlayerSetPlayerVolume) by sound player id; absent = 127. */
  private readonly playerVolumes = new Map<string, number>();
  private readonly globals = new Int16Array(16).fill(-1);
  private readonly random = new SoundRandom();
  private frameClock = 0;
  /** Sequencer passes owed (fractional `speed`). */
  private sequencerCredit = 0;
  /** Output gain applied after the DS mix (the app's volume option). */
  gain = 1;
  /**
   * The game's speed (fast-forward, ≥ 1): the sequencer and the handles' fades (both counted in ticks) run
   * this many times per sound frame; the channels (envelopes, LFO, pitch) stay in real time, so notes keep
   * their pitch and shape and only come sooner.
   */
  speed = 1;

  /** `sampleRate` null: no mixing (lengths only). */
  constructor(
    private readonly source: EngineData,
    readonly sampleRate: number | null,
  ) {}

  // ------------------------------------------------------------------ handles (NNS)

  start(handle: string, seq: string, bankOverride?: string): void {
    this.stop(handle, 0);
    const data = this.source.sequence(seq);
    const bank = this.source.bank(bankOverride ?? data.bank);
    const player: Player = {
      handle,
      seq,
      data,
      bank,
      channels: this.source.player(data.player).channels || 0xffff,
      priority: data.channelPriority,
      tracks: Array.from({ length: 16 }, () => null),
      tempo: 120,
      // The first frame runs the first tick (the tracks open at once).
      tempoCounter: 240,
      volume: data.volume,
      vars: new Int16Array(16).fill(-1),
      paused: false,
      initialVolume: 127,
      fade: { from: 127, to: 127, ticks: 0, elapsed: 0 },
      stopAfterFade: false,
      tickCounter: 0,
    };
    player.tracks[0] = newTrack(data.data, 0);
    this.players.set(handle, player);
  }

  stop(handle: string, ticks: number): void {
    const p = this.players.get(handle);
    if (!p) return;
    if (ticks > 0) {
      p.fade = { from: this.fadeVolume(p), to: 0, ticks, elapsed: 0 };
      p.stopAfterFade = true;
      return;
    }
    for (const t of p.tracks) if (t) this.closeTrack(t, -1);
    this.players.delete(handle);
  }

  stopAll(): void {
    for (const h of [...this.players.keys()]) this.stop(h, 0);
  }

  moveVolume(handle: string, volume: number, ticks: number): void {
    const p = this.players.get(handle);
    if (!p) return;
    p.fade = { from: this.fadeVolume(p), to: volume, ticks, elapsed: 0 };
  }

  setInitialVolume(handle: string, volume: number): void {
    const p = this.players.get(handle);
    if (p) p.initialVolume = volume;
  }

  /** NNS_SndPlayerSetPlayerVolume: the sound player's own volume, for its sequences now and later. */
  setPlayerVolume(player: string, volume: number): void {
    this.playerVolumes.set(player, volume);
  }

  pause(handle: string, paused: boolean): void {
    const p = this.players.get(handle);
    if (!p || p.paused === paused) return;
    p.paused = paused;
    // SND_PauseSeq: the sounding notes are released at once.
    if (paused) for (const t of p.tracks) if (t) this.releaseTrack(t, 127);
  }

  setPitch(handle: string, pitch: number): void {
    const p = this.players.get(handle);
    if (p) for (const t of p.tracks) if (t) t.extPitch = pitch;
  }

  setPan(handle: string, pan: number): void {
    const p = this.players.get(handle);
    if (p) for (const t of p.tracks) if (t) t.extPan = pan;
  }

  playing(handle: string): boolean {
    return this.players.has(handle);
  }

  handles(): string[] {
    return [...this.players.keys()];
  }

  /** NNS_SndPlayerGetTick: the sequence ticks the handle's player has run (0 when nothing plays on it). */
  ticks(handle: string): number {
    return this.players.get(handle)?.tickCounter ?? 0;
  }

  // ------------------------------------------------------------------ the frame

  /** One sound frame: fades, the sequencer (tempo), the tracks' channel parameters, then the channels. */
  frame(): void {
    for (this.sequencerCredit += this.speed; this.sequencerCredit >= 1; this.sequencerCredit--)
      for (const p of [...this.players.values()]) {
        if (p.fade.elapsed < p.fade.ticks) p.fade.elapsed = Math.min(p.fade.ticks, p.fade.elapsed + 1 / FRAMES_PER_TICK);
        if (p.stopAfterFade && p.fade.elapsed >= p.fade.ticks) {
          p.stopAfterFade = false;
          this.stop(p.handle, 0);
          continue;
        }
        if (!p.paused) this.sequencerFrame(p);
      }
    for (const p of this.players.values()) for (const t of p.tracks) if (t) this.updateTrackChannels(p, t);
    for (const ch of this.channels) if (ch.active) this.updateChannel(ch);
  }

  private sequencerFrame(p: Player): void {
    while (p.tempoCounter >= 240) {
      p.tempoCounter -= 240;
      p.tickCounter++;
      let playing = false;
      for (let i = 0; i < 16; i++) {
        const t = p.tracks[i];
        if (!t) continue;
        if (this.stepTrack(p, t)) {
          this.closeTrack(t, -1);
          p.tracks[i] = null;
        } else playing = true;
      }
      if (!playing) {
        this.players.delete(p.handle);
        return;
      }
    }
    p.tempoCounter += p.tempo;
  }

  /** One tick of a track: note lengths count down; then commands run until a wait. True when the track is done. */
  private stepTrack(p: Player, t: Track): boolean {
    for (const ch of t.channels) {
      if (ch.length > 0 && --ch.length === 0 && ch.envState !== RELEASE) {
        // Fast-forward: a note never ends in the frame it began (it would be silent); it sounds one frame first.
        if (ch.fresh && this.speed > 1) ch.length = 1;
        else this.releaseChannel(ch, -1);
      }
      if (!ch.autoSweep && ch.sweepCounter < ch.sweepLength) ch.sweepCounter++;
    }
    if (t.ended) return t.channels.size === 0;
    if (t.wait > 0) {
      t.wait--;
      if (t.wait > 0) return false;
    }
    let n = 0;
    while (t.wait === 0 && !t.ended) {
      if (++n > MAX_COMMANDS_PER_TICK) throw new Error(`sequence ${p.seq}: more than ${MAX_COMMANDS_PER_TICK} commands without a wait`);
      this.command(p, t);
    }
    return t.ended && t.channels.size === 0;
  }

  private u8(t: Track): number {
    const b = t.data[t.pc++];
    if (b === undefined) throw new Error(`sequence: read past the end at 0x${(t.pc - 1).toString(16)}`);
    return b;
  }

  private varlen(t: Track): number {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = this.u8(t);
      v = (v << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return v;
  }

  private variable(p: Player, i: number): Int16Array {
    return i < 16 ? p.vars : this.globals;
  }

  private command(p: Player, t: Track): void {
    let cmd = this.u8(t);
    let cond = true;
    let prefix: 'random' | 'var' | null = null;
    for (;;) {
      if (cmd === PREFIX_IF) cond = t.cmp;
      else if (cmd === PREFIX_RANDOM) prefix = 'random';
      else if (cmd === PREFIX_VAR) prefix = 'var';
      else break;
      cmd = this.u8(t);
    }
    const last = (read: () => number): number => {
      if (prefix === 'random') {
        const min = s16(this.u8(t) | (this.u8(t) << 8));
        const max = s16(this.u8(t) | (this.u8(t) << 8));
        return min + ((this.random.next() * (max - min + 1)) >> 16);
      }
      if (prefix === 'var') {
        const i = this.u8(t);
        return this.variable(p, i)[i & 15]!;
      }
      return read();
    };
    const u8 = () => this.u8(t);
    const s8 = () => (this.u8(t) << 24) >> 24;
    const u16 = () => this.u8(t) | (this.u8(t) << 8);
    const u24 = () => this.u8(t) | (this.u8(t) << 8) | (this.u8(t) << 16);

    if (cmd < 0x80) {
      const velocity = u8();
      const length = last(() => this.varlen(t));
      if (!cond) return;
      const key = Math.min(127, Math.max(0, cmd + t.transpose));
      this.noteOn(p, t, key, velocity, length);
      t.portaKey = key;
      if (t.noteWait) t.wait = length;
      return;
    }
    switch (cmd) {
      case 0x80: {
        const v = last(() => this.varlen(t));
        if (cond) t.wait = v;
        return;
      }
      case 0x81: {
        const v = last(() => this.varlen(t));
        if (cond) t.program = v;
        return;
      }
      case 0x93: {
        const n = u8();
        const at = u24();
        if (cond && !p.tracks[n]) p.tracks[n] = newTrack(t.data, at);
        return;
      }
      case 0x94: {
        const at = u24();
        if (cond) t.pc = at;
        return;
      }
      case 0x95: {
        const at = u24();
        if (cond && t.stack.length < 3) {
          t.stack.push({ pc: t.pc, count: -1 });
          t.pc = at;
        }
        return;
      }
      case 0xfd: {
        if (!cond) return;
        const top = t.stack.pop();
        if (top) t.pc = top.pc;
        return;
      }
      case 0xd4: {
        const count = last(u8);
        if (cond && t.stack.length < 3) t.stack.push({ pc: t.pc, count });
        return;
      }
      case 0xfc: {
        if (!cond) return;
        const top = t.stack[t.stack.length - 1];
        if (!top) return;
        if (top.count === 0) t.pc = top.pc;
        else if (--top.count === 0) t.stack.pop();
        else t.pc = top.pc;
        return;
      }
      case 0xfe:
        u16();
        return;
      case 0xff:
        if (cond) t.ended = true;
        return;
      case 0xe0: {
        const v = last(u16);
        if (cond) t.lfo.delay = v;
        return;
      }
      case 0xe1: {
        const v = last(u16);
        if (cond) p.tempo = v;
        return;
      }
      case 0xe3: {
        const v = last(() => s16(u16()));
        if (cond) t.sweepPitch = v;
        return;
      }
    }
    if (cmd >= 0xb0 && cmd <= 0xbd) {
      const i = u8();
      const value = last(() => s16(u16()));
      if (!cond) return;
      const vars = this.variable(p, i);
      const k = i & 15;
      const v = vars[k]!;
      switch (cmd) {
        case 0xb0: vars[k] = value; break;
        case 0xb1: vars[k] = v + value; break;
        case 0xb2: vars[k] = v - value; break;
        case 0xb3: vars[k] = v * value; break;
        case 0xb4: if (value !== 0) vars[k] = Math.trunc(v / value); break;
        case 0xb5: vars[k] = value >= 0 ? v << value : v >> -value; break;
        case 0xb6: {
          const r = this.random.next();
          vars[k] = value < 0 ? -((r * (-value + 1)) >> 16) : (r * (value + 1)) >> 16;
          break;
        }
        case 0xb8: t.cmp = v === value; break;
        case 0xb9: t.cmp = v >= value; break;
        case 0xba: t.cmp = v > value; break;
        case 0xbb: t.cmp = v <= value; break;
        case 0xbc: t.cmp = v < value; break;
        case 0xbd: t.cmp = v !== value; break;
        default: throw new Error(`sequence ${p.seq}: unknown variable command 0x${cmd.toString(16)}`);
      }
      return;
    }
    if (cmd >= 0xc0 && cmd <= 0xd6) {
      const signed = cmd === 0xc3 || cmd === 0xc4;
      const v = last(signed ? s8 : u8);
      if (!cond) return;
      switch (cmd) {
        case 0xc0: t.pan = v - 64; break;
        case 0xc1: t.volume = v; break;
        case 0xc2: p.volume = v; break;
        case 0xc3: t.transpose = v; break;
        case 0xc4: t.pitchBend = v; break;
        case 0xc5: t.bendRange = v; break;
        case 0xc6: t.priority = v; break;
        case 0xc7: t.noteWait = v !== 0; break;
        case 0xc8: t.tie = v !== 0; if (!t.tie) this.releaseTrack(t, -1); break;
        case 0xc9: t.portaKey = v + t.transpose; t.portamento = true; break;
        case 0xca: t.lfo.depth = v; break;
        case 0xcb: t.lfo.speed = v; break;
        case 0xcc: t.lfo.type = v; break;
        case 0xcd: t.lfo.range = v; break;
        case 0xce: t.portamento = v !== 0; break;
        case 0xcf: t.portaTime = v; break;
        case 0xd0: t.attack = v; break;
        case 0xd1: t.decay = v; break;
        case 0xd2: t.sustain = v; break;
        case 0xd3: t.release = v; break;
        case 0xd5: t.expression = v; break;
        case 0xd6: break;
        default: throw new Error(`sequence ${p.seq}: unknown command 0x${cmd.toString(16)}`);
      }
      return;
    }
    throw new Error(`sequence ${p.seq}: unknown command 0x${cmd.toString(16)} at 0x${(t.pc - 1).toString(16)}`);
  }

  // ------------------------------------------------------------------ notes and channels

  private noteOn(p: Player, t: Track, key: number, velocity: number, length: number): void {
    let ch: Channel | null = null;
    if (t.tie) {
      for (const c of t.channels) if (c.envState !== RELEASE) ch = c;
    }
    if (ch) {
      ch.key = key;
      ch.velocity = velocity;
    } else {
      const regions = p.bank.instruments[t.program];
      const region = regions?.find((r) => key >= r.low && key <= r.high);
      if (!region) return;
      let mask = p.channels;
      if (region.type === 'psg') mask &= PSG_CHANNELS;
      else if (region.type === 'noise') mask &= NOISE_CHANNELS;
      const priority = Math.min(255, t.priority + p.priority);
      ch = this.allocate(mask, priority);
      if (!ch) return;
      ch.active = true;
      ch.type = region.type;
      ch.wave = null;
      if (region.type === 'pcm') {
        const archive = p.bank.waveArchives[region.archive!];
        if (!archive) throw new Error(`sequence ${p.seq}: instrument ${t.program} plays an empty wave archive slot ${region.archive}`);
        const wave = this.source.waves(archive)[region.wave!];
        if (!wave) throw new Error(`sequence ${p.seq}: wave archive ${archive} has no wave ${region.wave}`);
        ch.wave = wave;
      }
      ch.duty = region.duty ?? 0;
      ch.priority = priority;
      ch.key = key;
      ch.baseKey = region.baseKey;
      ch.velocity = velocity;
      ch.attack = attackRate(t.attack !== 255 ? t.attack : region.attack);
      ch.decay = fallRate(t.decay !== 255 ? t.decay : region.decay);
      ch.sustain = sustainLevel(t.sustain !== 255 ? t.sustain : region.sustain);
      ch.release = fallRate(t.release !== 255 ? t.release : region.release);
      ch.envState = ATTACK;
      ch.envLevel = ENVELOPE_MIN;
      ch.instPan = region.pan - 64;
      ch.lfo = { ...t.lfo };
      ch.lfoCounter = 0;
      ch.lfoDelay = 0;
      ch.pos = 0;
      ch.lfsr = 0x7fff;
      ch.noiseOut = 1;
      ch.length = t.tie ? -1 : length;
      ch.fresh = true;
      ch.track = t;
      t.channels.add(ch);
    }
    let sweep = t.sweepPitch;
    if (t.portamento) sweep += (t.portaKey - key) << 6;
    ch.sweepPitch = sweep;
    ch.sweepCounter = 0;
    if (t.portaTime === 0) {
      ch.sweepLength = length;
      ch.autoSweep = false;
    } else {
      ch.sweepLength = (t.portaTime * t.portaTime * Math.abs(sweep)) >> 11;
      ch.autoSweep = true;
    }
  }

  /** SND_AllocExChannel: the lowest priority (then quietest) allowed channel, unless it outranks `priority`. */
  private allocate(mask: number, priority: number): Channel | null {
    let best: Channel | null = null;
    for (const i of ALLOCATION_ORDER) {
      if (!(mask & (1 << i))) continue;
      const ch = this.channels[i]!;
      const prio = ch.active ? ch.priority : 0;
      if (!best) best = ch;
      else {
        const bestPrio = best.active ? best.priority : 0;
        if (prio < bestPrio || (prio === bestPrio && ch.amplitude < best.amplitude)) best = ch;
      }
    }
    if (!best) return null;
    if (best.active && priority < best.priority) return null;
    if (best.active) this.free(best);
    return best;
  }

  private free(ch: Channel): void {
    ch.active = false;
    ch.amplitude = 0;
    ch.left = ch.right = 0;
    ch.track?.channels.delete(ch);
    ch.track = null;
  }

  private releaseChannel(ch: Channel, release: number): void {
    if (release >= 0) ch.release = fallRate(release);
    ch.priority = 1;
    ch.envState = RELEASE;
  }

  private releaseTrack(t: Track, release: number): void {
    for (const ch of t.channels) if (ch.envState !== RELEASE) this.releaseChannel(ch, release);
  }

  /** A track's end: its notes release and play out on their own. */
  private closeTrack(t: Track, release: number): void {
    this.releaseTrack(t, release);
    for (const ch of t.channels) ch.track = null;
    t.channels.clear();
  }

  private fadeVolume(p: Player): number {
    const f = p.fade;
    if (f.ticks <= 0 || f.elapsed >= f.ticks) return f.to;
    return f.from + ((f.to - f.from) * f.elapsed) / f.ticks;
  }

  /** The track's part of every channel's volume, pitch and pan (SND UpdateTrackChannel). */
  private updateTrackChannels(p: Player, t: Track): void {
    const volume =
      decibelSquare(t.volume) + decibelSquare(t.expression) + decibelSquare(p.volume) + decibelSquare(p.initialVolume) + decibelSquare(this.playerVolumes.get(p.data.player) ?? 127) + decibelSquare(Math.round(this.fadeVolume(p)));
    const pitch = ((t.pitchBend * t.bendRange) >> 1) + t.extPitch;
    const pan = t.pan + t.extPan;
    for (const ch of t.channels) {
      ch.userVolume = volume;
      ch.userPitch = pitch;
      ch.userPan = pan;
    }
  }

  private updateChannel(ch: Channel): void {
    ch.fresh = false;
    // Envelope.
    switch (ch.envState) {
      case ATTACK:
        ch.envLevel = -((-ch.envLevel * ch.attack) >> 8);
        if (ch.envLevel === 0) ch.envState = DECAY;
        break;
      case DECAY:
        ch.envLevel -= ch.decay;
        if (ch.envLevel <= ch.sustain) {
          ch.envLevel = ch.sustain;
          ch.envState = SUSTAIN;
        }
        break;
      case RELEASE:
        ch.envLevel -= ch.release;
        if (ch.envLevel <= ENVELOPE_MIN) {
          this.free(ch);
          return;
        }
        break;
    }
    // LFO.
    let lfo = 0;
    if (ch.lfo.depth !== 0) {
      if (ch.lfoDelay < ch.lfo.delay) ch.lfoDelay++;
      else {
        lfo = sinIdx(ch.lfoCounter >> 8) * ch.lfo.depth * ch.lfo.range;
        ch.lfoCounter = (ch.lfoCounter + (ch.lfo.speed << 6)) & 0x7fff;
      }
    }
    // Sweep (portamento).
    if (ch.autoSweep && ch.sweepCounter < ch.sweepLength) ch.sweepCounter++;
    const sweep = ch.sweepLength > 0 ? Math.trunc((ch.sweepPitch * (ch.sweepLength - ch.sweepCounter)) / ch.sweepLength) : 0;

    let volume = ch.userVolume + decibelSquare(ch.velocity) + (ch.envLevel >> 7);
    let pitch = ((ch.key - ch.baseKey) << 6) + ch.userPitch + sweep;
    let pan = ch.userPan + ch.instPan;
    if (ch.lfo.type === 0) pitch += (lfo * 64) >> 14;
    else if (ch.lfo.type === 1) volume += (lfo * 60) >> 14;
    else if (ch.lfo.type === 2) pan += (lfo * 64) >> 14;
    const hwPan = Math.min(127, Math.max(0, pan + 64));
    ch.amplitude = channelAmplitude(volume);
    ch.left = (ch.amplitude * (127 - hwPan)) / 127;
    ch.right = (ch.amplitude * hwPan) / 127;
    const timer = timerFor(ch.type === 'pcm' ? ch.wave!.timer : PSG_BASE_TIMER, pitch);
    ch.rate = CHANNEL_CLOCK / timer;
    if (this.sampleRate === null && ch.type === 'pcm') this.advance(ch, ch.rate * SOUND_FRAME_SECONDS);
  }

  /** Moves a PCM channel by `steps` samples; a wave without a loop stops at its end. */
  private advance(ch: Channel, steps: number): void {
    const w = ch.wave!;
    ch.pos += steps;
    if (ch.pos < w.length) return;
    if (!w.loop || w.length <= w.loopStart) {
      this.free(ch);
      return;
    }
    ch.pos = w.loopStart + ((ch.pos - w.loopStart) % (w.length - w.loopStart));
  }

  // ------------------------------------------------------------------ output

  /** Mixes `left.length` samples, running sound frames in between (needs a sample rate). */
  render(left: Float32Array, right: Float32Array): void {
    const rate = this.sampleRate;
    if (rate === null) throw new Error('render: this engine has no sample rate');
    const frameSamples = SOUND_FRAME_SECONDS * rate;
    for (let i = 0; i < left.length; i++) {
      if (this.frameClock <= 0) {
        this.frame();
        this.frameClock += frameSamples;
      }
      this.frameClock--;
      let l = 0;
      let r = 0;
      for (const ch of this.channels) {
        if (!ch.active || ch.amplitude === 0) continue;
        const step = ch.rate / rate;
        let s: number;
        if (ch.type === 'pcm') {
          s = ch.wave!.samples[ch.pos | 0]! / 32768;
          this.advance(ch, step);
        } else if (ch.type === 'psg') {
          s = (ch.pos | 0) % 8 <= ch.duty ? 1 : -1;
          ch.pos = (ch.pos + step) % 8;
        } else {
          s = ch.noiseOut;
          ch.pos += step;
          while (ch.pos >= 1) {
            ch.pos--;
            const carry = ch.lfsr & 1;
            ch.lfsr >>= 1;
            if (carry) {
              ch.lfsr ^= 0x6000;
              ch.noiseOut = -1;
            } else ch.noiseOut = 1;
          }
        }
        l += s * ch.left;
        r += s * ch.right;
      }
      left[i] = Math.max(-1, Math.min(1, l)) * this.gain;
      right[i] = Math.max(-1, Math.min(1, r)) * this.gain;
    }
  }
}

/**
 * Sound frames until the sequence's player stops on its own (every track ended and its notes played
 * out), or null when it has not stopped after `limit` frames (it loops).
 */
export function measureSequence(source: EngineData, seq: string, limit: number, bank?: string): number | null {
  const engine = new SoundEngine(source, null);
  engine.start('measure', seq, bank);
  for (let f = 1; f <= limit; f++) {
    engine.frame();
    if (!engine.playing('measure')) return f;
  }
  return null;
}
