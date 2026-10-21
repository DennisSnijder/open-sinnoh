/**
 * The DS sound formats and engine on our own bytes (writer.ts): SDAT/SSEQ/SBNK/SWAR parsing, the
 * sequencer's timing (notes at the expected ticks), the synth (ADPCM, the envelope, PSG and PCM pitch).
 */
import { describe, expect, it } from 'vitest';
import type { InstrumentRegion } from '@opensinnoh/contracts';
import { readBank } from './bank.ts';
import { scanSequence } from './commands.ts';
import { measureSequence, SoundEngine, type EngineData } from './engine.ts';
import { readSdat, readSseq } from './sdat.ts';
import { attackRate, CHANNEL_CLOCK, decibelSquare, fallRate, SOUND_FRAME_SECONDS, sustainLevel, timerFor } from './tables.ts';
import { decodeAdpcm, readWaveArchive, type Wave } from './wave.ts';
import { sbnkFile, sdatFile, Seq, sseqFile, swarFile } from './writer.ts';

const square = (duty: number): InstrumentRegion => ({ low: 0, high: 127, type: 'psg', duty, baseKey: 60, attack: 127, decay: 127, sustain: 127, release: 127, pan: 64 });
const pcm = (wave: number): InstrumentRegion => ({ low: 0, high: 127, type: 'pcm', archive: 0, wave, baseKey: 60, attack: 127, decay: 127, sustain: 127, release: 127, pan: 64 });

function source(seqs: Record<string, Uint8Array>, instruments: (InstrumentRegion[] | null)[], waves: Wave[] = []): EngineData {
  return {
    sequence: (id) => ({ data: seqs[id]!, bank: 'bank', volume: 127, channelPriority: 64, playerPriority: 64, player: 'player' }),
    bank: () => ({ waveArchives: ['waves'], instruments }),
    waves: () => waves,
    player: () => ({ maxSequences: 1, channels: 0xffff }),
  };
}

describe('formats', () => {
  it('an SDAT written by our writer reads back: names, sequence info, banks, players and files', () => {
    const events = new Seq().tempo(120).note(60, 100, 48).wait(48).end().build();
    const bank = sbnkFile([[square(3)], null, [{ ...pcm(0), low: 0, high: 59 }, { ...pcm(1), low: 60, high: 127, baseKey: 72 }]]);
    const swar = swarFile([
      { format: 1, rate: 16000, loop: true, loopStart: 2, samples: [0, 1000, 2000, -2000] },
      { format: 0, rate: 8000, loop: false, loopStart: 0, samples: [1, 2, 3, 0xff] },
    ]);
    const sdat = readSdat(
      sdatFile({
        sequences: [null, { name: 'SEQ_TEST', file: 0, bank: 0, volume: 100, channelPriority: 30, playerPriority: 64, player: 1 }],
        banks: [{ name: 'BANK_TEST', file: 1, waveArchives: [0] }],
        waveArchives: [{ name: 'WAVE_ARC_TEST', file: 2 }],
        players: [{ name: 'PLAYER_A', maxSequences: 2, channels: 0xc000, heapSize: 100 }, { name: 'PLAYER_B', maxSequences: 1, channels: 0x7ff, heapSize: 0 }],
        files: [sseqFile(events), bank, swar],
      }),
    );
    expect(sdat.sequences).toEqual([null, { name: 'SEQ_TEST', file: 0, bank: 0, volume: 100, channelPriority: 30, playerPriority: 64, player: 1 }]);
    expect(sdat.banks).toEqual([{ name: 'BANK_TEST', file: 1, waveArchives: [0, null, null, null] }]);
    expect(sdat.waveArchives).toEqual([{ name: 'WAVE_ARC_TEST', file: 2 }]);
    expect(sdat.players[1]).toEqual({ name: 'PLAYER_B', maxSequences: 1, channels: 0x7ff, heapSize: 0 });
    expect([...readSseq(sdat.file(0))]).toEqual([...events]);
    expect(readBank(sdat.file(1))).toEqual([[square(3)], null, [{ ...pcm(0), low: 0, high: 59 }, { ...pcm(1), low: 60, high: 127, baseKey: 72 }]]);
    const waves = readWaveArchive(sdat.file(2));
    expect(waves.map((w) => [w.format, w.loop, w.rate, w.timer, w.loopStart, w.length])).toEqual([
      [1, true, 16000, 1047, 2, 4],
      [0, false, 8000, 2095, 0, 4],
    ]);
    expect([...waves[0]!.samples]).toEqual([0, 1000, 2000, -2000]);
    expect([...waves[1]!.samples]).toEqual([256, 512, 768, -256]);
  });

  it('a bank rejects instrument types it cannot play', () => {
    const bytes = sbnkFile([[square(1)]]);
    bytes[16 + 0x2c] = 4;
    expect(() => readBank(bytes)).toThrow(/instrument type 4/);
  });

  it('the scan finds the tracks, the loop and unknown commands', () => {
    const looping = new Seq().allocateTracks(3).openTrack(1, 't1').label('top').note(60, 100, 10).wait(10).jump('top').label('t1').wait(5).end().build();
    const scan = scanSequence(looping);
    expect([...scan.tracks]).toEqual([
      [0, 0],
      [1, looping.indexOf(0x80, 12)],
    ]);
    expect(scan.loops).toBe(true);
    expect(scanSequence(new Seq().note(60, 100, 10).wait(10).end().build()).loops).toBe(false);
    expect(() => scanSequence(Uint8Array.from([0xe2, 0xff]))).toThrow(/unknown command 0xe2/);
  });
});

