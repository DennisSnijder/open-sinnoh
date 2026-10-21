/**
 * Fly's cut-in and landing (decomp overlay006/hm_cut_in.c: sCutInTaskFuncsFly, the fly-away and landing anim
 * managers, PushPlayer, the wind particles; overlay005/ov5_021F0EB0.c, the camera zoom), stepped once per 30 Hz tick
 * as the DS main loop runs its tasks. Positions are fx32 (×4096) DS screen coordinates, as the decomp keeps them; the
 * view hands them out in DS px.
 *
 * Every task the decomp runs as its own SysTask is stepped in its priority order (PushPlayer 129, the bird 130, the
 * wind 132, the cut-in or landing 133, the player's show/hide 134, the camera zoom last); a task created during a
 * tick starts on the next one. The cut-in's state functions repeat within a tick while they return true.
 */
import type { FlySceneView } from '@opensinnoh/contracts';

export const FX = 4096;
const fx = (v: number) => Math.round(v * FX);
/** C integer division (fx32 / int, truncating toward zero). */
const div = (a: number, b: number) => Math.trunc(a / b);
const SIN = Array.from({ length: 360 }, (_, d) => Math.round(Math.sin((d * Math.PI) / 180) * FX));
/** CalcSineDegrees_Wraparound / CalcCosineDegrees_Wraparound of whole degrees (u16, then % 360). */
const sin = (deg: number) => SIN[(deg & 0xffff) % 360]!;
const cos = (deg: number) => SIN[((deg & 0xffff) % 360 + 90) % 360]!;
const deg = (v: number) => div(v, FX);

/** ov5_021F0EB0: the camera's distance eased by `delta` over `frames` (mode 1), or back (mode 2). */
export class CameraZoom {
  /** Distance added to the camera's own (fx32 world units). */
  offset = 0;
  private mode = 0;
  private sub = 0;
  private step = 0;
  private target = 0;
  private count = 0;
  private frames = 0;
  done = false;

  set(mode: 1 | 2, delta: number, frames: number): void {
    [this.mode, this.sub, this.count, this.frames, this.done] = [mode, 0, 0, frames, false];
    if (mode === 1) [this.step, this.target] = [div(delta, frames), this.offset + delta];
    else [this.step, this.target] = [div(0 - this.offset, frames), 0];
  }

  tick(): void {
    if (this.mode === 0) {
      this.done = true;
      return;
    }
    if (this.sub === 0) this.sub = 1;
    if (this.sub !== 1) return;
    this.offset += this.step;
    if (++this.count >= this.frames) {
      [this.count, this.offset, this.done, this.sub] = [this.frames, this.target, true, 2];
    }
  }
}

interface Sprite {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  visible: boolean;
}
interface PlayerSprite extends Sprite {
  anim: number;
  /** Ticks since the animation started, while it animates. */
  animTick: number;
  animating: boolean;
}

const newPlayer = (): PlayerSprite => ({ x: 0, y: 0, scale: FX, rotation: 0, visible: false, anim: 6, animTick: 0, animating: false });
const setAnim = (p: PlayerSprite, anim: number) => {
  p.anim = anim;
  p.animTick = 0;
};

/** PushPlayer (sPushPlayerFuncs): the player sprite lifted by the significant (fly away) or slight (landing) deltas. */
class PushPlayer {
  private mode: 0 | 1 | 2 = 0;
  private base = 0;
  private idx = 0;
  private finished = false;
  constructor(private readonly player: PlayerSprite) {}
  /** FlyPickUpPlayer_SetUpPlayerAnimEnv (1) and FlyLanding_SetUpPlayerAnimEnv (2). */
  start(mode: 1 | 2): void {
    [this.mode, this.idx, this.finished, this.base] = [mode, 0, false, this.player.y];
    setAnim(this.player, mode === 1 ? 5 : 4);
  }
  stop(): void {
    this.mode = 0;
  }
  tick(): void {
    if (this.mode === 0 || this.finished) return;
    const deltas = this.mode === 1 ? [-12, -16, -20, -24, -26, -28, -28, -28, -26, -24, -22, -20] : [-4, -6, -7, -8];
    this.player.y = this.base + fx(deltas[this.idx]!);
    if (++this.idx >= deltas.length) [this.idx, this.finished] = [0, true];
  }
}

