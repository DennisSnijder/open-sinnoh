import type { AssetRef, Weather, WeatherFade, WeatherParticles, WeatherSpawner, WeatherSprites } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Reader } from '@opensinnoh/nds';
import { encodeImage, pack, PaletteRam, readNanr, readNcer, readNclr, readNcgr, readNcgrData, readNscr, renderCell, renderScreen } from '../ui2d/index.ts';

/**
 * The overworld weather task table (decomp ov5_021D5EB8.c `Unk_ov5_02201D78`, 31 entries of 28 bytes,
 * indexed by `OVERWORLD_WEATHER_*` 0–30): u16 particle sprite resource (weather_sys OAM set, 0xFFFF = none),
 * u16 BG resource (0xFFFF = none), the task's state size and runtime pointers, and the task function.
 *
 * The task functions hold their fog parameters and spawn rates as code constants, so they are listed
 * here by function address (from the decomp, checked against the ROM table's pointers). Every task
 * function the table points at must be listed: an unknown pointer fails the import.
 */
export const WEATHER_TASK_SIZE = 28;
export const WEATHER_TASK_COUNT = 31;

export interface RawWeatherTask {
  particles: number | null;
  bg: number | null;
  task: number;
}

export function readWeatherTasks(bytes: Uint8Array): RawWeatherTask[] {
  if (bytes.length !== WEATHER_TASK_COUNT * WEATHER_TASK_SIZE) throw new Error(`weather task table: ${bytes.length} bytes`);
  const r = new Reader(bytes);
  const opt = (v: number) => (v === 0xffff ? null : v);
  return Array.from({ length: WEATHER_TASK_COUNT }, (_, i) => {
    const o = i * WEATHER_TASK_SIZE;
    return { particles: opt(r.u16(o)), bg: opt(r.u16(o + 2)), task: r.u32(o + 24) & ~1 };
  });
}

/**
 * The tasks with their function addresses as the US build's (`WEATHER_TASKS` keys). Another build's code sits
 * elsewhere but in the same order, so its addresses map to the US ones by rank; the set of tasks must be the same.
 */
export function usWeatherTasks(tasks: RawWeatherTask[]): RawWeatherTask[] {
  const own = [...new Set(tasks.map((t) => t.task))].sort((a, b) => a - b);
  const us = Object.keys(WEATHER_TASKS).map(Number).sort((a, b) => a - b);
  if (own.length !== us.length) throw new Error(`weather task table: ${own.length} task functions, expected ${us.length}`);
  return tasks.map((t) => ({ ...t, task: us[own.indexOf(t.task)]! }));
}

/** Fog of a task: GX fog slope (shift), offset, GX_RGB colour (0–31). */
type TaskFog = [slope: number, offset: number, rgb: [number, number, number]];

/**
 * Per task function: fog (ov5_021D7308/ov5_021D7384 arguments; alpha always 31), how many particles the
 * steady state keeps alive (spawn count per interval × lifetime, capped by the 48-sprite pool), the
 * screen-darkness radius (ov5_021DB6E0: a window circle of 32 px at (128, 84)), whether the task uses
 * the special density table (ov5_021D9C20), and lightning (task 17, started by the thunderstorm task).
 */
interface TaskParams {
  fog?: TaskFog;
  /**
   * The BG2 layer once faded in: per-tick G2_SetBG2Offset step and the G2_SetBlendAlpha EVA (16 = no
   * blend set: opaque). `layer: 'pending'` = the task has a BG we do not import yet; `layer: 'drawn'` =
   * its BG is drawn by another part (DARK_FLASH's darkness, task 17's lightning flash).
   */
  layer?: { scroll: [number, number]; eva: number; under?: true } | 'pending' | 'drawn';
  count?: number;
  darkness?: number;
  densityTable?: true;
  lightning?: true;
  /**
   * The fades (contracts WeatherFade): `spawn.in` = the fade in's ov5_021D7210 (count, interval, target count, target
   * interval, interval step, spawns per count step, count step), `spawn.out` = the fade out's ov5_021D7238 (target
   * count, target interval, interval step, count step); `fogFade` = ticks per density step in / out (ov5_021D7308's
   * and ov5_021D749C's; 0 steps every tick like 1); `layerFade` = the BG blend's ticks in / out (ov5_021D64FC), or
   * `steady` (BG2 on once faded in, off when the fade out starts).
   */
  spawn?: { in: [number, number, number, number, number, number, number]; out: [number, number, number, number] };
  /** The map load's spawner (count, interval; the task's state 2 ov5_021D7210) and its ov5_021D7568 prewarm (n, period, step). */
  load?: { spawner: [number, number]; prewarm: [number, number, number] };
  fogFade?: [number, number];
  layerFade?: [number, number] | 'steady';
}

