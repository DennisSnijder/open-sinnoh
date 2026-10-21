/**
 * Poffins (decomp poffin.c, applications/poffin_case/main.c, overlay083/ov83_0223F7F4.c): making one from flavours,
 * its level, the Poffin Case, feeding one to a Pokémon (its condition and friendship), and the cooking's physics: the
 * pot that the stylus stirs, its three phases, the burns and spills, the stirring direction, and the Poffin it makes.
 * Pure rules over `GameState.poffins` and core `Pokemon.condition`; the menus draw them.
 */
import { CONDITIONS, MAX_CONDITION, MAX_FRIENDSHIP, type Dex, type Id, type NatureData, type Pokemon, type Rng, type StatName } from '@opensinnoh/core';
import { POFFIN_CASE_SIZE, POFFIN_TYPE, newGameRecord, type GameState, type Poffin, type Registries } from '@opensinnoh/contracts';

/** Decomp enum Flavor (FLAVOR_SPICY … FLAVOR_SOUR); each raises the condition of the same index (cool … tough). */
export const FLAVORS = ['spicy', 'dry', 'sweet', 'bitter', 'sour'] as const;
export type Flavors = [number, number, number, number, number];

/**
 * Decomp Poffin_MakePoffin: one flavour is that flavour's type, two the stronger first (equal: the earlier), three RICH,
 * four or five OVERRIPE, any of 50 or more MILD; none, or `foul`, is FOUL (Poffin_MakeFoul: three random flavours at 2
 * on the game's LCRNG, here the main stream).
 */
export function makePoffin(flavors: readonly number[], smoothness: number, foul: boolean, rng: Rng): Poffin {
  const present = [0, 1, 2, 3, 4].filter((i) => flavors[i]! > 0);
  if (foul || present.length === 0) {
    const out: Flavors = [0, 0, 0, 0, 0];
    for (let n = 0; n < 3; ) {
      const i = rng.next() % 5;
      if (out[i]) continue;
      out[i] = 2;
      n++;
    }
    return { type: POFFIN_TYPE.foul, flavors: out, smoothness };
  }
  let type: number;
  if (present.length === 1) type = present[0]! * 5 + present[0]!;
  else if (present.length === 2) {
    const [a, b] = present as [number, number];
    type = flavors[a]! >= flavors[b]! ? a * 5 + b : b * 5 + a;
  } else type = present.length === 3 ? POFFIN_TYPE.rich : POFFIN_TYPE.overripe;
  if (present.some((i) => flavors[i]! >= 50)) type = POFFIN_TYPE.mild;
  return { type, flavors: flavors.slice(0, 5) as Flavors, smoothness };
}

/** Decomp Poffin_CalcLevel: the main flavour's strength (types 0–24), the strongest for the rest; at most 99. */
export function poffinLevel(p: Poffin): number {
  const main = Math.floor(p.type / 5);
  return Math.min(99, main < 5 ? p.flavors[main]! : Math.max(...p.flavors));
}

/** Decomp PoffinCase_AddPoffin: into the first empty slot; false when the case is full (POFFIN_NONE). */
export function addPoffin(state: GameState, p: Poffin): boolean {
  if (state.poffins.length >= POFFIN_CASE_SIZE) return false;
  state.poffins.push(p);
  return true;
}

/** Decomp PoffinCase_ClearSlot then PoffinCase_Compact: the later Poffins move up. */
export function removePoffin(state: GameState, index: number): void {
  if (!state.poffins[index]) throw new Error(`removePoffin: no Poffin ${index}`);
  state.poffins.splice(index, 1);
}

/** Decomp ScrCmd_CheckCanCookPoffin: 1 without a berry, 2 with a full case, else 0. */
export function cookCheck(state: GameState): 0 | 1 | 2 {
  if (!(state.bag.berries ?? []).length) return 1;
  return state.poffins.length >= POFFIN_CASE_SIZE ? 2 : 0;
}

/**
 * Decomp sFlavorPreferences (poffin_case/main.c): a nature likes the flavour of the stat it raises and dislikes the
 * one of the stat it lowers (spicy Attack, dry Sp. Atk, sweet Speed, bitter Sp. Def, sour Defense); the neutral ones
 * have none.
 */
const STAT_FLAVOR: Partial<Record<StatName, number>> = { attack: 0, spAttack: 1, speed: 2, spDefense: 3, defense: 4 };
export function flavorPreference(nature: NatureData): { liked: number; disliked: number } | null {
  if (!nature.up || !nature.down) return null;
  return { liked: STAT_FLAVOR[nature.up]!, disliked: STAT_FLAVOR[nature.down]! };
}

