/**
 * The last native functions and commands on synthetic scripts (no ROM): BG2 pictures (LoadPokemonSpriteIntoBg with
 * Acid Armor, Sketch, Spite, Extrasensory), the picture swap (StartBattlerSlideIn/Out with Transform's mosaic and Role
 * Play), Night Shade's shadow and the waves loaded into BG2.
 */
import { describe, expect, it } from 'vitest';
import type { AnimView, BattleAnimData } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { AnimVm } from './index.ts';
import { FUNCS, OP } from './script.ts';

const cmd = (name: string, ...args: number[]) => {
  const op = OP[name];
  if (op === undefined) throw new Error(name);
  return [op, ...args];
};
const call = (func: string, ...args: number[]) => cmd('CallFunc', FUNCS.indexOf(func), args.length, ...args);
const u32 = (v: number) => v >>> 0;

const pos: [number, number, number] = [0, 0, 0];
const data: BattleAnimData = {
  id: 'test:battle_anim_data' as Id,
  positions: [0, 1, 2, 3, 4, 5, 6, 7].map(() => Array.from({ length: 12 }, () => [pos, pos])),
  axes: [],
  backgrounds: Array.from({ length: 58 }, (_, i) => `test:ui2d/bg${i}` as Id),
  statChange: [],
};

/** Singles: battler 0 (height 10) on the player's side, battler 1 (height 4) on the enemy's. */
function vm(code: number[], opts: { attacker?: number; contest?: boolean } = {}): AnimVm {
  const attacker = opts.attacker ?? 0;
  return new AnimVm(code, {
    registries: { battleAnimations: new Map(), particleSystems: new Map(), battleAnimData: new Map([[data.id, data]]) },
    attacker,
    defender: attacker ^ 1,
    battlers: [0, 1].map((b) => ({ species: `t:${b}` as Id, form: 0, height: b ? 4 : 10, visible: !opts.contest || b === 0 })),
    doubles: false,
    effectChance: 0,
    weather: null,
    seed: 1,
    log: { stub: () => {} } as never,
    ...(opts.contest ? { contest: true } : {}),
  });
}

/** Runs to the end, returning each tick's view. */
function run(v: AnimVm): AnimView[] {
  const views: AnimView[] = [];
  while (!v.done) {
    v.tick();
    views.push(v.view());
  }
  return views;
}

const battler = (view: AnimView, b: number) => view.battlers.find((x) => x.battler === b)!;

