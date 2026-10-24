/**
 * The sprite callbacks (BattleAnimSpriteFunc_*) over the ROM's cell animations: timed OAM tasks, not hits. Most are
 * original choreography; StringShot, Trick, Taunt and Fissure follow the decomp, their contest branches included.
 */
import { SPRITE_FUNCS } from './script.ts';
import type { ObjectSprite } from './objects.ts';
import { anchoredOffset, dirX, PosLerp, Revolution, ScaleLerp, sideOf, task } from './tasks.ts';
import { BATTLER_POS, CONTEST_POS, type AnimVm } from './vm.ts';

type Context = {
  vm: AnimVm;
  args: number[];
  spawn(): ObjectSprite;
  remove(s: ObjectSprite): void;
};
type Callback = (c: Context) => void;
const tau = 2 * Math.PI;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
const point = (vm: AnimVm, role: number) => vm.sprite(vm.roleBattler(role));

/** A task owns all its sprites and removes them together. Staggered sprites remain hidden until due. */
function animate(c: Context, count: number, frames: number, update: (s: ObjectSprite, t: number, i: number) => void, stagger = 0): void {
  const sprites = Array.from({ length: count }, () => c.spawn());
  let tick = 0;
  task(c.vm, () => {
    if (sprites.some((s) => !s.active)) return false;
    if (tick >= frames + stagger * (count - 1)) {
      for (const s of sprites) c.remove(s);
      return false;
    }
    for (const [i, s] of sprites.entries()) {
      const t = tick - i * stagger;
      s.visible = t >= 0 && t < frames;
      if (s.visible) update(s, t, i);
    }
    tick++;
    return true;
  });
}

function attached(c: Context, role: number, update?: (s: ObjectSprite, t: number) => void): void {
  const at = point(c.vm, role);
  const s = c.spawn();
  s.x = at.x;
  s.y = at.y;
  let t = 0;
  const frames = Math.max(s.duration, 32);
  task(c.vm, () => {
    if (!s.active) return false;
    if (t >= frames) { c.remove(s); return false; }
    s.x = at.x;
    s.y = at.y;
    update?.(s, t);
    t++;
    return true;
  });
}

/** G2_ChangeBlendAlpha's sprite weight (0–16) as an OBJ alpha. */
const blend = (eva: number) => eva / 16;

/** sStringShotSpriteTimings: per thread, the frame it starts blinking and the frames between toggles. */
const STRING_SHOT_TIMINGS = [[8, 2], [13, 1], [18, 3]] as const;

/**
 * BattleAnimSpriteFunc_StringShot (script_funcs_0.c): `vars[0]` threads stacked over the defender's side's solo spot
 * (BattleAnimUtil_GetBattlerTypeDefaultPos; in a contest the contestant's spot), 4 px apart from 32 px below it. They
 * blink in for 45 frames, squeeze to 60 % wide over 10, hold 45 and fade out (sprite weight 15 → 0).
 */
function stringShot(c: Context): void {
  const count = c.args[0]!;
  if (count < 1 || count > STRING_SHOT_TIMINGS.length) throw new Error(`battle OBJ StringShot: ${count} threads`);
  const at = (c.vm.contest ? CONTEST_POS : BATTLER_POS)[c.vm.defender & 1]!;
  const sprites = Array.from({ length: count }, (_, i) => {
    const s = c.spawn();
    s.x = at.x;
    s.y = at.y + 32 - i * 4;
    // The task draws them (SpriteSystem_DrawSprites) and hides the threads not due on its first frame.
    s.visible = false;
    s.alpha = blend(15);
    return s;
  });
  const counters = sprites.map(() => 0);
  let state = 0;
  let delay = 0;
  let alpha = 15;
  let scale: ScaleLerp | null = null;
  task(c.vm, () => {
    if (sprites.some((s) => !s.active)) return false;
    switch (state) {
      case 0:
        delay++;
        for (const [i, s] of sprites.entries()) {
          const [start, interval] = STRING_SHOT_TIMINGS[i]!;
          if (delay < start) s.visible = false;
          else if (++counters[i]! >= interval) {
            counters[i] = 0;
            s.visible = !s.visible;
          }
        }
        if (delay >= 45) {
          for (const s of sprites) s.visible = true;
          delay = 0;
          state++;
        }
        break;
      case 1:
        scale = new ScaleLerp(100, 60, 100, 100, 100, 10);
        state++;
        break;
      case 2:
        if (scale!.update()) {
          for (const s of sprites) {
            s.scaleX = scale!.x / 256;
            s.scaleY = scale!.y / 256;
          }
        } else if (++delay >= 45) state++;
        break;
      case 3:
        // The BG weight climbs 0 → 15 as the sprites' falls: both end together.
        alpha--;
        for (const s of sprites) s.alpha = blend(alpha);
        if (alpha === 0) state++;
        break;
      default:
        for (const s of sprites) c.remove(s);
        return false;
    }
    return true;
  });
}

