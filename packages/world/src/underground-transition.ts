/**
 * The way down to the Underground and back up (decomp src/underground_map_transition.c, one task per part, a step per
 * tick), drawn as 2D sprites over the field (contracts `UndergroundTransitionView`) while the player's map object is
 * hidden:
 * - `enter-start` (UndergroundMapTransition_EnterStartTask, on the surface): the player jumps into the opening hole and
 *   the screen fades to black;
 * - `enter-arrive` (_EnterArriveTask, in the Underground): the screen fades in, the player falls in from above (through
 *   the DS's other screen first) and lands, then stands as the map object again;
 * - `exit-start` (_ExitStartTask): the player spins faster and faster, rises off the screen and it fades to white;
 * - `exit-arrive` (_ExitArriveTask, on the surface): the screen fades in from white, the player jumps out of the hole
 *   spinning to a stop, then the hole closes.
 * Positions are the sprites' in DS px (fractional on the sine arcs; drawn truncated); the falling and rising player is
 * drawn only while on the field's screen (the other screen's part keeps its time).
 */
import type { UndergroundTransitionView } from '@opensinnoh/contracts';

export type UgTransitionPart = 'enter-start' | 'enter-arrive' | 'exit-start' | 'exit-arrive';

export interface UgTransitionHost {
  fade(kind: 'in' | 'out', frames: number, color: 'black' | 'white'): void;
  fadeDone(): boolean;
  playSe(name: string): void;
  /** PlayerAvatar_SetVisible. */
  heroVisible(visible: boolean): void;
}

/** StartScreenFade(…, 6, 1): six steps of one frame. */
const FADE_FRAMES = 6;
/** The sprites' positions (UndergroundMapTransition_Init*Anim): the player's cell corner and the hole's. */
const PLAYER = { x: 112, y: 69 };
const HOLE = { x: 112, y: 96 };
/** HW_LCD_HEIGHT: the other screen spans y 192–384 of the sprite list. */
const LCD = 192;
/** FX_SinIdx's full turn and FX32_ONE (an animation frame). */
const TURN = 0x10000;
const ONE = 0x1000;
/** Sprite animations (enum UGMapTransitionPlayerAnim, HoleAnim). */
const ANIM = { fall: 0, spin: 1, open: 0, close: 1 };

type Sprite = { anim: number; frame: number; x: number; y: number; shown: boolean };

const sin = (index: number) => Math.sin((index / TURN) * 2 * Math.PI);

export class UgTransition {
  done = false;
  private state = 0;
  private timer = 0;
  private player: Sprite | null = null;
  private hole: Sprite | null = null;
  /** The player animation's own counters (DescendAnimContext / AscendAnimContext: index, state, which screen). */
  private index = 0;
  private sub = 0;

  constructor(
    readonly part: UgTransitionPart,
    private readonly gender: 'male' | 'female',
    private readonly h: UgTransitionHost,
  ) {}

  view(): UndergroundTransitionView | null {
    if (this.done) return null;
    const out = (s: Sprite | null) => (s?.shown ? { anim: s.anim, frame: s.frame, x: s.x, y: s.y } : null);
    return { gender: this.gender, player: out(this.player), hole: out(this.hole) };
  }

  /** One tick (the task's step); `done` once it ends. */
  step(): void {
    if (this.done) throw new Error('underground transition: stepped after its end');
    switch (this.part) {
      case 'enter-start':
        return this.enterStart();
      case 'enter-arrive':
        return this.enterArrive();
      case 'exit-start':
        return this.exitStart();
      case 'exit-arrive':
        return this.exitArrive();
    }
  }

  private newSprite(at: { x: number; y: number }, anim: number, frame = 0): Sprite {
    return { anim, frame, x: at.x, y: at.y, shown: true };
  }

  private enterStart(): void {
    switch (this.state) {
      case 0:
        this.h.heroVisible(false);
        this.state++;
        return;
      case 1:
        this.player = this.newSprite(PLAYER, ANIM.fall);
        this.hole = this.newSprite(HOLE, ANIM.open);
        this.state++;
        return;
      case 2: {
        // UndergroundMapTransition_JumpIntoHole: a half sine 16 px high, the fade from the top of it; _OpenHole: 7 frames.
        let jumping = false;
        const p = this.player!;
        if (this.index <= TURN / 2) {
          p.y = PLAYER.y - sin(this.index) * 16;
          this.index += 0x800;
          p.frame++;
          if (this.index === TURN / 2) this.h.fade('out', FADE_FRAMES, 'black');
          jumping = true;
        }
        let opening = false;
        if (this.timer < 7) {
          this.hole!.frame++;
          this.timer++;
          opening = true;
        }
        if (!jumping && !opening) this.state++;
        return;
      }
      case 3:
        if (this.h.fadeDone()) this.state++;
        return;
      case 4:
        this.player = this.hole = null;
        this.state++;
        return;
      default:
        this.done = true;
    }
  }

