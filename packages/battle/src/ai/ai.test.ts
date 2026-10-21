/**
 * The interpreter on synthetic scripts from our own assembler (testing/asm.ts) and a fake battle. Each
 * expectation follows the decomp handler it names (trainer_ai.c). RNG draws are scripted and counted:
 * TrainerAI_Init draws four damage rolls (100 - r % 16) before any script runs, and the final pick draws
 * once more (r % number of best slots), even with a single best slot.
 */
import { describe, expect, it } from 'vitest';
import { trainerAiOf } from './choose.ts';
import { AI_BATTLER, AI_HAVE, AI_NOT_HAVE, AI_UNKNOWN, ITEM_AI_CATEGORY, LOAD_TYPE, TYPE } from './constants.ts';
import { decodeAiScript, OP, OPCODES } from './opcodes.ts';
import { Asm } from './testing/asm.ts';
import { fakeDex, fakeView, mon, partyMon, scriptedRng, type FakeOptions } from './testing/fake.ts';
import type { AiScript } from '@opensinnoh/contracts';

/** Test moves: 1 Normal 40, 2 Fire 40, 3 a status move, 4 Normal 120, 5 Water 40, 6 Fighting 40, 7 Normal 44, 8 Grass 40. */
const MOVES = {
  1: { type: TYPE.NORMAL, power: 40 },
  2: { type: TYPE.FIRE, power: 40 },
  3: { type: TYPE.NORMAL, power: 0, class: 2 },
  4: { type: TYPE.NORMAL, power: 120 },
  5: { type: TYPE.WATER, power: 40 },
  6: { type: TYPE.FIGHTING, power: 40 },
  7: { type: TYPE.NORMAL, power: 44 },
  8: { type: TYPE.GRASS, power: 40 },
};
const BASIC = 0;
const ROLLS = [0, 0, 0, 0];

function setup(script: AiScript, o: Omit<FakeOptions, 'dex'>, dexOpts: Parameters<typeof fakeDex>[2] = {}) {
  const dex = fakeDex(script, MOVES, dexOpts);
  return { ai: trainerAiOf(dex), view: fakeView({ dex, ...o }) };
}

/** A singles trainer battle: the AI is battler 1 (Dark, so no STAB on the test moves) with `moves`, the player battler 0. */
function singles(script: AiScript, moves: number[], o: Partial<FakeOptions> = {}, dexOpts: Parameters<typeof fakeDex>[2] = {}) {
  return setup(script, { battlers: [mon(), mon({ types: [TYPE.DARK, TYPE.DARK], moves: [...moves, 0, 0, 0, 0].slice(0, 4) })], ...o }, dexOpts);
}

const trainer = { battler: 1, ai: 1 << BASIC };

describe('opcodes', () => {
  it('has the 109 decomp commands in AICMD order', () => {
    expect(OPCODES).toHaveLength(109);
    expect(new Set(OPCODES.map((o) => o.name)).size).toBe(109);
    expect([OP.IfRandomLessThan, OP.AddToMoveScore, OP.LoadTurnCount, OP.Escape, OP.PushAndGoTo, OP.PopOrEnd, OP.LoadAbility]).toEqual([0, 4, 29, 61, 75, 77, 108]);
  });

  it('decodes what is reachable, follows jumps and reads tables', () => {
    const s = new Asm().flag(0, 'a').label('a').op('LoadCurrentMove').op('IfLoadedInTable', 't', 'b').op('GoTo', 'c').label('b').op('AddToMoveScore', 1).label('c').op('PopOrEnd').table('t', [5, 6]).build();
    const d = decodeAiScript(s.code, s.flags.map((f) => f.entry));
    expect(d.errors).toEqual([]);
    expect([...d.tables.values()]).toEqual([[5, 6]]);
    expect([...d.instructions.values()].map((i) => i.name).sort()).toEqual(['AddToMoveScore', 'GoTo', 'IfLoadedInTable', 'LoadCurrentMove', 'PopOrEnd', 'PopOrEnd'].sort());
  });

  it('reports an unknown opcode', () => {
    const s = new Asm().flag(0, 'a').label('a').op('LoadCurrentMove').build();
    s.code[s.code.indexOf(OP.LoadCurrentMove)] = 200;
    expect(decodeAiScript(s.code, [s.flags[0]!.entry]).errors).toEqual([`word 32: unknown opcode 200`]);
  });
});

