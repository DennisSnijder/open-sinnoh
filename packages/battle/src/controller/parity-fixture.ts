/** Original mechanic fixtures: named types/moves, synthetic stats; no ROM import or data. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Battle as SimBattle, Dex as SimDex, type Pokemon as SimMon } from '@pkmn/sim';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleSetup, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle } from '../controller.ts';
import { battleTexts } from '../../../../tools/fixtures/battle.ts';

export const f = (n: string) => `fixture:${n}` as Id;
const root = join(import.meta.dirname, '../../../../packs/fixture');
const base = loadGamePacks([readPackFolder((p) => existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined, 'packs/fixture')]).registries;
const stats = { hp: 100, attack: 100, defense: 100, spAttack: 100, spDefense: 100, speed: 100 };
const species = new Map(base.species);
for (const [name, types, baseExp] of [
  ['PIKACHU', ['ELECTRIC'], 50], ['PIDGEY', ['NORMAL', 'FLYING'], 50], ['BULBASAUR', ['GRASS', 'POISON'], 64],
  ['MAGIKARP', ['WATER'], 20], ['DUSKULL', ['GHOST'], 50], ['SQUIRTLE', ['WATER'], 50],
  ['PSYDUCK', ['WATER'], 50], ['SNORLAX', ['NORMAL'], 50],
] as const) {
  species.set(f(`SPECIES_${name}`), { ...base.species.get(f('SPECIES_MOSSLET'))!, id: f(`SPECIES_${name}`), name: name[0]! + name.slice(1).toLowerCase(), types: [f(`TYPE_${types[0]}`), f(`TYPE_${types[types.length - 1]}`)], baseStats: { ...stats }, baseExp, evYield: { ...stats, hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: name === 'MAGIKARP' ? 1 : 0 }, abilities: [null, null], learnset: [{ level: 1, move: f('MOVE_SPLASH') }] });
}
const moves = new Map(base.moves);
const gen4 = SimDex.forGen(4);
for (const name of ['SHADOW_FORCE', 'SEISMIC_TOSS', 'QUICK_ATTACK', 'NIGHT_SHADE', 'SPLASH', 'WATER_GUN', 'DEFOG', 'WEATHER_BALL', 'MOONLIGHT', 'MORNING_SUN', 'SYNTHESIS', 'HAIL', 'SOLAR_BEAM', 'SELF_DESTRUCT', 'TRANSFORM']) {
  const m = gen4.moves.get(name.replaceAll('_', ''));
  moves.set(f(`MOVE_${name}`), { ...base.moves.get(f('MOVE_BOP'))!, id: f(`MOVE_${name}`), name: m.name, sourceIndex: m.num, type: f(`TYPE_${m.type.toUpperCase()}`), power: m.basePower, accuracy: m.accuracy === true ? 0 : m.accuracy, pp: m.pp, priority: m.priority, category: m.category.toLowerCase() as 'physical' | 'special' | 'status', target: m.target === 'self' ? 'USER' : 'SINGLE_TARGET' });
}
const items = new Map(base.items);
for (const [name, holdEffect] of [['LUCKY_EGG', 'EXP_UP'], ['EXP_SHARE', 'EXP_SHARE']] as const) items.set(f(`ITEM_${name}`), { ...base.items.get(f('ITEM_CAPTURE_ORB'))!, id: f(`ITEM_${name}`), name, holdEffect });
const types = new Map(base.types);
for (const [sourceIndex, name] of ['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL', 'MYSTERY', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK'].entries()) {
  types.set(f(`TYPE_${name}`), { ...base.types.get(f('TYPE_NORMAL'))!, id: f(`TYPE_${name}`), name, sourceIndex });
}
const words = battleTexts(f, [...moves.values()]);
export const registries: Registries = { ...base, species, moves, items, types, texts: new Map([...base.texts, ...words.texts.map((t) => [t.id, t] as const)]), textBanks: new Map([...base.textBanks, ...words.textBanks.map((b) => [b.id, b] as const)]) };
export const dex = dexOf(registries);
export const IDLE: InputFrame = { held: [], pressed: [], touch: null };
export function mon(name: string, level = 50, move = 'SEISMIC_TOSS'): Pokemon {
  const p = createPokemon(dex, { species: f(`SPECIES_${name}`), level, pid: 0, ivs: 0, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), moves: [f(`MOVE_${move}`)] });
  p.stats = { ...stats, hp: 160 };
  p.hp = 160;
  return p;
}
export type Harness = Battle & { sim: SimBattle; teams: { party: Pokemon[]; sims: SimMon[]; active: number }[]; battlers: { view: { hp: number; maxHp: number } }[] };
export function battle(party: Pokemon[], setup: Partial<BattleSetup> = {}, reg = registries, language = 2): Harness {
  return createBattle({ kind: 'wild', trainers: [], wild: [{ species: f('SPECIES_MAGIKARP'), level: 5 }], background: null, terrain: null, time: 'day', ...setup }, { registries: reg, party, bag: {}, pc: { current: { box: 0, name: 'CRATE' }, free: null, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo', language }, money: 0, badges: 0, caught: [], seed: 1, textSpeed: 4, log: new CountingStubLog(() => {}) }) as Harness;
}
export function configure(b: Harness, battler: number, p: Pokemon) {
  const team = b.teams[battler]!;
  const sim = team.sims[team.active]!;
  Object.assign(team.party[team.active]!, p);
  sim.hp = p.hp;
  sim.maxhp = sim.baseMaxhp = p.stats.hp;
  sim.storedStats = { atk: p.stats.attack, def: p.stats.defense, spa: p.stats.spAttack, spd: p.stats.spDefense, spe: p.stats.speed };
  sim.baseStoredStats = { ...sim.storedStats, hp: p.stats.hp };
  sim.speed = p.stats.speed;
  sim.moveSlots = p.moves.map((id, i) => {
    const m = b.sim.dex.moves.get(id.split('MOVE_')[1]!.replaceAll('_', ''));
    return { move: m.name, id: m.id, pp: p.pp[i]!, maxpp: m.pp, target: m.target, disabled: false, disabledSource: '', used: false };
  });
  sim.baseMoveSlots.splice(0, sim.baseMoveSlots.length, ...sim.moveSlots);
  b.battlers[battler]!.view.hp = p.hp;
  b.battlers[battler]!.view.maxHp = p.stats.hp;
}
export function untilPrompt(b: Battle): string[] {
  const messages: string[] = [];
  for (let i = 0; i < 30000; i++) {
    if (b.done()) return messages;
    b.step(IDLE);
    const m = b.view().message;
    if (m?.done && messages.at(-1) !== m.text) messages.push(m.text);
    if (b.view().prompt) return messages;
  }
  throw new Error('battle never reached a prompt');
}

/** Enumerate the damage oracle without consuming the battle's seeded stream. */
export function damageRolls(sim: SimBattle, source: SimMon, target: SimMon, moveId: string): number[] {
  const random = sim.random;
  try {
    return Array.from({ length: 16 }, (_, roll) => {
      sim.random = () => roll;
      const move = sim.dex.getActiveMove(moveId);
      move.willCrit = false;
      return sim.actions.getDamage(source, target, move, true) as number;
    });
  } finally { sim.random = random; }
}