const GREY26: [number, number, number] = [26, 26, 26];
const GREY24: [number, number, number] = [24, 24, 24];
const SAND: [number, number, number] = [26, 20, 5];
const WHITE: [number, number, number] = [31, 31, 31];
const BLACK: [number, number, number] = [0, 0, 0];

// Spawners several tasks share (heavy rain and the thunderstorm: ov5_021D9984, ov5_021D9B28).
const HEAVY_RAIN_SPAWN: TaskParams['spawn'] = { in: [1, 15, 10, 0, -3, 2, 1], out: [0, 15, 3, -3] };
const HEAVY_SNOW_SPAWN: TaskParams['spawn'] = { in: [1, 30, 6, 3, -5, 2, 1], out: [0, 30, 5, -3] };
const SAND_SPAWN: TaskParams['spawn'] = { in: [1, 15, 8, 1, -2, 4, 2], out: [0, 15, 2, -3] };

export const WEATHER_TASKS: Record<number, TaskParams> = {
  0x021d7604: {}, // CLEAR
  0x021dac68: { layer: { scroll: [0, 0], eva: 4 }, layerFade: [8, 8] }, // CLOUDY: a still dark BG at 4/16
  0x021d7658: { fog: [3, 0x6f6f + 0x300, GREY26], count: 16, spawn: { in: [1, 8, 4, 0, -1, 1, 1], out: [0, 8, 1, -1] }, fogFade: [1, 1], load: { spawner: [4, 0], prewarm: [20, 10, 1] } }, // RAINING: 4 drops per tick, 1–2 tick streaks, 30% splash 4 ticks
  0x021d9ff8: { fog: [3, 0x6f6f, GREY26], count: 36, spawn: HEAVY_RAIN_SPAWN, fogFade: [1, 1], load: { spawner: [10, 0], prewarm: [20, 5, 1] } }, // HEAVY_RAIN: 10 drops per tick
  0x021d9f0c: { fog: [3, 0x6f6f, GREY26], count: 36, lightning: true, spawn: HEAVY_RAIN_SPAWN, fogFade: [1, 1], load: { spawner: [10, 0], prewarm: [20, 5, 1] } }, // THUNDERSTORM: heavy rain + task 17
  0x021d79f0: { fog: [3, 0x6f6f + 0x300, GREY26], count: 16, spawn: { in: [1, 24, 1, 14, -5, 1, 0], out: [0, 24, 5, -1] }, fogFade: [1, 2], load: { spawner: [1, 14], prewarm: [20, 2, 24] } }, // SNOWING: 1 flake per 14 ticks, slow fall
  0x021d7e54: { fog: [3, 0x6f6f - 0x200, GREY24], count: 48, spawn: HEAVY_SNOW_SPAWN, fogFade: [2, 1], load: { spawner: [6, 3], prewarm: [20, 2, 3] } }, // HEAVY_SNOW: 6 per 3 ticks
  0x021d8ff8: { fog: [3, 0x6f6f - 0x400, GREY24], count: 48, layer: { scroll: [24, -12], eva: 16 }, spawn: { in: [1, 30, 10, 1, -4, 2, 3], out: [0, 12, 4, -4] }, fogFade: [1, 1], layerFade: 'steady', load: { spawner: [10, 1], prewarm: [20, 2, 2] } }, // BLIZZARD: 10 per tick; BG offset (2b, −b), b += 12
  0x021d879c: { fog: [5, 0x6f6f + 0xaa0, WHITE], layer: { scroll: [0, 0], eva: 16, under: true }, fogFade: [2, 1], layerFade: [30, 30] }, // CLEAR_8: thin white fog + the fog BG behind the 3D (priority 3)
  0x021da244: { fog: [3, 0x6f6f - 0x40, [20, 20, 14]], count: 24, layer: 'pending', spawn: { in: [1, 12, 1, 6, -1, 4, 0], out: [0, 12, 1, -1] }, fogFade: [1, 1], load: { spawner: [1, 6], prewarm: [20, 2, 16] } }, // SLOW_ASHFALL: 1 per 6 ticks, slow; BG jumps 32 px every 30 ticks
  0x021d8d08: { fog: [3, 28399, SAND], count: 48, layer: { scroll: [12, -6], eva: 16 }, spawn: SAND_SPAWN, fogFade: [1, 1], layerFade: 'steady', load: { spawner: [8, 1], prewarm: [24, 2, 2] } }, // SANDSTORM: 8 per tick; BG offset (2b, −b), b += 6
  0x021d9464: { fog: [3, 0x6f6f + 0x200, GREY26], count: 48, spawn: { in: [2, 16, 20, 2, -2, 4, 2], out: [0, 16, 6, -10] }, fogFade: [1, 1], load: { spawner: [20, 2], prewarm: [20, 10, 1] } }, // HAILING: 20 per 2 ticks
  0x021da8a0: { count: 16, spawn: { in: [1, 35, 4, 15, -2, 5, 1], out: [0, 35, 2, -3] }, load: { spawner: [1, 4], prewarm: [16, 2, 1] } }, // SPIRITS: 15 per 4 ticks, no fog
  0x021dab78: { layer: { scroll: [0, 0], eva: 16, under: true }, layerFade: [8, 8] }, // CLEAR_13: BG only, behind the 3D (priority 3)
  0x021daec0: { fog: [6, 30037, WHITE], layer: { scroll: [0, 0], eva: 9 }, fogFade: [1, 1], layerFade: [30, 30] }, // FOG: a still white BG at 9/16
  0x021dad38: { fog: [7, 30287, BLACK], layer: { scroll: [0, 0], eva: 9 }, fogFade: [1, 1], layerFade: [30, 30] }, // DEEP_FOG: the same white BG at 9/16
  0x021db04c: { darkness: 32, layer: 'drawn' }, // DARK_FLASH
  0x021da748: { layer: 'drawn' }, // 17: lightning flashes only (a BG blend; drawn as part of THUNDERSTORM's `thunder` particles)
  0x021d84d4: { fog: [3, 0x6f6f + 0x200, GREY26], fogFade: [2, 2] }, // 18
  0x021d8638: { fog: [3, 0x6f6f - 0x9e0, GREY26], fogFade: [2, 2] }, // 19
  0x021d97e8: { layer: 'pending' }, // 20: pulsing BG layer only
  0x021d823c: { fog: [3, 0x6f6f, GREY24], count: 48, layer: { scroll: [6, -6], eva: 16 }, spawn: HEAVY_SNOW_SPAWN, fogFade: [2, 1], layerFade: 'steady', load: { spawner: [6, 3], prewarm: [20, 2, 3] } }, // 21: heavy snow + blizzard BG; offset (b, −b), b += 6
  0x021d8948: { fog: [3, 28399, SAND], count: 48, spawn: SAND_SPAWN, fogFade: [1, 1], load: { spawner: [8, 1], prewarm: [24, 2, 2] } }, // 22: sand without BG
  0x021db144: { fog: [3, 0x6f6f - 1600, WHITE], layer: 'pending', fogFade: [1, 1] }, // 23 (Eterna Forest): BG at 7/16 that follows the camera
  0x021db3a8: { fog: [5, 28591, BLACK], densityTable: true, layer: 'pending' }, // 24: BG alpha pulses with the fog
  0x021db3c4: { fog: [5, 28591, BLACK], densityTable: true, layer: 'pending' }, // 25
  0x021db3e0: { fog: [3, 26095, [2, 2, 6]], fogFade: [1, 1] }, // 26 (Galactic HQ)
  0x021db40c: { fog: [2, 26415, [13, 25, 30]], fogFade: [1, 1] }, // 27 (Old Chateau, Lost Tower)
  0x021db438: { fog: [2, 26415, [20, 0, 0]], fogFade: [1, 1] }, // 28 (Stark Mountain rooms)
  0x021db460: { fog: [2, 26415, [0, 0, 20]], fogFade: [1, 1] }, // 29 (Mt Coronet 4F–6F, Solaceon Ruins, Snowpoint Temple)
  0x021db48c: { fog: [1, 19311, [1, 1, 1]], fogFade: [1, 1] }, // 30
};