describe('move scoring', () => {
  it('AddToMoveScore: the score is an s8, so 100 + 30 wraps to -126 and clamps to 0', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('AddToMoveScore', 30).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1, 2]);
    const rng = scriptedRng([...ROLLS, 1]);
    const d = ai.chooseMove(view, trainer, rng);
    // Slots 2 and 3 hold no move: EvalMoves scores them 0. Slots 0 and 1 tie at 0; draw 1 % 2 picks slot 1.
    expect(d.scores).toEqual([{ target: 0, scores: [0, 0, 0, 0] }]);
    expect(d.action).toEqual({ kind: 'move', slot: 1, target: 0 });
    expect(rng.left()).toBe(0);
  });

  it('jumps on the current move and clamps at 0', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('IfMoveEqualTo', 2, 'minus').op('PopOrEnd').label('minus').op('AddToMoveScore', -120).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1, 2]);
    const d = ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0]));
    expect(d.scores[0]!.scores).toEqual([100, 0, 0, 0]);
    expect(d.action).toMatchObject({ slot: 0 });
  });

  it('IfRandomLessThan draws r % 256 once per evaluation', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('IfRandomLessThan', 128, 'plus').op('PopOrEnd').label('plus').op('AddToMoveScore', 5).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1, 2]);
    // Slot 0 draws 10 (< 128: +5), slot 1 draws 200 + 256 (200: no).
    const d = ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 10, 456, 0]));
    expect(d.scores[0]!.scores).toEqual([105, 100, 0, 0]);
  });

  it('IfLoadedInTable / IfLoadedNotInTable read a TABLE_END-terminated table', () => {
    const s = new Asm()
      .flag(BASIC, 'a')
      .label('a')
      .op('LoadCurrentMove')
      .op('IfLoadedInTable', 't', 'in')
      .op('IfLoadedNotInTable', 't', 'out')
      .op('PopOrEnd')
      .label('in')
      .op('AddToMoveScore', 3)
      .op('PopOrEnd')
      .label('out')
      .op('AddToMoveScore', -3)
      .op('PopOrEnd')
      .table('t', [2, 3])
      .build();
    const { ai, view } = singles(s, [1, 2, 3]);
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores).toEqual([97, 103, 103, 0]);
  });

  it('PushAndGoTo / PopOrEnd call and return, GoTo skips ahead; a ninth nested call overflows the 8-entry stack', () => {
    const s = new Asm()
      .flag(BASIC, 'a')
      .label('a')
      .op('PushAndGoTo', 'sub')
      .op('AddToMoveScore', 1)
      .op('GoTo', 'end')
      .op('AddToMoveScore', 50)
      .label('end')
      .op('PopOrEnd')
      .label('sub')
      .op('AddToMoveScore', 2)
      .op('PopOrEnd')
      .build();
    const { ai, view } = singles(s, [1]);
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores).toEqual([103, 0, 0, 0]);
    const loop = new Asm().flag(BASIC, 'a').label('a').op('PushAndGoTo', 'a').build();
    const bad = singles(loop, [1]);
    expect(() => bad.ai.chooseMove(bad.view, trainer, scriptedRng([...ROLLS]))).toThrow(/stack overflow/);
  });

  it('Escape ends the move loop (BREAK): later slots keep their score and the AI flees', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('IfMoveEqualTo', 1, 'esc').op('AddToMoveScore', -50).op('PopOrEnd').label('esc').op('Escape').build();
    const { ai, view } = singles(s, [1, 2]);
    const d = ai.chooseMove(view, trainer, scriptedRng([...ROLLS]));
    expect(d.action).toEqual({ kind: 'escape' });
    expect(d.scores[0]!.scores).toEqual([100, 100, 100, 100]);
  });

  it('Dummy3E never ends on the DS: we throw', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('Dummy3E', 1).build();
    const { ai, view } = singles(s, [1]);
    expect(() => ai.chooseMove(view, trainer, scriptedRng([...ROLLS]))).toThrow(/never ends/);
  });

  it('a move without PP scores 0 unevaluated; an invalid move starts at 0 but is still scored', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('AddToMoveScore', 5).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1, 2, 7]);
    view.battlers[1]!.pp = [0, 10, 10, 10];
    view.invalidMoves = () => 0b100;
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores).toEqual([0, 105, 5, 0]);
  });

  it('FlagMoveDamageScore marks the highest-damage move, with or without the damage rolls', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('FlagMoveDamageScore', 0).op('IfLoadedEqualTo', 2, 'top').op('PopOrEnd').label('top').op('AddToMoveScore', 5).op('PopOrEnd').build();
    // Fake damage = power × 100 / 100 / 2: Normal 40 → 20, Normal 44 → 22; status moves are not compared.
    const { ai, view } = singles(s, [1, 7, 3]);
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores).toEqual([100, 105, 100, 0]);
    const rolled = new Asm().flag(BASIC, 'a').label('a').op('FlagMoveDamageScore', 1).op('IfLoadedEqualTo', 2, 'top').op('PopOrEnd').label('top').op('AddToMoveScore', 5).op('PopOrEnd').build();
    const r = singles(rolled, [1, 7]);
    // Rolls 100 and 85 (draw 15): 20 × 100 / 100 = 20 beats 22 × 85 / 100 = 18.
    expect(r.ai.chooseMove(r.view, trainer, scriptedRng([0, 15, 0, 0, 0])).scores[0]!.scores).toEqual([105, 100, 0, 0]);
  });

  it('IfCurrentMoveKills compares the defender HP with the (rolled) damage', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('IfCurrentMoveKills', 1, 'ko').op('PopOrEnd').label('ko').op('AddToMoveScore', 4).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1, 1]);
    view.battlers[0]!.hp = 20;
    // Slot 0 rolls 100: 20 damage ≥ 20 HP. Slot 1 rolls 85: 17 < 20.
    expect(ai.chooseMove(view, trainer, scriptedRng([0, 15, 0, 0, 0])).scores[0]!.scores).toEqual([104, 100, 0, 0]);
  });

  it('IfMoveEffectivenessEquals sees immunities and maps STAB values to the plain multipliers', () => {
    const s = new Asm()
      .flag(BASIC, 'a')
      .label('a')
      .op('IfMoveEffectivenessEquals', 0, 'immune')
      .op('IfMoveEffectivenessEquals', 80, 'double')
      .op('PopOrEnd')
      .label('immune')
      .op('AddToMoveScore', -10)
      .op('PopOrEnd')
      .label('double')
      .op('AddToMoveScore', 1)
      .op('PopOrEnd')
      .build();
    const chart: [number, number, number][] = [
      [TYPE.NORMAL, TYPE.GHOST, 0],
      [TYPE.FIRE, TYPE.GRASS, 20],
    ];
    const ghost = singles(s, [1, 2], { chart, battlers: [mon({ types: [TYPE.GHOST, TYPE.GHOST] }), mon({ moves: [1, 2, 0, 0], types: [TYPE.FIRE, TYPE.FIRE] })] });
    expect(ghost.ai.chooseMove(ghost.view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores).toEqual([90, 100, 0, 0]);
    // Fire on Grass from a Fire user: 40 × 1.5 (STAB) = 60, × 2 = 120 = TYPE_MULTI_STAB_DAMAGE × 2 → read as 80.
    const grass = singles(s, [1, 2], { chart, battlers: [mon({ types: [TYPE.GRASS, TYPE.GRASS] }), mon({ moves: [1, 2, 0, 0], types: [TYPE.FIRE, TYPE.FIRE] })] });
    expect(grass.ai.chooseMove(grass.view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores).toEqual([100, 101, 0, 0]);
  });

  it("LoadBattlerAbility: an opponent's unknown ability is a coin flip between its species' two", () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('LoadBattlerAbility', AI_BATTLER.DEFENDER).op('IfLoadedEqualTo', 5, 'five').op('PopOrEnd').label('five').op('AddToMoveScore', 1).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1, 1], {}, { abilities: { 1: [5, 6] } });
    // Slot 0 draws 1 (odd: ability 1 = 5), slot 1 draws 2 (even: ability 2 = 6).
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 1, 2, 0])).scores[0]!.scores).toEqual([101, 100, 0, 0]);
    // A revealed ability is used as is, without a draw.
    view.memory.knownAbilities[0] = 5;
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores).toEqual([101, 101, 0, 0]);
  });

  it('CheckBattlerAbility: two possible abilities, one of them expected, reads as unknown', () => {
    const results: number[] = [];
    for (const expected of [5, 7]) {
      const s = new Asm()
        .flag(BASIC, 'a')
        .label('a')
        .op('CheckBattlerAbility', AI_BATTLER.DEFENDER, expected)
        .op('IfLoadedEqualTo', AI_UNKNOWN, 'u')
        .op('IfLoadedEqualTo', AI_HAVE, 'h')
        .op('IfLoadedEqualTo', AI_NOT_HAVE, 'n')
        .op('PopOrEnd')
        .label('u')
        .op('AddToMoveScore', 2)
        .op('PopOrEnd')
        .label('h')
        .op('AddToMoveScore', 1)
        .op('PopOrEnd')
        .label('n')
        .op('AddToMoveScore', 3)
        .op('PopOrEnd')
        .build();
      const { ai, view } = singles(s, [1], {}, { abilities: { 1: [5, 6] } });
      results.push(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores[0]!);
    }
    // Expected 5: AI_UNKNOWN (+2). Expected 7: the AI assumes ability 1 (5), so AI_NOT_HAVE (+3).
    expect(results).toEqual([102, 103]);
  });

  it('LoadTypeFrom DEFENDER_PARTNER_TYPE_2 loads type 1, as the DS does', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('LoadTypeFrom', LOAD_TYPE.DEFENDER_PARTNER_TYPE_2).op('IfLoadedEqualTo', TYPE.FIRE, 'f').op('PopOrEnd').label('f').op('AddToMoveScore', 1).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1], { battlers: [mon({ types: [TYPE.FIRE, TYPE.WATER] }), mon({ moves: [1, 0, 0, 0] })] });
    // Singles: the defender's partner is the defender itself (BattleSystem_GetPartner).
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, 0])).scores[0]!.scores[0]).toBe(101);
  });

  it('mask zero: two moves tie at 100 and use exactly four initialization draws and one tie draw', () => {
    const script = new Asm().build();
    for (const tie of [0, 1]) {
      const { ai, view } = singles(script, [1, 2]);
      view.invalidMoves = () => 0b1100;
      const rng = scriptedRng([...ROLLS, tie]);
      expect(ai.chooseAction(view, { battler: 1, ai: 0 }, rng)).toEqual({
        action: { kind: 'move', slot: tie, target: 0 }, scores: [{ target: 0, scores: [100, 100, 0, 0] }],
      });
      expect(rng.left()).toBe(0);
    }
  });

  it('doubles: an ally score of 99 is excluded, 100 is eligible; equal foes use a separate target draw', () => {
    for (const ally of [99, 100]) for (const tie of [0, 1]) {
      const script = new Asm().flag(7, 'start').label('start')
        .op('IfTargetIsPartner', 'ally').op('AddToMoveScore', -2).op('PopOrEnd')
        .label('ally').op('AddToMoveScore', ally - 100).op('PopOrEnd').build();
      const { ai, view } = setup(script, { battleType: 3, battlers: [mon(), mon({ moves: [1, 0, 0, 0] }), mon(), mon()] });
      const rng = scriptedRng([0, ...ROLLS, ...ROLLS, 0, ...ROLLS, 0, ...ROLLS, 0, tie]);
      expect(ai.chooseMove(view, { battler: 1, ai: 0 }, rng)).toEqual({
        action: { kind: 'move', slot: 0, target: ally === 100 ? 3 : tie * 2 },
        scores: [{ target: 0, scores: [98, 0, 0, 0] }, { target: 2, scores: [98, 0, 0, 0] }, { target: 3, scores: [ally, 0, 0, 0] }],
      });
      expect(rng.left()).toBe(0);
    }
  });

  it('doubles: each opponent is scored, the best target wins and draws are in the DS order', () => {
    const s = new Asm().flag(BASIC, 'a').label('a').op('LoadTypeFrom', LOAD_TYPE.DEFENDER_TYPE_1).op('IfLoadedEqualTo', TYPE.GHOST, 'g').op('PopOrEnd').label('g').op('AddToMoveScore', -10).op('PopOrEnd').build();
    const { ai, view } = setup(s, {
      battleType: 0b11,
      battlers: [mon({ types: [TYPE.GHOST, TYPE.GHOST] }), mon({ moves: [1, 0, 0, 0] }), mon(), mon({ hp: 0 })],
    });
    // RandomOpponent (1), TrainerAI_Main's init (4), per target: init (4) + best slot (1), then the target (1).
    const rng = scriptedRng([0, ...ROLLS, ...ROLLS, 0, ...ROLLS, 0, 0]);
    const d = ai.chooseMove(view, { battler: 1, ai: 1 }, rng);
    expect(d.scores).toEqual([
      { target: 0, scores: [90, 0, 0, 0] },
      { target: 2, scores: [100, 0, 0, 0] },
    ]);
    expect(d.action).toEqual({ kind: 'move', slot: 0, target: 2 });
    expect(rng.left()).toBe(0);
  });
});

