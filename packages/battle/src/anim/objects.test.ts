import { describe, expect, it } from 'vitest';
import { animSpriteSheetId, type BattleAnimData, type Ui2dAnimation, type Ui2dSheet } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { AnimVm, animSupport } from './index.ts';
import { cellFrame } from './objects.ts';
import { FUNCS, OP, SPRITE_FUNCS, scriptUse } from './script.ts';

const command = (name: string, ...args: number[]) => [OP[name]!, ...args];
const call = (name: string, ...args: number[]) => command('CallFunc', FUNCS.indexOf(name), args.length, ...args);
const resource = { chars: 1, palette: 2, cells: 3, animation: 4 };
const sheet: Ui2dSheet = {
  id: animSpriteSheetId(resource), atlas: asId('test:original.png'),
  cells: [0, 1].map((i) => ({ x: i * 8, y: 0, w: 8, h: 8, ox: 3, oy: 5 })),
  animations: [{ mode: 'forward', loopStart: 0, frames: [{ cell: 0, ticks: 8 }, { cell: 1, ticks: 12, dx: 2, dy: -3, rotation: 0.25, scaleX: 2, scaleY: 0.5 }] }, { mode: 'loop', loopStart: 0, frames: [{ cell: 1, ticks: 2 }] }],
};
const data: BattleAnimData = { id: asId('test:anim'), positions: [], axes: [], backgrounds: [], statChange: [] };
const reg = { battleAnimations: new Map(), particleSystems: new Map(), battleAnimData: new Map([[data.id, data]]), ui2d: new Map([[sheet.id, sheet]]) };
const setup = [
  ...command('InitSpriteManager', 0, 16, 1, 1, 1, 1, 0, 0),
  ...command('LoadCharResObj', 0, 1), ...command('LoadPlttRes', 0, 2, 1), ...command('LoadCellResObj', 0, 3), ...command('LoadAnimResObj', 0, 4),
];
const add = (name: string, ...args: number[]) => command('AddSpriteWithFunc', 0, SPRITE_FUNCS.indexOf(name), 1, 2, 3, 4, 0, 0, args.length, ...args);
function vm(code: number[], attacker = 0): AnimVm {
  return new AnimVm(code, { registries: reg, attacker, defender: attacker ^ 1, battlers: [0, 1].map((i) => ({ species: asId(`test:mon${i}`), form: 0, height: 0, visible: true })), doubles: false, effectChance: 0, weather: null, seed: 17, log: { stub: (key: string) => { throw new Error(key); } } as never });
}
const run = (v: AnimVm) => { while (!v.done) v.tick(); };

