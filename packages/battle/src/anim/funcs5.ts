/**
 * The last native functions (decomp script_funcs_0.c Surf; script_funcs_1.c RolePlay, Sketch; script_funcs_2.c
 * AcidArmor, NightShadeAttacker, NightShadeDefender, Spite, Extrasensory; script_funcs_3.c ScrollCustomBg, MuddyWater,
 * PixelatePokemonSprite): BG2 pictures moved line by line, the waves, the sprite copies' scales, fades and mosaic.
 * Constants and state machines are the decomp's.
 */
import { BgMon, filledLines, LINES, ScrollX, type LineBuffer } from './bg-mon.ts';
import { degToIdx, fxMul, idiv, s16, sinIdx } from './fx.ts';
import { anchoredOffset, dirX, PosLerp, ScaleLerp, Shake, sideOf, task, ValueLerp, type Func } from './tasks.ts';
import type { AnimVm, MonSprite, PokeCopy } from './vm.ts';

/** MON_SPRITE_FRAME_WIDTH / _HEIGHT. */
const FRAME = 80;
/** RGBA_WHITE / COLOR_BLACK as BGR555. */
const WHITE = 0x7fff;
const BLACK = 0;

function copy(vm: AnimVm, id: number, func: string): PokeCopy {
  const c = vm.pokemonSprites[id];
  if (!c) throw new Error(`battle anim: ${func} on sprite copy ${id}, which was not added`);
  return c;
}

/** BattleAnimSystem_IsBattlerSemiInvulnerable: away (Fly, Dig, …) or not on the field; such a battler stays hidden. */
const away = (vm: AnimVm, battler: number) => !vm.deps.battlers[battler]?.visible;

/** BattleAnimUtil_GetBattlerType is ENEMY_SIDE_SLOT_1 or PLAYER_SIDE_SLOT_2: the 3D layer draws it under BG2's picture only when BG2 is raised. */
const raisesBg2 = (vm: AnimVm, battler: number) => [3, 4].includes(vm.typeOf(battler));

/** AlphaFadeContext: the blend's EVA and EVB lerped (a priority 0 SysTask, not an animation task); `done` once it ends. */
function alphaFade(vm: AnimVm, a0: number, a1: number, b0: number, b1: number, steps: number): { done: boolean } {
  const lerp = new PosLerp(a0, a1, b0, b1, steps);
  const state = { done: false };
  vm.tasks.push({
    kind: 'bg',
    step: () => {
      if (!lerp.update()) {
        state.done = true;
        return false;
      }
      vm.objBlend = { a: Math.max(0, lerp.x), b: Math.max(0, lerp.y) };
      return true;
    },
  });
  return state;
}

/** PaletteFadeContext on a sprite copy's palette: `fraction` toward `color` stepping by one every frame (stepFrames 0) to `end`. */
function copyFade(vm: AnimVm, c: PokeCopy, start: number, end: number, color: number): { active: boolean } {
  const state = { active: true };
  let fraction = start;
  const step = start < end ? 1 : -1;
  vm.tasks.push({
    kind: 'bg',
    step: () => {
      c.fade = fraction;
      c.fadeColor = color;
      if (fraction === end) {
        state.active = false;
        return false;
      }
      fraction += step;
      return true;
    },
  });
  return state;
}

/** Clears BG2 (Bg_ClearTilesRange, Bg_ClearTilemap) and puts its priority back below the 3D layer. */
function clearBg2(vm: AnimVm): void {
  vm.bgMon = null;
  vm.bg2.front = false;
}

// -------------------------------------------------------------------------------------------------------------------

/**
 * AcidArmor: the attacker's picture (in BG2) melts: its lines slide down and sideways 80 × 40 px over 24 frames under
 * an 8 px sine scroll, then it fades out against the scene (EVA 31 → 0, EVB 0 → 31 over 16), waits 8 frames in place and
 * fades back before the sprite returns.
 */