/** weather_sys OAM sets (the task table's particle resource) → particle kind. */
const PARTICLE_SETS: Record<number, WeatherParticles> = { 0: 'rain', 1: 'heavy-snow', 2: 'sand', 3: 'snow', 4: 'hail', 5: 'heavy-rain', 6: 'ash', 7: 'spirits', 9: 'blizzard' };

/**
 * Steady fog densities (ov5_021D7534 at the end of its fade): entry i = 4 i, entry 0 = 0. Tasks 24/25
 * apply the ROM's own 32-entry table instead.
 */
export const DEFAULT_FOG_DENSITIES = Array.from({ length: 32 }, (_, i) => i * 4);

/**
 * The decoded parts of weather `value` (0–30): particles, fog, darkness and the BG layer (`layerImage`
 * names the asset of a BG resource). Weathers change no light.
 */
export function weatherParts(value: number, task: RawWeatherTask, densityTable: number[], layerImage: (bg: number) => AssetRef, weatherId: (value: number) => Id, sprites: (set: number) => WeatherSprites): Pick<Weather, 'particles' | 'fog' | 'darkness' | 'layer' | 'fade' | 'pending'> {
  const p = WEATHER_TASKS[task.task];
  if (!p) throw new Error(`weather ${value}: task function 0x${task.task.toString(16)} is not a known weather task`);
  const out: Pick<Weather, 'particles' | 'fog' | 'darkness' | 'layer' | 'fade' | 'pending'> = {};
  if ((task.bg === null) !== (p.layer === undefined)) throw new Error(`weather ${value}: BG resource ${task.bg} but task layer ${JSON.stringify(p.layer)}`);
  if (task.bg !== null && typeof p.layer === 'object') out.layer = { image: layerImage(task.bg), scroll: p.layer.scroll, alpha: p.layer.eva / 16, ...(p.layer.under ? { under: true as const } : {}) };
  if (p.layer === 'pending') out.pending = ['layer'];
  if (task.particles !== null) {
    const kind = PARTICLE_SETS[task.particles];
    if (!kind) throw new Error(`weather ${value}: particle set ${task.particles} unknown`);
    if (p.count === undefined || !p.spawn || !p.load) throw new Error(`weather ${value}: particle set without a count, spawner or map-load spawner`);
    const spawner: WeatherSpawner = { load: p.load.spawner, steady: [p.spawn.in[2], p.spawn.in[3]], prewarm: p.load.prewarm };
    out.particles = { kind: p.lightning ? 'thunder' : kind, count: p.count, sprites: sprites(task.particles), spawner };
  }
  if (p.fog) {
    const [slope, offset, rgb] = p.fog;
    out.fog = { slope, offset, color: rgb.map((c) => c / 31) as [number, number, number], alpha: 31, densities: p.densityTable ? densityTable : DEFAULT_FOG_DENSITIES };
  }
  if (p.darkness) out.darkness = { radius: p.darkness };
  const fade: WeatherFade = {};
  if (p.spawn) {
    if (!out.particles) throw new Error(`weather ${value}: a spawner without particles`);
    fade.particles = spawnRamps(p.spawn.in, p.spawn.out);
  }
  if (p.fogFade) {
    if (!out.fog) throw new Error(`weather ${value}: a fog fade without fog`);
    fade.fog = { in: Math.max(1, p.fogFade[0]), out: Math.max(1, p.fogFade[1]) };
  }
  if (p.layerFade && out.layer) fade.layer = p.layerFade === 'steady' ? 'steady' : { in: p.layerFade[0], out: p.layerFade[1] };
  const overlaps = OVERLAPPING.includes(value) ? OVERLAPPING.filter((v) => v !== value).map(weatherId) : [];
  if (overlaps.length) fade.overlaps = overlaps;
  if (Object.keys(fade).length) out.fade = fade;
  return out;
}