describe('commands the ROM routines never use', () => {
  type Case = [name: string, emit: (a: Asm) => Asm, holds: boolean, draws?: number[], tweak?: (v: ReturnType<typeof singles>['view']) => void];
  const cases: Case[] = [
    ['IfRandomGreaterThan: 200 > 100', (a) => a.op('IfRandomGreaterThan', 100, 'yes'), true, [200]],
    ['IfRandomEqualTo: 263 % 256 = 7', (a) => a.op('IfRandomEqualTo', 7, 'yes'), true, [263]],
    ['IfRandomNotEqualTo: 7', (a) => a.op('IfRandomNotEqualTo', 7, 'yes'), false, [7]],
    ['IfMoveNotEqualTo', (a) => a.op('IfMoveNotEqualTo', 2, 'yes'), true],
    ['LoadMovePower', (a) => a.op('LoadMovePower').op('IfLoadedEqualTo', 40, 'yes'), true],
    ['LoadCurrentMove + LoadTypeOfLoadedMove', (a) => a.op('LoadCurrentMove').op('LoadTypeOfLoadedMove').op('IfLoadedEqualTo', TYPE.NORMAL, 'yes'), true],
    ['LoadCurrentMoveClass', (a) => a.op('LoadCurrentMoveClass').op('IfLoadedEqualTo', 0, 'yes'), true],
    ['IfTempNotEqualTo on turn 0', (a) => a.op('LoadTurnCount').op('IfTempNotEqualTo', 0, 'yes'), false],
    ['IfSpeedCompareNotEqualTo a tie', (a) => a.op('IfSpeedCompareNotEqualTo', 2, 'yes'), false],
    ['IfBattlerHasHigherStat (their Speed 150)', (a) => a.op('IfBattlerHasHigherStat', AI_BATTLER.DEFENDER, 3, 'yes'), true, [], (v) => (v.battlers[0]!.speed = 150)],
    ['IfBattlerHasLowerStat (their Speed 50)', (a) => a.op('IfBattlerHasLowerStat', AI_BATTLER.DEFENDER, 3, 'yes'), true, [], (v) => (v.battlers[0]!.speed = 50)],
    ['IfBattlerHasEqualStat', (a) => a.op('IfBattlerHasEqualStat', AI_BATTLER.DEFENDER, 3, 'yes'), true],
    ['IfTargetIsTaunted', (a) => a.op('IfTargetIsTaunted', 'yes'), true, [], (v) => (v.battlers[0]!.tauntedTurns = 2)],
    ['IfCurrentMoveDoesNotKill: 20 damage on 100 HP', (a) => a.op('IfCurrentMoveDoesNotKill', 0, 'yes'), true],
    ['CalcMaxEffectiveness: neutral, no STAB = 40', (a) => a.op('CalcMaxEffectiveness').op('IfLoadedEqualTo', 40, 'yes'), true],
    ['IfAttackerHasDamagingMoves', (a) => a.op('IfAttackerHasDamagingMoves', 'yes'), true],
    ['IfNotSideCondition', (a) => a.op('IfNotSideCondition', AI_BATTLER.DEFENDER, 1, 'yes'), true],
    ['IfPartyMemberNotStatus: a healthy bench Pokémon', (a) => a.op('IfPartyMemberNotStatus', AI_BATTLER.DEFENDER, 0x40, 'yes'), true, [], (v) => (v.parties[0] = [partyMon(), partyMon()])],
    ['IfCurrentMoveMatchesEffect CHECK_DISABLE', (a) => a.op('IfCurrentMoveMatchesEffect', 0, 'yes'), true, [], (v) => (v.battlers[1]!.disabledMove = 1)],
    ['IfBattlerNotFainted', (a) => a.op('IfBattlerNotFainted', AI_BATTLER.DEFENDER_PARTNER, 'yes'), true],
  ];
  it.each(cases)('%s', (_, emit, holds, draws = [], tweak) => {
    const s = emit(new Asm().flag(BASIC, 'a').label('a')).op('PopOrEnd').label('yes').op('AddToMoveScore', 1).op('PopOrEnd').build();
    const { ai, view } = singles(s, [1]);
    tweak?.(view);
    expect(ai.chooseMove(view, trainer, scriptedRng([...ROLLS, ...draws, 0])).scores[0]!.scores[0]).toBe(holds ? 101 : 100);
  });
});

