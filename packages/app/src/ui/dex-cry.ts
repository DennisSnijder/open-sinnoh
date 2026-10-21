/**
 * The Pokédex cry page's moving parts (decomp applications/pokedex/ov21_021E3FFC.c, sound.c), drawn per game
 * tick (one DS frame) on a 256×192 canvas over the page's screen:
 * - the waveform (ov21_021E4A28): a 256-px BG window scrolled 4 px a frame; each frame its 4 newest columns
 *   (screen x 248–251) are the cry's samples between the last frame's played count and this one's
 *   (ov21_021E48B0, ov21_021E495C: a line from the previous column's level, ±32 px about y 151), or the flat
 *   line when nothing new played (ov21_021E49D0);
 * - the level meter (ov21_021E4B94): 9 columns at x 112 + 16i, segments 8 px apart up from y 96 for each band's
 *   amplitude (Sound_WaveData_AccumulateAmplitudes: midpoint crossings over the last 100 played samples),
 *   each segment fading after 2 (j + 1) frames, a peak marker held 16 frames and then falling a segment a frame.
 * The played count is Sound_GetNumberOfPlayedCrySamples: the cry player's sequence ticks (NNS_SndPlayerGetTick)
 * × 32 at the plain cry's pitch, 0 from the wave's loop length on. The ticks come from a silent copy of the
 * synth playing the cry for as many game ticks as the game's cry has played.
 */
