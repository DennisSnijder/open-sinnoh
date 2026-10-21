/**
 * The animation VM on synthetic scripts and records (no ROM): command timing, branches, native functions,
 * particles, background fades, and the static walk that decides coverage.
 */
import { describe, expect, it } from 'vitest';
import type { BattleAnimData, ParticleEmitter, ParticleSystem } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { PaletteFade } from './bg.ts';
import { degToIdx, fxMul, sinIdx } from './fx.ts';
import { AnimVm, scriptUse } from './index.ts';
import { FUNCS, OP } from './script.ts';
import { SplRandom } from './spl.ts';
import { anchoredOffset, PosLerp, Shake } from './tasks.ts';

const cmd = (name: string, ...args: number[]) => {
  const op = OP[name];
  if (op === undefined) throw new Error(name);
  return [op, ...args];
};
const call = (func: string, ...args: number[]) => cmd('CallFunc', FUNCS.indexOf(func), args.length, ...args);

const emitter: ParticleEmitter = {
  // Point emission, billboards, self-maintaining (bit 14): it ends itself after its life.
  flags: 1 << 14,
  basePos: [0, 0, 0],
  count: 4096,
  radius: 0,
  length: 0,
  axis: [0, 4096, 0],
  color: 0x7fff,
  velPos: 0,
  velAxis: 0,
  scale: 4096,
  aspect: 4096,
  startDelay: 0,
  minRotation: 0,
  maxRotation: 0,
  initAngle: 0,
  emitterLife: 4,
  particleLife: 6,
  attenuation: [0, 0, 0],
  interval: 1,
  alpha: 31,
  air: 255,
  texture: 0,
  loopFrames: 0,
  dbbScale: 0,
  tileS: 0,
  tileT: 0,
  scaleDir: 0,
  faceEmitter: false,
  flipS: false,
  flipT: false,
  polygonX: 0,
  polygonY: 0,
};
const system: ParticleSystem = { id: 'test:particles/7' as Id, sourceIndex: 7, textures: 'test:ui2d/p7' as Id, textureParams: [0], emitters: [emitter] };
const pos: [number, number, number] = [0, 0, 0];
const data: BattleAnimData = {
  id: 'test:battle_anim_data' as Id,
  positions: [0, 1, 2, 3, 4, 5].map(() => Array.from({ length: 12 }, () => [pos, pos])),
  axes: [],
  backgrounds: [],
  statChange: [],
};

/** A VM on `code`: singles (battlers 0 and 1, the attacker's foe defends) or doubles (four, `empty` slots none). */
function vm(code: number[], opts: { attacker?: number; defender?: number; doubles?: boolean; empty?: number[]; effectChance?: number } = {}): AnimVm {
  const attacker = opts.attacker ?? 0;
  const mon = (b: number) => (opts.empty?.includes(b) ? null : { species: `t:${b}` as Id, form: 0, height: 0, visible: true });
  return new AnimVm(code, {
    registries: { battleAnimations: new Map(), particleSystems: new Map([[system.id, system]]), battleAnimData: new Map([[data.id, data]]) },
    attacker,
    defender: opts.defender ?? attacker ^ 1,
    battlers: (opts.doubles ? [0, 1, 2, 3] : [0, 1]).map(mon),
    doubles: opts.doubles ?? false,
    effectChance: opts.effectChance ?? 0,
    weather: null,
    seed: 1,
    log: { stub: () => {} } as never,
  });
}

function run(v: AnimVm, each?: (v: AnimVm) => void): number {
  while (!v.done) {
    v.tick();
    each?.(v);
  }
  return v.ticks;
}

describe('fixed point', () => {
  it('rounds products and converts degrees like the SDK', () => {
    expect(fxMul(3 * 4096, 2048)).toBe(6144);
    expect(fxMul(1, 2048)).toBe(1);
    expect(degToIdx(90)).toBe(16383);
    expect(sinIdx(0x4000)).toBe(4096);
  });

  it('steps the particle random stream as SPL does', () => {
    const r = new SplRandom(0);
    expect(r.next()).toBe(0x1b0cb173);
    expect(r.next()).toBe((Math.imul(0x1b0cb173, 0x5eedf715) + 0x1b0cb173) >>> 0);
  });
});

describe('helpers', () => {
  it('lerps positions in fx32 steps', () => {
    const l = new PosLerp(0, 10, 0, -5, 4);
    const xs: number[] = [];
    while (l.update()) xs.push(l.x);
    expect(xs).toEqual([2, 5, 7, 10]);
    expect(l.y).toBe(-5);
  });

  it('shakes to ± the extent and back to rest', () => {
    const s = new Shake(3, 0, 0, 1);
    const xs: number[] = [];
    while (s.update()) xs.push(s.x);
    expect(xs).toEqual([3, 0, -3, 0]);
  });

  it('keeps a scaled sprite on the ground', () => {
    expect(anchoredOffset(0, 256 << 12)).toBe(0);
    // Half size: the 80 px frame's centre drops by 20 px.
    expect(anchoredOffset(0, 128 << 12)).toBe(20);
  });
});