/** ov5_021D6178: the snows and the blizzards fade into each other (the new one in while the old one goes out). */
const OVERLAPPING = [5, 6, 7, 21];

/**
 * The spawner's rate per tick of its fade in and fade out, over the faded-in rate (contracts WeatherFade.particles).
 * ov5_021D7244 each tick: steps the countdown; at 0 spawns `count` and restarts it from `interval`, then moves
 * `interval` by its step and, every `period` spawns, `count` by its step, each until its target. A spawn every
 * max(1, interval) ticks: the rate is count / max(1, interval). The fade out starts from the faded-in values.
 */
export function spawnRamps(fadeIn: NonNullable<TaskParams['spawn']>['in'], fadeOut: NonNullable<TaskParams['spawn']>['out']): { in: number[]; out: number[] } {
  const [count0, interval0, countTarget, intervalTarget, intervalStep, period, countStep] = fadeIn;
  const c = { count: count0, timer: 0, interval: interval0, spawns: 0, countTarget, intervalTarget, intervalStep, period, countStep };
  const rate = () => c.count / Math.max(1, c.interval);
  const run = () => {
    const rates: number[] = [];
    for (let guard = 0; ; guard++) {
      if (guard > 10_000) throw new Error('weather spawner: the ramp never ends');
      let done = 0;
      const reached = (v: number, target: number, step: number) => (step > 0 ? v >= target : v <= target);
      if (c.intervalStep === 0) done |= 1;
      else if (reached(c.interval, c.intervalTarget, c.intervalStep)) {
        done |= 1;
        c.interval = c.intervalTarget;
      }
      if (c.countStep === 0) done |= 2;
      else if (reached(c.count, c.countTarget, c.countStep)) {
        done |= 2;
        c.count = c.countTarget;
      }
      if (done === 3) return rates;
      if (--c.timer <= 0) {
        c.timer = c.interval;
        if (!(done & 1)) c.interval += c.intervalStep;
        if (!(done & 2) && ++c.spawns >= c.period) {
          c.spawns = 0;
          c.count += c.countStep;
        }
      }
      rates.push(rate());
    }
  };
  const ramp = run();
  const full = rate();
  if (full <= 0) throw new Error('weather spawner: faded in to no particles');
  [c.countTarget, c.intervalTarget, c.intervalStep, c.countStep] = fadeOut;
  const down = run();
  const level = (r: number) => Math.round(Math.min(1, r / full) * 1000) / 1000;
  return { in: [...ramp.map(level), 1], out: [...down.map(level), 0] };
}

