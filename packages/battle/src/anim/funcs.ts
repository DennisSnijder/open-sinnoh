/**
 * The native functions scripts call (CallFunc; decomp script_func_tables.c, script_funcs_*.c,
 * battle_anim_helpers.c). Each reads its arguments from the script vars (CallFunc copies them to vars 0–9)
 * and starts an animation task, which the VM steps once per frame after the script; some step their task
 * once more at once (the decomp calls the task function after starting it). The ones not here are listed
 * by `ANIM_FUNCS` as unimplemented: a script that uses one plays the generic hit instead (counted).
 */
import { degToIdx, idiv, sinIdx } from './fx.ts';
import { FUNCS } from './script.ts';
import type { Emitter } from './spl.ts';
import type { AnimVm } from './vm.ts';
import { anchoredOffset, BACKGROUND, BATTLER_SPRITES, battler, battlerSprites, dirX, PIXEL, POKEMON_SPRITES, PosLerp, Revolution, ScaleLerp, Shake, SPECIFIC, task, type Func } from './tasks.ts';
import { MORE_FUNCS } from './funcs2.ts';
import { SPRITE_FUNCS } from './funcs3.ts';
import { SPRITE_COMPANION_FUNCS } from './funcs4.ts';

const FUNC_IMPLS: Record<string, Func> = {
  Nop: () => {},

  /** RenderPokemonSprites: draws the sprite copies for `frames` (default 3) frames; only the time shows. */
  RenderPokemonSprites: (vm) => {
    let frames = vm.vars[0] || 3;
    task(
      vm,
      () => {
        if (frames === 0) return false;
        frames--;
        return true;
      },
      true,
    );
  },

  FadeBg: (vm) => {
    const [type, delay, from, to, color] = vm.vars as [number, number, number, number, number];
    if (type === 1) throw new Error('battle anim: FadeBg of the Pokémon sprite loaded into BG2 (LoadPokemonSpriteIntoBg is not supported)');
    vm.bg.fade.start(type === 0 ? 'base' : 'effect', delay, from, to, color);
    task(vm, () => vm.bg.fade.active);
  },

  FadeBattlerSprite: (vm) => {
    const [target, delay, endDelay0, color, alpha, hold0] = vm.vars as [number, number, number, number, number, number];
    const s = battler(vm, target);
    if (!s) return;
    let state = 0;
    let endDelay = endDelay0;
    let hold = hold0;
    task(vm, () => {
      for (;;) {
        switch (state) {
          case 0:
            s.startFade(0, alpha, delay, color);
            state++;
            return true;
          case 1:
            if (!s.fade.active) state++;
            return true;
          case 2:
            if (hold === 0) {
              state++;
              continue;
            }
            hold--;
            return true;
          case 3:
            s.startFade(alpha, 0, delay, color);
            state++;
            return true;
          case 4:
            if (!s.fade.active) {
              endDelay--;
              state = endDelay <= 0 ? 5 : 0;
            }
            return true;
          default:
            return false;
        }
      }
    });
  },

  Shake: (vm) => {
    const [ex, ey, interval, amount, targets] = vm.vars as [number, number, number, number, number];
    const sprites = targets & BATTLER_SPRITES ? battlerSprites(vm, targets).map((s) => ({ s, x: s.x, y: s.y })) : [];
    const copies =
      targets & POKEMON_SPRITES
        ? pokemonSpriteSlots(targets).flatMap((i) =>
            vm.pokemonSprites[i]
              ? [
                  {
                    c: vm.pokemonSprites[i]!,
                    x: vm.pokemonSprites[i]!.x,
                    y: vm.pokemonSprites[i]!.y,
                  },
                ]
              : [],
          )
        : [];
    let shake: Shake | null = null;
    task(vm, () => {
      if (!shake) {
        shake = new Shake(ex, ey, interval, amount);
        return true;
      }
      if (!shake.update()) return false;
      for (const { s, x, y } of sprites) {
        s.x = x + shake.x;
        s.y = y + shake.y;
      }
      for (const { c, x, y } of copies) {
        c.x = x + shake.x;
        c.y = y + shake.y;
      }
      if (targets & BACKGROUND) vm.bg.offset.x = shake.x;
      return true;
    });
  },

  HideBattler: (vm) => {
    const [target, hide] = vm.vars as [number, number];
    // Decomp BUG: one sprite slot, so only the first target's sprite is set.
    const s = battlerSprites(vm, target)[0];
    if (s) s.hide = hide !== 0;
  },

  ScaleBattlerSprite: (vm) => {
    const [target, sx, ex, sy, ey, ref, holdCycles, frames] = vm.vars as number[];
    const s = target! & SPECIFIC ? battler(vm, target!) : battlerSprites(vm, target!)[0];
    if (!s) return;
    const baseY = s.y;
    const height = s.height + 16;
    let cycles = holdCycles! & 0xffff;
    let hold = holdCycles! >>> 16;
    let state = 0;
    let lerp: ScaleLerp | null = null;
    const apply = () => {
      s.scaleX = lerp!.x;
      s.scaleY = lerp!.y;
    };
    task(
      vm,
      () => {
        for (;;) {
          switch (state) {
            case 0:
              lerp = new ScaleLerp(sx!, ex!, sy!, ey!, ref!, frames! >>> 16);
              if (lerp.updateUniform()) apply();
              state++;
              return true;
            case 1:
              if (lerp!.update()) {
                apply();
                s.y = baseY + anchoredOffset(height, lerp!.cy);
              } else state++;
              return true;
            case 2:
              if (hold === 0) {
                state++;
                continue;
              }
              hold--;
              return true;
            case 3:
              lerp = new ScaleLerp(ex!, sx!, ey!, sy!, ref!, frames! & 0xffff);
              if (lerp.update()) apply();
              state++;
              return true;
            case 4:
              if (lerp!.update()) {
                apply();
                s.y = baseY + anchoredOffset(height, lerp!.cy);
              } else {
                cycles--;
                state = cycles <= 0 ? 5 : 0;
              }
              return true;
            default:
              s.scaleX = 256;
              s.scaleY = 256;
              return false;
          }
        }
      },
      true,
    );
  },

  MoveBattlerX: (vm) => moveBattlerX(vm, false),
  MoveBattlerX2: (vm) => moveBattlerX(vm, true),

  MoveBattler: (vm) => {
    const [frames, dx, dy, target] = vm.vars as [number, number, number, number];
    const s = battler(vm, target);
    if (!s) return;
    const d = dirX(vm, s.battler);
    const x0 = s.x;
    const y0 = s.y;
    let lerp: PosLerp | null = null;
    let done = false;
    task(
      vm,
      () => {
        if (done) return false;
        // A contest turns the Y offset round once more (BattleAnimScriptFunc_MoveBattler).
        lerp ??= new PosLerp(x0, x0 + dx * d, y0, y0 + dy * d * (vm.contest ? -1 : 1), frames);
        if (!lerp.update()) done = true;
        s.x = lerp.x;
        s.y = lerp.y;
        return true;
      },
      true,
    );
  },

  ShakeBg: (vm) => {
    const [ex, ey, interval, amount, cycles, target] = vm.vars as [number, number, number, number, number, number];
    if (target !== 0) {
      vm.deps.log.stub('anim:shake-bg:base', 'shaking BG2 (the switched-in layer) is not drawn');
    }
    let shake: Shake | null = null;
    let iteration = 0;
    let state = 0;
    let resetX = false;
    let resetY = false;
    task(vm, () => {
      if (state === 2) return false;
      if (state === 0) {
        shake = new Shake(ex, ey, interval, amount);
        state = 1;
      }
      if (!shake!.update()) {
        state = iteration >= cycles ? 2 : 0;
        if (resetX && target === 0) vm.bg.offset.x = 0;
        if (resetY && target === 0) vm.bg.offset.y = 0;
        iteration++;
        return true;
      }
      if (shake!.x !== 0) {
        resetX = true;
        if (target === 0) vm.bg.offset.x = shake!.x;
      }
      if (shake!.y !== 0) {
        resetY = true;
        if (target === 0) vm.bg.offset.y = shake!.y;
      }
      return true;
    });
  },

  MoveEmitterA2BLinear: (vm) => moveEmitter(vm, false),
  MoveEmitterA2BParabolic: (vm) => moveEmitter(vm, true),
};

