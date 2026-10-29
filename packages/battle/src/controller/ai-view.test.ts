/**
 * The AI view's battle_lib.c routines on the fixture pack (no ROM), against values worked out by hand from
 * the decomp formulas: BattleSystem_CalcMoveDamage, BattleSystem_ApplyTypeChart, BattleSystem_CalcEffectiveness,
 * BattleSystem_TypeMatchupMultiplier, BattleSystem_CompareBattlerSpeed, BattleSystem_CheckInvalidMoves.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRNG } from '@pkmn/sim';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { createAiMemory } from '../ai/memory.ts';
import { trainerAiOf } from '../ai/choose.ts';
import { AI_BATTLER, BATTLE_TYPE, FIELD_CONDITION, MOVE_STATUS } from '../ai/constants.ts';
import { createAiView, type AiSource, type SimPokemon } from './ai-view.ts';
import { Asm } from '../ai/testing/asm.ts';
import { fakeDex, scriptedRng } from '../ai/testing/fake.ts';
import { simData, simSet } from '../sim/dex.ts';
import { CountingStubLog } from '@opensinnoh/game';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const num = (kind: 'moves' | 'types', n: string) => registries[kind].get(f(n))!.sourceIndex!;

function mon(species: string, level: number, moves: string[]): Pokemon {
  return createPokemon(dex, { species: f(species), level, pid: 0, ivs: 31, otId: 1, otName: 'A', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), moves: moves.map(f) });
}

/** The sim battler fields the view reads, from our Pokémon (no stages, status or volatiles unless given). */
function simOf(m: Pokemon, over: Partial<Record<string, unknown>> = {}): SimPokemon {
  const s = m.stats;
  return {
    level: m.level,
    hp: m.hp,
    maxhp: s.hp,
    storedStats: { atk: s.attack, def: s.defense, spa: s.spAttack, spd: s.spDefense, spe: s.speed },
    boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 },
    status: '',
    statusState: {},
    volatiles: {},
    moveSlots: m.moves.map((id, i) => ({ id: id.slice(id.indexOf('_') + 1).toLowerCase(), pp: m.pp[i] })),
    baseMoveSlots: [],
    item: '',
    getWeight: () => 10,
    lastMove: null,
    attackedBy: [],
    activeTurns: 0,
    transformed: false,
    ...over,
  } as unknown as SimPokemon;
}

function source(a: Pokemon, b: Pokemon, rolls: number[] = [], over: [Record<string, unknown>, Record<string, unknown>] = [{}, {}], weather = '') {
  const sim = { field: { weather, pseudoWeather: {} }, sides: [{ sideConditions: {} }, { sideConditions: {} }] };
  const src: AiSource = {
    battleType: 1,
    totalTurns: 0,
    memory: createAiMemory(1, []),
    rng: { next: () => rolls.shift()! },
    sim: sim as never,
    sides: [
      { party: [a], sims: [simOf(a, over[0])], active: 0 },
      { party: [b], sims: [simOf(b, over[1])], active: 0 },
    ],
    packMove: (id) => [...registries.moves.values()].find((m) => m.id.slice(m.id.indexOf('_') + 1).toLowerCase() === id)!,
    packItem: (id) => [...registries.items.keys()].find((item) => item.slice(item.indexOf('_') + 1).toLowerCase() === id)!,
    speedRand: [1, 1, 1, 1],
    powerMul: 10,
  };
  return src;
}

const view = (...args: Parameters<typeof source>) => createAiView(registries, source(...args));

