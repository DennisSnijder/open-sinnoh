/**
 * SWAR wave archives and SWAV waves (docs/research/audio.md §1.4): each wave is PCM8, PCM16 or IMA-ADPCM
 * with an optional loop. This module runs in the AudioWorklet too, so it reads bytes with a DataView only.
 */

export const WAVE_PCM8 = 0;
export const WAVE_PCM16 = 1;
export const WAVE_ADPCM = 2;

export interface Wave {
  format: number;
  loop: boolean;
  /** Samples per second (the SWAV header's rate; playback uses `timer`). */
  rate: number;
  /** Channel timer at pitch 0: CHANNEL_CLOCK / rate. */
  timer: number;
  /** First sample of the loop, and the total sample count (the loop runs to the end). */
  loopStart: number;
  length: number;
  /** Decoded 16-bit samples. */
  samples: Int16Array;
}

const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8];
const IMA_STEP = [
  7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598,
  658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899,
  15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767,
];

/**
 * The DS's IMA-ADPCM: a 4-byte header (initial sample, step index), then nibbles low first. The hardware
 * clamps to ±0x7FFF and builds the difference from shifted steps. Returns `count` samples.
 */
export function decodeAdpcm(data: Uint8Array, count: number): Int16Array {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let sample = dv.getInt16(0, true);
  let index = Math.min(88, Math.max(0, dv.getUint8(2)));
  const out = new Int16Array(count);
  for (let i = 0; i < count; i++) {
    const byte = data[4 + (i >> 1)];
    if (byte === undefined) throw new Error(`ADPCM: ${count} samples need ${4 + Math.ceil(count / 2)} bytes, have ${data.length}`);
    const nibble = i & 1 ? byte >> 4 : byte & 15;
    const step = IMA_STEP[index]!;
    let diff = step >> 3;
    if (nibble & 1) diff += step >> 2;
    if (nibble & 2) diff += step >> 1;
    if (nibble & 4) diff += step;
    sample = nibble & 8 ? Math.max(sample - diff, -0x7fff) : Math.min(sample + diff, 0x7fff);
    index = Math.min(88, Math.max(0, index + IMA_INDEX[nibble & 7]!));
    out[i] = sample;
  }
  return out;
}

/** One SWAV body (the 12-byte header and its samples). */
export function readWave(bytes: Uint8Array): Wave {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = dv.getUint8(0);
  const loop = dv.getUint8(1) !== 0;
  const rate = dv.getUint16(2, true);
  const timer = dv.getUint16(4, true);
  const loopWords = dv.getUint16(6, true);
  const loopLenWords = dv.getUint32(8, true);
  const body = bytes.subarray(12, 12 + (loopWords + loopLenWords) * 4);
  if (body.length !== (loopWords + loopLenWords) * 4) throw new Error(`SWAV: ${(loopWords + loopLenWords) * 4} sample bytes, have ${body.length}`);
  let samples: Int16Array;
  let loopStart: number;
  if (format === WAVE_PCM8) {
    samples = Int16Array.from(body, (b) => ((b << 24) >> 24) << 8);
    loopStart = loopWords * 4;
  } else if (format === WAVE_PCM16) {
    samples = new Int16Array(body.length >> 1);
    const bv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    for (let i = 0; i < samples.length; i++) samples[i] = bv.getInt16(i * 2, true);
    loopStart = loopWords * 2;
  } else if (format === WAVE_ADPCM) {
    // The first word is the ADPCM header; the loop offset counts it.
    samples = decodeAdpcm(body, Math.max(0, (body.length - 4) * 2));
    loopStart = Math.max(0, (loopWords - 1) * 8);
  } else {
    throw new Error(`SWAV: unknown wave format ${format}`);
  }
  return { format, loop, rate, timer, loopStart, length: samples.length, samples };
}

/** SWAR: the archive's waves in order. */
export function readWaveArchive(bytes: Uint8Array): Wave[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
  if (magic !== 'SWAR') throw new Error(`SWAR: bad magic ${JSON.stringify(magic)}`);
  const block = dv.getUint16(12, true);
  const n = dv.getUint32(block + 0x28, true);
  const offsets = Array.from({ length: n }, (_, i) => dv.getUint32(block + 0x2c + i * 4, true));
  return offsets.map((o, i) => {
    const end = i + 1 < n ? offsets[i + 1]! : bytes.length;
    return readWave(bytes.subarray(o, end));
  });
}