/** sWindParticleAnimConfigs: x, y, x speed (px), animation; each also 256 px to the right. */
const WIND = [
  [15, 63, 16, 0], [76, 67, 16, 0], [128, 61, 24, 1], [240, 69, 16, 0], [40, 78, 24, 1], [72, 91, 16, 0], [208, 86, 24, 1],
  [56, 116, 16, 0], [95, 109, 24, 1], [159, 100, 16, 0], [24, 126, 24, 1], [140, 125, 24, 1], [221, 124, 24, 1],
] as const;

export interface FlyHost {
  cry(): void;
  /** A sound effect by its SDAT name (`SEQ_SE_DP_FW019`). */
  se(name: string): void;
  fadeOut(): void;
  fadeIn(): void;
  fadeDone(): boolean;
  /** HidePlayerMapObj: the player's own (3D) sprite hidden or shown. */
  hidePlayer(hidden: boolean): void;
}

/** The fly-away anim manager's state (FlyTaskEnv): stage 1 ascends from the Poké Ball, stage 2 picks the player up. */
interface Bird {
  stage: 1 | 2;
  state: number;
  subState: number;
  descendCount: number;
  start: [number, number];
  scale: number;
  rotation: number;
  angle: number;
  path: number;
  delta: number;
  scaleDelta: number;
  playerOffsetY: number;
  sprite: Sprite;
}

/** The cut-in of Fly (HMCutIn_StartTask with isFly, sCutInTaskFuncsFly). */
export class FlyCutIn {
  private state = 0;
  private subState = 0;
  private ready = false;
  private window = { on: false, x1: 0, y1: fx(192), x2: fx(1), y2: fx(192), delta: 0 };
  private pattern = false;
  private wind: { x: number; y: number; dx: number; anim: number; visible: boolean }[] = [];
  private windState: 1 | 2 = 2;
  private mon: { x: number; delta: number } | null = null;
  private readonly player = newPlayer();
  private showHide = false;
  private forceDraw = false;
  private bird: Bird | null = null;
  private push: PushPlayer | null = null;
  readonly zoom = new CameraZoom();
  private zoomActive = false;
  private faded = false;
  /** Tasks started this tick, which run from the next. */
  private pending: (() => void)[] = [];
  finished = false;

  constructor(private readonly h: FlyHost) {}

  tick(): void {
    for (const start of this.pending.splice(0)) start();
    this.push?.tick();
    this.birdTick();
    this.windTick();
    while (this.cutIn()) { /* the state functions that return true run on in this tick */ }
    if (this.showHide && !this.forceDraw) {
      const p = this.player;
      p.visible = p.y - fx(8) >= this.window.y1 && p.y + fx(8) <= this.window.y2;
    } else if (this.showHide) this.player.visible = true;
    if (this.zoomActive) this.zoom.tick();
    if (this.player.animating) this.player.animTick++;
  }

  private windTick(): void {
    for (const w of this.wind) {
      w.x = (w.x + w.dx) % fx(512);
      w.visible = this.windState === 2 && w.y - fx(2) >= this.window.y1 && w.y - fx(2) <= this.window.y2 && w.y + fx(2) >= this.window.y1 && w.y + fx(2) <= this.window.y2;
    }
  }