describe('AI view: the DS routines (fixture pack)', () => {
  const grass = mon('SPECIES_MOSSLET', 20, ['MOVE_LEAF_TAP', 'MOVE_BOP', 'MOVE_STARE']);
  const water = mon('SPECIES_DRIPLING', 20, ['MOVE_DRIZZLE_JET', 'MOVE_BOP']);

  it('exposes fog to the trainer AI weather checks', () => {
    expect(view(grass, water, [], [{}, {}], 'fog').fieldConditions).toBe(FIELD_CONDITION.DEEP_FOG);
  });

  it('CalcMoveDamage: ((level·2/5+2)·power·atk/def)/50 + 2, stat stages as num/den', () => {
    const v = view(grass, water);
    const base = Math.trunc(Math.trunc((Math.trunc((20 * 2) / 5) + 2) * 40 * grass.stats.attack / water.stats.defense) / 50) + 2;
    expect(v.calcMoveDamage(num('moves', 'MOVE_LEAF_TAP'), 0, 1, 0, num('types', 'TYPE_NORMAL'))).toBe(base);
    // +2 attack: ×20/10; −1 defense: ×10/15.
    const staged = view(grass, water, [], [{ boosts: { atk: 2, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 } }, { boosts: { atk: 0, def: -1, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 } }]);
    const atk = Math.trunc((grass.stats.attack * 20) / 10);
    const def = Math.trunc((water.stats.defense * 10) / 15);
    expect(staged.calcMoveDamage(num('moves', 'MOVE_LEAF_TAP'), 0, 1, 0, num('types', 'TYPE_NORMAL'))).toBe(Math.trunc(Math.trunc(Math.trunc(atk * 40 * 10) / def) / 50) + 2);
  });

  it('ApplyTypeChart: STAB ×15/10, then each matching chart row (damage·mul/10), with the flags', () => {
    const v = view(grass, water);
    const leaf = num('moves', 'MOVE_LEAF_TAP');
    expect(v.applyTypeChart(leaf, 0, 0, 1, 37, false)).toEqual({ damage: Math.trunc((Math.trunc((37 * 15) / 10) * 20) / 10), flags: MOVE_STATUS.SUPER_EFFECTIVE });
    expect(v.applyTypeChart(num('moves', 'MOVE_DRIZZLE_JET'), 0, 1, 0, 37, false)).toEqual({ damage: Math.trunc((Math.trunc((37 * 15) / 10) * 5) / 10), flags: MOVE_STATUS.NOT_VERY_EFFECTIVE });
    // Fixed damage (SYSCTL_IGNORE_TYPE_CHECKS): no STAB, no change, no effectiveness flags.
    expect(v.applyTypeChart(leaf, 0, 0, 1, 20, true)).toEqual({ damage: 20, flags: 0 });
    expect(v.typeMatchup(num('types', 'TYPE_GROUND'), num('types', 'TYPE_FIRE'), num('types', 'TYPE_FLYING'))).toBe(0);
    expect(v.typeMatchup(num('types', 'TYPE_WATER'), num('types', 'TYPE_FIRE'), num('types', 'TYPE_GROUND'))).toBe(160);
    expect(v.calcEffectiveness(leaf, 0, 0, 0, 0, num('types', 'TYPE_FIRE'), num('types', 'TYPE_WATER'))).toBe(0);
  });

  it('CompareBattlerSpeed: speeds with stages and paralysis; a tie draws rand & 1', () => {
    const fast = view(grass, water, [], [{ boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 1, accuracy: 0, evasion: 0 } }, {}]);
    expect(fast.compareSpeed(0, 1)).toBe(grass.stats.speed * 1.5 > water.stats.speed ? 0 : 1);
    expect(fast.speedValue(0)).toBe(Math.trunc((grass.stats.speed * 15) / 10));
    const par = view(grass, water, [], [{ status: 'par' }, {}]);
    par.compareSpeed(0, 1);
    expect(par.speedValue(0)).toBe(Math.trunc(grass.stats.speed / 4));
    const twin = mon('SPECIES_MOSSLET', 20, ['MOVE_BOP']);
    expect(view(grass, twin, [1]).compareSpeed(0, 1)).toBe(2);
    expect(view(grass, twin, [0]).compareSpeed(0, 1)).toBe(0);
  });

  it('CheckInvalidMoves: no PP, taunted status moves, an encore', () => {
    const tired = mon('SPECIES_MOSSLET', 20, ['MOVE_LEAF_TAP', 'MOVE_BOP', 'MOVE_STARE']);
    tired.pp[1] = 0;
    expect(view(tired, water).invalidMoves(0)).toBe(0b1010);
    expect(view(grass, water, [], [{ volatiles: { taunt: { duration: 2 } } }, {}]).invalidMoves(0)).toBe(0b1100);
  });
});


