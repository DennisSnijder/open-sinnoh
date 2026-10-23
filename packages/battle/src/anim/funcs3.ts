/**
 * Native functions on battler sprites and their copies (decomp script_funcs_0–3.c): pushes and throws
 * (Drill Peck, Vital Throw, Megahorn, Shadow Punch), scaling and squashing (Confusion, Minimize,
 * ScalePokemonSprite, ShakeAndScaleAttacker), the ground shake of Magnitude and the sprite copy
 * timers. Constants are the decomp's.
 */
import { degToIdx } from './fx.ts';
import { anchoredOffset, dirX, ovalRevolution, PosLerp, ScaleLerp, Shake, task, ValueLerp, type Func } from './tasks.ts';
import type { AnimVm, MonSprite, PokeCopy } from './vm.ts';

const BASE = 100;
const OVAL_RY = -8;
/** BATTLER_ROLE_*_PARTNER: no one in singles. */
const PARTNER_ROLES = new Set([2, 3]);

function copy(vm: AnimVm, id: number, func: string): PokeCopy {
  const c = vm.pokemonSprites[id];
  if (!c) throw new Error(`battle anim: ${func} on sprite copy ${id}, which was not added`);
  return c;
}

/** BattleAnimUtil_SetSpriteBgBlending: the OBJ blend for translucent copies (−1 keeps the default). */
function blend(vm: AnimVm, a: number, b: number): void {
  vm.objBlend = { a: a === -1 ? 8 : a, b: b === -1 ? 8 : b };
}

/** A copy's scale (ScaleLerp units, 0x100 = 100 %) with its feet kept at `baseY`. */
function scaleCopy(c: PokeCopy, l: ScaleLerp, baseY: number, height: number): void {
  c.scaleX = l.x;
  c.scaleY = l.y;
  c.y = baseY + anchoredOffset(height, l.cy);
}

/** A battler's x/y for a lerp; the lerp's start is applied relative to `x`, `y` when `rel`. */
function place(s: MonSprite | PokeCopy, l: PosLerp, x = 0, y = 0): void {
  s.x = x + l.x;
  s.y = y + l.y;
}