/** sYearlyWeather (field_overworld_weather.c): 366 days × 5 yearly weathers (32–36), u8 weather values. */
export function readYearlyWeather(bytes: Uint8Array, kinds: number): number[][] {
  if (bytes.length !== 366 * kinds) throw new Error(`yearly weather table: ${bytes.length} bytes`);
  return Array.from({ length: kinds }, (_, k) => Array.from({ length: 366 }, (_, d) => bytes[d * kinds + k]!));
}

/** ov5_021D5EB8.c Unk_ov5_021F8D90: per weather BG resource, the weather_sys.narc members {NCLR, NCGR, NSCR}. */
export const WEATHER_BG_COUNT = 11;

export function readWeatherBgs(bytes: Uint8Array): [nclr: number, ncgr: number, nscr: number][] {
  if (bytes.length !== WEATHER_BG_COUNT * 12) throw new Error(`weather BG table: ${bytes.length} bytes`);
  const r = new Reader(bytes);
  return Array.from({ length: WEATHER_BG_COUNT }, (_, i) => [r.u32(i * 12), r.u32(i * 12 + 4), r.u32(i * 12 + 8)]);
}

/**
 * A weather BG as a 256×256 PNG, loaded as ov5_021D6D84/ov5_021D6DCC/ov5_021D6E20 do: the palette's
 * first 16 colours at BG palette 6, the characters at 0, the 32×32 screen with every entry's palette
 * set to 6 (Bg_ChangeTilemapRectPalette). Colour 0 is transparent.
 */