describe('script timing', () => {
  it('holds a Delay n for n frames plus one, and End for one frame of grace', () => {
    const base = run(vm(cmd('End')));
    expect(base).toBe(2);
    expect(run(vm([...cmd('Delay', 3), ...cmd('End')]))).toBe(base + 4 + 1);
  });

  it('loops', () => {
    const once = run(vm([...cmd('Delay', 1), ...cmd('End')]));
    const thrice = run(vm([...cmd('BeginLoop', 3), ...cmd('Delay', 1), ...cmd('EndLoop'), ...cmd('End')]));
    expect(thrice - once).toBe(2 * 3);
  });

  it('branches on the battler side and the effect chance', () => {
    // JumpIfBattlerSide attacker: +operand 2 for the player's side, operand 3 for the enemy's.
    const code = [...cmd('JumpIfBattlerSide', 0, 2, 5), ...cmd('SetVar', 0, 11), ...cmd('End'), ...cmd('SetVar', 0, 22), ...cmd('End')];
    const side = (attacker: number) => {
      const v = vm(code, { attacker });
      run(v);
      return v.vars[0];
    };
    expect(side(0)).toBe(11);
    expect(side(1)).toBe(22);
    const chance = [...cmd('JumpIfEffectChance', 1, 5), ...cmd('SetVar', 0, 1), ...cmd('End'), ...cmd('SetVar', 0, 2), ...cmd('End')];
    const v0 = vm(chance);
    run(v0);
    const v1 = vm(chance, { effectChance: 1 });
    run(v1);
    expect([v0.vars[0], v1.vars[0]]).toEqual([1, 2]);
  });

  it('walks every reachable branch to list what a script needs', () => {
    const code = [...cmd('JumpIfBattlerSide', 0, 2, 10), ...call('Shake', 1, 0, 0, 1, 1 << 3), ...cmd('End'), ...cmd('LoadParticleSystem', 0, 7), ...cmd('End')];
    const use = scriptUse(code);
    expect([...use.funcs]).toEqual(['Shake']);
    expect([...use.particles]).toEqual([7]);
    expect(use.opcodes.has('LoadParticleSystem')).toBe(true);
  });
});

describe('native functions', () => {
  it('shakes the defender and puts it back, and the script waits for it', () => {
    const v = vm([...call('Shake', 2, 0, 0, 2, (1 << 3) | (1 << 8)), ...cmd('WaitForAnimTasks'), ...cmd('End')]);
    const xs = new Set<number>();
    run(v, (x) => xs.add(x.sprite(1).x));
    expect([...xs].sort((a, b) => a - b)).toEqual([190, 192, 194]);
    expect(v.sprite(1).x).toBe(192);
    expect(v.view().battlers.find((b) => b.battler === 1)?.dx ?? 0).toBe(0);
  });

  it('hides a battler', () => {
    const v = vm([...call('HideBattler', 1 << 1, 1), ...cmd('End')]);
    run(v);
    expect(v.sprite(0).hide).toBe(true);
  });
});