/** sTrickCupScales: the attacker's squash and stretch before the cups, [sx, ex, sy, ey, frames] percent. */
const TRICK_SCALES = [[100, 100, 100, 70, 8], [100, 100, 70, 120, 3], [100, 100, 120, 100, 3]] as const;
/** cupArcDirections: the arc sides of the five cup switches. */
const TRICK_ARCS = [[1, -1], [-1, 1], [1, -1], [1, -1], [1, -1]] as const;

/** XYTransformContext_InitParabolic / UpdateParabolic: a lerp plus a half turn of `radius` px on Y; null once done. */
function parabola(sx: number, ex: number, sy: number, ey: number, frames: number, radius: number): () => { x: number; y: number } | null {
  const line = new PosLerp(sx, ex, sy, ey, frames);
  const arc = new Revolution(0, 0, 0x4000, 0xc000, 0, radius * 4096, frames);
  return () => {
    const a = line.update();
    const b = arc.update();
    return a || b ? { x: line.x + arc.x, y: line.y + arc.y } : null;
  };
}

/**
 * BattleAnimSpriteFunc_Trick (script_funcs_0.c): the attacker squashes and stretches, two cups (`vars[0]`) slide 52 px
 * down out of sight and appear, swap places five times on 40 px arcs and fade out. The cups start at (100, 54) and
 * (180, 39); in a contest at (160, 54) and (80, 39) (TRICK_SPRITE_CUP_2_X − 20, CUP_1_X − 20). The decomp's draw
 * order by the cups' place (in front of or behind the battlers) has no counterpart here.
 */
function trick(c: Context): void {
  if (c.args[0] !== 2) throw new Error(`battle OBJ Trick: ${c.args[0]} cups`);
  const vm = c.vm;
  const cups = [c.spawn(), c.spawn()] as const;
  const [x0, x1] = vm.contest ? [160, 80] : [100, 180];
  cups[0].x = x0;
  cups[0].y = 54;
  cups[1].x = x1;
  cups[1].y = 39;
  const mon = vm.sprite(vm.attacker);
  const monY = mon.y;
  let state = 0;
  let iteration = 0;
  let delay = 0;
  let cupAlpha = 0;
  let scale: ScaleLerp | null = null;
  let arcs: (() => { x: number; y: number } | null)[] = [];
  // The cups draw and animate from the SET_RISE_2 state on.
  const show = () => {
    for (const s of cups) {
      s.visible = state >= 4;
      s.alpha = blend(cupAlpha);
    }
  };
  show();
  task(vm, () => {
    if (cups.some((s) => !s.active)) return false;
    switch (state) {
      case 0: {
        const [sx, ex, sy, ey, frames] = TRICK_SCALES[iteration++]!;
        scale = new ScaleLerp(sx, ex, sy, ey, 100, frames);
        state++;
        break;
      }
      case 1:
        if (scale!.update()) {
          mon.scaleX = scale!.x;
          mon.scaleY = scale!.y;
          mon.y = monY + anchoredOffset(mon.height, scale!.cy);
        } else state = iteration >= TRICK_SCALES.length ? 2 : 0;
        break;
      case 2:
        if (++delay >= 1) {
          delay = 0;
          iteration = 0;
          state++;
        }
        break;
      case 3:
        if (cups[0].y <= 54 + 50) for (const s of cups) s.y += 2;
        else state++;
        break;
      case 4:
        if (cups[0].y <= 54 + 50) for (const s of cups) s.y += 2;
        else state++;
        delay++;
        cupAlpha = 16;
        if (delay === 10) cups[0].y += 16;
        if (delay === 12) cups[1].y += 16;
        break;
      case 5:
        if (++delay < 1) break;
        delay = 0;
        state++;
        break;
      case 6: {
        const [d0, d1] = TRICK_ARCS[iteration++]!;
        const [a, b] = cups;
        arcs = [parabola(a.x, b.x, a.y, b.y, 10, 40 * d0), parabola(b.x, a.x, b.y, a.y, 10, 40 * d1)];
        state++;
        break;
      }
      case 7: {
        let done = 0;
        for (const [i, s] of cups.entries()) {
          const at = arcs[i]!();
          if (!at) done++;
          else {
            s.x = at.x;
            s.y = at.y;
          }
        }
        if (done === cups.length) state = iteration === TRICK_ARCS.length ? 8 : 6;
        break;
      }
      case 8:
        // The BG weight climbs 0 → 16 by the same step: both end together.
        cupAlpha = Math.max(0, cupAlpha - 2);
        if (cupAlpha === 0) state++;
        break;
      default:
        for (const s of cups) c.remove(s);
        return false;
    }
    show();
    return true;
  });
}