/** Decomp PoffinCase_GetPoffinPreference. */
export function poffinPreference(p: Poffin, nature: NatureData): 'like' | 'dislike' | 'neutral' {
  const pref = flavorPreference(nature);
  if (!pref) return 'neutral';
  const liked = p.flavors[pref.liked]!;
  const disliked = p.flavors[pref.disliked]!;
  return liked === disliked ? 'neutral' : liked > disliked ? 'like' : 'dislike';
}

/** Decomp MAX_POKEMON_SHEEN: the summary's TryFeedPoffin refuses ("won't eat any more"). */
export const wontEat = (mon: Pokemon): boolean => mon.condition.sheen >= MAX_CONDITION;

/**
 * Decomp PoffinCase_UpdateMonContestStats: each flavour adds to its condition and the smoothness to the sheen, the
 * liked flavour ×1.1 and the disliked ×0.9 (truncated, as the u8 cast), each at most 255; friendship +1.
 */
export function feedPoffin(dex: Dex, mon: Pokemon, p: Poffin): void {
  const add = [...p.flavors, p.smoothness];
  const pref = flavorPreference(dex.nature(mon.pid));
  if (pref) {
    add[pref.liked] = Math.trunc(Math.fround(add[pref.liked]! * Math.fround(1.1)));
    add[pref.disliked] = Math.trunc(Math.fround(add[pref.disliked]! * Math.fround(0.9)));
  }
  CONDITIONS.forEach((c, i) => (mon.condition[c] = Math.min(MAX_CONDITION, mon.condition[c] + (add[i]! & 0xff))));
  if (mon.friendship < MAX_FRIENDSHIP) mon.friendship++;
}

/** A berry's Poffin data (BerryTables): its five flavours and smoothness. */
export function berryFlavors(registries: Registries, item: Id): { flavors: Flavors; smoothness: number } {
  const b = newGameRecord(registries).berries?.berries.find((x) => x.item === item);
  if (!b) throw new Error(`berryFlavors: ${item} is not in NewGame.berries`);
  return { flavors: b.flavors, smoothness: b.smoothness };
}

// --- cooking (overlay083/ov83_0223F7F4.c) ---

/** The pot's centre on the touch screen. */
export const POT_CENTER = { x: 128, y: 96 } as const;
/** Decomp: the speed past which the batter spills (3640) and under which it burns (910). */
export const POT_SPEED = { max: 3640, slow: 910 } as const;
/** Decomp ov83_0223FC58: a phase ends after 20 s or 16 laps; the cooking has 3 phases. */
export const PHASE_FRAMES = 20 * 30;
export const PHASE_LAPS = 16;
const PHASES = 3;
/** Decomp Unk_ov83_02240590 ÷ 204 as FX (8/204, 7/204, 7/204) and Unk_ov83_0224059C (the friction), per phase. */
const STIR_GAIN = [160, 140, 140];
const FRICTION = [64, 72, 80];
/** Decomp ov83_0223FBBC: the frames until the next direction roll, per phase (+ 0–59). */
const DIRECTION_FRAMES = [150, 120, 90];
/** Decomp CalcRadialAngle(68, d): the batter's radius, 2πr = 427 px (FX_Mul with FX32_CONST(3.140f)). */
const BATTER_CIRCUMFERENCE = 427;

/** Decomp ApproximateArcLength (math_util.c): the signed distance moved around the origin (positive = clockwise on screen). */
export function arcLength(x0: number, y0: number, x1: number, y1: number): number {
  const cross = x0 * y1 - y0 * x1;
  const len = Math.hypot(y0, x0);
  if (len === 0) return 0;
  const nx = Math.round((y0 / len) * 4096);
  const ny = Math.round((x0 / len) * 4096);
  const dot = Math.floor((nx * (x1 - x0) * 4096 + ny * (y1 - y0) * 4096 + 2048) / 4096);
  const result = Math.abs(Math.floor(dot / 4096));
  return cross <= 0 ? -result : result;
}

/** Decomp ov83_0223FB68: the batter's scale with its speed, 1 to 1.25, in FX32 (4096 = 1). */
export function batterScale(speed: number): number {
  return 4096 + Math.trunc((Math.max(0, Math.abs(speed) - POT_SPEED.slow) * 1024) / (POT_SPEED.max - POT_SPEED.slow));
}

/** The stylus as the cooking reads it each frame (decomp ov83_0223F820, ov83_0223F88C). */
interface Spoon {
  x: number;
  y: number;
  /** The arc moved since the last frame × 160 (u16) and its direction (1 = counter-clockwise). */
  speed: number;
  dir: 0 | 1;
}

/** One frame's events, for the screen and its sounds (decomp UnkStruct_ov83_0223FCE8 unk_0E, unk_12, unk_13). */
export interface CookEvents {
  /** The direction was rolled (it may be the same one). */
  direction: boolean;
  /** `warn`: the batter is about to burn (smoke); `burn`: it burned. */
  burn: 'warn' | 'burn' | null;
  spill: boolean;
}