export const SPRITE_FUNCS: Record<string, Func> = {
  /** Shows a sprite copy for `maxFrames` frames, then hides it (Dark Void's sinking modes are not ported). */
  SetPokemonSpritePriority: (vm) => {
    const [id, maxFrames, , , role, mode] = vm.vars as number[];
    const c = copy(vm, id!, 'SetPokemonSpritePriority');
    if (PARTNER_ROLES.has(role!)) {
      c.visible = false;
      return;
    }
    if (mode !== 0) vm.deps.log.stub('anim:SetPokemonSpritePriority:mode', 'Dark Void sprite sinking not implemented: the copy stays put');
    let frames = 0;
    task(vm, () => {
      if (++frames >= maxFrames!) {
        c.visible = false;
        return false;
      }
      return true;
    });
  },

  /** Confusion: a translucent copy of the defender swells (120 %, 150 % tall) and back while both shake. */
  Confusion: (vm) => {
    const def = vm.sprite(vm.defender);
    const c = copy(vm, 0, 'Confusion');
    const dx = def.x;
    const dy = def.y;
    const cy = c.y;
    c.xlu = true;
    blend(vm, 28, 15);
    const shake = new Shake(2, 0, 1, 6);
    let lerp = new ScaleLerp(10, 12, 10, 15, 10, 7);
    let jitter = 1;
    let state = 0;
    const apply = () => {
      def.x = dx + shake.x;
      def.y = dy + shake.y;
      c.x = dx + shake.x;
      c.y = cy + shake.y;
      c.scaleX = lerp.x + Math.trunc(jitter * 0.1 * 256);
      c.scaleY = lerp.y;
      jitter = -jitter;
    };
    task(vm, () => {
      if (state === 2) return false;
      shake.update();
      const active = lerp.update();
      apply();
      if (!active) {
        if (state === 0) lerp = new ScaleLerp(12, 10, 15, 10, 10, 4);
        else {
          def.x = dx;
          def.y = dy;
        }
        state++;
      }
      return true;
    });
  },

  /** ScalePokemonSprite: a translucent copy scales from start to end and back, `cycles` times. */
  ScalePokemonSprite: (vm) => {
    const [role, alpha, start, end, ref, cycles, frames, id] = vm.vars as number[];
    const side = role === 0 ? vm.attacker : vm.defender;
    const s = vm.sprite(side);
    const c = copy(vm, id!, 'ScalePokemonSprite');
    const baseY = c.y;
    c.xlu = true;
    blend(vm, alpha!, 16 - alpha!);
    let left = cycles!;
    let state = 0;
    let lerp = new ScaleLerp(start!, end!, start!, end!, ref!, frames! >> 16);
    task(vm, () => {
      switch (state) {
        case 0:
          lerp = new ScaleLerp(start!, end!, start!, end!, ref!, frames! >> 16);
          c.scaleX = lerp.x;
          c.scaleY = lerp.y;
          state++;
          return true;
        case 2:
          lerp = new ScaleLerp(end!, start!, end!, start!, ref!, frames! & 0xffff);
          state++;
          return true;
        case 1:
        case 3: {
          const active = lerp.updateUniform();
          c.scaleX = lerp.x;
          c.scaleY = lerp.y;
          if (active) c.y = baseY + anchoredOffset(s.height, lerp.cy);
          else if (state === 1) state++;
          else state = --left <= 0 ? 4 : 0;
          return true;
        }
        default:
          return false;
      }
    });
  },

  /** Minimize: three translucent copies shrink to 5 %, one after another, three times; then grow back. */
  Minimize: (vm) => {
    const s = vm.sprite(vm.attacker);
    const hidden = s.hide;
    const delays = [2, 7, 13, 18];
    blend(vm, 12, 6);
    const sprites = [0, 1, 2].map((i) => {
      const c = copy(vm, i, 'Minimize');
      c.xlu = true;
      return { c, state: 0, frames: 0, lerp: null as ScaleLerp | null, baseY: c.y };
    });
    let state = 0;
    let cycles = 0;
    task(vm, () => {
      switch (state) {
        case 0:
          // MON_SPRITE_PARTIAL_DRAW with an empty rectangle: the battler itself is not drawn.
          s.hide = true;
          state++;
          return true;
        case 1: {
          let done = 0;
          for (const [i, sp] of sprites.entries()) {
            if (sp.state === 0) {
              if (++sp.frames >= delays[i]!) {
                sp.lerp = new ScaleLerp(BASE, 5, BASE, 5, BASE, 5);
                sp.state++;
              }
            } else if (sp.state === 1) {
              if (!sp.lerp!.update()) sp.state++;
              else scaleCopy(sp.c, sp.lerp!, sp.baseY, s.height);
            } else done++;
          }
          if (done >= sprites.length) {
            if (++cycles < 3)
              for (const sp of sprites) {
                sp.c.y = sp.baseY;
                sp.c.scaleX = 256;
                sp.c.scaleY = 256;
                sp.state = 0;
                sp.frames = 0;
              }
            else state++;
          }
          return true;
        }
        case 2:
          for (const sp of sprites) {
            sp.c.xlu = false;
            sp.lerp = new ScaleLerp(5, BASE, 5, BASE, BASE, 5);
          }
          state++;
          return true;
        case 3: {
          let done = 0;
          for (const sp of sprites) {
            if (!sp.lerp!.update()) done++;
            else scaleCopy(sp.c, sp.lerp!, sp.baseY, s.height);
          }
          if (done >= sprites.length) state++;
          return true;
        }
        default:
          s.hide = hidden;
          return false;
      }
    });
  },

  /** Nightmare: a copy of a battler drifts 20 px back and down as it fades out. */
  Nightmare: (vm) => {
    const side = vm.vars[0] ? vm.attacker : vm.defender;
    const c = copy(vm, 0, 'Nightmare');
    const dir = dirX(vm, side);
    c.xlu = true;
    const pos = new PosLerp(c.x, c.x - 20 * dir, c.y, c.y + 20 * dir, 20);
    alphaFade(vm, 31, 0, 0, 31, 15);
    task(vm, () => {
      if (!pos.update()) return false;
      place(c, pos);
      return true;
    });
  },

  /** DrillPeck: the attacker draws back, tilts forward 20°, lunges, holds, and straightens. */
  DrillPeck: (vm) => {
    const s = vm.sprite(vm.attacker);
    const ax = s.x;
    const ay = s.y;
    const dir = dirX(vm, vm.attacker);
    s.pivotX = 40 * dirX(vm, vm.defender);
    s.pivotY = 40;
    let pos = new PosLerp(0, -32 * dir, 0, 0, 3);
    let angle = new ValueLerp(0, degToIdx(20), 8);
    if (dir < 0) angle.negate();
    let state = 0;
    let delay = 0;
    task(vm, () => {
      switch (state) {
        case 0:
          if (pos.update()) place(s, pos, ax, ay);
          else {
            pos = new PosLerp(pos.x, 0, 0, 0, 2);
            state++;
          }
          return true;
        case 1:
          if (angle.update()) s.rotation = angle.value & 0xffff;
          else {
            angle = new ValueLerp(angle.value, 0, 4);
            delay = 2;
            state++;
          }
          return true;
        case 2:
        case 4:
          if (--delay < 0) state++;
          return true;
        case 3:
          if (pos.update()) place(s, pos, ax, ay);
          else {
            delay = 32;
            state++;
          }
          return true;
        case 5:
          if (angle.update()) s.rotation = angle.value & 0xffff;
          else state++;
          return true;
        default:
          s.x = ax;
          s.y = ay;
          s.rotation = 0;
          return false;
      }
    });
  },

  /** Magnitude: everything shakes sideways, harder for a higher magnitude. */
  Magnitude: (vm) => {
    const power = vm.deps.power ?? 0;
    const extent = ({ 150: 6, 110: 5, 90: 4, 70: 3, 50: 2, 30: 1 } as Record<number, number>)[power] ?? 0;
    const sprites = vm.sprites.map((s) => ({ s, x: s.x }));
    let shake: Shake | null = null;
    task(vm, () => {
      if (!shake) {
        shake = new Shake(2 + extent, extent, 0, 10);
        return true;
      }
      if (!shake.update()) return false;
      for (const { s, x } of sprites) s.x = x + shake.x;
      vm.bg.offset = { x: shake.x, y: shake.y };
      return true;
    });
  },

  /** VitalThrow: the attacker circles slowly, then both battlers are knocked 32 px aside and come back. */
  VitalThrow: (vm) => {
    const atk = vm.sprite(vm.attacker);
    const def = vm.sprite(vm.defender);
    const dir = dirX(vm, vm.attacker);
    const ax = atk.x;
    const ay = atk.y;
    const dx = def.x;
    const rev = ovalRevolution(1, 64);
    rev.rx *= dir;
    let pos = new PosLerp(0, 0, 0, 0, 0);
    let state = 0;
    task(vm, () => {
      switch (state) {
        case 0:
          if (rev.update()) {
            atk.x = ax + rev.x;
            atk.y = ay - OVAL_RY + rev.y;
          } else {
            atk.x = ax;
            atk.y = ay;
            pos = new PosLerp(ax, ax + 32 * dir, 0, 0, 2);
            pos.update();
            atk.x = pos.x;
            state++;
          }
          return true;
        case 1:
          if (pos.update()) atk.x = pos.x;
          else {
            pos = new PosLerp(dx, dx + 32 * dir, 0, 0, 2);
            state++;
          }
          return true;
        case 2:
          if (pos.update()) def.x = pos.x;
          else {
            pos = new PosLerp(atk.x, ax, 0, 0, 8);
            state++;
          }
          return true;
        case 3:
          if (pos.update()) atk.x = pos.x;
          else {
            atk.x = ax;
            pos = new PosLerp(def.x, dx, 0, 0, 8);
            state++;
          }
          return true;
        case 4:
          if (pos.update()) def.x = pos.x;
          else {
            def.x = dx;
            state++;
          }
          return true;
        default:
          return false;
      }
    });
  },

  /** ShakeAndScaleAttacker: the attacker shakes while it scales to one size, holds, then scales to another and snaps back. */
  ShakeAndScaleAttacker: (vm) => {
    const [scale1, scale2, frames1, frames2, hold] = vm.vars as number[];
    const s = vm.sprite(vm.attacker);
    const y = s.y;
    let lerp = new ScaleLerp(BASE, scale1!, BASE, scale1!, BASE, frames1!);
    const shake = new Shake(2, 0, 0, 10);
    let state = 0;
    let timer = 0;
    const apply = () => {
      s.scaleX = lerp.x;
      s.scaleY = lerp.y;
      s.y = y + anchoredOffset(s.height, lerp.cy);
    };
    task(vm, () => {
      switch (state) {
        case 0:
          if (lerp.updateUniform()) {
            shake.update();
            apply();
            s.x += shake.x;
          } else state++;
          return true;
        case 1:
          if (++timer > hold!) {
            lerp = new ScaleLerp(scale1!, scale2!, scale1!, scale2!, BASE, frames2!);
            state++;
          }
          return true;
        case 2:
        case 3:
          if (lerp.updateUniform()) apply();
          else if (state === 2) state++;
          else {
            s.scaleX = 256;
            s.scaleY = 256;
            s.y = y;
            state++;
          }
          return true;
        default:
          return false;
      }
    });
  },

  /** Superpower: the backdrop is shown only inside an enlarged silhouette for a frame (a window effect; nothing visible to port). */
  Superpower: (vm) => task(vm, () => false),

  /** ShadowPunch: the attacker darts 48 px right and back, two darkened translucent afterimages trailing. */
  ShadowPunch: (vm) => {
    const s = vm.sprite(vm.attacker);
    const x = s.x;
    const y = s.y;
    const images = [copy(vm, 0, 'ShadowPunch'), copy(vm, 1, 'ShadowPunch')];
    const cy = images[0]!.y;
    blend(vm, 8, 8);
    for (const c of images) {
      c.xlu = true;
      c.fade = 4;
      c.fadeColor = 0;
    }
    let iteration = 0;
    let state = 0;
    let lerps: PosLerp[] = [];
    task(vm, () => {
      if (state === 0) {
        const [from, to, frames] = iteration === 0 ? [x, x + 48, [3, 6, 8]] : [x + 48, x, [3, 6, 9]];
        lerps = [new PosLerp(from, to, y, y, frames[0]!), new PosLerp(from, to, cy, cy, frames[1]!), new PosLerp(from, to, cy, cy, frames[2]!)];
        iteration++;
        state = 1;
        return true;
      }
      if (state === 2) return false;
      const targets: (MonSprite | PokeCopy)[] = [s, images[0]!, images[1]!];
      let done = 0;
      lerps.forEach((l, i) => {
        if (l.update()) place(targets[i]!, l);
        else done++;
      });
      if (done >= 3) state = iteration === 1 ? 0 : 2;
      return true;
    });
  },

  /** MegahornAttacker: the attacker shakes, then lunges 40 px forward and 7 up, holds, and returns. */
  MegahornAttacker: (vm) => {
    const s = vm.sprite(vm.attacker);
    const dir = dirX(vm, vm.attacker);
    const [x, y] = [s.x, s.y];
    const there = [x + 40 * dir, y - 7 * dir] as const;
    let shake: Shake | null = null;
    let pos: PosLerp | null = null;
    let state = 0;
    let delay = 0;
    task(vm, () => {
      switch (state) {
        case 0:
          shake = new Shake(4, 0, 1, 4);
          state++;
          return true;
        case 1:
          if (shake!.update()) {
            s.x = x + shake!.x;
            s.y = y + shake!.y;
          } else {
            pos = new PosLerp(x, there[0], y, there[1], 4);
            state++;
          }
          return true;
        case 2:
        case 4:
          if (pos!.update()) place(s, pos!);
          else if (state === 2) {
            delay = 8;
            state++;
          } else state++;
          return true;
        case 3:
          if (--delay < 0) {
            pos = new PosLerp(there[0], x, there[1], y, 4);
            state++;
          }
          return true;
        default:
          s.x = x;
          s.y = y;
          return false;
      }
    });
  },

  /** MegahornDefender: the defender is knocked 40 px back and 16 down, shakes, and returns. */
  MegahornDefender: (vm) => {
    const s = vm.sprite(vm.defender);
    const dir = dirX(vm, vm.defender);
    const [x, y] = [s.x, s.y];
    const there = [x - 40 * dir, y + 16 * dir] as const;
    let shake: Shake | null = null;
    let pos: PosLerp | null = null;
    let state = 0;
    task(vm, () => {
      switch (state) {
        case 0:
          pos = new PosLerp(x, there[0], y, there[1], 4);
          state++;
          return true;
        case 1:
        case 3:
          if (pos!.update()) place(s, pos!);
          else if (state === 1) {
            shake = new Shake(4, 0, 1, 4);
            state++;
          } else state++;
          return true;
        case 2: {
          // The decomp shakes about the sprite's current place each frame.
          const [bx, by] = [s.x, s.y];
          if (shake!.update()) {
            s.x = bx + shake!.x;
            s.y = by + shake!.y;
          } else {
            pos = new PosLerp(there[0], x, there[1], y, 4);
            state++;
          }
          return true;
        }
        default:
          s.x = x;
          s.y = y;
          return false;
      }
    });
  },
};

/** AlphaFadeContext: the OBJ blend steps from (sa, sb) to (ea, eb) over `frames` (its own task). */
export function alphaFade(vm: AnimVm, sa: number, ea: number, sb: number, eb: number, frames: number): void {
  vm.objBlend = { a: sa, b: sb };
  const lerp = new PosLerp(sa, ea, sb, eb, frames);
  task(vm, () => {
    if (!lerp.update()) return false;
    vm.objBlend = { a: Math.max(0, lerp.x), b: Math.max(0, lerp.y) };
    return true;
  });
}