describe('BG2 pictures', () => {
  it('LoadPokemonSpriteIntoBg puts the picture over its battler; RemovePokemonSpriteFromBg clears it', () => {
    const v = vm([...cmd('LoadPokemonSpriteIntoBg', 1, 0), ...cmd('Delay', 1), ...cmd('RemovePokemonSpriteFromBg', 0), ...cmd('End')]);
    v.tick();
    // The enemy's solo spot (192, 48), its picture 4 px lower: the frame's corner at (152, 12).
    expect(v.view().bgMon).toMatchObject({ picture: { battler: 1, species: 't:1', back: false }, x: -152, y: -12, lines: null, alpha: 1, front: false });
    const views = run(v);
    expect(views.at(-1)!.bgMon).toBeUndefined();
  });

  it('Acid Armor melts the hidden attacker line by line, fades it out and back, and shows the attacker again', () => {
    const v = vm([...cmd('LoadPokemonSpriteIntoBg', 0, 0), ...call('AcidArmor'), ...cmd('WaitForAnimTasks'), ...cmd('RemovePokemonSpriteFromBg', 0), ...cmd('End')]);
    const views = run(v);
    const during = views.filter((x) => x.bgMon);
    expect(battler(during[0]!, 0).hidden).toBe(true);
    // The player's sprite: corner (24, 82); lines 74–170 move, others keep the layer's offset.
    const lines = during[5]!.bgMon!.lines!;
    expect(lines[20]).toEqual([-24, -82]);
    expect(lines.slice(75, 170).some(([x, y]) => x !== -24 || y !== -82)).toBe(true);
    const alphas = during.map((x) => x.bgMon!.alpha);
    expect(Math.min(...alphas)).toBe(0);
    expect(alphas.at(-1)).toBe(1);
    expect(during.some((x) => x.bgMon!.lines === null && x.bgMon!.x === -24 && x.bgMon!.y === -82)).toBe(true);
    expect(battler(views.at(-1)!, 0).hidden).toBe(false);
    expect(views.at(-1)!.bgMon).toBeUndefined();
  });

  it('Sketch draws the defender in 2 px lines from its bottom while window 0 uncovers its picture', () => {
    const v = vm([...cmd('LoadPokemonSpriteIntoBg', 1, 0), ...call('Sketch', 0), ...cmd('WaitForAnimTasks'), ...cmd('RemovePokemonSpriteFromBg', 0), ...cmd('End')]);
    const views = run(v);
    const first = views.find((x) => battler(x, 1).partial)!;
    expect(battler(first, 1)).toMatchObject({ alpha: 8 / 31, partial: { x: 0, y: 76, w: 79, h: 2 } });
    const wins = views.flatMap((x) => (x.bgMon?.window ? [x.bgMon.window] : []));
    // The defender's frame: x 152–232, bottom at 92; the window opens up (and down) from there by 1 px a step.
    expect(wins[0]).toEqual({ x0: 152, y0: 92, x1: 232, y1: 92 });
    expect(wins.at(-1)).toEqual({ x0: 152, y0: 92 - 78, x1: 232, y1: 92 + 78 });
    const second = views.find((x) => battler(x, 1).partial && battler(x, 1).partial!.x === 1)!;
    expect(battler(second, 1).partial).toEqual({ x: 1, y: 74, w: 79, h: 2 });
    const end = battler(views.at(-1)!, 1);
    expect(end.alpha).toBe(1);
    expect(end.partial).toBeUndefined();
  });

  it('Spite raises the defender picture over its sprite, fades it in under a sine scroll and out', () => {
    const v = vm([...cmd('InitPokemonSpriteManager'), ...cmd('AddPokemonSprite', 1, 0, 0, 0), ...call('Spite'), ...cmd('LoadPokemonSpriteIntoBg', 1, 0), ...cmd('WaitForAnimTasks'), ...cmd('RemovePokemonSpriteFromBg', 0), ...cmd('End')]);
    const views = run(v).filter((x) => x.bgMon);
    expect(views.every((x) => x.bgMon!.front)).toBe(true);
    expect(views.some((x) => x.bgMon!.lines)).toBe(true);
    const alphas = views.map((x) => x.bgMon!.alpha);
    // 0 → 8 in fx32 steps of 8/24 truncated: the lerp stops at 7.
    expect(Math.max(...alphas)).toBe(7 / 16);
    expect(alphas.at(-1)).toBe(0);
    // The copy stays hidden in singles: the raised BG2 covers the sprite.
    expect(views.every((x) => x.sprites.every((s) => s.kind !== 'pokemon'))).toBe(true);
  });

  it('Extrasensory bends the hidden defender picture three times and shows the defender again', () => {
    const v = vm([...cmd('LoadPokemonSpriteIntoBg', 1, 0), ...call('Extrasensory'), ...cmd('WaitForAnimTasks'), ...cmd('RemovePokemonSpriteFromBg', 0), ...cmd('End')]);
    const views = run(v);
    const bent = views.filter((x) => x.bgMon?.lines);
    expect(bent.length).toBeGreaterThan(48);
    expect(battler(bent[0]!, 1).hidden).toBe(true);
    // Lines 4–100 (the frame's 12–92 and 8 more each way) shift; the shear grows away from the centre (line 52).
    const lines = bent[3]!.bgMon!.lines!;
    expect(lines[150]).toEqual([-152, -12]);
    expect(new Set(lines.slice(5, 100).map(([x]) => x)).size).toBeGreaterThan(10);
    expect(battler(views.at(-1)!, 1).hidden).toBe(false);
  });
});

describe('the picture swap', () => {
  it('Transform: the attacker pixelates out, takes the defender picture in its own face and pixelates in', () => {
    const v = vm([
      ...cmd('InitPokemonSpriteManager'),
      ...call('HideBattler', 2, 1),
      ...cmd('AddPokemonSprite', 0, 0, 0, 0),
      ...call('PixelatePokemonSprite', 0, 1, 0, 0),
      ...cmd('WaitForAnimTasks'),
      ...cmd('RemovePokemonSprite', 0),
      ...cmd('StartBattlerSlideIn', 0),
      ...cmd('AddPokemonSprite', 0, 0, 1, 1),
      ...call('PixelatePokemonSprite', 1, u32(-1), 15, 15),
      ...cmd('Delay', 12),
      ...call('HideBattler', 2, 0),
      ...cmd('Delay', 1),
      ...cmd('RemovePokemonSprite', 1),
      ...cmd('End'),
    ]);
    const views = run(v);
    const sizes = views.flatMap((x) => x.sprites.filter((s) => s.kind === 'pokemon').map((s) => s.mosaic ?? 1));
    expect(sizes.slice(0, 3)).toEqual([3, 4, 5]);
    expect(Math.max(...sizes)).toBe(16);
    const swapped = views.flatMap((x) => x.sprites.filter((s) => s.picture));
    expect(swapped[0]!.picture).toEqual({ battler: 1, species: 't:1', form: 0, back: true });
    expect(swapped.at(-1)!.mosaic ?? 1).toBeLessThan(5);
    // The DS keeps the swapped picture after the animation: the attacker shows the defender's back.
    expect(battler(views.at(-1)!, 0)).toMatchObject({ hidden: false, picture: { battler: 1, back: true } });
  });

  it('StartBattlerSlideIn from the enemy side shows the defender front; StartBattlerSlideOut restores the picture', () => {
    const v = vm([...cmd('StartBattlerSlideIn', 0), ...cmd('Delay', 1), ...cmd('StartBattlerSlideOut', 0), ...cmd('End')], { attacker: 1 });
    v.tick();
    expect(battler(v.view(), 1).picture).toEqual({ battler: 0, species: 't:0', form: 0, back: false });
    const views = run(v);
    expect(battler(views.at(-1)!, 1).picture).toBeUndefined();
  });

  it('Role Play: the swapped copy stands 32 px toward the attacker side, flashes white and flattens out', () => {
    const v = vm([
      ...cmd('InitPokemonSpriteManager'),
      ...cmd('AddPokemonSprite', 0, 0, 1, 1),
      ...cmd('AddPokemonSprite', 1, 0, 2, 2),
      ...cmd('Delay', 1),
      ...call('HideBattler', 2, 1),
      ...cmd('StartBattlerSlideIn', 0),
      ...cmd('AddPokemonSprite', 0, 0, 0, 0),
      ...call('RolePlay', 0),
      ...cmd('Delay', 15),
      ...cmd('StartBattlerSlideOut', 1),
      ...call('HideBattler', 2, 0),
      ...cmd('WaitForAnimTasks'),
      ...cmd('End'),
    ]);
    const views = run(v);
    const copies = views.map((x) => x.sprites.find((s) => s.picture));
    const first = copies.find((c) => c)!;
    expect(first).toMatchObject({ battler: 0, x: -32, y: 0, scaleX: 1, scaleY: 1, picture: { battler: 1, back: true } });
    const flat = copies.filter((c) => c && c.scaleY < 1).map((c) => [c!.scaleX, c!.scaleY]);
    expect(flat.map(([, y]) => Math.round(y! * 10))).toEqual([8, 6, 4, 2]);
    expect(Math.max(...copies.map((c) => c?.fade?.amount ?? 0))).toBe(15);
    expect(copies.at(-1)).toBeUndefined();
    const end = views.at(-1)!;
    expect(battler(end, 0)).toMatchObject({ hidden: false });
    expect(battler(end, 0).picture).toBeUndefined();
    // The defender's copy's white fades back.
    expect(end.sprites.find((s) => s.battler === 1)?.fade ?? null).toBeNull();
  });
});