  /** One call of the current state function; true to call again this tick. */
  private cutIn(): boolean {
    const w = this.window;
    switch (this.state) {
      case 0: // CutIn_Init: the window (empty), the resources transfer on the next frame
        w.on = true;
        this.pattern = true;
        this.state++;
        this.pending.push(() => (this.ready = true));
        return false;
      case 1: // CutIn_InitSpritesFly
        if (!this.ready) return false;
        Object.assign(this.player, { x: fx(128), y: fx(96), visible: false });
        setAnim(this.player, 6);
        this.mon = { x: fx(256 + 40), delta: 0 };
        this.pending.push(() => {
          for (const [x, y, dx, anim] of WIND) for (const ox of [0, 256]) this.wind.push({ x: fx(x + ox), y: fx(y), dx: fx(dx), anim, visible: false });
        });
        this.windState = 2;
        this.state++;
        return true;
      case 2: // HMCutIn_InitWindowAndPlayerSprite
        this.pending.push(() => (this.showHide = true));
        Object.assign(w, { delta: fx(-64), x1: fx(254), x2: fx(255), y1: fx(95), y2: fx(97) });
        this.state++;
        return false;
      case 3: // HMCutIn_WindowExpandX
        w.x1 += w.delta;
        if (w.x1 <= 0) [w.x1, w.delta, this.state] = [0, 0x2000, this.state + 1];
        return false;
      case 4: // HMCutIn_WindowExpandY
        w.y1 -= w.delta;
        w.y2 += w.delta;
        w.delta = Math.min(w.delta + 0x2000, fx(32));
        w.y1 = Math.max(w.y1, fx(96 - 40));
        w.y2 = Math.min(w.y2, fx(96 + 40));
        if (w.y1 === fx(56) && w.y2 === fx(136)) {
          this.player.animating = true;
          this.state++;
        }
        return false;
      case 5: // HMCutIn_SlideInSpeedUp
        if (++this.subState >= 15) [this.subState, this.mon!.delta, this.state] = [0, fx(-64), this.state + 1];
        return false;
      case 6: { // HMCutIn_SlideMonIn
        const m = this.mon!;
        m.x += m.delta;
        if (m.x <= fx(128 + 32)) [m.x, this.state] = [fx(128 + 64), this.state + 1];
        return false;
      }
      case 7: { // HMCutIn_SlideMonToCenter
        const m = this.mon!;
        m.delta = div(m.delta, 2);
        if (m.delta > fx(-2)) {
          m.delta = fx(-2);
          this.state++;
          this.h.cry();
        }
        m.x += m.delta;
        return false;
      }
      case 8: // HMCutIn_SlideOutSpeedUp
        if (++this.subState >= 8) [this.subState, this.mon!.delta, this.state] = [0, fx(-1), this.state + 1];
        return false;
      case 9: { // HMCutIn_SlideMonOut
        const m = this.mon!;
        m.delta = Math.max(m.delta * 2, fx(-64));
        m.x += m.delta;
        if (m.x <= fx(-40)) [w.delta, this.state] = [0x1000, this.state + 1];
        return false;
      }
      case 10: // HMCutIn_UnloadMonSprite
        this.mon = null;
        this.state++;
        return false;
      case 11: // HMCutIn_LoadBirdSprite
        this.ready = false;
        this.pending.push(() => (this.ready = true));
        this.state++;
        return false;
      case 12: // HMCutIn_WaitResourceTransfer
        if (!this.ready) return false;
        this.state++;
        return true;
      case 13: // HMCutIn_InitFlyTasks: Fly_CreateTasks, Fly_InitBirdSpritePos, the player's map object hidden
        this.bird = {
          stage: 1, state: 0, subState: 0, descendCount: 0, start: [fx(136), fx(88)], scale: 0x400, rotation: fx(60), angle: fx(180), path: 0, delta: 0x2000, scaleDelta: 0x200, playerOffsetY: 0,
          sprite: { x: fx(136), y: fx(88), scale: 0x400, rotation: 60, visible: true },
        };
        this.birdActive = false;
        this.pending.push(() => (this.birdActive = true));
        this.h.hidePlayer(true);
        this.state++;
        return false;
      case 14: // HMCutIn_PlayerAnimBackToDefault
        if (this.bird!.subState !== 2) return false;
        setAnim(this.player, 1);
        this.state++;
        return false;
      case 15: // HMCutIn_PrepareDescent: its count runs to 20 within the tick (it returns true)
        if (++this.subState < 20) return true;
        this.subState = 0;
        this.state++;
        this.prepareDescent();
        return true;
      case 16: // HMCutIn_PlaySwooshSound
        if (this.bird!.subState !== 3) return false;
        this.h.se('SEQ_SE_DP_FW019');
        w.delta = fx(0.5);
        this.windState = 2;
        this.state++;
        return true;
      case 17: // HMCutIn_SlideOutWindow
        w.y1 = Math.min(w.y1 + w.delta, fx(96 - 1));
        w.y2 = Math.max(w.y2 - w.delta, fx(96 + 1));
        w.delta = Math.min(w.delta + fx(0.5), fx(16));
        if (w.y1 === fx(95) && w.y2 === fx(97)) {
          this.pattern = false;
          this.windState = 1;
          w.on = false;
          this.state++;
        }
        return false;
      case 18: // HMCutIn_FadeOut
        if (this.bird!.subState !== 2) return false;
        if (!this.faded) {
          this.faded = true;
          this.h.fadeOut();
        }
        // FlyAway_SetTasksDone: PushPlayer, the zoom and the bird end.
        this.push = null;
        this.zoomActive = false;
        this.bird = null;
        this.state++;
        return false;
      case 19: // HMCutIn_CheckFadeOutComplete
        if (this.h.fadeDone()) this.state++;
        return false;
      case 20: // HMCutIn_DeleteSprites
        this.wind = [];
        this.showHide = false;
        this.player.visible = false;
        this.state++;
        return false;
      case 21: // HMCutIn_WindowTaskDone
        this.state++;
        return false;
      default: // HMCutIn_Done
        this.finished = true;
        return false;
    }
  }