const acidArmor: Func = (vm) => {
  const s = vm.sprite(vm.attacker);
  const [cx, cy] = BgMon.corner(vm, vm.attacker);
  s.hide = true;
  const dir = dirX(vm, vm.attacker);
  const start = Math.max(0, cy - 8);
  const end = Math.min(LINES, cy + FRAME + 8);
  let scroll: ScrollX | null = new ScrollX(start, end, degToIdx(5), 8 * 4096 * dir, 80);
  const pos = new PosLerp(0, 80 * dir, 0, 40, 24);
  if (raisesBg2(vm, vm.attacker)) vm.bg2.front = true;
  const update = (): boolean => {
    const buf = filledLines(-cx, -cy);
    const active = pos.update();
    for (let y = start; y <= end; y++) {
      const x = -cx - idiv((start + FRAME / 2 - y) * pos.x, 100);
      const yo = -cy - idiv((end - y) * pos.y, 100);
      buf[(y - 1 + LINES) % LINES] = [x, yo];
    }
    scroll?.update(buf);
    vm.bg2.lines = buf;
    return active;
  };
  let state = 0;
  let delay = 0;
  let fade = { done: false };
  task(
    vm,
    () => {
      switch (state) {
        case 0:
          if (!update()) {
            state++;
            vm.bg2.blended = true;
            vm.objBlend = { a: 31, b: 0 };
            fade = alphaFade(vm, 31, 0, 0, 31, 16);
          }
          return true;
        case 1:
          update();
          if (fade.done) {
            state++;
            // BgScrollContext_Stop: the HBlank DMA stops; the task sets the offsets itself.
            scroll = null;
            delay = 0;
          }
          return true;
        case 2:
          vm.bg2.lines = null;
          if (vm.bgMon) [vm.bgMon.x, vm.bgMon.y] = [-cx, -cy];
          if (++delay > 8) {
            fade = alphaFade(vm, 0, 31, 31, 0, 16);
            state++;
          }
          return true;
        case 3:
          if (fade.done) {
            s.hide = false;
            state++;
          }
          return true;
        default:
          vm.bg2.lines = null;
          vm.bg2.blended = false;
          clearBg2(vm);
          return false;
      }
    },
    true,
  );
};

/**
 * NightShadeAttacker: the attacker's copy (sprite 0) fades in translucent at 140 % (EVA 0 → 16 over 8 frames), holds
 * 32 frames, shrinks to 100 % over 8 and goes.
 */
const nightShadeAttacker: Func = (vm) => {
  const c = copy(vm, 0, 'NightShadeAttacker');
  const scale = new ScaleLerp(14, 10, 14, 10, 10, 8);
  const alpha = new ValueLerp(0, 16, 8, true);
  c.xlu = true;
  vm.objBlend = { a: 0, b: 31 };
  const flip = vm.contest ? -1 : 1;
  c.scaleX = flip * scale.x;
  c.scaleY = scale.y;
  let state = 0;
  let delay = 0;
  task(vm, () => {
    switch (state) {
      case 0: {
        const active = alpha.update();
        vm.objBlend = { a: alpha.value, b: 31 - alpha.value };
        if (!active) {
          state++;
          delay = 0;
        }
        return true;
      }
      case 1:
        if (++delay > 32) state++;
        return true;
      case 2: {
        const active = scale.updateUniform();
        c.scaleX = flip * scale.x;
        c.scaleY = scale.y;
        if (!active) {
          c.visible = false;
          state++;
        }
        return true;
      }
      default:
        return false;
    }
  });
};

/**
 * NightShadeDefender: the defender shakes (4 px, the decomp's direction bug kept: one pixel more toward its side) while
 * its palette darkens to black and back. Hit at its ally in doubles, the ally's copy (sprite 1) stands in for it.
 */
const nightShadeDefender: Func = (vm) => {
  const s = vm.sprite(vm.defender);
  const x0 = s.x;
  const y0 = s.y;
  const shake = new Shake(4, 0, 1, 4);
  shake.x += dirX(vm, vm.defender);
  s.startFade(0, 16, 0, BLACK);
  const c = vm.pokemonSprites[1];
  const atk = vm.typeOf(vm.attacker);
  const def = vm.typeOf(vm.defender);
  const standIn = c && ((atk === 2 && def === 4) || (atk === 5 && def === 3)) ? c : null;
  if (standIn) {
    paletteFade(vm, standIn, 0, 16, BLACK);
    if (!away(vm, vm.defender)) s.hide = true;
  }
  const place = () => {
    s.x = x0 + shake.x;
    s.y = y0 + shake.y;
    if (standIn) [standIn.x, standIn.y] = [x0 + shake.x, y0 + shake.y];
  };
  let state = 0;
  task(vm, () => {
    switch (state) {
      case 0:
        shake.update();
        place();
        if (!s.fade.active) {
          s.startFade(16, 0, 0, BLACK);
          if (standIn) paletteFade(vm, standIn, 16, 0, BLACK);
          state++;
        }
        return true;
      case 1:
        shake.update();
        place();
        if (!s.fade.active) {
          s.x = x0;
          s.y = y0;
          if (standIn) {
            if (!away(vm, vm.defender)) s.hide = false;
            [standIn.x, standIn.y] = [x0, y0];
          }
          state++;
        }
        return true;
      default:
        return false;
    }
  });
};