describe('AI view: histories and absent positions', () => {
  const a = mon('SPECIES_MOSSLET', 20, ['MOVE_LEAF_TAP', 'MOVE_BOP']);
  const b = mon('SPECIES_DRIPLING', 20, ['MOVE_BOP']);

  /** Our own two-move strategy: candidate slot 0 gains one point only when the state is ready. */
  function decision(src: AiSource, ready: Asm) {
    const script = ready.label('bonus').op('AddToMoveScore', 1).op('PopOrEnd').build();
    const dex = fakeDex(script, {});
    const rng = scriptedRng([0, 0, 0, 0, 1]);
    const d = trainerAiOf(dex).chooseMove(createAiView(registries, src), { battler: 0, ai: 1 }, rng);
    expect(rng.left()).toBe(0);
    return d;
  }
  const candidate = () => new Asm().flag(0, 'start').label('start')
    .op('IfMoveEqualTo', num('moves', 'MOVE_LEAF_TAP'), 'check').op('PopOrEnd').label('check');

  it('Last Resort history changes the score and ignores repeated uses, Last Resort itself and pass', () => {
    const score = (used: boolean) => decision(source(a, b, [], [{ moveSlots: [
      { id: 'leaf_tap', pp: 10, used: false }, { id: 'bop', pp: 10, used },
    ] }, {}]), candidate().op('IfCanUseLastResort', AI_BATTLER.ATTACKER, 'bonus').op('PopOrEnd'));
    expect(score(false)).toEqual({ action: { kind: 'move', slot: 1, target: 1 }, scores: [{ target: 1, scores: [100, 100, 0, 0] }] });
    expect(score(true)).toEqual({ action: { kind: 'move', slot: 0, target: 1 }, scores: [{ target: 1, scores: [101, 100, 0, 0] }] });
    const src = source(a, b, [], [{ moveSlots: [
      { id: 'bop', used: true }, { id: 'bop', used: true }, { id: 'lastresort', used: true }, { id: 'opensinnohpass', used: true },
    ] }, {}]);
    const packMove = src.packMove;
    src.packMove = (id) => id === 'lastresort' ? { ...packMove('bop'), id: f('MOVE_LAST_RESORT') } : packMove(id);
    const lastResort = { ...registries.moves.get(f('MOVE_BOP'))!, id: f('MOVE_LAST_RESORT'), sourceIndex: 1001 };
    const moves = new Map(registries.moves).set(lastResort.id, lastResort);
    expect(createAiView({ ...registries, moves }, src).battler(0).lastResortCount).toBe(1);
  });

  it('MOVE_NONE (a battler that has not moved yet) is the DS move table\'s all-zero entry: power 0, Normal, physical', () => {
    const v = view(a, b);
    // Power 0 leaves 0 before the final +2; Normal on Grass is neutral; no STAB for the Water attacker.
    expect(v.calcMoveDamage(0, 1, 0, 0, num('types', 'TYPE_NORMAL'))).toBe(2);
    expect(v.applyTypeChart(0, num('types', 'TYPE_NORMAL'), 1, 0, 2, false)).toEqual({ damage: 2, flags: 0 });
    expect(v.calcEffectiveness(0, 0, 0, 0, 0, num('types', 'TYPE_GRASS'), num('types', 'TYPE_GRASS'))).toBe(0);
    // IfBattlerDealsMoreDamage on the defender's previous move before it has moved: 2 beats only a moveset with no damage.
    const more = (moves: string[]) => {
      const attacker = mon('SPECIES_MOSSLET', 20, moves);
      const script = new Asm().flag(0, 'start').label('start')
        .op('IfBattlerDealsMoreDamage', AI_BATTLER.DEFENDER, 0, 'bonus').op('PopOrEnd')
        .label('bonus').op('AddToMoveScore', 1).op('PopOrEnd').build();
      const power = (m: string) => ({ power: registries.moves.get(f(m))!.power });
      const moveData = Object.fromEntries(['MOVE_LEAF_TAP', 'MOVE_BOP', 'MOVE_STARE'].map((m) => [num('moves', m), power(m)]));
      return trainerAiOf(fakeDex(script, moveData)).chooseMove(createAiView(registries, source(attacker, b)), { battler: 0, ai: 1 }, scriptedRng([0, 0, 0, 0, 0, 0, 0, 0, 1, 1])).scores[0]!.scores;
    };
    expect(more(['MOVE_LEAF_TAP', 'MOVE_BOP'])).toEqual([100, 100, 0, 0]);
    expect(more(['MOVE_STARE', 'MOVE_STARE'])).toEqual([101, 101, 0, 0]);
  });

  it('Recycle reads the consumed item, rather than the original held item, and changes the score', () => {
    const item = registries.items.get(f('ITEM_TONIC'))!.sourceIndex!;
    const score = (lastItem: string) => decision(source(a, b, [], [{ lastItem }, {}]),
      candidate().op('LoadRecycleItem', AI_BATTLER.ATTACKER).op('IfTempEqualTo', item, 'bonus').op('PopOrEnd'));
    expect(score('')).toEqual({ action: { kind: 'move', slot: 1, target: 1 }, scores: [{ target: 1, scores: [100, 100, 0, 0] }] });
    expect(score('tonic')).toEqual({ action: { kind: 'move', slot: 0, target: 1 }, scores: [{ target: 1, scores: [101, 100, 0, 0] }] });
  });

  it('a live sim resets move history on reentry and carries Gen 4 Recycle history across replacements', () => {
    const herb = { ...registries.items.get(f('ITEM_TONIC'))!, id: f('ITEM_WHITE_HERB') };
    const reg = { ...registries, items: new Map(registries.items).set(herb.id, herb) };
    const data = simData(reg, new CountingStubLog(() => {}));
    const sim = data.createBattle('trainer', 'singles', { prng: new PRNG('sodium,00000000000000000000000000000000'), strictChoices: true });
    sim.setPlayer('p1', { name: 'A', team: [a, a].map((m) => simSet(data, dex, m, 'A')) } as never);
    sim.setPlayer('p2', { name: 'B', team: [simSet(data, dex, b, 'B')] } as never);
    const src = source(a, b);
    src.sim = sim;
    src.packMove = data.packMove;
    src.packItem = data.packItem;
    src.sides = [{ party: [a, a], sims: [...sim.p1.pokemon], active: 0 }, { party: [b], sims: [...sim.p2.pokemon], active: 0 }];
    sim.makeChoices('move 2', 'move 1');
    expect(createAiView(reg, src).battler(0).lastResortCount).toBe(1);
    const lead = sim.p1.active[0]!;
    lead.setItem(data.item(herb.id));
    expect(lead.useItem()).toBe(true);
    const item = herb.sourceIndex!;
    expect(createAiView(reg, src).recycleItem(0)).toBe(item);
    sim.makeChoices('switch 2', 'move 1');
    src.sides[0]!.active = 1;
    expect(createAiView(reg, src).battler(0).lastResortCount).toBe(0);
    expect(createAiView(reg, src).recycleItem(0)).toBe(item);
    sim.makeChoices('switch 2', 'move 1');
    src.sides[0]!.active = 0;
    expect(createAiView(reg, src).battler(0).lastResortCount).toBe(0);
    sim.p1.active[0]!.lastItem = '' as never; // Recycle clears this after restoring the item.
    expect(createAiView(reg, src).recycleItem(0)).toBe(0);
    sim.destroy();
  });

  it('switching marks fainted/empty positions and clears when a replacement arrives, without predicting a switch', () => {
    const src = source(a, b, [], [{ switchFlag: true, beingCalledBack: true }, { hp: 0 }]);
    expect(createAiView(registries, src).switching(0)).toBe(false);
    expect(createAiView(registries, src).switching(1)).toBe(true);
    expect(createAiView(registries, src).switching(2)).toBe(true);
    const missing = decision(src, candidate().op('IfBattlerFainted', AI_BATTLER.ATTACKER_PARTNER, 'bonus').op('PopOrEnd'));
    expect(missing.scores[0]!.scores).toEqual([101, 100, 0, 0]);
    src.sides = [...src.sides, { party: [a], sims: [simOf(a)], active: 0 }];
    const present = decision(src, candidate().op('IfBattlerFainted', AI_BATTLER.ATTACKER_PARTNER, 'bonus').op('PopOrEnd'));
    expect(present.scores[0]!.scores).toEqual([100, 100, 0, 0]);
    src.sides[1]!.sims = [simOf(b)];
    expect(createAiView(registries, src).switching(1)).toBe(false);
  });
});