  private birdActive = false;

  /** Fly_PrepareBirdForDescent. */
  private prepareDescent(): void {
    const b = this.bird!;
    Object.assign(b, { stage: 2, state: 0, subState: 1, descendCount: 0, start: [fx(128), fx(104)], rotation: fx(315), scale: fx(1.25), scaleDelta: fx(0.0625), angle: fx(225), path: fx(192), delta: fx(32) });
    b.sprite = { x: b.start[0] + cos(315) * deg(b.path), y: b.start[1] + sin(deg(b.angle)) * deg(b.path), scale: b.scale, rotation: 315, visible: true };
    const push = new PushPlayer(this.player);
    this.pending.push(() => (this.push = push));
    this.forceDraw = true;
    this.zoom.set(1, fx(-120), 12);
    this.pending.push(() => (this.zoomActive = true));
    this.player.scale = FX;
  }

  private birdTick(): void {
    const b = this.bird;
    if (!b || !this.birdActive) return;
    for (;;) {
      if (b.stage === 1) {
        if (b.state !== 0) return;
        // FlyAwayAscendFromPokeball_AscendAnim
        b.path += b.delta;
        if (b.delta < fx(16)) b.delta += fx(4);
        const ox = cos(315) * deg(b.path);
        const oy = sin(deg(b.angle)) * deg(b.path);
        if (deg(b.angle) < 270) b.angle += fx(4);
        b.scale = Math.min(b.scale + b.scaleDelta, FX);
        b.rotation -= fx(6);
        if (deg(b.rotation) < 0) b.rotation = 0;
        Object.assign(b.sprite, { x: b.start[0] + ox, y: b.start[1] + oy, scale: b.scale, rotation: deg(b.rotation) });
        if (b.sprite.y < fx(-64)) {
          b.sprite.visible = false;
          b.subState = 2;
          b.state++;
        }
        return;
      }
      switch (b.state) {
        case 0: { // FlyPickUpPlayer_DescendToCenter
          b.path = Math.max(0, b.path - b.delta);
          if (b.delta > 0x800) b.delta -= 0x1800;
          if (b.delta < FX) b.delta = FX;
          const ox = cos(315) * deg(b.path);
          const oy = sin(deg(b.angle)) * deg(b.path);
          if (deg(b.angle) < 270) b.angle += fx(4);
          b.scale = Math.min(b.scale + b.scaleDelta, 0x1800);
          b.rotation += fx(8);
          if (deg(b.rotation) > 360) b.rotation = fx(360);
          Object.assign(b.sprite, { x: b.start[0] + ox, y: b.start[1] + oy, scale: b.scale, rotation: deg(b.rotation) });
          if (b.path === 0) [b.descendCount, b.state] = [0, 1];
          else b.descendCount++;
          if (b.descendCount === 12) this.push?.start(1);
          this.player.scale = Math.min(this.player.scale + 0x80, 0x1400);
          return;
        }
        case 1: // FlyPickUpPlayer_PrepareForTakeoff (returns 1: the ascent runs on this tick)
          setAnim(this.player, 3);
          b.playerOffsetY = this.player.y - b.sprite.y;
          this.push?.stop();
          this.zoom.set(2, 0, 12);
          Object.assign(b, { scaleDelta: fx(1 / 16), angle: fx(128), path: 0, delta: fx(0.5), subState: 3, state: 2 });
          continue;
        case 2: { // FlyPickUpPlayer_AscendToBottomLeft
          b.path += b.delta;
          b.delta = Math.min(b.delta + 0x1000, fx(16));
          const ox = cos(deg(b.angle)) * deg(b.path);
          const oy = sin(128) * deg(b.path);
          if (b.angle < fx(135)) b.angle += 0x1000;
          b.scale = Math.min(b.scale + b.scaleDelta, 0x2000);
          Object.assign(b.sprite, { x: b.start[0] + ox, y: b.start[1] + oy, scale: b.scale });
          b.playerOffsetY -= 0x1000;
          Object.assign(this.player, { x: b.sprite.x, y: b.sprite.y + b.playerOffsetY, scale: Math.min(this.player.scale + 0x100, 0x2000) });
          if (deg(b.sprite.y) >= 240) [b.subState, b.state] = [2, 3];
          return;
        }
        default:
          return;
      }
    }
  }