/** PaletteData_StartFade on a copy's palette with no wait: two steps a frame (SysTask_FadePalette). */
function paletteFade(vm: AnimVm, c: PokeCopy, from: number, to: number, color: number): void {
  let cur = from;
  vm.tasks.push({
    kind: 'bg',
    step: () => {
      c.fade = cur;
      c.fadeColor = color;
      if (cur === to) return false;
      cur = cur < to ? Math.min(to, cur + 2) : Math.max(to, cur - 2);
      return true;
    },
  });
}

/**
 * Spite: the defender's picture in BG2 (loaded by the script just after) fades in over the scene (EVA 0 → 8, EVB
 * 16 → 8 over 24 frames) under a 5 px sine scroll, holds 32 frames, fades out. In singles BG2 is raised over the
 * defender's sprite; in doubles the defender's copy (sprite 0) draws over it where the 3D layer would hide it. The decomp
 * darkens BG2's palette slot first (PaletteData_BlendMulti), which the picture's palette load then replaces: not done.
 */
const spite: Func = (vm) => {
  vm.bg2.blended = true;
  vm.objBlend = { a: 0, b: 16 };
  let fade = alphaFade(vm, 0, 8, 16, 8, 24);
  const s = vm.sprite(vm.defender);
  const [dx, dy] = BgMon.corner(vm, vm.defender);
  const c = copy(vm, 0, 'Spite');
  const type = vm.typeOf(vm.defender);
  if (type === 5 || type === 2) c.visible = true;
  else {
    vm.bg2.front = true;
    c.visible = false;
  }
  let scroll: ScrollX | null = new ScrollX(dy, dy + FRAME, degToIdx(5), 5 * 4096, 100);
  // The scroll is its own SysTask (priority 0), from now until the fade out ends.
  vm.tasks.push({
    kind: 'bg',
    step: () => {
      if (!scroll) {
        vm.bg2.lines = null;
        return false;
      }
      const buf = filledLines(-dx, -dy);
      scroll.update(buf);
      vm.bg2.lines = buf;
      return true;
    },
  });
  let sub = 0;
  let delay = 0;
  const updateFade = (): boolean => {
    switch (sub) {
      case 0:
        if (fade.done) {
          sub++;
          delay = 32;
        }
        return false;
      case 1:
        if (--delay < 0) {
          sub++;
          fade = alphaFade(vm, 8, 0, 8, 16, 24);
        }
        return false;
      case 2:
        if (fade.done) {
          sub++;
          scroll = null;
        }
        return false;
      default:
        return true;
    }
  };
  let state = 0;
  task(vm, () => {
    switch (state) {
      case 0:
        updateFade();
        if (c.visible && !away(vm, vm.defender)) s.hide = true;
        state++;
        return true;
      case 1:
        if (updateFade()) state++;
        return true;
      default:
        if (!away(vm, vm.defender)) s.hide = false;
        vm.bg2.blended = false;
        clearBg2(vm);
        return false;
    }
  });
};

/** sExtrasensory distortions: base angle, amplitude step, amplitude (fx32), frames. */
const EXTRASENSORY = [
  [degToIdx(180), 5, 16 * 4096, 16],
  [degToIdx(180), -5, -16 * 4096, 16],
  [degToIdx(180), 10, 20 * 4096, 16],
] as const;

/**
 * Extrasensory: the defender's picture in BG2 bends three times (16 frames each): a half sine across its lines plus a
 * shear about its centre, jittering a pixel each frame on alternate pairs of lines.
 */