/**
 * The cooking (decomp ov83_0223FDB0 and its parts), one player: each 30 Hz frame `step` takes the stylus (null when
 * not touching) and moves the batter. The batter reads the stylus of the previous frame, as on the DS, where the
 * player's record reaches the pot through the comm queue after the vblank.
 */
export class PoffinCook {
  /** 0–2, 3 when done (decomp unk_4C.unk_08). */
  phase = 0;
  private phaseFrames = 0;
  /** Laps in the required direction this phase (decomp unk_1C.unk_04). */
  laps = 0;
  /** The batter's speed, −3640 to 3640 (decomp unk_1C.unk_0C), and its angle (unk_08, 0–0xFFFF a turn). */
  speed = 0;
  private turn = 0;
  /** The stylus is on the batter (decomp unk_1C.unk_10). */
  inPot = true;
  burns = 0;
  spills = 0;
  private overflowFrames = 0;
  private slowFrames = 0;
  private warned = false;
  /** The direction to stir (decomp unk_0C.unk_00: 0 clockwise, 1 counter-clockwise), its bias and timer. */
  direction: 0 | 1 = 0;
  private bias = 2;
  private timer = -1;
  /** Cooking frames (decomp unk_00). */
  frames = 0;
  /** The phase's fade (decomp unk_4C.unk_04): 31, falling to 0 over its last 2 s or 5 laps. */
  fade = 31;
  events: CookEvents = { direction: false, burn: null, spill: false };
  private touch: { x: number; y: number; px: number; py: number; held: boolean } = { x: POT_CENTER.x, y: POT_CENTER.y, px: POT_CENTER.x, py: POT_CENTER.y, held: false };
  private spoon: Spoon = { x: POT_CENTER.x, y: POT_CENTER.y, speed: 0, dir: 0 };

  constructor(private readonly rng: Rng) {
    this.rollDirection();
  }

  /** The batter's angle, 0–0xFFFF a turn (decomp ov83_0223FA84). */
  get angle(): number {
    return this.turn & 0xffff;
  }

  get done(): boolean {
    return this.phase >= PHASES;
  }

  /** The stylus position the screen shows (the last touched point). */
  get stylus(): { x: number; y: number } {
    return { x: this.touch.x, y: this.touch.y };
  }

  /** One frame (decomp ov83_0223F83C, ov83_0223FDD8, ov83_0223FFA0): false once the last phase ended. */
  step(touch: { x: number; y: number } | null): boolean {
    this.events = { direction: false, burn: null, spill: false };
    const last = this.spoon;
    this.spoon = this.readTouch(touch);
    if (this.stepPhase()) return false;
    this.stepPot(last);
    this.stepHeat();
    this.stepDirection();
    this.frames++;
    return true;
  }

  /** Decomp ov83_0223F83C and ov83_0223F88C. */
  private readTouch(touch: { x: number; y: number } | null): Spoon {
    const t = this.touch;
    if (touch) {
      t.x = touch.x;
      t.y = touch.y;
      if (!t.held) {
        t.px = t.x;
        t.py = t.y;
      }
    }
    const arc = arcLength(t.px - POT_CENTER.x, t.py - POT_CENTER.y, t.x - POT_CENTER.x, t.y - POT_CENTER.y) * 160;
    t.px = t.x;
    t.py = t.y;
    t.held = touch !== null;
    return { x: t.x & 0xff, y: t.y & 0xff, speed: Math.abs(arc) & 0xffff, dir: arc < 0 ? 1 : 0 };
  }

  /** Decomp ov83_0223FC58: the phase ends at 20 s or 16 laps; the fade. True when the cooking is done. */
  private stepPhase(): boolean {
    if (this.done) return true;
    if (this.phaseFrames === PHASE_FRAMES || this.laps >= PHASE_LAPS) {
      this.phase++;
      this.phaseFrames = 0;
      if (this.done) return true;
      this.laps = 0;
    }
    const timeLeft = PHASE_FRAMES - this.phaseFrames;
    const lapsLeft = PHASE_LAPS - this.laps;
    const byTime = timeLeft <= 60 ? Math.trunc((31 * timeLeft) / 60) : 31;
    const byLaps = lapsLeft <= 5 ? Math.trunc((31 * lapsLeft) / 5) : 31;
    this.fade = Math.min(byTime, byLaps);
    this.phaseFrames++;
    return false;
  }

  /** Decomp ov83_0223F8AC: 0 on the batter, 1 too near the middle (half), 2 off it (nothing). */
  private ring(x: number, y: number): 0 | 1 | 2 {
    const d = Math.floor(Math.hypot(x - POT_CENTER.x, y - POT_CENTER.y));
    const edge = Math.floor(batterScale(this.speed) / 64) + 8;
    return d < 16 ? 1 : d > edge ? 2 : 0;
  }