  view(gender: 'male' | 'female', mon: Pick<NonNullable<FlySceneView['mon']>, 'species' | 'form' | 'shiny' | 'female'>): FlySceneView {
    const w = this.window;
    const px = (v: number) => v / FX;
    return {
      gender,
      band: w.on ? { x1: px(w.x1), y1: px(w.y1), x2: px(w.x2), y2: px(w.y2), pattern: this.pattern } : null,
      wind: this.wind.filter((p) => p.visible).map((p) => ({ x: px(p.x), y: px(p.y), anim: p.anim })),
      mon: this.mon ? { ...mon, x: px(this.mon.x), y: 96 } : null,
      player: this.player.visible ? playerView(this.player) : null,
      bird: this.bird?.sprite.visible ? spriteView(this.bird.sprite) : null,
    };
  }
}

const spriteView = (s: Sprite) => ({ x: s.x / FX, y: s.y / FX, scale: s.scale / FX, rotation: s.rotation });
const playerView = (p: PlayerSprite) => ({ ...spriteView(p), anim: p.anim, tick: p.animating ? p.animTick : 0 });

/** The landing (FieldTask_FlyLanding_InitTask, sFlyLandingFuncs and the landing anim manager). */
export class FlyLanding {
  private state = 0;
  private readonly player = newPlayer();
  private env: Bird | null = null;
  private envActive = false;
  private push: PushPlayer | null = null;
  readonly zoom = new CameraZoom();
  private zoomActive = false;
  private ended = false;
  private pending: (() => void)[] = [];
  finished = false;

  constructor(private readonly h: FlyHost) {}

  tick(): void {
    for (const start of this.pending.splice(0)) start();
    this.push?.tick();
    if (this.env && this.envActive) this.envTick(this.env);
    this.landing();
    if (this.zoomActive) this.zoom.tick();
    if (this.player.animating) this.player.animTick++;
  }

