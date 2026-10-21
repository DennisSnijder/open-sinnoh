/** Original scene choreography over the ROM's cell animations. These are timed OAM tasks, not hits. */
import { SPRITE_FUNCS } from './script.ts';
import type { ObjectSprite } from './objects.ts';
import { dirX, task } from './tasks.ts';
import type { AnimVm } from './vm.ts';

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

const CALLBACKS: Record<string, Callback> = {
  StringShot: (c) => {
    const a = point(c.vm, 0), b = point(c.vm, 1);
    animate(c, c.args[0] || 3, 48, (s, t, i) => {
      const p = Math.min(1, t / 20);
      s.x = mix(a.x, b.x, p);
      s.y = mix(a.y, b.y + (i - 1) * 10, p) - ease(p) * 16;
      s.scaleX = 0.5 + p * 0.5;
      s.scaleY = t < 20 ? 0.5 : 0.7 + Math.sin(t / 3) * 0.15;
      s.alpha = t > 36 ? (48 - t) / 12 : 1;
    }, 6);
  },
  Kinesis: (c) => {
    const b = point(c.vm, 1);
    animate(c, 3, 96, (s, t, i) => {
      s.x = b.x + (i - 1) * 24;
      s.y = b.y - 8 + Math.sin(t / 8 + i) * 6;
      s.rotation = Math.sin(t / 12 + i) / 12;
    });
  },
  Trick: (c) => {
    const a = point(c.vm, 0), b = point(c.vm, 1);
    animate(c, c.args[0] || 2, 88, (s, t, i) => {
      const p = Math.max(0, Math.min(1, (t - 20) / 44));
      const q = i % 2 ? 1 - p : p;
      s.x = mix(a.x, b.x, q);
      s.y = mix(a.y, b.y, q) - ease(p) * 32 - 20;
      s.rotation = Math.sin(p * tau) / 12;
    });
  },
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
    s.x += dirX(c.vm.defender) * 16; s.y -= 26;
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
      s.x = a.x + t * dirX(c.vm.attacker);
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
  Taunt: (c) => attached(c, c.args[0] ?? 1, (s, t) => {
    s.y -= 24;
    s.x += Math.sin(t / 5) * 8;
    s.rotation = Math.sin(t / 5) / 16;
  }),
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
      s.x = b.x + (i - 1.5) * 8 * dirX(c.vm.attacker);
      s.y = b.y + (i - 1.5) * 6;
      s.scaleX = dirX(c.vm.attacker);
    }, 4);
  },
  Ingrain: (c) => roots(c, 0, c.args[0] || 4, 72),
  FrenzyPlant: (c) => roots(c, 1, c.args[0] || 8, 96),
  OffsetAndAnimate: (c) => attached(c, c.args[0] ?? 0, (s) => { s.x += c.args[1] ?? 0; s.y += c.args[2] ?? 0; }),
  FollowMe: (c) => attached(c, c.args[0] ?? 0, (s, t) => {
    s.x += c.args[1] ?? 0; s.y += (c.args[2] ?? 0) - 24 - Math.abs(Math.sin(t / 8)) * 12;
  }),
  Fissure: (c) => {
    const b = point(c.vm, 1);
    animate(c, 1, 114, (s, t) => {
      s.x = b.x; s.y = b.y + 32;
      s.scaleX = 1 + ease(t / 114) * 0.25;
    });
  },
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
