/**
 * More native functions (decomp script_funcs_0–3.c, script_funcs_stat_change.c): the battler transforms
 * (scale, rotate, revolve, hop), the sprite-copy effects (afterimages, Double Team) and the stat change
 * pattern. Each follows its decomp task frame by frame; constants are the decomp's.
 */
import { degToIdx, idiv } from './fx.ts';
import { anchoredOffset, battlerSprites, dirX, ovalRevolution, PIXEL, PosLerp, Revolution, ScaleLerp, Shake, sideOf, task, ValueLerp, type Func } from './tasks.ts';
import type { Emitter } from './spl.ts';
import type { AnimVm, MonSprite, PokeCopy } from './vm.ts';

const ATTACKER_ROLE = 0;
/** REVOLUTION_CONTEXT_OVAL_RADIUS_Y_INT. */
const OVAL_RY = -8;
/** BASE_SCALE_XY: scales are percentages of it. */
const BASE = 100;

/** BATTLE_ANIM_ATTACKER (1 << 1) and friends as single targets (the *_PARTNER bits name a battler only in doubles). */
function battlerOfTarget(vm: AnimVm, target: number): number | null {
  if (target & (1 << 1)) return vm.attacker;
  if (target & (1 << 3)) return vm.defender;
  if (vm.doubles && target & (1 << 2)) return vm.ally(vm.attacker);
  if (vm.doubles && target & (1 << 4)) return vm.ally(vm.defender);
  return null;
}

const setScale = (s: MonSprite | PokeCopy, l: ScaleLerp) => {
  s.scaleX = l.x;
  s.scaleY = l.y;
};

/** The ground-anchored y for a scale (BattleAnimUtil_SetPokemonSpriteAnchoredPosition): bottom or top anchor. */
function anchored(y: number, height: number, scaleY: number, top = false): number {
  const off = anchoredOffset(height, scaleY);
  return top ? y - height - off : y + off;
}

/** The stat change pattern (StatChangeUp/Down/Heal/Metal): pattern `index`, scrolled `step` px a frame. */
function statChange(stepY: number): Func {
  return (vm) => {
    const [index] = vm.vars as [number];
    const sheet = vm.data.statChange[index];
    if (!sheet) throw new Error(`battle anim: no stat change pattern ${index}`);
    const mask = vm.pokemonSprites[1];
    if (!mask) throw new Error('battle anim: StatChange without its sprite copy 1 (the silhouette)');
    mask.window = true;
    const copies = [vm.pokemonSprites[0], mask, vm.pokemonSprites[2]];
    // The partner's copy is hidden in singles; copy 0 draws as the battler.
    if (vm.pokemonSprites[2]) vm.pokemonSprites[2].visible = false;
    let state = 0;
    let timer = 0;
    let overlay = 12;
    let other = 4;
    let dy = 0;
    vm.overlay = { sheet, dx: 0, dy: 0, alpha: overlay / 16, mask: mask.battler };
    task(vm, () => {
      switch (state) {
        case 0:
        case 1:
          state++;
          break;
        case 2:
          if (timer > 20) state++;
          else timer++;
          break;
        case 3:
          if (overlay > 0) overlay--;
          if (other < 16) other++;
          if (overlay === 0 && other === 16) {
            for (const c of copies) if (c) c.visible = false;
            vm.overlay = null;
            state++;
            return true;
          }
          break;
        default:
          vm.overlay = null;
          return false;
      }
      dy += stepY;
      vm.overlay = { sheet, dx: 0, dy, alpha: overlay / (overlay + other || 1), mask: mask.battler };
      return true;
    });
  };
}

/** XYTransformContext revolution applied to a battler around (cx, cy) until done; then `end`. */
function revolve(vm: AnimVm, s: MonSprite, rev: Revolution, cx: number, cy: number, end: () => void): void {
  task(vm, () => {
    if (!rev.update()) {
      end();
      return false;
    }
    s.x = cx + rev.x;
    s.y = cy + rev.y;
    return true;
  });
}