const extrasensory: Func = (vm) => {
  const s = vm.sprite(vm.defender);
  const centerY = s.y + s.height;
  const [cx, cy] = BgMon.corner(vm, vm.defender);
  if (!away(vm, vm.defender)) s.hide = true;
  const buf: LineBuffer = filledLines(-cx, -cy);
  if (raisesBg2(vm, vm.defender)) vm.bg2.front = true;
  let dir = 1;
  let count = 0;
  let [angle, ampStep, amplitude, delay] = EXTRASENSORY[0] as readonly number[] as [number, number, number, number];
  const inc = idiv(degToIdx(180), FRAME);
  const update = () => {
    const start = Math.max(0, cy - 8);
    const end = Math.min(LINES, cy + FRAME + 8);
    dir = -dir;
    for (let y = start; y < end; y++) {
      const amp = y & 2 ? amplitude + 4096 * dir : amplitude - 4096 * dir;
      const a = (angle + inc * (y - start)) & 0xffff;
      const x = s16((fxMul(sinIdx(a), amp) >> 12) + idiv((y - centerY) * ampStep, 10));
      buf[(y - 1 + LINES) % LINES] = [-cx + x, -cy];
    }
    vm.bg2.lines = buf;
  };
  let state = 0;
  task(vm, () => {
    switch (state) {
      case 0:
        [angle, ampStep, amplitude, delay] = EXTRASENSORY[count] as readonly number[] as [number, number, number, number];
        update();
        state++;
        return true;
      case 1:
        delay--;
        update();
        if (delay < 0) state = ++count < EXTRASENSORY.length ? 0 : 2;
        return true;
      default:
        if (!away(vm, vm.defender)) s.hide = false;
        vm.bg2.lines = null;
        clearBg2(vm);
        return false;
    }
  });
};

/**
 * Sketch: the defender's sprite goes translucent (alpha 8) and is drawn 2-px line by line from its bottom, each line
 * swept across from alternate sides, while window 0 uncovers its picture in BG2 from the bottom up.
 */
const sketch: Func = (vm) => {
  const s: MonSprite = vm.sprite(vm.defender);
  if (raisesBg2(vm, vm.defender)) vm.bg2.front = true;
  const [left, top] = BgMon.corner(vm, vm.defender);
  let bottom = top + FRAME;
  let y2 = bottom;
  const alpha = s.alpha;
  s.alpha = 8;
  let width = 0;
  let height = 0;
  let origin = 0;
  vm.bg2.clip = { x0: left, y0: bottom, x1: left + FRAME, y1: y2 };
  let state = 0;
  task(vm, () => {
    switch (state) {
      case 0:
        width += FRAME - 1;
        if (width >= FRAME) {
          state++;
          origin ^= 1;
          width = 0;
        } else s.partial = { x: origin === 0 ? 0 : FRAME - width, y: FRAME - (height + 2) * 2, w: width, h: 2 };
        return true;
      case 1:
      case 2:
        bottom--;
        y2++;
        vm.bg2.clip = { x0: left, y0: bottom, x1: left + FRAME, y1: y2 };
        if (state === 1) state++;
        else {
          height++;
          state = height > FRAME / 2 - 2 ? 3 : 0;
        }
        return true;
      case 3:
        s.partial = null;
        state++;
        return true;
      default:
        vm.bg2.clip = null;
        s.alpha = alpha;
        return false;
    }
  });
};

/**
 * PixelatePokemonSprite (Transform): a copy drawn through the OBJ mosaic, its size stepping each frame from the start
 * to 15 (step > 0) or 0 (step < 0).
 */
const pixelatePokemonSprite: Func = (vm) => {
  const [id, step, start] = vm.vars.map(s16) as [number, number, number];
  const c = copy(vm, id, 'PixelatePokemonSprite');
  const target = step < 0 ? 0 : 15;
  let size = start;
  c.visible = true;
  c.mosaic = true;
  task(
    vm,
    () => {
      // A copy the script removed takes its mosaic with it.
      if (vm.pokemonSprites[id] !== c || size === target) return false;
      if (step < 0) size = size + step > 0 ? size + step : target;
      else size = size + step < 15 ? size + step : target;
      vm.objMosaic = size;
      return true;
    },
    true,
  );
};

/**
 * RolePlay: the attacker's copy now showing the defender's picture (sprite 0) stands 32 px toward the attacker's side of
 * its place at the picture's own height; it and the defender's copy (sprite 2) flash white, then sprite 0 flattens out
 * (height −0.2, width +0.2 a frame) and goes, and the defender's copy's white fades back.
 */