  /** Decomp ov83_0223F900 (one player): the stylus pushes the batter, friction slows it, laps count. */
  private stepPot(spoon: Spoon): void {
    this.inPot = true;
    const ring = this.ring(spoon.x, spoon.y);
    let push = ring === 0 ? spoon.speed : ring === 1 ? spoon.speed >> 1 : 0;
    if (ring !== 0) this.inPot = false;
    if (spoon.dir) push = -push;
    let speed = this.speed + Math.floor((push * STIR_GAIN[this.phase]!) / 4096);
    const friction = FRICTION[this.phase]!;
    if (speed > 0) speed = Math.max(0, speed - friction);
    else if (speed < 0) speed = Math.min(0, speed + friction);
    this.speed = Math.max(-POT_SPEED.max, Math.min(POT_SPEED.max, speed));
    const before = this.turn & 0xffff;
    this.turn = (this.turn + Math.trunc((Math.trunc(this.speed / 160) * 0xffff) / BATTER_CIRCUMFERENCE)) | 0;
    const after = this.turn & 0xffff;
    if (this.direction === 0 && this.speed >= 0 && before > after) this.laps++;
    else if (this.direction === 1 && this.speed < 0 && before < after) this.laps++;
  }

  /** Decomp ov83_0223FAAC: a second at full speed spills (not in the last phase); 3 s at a crawl warns, then burns. */
  private stepHeat(): void {
    const speed = Math.abs(this.speed);
    if (this.phase !== 2 && speed >= POT_SPEED.max) {
      if (++this.overflowFrames >= 30) {
        this.spills = Math.min(9999, this.spills + 1);
        this.events.spill = true;
        this.overflowFrames = 0;
      }
      this.warned = false;
    } else if (speed <= POT_SPEED.slow) {
      if (++this.slowFrames >= 90) {
        this.slowFrames = 0;
        if (!this.warned) {
          this.events.burn = 'warn';
          this.warned = true;
        } else {
          this.events.burn = 'burn';
          this.burns = Math.min(9999, this.burns + 1);
        }
      }
    } else this.warned = false;
  }

  /** Decomp ov83_0223FC3C: the batter turns against the direction asked for. */
  get against(): boolean {
    return (this.speed < 0 && this.direction === 0) || (this.speed > 0 && this.direction === 1);
  }

  /** Decomp ov83_0223FBBC: the direction holds while stirred against it; otherwise it is rolled again when its timer runs out. */
  private stepDirection(): void {
    if (this.against) return;
    this.rollDirection();
  }

  private rollDirection(): void {
    if (this.timer < 0) {
      const r = this.rng.next();
      const dir = r % 5 <= this.bias ? 1 : 0;
      this.events.direction = true;
      if (dir === this.direction) {
        if (dir === 1) this.bias = Math.max(0, this.bias - 1);
        else this.bias = Math.min(4, this.bias + 1);
      } else {
        this.direction = dir;
        this.bias = 2;
      }
      this.timer = DIRECTION_FRAMES[Math.min(this.phase, 2)]! + (r % 60);
    }
    this.timer--;
  }

  /**
   * Decomp ov83_0223FFD4 (one player): each flavour less the next one, less the number of negative ones (four or
   * more is FOUL), scaled by how fast it cooked (60 s is ×1), less the burns and spills; the smoothness less 1, at
   * least 15.
   */
  result(berry: { flavors: readonly number[]; smoothness: number }): Poffin {
    const diff = [0, 1, 2, 3, 4].map((i) => berry.flavors[i]! - berry.flavors[(i + 1) % 5]!);
    const negatives = diff.filter((d) => d < 0).length;
    let scale = Math.trunc((PHASE_FRAMES * PHASES * 1000) / this.frames);
    if (scale % 10 >= 5) scale += 10;
    scale = Math.trunc(scale / 10);
    const flavors = diff.map((d) => {
      let v = (d - negatives) * scale;
      if (v % 100 >= 50) v += 100;
      return Math.max(0, Math.trunc(v / 100) - (this.burns + this.spills)) & 0xff;
    });
    return makePoffin(flavors, Math.max(15, berry.smoothness - 1), negatives >= 4, this.rng);
  }

  /** Decomp ov83_022401AC: the cooking time as minutes, seconds and hundredths. */
  time(): { minutes: number; seconds: number; hundredths: number } {
    const minutes = Math.floor(this.frames / 1800);
    const seconds = Math.floor((this.frames - minutes * 1800) / 30);
    return { minutes, seconds, hundredths: Math.floor((100 * (this.frames % 30)) / 30) };
  }
}