/** Scale steps on a battler, each anchored to the ground: [sx, ex, sy, ey, frames] percent of BASE. */
function scaleSteps(vm: AnimVm, s: MonSprite, steps: number[][], top = false, restore = true): void {
  const baseY = s.y;
  let i = 0;
  let lerp: ScaleLerp | null = null;
  task(vm, () => {
    if (!lerp) {
      const st = steps[i++]!;
      lerp = new ScaleLerp(st[0]!, st[1]!, st[2]!, st[3]!, BASE, st[4]!);
      return true;
    }
    const going = lerp.update();
    setScale(s, lerp);
    s.y = anchored(baseY, s.height, lerp.cy, top);
    if (!going) {
      if (i < steps.length) lerp = null;
      else {
        if (restore) {
          s.scaleX = 256;
          s.scaleY = 256;
          s.y = baseY;
        }
        return false;
      }
    }
    return true;
  });
}

export const MORE_FUNCS: Record<string, Func> = {
  StatChangeUp: statChange(3),
  StatChangeDown: statChange(-3),
  StatChangeHeal: statChange(3),
  StatChangeMetal: statChange(-6),

  /** Revolves battlers on a half-size oval (32 × −8 px), then puts them back. */
  RevolveBattler: (vm) => {
    const [target, revs, frames] = vm.vars as [number, number, number];
    const s = battlerSprites(vm, target)[0];
    if (!s) return;
    const cx = s.x;
    const cy = s.y - OVAL_RY;
    const rev = ovalRevolution(revs, frames);
    rev.rx = idiv(rev.rx, 2);
    rev.ry = idiv(rev.ry, 2);
    revolve(vm, s, rev, cx, cy, () => {
      s.x = cx;
      s.y = cy + OVAL_RY;
    });
  },

  /** Submission: the battler tumbles round an oval (mirrored for the attacker). */
  Submission: (vm) => {
    const [revs, frames, target] = vm.vars as [number, number, number];
    const side = battlerOfTarget(vm, target);
    if (side === null) return;
    const s = vm.sprite(side);
    const rev = ovalRevolution(revs, frames);
    if (target & (1 << 1)) rev.rx = -rev.rx;
    const cx = s.x;
    const cy = s.y - OVAL_RY;
    revolve(vm, s, rev, cx, cy, () => {
      s.x = cx;
      s.y = cy + OVAL_RY;
      s.rotation = 0;
    });
  },

  /** Flail: the attacker wiggles (20°, 15°, 10°, 5°, 0° each way), or the defender shakes. */
  Flail: (vm) => {
    const [mode, ex, ey, interval, amount] = vm.vars as [number, number, number, number, number];
    const atk = vm.sprite(vm.attacker);
    const def = vm.sprite(vm.defender);
    atk.pivotY = 100;
    if (mode === 0) {
      const angles = [
        [degToIdx(20), 3],
        [degToIdx(15), 3],
        [degToIdx(10), 2],
        [degToIdx(5), 2],
        [degToIdx(0), 1],
      ] as const;
      let side = 0;
      let wiggle = 0;
      let lerp: ValueLerp | null = null;
      task(vm, () => {
        if (!lerp) {
          const [a, f] = angles[wiggle]!;
          lerp = side === 0 ? new ValueLerp(-a, a, f) : new ValueLerp(a, -a, f);
          if (side === 1) wiggle++;
          side ^= 1;
        }
        if (lerp.update()) {
          atk.rotation = lerp.value & 0xffff;
          return true;
        }
        if (wiggle >= 5) {
          atk.rotation = 0;
          return false;
        }
        lerp = null;
        return true;
      });
    } else {
      let shake: Shake | null = null;
      task(vm, () => {
        if (!shake) {
          shake = new Shake(ex, ey, interval, amount);
          return true;
        }
        const x = def.x;
        const y = def.y;
        if (!shake.update()) return false;
        def.x = x + shake.x;
        def.y = y + shake.y;
        return true;
      });
    }
  },

  /** PlayfulHops: four tilted hops of 2 px, rocking side to side. */
  PlayfulHops: (vm) => {
    const [role] = vm.vars as [number];
    const s = vm.sprite(role === ATTACKER_ROLE ? vm.attacker : vm.defender);
    const bx = s.x;
    const by = s.y;
    s.pivotY = 50;
    let flip = dirX(vm.attacker) !== 1;
    let angle: ValueLerp;
    let hop = 0;
    let delay = 0;
    let pos: PosLerp | null = null;
    let count = 0;
    const initTilt = () => {
      angle = new ValueLerp(0, degToIdx(15), 3, true);
      if (flip) angle.negate();
      s.pivotX = flip ? 16 : -16;
      hop = 0;
      delay = 0;
    };
    const updateHop = (): boolean => {
      switch (hop) {
        case 0:
          angle.update();
          s.rotation = angle.value & 0xffff;
          if (--delay < 0) {
            hop++;
            pos = new PosLerp(bx, bx, by, by + 2, 2);
          }
          return false;
        case 1:
          if (angle.update()) s.rotation = angle.value & 0xffff;
          if (!pos!.update()) {
            hop++;
            angle = new ValueLerp(angle.value, 0, 3, true);
            pos = new PosLerp(bx, bx, by + 2, by, 2);
          } else {
            s.x = pos!.x;
            s.y = pos!.y;
          }
          return false;
        case 2:
          if (pos!.update()) {
            s.x = pos!.x;
            s.y = pos!.y;
          }
          if (angle.update()) s.rotation = angle.value & 0xffff;
          else {
            s.x = bx;
            s.y = by;
            s.rotation = 0;
            hop++;
          }
          return false;
        default:
          return true;
      }
    };
    initTilt();
    task(vm, () => {
      if (count >= 4) return false;
      if (updateHop()) {
        count++;
        if (count < 4) {
          flip = !flip;
          initTilt();
          updateHop();
        }
      }
      return true;
    });
  },

  /** QuickAttack: the attacker circles once; two translucent afterimages follow 2 frames apart. */
  QuickAttack: (vm) => {
    const s = vm.sprite(vm.attacker);
    const ax = s.x;
    const ay = s.y - OVAL_RY;
    const dir = dirX(vm.attacker);
    const rev = ovalRevolution(1, 8);
    rev.rx *= dir;
    const copies = [vm.pokemonSprites[0] ?? null, vm.pokemonSprites[1] ?? null];
    for (const c of copies) if (c) c.xlu = true;
    const images = afterimages(
      copies,
      () => {
        const r = ovalRevolution(1, 10);
        r.rx *= dir;
        return r;
      },
      ax,
      ay,
      2,
    );
    task(vm, () => {
      const a = rev.update();
      if (a) {
        s.x = ax + rev.x;
        s.y = ay + rev.y;
      }
      const b = images();
      if (a || b) return true;
      s.x = ax;
      s.y = ay + OVAL_RY;
      return false;
    });
  },

  /** RotateMon: turns a battler from one angle to another and back. */
  RotateMon: (vm) => {
    const [start, end, steps, mode, px, py] = vm.vars as [number, number, number, number, number, number];
    const side = mode === 0 || mode === 2 ? vm.defender : vm.attacker;
    const s = vm.sprite(side);
    let dir = dirX(side);
    const lerp0 = new ValueLerp(start, end, steps);
    if (dir < 0) lerp0.negate();
    if (mode === 2) dir = -dir;
    s.pivotX = mode === 1 ? px : 40 * dir;
    s.pivotY = mode === 1 ? py : 40;
    let lerp = lerp0;
    let state = 0;
    task(vm, () => {
      if (state < 2) {
        if (lerp.update()) s.rotation = lerp.value & 0xffff;
        else {
          lerp = new ValueLerp(lerp.value, start, steps);
          state++;
        }
        return true;
      }
      s.pivotX = 0;
      s.pivotY = 0;
      s.rotation = 0;
      return false;
    });
  },

  /** Growth: the attacker swells to 115 % and back twice, flashing white. */
  Growth: (vm) => {
    const s = vm.sprite(vm.attacker);
    let state = 0;
    let big = false;
    let iterations = 0;
    let lerp: ScaleLerp | null = null;
    task(vm, () => {
      if (state === 0) {
        lerp = big ? uniformScale(115, 100, 6) : uniformScale(100, 115, 6);
        if (!big) s.startFade(0, 6, 0, 0x7fff);
        else s.startFade(6, 0, 0, 0x7fff);
        big = !big;
        iterations++;
        state = 1;
        return true;
      }
      if (state === 1) {
        if (!lerp!.updateUniform() && !s.fade.active) state = iterations < 4 ? 0 : 2;
        setScale(s, lerp!);
        return true;
      }
      return false;
    });
  },

  /** Strength: the attacker shrinks while shaking, blinks red three times, then swells and settles. */
  Strength: (vm) => {
    const [shrink, grow, shrinkFrames, growFrames] = vm.vars as [number, number, number, number];
    const s = vm.sprite(vm.attacker);
    const baseY = s.y;
    let lerp = uniformScale(BASE, shrink, shrinkFrames);
    const shake = new Shake(2, 0, 0, 10);
    let state = 0;
    let blinks = 0;
    task(vm, () => {
      switch (state) {
        case 0:
          if (lerp.updateUniform()) {
            shake.update();
            setScale(s, lerp);
            s.x += shake.x;
            s.y = baseY + anchoredOffset(s.height, lerp.cy);
          } else state++;
          return true;
        case 1:
          s.startFade(0, 10, 0, 0x001f);
          state++;
          return true;
        case 2:
          if (!s.fade.active) {
            s.startFade(10, 0, 0, 0x001f);
            state++;
          }
          return true;
        case 3:
          if (!s.fade.active) {
            if (++blinks >= 3) {
              lerp = uniformScale(shrink, grow, growFrames);
              state++;
            } else state = 1;
          }
          return true;
        case 4:
        case 5:
          if (lerp.updateUniform()) {
            setScale(s, lerp);
            s.y = baseY + anchoredOffset(s.height, lerp.cy);
          } else if (state === 4) state++;
          else {
            s.scaleX = 256;
            s.scaleY = 256;
            s.y = baseY;
            state++;
          }
          return true;
        default:
          return false;
      }
    });
  },

  BulkUp: (vm) =>
    scaleSteps(vm, vm.sprite(vm.attacker), [
      [BASE, 150, BASE, 50, 10],
      [150, 50, 50, 150, 10],
      [50, BASE, 150, BASE, 5],
      [BASE, 150, BASE, 150, 5],
      [150, BASE, 150, BASE, 5],
    ]),

  Meditate: (vm) =>
    scaleSteps(
      vm,
      vm.sprite(vm.attacker),
      [
        [BASE, 150, BASE, 50, 8],
        [150, 50, 50, 150, 8],
        [50, BASE, 150, BASE, 8],
      ],
      false,
      false,
    ),

  /** Teleport: squished thin and tall, lifted off, shrunk away and hidden. */
  Teleport: (vm) => {
    const s = vm.sprite(vm.attacker);
    const baseY = s.y;
    let y = s.y;
    let state = 0;
    let lerp: ScaleLerp | null = null;
    let pos: PosLerp | null = null;
    task(vm, () => {
      switch (state) {
        case 0:
          lerp = new ScaleLerp(BASE, 10, BASE, 180, BASE, 10);
          state++;
          return true;
        case 1:
          if (!lerp!.update()) state++;
          setScale(s, lerp!);
          s.y = anchored(y, s.height, lerp!.cy);
          return true;
        case 2:
          pos = new PosLerp(0, 0, s.y, 0, 5);
          state++;
          return true;
        case 3:
          if (!pos!.update()) state++;
          s.y = pos!.y;
          return true;
        case 4:
          lerp = new ScaleLerp(10, 10, 180, 0, BASE, 5);
          y = s.y;
          state++;
          return true;
        case 5:
          if (!lerp!.update()) state++;
          setScale(s, lerp!);
          s.y = anchored(y, s.height, lerp!.cy, true);
          return true;
        default:
          s.y = baseY;
          s.hide = true;
          s.scaleX = 256;
          s.scaleY = 256;
          return false;
      }
    });
  },

  /** Flash: the backdrop fades to white while the attacker darkens, holds, then both come back. */
  Flash: (vm) => {
    const s = vm.sprite(vm.attacker);
    let state = 0;
    let hold = 0;
    task(vm, () => {
      switch (state) {
        case 0:
          vm.bg.fade.start('base', -2, 0, 16, 0x7fff);
          s.startFade(0, 16, 0, 0);
          state++;
          return true;
        case 1:
        case 4:
          if (!vm.bg.fade.active && !s.fade.active) state++;
          return true;
        case 2:
          if (++hold > 5) state++;
          return true;
        case 3:
          vm.bg.fade.start('base', -2, 16, 0, 0x7fff);
          s.startFade(16, 0, 0, 0);
          state++;
          return true;
        default:
          return false;
      }
    });
  },

  /** Splash: three hops of stretch and squash, 16 px up. */
  Splash: (vm) => {
    const s = vm.sprite(vm.attacker);
    const y = s.y;
    const scales = [
      [BASE, 120, BASE, 80],
      [120, BASE, 80, 120],
      [BASE, BASE, 120, BASE],
    ];
    const ys = [
      [0, 16],
      [16, 0],
      [0, 0],
    ];
    let i = 0;
    let cycles = 0;
    let state = 0;
    let lerp: ScaleLerp | null = null;
    let pos: PosLerp | null = null;
    task(vm, () => {
      if (state === 0) {
        lerp = new ScaleLerp(scales[i]![0]!, scales[i]![1]!, scales[i]![2]!, scales[i]![3]!, BASE, 5);
        pos = new PosLerp(0, 0, y + ys[i]![0]!, y + ys[i]![1]!, 5);
        i++;
        state = 1;
        return true;
      }
      if (state === 2) return false;
      let done = 0;
      if (!lerp!.update()) done++;
      if (!pos!.update()) done++;
      if (done >= 2) {
        if (i >= scales.length) {
          cycles++;
          i = 0;
          state = cycles >= 3 ? 2 : 0;
        } else state = 0;
      }
      setScale(s, lerp!);
      s.y = anchored(pos!.y, s.height, lerp!.cy);
      return true;
    });
  },

  /** Earthquake: the backdrop dims, then everything shakes in shrinking swings while the backdrop flashes. */
  Earthquake: (vm) => {
    const extents = [12, 10, 8, 6, 4, 2, 1, 0];
    const sprites = [vm.sprite(vm.attacker), vm.sprite(vm.defender)].map((s) => ({ s, x: s.x }));
    let state = 0;
    let count = 0;
    let flash = 0;
    let flashFrames = 0;
    let shake = new Shake(0, 0, 0, 0);
    const startShake = () => {
      shake = new Shake(extents[count]!, 0, 0, 5);
      vm.bg.fade.set('base', 10, flash === 0 ? 0 : 0x7fff);
      flashFrames = 3;
      flash ^= 1;
      count++;
      state = 3;
    };
    task(vm, () => {
      switch (state) {
        case 0:
          vm.bg.fade.start('base', 1, 0, 10, 0);
          state++;
          return true;
        case 1:
          if (vm.bg.fade.active) return true;
          startShake();
          break;
        case 2:
          startShake();
          break;
        case 3:
          break;
        default:
          return false;
      }
      if (!shake.update()) state = count >= extents.length ? 4 : 2;
      if (flashFrames > 0 && --flashFrames === 0) vm.bg.fade.set('base', 0, 0);
      for (const { s, x } of sprites) s.x = x + shake.x;
      vm.bg.offset.x = shake.x;
      return true;
    });
  },

  /** BlinkAttacker: hides and shows the attacker `count` times, every `interval` + 1 frames. */
  BlinkAttacker: (vm) => {
    const [count, interval] = vm.vars as [number, number];
    const s = vm.sprite(vm.attacker);
    let left = count * 2;
    let timer = 0;
    task(vm, () => {
      if (timer >= interval) {
        if (left === 0) {
          s.hide = false;
          return false;
        }
        s.hide = !s.hide;
        left--;
        timer = 0;
      } else timer++;
      return true;
    });
  },

  MoveBattlerOffScreen: (vm) => {
    const [target, frames] = vm.vars as [number, number];
    offScreen(vm, target, frames, 'off');
  },
  MoveBattlerOnOrOffScreen: (vm) => {
    const [mode, target, frames] = vm.vars as [number, number, number];
    offScreen(vm, target, frames, mode === 0 ? 'off' : 'on');
  },
  MoveBattlerToDefaultPos: (vm) => {
    const [target] = vm.vars as [number];
    const side = battlerOfTarget(vm, target);
    if (side === null) return;
    const s = vm.sprite(side);
    s.x = s.baseX;
    s.y = s.baseY;
  },

  /** RevolveEmitter: the held emitter circles a battler's particle position. */
  RevolveEmitter: (vm) => {
    const [id, sx, ex, sy, ey, rx, ry, frames, mode, psIndex] = vm.vars as number[];
    const e = vm.emitters[id!];
    const ps = vm.particleSystems[psIndex!];
    if (!e || !ps) throw new Error(`battle anim: RevolveEmitter on emitter ${id}, particle system ${psIndex}`);
    const pos = vm.worldPos(mode === 0 ? vm.attacker : vm.defender);
    const rev = new Revolution(degToIdx(sx!), degToIdx(ex!), degToIdx(sy!), degToIdx(ey!), rx! * 4096, ry! * 4096, frames!);
    rev.update();
    e.setPos(0, pos[0] + rev.x * PIXEL);
    e.setPos(1, pos[1] + rev.y * PIXEL);
    task(vm, () => {
      const active = emitterActive(e);
      if (!rev.update() && !active) {
        ps.deleteEmitter(e);
        return false;
      }
      e.setPos(0, pos[0] + rev.x * PIXEL);
      e.setPos(1, pos[1] + rev.y * PIXEL);
      return true;
    });
  },

  /** MoveEmitterViewportTop: the held emitter falls from the top of the screen onto a battler, or rises to it. */
  MoveEmitterViewportTop: (vm) => {
    const [id, mode, type, frames, delay, params] = vm.vars as number[];
    const e = vm.emitters[id!];
    const ps = vm.particleSystems[vm.currentParticleSystem];
    if (!e || !ps) throw new Error(`battle anim: MoveEmitterViewportTop on emitter ${id}`);
    const side = mode === 0 ? vm.attacker : vm.defender;
    const at = vm.worldPos(side);
    const top = 16512 + 60 * PIXEL;
    const [s, d] = type === 0 ? [[at[0], top], at] : [at, [at[0], top]];
    const px = (v: number) => Math.trunc(v / PIXEL);
    const lerp = new PosLerp(px(s[0]!), px(d[0]!), px(s[1]!), px(d[1]!), frames!);
    const skip = params! >>> 16;
    const max = params! & 0xffff || 0xff;
    for (let i = 0; i < skip; i++) lerp.update();
    const frame = max !== 0xff ? max + 1 : 0;
    e.setPos(0, lerp.x * PIXEL);
    e.setPos(1, lerp.y * PIXEL);
    let timer = 0;
    task(vm, () => {
      const active = emitterActive(e);
      if (timer < delay!) {
        timer++;
        return true;
      }
      if (!lerp.update() && !active) {
        ps.deleteEmitter(e);
        return false;
      }
      if ((skip > frame || max < frame) && max !== 0xff) return true;
      e.setPos(0, lerp.x * PIXEL);
      e.setPos(1, lerp.y * PIXEL);
      return true;
    });
  },

  ScrollSwitchedBg: (vm) => vm.bg.startSine(vm.vars[0]!),

  SetBgGrayscale: (vm) => {
    vm.bg.grayscale = vm.vars[0] !== 0;
  },

  /** AlphaFadePokemonSprite: the sprite copies turn translucent and the OBJ blend steps from start to end. */
  AlphaFadePokemonSprite: (vm) => {
    const [targets, sa, ea, ba, bb, frames] = vm.vars as number[];
    for (let i = 0; i < 4; i++) if (targets! & (1 << i) && vm.pokemonSprites[i]) vm.pokemonSprites[i]!.xlu = true;
    const def = (v: number, d: number) => (v === -1 ? d : v);
    vm.objBlend = { a: def(sa!, 31), b: def(ba!, 31) };
    const lerp = new PosLerp(vm.objBlend.a, ea!, vm.objBlend.b, bb!, frames!);
    task(vm, () => {
      if (!lerp.update()) return false;
      vm.objBlend = { a: Math.max(0, lerp.x), b: Math.max(0, lerp.y) };
      return true;
    });
  },

  /** FadePokemonSprite: a sprite copy's palette fades by `step` every `stepFrames` frames. */
  FadePokemonSprite: (vm) => {
    const [targets, stepFrames, step, from, to, color] = vm.vars as number[];
    const slot = [0, 1, 2, 3].find((i) => targets! & (1 << (i + 1)));
    const c = slot === undefined ? null : vm.pokemonSprites[slot];
    if (!c) return;
    let frac = from!;
    let timer = stepFrames!;
    const st = from! < to! ? step! : -step!;
    let active = true;
    c.fadeColor = color!;
    task(vm, () => {
      if (!active) return false;
      if (++timer >= stepFrames!) {
        timer = 0;
        c.fade = frac;
        if (frac === to) active = false;
        else frac = st > 0 ? Math.min(to!, frac + st) : Math.max(to!, frac + st);
      }
      return true;
    });
  },

  /** Return: the attacker bobs down 32 px and back, twice. */
  Return: (vm) => {
    const s = vm.sprite(vm.attacker);
    const ax = s.x;
    const ay = s.y;
    let count = 0;
    let lerp: PosLerp | null = null;
    task(vm, () => {
      if (count >= 4) return false;
      if (!lerp) {
        lerp = count % 2 === 0 ? new PosLerp(0, 0, 0, 32, 6) : new PosLerp(0, 0, 32, 0, 6);
        return true;
      }
      if (lerp.update()) {
        s.x = ax + lerp.x;
        s.y = ay + lerp.y;
      } else {
        count++;
        lerp = null;
      }
      return true;
    });
  },

  /** DoubleTeam: four tinted, translucent copies swing out and back, faster each time, then fade. */
  DoubleTeam: (vm) => {
    const s = vm.sprite(vm.attacker);
    const ax = s.x;
    const ay = s.y;
    const copies = [0, 1, 2, 3].map((i) => vm.pokemonSprites[i]);
    for (const c of copies) if (c) c.xlu = true;
    const player = sideOf(vm.attacker) === 'player';
    copies.forEach((c, i) => {
      if (!c) return;
      c.fade = (i < 2) === player ? 8 : 4;
      c.fadeColor = 0;
    });
    vm.objBlend = { a: 8, b: 6 };
    const table = [
      [0, 32, 7],
      [0, 32, 10],
      [32, 0, 7],
      [32, 0, 10],
    ];
    let iteration = 0;
    let state = 0;
    let lerps: PosLerp[] = [];
    task(vm, () => {
      if (state === 0) {
        const p = (iteration % 2) * 2;
        const less = (iteration + 1) >> 1;
        const mk = (row: number[], sign: number) => new PosLerp(ax + sign * row[0]!, ax + sign * row[1]!, ay, ay, row[2]! - less);
        lerps = [mk(table[p]!, 1), mk(table[p]!, -1), mk(table[p + 1]!, 1), mk(table[p + 1]!, -1)];
        iteration++;
        state = 1;
      }
      if (state === 1) {
        let complete = 0;
        lerps.forEach((l, i) => {
          if (!l.update()) complete++;
          else if (copies[i]) {
            copies[i]!.x = l.x;
            copies[i]!.y = l.y;
          }
        });
        if (complete === 4) state = iteration === 9 ? 2 : 0;
        return true;
      }
      if (state === 2) {
        if (vm.objBlend.a > 0) vm.objBlend.a--;
        if (vm.objBlend.b < 15) vm.objBlend.b++;
        if (vm.objBlend.a === 0 && vm.objBlend.b === 15) state = 3;
        return true;
      }
      return false;
    });
  },
};