describe('generic animation sprites', () => {
  it('plays forward, looping and ping-pong NANR frames, respecting loopStart and frame durations', () => {
    const frames = [0, 1, 2].map((cell) => ({ cell, ticks: 2 }));
    const at = (mode: Ui2dAnimation['mode'], tick: number) => cellFrame({ mode, loopStart: 1, frames }, tick).cell;
    expect([0, 1, 2, 5, 6, 20].map((t) => at('forward', t))).toEqual([0, 0, 1, 2, 2, 2]);
    expect([6, 8, 10].map((t) => at('loop', t))).toEqual([1, 2, 1]);
    expect([6, 8, 10, 99].map((t) => at('pingpong', t))).toEqual([2, 1, 1, 1]);
    expect([6, 8, 10, 12, 14].map((t) => at('pingpong-loop', t))).toEqual([2, 1, 1, 2, 2]);
    expect(() => cellFrame({ mode: 'loop', loopStart: 0, frames: [{ cell: 0, ticks: 0 }] }, 0)).toThrow('nonpositive');
  });

  it('resolves loaded resources to a sheet, publishes NANR SRT, and waits until the sprite task releases it', () => {
    const code = [...setup, ...add('OffsetAndAnimate', 1, 24, -8), ...command('WaitForAnimTasks'), ...command('FreeSpriteManager', 0), ...command('End')];
    const v = vm(code);
    const seen = [];
    while (!v.done) {
      v.tick();
      seen.push(...v.view().sprites);
    }
    expect(seen[0]).toMatchObject({ kind: 'cell', sheet: sheet.id, cell: 0, x: 216, y: 40 });
    expect(seen.find((s) => s.cell === 1)).toMatchObject({ x: 218, y: 37, rotation: 0.25, scaleX: 2, scaleY: 0.5 });
    expect(v.ticks).toBeGreaterThan(20);
    expect(v.objects.size).toBe(0);
    expect(v.activeAnimTasks).toBe(0);
    expect(scriptUse(code).spriteResources.get('1/2/3/4')).toEqual(resource);
    expect(animSupport({ id: asId('test:move'), sourceIndex: 1, code }, reg)).toEqual([]);
    expect(animSupport({ id: asId('test:move'), sourceIndex: 1, code }, { ...reg, ui2d: new Map() })).toEqual([`sprite/${sheet.id}`]);
  });

  it('uses battler roles from either side for cell placement', () => {
    for (const attacker of [0, 1]) {
      const v = vm([...setup, ...add('OffsetAndAnimate', 0, 12, -4), ...command('WaitForAnimTasks'), ...command('End')], attacker);
      v.tick();
      const mon = v.sprite(attacker);
      expect(v.view().sprites[0]).toMatchObject({ x: mon.baseX + 12, y: mon.baseY - 4 });
      run(v);
    }
  });

  it('freeing a manager cancels owned sprite tasks and releases its resources before reinitializing it', () => {
    const v = vm([...setup, ...add('Constrict'), ...command('Delay', 2), ...command('FreeSpriteManager', 0), ...command('WaitForAnimTasks'), ...setup, ...add('Metronome'), ...command('WaitForAnimTasks'), ...command('FreeSpriteManager', 0), ...command('End')]);
    run(v);
    expect(v.objects.size).toBe(0);
    expect(v.activeAnimTasks).toBe(0);
    expect(v.ticks).toBeLessThan(60);
    const unloaded = vm([...command('InitSpriteManager', 0, 1, 1, 1, 1, 1, 0, 0), ...add('Metronome'), ...command('End')]);
    expect(() => unloaded.tick()).toThrow('was not loaded');
  });

  it('keeps unimplemented callbacks out of preflight', () => {
    const code = [...setup, ...add('SpriteExample'), ...command('End')];
    expect(animSupport({ id: asId('test:move'), sourceIndex: 1, code }, reg)).toContain('SpriteFunc_SpriteExample');
  });
});

describe('single-command move tasks', () => {
  it('sinks and restores a partially drawn battler behind its baseline', () => {
    const v = vm([...call('BattlerPartialDraw', 2, 0, 0, 8, 1), ...command('WaitForAnimTasks'), ...call('BattlerPartialDraw', 2, 0, 0, -8, 1), ...command('WaitForAnimTasks'), ...command('End')]);
    const crops: number[] = [];
    while (!v.done) {
      v.tick();
      const b = v.view().battlers[0]!;
      crops.push(b.cropBottom ?? 0);
      expect(b.dy).toBe(b.cropBottom ?? 0);
    }
    expect(Math.max(...crops)).toBe(80);
    expect(v.view().battlers[0]).toMatchObject({ dy: 0, hidden: false });
  });

  it('shows and removes the Mimic copy, restores camouflage, and opens the Fake Out curtain again', () => {
    for (const func of ['Mimic', 'Camouflage', 'FaintAttack', 'Snatch', 'FakeOutCurtain']) {
      const v = vm([...call(func, ...(func === 'Snatch' ? [2] : [])), ...command('WaitForAnimTasks'), ...command('End')]);
      let changed = false;
      while (!v.done) {
        v.tick();
        const view = v.view();
        changed ||= !!view.curtain?.top || view.sprites.length > 0 || view.battlers.some((b) => b.dx !== 0 || b.alpha !== 1 || b.fade !== null);
      }
      expect(changed, func).toBe(true);
      expect(v.view().sprites).toEqual([]);
      expect(v.view().curtain).toBeUndefined();
      expect(v.view().battlers.every((b) => b.dx === 0 && b.dy === 0 && b.alpha === 1 && b.fade === null), func).toBe(true);
    }
  });
});