/**
 * BattleAnimSpriteFunc_Taunt (script_funcs_4.c): `vars[0]` hands, the first at (128, 80) facing the attacker's way
 * (sequence 0 or 1 by the two sides), the others at the defender's spot (the sprite template's). They fade in over 15
 * frames, stay to frame 45 and fade out over 15. In a contest the hands are mirrored (affine scale −1, 1).
 */
function taunt(c: Context): void {
  const vm = c.vm;
  const count = c.args[0]!;
  if (count < 1 || count > 3) throw new Error(`battle OBJ Taunt: ${count} hands`);
  const def = vm.sprite(vm.defender);
  const hands = Array.from({ length: count }, () => {
    const s = c.spawn();
    s.x = def.baseX;
    s.y = def.baseY;
    return s;
  });
  const defender = sideOf(vm.defender);
  const attacker = sideOf(vm.attacker);
  hands[0]!.setAnimation(defender === 'player' ? (attacker === 'player' ? 0 : 1) : attacker === 'enemy' ? 1 : 0);
  hands[0]!.x = 128;
  hands[0]!.y = 80;
  let alpha = 0;
  let frames = 0;
  let state = 0;
  const show = () => {
    for (const s of hands) {
      s.alpha = blend(alpha);
      if (vm.contest) s.scaleX = -1;
    }
  };
  show();
  task(vm, () => {
    if (hands.some((s) => !s.active)) return false;
    switch (state) {
      case 0:
        if (alpha < 15) alpha++;
        if (++frames >= 45) state++;
        break;
      case 1:
        // The BG weight climbs back to 15 as the sprites' falls: both end together.
        alpha--;
        if (alpha === 0) state++;
        break;
      default:
        for (const s of hands) c.remove(s);
        return false;
    }
    show();
    return true;
  });
}

/**
 * BattleAnimSpriteFunc_Fissure (script_funcs_3.c): the crack under the defender (its X; Y 126 on the player's side with
 * sequence 1, else 32 with sequence 0), in a contest at (72, 32) with sequence 0. It goes when its sequence ends.
 */
function fissure(c: Context): void {
  const vm = c.vm;
  const s = c.spawn();
  if (vm.contest) {
    s.x = 72;
    s.y = 32;
    s.setAnimation(0);
  } else {
    const player = sideOf(vm.defender) === 'player';
    s.x = vm.sprite(vm.defender).baseX;
    s.y = player ? 126 : 32;
    s.setAnimation(player ? 1 : 0);
  }
  if (s.sequence.mode !== 'forward') throw new Error(`battle OBJ Fissure: a ${s.sequence.mode} sequence never ends`);
  const frames = s.duration;
  let t = 0;
  task(vm, () => {
    if (!s.active) return false;
    if (t++ >= frames) {
      c.remove(s);
      return false;
    }
    return true;
  });
}