/** Note-ons per tick: a recording engine run frame by frame (one tick per frame at tempo 240). */
function noteTicks(seq: Uint8Array, ticks: number, speed = 1): [number, number][] {
  const engine = new SoundEngine(source({ s: seq }, [[square(3)]]), null);
  engine.speed = speed;
  engine.start('h', 's');
  const out: [number, number][] = [];
  const seen = new Set<object>();
  for (let tick = 0; tick < ticks; tick++) {
    engine.frame();
    for (const ch of engine.channels)
      if (ch.active && !seen.has(ch) && ch.key !== undefined) {
        seen.add(ch);
        out.push([tick, ch.key]);
      }
    for (const ch of engine.channels) if (!ch.active) seen.delete(ch);
  }
  return out;
}

describe('sequencer', () => {
  it('plays notes at their ticks: waits, note-wait mode, calls, loops and a second track', () => {
    // Tempo 240: one tick per sound frame.
    const seq = new Seq()
      .allocateTracks(3)
      .openTrack(1, 'bass')
      .tempo(240)
      .noteWait(false)
      .note(60, 100, 2)
      .wait(4)
      .call('sub')
      .loopStart(2)
      .note(64, 100, 1)
      .wait(3)
      .loopEnd()
      .end()
      .label('sub')
      .note(62, 100, 1)
      .wait(2)
      .ret()
      .label('bass')
      .wait(1)
      .note(40, 100, 5) // note-wait on (the default): waits 5
      .note(41, 100, 1)
      .end()
      .build();
    expect(noteTicks(seq, 20)).toEqual([
      [0, 60],
      [1, 40],
      [4, 62],
      [6, 64],
      [6, 41],
      [9, 64],
    ]);
  });

  it('tempo: ticks per sound frame are tempo / 240', () => {
    const seq = new Seq().tempo(120).noteWait(false).note(60, 100, 1).wait(10).note(62, 100, 1).wait(1).end().build();
    expect(noteTicks(seq, 30)).toEqual([
      [0, 60],
      [20, 62],
    ]);
  });

  it('a sequence ends when its tracks end and their notes have played out', () => {
    const s = source({ s: new Seq().tempo(240).noteWait(false).note(60, 100, 3).wait(5).end().build() }, [[{ ...square(3), release: 127 }]]);
    // The note releases after 3 ticks (release 127: gone at once); the end runs on the sixth tick (frame 6).
    expect(measureSequence(s, 's', 1000)).toBe(6);
    const loop = source({ s: new Seq().label('a').note(60, 100, 3).jump('a').build() }, [[square(3)]]);
    expect(measureSequence(loop, 's', 500)).toBeNull();
  });

  it('variables, comparisons and the if prefix', () => {
    // var 0 = 5; var 0 += 2; if var0 == 7 then note 70; if var0 > 9 then note 71.
    const seq = new Seq().tempo(240).noteWait(false).bytes(0xb0, 0, 5, 0, 0xb1, 0, 2, 0, 0xb8, 0, 7, 0, 0xa2).note(70, 100, 1).bytes(0xba, 0, 9, 0, 0xa2).note(71, 100, 1).wait(2).end().build();
    expect(noteTicks(seq, 5)).toEqual([[0, 70]]);
  });
});