import { GAME_TICK_CYCLES, readWaveArchive, recordsSource, SOUND_FRAME_CYCLES, SoundEngine, WAVE_PCM8, type Wave } from '@opensinnoh/audio';
import type { Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import type { DrawContext } from './apps.ts';
import { at } from './board.ts';
import { el } from './core.ts';

const W = 256;
const H = 192;
/** The waveform: centre row, half height, columns drawn (and scrolled) a frame. */
const WAVE = { y: 151, half: 32, step: 4 };
/** Played samples per sequence tick at pitch 0 (the Pokédex plays the plain cry). */
const SAMPLES_PER_TICK = 32;
/** The meter: column x, segment y (bottom) and step, columns, segments, the peak's hold (frames). */
const BARS = { x: 112, dx: 16, y: 96, dy: -8, columns: 9, segments: 9, hold: 16 };
/** sound.c WAVEFORM_SAMPLE_WINDOW and sCrossingsToAmplitudeMapping. */
const SAMPLE_WINDOW = 100;
const CROSSINGS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const FRAMES_PER_TICK = GAME_TICK_CYCLES / SOUND_FRAME_CYCLES;
/** At most this many DS frames are caught up in one animation frame (a hidden tab, fast-forward). */
const MAX_STEPS = 32;

interface Column {
  segments: { visible: boolean; life: number }[];
  peak: { visible: boolean; level: number; hold: number };
}

/** The cry's 8-bit samples (wave 0 of the species' wave archive, as Sound_LoadPokedexDataForSpecies loads it) and loop length. */
interface CryWave {
  bytes: Uint8Array;
  loopLength: number;
}

export class CryPage {
  readonly el: HTMLElement;
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  /** The BG window's columns (x in the window): null clear, else the drawn run [top, height]. */
  private readonly window: ([number, number] | null)[] = Array.from({ length: W }, () => null);
  private scroll = 0;
  /** ov21_021E495C's previous level. */
  private level = 0;
  private lastPlayed = 0;
  private readonly columns: Column[] = Array.from({ length: BARS.columns }, () => ({ segments: Array.from({ length: BARS.segments }, () => ({ visible: false, life: 0 })), peak: { visible: false, level: 0, hold: 0 } }));
  private wave: CryWave | null = null;
  private synth: { engine: SoundEngine; frames: number; ticks: number } | null = null;
  private lastTick: number | null = null;
  private colour = '#000';
  private bars: { img: HTMLImageElement; seg: Ui2dSheet['cells'][number]; peak: Ui2dSheet['cells'][number] } | null = null;
  private failed: Error | null = null;

  constructor(
    private readonly d: DrawContext,
    private readonly species: Id,
  ) {
    const k = Math.max(1, Math.round(d.unit * (devicePixelRatio || 1)));
    this.canvas.width = W * k;
    this.canvas.height = H * k;
    this.canvas.className = 'dex-cry-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.g = this.canvas.getContext('2d')!;
    this.g.scale(k, k);
    this.el = at(el('div', 'dex-cry', this.canvas), 0, 0, W, H);
    // ov21_021E4ABC: the flat line across the window.
    this.flat(0, W);
    void this.load().catch((e: unknown) => {
      this.failed = e instanceof Error ? e : new Error(String(e));
    });
    const loop = () => {
      if (this.failed) throw this.failed;
      if (!this.el.isConnected && this.lastTick !== null) return;
      this.update();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** The cry's wave and a silent synth with its sequence and bank, the colour and the meter's art. */
  private async load(): Promise<void> {
    const r = this.d.registries;
    const cry = r.cries.get(this.species);
    if (!cry) throw new Error(`ui: ${this.species} has no cry record`);
    const bank = r.soundBanks.get(cry.bank);
    if (!bank) throw new Error(`ui: no sound bank ${cry.bank}`);
    const archives = new Map<string, Wave[]>();
    for (const id of bank.waveArchives) {
      if (id === null) continue;
      const archive = r.waveArchives.get(id);
      if (!archive) throw new Error(`ui: no wave archive ${id}`);
      archives.set(id, readWaveArchive(await this.d.art.bytes(archive.data)));
    }
    const first = bank.waveArchives[0];
    const wave = first ? archives.get(first)![0] : undefined;
    if (!wave || wave.format !== WAVE_PCM8) throw new Error(`ui: ${this.species}'s cry wave is not 8-bit PCM`);
    const seq = r.sequences.get(cry.sequence);
    if (!seq) throw new Error(`ui: no sequence ${cry.sequence}`);
    const seqBytes = await this.d.art.bytes(seq.data);
    const engine = new SoundEngine(
      recordsSource(r, () => seqBytes, (id: string) => {
        const w = archives.get(id);
        if (!w) throw new Error(`ui: wave archive ${id} not loaded`);
        return w;
      }),
      null,
    );
    // The raw bytes as the DS reads them (signed samples seen as u8).
    this.wave = { bytes: Uint8Array.from(wave.samples, (s) => (s >> 8) & 0xff), loopLength: wave.length / 4 };
    this.synth = { engine, frames: 0, ticks: -1 };
    this.colour = (await this.d.art.edgeColors('pokedex/cry_wave')).top;
    const sheet = this.d.art.sheet('pokedex/cry_bar');
    if (sheet) {
      const cell = (anim: number) => sheet.cells[sheet.animations![anim]!.frames[0]!.cell]!;
      this.bars = { img: await this.d.art.image(sheet.atlas), seg: cell(1), peak: cell(0) };
    }
  }

  /** Runs the DS frames the game ticked since the last call, then draws. */
  private update(): void {
    const { tick, cryTicks } = this.d.sound!();
    const steps = this.lastTick === null ? 1 : Math.min(MAX_STEPS, tick - this.lastTick);
    this.lastTick = tick;
    if (steps <= 0) return;
    const played = this.played(cryTicks);
    for (let i = 0; i < steps; i++) this.frame(i === steps - 1 ? played : this.lastPlayed, cryTicks !== null);
    this.draw();
  }

  /** Sound_GetNumberOfPlayedCrySamples for the game's cry at `cryTicks` game ticks (0 when none plays). */
  private played(cryTicks: number | null): number {
    if (cryTicks === null || !this.synth || !this.wave) return 0;
    const s = this.synth;
    if (cryTicks < s.ticks || s.ticks < 0) {
      // A new cry: the synth starts it again.
      const cry = this.d.registries.cries.get(this.species)!;
      s.engine.start('cry', cry.sequence, cry.bank);
      s.frames = 0;
    }
    s.ticks = cryTicks;
    for (const target = Math.floor(cryTicks * FRAMES_PER_TICK); s.frames < target; s.frames++) s.engine.frame();
    const samples = s.engine.ticks('cry') * SAMPLES_PER_TICK;
    return samples >= this.wave.loopLength ? 0 : samples;
  }

  /** One DS frame: the waveform's scroll and new columns, the meter. */
  private frame(played: number, crying: boolean): void {
    this.scroll = (this.scroll + WAVE.step) % W;
    const x = (this.scroll - 2 * WAVE.step + W) % W;
    if (this.wave && played !== this.lastPlayed) {
      // ov21_021E48B0: the samples between the last count and this one, 4 picked evenly.
      this.clear(x, WAVE.step);
      for (let i = 0; i < WAVE.step; i++) this.column((x + i) % W, this.wave.bytes[Math.trunc(((played - this.lastPlayed) * i) / WAVE.step) + this.lastPlayed] ?? 0);
    } else this.flat(x, WAVE.step);
    this.lastPlayed = played;
    const amplitudes = crying && this.wave ? this.amplitudes(played) : new Array<number>(BARS.columns).fill(0);
    this.columns.forEach((c, i) => meter(c, amplitudes[i]!));
  }

  /** ov21_021E49D0: flat columns (level 0). */
  private flat(x: number, n: number): void {
    this.clear(x, n);
    for (let i = 0; i < n; i++) this.column((x + i) % W, 0);
  }

  private clear(x: number, n: number): void {
    for (let i = 0; i < n; i++) this.window[(x + i) % W] = null;
  }

  /** ov21_021E495C: a run from the previous column's level to this sample's, ±32 px about the centre row. */
  private column(x: number, sample: number): void {
    const v = sample > 127 ? sample - 255 : sample;
    const level = v === 0 ? 0 : Math.trunc((32 * v) / 127);
    const a = WAVE.y + level;
    const b = WAVE.y + this.level;
    this.window[x] = [Math.min(a, b), Math.abs(a - b) + 1];
    this.level = level;
  }

  /** Sound_WaveData_AccumulateAmplitudes over the last 100 played samples, into 9 bands. */
  private amplitudes(played: number): number[] {
    const out = new Array<number>(BARS.columns).fill(0);
    const s = this.wave!.bytes;
    const start = Math.max(0, played - SAMPLE_WINDOW);
    let crossings = 0;
    let amplitude = 0;
    let level = s[start]! < 128 ? 1 : -1;
    for (let i = start; i < played; i += 2) {
      const crossed = level > 0 ? s[i]! > 128 : s[i]! < 128;
      if (!crossed) {
        crossings++;
        continue;
      }
      const j = CROSSINGS.findIndex((c) => crossings < c);
      if (j >= 0) amplitude = j;
      if (amplitude >= BARS.columns) amplitude = BARS.columns - 1;
      if (crossings !== 0) out[BARS.columns - 1 - amplitude]!++;
      crossings = 0;
      level = s[i]! < 128 ? 1 : -1;
    }
    for (let i = 0; i < out.length; i++) if (out[i]! >= 10) out[i] = 9;
    for (let i = 0; i < out.length - 1; i++)
      if (out[i] === 0 && out[i + 1] !== 0) {
        out[i] = Math.trunc(out[i + 1]! / 2);
        break;
      }
    return out;
  }

  private draw(): void {
    const g = this.g;
    // For structural checks: the tallest waveform run on screen and the meter's lit segments and peaks.
    this.el.dataset.wave = String(Math.max(0, ...this.window.map((r) => (r ? r[1] : 0))));
    this.el.dataset.meter = String(this.columns.reduce((n, c) => n + c.segments.filter((s) => s.visible).length + (c.peak.visible ? 1 : 0), 0));
    g.clearRect(0, 0, W, H);
    g.fillStyle = this.colour;
    for (let sx = 0; sx < W; sx++) {
      const run = this.window[(sx + this.scroll) % W];
      if (run) g.fillRect(sx, run[0], 1, run[1]);
    }
    if (!this.bars) return;
    const { img, seg, peak } = this.bars;
    this.columns.forEach((c, i) => {
      const x = BARS.x + i * BARS.dx;
      c.segments.forEach((s, j) => {
        if (s.visible) g.drawImage(img, seg.x, seg.y, seg.w, seg.h, x - seg.ox, BARS.y + j * BARS.dy - seg.oy, seg.w, seg.h);
      });
      if (c.peak.visible) g.drawImage(img, peak.x, peak.y, peak.w, peak.h, x - peak.ox, BARS.y + c.peak.level * BARS.dy - peak.oy, peak.w, peak.h);
    });
  }
}

/** ov21_021E4B94: one meter column for a band's amplitude `n`. */
function meter(c: Column, n: number): void {
  for (let j = 0; j < n; j++) c.segments[j] = { visible: true, life: 2 * (j + 1) };
  let top = 0;
  c.segments.forEach((s, j) => {
    if (!s.visible) return;
    if (s.life - 1 > 0) {
      s.life--;
      top = j + 1;
    } else s.visible = false;
  });
  const p = c.peak;
  if (p.level <= top) {
    p.hold = BARS.hold;
    if (p.level < top) p.visible = true;
    p.level = top;
  }
  if (p.level > 0) {
    if (p.hold < 0) p.level--;
    else p.hold--;
  } else p.visible = false;
}