describe('doubles (battler ids and types)', () => {
  it('places each battler at its doubles slot and lists the ones standing by id', () => {
    const v = vm([...cmd('End')], { doubles: true, empty: [3] });
    expect(v.sprites.map((s) => [s.baseX, s.baseY])).toEqual([
      [40, 112],
      [216, 50],
      [80, 120],
      [176, 42],
    ]);
    expect([0, 1, 2, 3].map((b) => v.typeOf(b))).toEqual([2, 3, 4, 5]);
    expect(v.view().battlers.map((b) => b.battler)).toEqual([0, 1, 2]);
    // Singles keep the solo types and places.
    const s = vm([...cmd('End')]);
    expect(s.sprites.map((x) => [x.baseX, x.baseY, s.typeOf(x.battler)])).toEqual([
      [64, 112, 0],
      [192, 48, 1],
    ]);
  });

  it('shakes the defender and its partner, and the attacker beside its ally is friendly fire', () => {
    const v = vm([...call('Shake', 2, 0, 0, 2, (1 << 3) | (1 << 4) | (1 << 8)), ...cmd('WaitForAnimTasks'), ...cmd('End')], { doubles: true, attacker: 2, defender: 1 });
    const moved = new Set<number>();
    run(v, (x) => x.sprites.forEach((s) => s.x !== s.baseX && moved.add(s.battler)));
    expect([...moved].sort()).toEqual([1, 3]);
    const ff = [...cmd('JumpIfFriendlyFire', 5), ...cmd('SetVar', 0, 1), ...cmd('End'), ...cmd('SetVar', 0, 2), ...cmd('End')];
    const ally = vm(ff, { doubles: true, attacker: 0, defender: 2 });
    run(ally);
    const foe = vm(ff, { doubles: true, attacker: 0, defender: 3 });
    run(foe);
    expect([ally.vars[0], foe.vars[0]]).toEqual([2, 1]);
  });

  it('picks the particle resource by the attacker and defender types (GetParticleResIdxForMove / ForFriendlyFire)', () => {
    // A resource the packs lack fails loudly with its index: the pick is the failure's number.
    const pick = (attacker: number, defender: number, friendly: boolean) => {
      const res = friendly ? [80, 81, 82, 83] : [90, 91, 92, 93, 94, 95];
      const code = [...cmd('LoadParticleSystem', 0, 7), ...cmd('Delay', 2), ...(friendly ? cmd('CreateEmitterForFriendlyFire', 0, ...res, 0) : cmd('CreateEmitterForMove', 0, ...res, 0)), ...cmd('End')];
      try {
        run(vm(code, { doubles: true, attacker, defender }));
      } catch (e) {
        return Number(/resource (\d+)|emitter (\d+)/.exec(String(e))?.slice(1).find(Boolean));
      }
      return -1;
    };
    expect([pick(0, 1, false), pick(0, 3, false), pick(1, 0, false), pick(1, 2, false), pick(2, 1, false), pick(2, 3, false), pick(3, 0, false), pick(3, 2, false)]).toEqual([92, 90, 95, 93, 90, 91, 93, 94]);
    expect([pick(0, 2, true), pick(2, 0, true), pick(1, 3, true), pick(3, 1, true)]).toEqual([80, 81, 81, 80]);
  });

  it('names battlers by role: partners and second slots exist only in doubles', () => {
    const d = vm([...cmd('End')], { doubles: true, attacker: 2, defender: 1 });
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((r) => d.roleBattler(r))).toEqual([2, 1, 0, 3, 0, 1, 2, 3]);
    const s = vm([...cmd('End')], { attacker: 1 });
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((r) => s.roleBattler(r))).toEqual([1, 0, 1, 0, 0, 1, 0, 1]);
  });

  it('walks only the arm a friendly-fire move takes', () => {
    const code = [...cmd('JumpIfFriendlyFire', 10), ...call('Shake', 1, 0, 0, 1, 1 << 3), ...cmd('End'), ...cmd('LoadParticleSystem', 0, 7), ...cmd('End')];
    expect([...scriptUse(code).funcs]).toEqual(['Shake']);
    expect([...scriptUse(code, true).particles]).toEqual([7]);
    expect([...scriptUse(code, true).funcs]).toEqual([]);
  });
});

describe('particles', () => {
  it('emits from a loaded system until its emitter ends, and the End waits for it', () => {
    const v = vm([...cmd('LoadParticleSystem', 0, 7), ...cmd('CreateEmitter', 0, 0, 0), ...cmd('WaitForAllEmitters'), ...cmd('UnloadParticleSystem', 0), ...cmd('End')]);
    let most = 0;
    const ticks = run(v, (x) => (most = Math.max(most, x.view().particles.length)));
    expect(most).toBeGreaterThan(0);
    expect(most).toBeLessThanOrEqual(5);
    // Loaded (2 + 1 frames), emitter life 4 + particle life 6, then End.
    expect(ticks).toBeGreaterThan(10);
    expect(ticks).toBeLessThan(25);
    expect(v.view().particles).toEqual([]);
  });

  it('is deterministic for a seed', () => {
    const code = [...cmd('LoadParticleSystem', 0, 7), ...cmd('CreateEmitter', 0, 0, 0), ...cmd('WaitForAllEmitters'), ...cmd('End')];
    const frames = () => {
      const out: string[] = [];
      run(vm(code), (x) => out.push(JSON.stringify(x.view().particles)));
      return out;
    };
    expect(frames()).toEqual(frames());
  });

  it('fails loudly on a particle file the packs lack', () => {
    expect(() => run(vm([...cmd('LoadParticleSystem', 0, 99), ...cmd('End')]))).toThrow(/no particle system 99/);
  });
});

describe('palette fades', () => {
  it('steps by 2 every wait + 1 frames, and ignores a second fade while one runs', () => {
    const f = new PaletteFade();
    f.start('base', 1, 0, 6, 0x7fff);
    const amounts = [f.applied.base.amount];
    f.start('effect', 0, 0, 16, 0);
    while (f.active) {
      f.tick();
      amounts.push(f.applied.base.amount);
    }
    // The start blends the first value at once; the first step lands on the next frame (its wait counter starts full).
    expect(amounts).toEqual([0, 2, 2, 4, 4, 6]);
    expect(f.applied.effect.amount).toBe(0);
  });
});