describe('sprite callbacks with a contest branch', () => {
  const contestVm = (code: number[]) => new AnimVm(code, { registries: reg, attacker: 0, defender: 1, battlers: [0, 1].map((i) => ({ species: asId(`test:mon${i}`), form: 0, height: 0, visible: i === 0 })), doubles: false, effectChance: 0, weather: null, seed: 17, contest: true, log: { stub: (key: string) => { throw new Error(key); } } as never });
  type Frame = ReturnType<AnimVm['view']>['sprites'];
  /** Every frame's OBJ views; the run frees all its sprites. */
  const frames = (v: AnimVm) => {
    const seen: Frame[] = [];
    while (!v.done) {
      v.tick();
      seen.push(v.view().sprites);
    }
    expect(v.objects.size).toBe(0);
    return seen;
  };
  const script = (name: string, ...args: number[]) => [...setup, ...add(name, ...args), ...command('WaitForAnimTasks'), ...command('FreeSpriteManager', 0), ...command('End')];

  it('Fissure: the crack under the defender, at (72, 32) in a contest, until its sequence ends', () => {
    expect(frames(vm(script('Fissure'))).find((s) => s.length)![0]).toMatchObject({ x: 192, y: 32 });
    const contest = frames(contestVm(script('Fissure'))).filter((s) => s.length);
    expect(contest[0]![0]).toMatchObject({ x: 72, y: 32 });
    expect(contest.length).toBeGreaterThanOrEqual(20);
  });

  it('Taunt: the hand at (128, 80) fading in and out, mirrored in a contest', () => {
    for (const [v, scaleX] of [[vm(script('Taunt', 1)), 1], [contestVm(script('Taunt', 1)), -1]] as const) {
      const seen = frames(v).filter((s) => s.length).map((s) => s[0]!);
      expect(seen[0]).toMatchObject({ x: 128, y: 80, scaleX });
      expect(Math.max(...seen.map((s) => s.alpha))).toBeCloseTo(15 / 16);
      expect(seen.length).toBeGreaterThan(55);
    }
  });

  it('Trick: the attacker squashes, then two cups swap places, from the contest spots in a contest', () => {
    for (const [v, xs] of [[vm(script('Trick', 2)), [100, 180]], [contestVm(script('Trick', 2)), [160, 80]]] as const) {
      let squashed = false;
      const seen: Frame[] = [];
      while (!v.done) {
        v.tick();
        squashed ||= v.sprite(0).scaleY < 256;
        seen.push(v.view().sprites);
      }
      expect(squashed).toBe(true);
      const shown = seen.filter((s) => s.length);
      expect(shown[0]!.map((s) => s.x)).toEqual(xs);
      // Five switches: an odd count leaves the cups swapped (the fixture's last frame is 2 px right).
      expect(shown.at(-1)!.map((s) => s.x)).toEqual([xs[1] + 2, xs[0] + 2]);
      expect(v.objects.size).toBe(0);
    }
  });

  it('StringShot: three threads over the defender’s spot (the contestant’s in a contest), squeezed and faded', () => {
    for (const [v, x, y] of [[vm(script('StringShot', 3)), 192, 48], [contestVm(script('StringShot', 3)), 80, 42]] as const) {
      const seen = frames(v);
      const all = seen.find((s) => s.length === 3)!;
      expect(all.map((s) => [s.x, s.y])).toEqual([[x, y + 32], [x, y + 28], [x, y + 24]]);
      // 60 % wide at the end, times the fixture's last frame's 2.
      const last = seen.filter((s) => s.length).at(-1)!;
      for (const s of last) expect(s.scaleX).toBeCloseTo(1.2, 1);
      expect(last[0]!.alpha).toBeLessThan(0.1);
    }
  });
});
