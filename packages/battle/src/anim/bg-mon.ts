/**
 * BG2 holding a battler's picture (decomp battle_anim_system.c LoadPokemonSpriteIntoBg, RemovePokemonSpriteFromBg;
 * battle_anim_helpers.c BgScrollContext, CustomBgScrollContext; screen_scroll_manager.c): the 80×80 picture at the
 * top-left of the 512×512 BG2 layer, placed over its battler by the layer's offsets. The native functions move it
 * line by line through an HBlank buffer, blend it (G2_SetBlendAlpha with BG2 as the first target), put it in front
 * of the 3D layer or show it through window 0.
 */
import type { AnimBgMonView } from '@opensinnoh/contracts';
import { fxMul, sinIdx } from './fx.ts';
import type { AnimVm } from './vm.ts';

/** HW_LCD_HEIGHT: the HBlank buffers' lines. */
export const LINES = 192;
/** SCREEN_SCROLL_MANAGER_SCALING_FACTOR and _MAX_SCROLL. */
const SCROLL_SCALE = 100;
const MAX_SCROLL = LINES * SCROLL_SCALE;

/**
 * The layer's offsets for each screen line, written by HBlank DMA: entry i reaches line i + 1 (the DMA runs in the
 * HBlank before the line), entry 191 line 0.
 */
export type LineBuffer = [number, number][];

/** A buffer with every line at one offset (MI_CpuFill32 of the initial value). */
export const filledLines = (x: number, y: number): LineBuffer => Array.from({ length: LINES }, (): [number, number] => [x, y]);

/** ScreenScrollManager_ScrollX over BG2: a sine table added across lines start–end of a buffer each frame. */
export class ScrollX {
  private readonly table: number[];
  private pos = 0;

  constructor(
    private readonly start: number,
    private readonly end: number,
    angleIncrement: number,
    amplitude: number,
    private readonly speed: number,
  ) {
    let angle = 0;
    this.table = Array.from({ length: LINES }, () => {
      const v = fxMul(sinIdx(angle), amplitude) >> 12;
      angle = (angle + angleIncrement) & 0xffff;
      return v;
    });
  }

  /** ScreenScrollManager_UpdateScrollX: adds the table to lines start–end of `buffer`, then steps the scroll. */
  update(buffer: LineBuffer): void {
    let at = Math.trunc(this.pos / SCROLL_SCALE) & 0xff;
    for (let i = this.start; i <= this.end && i < LINES; i++) {
      const e = buffer[i]!;
      buffer[i] = [e[0] + this.table[at]!, e[1]];
      at = (at + 1) % LINES;
    }
    this.pos += this.speed;
    if (this.pos >= MAX_SCROLL) this.pos %= MAX_SCROLL;
    else if (this.pos < 0) this.pos += MAX_SCROLL;
  }
}

/**
 * The BG2 state the functions set around a picture (it outlives the picture: Spite sets it up before the script loads
 * the picture): the HBlank buffer the screen shows, the blend, the priority and window 0.
 */
export class Bg2State {
  /** The HBlank buffer the screen shows this frame, or null (the layer's own offset on every line). */
  lines: LineBuffer | null = null;
  /** BG2 is G2_SetBlendAlpha's first target: drawn at the OBJ blend's EVA (`AnimVm.objBlend.a`). */
  blended = false;
  /** Its priority above the 3D layer's (Bg_SetPriority). */
  front = false;
  /** Window 0 (GX_SetVisibleWnd with BG2 inside only), or null. */
  clip: { x0: number; y0: number; x1: number; y1: number } | null = null;
}

export class BgMon {
  /** The layer's offsets (BG2HOFS/VOFS). */
  x: number;
  y: number;
  /** The battler's picture when it was loaded (its swapped one after a StartBattlerSlideIn). */
  private readonly picture: { battler: number; back: boolean } | null;

  constructor(
    private readonly vm: AnimVm,
    readonly battler: number,
    /** BgTrackingTask: the layer follows the battler's sprite every frame. */
    private readonly tracking: boolean,
  ) {
    this.picture = vm.sprite(battler).picture;
    [this.x, this.y] = BgMon.offsetFor(vm, battler);
  }

  /** The battler's sprite's top-left corner on the screen (its centre less 40, 40: the picture's place). */
  static corner(vm: AnimVm, battler: number): [number, number] {
    const s = vm.sprite(battler);
    return [s.x - 40, s.y + s.height - 40];
  }

  /** The offsets that put the picture over the battler's sprite. */
  static offsetFor(vm: AnimVm, battler: number): [number, number] {
    const [x, y] = BgMon.corner(vm, battler);
    return [-x, -y];
  }

  /** BattleAnimSystem_BgTrackingTaskFunc (priority 0x1001, after the animation tasks). */
  track(): void {
    if (this.tracking) [this.x, this.y] = BgMon.offsetFor(this.vm, this.battler);
  }

  view(): AnimBgMonView {
    const { lines, blended, front, clip } = this.vm.bg2;
    return {
      picture: this.vm.picture(this.battler, this.picture),
      x: this.x,
      y: this.y,
      // Line L shows entry L − 1.
      lines: lines ? Array.from({ length: LINES }, (_, l): [number, number] => [...lines[(l + LINES - 1) % LINES]!]) : null,
      alpha: blended ? Math.min(16, Math.max(0, this.vm.objBlend.a)) / 16 : 1,
      fade: null,
      front,
      ...(clip ? { window: { ...clip } } : {}),
    };
  }
}