const rolePlay: Func = (vm) => {
  const c0 = copy(vm, 0, 'RolePlay');
  const c1 = copy(vm, 1, 'RolePlay');
  const c2 = copy(vm, 2, 'RolePlay');
  const step = Math.fround(0.2);
  let scaleX = 1;
  let scaleY = 1;
  c0.x = c1.x - 32 * dirX(vm, vm.attacker);
  // attackerDefaultPos.y + the defender's height in the attacker's face: the view adds the picture's height.
  c0.y = vm.sprite(vm.attacker).baseY;
  c0.scaleX = 256;
  c0.scaleY = 256;
  copyFade(vm, c0, 0, 15, WHITE);
  let defenderFade = copyFade(vm, c2, 0, 15, WHITE);
  c0.visible = true;
  let spriteAlpha = 0;
  let bgAlpha = 15;
  vm.objBlend = { a: spriteAlpha, b: bgAlpha };
  let blendStep = 0;
  let state = 0;
  task(
    vm,
    () => {
      switch (state) {
        case 0:
          if (blendStep > 14) {
            scaleY = Math.fround(scaleY - step);
            scaleX = Math.fround(scaleX + step);
            if (scaleY <= 0.2) {
              state++;
              c0.visible = false;
            } else {
              c0.scaleX = Math.round(scaleX * 256);
              c0.scaleY = Math.round(scaleY * 256);
            }
          } else {
            vm.objBlend = { a: ++spriteAlpha, b: --bgAlpha };
            blendStep++;
          }
          return true;
        case 1:
          if (!defenderFade.active) {
            defenderFade = copyFade(vm, c2, 15, 0, WHITE);
            state++;
          }
          return true;
        default:
          return defenderFade.active;
      }
    },
    true,
  );
};

/**
 * Surf (and Muddy Water: var 0 is 1, the same numbers): the wave sprite (sprite 0, or 1 when the enemy surfs) in front
 * of the attacker's side squashes, rears up (60 → 150 % wide, 5 → 150 % tall over 12 frames) fading in (EVA 0 → 31,
 * EVB 31 → 4 a step a frame), holds 4 frames and sinks back (to 10 % tall) fading out, its foot on the ground.
 */
const surf: Func = (vm) => {
  const sprites = [vm.objects.get(0), vm.objects.get(1)];
  let alpha = 0;
  let bg = 31;
  vm.objBlend = { a: 26, b: 5 };
  const enemy = !vm.contest && sideOf(vm.attacker) === 'enemy';
  const current = sprites[enemy ? 1 : 0]!;
  sprites[enemy ? 0 : 1]!.visible = false;
  current.setAnimation(enemy ? 1 : 0);
  const [x, y] = vm.contest ? [255 - 76, 120] : enemy ? [144, 64] : [76, 120];
  const dir = vm.contest ? -1 : 1;
  const apply = (lerp: ScaleLerp) => {
    current.scaleX = lerp.x / 256;
    current.scaleY = lerp.y / 256;
    current.x = x;
    current.y = y + anchoredOffset(16, lerp.cy);
    current.alpha = Math.min(16, alpha) / 16;
  };
  let scale = new ScaleLerp(100 * dir, 100 * dir, 100, 5, 100, 1);
  scale.update();
  apply(scale);
  let state = 0;
  let hold = 0;
  task(vm, () => {
    switch (state) {
      case 0:
        scale = new ScaleLerp(100 * dir, 60 * dir, 5, 150, 100, 12);
        state++;
        return true;
      case 1:
        if (!scale.update()) {
          scale = new ScaleLerp(60 * dir, 150 * dir, 150, 10, 100, 12);
          state++;
        } else {
          if (alpha < 31) alpha++;
          if (bg > 4) bg--;
          vm.objBlend = { a: alpha, b: bg };
          apply(scale);
        }
        return true;
      case 2:
        if (++hold >= 4) state++;
        return true;
      case 3:
        if (!scale.update()) state++;
        else {
          if (alpha > 0) alpha--;
          if (bg < 31) bg++;
          vm.objBlend = { a: alpha, b: bg };
          apply(scale);
        }
        return true;
      default:
        vm.objects.remove(0);
        vm.objects.remove(1);
        return false;
    }
  });
};

/** The two waves' numbers (ScrollCustomBg, MuddyWater): EVA's target, EVB's start and end, and the fade-out's EVB end. */
interface Wave {
  alphaTarget(vars: number[]): number;
  otherStart: number;
  otherEnd: number;
  fadeIn(bg: number, other: number, target: number): [number, number, boolean];
  fadeOut(bg: number, other: number): [number, number, boolean];
}