const CALLBACKS: Record<string, Callback> = {
  StringShot: stringShot,
  Kinesis: (c) => {
    const b = point(c.vm, 1);
    animate(c, 3, 96, (s, t, i) => {
      s.x = b.x + (i - 1) * 24;
      s.y = b.y - 8 + Math.sin(t / 8 + i) * 6;
      s.rotation = Math.sin(t / 12 + i) / 12;
    });
  },
  Trick: trick,
  Metronome: (c) => attached(c, 0, (s, t) => {
    s.y -= 32;
    s.rotation = Math.sin(t / 5) / 10;
    s.scaleX = s.scaleY = 1 + ease(t / 40) * 0.25;
  }),
  Constrict: (c) => {
    const b = point(c.vm, 1);
    animate(c, 4, 72, (s, t, i) => {
      s.x = b.x;
      s.y = b.y - 18 + i * 12;
      s.scaleX = 1 - 0.25 * Math.sin(t / 8);
      s.scaleY = 0.5;
      s.alpha = Math.min(1, t / 8, (72 - t) / 12);
    }, 4);
  },
  Bonemerang: (c) => {
    const a = point(c.vm, 0), b = point(c.vm, 1);
    animate(c, 1, 64, (s, t) => {
      const p = t / 64, q = p < 0.5 ? p * 2 : 2 - p * 2;
      s.x = mix(a.x, b.x, q);
      s.y = mix(a.y, b.y, q) - Math.sin(p * tau) * 24;
      s.rotation = t / 8;
    });
  },
  ScaryFace: (c) => attached(c, 1, (s, t) => { s.scaleX = s.scaleY = 1 + Math.sin(t / 6) * 0.08; }),
  Foresight: (c) => {
    const b = point(c.vm, 1);
    animate(c, 1, 64, (s, t) => {
      s.x = b.x + Math.cos(t / 10) * (32 - t / 2);
      s.y = b.y + Math.sin(t / 10) * (24 - t * 0.375);
      s.scaleX = s.scaleY = 1 + ease(t / 64) * 0.5;
    });
  },
  LockOn: (c) => {
    const b = point(c.vm, 1);
    animate(c, 1, 90, (s, t) => {
      if (t === 24) s.setAnimation(1);
      s.x = b.x; s.y = b.y;
      s.scaleX = s.scaleY = t < 24 ? 2 - t / 24 : 1;
      s.rotation = t < 24 ? t / 24 : 0;
    });
  },
  Swagger: (c) => attached(c, 1, (s, t) => {
    s.x += dirX(c.vm, c.vm.defender) * 16; s.y -= 26;
    s.scaleX = s.scaleY = 0.8 + Math.abs(Math.sin(t / 6)) * 0.4;
  }),
  MeanLook: (c) => attached(c, 1),
  Torment: (c) => {
    const b = point(c.vm, 1);
    animate(c, 6, 92, (s, t, i) => {
      const angle = i * tau / 6 + t / 22;
      s.x = b.x + Math.cos(angle) * 28;
      s.y = b.y + Math.sin(angle) * 20;
      s.scaleX = s.scaleY = 0.6;
    });
  },
  BatonPass: (c) => {
    const a = point(c.vm, 0);
    animate(c, 1, 56, (s, t) => {
      s.x = a.x + t * dirX(c.vm, c.vm.attacker);
      s.y = a.y - ease(t / 56) * 56;
      s.rotation = t / 10;
      s.alpha = t > 40 ? (56 - t) / 16 : 1;
    });
  },
  Grudge: (c) => {
    const a = point(c.vm, 0);
    animate(c, 10, 60, (s, t, i) => {
      s.x = a.x + Math.sin(t / 10 + i) * 24;
      s.y = a.y + 24 - t;
      s.scaleY = 0.5 + t / 120;
      s.scaleX = s.scaleY * (i % 2 ? -1 : 1);
      s.alpha = ease(t / 60);
    }, 4);
  },
  IcicleSpear: (c) => {
    const a = point(c.vm, 0), b = point(c.vm, 1);
    const [ox = 0, oy = 0, delay = 0, frames = 32] = c.args;
    animate(c, 1, delay + frames, (s, t) => {
      const p = Math.max(0, (t - delay) / frames);
      s.x = mix(a.x, b.x + ox, p);
      s.y = mix(a.y, b.y + oy, p);
      s.rotation = Math.atan2(b.y - a.y, b.x - a.x) / tau;
      s.visible = t >= delay;
    });
  },
  FakeOut: (c) => attached(c, 1, (s, t) => { s.scaleX = 1 + ease(t / 42) * 0.3; }),
  Taunt: taunt,
  HelpingHand: (c) => {
    const a = point(c.vm, 0);
    const b = c.vm.sprite(c.vm.ally(c.vm.attacker));
    animate(c, c.args[0] || 6, 96, (s, t, i) => {
      const center = i % 2 ? b : a;
      const angle = i * tau / 6 + t / 24;
      s.x = center.x + Math.cos(angle) * (24 + ease(t / 16) * 8);
      s.y = center.y + Math.sin(angle) * 16 - 20;
      s.rotation = angle / tau + 0.25;
    });
  },
  Assist: (c) => {
    const a = point(c.vm, 0);
    animate(c, c.args[0] || 12, 48, (s, t, i) => {
      const angle = i * tau / (c.args[0] || 12);
      s.x = a.x + Math.cos(angle) * t;
      s.y = a.y + Math.sin(angle) * t * 0.65;
      s.scaleX = s.scaleY = 0.5 + ease(t / 48) * 0.5;
      s.alpha = 1 - t / 48;
    });
  },
  MetalClaw: (c) => {
    const b = point(c.vm, 1);
    animate(c, c.args[0] || 4, 68, (s, t, i) => {
      s.x = b.x + (i - 1.5) * 8 * dirX(c.vm, c.vm.attacker);
      s.y = b.y + (i - 1.5) * 6;
      s.scaleX = dirX(c.vm, c.vm.attacker);
    }, 4);
  },
  Ingrain: (c) => roots(c, 0, c.args[0] || 4, 72),
  FrenzyPlant: (c) => roots(c, 1, c.args[0] || 8, 96),
  OffsetAndAnimate: (c) => attached(c, c.args[0] ?? 0, (s) => { s.x += c.args[1] ?? 0; s.y += c.args[2] ?? 0; }),
  FollowMe: (c) => attached(c, c.args[0] ?? 0, (s, t) => {
    s.x += c.args[1] ?? 0; s.y += (c.args[2] ?? 0) - 24 - Math.abs(Math.sin(t / 8)) * 12;
  }),
  Fissure: fissure,
};

function roots(c: Context, role: number, count: number, frames: number): void {
  const b = point(c.vm, role);
  animate(c, count, frames, (s, t, i) => {
    s.x = b.x + (i - (count - 1) / 2) * 12;
    s.y = b.y + 32 - Math.min(24, t);
    s.scaleY = Math.min(1.5, t / 16);
    s.scaleX = i % 2 ? -1 : 1;
    s.alpha = Math.min(1, (frames - t) / 16);
  }, 3);
}

export const ANIM_SPRITE_FUNCS = new Set(Object.keys(CALLBACKS));
export function startSpriteCallback(vm: AnimVm, id: number, args: number[], spawn: () => ObjectSprite, remove: (s: ObjectSprite) => void): void {
  const name = SPRITE_FUNCS[id];
  if (!name) throw new Error(`battle OBJ: unknown callback ${id}`);
  const callback = CALLBACKS[name];
  if (!callback) {
    vm.deps.log.stub(`anim:sprite:${name}`, 'battle animation sprite callback not implemented: skipped');
    return;
  }
  callback({ vm, args, spawn, remove });
}