describe('synth', () => {
  it('decodes IMA-ADPCM as the DS does (shifted steps, clamped to ±0x7FFF)', () => {
    // Header: sample 0, index 0 (step 7). Nibble 7: +0+1+3+7 = 11, index 8 (step 16); 7: +2+4+8+16 = 30,
    // index 16 (step 34); 8: −(34 >> 3) = −4, index 15 (step 31); 0: +(31 >> 3) = 3.
    const out = decodeAdpcm(Uint8Array.from([0, 0, 0, 0, 0x77, 0x08]), 4);
    expect([...out]).toEqual([11, 41, 37, 40]);
    const clamp = decodeAdpcm(Uint8Array.from([0xfe, 0x7f, 88, 0, 0x77]), 2);
    expect([...clamp]).toEqual([0x7fff, 0x7fff]);
  });

  it('envelope rates: attack multipliers, decay and release steps, sustain levels', () => {
    expect([attackRate(0), attackRate(108), attackRate(109), attackRate(127)]).toEqual([255, 147, 143, 0]);
    expect([fallRate(0), fallRate(49), fallRate(50), fallRate(125), fallRate(126), fallRate(127)]).toEqual([1, 99, 101, 7680, 0x3c00, 0xffff]);
    expect(sustainLevel(127)).toBe(0);
    expect(sustainLevel(64)).toBe(decibelSquare(64) << 7);
    expect(decibelSquare(64)).toBe(-119);
  });

  it('the envelope attacks to 0 dB, decays to the sustain level and releases to silence', () => {
    const region: InstrumentRegion = { ...square(3), attack: 120, decay: 120, sustain: 64, release: 120 };
    const engine = new SoundEngine(source({ s: new Seq().tempo(240).noteWait(false).note(60, 127, 40).wait(41).end().build() }, [[region]]), null);
    engine.start('h', 's');
    const levels: number[] = [];
    for (let f = 0; f < 120; f++) {
      engine.frame();
      const ch = engine.channels.find((c) => c.active);
      levels.push(ch ? ch.envLevel : NaN);
    }
    const peak = levels.indexOf(0);
    expect(peak).toBeGreaterThan(0);
    expect(levels.slice(0, peak).every((l, i) => i === 0 || l > levels[i - 1]!)).toBe(true);
    expect(levels[39]).toBe(sustainLevel(64));
    const after = levels.slice(42).filter((l) => !Number.isNaN(l));
    expect(after.every((l, i) => i === 0 || l < after[i - 1]!)).toBe(true);
    expect(levels.at(-1)).toBeNaN();
  });

  it('a PSG square plays its key: A4 at 440 Hz with base key C4', () => {
    expect(CHANNEL_CLOCK / timerFor(8006, (69 - 60) * 64) / 8).toBeCloseTo(440, 0);
    const rate = 48000;
    const engine = new SoundEngine(source({ s: new Seq().noteWait(false).note(69, 127, 0).wait(200).end().build() }, [[square(3)]]), rate);
    engine.start('h', 's');
    const l = new Float32Array(rate / 2);
    const r = new Float32Array(rate / 2);
    engine.render(l, r);
    let crossings = 0;
    for (let i = rate / 4 + 1; i < l.length; i++) if (l[i - 1]! < 0 && l[i]! >= 0) crossings++;
    expect(crossings / 0.25).toBeGreaterThan(436);
    expect(crossings / 0.25).toBeLessThan(444);
  });

  it('a PCM wave plays at its rate at the base key and an octave up 12 keys higher', () => {
    const wave = (rate: number): Wave => {
      const samples = new Int16Array(64).map((_, i) => (i < 32 ? 16000 : -16000));
      return { format: 1, loop: true, rate, timer: Math.round(CHANNEL_CLOCK / rate), loopStart: 0, length: 64, samples };
    };
    const freq = (key: number) => {
      const engine = new SoundEngine(source({ s: new Seq().noteWait(false).note(key, 127, 0).wait(200).end().build() }, [[pcm(0)]], [wave(16384)]), 48000);
      engine.start('h', 's');
      const l = new Float32Array(48000);
      engine.render(l, new Float32Array(48000));
      let crossings = 0;
      for (let i = 24001; i < l.length; i++) if (l[i - 1]! < 0 && l[i]! >= 0) crossings++;
      return crossings * 2;
    };
    // 16384 Hz / 64 samples = 256 Hz.
    expect(freq(60)).toBeGreaterThan(252);
    expect(freq(60)).toBeLessThan(260);
    expect(freq(72)).toBeGreaterThan(508);
    expect(freq(72)).toBeLessThan(516);
  });

  it('game speed: the sequencer and fades run N times faster, the pitch stays', () => {
    const seq = new Seq().tempo(120).noteWait(false).note(60, 100, 1).wait(10).note(62, 100, 1).wait(10).note(64, 100, 1).wait(1).end().build();
    // Tempo 120: a tick every 2 frames; notes 10 ticks apart = 20 frames, 10 at 2x, 5 at 4x, 2.5 at 8x.
    expect(noteTicks(seq, 60)).toEqual([[0, 60], [20, 62], [40, 64]]);
    expect(noteTicks(seq, 60, 2)).toEqual([[0, 60], [10, 62], [20, 64]]);
    expect(noteTicks(seq, 60, 4)).toEqual([[0, 60], [5, 62], [10, 64]]);
    expect(noteTicks(seq, 60, 8)).toEqual([[0, 60], [2, 62], [5, 64]]);
    // A fractional speed (a machine running behind) owes passes across frames.
    expect(noteTicks(seq, 60, 1.5)).toEqual([[0, 60], [13, 62], [27, 64]]);

    // A fade over 30 game ticks is done in a quarter of the frames at 4x.
    const fadeFrames = (speed: number) => {
      const engine = new SoundEngine(source({ s: new Seq().label('a').note(60, 100, 1).jump('a').build() }, [[square(3)]]), null);
      engine.speed = speed;
      engine.start('h', 's');
      engine.stop('h', 30);
      let f = 0;
      while (engine.playing('h')) {
        engine.frame();
        f++;
      }
      return f;
    };
    expect(fadeFrames(4) / fadeFrames(1)).toBeCloseTo(0.25, 1);

    // A held A4 is 440 Hz at any speed.
    const pitch = (speed: number) => {
      const rate = 48000;
      const engine = new SoundEngine(source({ s: new Seq().noteWait(false).note(69, 127, 0).wait(2000).end().build() }, [[square(3)]]), rate);
      engine.speed = speed;
      engine.start('h', 's');
      const l = new Float32Array(rate / 2);
      engine.render(l, new Float32Array(rate / 2));
      let crossings = 0;
      for (let i = rate / 4 + 1; i < l.length; i++) if (l[i - 1]! < 0 && l[i]! >= 0) crossings++;
      return crossings / 0.25;
    };
    for (const speed of [1, 2, 4, 8]) {
      expect(pitch(speed)).toBeGreaterThan(436);
      expect(pitch(speed)).toBeLessThan(444);
    }
  });

  it('a sound frame is 2728 × 64 ARM7 cycles', () => {
    expect(SOUND_FRAME_SECONDS * 1000).toBeCloseTo(5.2095, 3);
  });
});