/** ScaleLerpContext_Init: one percentage for both axes (relative to BASE). */
function uniformScale(from: number, to: number, frames: number): ScaleLerp {
  return new ScaleLerp(from, to, from, to, BASE, frames);
}

/** Afterimage_Init / Afterimage_Update: copies switched on one by one, `delay` frames apart, each running its own transform. */
function afterimages(copies: (PokeCopy | null)[], transform: () => Revolution, x: number, y: number, delay: number): () => boolean {
  const list = copies.filter((c): c is PokeCopy => c !== null);
  const transforms = list.map(() => transform());
  for (const c of list) c.visible = false;
  let active = 0;
  let counter = 0;
  return () => {
    if (delay <= counter && active < list.length) {
      list[active]!.visible = true;
      active++;
      counter = 0;
    }
    if (active < list.length) counter++;
    let any = active < list.length;
    for (let i = 0; i < active; i++) {
      if (transforms[i]!.update()) {
        list[i]!.x = x + transforms[i]!.x;
        list[i]!.y = y + transforms[i]!.y;
        any = true;
      } else list[i]!.visible = false;
    }
    return any;
  };
}

/** BattleAnimTask_MoveBattlerOffScreen: slides a battler off its side of the screen, or back on. */
function offScreen(vm: AnimVm, target: number, frames: number, mode: 'off' | 'on'): void {
  const side = battlerOfTarget(vm, target);
  if (side === null) return;
  const s = vm.sprite(side);
  const out = sideOf(side) === 'player' ? -80 : 256 + 80;
  const lerp = mode === 'off' ? new PosLerp(s.x, out, s.y, s.y, frames) : new PosLerp(out, s.baseX, s.y, s.y, frames);
  let done = false;
  task(vm, () => {
    if (done) return false;
    if (!lerp.update()) done = true;
    s.x = lerp.x;
    s.y = lerp.y;
    return true;
  });
}

function emitterActive(e: Emitter): boolean {
  const last = e.particles[e.particles.length - 1];
  return last !== undefined && last.age !== last.life;
}

