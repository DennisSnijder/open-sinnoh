/**
 * The move animations on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): every script decodes, the
 * coverage holds, and every script the VM supports runs to its end from both sides without an error.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { animSpriteSheetId, type BattleAnimation, type Registries } from '@opensinnoh/contracts';
import { loadPacks, type Id } from '@opensinnoh/core';
import { romSlice } from '../../../../tests/rom.ts';
import { ANIM_FUNCS, ANIM_OPCODES, animCoverage, animSupport, AnimVm, scriptUse } from './index.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('battle animations (OPENSINNOH_NDS_ROM)', () => {
  let reg: Pick<Registries, 'battleAnimations' | 'particleSystems' | 'battleAnimData' | 'ui2d'>;
  let anims: BattleAnimation[];
  beforeAll(() => {
    const loaded = loadPacks([romSlice().pack], '0.1.0', () => {});
    const r = loaded.registries as unknown as Registries;
    reg = { battleAnimations: r.battleAnimations, particleSystems: r.particleSystems, battleAnimData: r.battleAnimData, ui2d: r.ui2d };
    anims = [...reg.battleAnimations.values()];
  }, 120_000);

  it('imports every move and common script, and each decodes with known commands only', () => {
    expect(anims.filter((a) => a.move !== undefined || a.common === undefined)).toHaveLength(468);
    expect(anims.filter((a) => a.common !== undefined)).toHaveLength(50);
    // waza_particle.narc's 485, and ball_particle.narc's send-out bursts (1–17, 36) and seals (37–116).
    const ps = [...reg.particleSystems.values()];
    expect(ps.filter((p) => !p.archive)).toHaveLength(485);
    expect(ps.filter((p) => p.archive === 'ball').map((p) => p.sourceIndex)).toEqual([...Array.from({ length: 17 }, (_, i) => i + 1), ...Array.from({ length: 81 }, (_, i) => i + 36)]);
    for (const a of anims) if (a.code.length) expect(() => scriptUse(a.code), a.id).not.toThrow();
  });

  it('reduces actual-move fallbacks from 45 to 9, unlocking exactly the requested 36', () => {
    const addedOps = new Set(['InitSpriteManager', 'LoadCharResObj', 'LoadPlttRes', 'LoadCellResObj', 'LoadAnimResObj', 'AddSpriteWithFunc', 'StartBattlerSlideIn']);
    const addedFuncs = new Set(['Swagger', 'FakeOut', 'FakeOutCurtain', 'BattlerPartialDraw', 'Camouflage', 'FaintAttack', 'Memento', 'Mimic', 'Snatch']);
    const moves = anims.filter((a) => a.common === undefined && a.sourceIndex !== 0);
    const before = moves.filter((a) => {
      const u = scriptUse(a.code);
      return [...u.opcodes].some((o) => !ANIM_OPCODES.has(o) || addedOps.has(o)) || [...u.funcs].some((f) => !ANIM_FUNCS.has(f) || addedFuncs.has(f)) || u.spriteFuncs.size;
    });
    const after = moves.filter((a) => animSupport(a, reg).length);
    expect(moves).toHaveLength(467);
    expect(before).toHaveLength(45);
    expect(after.map((a) => a.sourceIndex)).toEqual([57, 101, 144, 151, 166, 180, 272, 326, 330]);
    const unlocked = before.filter((a) => !after.includes(a));
    expect(unlocked.map((a) => a.sourceIndex)).toEqual([81, 90, 91, 102, 118, 132, 134, 137, 155, 164, 184, 185, 193, 199, 207, 212, 226, 232, 252, 259, 262, 265, 266, 269, 270, 271, 274, 275, 288, 289, 293, 306, 333, 337, 338, 415]);
    for (const a of unlocked) {
      expect(animSupport(a, reg, true), a.id).toEqual([]);
      for (const r of scriptUse(a.code).spriteResources.values()) {
        const sheet = reg.ui2d.get(animSpriteSheetId(r))!;
        expect(sheet.cells.length, a.id).toBeGreaterThan(0);
        expect(sheet.animations?.length, a.id).toBeGreaterThan(0);
        expect(animSupport(a, { ...reg, ui2d: new Map() }), a.id).toContain(`sprite/${sheet.id}`);
      }
    }
  });

  it('plays 458 actual moves plus the supported common animations', () => {
    const cov = animCoverage(reg);
    expect(cov.moves).toBe(468);
    expect(cov.real).toBe(458);
  });

  it('runs every supported script to its end from either side', () => {
    const stubs = new Set<string>();
    const spritesDrawn = new Set<number>();
    const run = (a: BattleAnimation, attacker: number, effectChance: number, defender = attacker ^ 1, doubles = false) => {
      const mon = (b: number) => ({ species: `x:${b}` as Id, form: 0, height: b & 1 ? 4 : 10, visible: true });
      const vm = new AnimVm(a.code, {
        registries: reg,
        attacker,
        defender,
        battlers: (doubles ? [0, 1, 2, 3] : [0, 1]).map(mon),
        doubles,
        effectChance,
        weather: null,
        seed: a.sourceIndex,
        log: { stub: (key: string) => stubs.add(key) } as never,
      });
      while (!vm.done) {
        vm.tick();
        if (vm.view().sprites.some((s) => s.kind === 'cell')) spritesDrawn.add(a.sourceIndex);
      }
      return vm.ticks;
    };
    let played = 0;
    for (const a of anims) {
      if (animSupport(a, reg).length) continue;
      for (const side of [0, 1])
        for (const chance of [0, 1]) {
          expect(() => run(a, side, chance), `${a.id} from ${side}`).not.toThrow();
        }
      played++;
    }
    expect(played).toBeGreaterThan(490);
    for (const a of anims.filter((a) => a.common === undefined && !animSupport(a, reg).length && scriptUse(a.code).spriteFuncs.size)) expect(spritesDrawn.has(a.sourceIndex), a.id).toBe(true);
    // Commands the VM skips on purpose are logged; none may be an unimplemented opcode.
    expect([...stubs].filter((s) => /anim:(op|func|sprite):/.test(s))).toEqual([]);
  }, 300_000);

  it('runs every supported script in doubles: across the field and, where it plays, at the ally', () => {
    const stubs = new Set<string>();
    const run = (a: BattleAnimation, attacker: number, defender: number) => {
      const vm = new AnimVm(a.code, {
        registries: reg,
        attacker,
        defender,
        battlers: [0, 1, 2, 3].map((b) => ({ species: `x:${b}` as Id, form: 0, height: b & 1 ? 4 : 10, visible: true })),
        doubles: true,
        effectChance: 0,
        weather: null,
        seed: a.sourceIndex,
        log: { stub: (key: string) => stubs.add(key) } as never,
      });
      while (!vm.done) {
        vm.tick();
        vm.view();
      }
    };
    let allies = 0;
    for (const a of anims) {
      if (!animSupport(a, reg).length)
        for (const [atk, def] of [
          [0, 3],
          [2, 1],
          [3, 2],
          [1, 0],
        ] as const)
          expect(() => run(a, atk, def), `${a.id} ${atk} → ${def}`).not.toThrow();
      if (a.common === undefined && !animSupport(a, reg, true).length) {
        for (const [atk, def] of [
          [0, 2],
          [3, 1],
        ] as const)
          expect(() => run(a, atk, def), `${a.id} ${atk} → ally ${def}`).not.toThrow();
        allies++;
      }
    }
    expect(allies).toBeGreaterThan(400);
    expect([...stubs].filter((s) => /anim:(op|func|sprite):/.test(s))).toEqual([]);
  }, 300_000);
});