describe('AI view: doubles damage at the DS integer-truncation points', () => {
  // Original equal stats, level factor 20, power 150: exactly 60 before the final +2.
  function damage(o: { category?: 'physical' | 'special'; range?: string; screen?: string; effect?: string; hp?: number[]; doubles?: boolean; power?: number; weather?: string } = {}) {
    const mons = Array.from({ length: 4 }, () => mon('SPECIES_MOSSLET', 45, ['MOVE_BOP']));
    const src = source(mons[0]!, mons[1]!);
    src.battleType = o.doubles === false ? BATTLE_TYPE.TRAINER : BATTLE_TYPE.TRAINER | BATTLE_TYPE.DOUBLES;
    src.sides = mons.map((m, i) => ({ party: [m], sims: [simOf(m, { hp: o.hp?.[i] ?? 100, storedStats: { atk: 100, def: 100, spa: 100, spd: 100, spe: 100 } })], active: 0 }));
    src.sim = { field: { weather: o.weather ?? '', pseudoWeather: {} }, sides: [{ sideConditions: {} }, { sideConditions: o.screen ? { [o.screen]: {} } : {} }] } as never;
    const moves = new Map(registries.moves);
    const base = moves.get(f('MOVE_BOP'))!;
    moves.set(base.id, { ...base, power: o.power ?? 150, category: o.category ?? 'physical', target: o.range ?? 'SINGLE_TARGET', effect: f(`BATTLE_EFFECT_${o.effect ?? 'HIT'}`) });
    return createAiView({ ...registries, moves }, src).calcMoveDamage(base.sourceIndex!, 0, 1, 0, 0);
  }

  it.each([['physical', 'reflect'], ['special', 'lightscreen']] as const)('%s screens: 2/3 with two defenders, 1/2 with one, and bypassed by Remove Screens', (category, screen) => {
    expect(damage({ category, screen })).toBe(42);
    expect(damage({ category, screen, hp: [100, 100, 100, 0] })).toBe(32);
    expect(damage({ category, screen, doubles: false })).toBe(32);
    expect(damage({ category, screen, effect: 'REMOVE_SCREENS' })).toBe(62);
  });

  it('foe-only spread needs two living defenders; all-adjacent counts other living battlers, including the attacker', () => {
    expect(damage({ range: 'ADJACENT_OPPONENTS' })).toBe(47);
    expect(damage({ range: 'ADJACENT_OPPONENTS', hp: [100, 100, 100, 0] })).toBe(62);
    expect(damage({ range: 'ALL_ADJACENT', hp: [100, 100, 100, 0] })).toBe(47);
    expect(damage({ range: 'ALL_ADJACENT', hp: [100, 100, 0, 0] })).toBe(62);
    expect(damage({ range: 'ADJACENT_OPPONENTS', doubles: false })).toBe(62);
    expect(damage({ range: 'SINGLE_TARGET' })).toBe(62);
  });

  it('screens truncate before spread, and the final +2 is added after both', () => {
    // Base 62: floor(62*2/3)=41, floor(41*3/4)=30, then +2 (combining fractions would yield 33).
    expect(damage({ power: 155, screen: 'reflect', range: 'ADJACENT_OPPONENTS' })).toBe(32);
  });
});