describe('Night Shade and the waves', () => {
  it('Night Shade: a translucent 140 % shadow fades in, holds, shrinks to 100 % and goes; the defender darkens and shakes', () => {
    const v = vm([
      ...cmd('InitPokemonSpriteManager'),
      ...cmd('AddPokemonSprite', 0, 0, 0, 0),
      ...call('NightShadeAttacker'),
      ...cmd('Delay', 16),
      ...call('NightShadeDefender'),
      ...cmd('WaitForAnimTasks'),
      ...cmd('RemovePokemonSprite', 0),
      ...cmd('End'),
    ]);
    const views = run(v);
    const shadow = views.map((x) => x.sprites.find((s) => s.kind === 'pokemon'));
    expect(shadow[0]!.scaleX).toBeCloseTo(1.4, 2);
    expect(shadow[0]!.alpha).toBe(1 / 8);
    expect(Math.max(...shadow.map((s) => s?.alpha ?? 0))).toBe(1);
    expect(shadow.filter((s) => s).at(-1)!.scaleX).toBe(1);
    expect(shadow.at(-1)).toBeUndefined();
    const defender = views.map((x) => battler(x, 1));
    expect(Math.max(...defender.map((d) => d.fade?.amount ?? 0))).toBe(16);
    expect(new Set(defender.map((d) => d.dx)).size).toBeGreaterThan(2);
    expect(defender.at(-1)).toMatchObject({ dx: 0, dy: 0, fade: null });
  });

  it('Muddy Water: the wave loads into BG2, rises (6 px a frame) while it blends in, and blends out once past 512', () => {
    const v = vm([...call('MuddyWater', 49, 0, 256, u32(-6), 6, 1, 16, 45), ...cmd('WaitForAnimTasks'), ...cmd('End')]);
    const views = run(v);
    const layers = views.flatMap((x) => (x.bg.custom ? [x.bg.custom] : []));
    expect(layers[0]).toMatchObject({ sheet: 'test:ui2d/bg49', cell: 0, dx: -6, dy: 256 + 85 + 6, alpha: 2 / 16 });
    expect(Math.max(...layers.map((l) => l.alpha))).toBe(1);
    expect(layers.some((l) => l.dy >= 512)).toBe(true);
    expect(views.at(-1)!.bg.custom).toBeUndefined();
  });

  it('ScrollCustomBg from the enemy side scrolls the mirrored screen the other way', () => {
    const v = vm([...call('ScrollCustomBg', 48, 0, 256, u32(-6), 6, 1, 20, 45), ...cmd('WaitForAnimTasks'), ...cmd('End')], { attacker: 1 });
    const layers = run(v).flatMap((x) => (x.bg.custom ? [x.bg.custom] : []));
    expect(layers[0]).toMatchObject({ cell: 1, dx: 6, dy: -256 - 85 - 6 });
    expect(Math.max(...layers.map((l) => l.alpha))).toBe(1);
    expect(Math.min(...layers.map((l) => l.dy))).toBeLessThanOrEqual(-412);
  });
});
