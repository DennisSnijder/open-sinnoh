/**
 * The DS sound library's numeric tables and conversions (docs/research/audio.md §3). The decibel and
 * sine tables are computed from their closed forms; the ROM test checks them against the copies in the
 * cartridge's ARM7 binary.
 */

import { SOUND_FRAME_CYCLES } from '@opensinnoh/contracts';

export { GAME_TICK_CYCLES, SOUND_FRAME_CYCLES, soundFramesToTicks } from '@opensinnoh/contracts';

/** ARM7 clock (Hz). */
export const ARM7_CLOCK = 33513982;
export const SOUND_FRAME_SECONDS = SOUND_FRAME_CYCLES / ARM7_CLOCK;
/** Channel timers count at ARM7_CLOCK / 2. */
export const CHANNEL_CLOCK = ARM7_CLOCK / 2;
/** A PSG or noise channel at pitch 0 (its base key) uses this timer: 16756991 / 8006 / 8 ≈ 261.6 Hz (C4). */
export const PSG_BASE_TIMER = 8006;
/** The envelope floor (−72.3 dB in 1/1280 dB steps). */
export const ENVELOPE_MIN = -92544;

/** SNDi_DecibelSquareTable: 1/10 dB of (i/127)², the curve of every volume a sequence sets. */
export function decibelSquare(i: number): number {
  if (i <= 0) return -32768;
  if (i >= 127) return 0;
  return DECIBEL_SQUARE[i]!;
}
const DECIBEL_SQUARE = Int16Array.from({ length: 128 }, (_, i) => (i === 0 ? -32768 : Math.max(-722, Math.round(400 * Math.log10(i / 127)))));

/** SNDi_DecibelTable: 1/10 dB of i/127. */
export function decibel(i: number): number {
  if (i <= 0) return -32768;
  if (i >= 127) return 0;
  return Math.round(200 * Math.log10(i / 127));
}

/** The LFO's quarter sine, 33 entries (SNDi sine table): round(127 sin(iπ/64)). */
export const SINE: readonly number[] = Array.from({ length: 33 }, (_, i) => Math.round(127 * Math.sin((i * Math.PI) / 64)));

/** Full-period sine over 128 steps from the quarter table (SND_SinIdx). */
export function sinIdx(x: number): number {
  const i = x & 127;
  if (i < 32) return SINE[i]!;
  if (i < 64) return SINE[64 - i]!;
  if (i < 96) return -SINE[i - 64]!;
  return -SINE[128 - i]!;
}

/** Attack rates for attack values 109–127 (index 127 − attack); the ROM test checks them against ARM7. */
export const ATTACK_TABLE: readonly number[] = [0, 1, 5, 14, 26, 38, 51, 63, 73, 84, 92, 100, 109, 116, 123, 127, 132, 137, 143];

/** The multiplier the attack phase applies to the level each frame (/256). */
export function attackRate(attack: number): number {
  return attack < 109 ? 255 - attack : ATTACK_TABLE[127 - attack]!;
}

/** Decay and release: level units removed per frame. */
export function fallRate(value: number): number {
  if (value === 127) return 0xffff;
  if (value === 126) return 0x3c00;
  if (value < 50) return value * 2 + 1;
  return Math.floor(0x1e00 / (126 - value));
}

export function sustainLevel(sustain: number): number {
  return decibelSquare(sustain) << 7;
}

const AMPLITUDE = Float64Array.from({ length: 724 }, (_, i) => {
  const db = i - 723;
  const divider = db < -240 ? 16 : db < -120 ? 4 : db < -60 ? 2 : 1;
  return Math.min(127, Math.round(127 * Math.pow(10, db / 200) * divider)) / 127 / divider;
});

/**
 * Hardware channel volume of a level in 1/10 dB (SND_CalcChannelVolume): a 7-bit volume and a divider
 * (1, 2, 4 or 16), returned as the linear amplitude the channel outputs (0–1).
 */
export function channelAmplitude(db: number): number {
  if (db <= -723) return 0;
  return AMPLITUDE[(db > 0 ? 0 : Math.trunc(db)) + 723]!;
}

const PITCH = Float64Array.from({ length: 768 }, (_, i) => Math.pow(2, -i / 768));

/** SND_CalcTimer: the timer for a pitch offset in 1/64 semitones (768 per octave), clamped as the hardware does. */
export function timerFor(base: number, pitch: number): number {
  const octave = Math.floor(pitch / 768);
  const t = Math.floor(base * PITCH[pitch - octave * 768]! * Math.pow(2, -octave));
  return Math.min(0xffff, Math.max(0x10, t));
}

/** SND_CalcRandom: the sound library's LCG (its seed is fixed at boot). */
export class SoundRandom {
  constructor(private u = 0x12345678) {}
  next(): number {
    this.u = (Math.imul(this.u, 1664525) + 1013904223) >>> 0;
    return this.u >>> 16;
  }
}