describe('items, switching and the post-KO choice', () => {
  const empty = new Asm().build();

  it('uses a Potion under 1/4 HP, and the DS loop spends every later item it reaches too', () => {
    const potion = { partyFlags: new Set(['hpRestore']), hpRestored: 20 };
    const { ai, view } = singles(empty, [1], {}, { items: { 17: potion, 26: { ...potion, hpRestored: 50 } } });
    view.memory.items[0] = [17, 26, 0, 0];
    view.memory.itemCounts[0] = 2;
    view.battlers[1]!.hp = 20;
    view.parties[1] = [partyMon()];
    // One Pokémon left: slot 1 is reached (1 <= 2 - 1 + 1). The Potion applies; the Super Potion is spent and is the one used.
    const d = ai.chooseAction(view, trainer, scriptedRng([]));
    expect(d.action).toEqual({ kind: 'item', item: 26, category: ITEM_AI_CATEGORY.RECOVER_HP, condition: 0 });
    expect(view.memory.items[0]).toEqual([0, 0, 0, 0]);
  });

  it('switches when every damaging move fails on the foe, to a bench Pokémon with a super-effective move (rand % 3 < 2)', () => {
    const chart: [number, number, number][] = [
      [TYPE.NORMAL, TYPE.GHOST, 0],
      [TYPE.FIRE, TYPE.GHOST, 20],
    ];
    const { ai, view } = singles(empty, [1, 4], { chart, battlers: [mon({ types: [TYPE.GHOST, TYPE.GHOST] }), mon({ moves: [1, 4, 0, 0] })] });
    view.parties[1] = [partyMon({ moves: [1, 4, 0, 0] }), partyMon({ moves: [2, 0, 0, 0] })];
    const rng = scriptedRng([1]);
    expect(ai.chooseAction(view, trainer, rng).action).toEqual({ kind: 'switch', slot: 1 });
    expect(view.memory.switchedSlot[1]).toBe(1);
  });

  it('post-KO: the best type matchup with a super-effective move, its u8 score overflowing at ×4 + ×4', () => {
    const chart: [number, number, number][] = [
      [TYPE.WATER, TYPE.FIRE, 20],
      [TYPE.WATER, TYPE.ROCK, 20],
      [TYPE.FIGHTING, TYPE.ROCK, 20],
    ];
    const { ai, view } = singles(empty, [1], { chart, battlers: [mon({ types: [TYPE.FIRE, TYPE.ROCK] }), mon({ hp: 0 })] });
    view.parties[1] = [partyMon({ hp: 0 }), partyMon({ types: [TYPE.WATER, TYPE.WATER], moves: [5, 0, 0, 0] }), partyMon({ moves: [6, 0, 0, 0] })];
    // Water/Water scores 160 + 160 = 320, kept as 64 in a u8; Normal scores 40 + 40 = 80 and has a
    // super-effective Fighting move, so it is chosen first.
    expect(ai.chooseSwitchIn(view, 1, scriptedRng([]))).toBe(2);
  });
});
