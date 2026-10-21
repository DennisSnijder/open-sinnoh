/**
 * The trainer AI on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): the imported bytecode decodes,
 * every trainer's flags resolve, and the ROM routines score fixed states the way the decomp script reads
 * (src/battle/trainer_ai/script.s; quoted labels below). The battle is the test fake (made-up type chart,
 * damage = power × Atk / Def / 2), so the expectations only depend on the script's own logic.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { REGISTRIES, type Registries, type Trainer } from '@opensinnoh/contracts';
import { createTrainerPokemon, Dex, loadPacks, Prng, type Id, type Pokemon } from '@opensinnoh/core';
import { romSlice } from '../../../../tests/rom.ts';
import { createAiDex, type AiDex } from './dex.ts';
import { trainerAiOf, type TrainerAi } from './choose.ts';
import { TYPE } from './constants.ts';
import { decodeAiScript, OPCODES } from './opcodes.ts';
import { fakeView, mon, partyMon } from './testing/fake.ts';
import type { AiBattler } from './view.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!romPath)('trainer AI (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let dex: AiDex;
  let ai: TrainerAi;
  beforeAll(async () => {
    const out = romSlice();
    const loaded = loadPacks([out.pack], '0.1.0', () => {});
    reg = Object.fromEntries(REGISTRIES.map((r) => [r, loaded.registries[r] ?? new Map()])) as unknown as Registries;
    dex = createAiDex(reg);
    ai = trainerAiOf(dex);
  }, 120_000);
  const num = (registry: 'moves' | 'types' | 'species' | 'abilities', name: string) => reg[registry].get(P(name))!.sourceIndex!;
  const flagBit = (name: string) => dex.script.flags.findIndex((f) => f.name === name);

  it('decodes from every flag entry with no unknown opcode', () => {
    const s = dex.script;
    expect(s.code).toHaveLength(10607);
    expect(s.flags.map((f) => f.name).filter((n) => !n.includes('UNUSED'))).toEqual([
      'AI_FLAG_BASIC',
      'AI_FLAG_EVAL_ATTACK',
      'AI_FLAG_EXPERT',
      'AI_FLAG_SETUP_FIRST_TURN',
      'AI_FLAG_RISKY',
      'AI_FLAG_PRIORITIZE_EXTREMES',
      'AI_FLAG_BATON_PASS',
      'AI_FLAG_TAG_STRATEGY',
      'AI_FLAG_CHECK_HP',
      'AI_FLAG_WEATHER',
      'AI_FLAG_HARRASSMENT',
      'AI_FLAG_ROAMING_POKEMON',
      'AI_FLAG_SAFARI',
      'AI_FLAG_CATCH_TUTORIAL',
    ]);
    const d = decodeAiScript(s.code, s.flags.map((f) => f.entry));
    expect(d.errors).toEqual([]);
    // Words no flag reaches: tables nothing reads and code after a GoTo/PopOrEnd that no label names
    // (they are in the decomp source too). Pinned so a decoder change that loses code shows up.
    const covered = new Set<number>();
    for (const ins of d.instructions.values()) for (let w = ins.at; w <= ins.at + ins.args.length; w++) covered.add(w);
    for (const [start, entries] of d.tables) for (let w = start; w <= start + entries.length; w++) covered.add(w);
    for (let w = 0; w < 32; w++) covered.add(w);
    expect(s.code.length - covered.size).toBe(96);
    const used = new Set([...d.instructions.values()].map((i) => i.op));
    // The ROM's routines use 86 of the 109 commands; the other 23 run only in the unit tests.
    expect(OPCODES.filter((_, op) => !used.has(op)).map((o) => o.name)).toEqual([
      'IfRandomGreaterThan',
      'IfRandomEqualTo',
      'IfRandomNotEqualTo',
      'IfNotSideCondition',
      'IfMoveNotEqualTo',
      'IfAttackerHasDamagingMoves',
      'LoadMovePower',
      'IfTempNotEqualTo',
      'IfSpeedCompareNotEqualTo',
      'LoadCurrentMove',
      'CalcMaxEffectiveness',
      'IfPartyMemberNotStatus',
      'IfCurrentMoveEffectNotEqualTo',
      'IfCurrentMoveDoesNotKill',
      'IfCurrentMoveMatchesEffect',
      'LoadTypeOfLoadedMove',
      'PushAndGoTo',
      'IfTargetIsTaunted',
      'LoadCurrentMoveClass',
      'IfBattlerHasHigherStat',
      'IfBattlerHasLowerStat',
      'IfBattlerHasEqualStat',
      'IfBattlerNotFainted',
    ]);
    expect(s.noDamageCalcEffects).toHaveLength(13);
    expect(s.altPowerEffects).toHaveLength(11);
    expect(s.weightToPower).toEqual([
      [100, 20],
      [250, 40],
      [500, 60],
      [1000, 80],
      [2000, 100],
    ]);
  });

  it("resolves all 928 trainers' flag sets to routines", () => {
    const trainers = [...reg.trainers.values()] as Trainer[];
    expect(trainers).toHaveLength(928);
    const combos = new Map<string, number>();
    for (const t of trainers) {
      const names: string[] = [];
      for (let bit = 0; bit < 32; bit++) {
        if (!(t.ai & (1 << bit))) continue;
        const f = dex.script.flags[bit]!;
        expect(f.name, `${t.id} bit ${bit}`).not.toMatch(/UNUSED/);
        names.push(f.name.replace('AI_FLAG_', ''));
      }
      const key = names.join('+');
      combos.set(key, (combos.get(key) ?? 0) + 1);
    }
    // Measured on the ROM (docs/research/battles.md counted the long tail as 16; it is 18 with the
    // one trainer without AI flags).
    expect(Object.fromEntries(combos)).toEqual({
      '': 1,
      BASIC: 580,
      'BASIC+EVAL_ATTACK+EXPERT': 226,
      'BASIC+EXPERT': 57,
      'BASIC+PRIORITIZE_EXTREMES': 47,
      'BASIC+RISKY': 4,
      'BASIC+EVAL_ATTACK': 1,
      'BASIC+EVAL_ATTACK+PRIORITIZE_EXTREMES': 6,
      'BASIC+EVAL_ATTACK+EXPERT+SETUP_FIRST_TURN': 6,
    });
    for (const unused of ['BATON_PASS', 'CHECK_HP', 'WEATHER', 'HARRASSMENT']) expect([...combos.keys()].some((k) => k.split('+').includes(unused))).toBe(false);
  });

  /** A singles trainer battle with the AI as battler 1 (Dark type: no STAB on the moves below). */
  function battle(defender: Partial<AiBattler>, moves: string[], chart: [number, number, number][] = []) {
    return fakeView({
      dex,
      chart,
      battlers: [mon({ species: num('species', 'SPECIES_PIPLUP'), ...defender }), mon({ species: num('species', 'SPECIES_UMBREON'), types: [TYPE.DARK, TYPE.DARK], moves: moves.map((m) => num('moves', m)) })],
    });
  }

  it('BASIC: a Normal move on a Ghost scores -10 (Basic_CheckForImmunity → ScoreMinus10)', () => {
    // Gastly (Levitate only: no ability coin flip). Tackle does 0 to the Ghost and Ember does not, so
    // FlagMoveDamageScore is NOT_HIGHEST and the script reaches Basic_CheckForImmunity:
    // IfMoveEffectivenessEquals TYPE_MULTI_IMMUNE → ScoreMinus10. Ember (BURN_HIT) passes every check and
    // Basic_ScoreMoveEffect has no entry for it: it stays at 100.
    const view = battle({ species: num('species', 'SPECIES_GASTLY'), types: [TYPE.GHOST, TYPE.POISON] }, ['MOVE_TACKLE', 'MOVE_EMBER'], [[TYPE.NORMAL, TYPE.GHOST, 0]]);
    const d = ai.chooseAction(view, { battler: 1, ai: 1 << flagBit('AI_FLAG_BASIC') }, new Prng(1));
    expect(d.scores[0]!.scores).toEqual([90, 100, 0, 0]);
    expect(d.action).toEqual({ kind: 'move', slot: 1, target: 0 });
  });

  it('EVAL_ATTACK: a KO scores +4, a +1-priority KO +6, a move out-damaged -1 (EvalAttack_Main)', () => {
    const evalAttack = { battler: 1, ai: 1 << flagBit('AI_FLAG_EVAL_ATTACK') };
    // Damage (fake): Tackle 35 → 17, Thunderbolt 95 → 47; the target has 40 HP. Tackle: IfCurrentMoveKills
    // fails, FlagMoveDamageScore is NOT_HIGHEST → ScoreMinus1. Thunderbolt kills → EvalAttack_ApplyKillBonuses:
    // not Explosion, not a maybe-+4 effect, not PRIORITY_1 → EvalAttack_ScorePlus4.
    const ko = ai.chooseAction(battle({ hp: 40 }, ['MOVE_TACKLE', 'MOVE_THUNDERBOLT']), evalAttack, new Prng(2));
    expect(ko.scores[0]!.scores).toEqual([99, 104, 0, 0]);
    expect(ko.action).toMatchObject({ kind: 'move', slot: 1 });
    // Quick Attack 40 → 20 kills 20 HP; its effect is BATTLE_EFFECT_PRIORITY_1 → EvalAttack_ScorePlus2,
    // which falls through to ScorePlus4: +6. Tackle (17) does not kill and is out-damaged: -1.
    const priority = ai.chooseAction(battle({ hp: 20 }, ['MOVE_TACKLE', 'MOVE_QUICK_ATTACK']), evalAttack, new Prng(3));
    expect(priority.scores[0]!.scores).toEqual([99, 106, 0, 0]);
  });

  it("every trainer's lead chooses an action against a Piplup", () => {
    const monDex = new Dex(reg);
    const toBattler = (p: Pokemon): AiBattler => {
      const s = reg.species.get(p.species)!;
      const types = s.types.map((t) => reg.types.get(t)!.sourceIndex!) as [number, number];
      return mon({
        species: s.sourceIndex!,
        level: p.level,
        types,
        ability: p.ability ? reg.abilities.get(p.ability)!.sourceIndex! : 0,
        hp: p.stats.hp,
        maxHp: p.stats.hp,
        attack: p.stats.attack,
        defense: p.stats.defense,
        speed: p.stats.speed,
        spAttack: p.stats.spAttack,
        spDefense: p.stats.spDefense,
        moves: [0, 1, 2, 3].map((i) => (p.moves[i] ? reg.moves.get(p.moves[i]!)!.sourceIndex! : 0)),
        pp: [0, 1, 2, 3].map((i) => p.pp[i] ?? 0),
        heldItem: p.heldItem ? reg.items.get(p.heldItem)!.sourceIndex! : 0,
        friendship: p.friendship,
        ivs: [p.ivs.hp, p.ivs.attack, p.ivs.defense, p.ivs.speed, p.ivs.spAttack, p.ivs.spDefense],
      });
    };
    const piplup = toBattler(createTrainerPokemon(monDex, { species: P('SPECIES_PIPLUP'), level: 20, ivs: 10, pid: 0, otId: 0 }, 'test', P('ITEM_POKE_BALL')));
    const rng = new Prng(7);
    const kinds = new Map<string, number>();
    for (const t of reg.trainers.values() as Iterable<Trainer>) {
      if (!t.party.length) continue;
      const lead = toBattler(createTrainerPokemon(monDex, t.party[0]!, t.name, P('ITEM_POKE_BALL')));
      const view = fakeView({ dex, battlers: [piplup, lead], parties: [[partyMon()], t.party.map(() => partyMon())] });
      const d = ai.chooseAction(view, { battler: 1, ai: t.ai }, rng);
      kinds.set(d.action.kind, (kinds.get(d.action.kind) ?? 0) + 1);
      if (d.action.kind === 'move') expect(lead.moves[d.action.slot], t.id).not.toBe(0);
    }
    expect(kinds.get('move')).toBeGreaterThan(900);
  });
});