  private enterArrive(): void {
    switch (this.state) {
      case 0:
        this.h.heroVisible(false);
        this.state++;
        return;
      case 1:
        // From the top of the other screen (y 192) down through it, then from above the field's screen.
        this.player = { ...this.newSprite({ x: PLAYER.x, y: LCD }, ANIM.fall), shown: false };
        this.h.fade('in', FADE_FRAMES, 'black');
        this.h.playSe('SEQ_SE_DP_PYUU');
        this.state++;
        return;
      case 2: {
        // UndergroundMapTransition_Descend: 8 px a frame.
        const p = this.player!;
        let landed = false;
        p.y += 8;
        p.frame++;
        if (this.sub === 0) {
          // Past the other screen's bottom: the next frame draws it above the field's screen.
          if (p.y >= LCD * 2) {
            p.y = -32;
            this.sub = 1;
          }
        } else {
          p.shown = true;
          if (p.y >= PLAYER.y) {
            p.y = PLAYER.y;
            landed = true;
          }
        }
        if (landed && this.h.fadeDone()) {
          this.h.playSe('SEQ_SE_DP_SUTYA');
          this.timer = -255;
          this.state++;
        }
        return;
      }
      case 3:
        this.timer += 16;
        if (this.timer > 0) {
          this.h.heroVisible(true);
          this.state++;
        }
        return;
      case 4:
        this.player = null;
        this.state++;
        return;
      default:
        this.done = true;
    }
  }

  private exitStart(): void {
    switch (this.state) {
      case 0:
        this.h.heroVisible(false);
        this.state++;
        return;
      case 1:
        this.player = this.newSprite(PLAYER, ANIM.spin);
        this.h.playSe('SEQ_SE_DP_PYUU2');
        this.state++;
        return;
      case 2:
        this.timer -= 32;
        if (this.timer < -255) this.state++;
        return;
      case 3:
        if (this.ascend()) this.state++;
        return;
      case 4:
        if (this.h.fadeDone()) this.state++;
        return;
      case 5:
        this.player = null;
        this.state++;
        return;
      default:
        this.done = true;
    }
  }

  /** UndergroundMapTransition_Ascend: the spin speeds up to 2 frames a frame, then the player rises 8 px a frame. */
  private ascend(): boolean {
    const p = this.player!;
    switch (this.sub) {
      case 0:
        this.index += Math.trunc(0.2 * ONE);
        p.frame += this.index / ONE;
        if (this.index >= 2 * ONE) this.sub++;
        return false;
      case 1:
        if (p.y > -32) {
          p.y -= 8;
          p.frame += this.index / ONE;
        } else {
          p.y = LCD * 2;
          p.shown = false;
          this.sub++;
        }
        return false;
      case 2:
        p.y -= 8;
        p.frame += this.index / ONE;
        if (p.y < 300) {
          this.h.fade('out', FADE_FRAMES, 'white');
          this.sub++;
        }
        return false;
      case 3:
        if (p.y > LCD) {
          p.y -= 8;
          p.frame += this.index / ONE;
        } else this.sub++;
        return false;
      default:
        return true;
    }
  }

  private exitArrive(): void {
    switch (this.state) {
      case 0:
        this.h.heroVisible(false);
        // UndergroundMapTransition_InitEmergeFromHoleAnim: hidden, spinning at 2 frames a frame; the hole closing.
        this.player = { ...this.newSprite(PLAYER, ANIM.spin), shown: false };
        this.index = 2 * ONE;
        this.hole = this.newSprite(HOLE, ANIM.close);
        this.state++;
        return;
      case 1:
        this.h.fade('in', FADE_FRAMES, 'white');
        this.state++;
        return;
      case 2:
        if (this.h.fadeDone()) {
          this.h.playSe('SEQ_SE_DP_GYURU');
          this.state++;
        }
        return;
      case 3:
        if (this.emerge()) {
          this.h.heroVisible(true);
          this.timer = 6;
          this.state++;
        }
        return;
      case 4: {
        // _CloseHole: 8 frames; the player's sprite goes 6 frames after the map object is back.
        let closing = false;
        if (this.hole!.frame < 8) {
          this.hole!.frame++;
          closing = true;
        }
        if (this.timer <= 0) {
          if (this.timer === 0) {
            this.player = null;
            this.timer--;
          }
        } else this.timer--;
        if (!closing) this.state++;
        return;
      }
      case 5:
        this.hole = null;
        this.state++;
        return;
      default:
        this.done = true;
    }
  }

  /** UndergroundMapTransition_EmergeFromHole: shown, a half sine 32 px high from the index it has, then the spin slows to a stop. */
  private emerge(): boolean {
    const p = this.player!;
    switch (this.sub) {
      case 0:
        p.shown = true;
        this.sub++;
        return false;
      case 1:
        if (this.index <= TURN / 2) {
          p.y = PLAYER.y - sin(this.index) * 32;
          this.index += 0x1000;
          p.frame++;
        } else this.sub++;
        return false;
      case 2:
        this.index -= Math.trunc(0.4 * ONE);
        if (this.index > 0) p.frame += this.index / ONE;
        if (this.index <= 0) this.sub++;
        return false;
      default:
        return true;
    }
  }
}