export function weatherBgPng(narc: Uint8Array[], [nclr, ncgr, nscr]: [number, number, number]): Uint8Array {
  const member = (i: number) => {
    const m = narc[i];
    if (!m) throw new Error(`weather_sys.narc has no member ${i}`);
    return m;
  };
  const ram = new PaletteRam().load(readNclr(member(nclr)), 6 * 32, 32);
  const chars = readNcgr(member(ncgr));
  if (chars.bitDepth !== 4) throw new Error(`weather BG NCGR ${ncgr}: ${chars.bitDepth} bpp, expected 4`);
  const screen = readNscr(member(nscr));
  if (screen.width !== 256 || screen.height !== 256) throw new Error(`weather BG NSCR ${nscr}: ${screen.width}×${screen.height}, expected 256×256`);
  const rgba = renderScreen({ ...screen, entries: screen.entries.map((e) => (e & 0xfff) | (6 << 12)) }, chars, ram);
  return encodeImage({ width: 256, height: 256, rgba });
}

/** weather_sys.narc's sprite resource tables (ov5_021D61D0): member and resource type, per kind. */
const SPRITE_TABLES = { chars: [63, 0], palettes: [64, 1], cells: [61, 2], anims: [62, 3] } as const;
/** NARC_INDEX_NONE (sprite_resource.c): the end of a resource table. */
const TABLE_END = 0xfffffffe;

/** A SpriteResourceTableBinary: u32 type, then {narc, member, compressed, id, vram, palette} entries up to TABLE_END. */
function spriteTable(narc: Uint8Array[], [member, type]: readonly [number, number]): number[] {
  const bytes = narc[member];
  if (!bytes) throw new Error(`weather_sys.narc has no member ${member}`);
  const r = new Reader(bytes);
  if (r.u32(0) !== type) throw new Error(`weather sprite table ${member}: type ${r.u32(0)}, expected ${type}`);
  const members: number[] = [];
  for (let o = 4; r.u32(o) !== TABLE_END; o += 24) {
    if (o + 24 > bytes.length) throw new Error(`weather sprite table ${member}: no end`);
    if (r.u32(o + 8) !== 0) throw new Error(`weather sprite table ${member}: a compressed entry`);
    members.push(r.u32(o + 4));
  }
  return members;
}

/**
 * OAM set `set` (the weather task table's particle resource) as a packed PNG of its cells, and per animation frame the
 * cell it shows (the set's one NANR sequence).
 */
export function weatherSpriteSet(narc: Uint8Array[], set: number): { png: Uint8Array; cells: WeatherSprites['cells']; frames: number[] } {
  const member = (kind: keyof typeof SPRITE_TABLES) => {
    const i = spriteTable(narc, SPRITE_TABLES[kind])[set];
    const bytes = i === undefined ? undefined : narc[i];
    if (!bytes) throw new Error(`weather sprite set ${set}: no ${kind} member`);
    return bytes;
  };
  const bank = readNcer(member('cells'));
  const chars = readNcgrData(member('chars'));
  const palette = readNclr(member('palettes'));
  const sequences = readNanr(member('anims'));
  if (sequences.length !== 1) throw new Error(`weather sprite set ${set}: ${sequences.length} animation sequences, expected 1`);
  const packed = pack(bank.cells.map((c) => renderCell(c, chars.data, palette.colors, { mapping: bank.mapping })));
  const frames = sequences[0]!.frames.map((f) => {
    if (f.cell >= bank.cells.length) throw new Error(`weather sprite set ${set}: a frame shows cell ${f.cell} of ${bank.cells.length}`);
    return f.cell;
  });
  return { png: encodeImage(packed.image), cells: packed.cells, frames };
}