const SCROLL_CUSTOM_BG: Wave = {
  alphaTarget: (vars) => vars[6]!,
  otherStart: 31,
  otherEnd: 7,
  fadeIn: (bg, other, target) => {
    let done = 0;
    if (bg < target - 2) bg += 2;
    else done++;
    if (other > 7 + 2) other -= 2;
    else done++;
    return done === 2 ? [target, 7, true] : [bg, other, false];
  },
  fadeOut: (bg, other) => {
    let done = 0;
    if (bg > 2) bg -= 2;
    else done++;
    if (other < 31 - 2) other += 2;
    else done++;
    return done === 2 ? [0, 31, true] : [bg, other, false];
  },
};

const MUDDY_WATER: Wave = {
  alphaTarget: () => 16,
  otherStart: 16,
  otherEnd: 4,
  fadeIn: (bg, other) => {
    let done = 0;
    if (bg < 16) bg += 2;
    else done++;
    if (other > 4) other -= 2;
    else done++;
    return done === 2 ? [16, 4, true] : [bg, other, false];
  },
  fadeOut: (bg, other) => {
    let done = 0;
    if (bg > 2) bg -= 2;
    else done++;
    if (other < 16) other += 2;
    else done++;
    return done === 2 ? [0, 31, true] : [bg, other, false];
  },
};

/**
 * ScrollCustomBg and MuddyWater: a switched background loaded into BG2 (the player's, the enemy's or the contest's
 * screen), blended in over the scene while it scrolls by its steps (both slowing by one every `slowDown` frames),
 * until it has scrolled 512 px down or up to −412, then blended out.
 */
function wave(w: Wave): Func {
  return (vm) => {
    const vars = vm.vars.map(s16);
    let [, x, y, stepX, stepY] = vars as [number, number, number, number, number];
    const reverse = vars[5] !== 0;
    const slowDown = vars[7]!;
    const target = w.alphaTarget(vars);
    const enemy = sideOf(vm.attacker) === 'enemy';
    // (128 / 3) * 2: the start's offset toward the attacker's side.
    if (reverse && enemy) {
      x = -x;
      y = -y - 85;
      stepX = -stepX;
      stepY = -stepY;
    } else y += 85;
    if (vm.contest) stepX = -stepX;
    let bg = 0;
    let other = w.otherStart;
    let finished = false;
    let timer = 0;
    const cell = vm.contest ? 2 : enemy ? 1 : 0;
    const layer = { bg: vars[0]!, cell, x, y, alpha: 0 };
    // BG2 stays off until the task's first frame.
    vm.bg.custom = null;
    let state = 0;
    task(vm, () => {
      if (state === 0) {
        vm.bg.custom = layer;
        state = 1;
      }
      switch (state) {
        case 1: {
          let done: boolean;
          [bg, other, done] = w.fadeIn(bg, other, target);
          if (done) state++;
          break;
        }
        case 2:
          if (finished) state++;
          break;
        case 3: {
          let done: boolean;
          [bg, other, done] = w.fadeOut(bg, other);
          if (done) state++;
          break;
        }
        default:
          vm.bg.custom = null;
          return false;
      }
      vm.objBlend = { a: bg, b: other };
      layer.alpha = bg;
      if ((stepY > 0 && y >= 512) || (stepY < 0 && y <= -412)) finished = true;
      x += stepX;
      y += stepY;
      if (slowDown < timer) {
        stepY = stepY < 0 ? stepY + 1 : 0;
        stepX = stepX < 0 ? stepX + 1 : 0;
        timer = 0;
      } else timer++;
      layer.x = s16(x);
      layer.y = s16(y);
      return true;
    });
  };
}

export const LAST_FUNCS: Record<string, Func> = {
  AcidArmor: acidArmor,
  NightShadeAttacker: nightShadeAttacker,
  NightShadeDefender: nightShadeDefender,
  Spite: spite,
  Extrasensory: extrasensory,
  Sketch: sketch,
  PixelatePokemonSprite: pixelatePokemonSprite,
  RolePlay: rolePlay,
  Surf: surf,
  ScrollCustomBg: wave(SCROLL_CUSTOM_BG),
  MuddyWater: wave(MUDDY_WATER),
};