/** The Pokémon sprite copies a POKEMON_SPRITE mask names (BattleAnimUtil_GetPokemonSprites: bits 1–4 → ids 0–3). */
function pokemonSpriteSlots(targets: number): number[] {
  return [0, 1, 2, 3].filter((i) => targets & (1 << (i + 1)));
}

function moveBattlerX(vm: AnimVm, now: boolean): void {
  const [frames, offset, target] = vm.vars as [number, number, number];
  const s = battler(vm, target);
  if (!s) return;
  const x0 = s.x;
  const y0 = s.y;
  const off = offset * dirX(vm, s.battler);
  let lerp: PosLerp | null = null;
  let state = 0;
  task(
    vm,
    () => {
      if (state === 2) return false;
      if (state === 0) {
        lerp = new PosLerp(x0, x0 + off, y0, y0, frames);
        state = 1;
        if (!now) return true;
      }
      if (!lerp!.update()) state = 2;
      s.x = lerp!.x;
      return true;
    },
    now,
  );
}

/** EmitterAnimationContext: the emitter moves from the start battler's particle position to the end's (in DS px). */
function moveEmitter(vm: AnimVm, parabolic: boolean): void {
  const [emitterId, ox, oy, startDelay, frames, radius, mode, params, curve] = vm.vars as number[];
  const emitter = vm.emitters[emitterId!];
  const ps = vm.particleSystems[vm.currentParticleSystem];
  if (!emitter || !ps) throw new Error(`battle anim: MoveEmitter on emitter ${emitterId}, which is not a held emitter`);
  const start = mode === 0 ? vm.attacker : vm.defender;
  const end = mode === 0 ? vm.defender : vm.attacker;
  const skip = params! >>> 16;
  let max = params! & 0xffff;
  if (max === 0) max = 0xff;
  const dir = dirX(vm, vm.attacker);
  const a = vm.worldPos(start);
  const b = vm.worldPos(end);
  const px = (v: number) => Math.trunc(v / PIXEL);
  const lerp = new PosLerp(px(a[0]), px(b[0]) + ox! * dir, px(a[1]), px(b[1]) + oy! * dir, frames!);
  const arc = parabolic ? new Revolution(0, 0, degToIdx(90), degToIdx(270), 0, radius! * -4096, frames!) : null;
  const update = () => {
    const l = lerp.update();
    if (!arc) return l;
    const r = arc.update();
    lerp.x += arc.x;
    lerp.y += arc.y;
    return l || r;
  };
  for (let i = 0; i < skip; i++) update();
  const frame = max !== 0xff ? max + 1 : 0;
  let timer = 0;
  let angle = 0;
  const place = () => {
    emitter.setPos(0, lerp.x * PIXEL);
    emitter.setPos(1, lerp.y * PIXEL);
  };
  place();
  task(vm, () => {
    const active = emitterActive(emitter);
    if (!parabolic && timer < startDelay!) {
      timer++;
      return true;
    }
    if (!update() && !active) {
      ps.deleteEmitter(emitter);
      return false;
    }
    if (!parabolic && (skip > frame || max < frame) && max !== 0xff) return true;
    place();
    if (!parabolic && curve) {
      angle += idiv(360, frames!);
      emitter.setPos(1, lerp.y * PIXEL + sinIdx(degToIdx(angle % 360)));
    }
    return true;
  });
}

/** IsEmitterActive: the oldest particle (the list's last) has not reached its last frame. */
function emitterActive(e: Emitter): boolean {
  const last = e.particles[e.particles.length - 1];
  return last !== undefined && last.age !== last.life;
}

/** The functions the VM runs, by name; `FUNCS` names the others (unimplemented). */
Object.assign(FUNC_IMPLS, MORE_FUNCS, SPRITE_FUNCS, SPRITE_COMPANION_FUNCS);

export const ANIM_FUNCS = new Set(Object.keys(FUNC_IMPLS));

export function callFunc(vm: AnimVm, id: number): void {
  const name = FUNCS[id];
  if (!name) throw new Error(`battle anim: unknown function ${id}`);
  const f = FUNC_IMPLS[name];
  if (!f) {
    vm.deps.log.stub(`anim:func:${name}`, 'battle animation function not implemented: skipped');
    return;
  }
  f(vm);
}
