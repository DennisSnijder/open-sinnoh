/**
 * The move animations on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): every script decodes, the
 * coverage holds, and every script the VM supports runs to its end from both sides without an error.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { animSpriteSheetId, type BattleAnimation, type Registries } from '@opensinnoh/contracts';
import { loadPacks, type Id } from '@opensinnoh/core';
import { romSlice } from '../../../../tests/rom.ts';
import { animCoverage, animSupport, AnimVm, contestAnimCoverage, scriptUse } from './index.ts';
import { LAST_FUNCS } from './funcs5.ts';

const LAST = new Set(Object.keys(LAST_FUNCS));

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
    // frontier_particle.narc's 7 (two unused, the Hall, the Arcade's two, the Factory, the Castle).
    expect(ps.filter((p) => p.archive === 'frontier').map((p) => p.sourceIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    for (const a of anims) if (a.code.length) expect(() => scriptUse(a.code), a.id).not.toThrow();
  });

  it('plays every move script, slot 0 included, in battles, at an ally and in contests', () => {
    const moves = anims.filter((a) => a.common === undefined);
    expect(moves).toHaveLength(468);
    for (const a of moves) {
      expect(animSupport(a, reg), a.id).toEqual([]);
      expect(animSupport(a, reg, true), a.id).toEqual([]);
      expect(animSupport(a, reg, false, true), a.id).toEqual([]);
      for (const r of scriptUse(a.code).spriteResources.values()) {
        const sheet = reg.ui2d.get(animSpriteSheetId(r))!;
        expect(sheet.cells.length, a.id).toBeGreaterThan(0);
        expect(sheet.animations?.length, a.id).toBeGreaterThan(0);
        expect(animSupport(a, { ...reg, ui2d: new Map() }), a.id).toContain(`sprite/${sheet.id}`);
      }
    }
    const cov = animCoverage(reg);
    expect([cov.moves, cov.real, cov.missing.size]).toEqual([468, 468, 0]);
    const contest = contestAnimCoverage(reg as Registries);
    expect([contest.moves, contest.real, contest.missing.size]).toEqual([468, 468, 0]);
    // The last nine and slot 0 need the commands and functions the VM gained last.
    const lastOps = ['AddSprite', 'StartBattlerSlideOut', 'LoadPokemonSpriteIntoBg', 'RemovePokemonSpriteFromBg'];
    const last = moves.filter((a) => {
      const u = scriptUse(a.code, false, true);
      return [...u.opcodes].some((o) => lastOps.includes(o)) || [...u.funcs].some((f) => LAST.has(f));
    });
    expect(last.map((a) => a.sourceIndex)).toEqual([0, 57, 101, 144, 151, 166, 180, 272, 326, 330]);
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