  private landing(): void {
    switch (this.state) {
      case 0: // FlyLanding_HidePlayerMapObj
        this.h.hidePlayer(true);
        this.state++;
        return;
      case 1: // FlyLanding_LoadResources
        this.state++;
        return;
      case 2: { // FlyLanding_InitAnimTasks, FlyLanding_InitEnv
        this.player.visible = true;
        const path = fx(128 + 64);
        const env: Bird = {
          stage: 1, state: 0, subState: 0, descendCount: 0, start: [fx(128), fx(111)], scale: 0x2000, rotation: fx(350), angle: fx(45), path, delta: fx(32), scaleDelta: 0x400, playerOffsetY: 0,
          sprite: { x: 0, y: 0, scale: 0x2000, rotation: 350, visible: true },
        };
        env.sprite.x = env.start[0] + cos(45) * deg(path);
        env.sprite.y = env.start[1] + sin(deg(env.angle)) * deg(path);
        this.env = env;
        this.pending.push(() => (this.envActive = true));
        const push = new PushPlayer(this.player);
        this.pending.push(() => (this.push = push));
        this.zoom.set(1, fx(-120), 12);
        this.pending.push(() => (this.zoomActive = true));
        this.player.scale = 0x2000;
        setAnim(this.player, 2);
        this.h.fadeIn();
        this.state++;
        return;
      }
      case 3: // FlyLanding_EndTaskIfAnimationEnded
        if (!this.ended) return;
        // FlyLanding_SetTasksDone: PushPlayer, the zoom and the bird end.
        this.push = null;
        this.zoomActive = false;
        this.env = null;
        this.state++;
        return;
      case 4: // FlyLanding_CleanupResources
        this.player.visible = false;
        this.finished = true;
        this.state++;
        return;
    }
  }

  private envTick(e: Bird): void {
    const p = this.player;
    for (;;) {
      switch (e.state) {
        case 0: { // FlyLanding_SetUpSprites
          e.path = Math.max(0, e.path - e.delta);
          if (e.delta > 0x800) e.delta -= 0x1c00;
          if (e.delta < 0x1000) e.delta = 0x1000;
          const ox = cos(45) * deg(e.path);
          const oy = sin(deg(e.angle)) * deg(e.path);
          if (deg(e.angle) < 90) e.angle += 0x4000;
          e.scale = Math.max(e.scale - e.scaleDelta, 0x1000);
          Object.assign(e.sprite, { x: e.start[0] + ox, y: e.start[1] + oy, scale: e.scale });
          Object.assign(p, { x: e.sprite.x, y: e.sprite.y - fx(18), scale: e.scale });
          if (e.path === 0) [e.subState, e.state] = [0, 1];
          else e.subState++;
          return;
        }
        case 1: // FlyLanding_SetUpEnv (returns 1)
          this.push?.start(2);
          this.zoom.set(2, 0, 12);
          Object.assign(e, { scaleDelta: 0x400, angle: fx(128), path: 0, delta: 0x1800, state: 2 });
          continue;
        case 2: { // FlyLanding_FlyUpLeft
          e.path += e.delta;
          e.delta = Math.min(e.delta + 0x1000, fx(16));
          const ox = cos(deg(e.angle)) * deg(e.path);
          const oy = sin(128) * deg(e.path);
          if (e.angle < fx(160)) e.angle += 0x1000;
          e.rotation += 0x2000;
          e.scale = Math.min(e.scale + e.scaleDelta, 0x1000);
          Object.assign(e.sprite, { x: e.start[0] + ox, y: e.start[1] - oy, scale: e.scale, rotation: deg(e.rotation) });
          if (deg(e.sprite.y) <= -16) e.state = 3;
          return;
        }
        case 3: // FlyLandingAnim_HideBird (returns 1)
          e.sprite.visible = false;
          setAnim(p, 1);
          [e.subState, e.state] = [0, 4];
          continue;
        case 4: // FlyLandingAnim_PlayerHoldUpPokeballAndSetUpBirdSprite
          if (++e.subState < 20) return;
          Object.assign(e, { subState: 0, start: [fx(136), fx(111 - 32)], rotation: 0, scale: FX, scaleDelta: 0x200, angle: fx(315), path: fx(128), delta: 0x2000, state: 5 });
          e.sprite = { x: fx(136), y: fx(79), scale: FX, rotation: 0, visible: true };
          setAnim(p, 6);
          p.animating = true;
          continue;
        case 5: { // FlyLandingAnim_FlyIntoPokeball
          e.path -= e.delta;
          if (e.delta < fx(16)) e.delta += 0x2000;
          if (e.path < 0) e.path = 0;
          const ox = cos(315) * deg(e.path);
          const oy = sin(deg(e.angle)) * deg(e.path);
          if (deg(e.angle) < 180) e.angle -= 0x4000;
          e.scale = Math.max(e.scale - e.scaleDelta, 0x400);
          e.rotation = Math.min(e.rotation + 0x6000, fx(60));
          Object.assign(e.sprite, { x: e.start[0] + ox, y: e.start[1] + oy, scale: e.scale, rotation: deg(e.rotation) });
          if (e.path <= 0) {
            e.sprite.visible = false;
            e.state = 6;
          }
          return;
        }
        case 6: // FlyLandingAnim_HidePlayerMapObjAndSprite
          e.subState++;
          if (e.subState === 8) {
            setAnim(p, 1);
            this.h.hidePlayer(false);
          }
          if (e.subState === 10) p.visible = false;
          if (e.subState > 15 && this.zoom.done) [e.subState, e.state, this.ended] = [0, 7, true];
          return;
        default:
          return;
      }
    }
  }

