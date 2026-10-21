/**
 * The AudioWorklet processor: the DS sound engine (engine.ts) rendering at the context's rate. The main
 * thread (web output, packages/app/src/audio.ts) loads what a command needs first, then sends the
 * command; nothing comes back but errors and, on request, the number of sounding channels.
 */
import type { AudioCommand, Sequence, SoundBank, SoundPlayer } from '@opensinnoh/contracts';
import { SoundEngine } from './engine.ts';
import { recordsSource } from './records-source.ts';
import { readWaveArchive, type Wave } from './wave.ts';

interface ProcessorPort {
  postMessage(message: unknown): void;
  onmessage: ((e: { data: WorkletMessage }) => void) | null;
}
declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: ProcessorPort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

export type WorkletMessage =
  | { type: 'sequence'; record: Sequence; data: ArrayBuffer }
  | { type: 'bank'; record: SoundBank }
  | { type: 'player'; record: SoundPlayer }
  | { type: 'waves'; id: string; data: ArrayBuffer }
  | { type: 'command'; command: AudioCommand }
  | { type: 'output'; volume: number; mono: boolean }
  /** The game's speed (fast-forward): the sequencer runs this many times faster, at the same pitch. */
  | { type: 'speed'; speed: number }
  | { type: 'status' };

/**
 * `status`: the sounding channels and handles, and the render's timing since the processor started:
 * `renderMs` spent rendering `audioMs` of output, and `late` render quanta (one took longer than the audio
 * it made: the output underran).
 */
export type WorkletReply =
  | { type: 'error'; message: string }
  | { type: 'status'; channels: number; handles: string[]; speed: number; renderMs: number; audioMs: number; late: number };

/** The worklet scope has no `performance` in every browser; Date.now is the fallback (1 ms steps). */
const clock: () => number = typeof performance === 'object' ? () => performance.now() : () => Date.now();

class OpenSinnohSynth extends AudioWorkletProcessor {
  private readonly sequences = new Map<string, Sequence>();
  private readonly data = new Map<string, Uint8Array>();
  private readonly banks = new Map<string, SoundBank>();
  private readonly players = new Map<string, SoundPlayer>();
  private readonly waves = new Map<string, Wave[]>();
  private readonly engine: SoundEngine;
  private mono = false;
  private renderMs = 0;
  private audioMs = 0;
  private late = 0;

  constructor() {
    super();
    const source = recordsSource(
      { sequences: this.sequences, soundBanks: this.banks, soundPlayers: this.players },
      (asset) => {
        const d = this.data.get(asset);
        if (!d) throw new Error(`synth: sequence data ${asset} is not loaded`);
        return d;
      },
      (archive) => {
        const w = this.waves.get(archive);
        if (!w) throw new Error(`synth: wave archive ${archive} is not loaded`);
        return w;
      },
    );
    this.engine = new SoundEngine(source, sampleRate);
    this.port.onmessage = (e) => this.guard(() => this.message(e.data));
  }

  private guard(f: () => void): void {
    try {
      f();
    } catch (e) {
      this.port.postMessage({ type: 'error', message: (e as Error).message } satisfies WorkletReply);
      this.engine.stopAll();
    }
  }

  private message(m: WorkletMessage): void {
    switch (m.type) {
      case 'sequence':
        this.sequences.set(m.record.id, m.record);
        this.data.set(m.record.data, new Uint8Array(m.data));
        return;
      case 'bank':
        this.banks.set(m.record.id, m.record);
        return;
      case 'player':
        this.players.set(m.record.id, m.record);
        return;
      case 'waves':
        this.waves.set(m.id, readWaveArchive(new Uint8Array(m.data)));
        return;
      case 'output':
        this.engine.gain = m.volume;
        this.mono = m.mono;
        return;
      case 'speed':
        this.engine.speed = m.speed;
        return;
      case 'status':
        this.port.postMessage({
          type: 'status',
          channels: this.engine.channels.filter((c) => c.active).length,
          handles: this.engine.handles(),
          speed: this.engine.speed,
          renderMs: this.renderMs,
          audioMs: this.audioMs,
          late: this.late,
        } satisfies WorkletReply);
        return;
      case 'command':
        this.command(m.command);
        return;
    }
  }

  private command(c: AudioCommand): void {
    const e = this.engine;
    switch (c.op) {
      case 'start':
        e.start(c.handle, c.seq, c.bank);
        return;
      case 'stop':
        e.stop(c.handle, c.ticks);
        return;
      case 'volume':
        e.moveVolume(c.handle, c.volume, c.ticks);
        return;
      case 'initial-volume':
        e.setInitialVolume(c.handle, c.volume);
        return;
      case 'player-volume':
        e.setPlayerVolume(c.player, c.volume);
        return;
      case 'pause':
        e.pause(c.handle, c.paused);
        return;
      case 'pitch':
        e.setPitch(c.handle, c.pitch);
        return;
      case 'pan':
        e.setPan(c.handle, c.pan);
        return;
      case 'stop-all':
        e.stopAll();
        return;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0]!;
    const right = out[1] ?? new Float32Array(left.length);
    const t0 = clock();
    this.guard(() => {
      this.engine.render(left, right);
      if (this.mono)
        for (let i = 0; i < left.length; i++) {
          const m = (left[i]! + right[i]!) / 2;
          left[i] = right[i] = m;
        }
    });
    const spent = clock() - t0;
    const made = (left.length / sampleRate) * 1000;
    this.renderMs += spent;
    this.audioMs += made;
    if (spent > made) this.late++;
    return true;
  }
}

registerProcessor('opensinnoh-synth', OpenSinnohSynth);