  view(gender: 'male' | 'female'): FlySceneView {
    return {
      gender,
      band: null,
      wind: [],
      mon: null,
      player: this.player.visible ? playerView(this.player) : null,
      bird: this.env?.sprite.visible ? spriteView(this.env.sprite) : null,
    };
  }
}

export interface FlyTaskHost extends FlyHost {
  /**
   * FieldTask_MapChangeFly's map change: the player walks (off the bike), the map changes as a warp does
   * (FieldMapChange_UpdateGameData), then FieldSystem_SetFlyFlags.
   */
  changeMap(): void;
}

/**
 * Ticks between the cut-in's end and the landing: FieldMoves_FlyTask sees the cut-in done, then FieldTask_MapChangeFly
 * finishes the field map (FieldTransition_FinishMap), changes the map (FieldTask_ChangeMapSub's three steps) and starts
 * the new one (FieldTransition_StartMap) before FieldTask_FadeInFly starts the landing.
 */
const MAP_CHANGE_AT = 3;
const LANDING_AT = 6;

/** FieldMoves_FlyTask and FieldTask_MapChangeFly: the cut-in, the map change, the landing. */
export class FlyTask {
  private readonly cutIn: FlyCutIn;
  private landing: FlyLanding | null = null;
  private gap = 0;
  done = false;

  constructor(private readonly h: FlyTaskHost) {
    this.cutIn = new FlyCutIn(h);
  }

  tick(): void {
    if (this.landing) {
      this.landing.tick();
      if (this.landing.finished) this.done = true;
      return;
    }
    if (!this.cutIn.finished) {
      this.cutIn.tick();
      return;
    }
    this.gap++;
    if (this.gap === MAP_CHANGE_AT) this.h.changeMap();
    if (this.gap === LANDING_AT) {
      this.landing = new FlyLanding(this.h);
      this.landing.tick();
    }
  }

  view(gender: 'male' | 'female', mon: Pick<NonNullable<FlySceneView['mon']>, 'species' | 'form' | 'shiny' | 'female'>): FlySceneView | null {
    if (this.landing) return this.landing.view(gender);
    return this.cutIn.finished ? null : this.cutIn.view(gender, mon);
  }

  /** The camera zoom's distance (world units). */
  cameraDistance(): number {
    return (this.landing ?? this.cutIn).zoom.offset / FX;
  }
}
