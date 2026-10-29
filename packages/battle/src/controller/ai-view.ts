/**
 * `AiBattleView` over the running battle: the trainer AI reads the battle in the DS's terms, so this
 * maps the sim's state to decomp battler data and implements the battle_lib.c routines the AI calls with
 * the DS's integer maths (BattleSystem_ApplyTypeChart, BattleSystem_CalcEffectiveness,
 * BattleSystem_CalcMoveDamage, BattleSystem_CompareBattlerSpeed, BattleSystem_CheckInvalidMoves,
 * BattleSystem_TypeMatchupMultiplier). The sim resolves the real turn; these only feed the AI's scores.
 *
 * The controller keeps the DS's per-turn values the AI reads: Quick Claw's rolls (speedRand, drawn before
 * each turn's moves) and the power multiplier the last move left behind (powerMul: 20 after Revenge or
 * Avalanche that was hit first, or Pursuit on a switching foe, else 10). Not modelled: Helping Hand
 * (doubles), Roost.
 */
import type { Battle as SimBattle } from '@pkmn/sim';
import { monGender, type Dex, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Item, type Move, type Registries } from '@opensinnoh/contracts';
import { battlerAbility, battlerHeldItem, divide } from '../ai/calc.ts';
import { PASS_MOVE } from '../sim/dex.ts';
import { BATTLE_TYPE, FIELD_CONDITION, MON_CONDITION, MOVE_EFFECT, MOVE_STATUS, SIDE_CONDITION, VOLATILE_CONDITION } from '../ai/constants.ts';
import { EMPTY_BATTLER, type AiBattler, type AiBattleView, type AiMemory, type AiPartyMon, type AiRng } from '../ai/view.ts';

/** A side of the battle as the controller keeps it: the party, the sim's Pokémon in party order, the active slot. */
export interface AiSide {
  party: readonly Pokemon[];
  sims: readonly (SimPokemon | null)[];
  active: number;
}

export interface AiSource {
  battleType: number;
  totalTurns: number;
  memory: AiMemory;
  rng: AiRng;
  sim: SimBattle;
  /**
   * By battler: 0 (the player's side) and 1 in singles; 0–3 in doubles (one owner per battler, or one party shared
   * by an owner's two battlers).
   */
  sides: readonly AiSide[];
  /** The DS battler a sim Pokémon in the field stands for (absent: its sim side's number, one battler a side). */
  battlerOf?(sim: SimPokemon): number;
  /** The pack move behind a sim move id. */
  packMove(simId: string): Move;
  /** The pack item behind a sim item id (including Recycle's consumed item). */
  packItem(simId: string): Id;
  /** decomp battleCtx->speedRand, per battler (Quick Claw's roll). */
  speedRand: readonly number[];
  /** decomp battleCtx->powerMul as the last move left it (×10). */
  powerMul: number;
}

export type SimPokemon = SimBattle['p1']['pokemon'][number];

/** Decomp values not in the AI's constants (condition.h, moves.h). */
const VOLATILE = { FLINCH: 1 << 3, MOVE_LOCKED: 1 << 12, ATTRACT: 1 << 16, FOCUS_ENERGY: 1 << 20, TRANSFORM: 1 << 21, RECHARGING: 1 << 22, SUBSTITUTE: 1 << 24, DESTINY_BOND: 1 << 25, NIGHTMARE: 1 << 27, CURSE: 1 << 28, FORESIGHT: 1 << 29, DEFENSE_CURL: 1 << 30, TORMENT: (1 << 31) >>> 0 };
const EFFECT = { LEECH_SEED: 1 << 2, CHARGE: 1 << 9, MUD_SPORT: 1 << 16, WATER_SPORT: 1 << 17, MIRACLE_EYE: 1 << 22, AQUA_RING: 1 << 24, HEAL_BLOCK: 1 << 25, MAGNET_RISE: 1 << 27 };
const SIDE = { REFLECT: 1 << 0, LIGHT_SCREEN: 1 << 1, SAFEGUARD: 1 << 3, STEALTH_ROCK: 1 << 7, TAILWIND: (1 << 8) | (1 << 9), LUCKY_CHANT: 1 << 12 };
const TRICK_ROOM = 0b111 << 16;
const MOVE_STATUS_BASIC_EFFECTIVENESS = MOVE_STATUS.SUPER_EFFECTIVE | MOVE_STATUS.NOT_VERY_EFFECTIVE;

/** Battle effects whose charging turn deals no damage (decomp MoveIsOnDamagingTurn, Fire Fang's BUG kept). */
const NON_DAMAGING_TURN = new Set(['BIDE', 'CHARGE_TURN_HIGH_CRIT', 'CHARGE_TURN_HIGH_CRIT_FLINCH', 'CHARGE_TURN_DEF_UP', 'SKIP_CHARGE_TURN_IN_SUN', 'FLY', 'DIVE', 'DIG', 'BOUNCE', 'FLINCH_BURN_HIT', 'SHADOW_FORCE']);
const PUNCHING = new Set(['ICE_PUNCH', 'FIRE_PUNCH', 'THUNDER_PUNCH', 'MACH_PUNCH', 'FOCUS_PUNCH', 'DIZZY_PUNCH', 'DYNAMIC_PUNCH', 'HAMMER_ARM', 'MEGA_PUNCH', 'COMET_PUNCH', 'METEOR_MASH', 'SHADOW_PUNCH', 'DRAIN_PUNCH', 'BULLET_PUNCH', 'SKY_UPPERCUT']);
/** decomp sMovesAffectedByHealBlock. */
const HEAL_BLOCKED = new Set(['RECOVER', 'SOFTBOILED', 'REST', 'MILK_DRINK', 'MORNING_SUN', 'SYNTHESIS', 'MOONLIGHT', 'SWALLOW', 'HEAL_ORDER', 'SLACK_OFF', 'ROOST', 'LUNAR_DANCE', 'HEALING_WISH', 'WISH']);
const SPEED_HALVING = new Set(['EVS_UP_SPEED_DOWN', 'SPEED_DOWN_GROUNDED', 'LVLUP_HP_EV_UP', 'LVLUP_ATK_EV_UP', 'LVLUP_DEF_EV_UP', 'LVLUP_SPEED_EV_UP', 'LVLUP_SPATK_EV_UP', 'LVLUP_SPDEF_EV_UP']);
const STRENGTHEN: Record<string, string> = {
  STRENGTHEN_BUG: 'BUG', STRENGTHEN_STEEL: 'STEEL', STRENGTHEN_GROUND: 'GROUND', STRENGTHEN_ROCK: 'ROCK', STRENGTHEN_GRASS: 'GRASS', STRENGTHEN_DARK: 'DARK',
  STRENGTHEN_FIGHT: 'FIGHTING', STRENGTHEN_ELECTRIC: 'ELECTRIC', STRENGTHEN_WATER: 'WATER', STRENGTHEN_FLYING: 'FLYING', STRENGTHEN_POISON: 'POISON', STRENGTHEN_ICE: 'ICE',
  STRENGTHEN_GHOST: 'GHOST', STRENGTHEN_PSYCHIC: 'PSYCHIC', STRENGTHEN_FIRE: 'FIRE', STRENGTHEN_DRAGON: 'DRAGON', STRENGTHEN_NORMAL: 'NORMAL',
  ARCEUS_FIRE: 'FIRE', ARCEUS_WATER: 'WATER', ARCEUS_ELECTRIC: 'ELECTRIC', ARCEUS_GRASS: 'GRASS', ARCEUS_ICE: 'ICE', ARCEUS_FIGHTING: 'FIGHTING', ARCEUS_POISON: 'POISON',
  ARCEUS_GROUND: 'GROUND', ARCEUS_FLYING: 'FLYING', ARCEUS_PSYCHIC: 'PSYCHIC', ARCEUS_BUG: 'BUG', ARCEUS_ROCK: 'ROCK', ARCEUS_GHOST: 'GHOST', ARCEUS_DRAGON: 'DRAGON',
  ARCEUS_DARK: 'DARK', ARCEUS_STEEL: 'STEEL',
};

const bare = (id: Id | null, prefix: string) => {
  if (!id) return '';
  const name = id.slice(id.indexOf(':') + 1);
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
};

/** The registries indexed by decomp number, once per set of registries. */
/** The move fields the view's battle_lib.c routines read. */
type ViewMove = Pick<Move, 'id' | 'type' | 'power' | 'effect' | 'category' | 'target'>;

interface Tables {
  dex: Dex;
  /** By decomp number, with MOVE_NONE (0) as the DS move table's all-zero entry. */
  moves: Map<number, ViewMove>;
  items: Map<number, Item>;
  abilityNames: Map<number, string>;
  abilityNumbers: Map<string, number>;
  typeNumber: (id: Id) => number;
  typeName: Map<number, string>;
  /** TYPE_NORMAL's number (the DS's 0: "the move's own type" where a routine takes a type). */
  normal: number;
  speciesNames: Map<number, string>;
  /** sTypeMatchupMultipliers rows: [attacking, defending, ×10, after the Foresight separator]. */
  chart: [number, number, number, boolean][];
  number(kind: 'species' | 'moves' | 'items' | 'abilities', id: Id | null): number;
}

const tablesCache = new WeakMap<Registries, Tables>();

function tablesOf(reg: Registries): Tables {
  const cached = tablesCache.get(reg);
  if (cached) return cached;
  const bySource = <T extends { sourceIndex?: number }>(m: ReadonlyMap<Id, T>) => new Map([...m.values()].flatMap((r) => (r.sourceIndex === undefined ? [] : [[r.sourceIndex, r] as const])));
  const number: Tables['number'] = (kind, id) => {
    if (!id) return 0;
    const n = (reg[kind] as ReadonlyMap<Id, { sourceIndex?: number }>).get(id)?.sourceIndex;
    if (n === undefined) throw new Error(`battle AI view: ${kind} ${id} has no decomp number`);
    return n;
  };
  const typeNumber = (id: Id) => number('types' as never, id);
  const ns = [...reg.types.keys()][0]!.split(':')[0];
  // A battler that has not moved yet has previous move MOVE_NONE, and the DS reads its table entry like any
  // other: class physical, type Normal, power 0, effect HIT, single target.
  const none: ViewMove = { id: `${ns}:MOVE_NONE` as Id, type: `${ns}:TYPE_NORMAL` as Id, power: 0, effect: `${ns}:BATTLE_EFFECT_HIT` as Id, category: 'physical', target: 'SINGLE_TARGET' };
  const rows: Tables['chart'] = [];
  for (const t of reg.types.values()) for (const m of t.matchups) rows.push([typeNumber(t.id), typeNumber(m.type), m.multiplier, m.foresight]);
  // Table order: non-Foresight rows first, by attacking type in record order, then the Foresight rows.
  const chart = [...rows.filter((r) => !r[3]), ...rows.filter((r) => r[3])];
  const abilityNames = new Map([...reg.abilities.values()].flatMap((a) => (a.sourceIndex === undefined ? [] : [[a.sourceIndex, bare(a.id, 'ABILITY_')] as const])));
  const t: Tables = {
    dex: dexOf(reg),
    moves: new Map<number, ViewMove>([[0, none], ...bySource(reg.moves)]),
    items: bySource(reg.items),
    abilityNames,
    abilityNumbers: new Map([...abilityNames].map(([n, name]) => [name, n])),
    typeNumber,
    typeName: new Map([...reg.types.values()].flatMap((x) => (x.sourceIndex === undefined ? [] : [[x.sourceIndex, bare(x.id, 'TYPE_')] as const]))),
    chart,
    number,
    normal: typeNumber(none.type),
    speciesNames: new Map([...reg.species.values()].flatMap((x) => (x.sourceIndex === undefined ? [] : [[x.sourceIndex, bare(x.id, 'SPECIES_')] as const]))),
  };
  tablesCache.set(reg, t);
  return t;
}

/** Decomp sStatStageBoosts: stage s (0–12) multiplies by max(2, 2+s-6) / max(2, 2-(s-6)). */
const stageNum = (s: number) => Math.max(2, s - 4) * 5;
const stageDen = (s: number) => Math.max(2, 8 - s) * 5;
const applyStage = (stat: number, stage: number) => Math.trunc((stat * stageNum(stage)) / stageDen(stage));

export function createAiView(reg: Registries, src: AiSource): AiBattleView {
  const T = tablesOf(reg);
  const sideOf = (battler: number) => src.sides[battler]!;
  const exists = (battler: number) => battler < src.sides.length;
  const all = src.sides.map((_, b) => b);
  const activeSim = (battler: number): SimPokemon | null => (exists(battler) ? (sideOf(battler).sims[sideOf(battler).active] ?? null) : null);
  const move = (n: number): ViewMove => {
    const m = T.moves.get(n);
    if (!m) throw new Error(`battle AI view: no move ${n}`);
    return m;
  };
  // The hidden pass move (a turn spent outside the sim) is no move to the DS.
  const moveNumber = (simId: string) => (simId === PASS_MOVE ? 0 : T.number('moves', src.packMove(simId).id));
  const itemOf = (n: number) => (n ? T.items.get(n) : undefined);
  const holdEffect = (n: number) => bare((itemOf(n)?.holdEffect ?? 'NONE') as Id, 'HOLD_EFFECT_');
  const holdParam = (n: number) => itemOf(n)?.holdParam ?? 0;
  const abilityName = (n: number) => T.abilityNames.get(n) ?? '';
  const typeName = (n: number) => T.typeName.get(n) ?? '';

  const cache = new Map<number, AiBattler>();
  const speedValues = [0, 0, 0, 0];

  function battlerOf(battler: number): AiBattler {
    let b = cache.get(battler);
    if (b) return b;
    const sim = activeSim(battler);
    if (!sim) return EMPTY_BATTLER;
    const side = sideOf(battler);
    const mon = side.party[side.active]!;
    const form = T.dex.form(mon.species, mon.form);
    const v = sim.volatiles as Record<string, { duration?: number; time?: number; layers?: number } | undefined>;
    const st = sim.status as string;
    let status = 0;
    if (st === 'slp') status = Math.max(1, Math.min(7, (sim.statusState as { time?: number }).time ?? 1));
    else if (st === 'psn') status = MON_CONDITION.POISON;
    else if (st === 'brn') status = MON_CONDITION.BURN;
    else if (st === 'frz') status = MON_CONDITION.FREEZE;
    else if (st === 'par') status = MON_CONDITION.PARALYSIS;
    else if (st === 'tox') status = MON_CONDITION.TOXIC;
    let volatile = 0;
    if (v.confusion) volatile |= Math.max(1, Math.min(7, v.confusion.time ?? 1));
    if (v.partiallytrapped) volatile |= 1 << 13;
    if (v.trapped) volatile |= VOLATILE_CONDITION.MEAN_LOOK;
    if (v.flinch) volatile |= VOLATILE.FLINCH;
    if (v.lockedmove) volatile |= VOLATILE.MOVE_LOCKED;
    if (v.attract) volatile |= VOLATILE.ATTRACT;
    if (v.focusenergy) volatile |= VOLATILE.FOCUS_ENERGY;
    if (sim.transformed) volatile |= VOLATILE.TRANSFORM;
    if (v.mustrecharge) volatile |= VOLATILE.RECHARGING;
    if (v.substitute) volatile |= VOLATILE.SUBSTITUTE;
    if (v.destinybond) volatile |= VOLATILE.DESTINY_BOND;
    if (v.nightmare) volatile |= VOLATILE.NIGHTMARE;
    if (v.curse) volatile |= VOLATILE.CURSE;
    if (v.foresight) volatile |= VOLATILE.FORESIGHT;
    if (v.defensecurl) volatile |= VOLATILE.DEFENSE_CURL;
    if (v.torment) volatile |= VOLATILE.TORMENT;
    let effects = 0;
    if (v.leechseed) effects |= EFFECT.LEECH_SEED;
    if (v.perishsong) effects |= MOVE_EFFECT.PERISH_SONG;
    if (v.charge) effects |= EFFECT.CHARGE;
    if (v.ingrain) effects |= MOVE_EFFECT.INGRAIN;
    if (v.mudsport) effects |= EFFECT.MUD_SPORT;
    if (v.watersport) effects |= EFFECT.WATER_SPORT;
    if (v.gastroacid) effects |= MOVE_EFFECT.ABILITY_SUPPRESSED;
    if (v.miracleeye) effects |= EFFECT.MIRACLE_EYE;
    if (v.aquaring) effects |= EFFECT.AQUA_RING;
    if (v.healblock) effects |= EFFECT.HEAL_BLOCK;
    if (v.embargo) effects |= MOVE_EFFECT.EMBARGO;
    if (v.magnetrise) effects |= EFFECT.MAGNET_RISE;
    const slots = sim.moveSlots;
    const boosts = sim.boosts as Record<string, number>;
    const gender = monGender(T.dex, mon);
    b = {
      species: T.number('species', mon.species),
      level: sim.level,
      gender: gender === 'male' ? 0 : gender === 'female' ? 1 : 2,
      ability: T.number('abilities', mon.ability),
      types: [T.typeNumber(form.types[0]), T.typeNumber(form.types[1])],
      hp: sim.hp,
      maxHp: sim.maxhp,
      attack: sim.storedStats.atk,
      defense: sim.storedStats.def,
      speed: sim.storedStats.spe,
      spAttack: sim.storedStats.spa,
      spDefense: sim.storedStats.spd,
      statStages: [6, 6 + boosts.atk!, 6 + boosts.def!, 6 + boosts.spe!, 6 + boosts.spa!, 6 + boosts.spd!, 6 + boosts.accuracy!, 6 + boosts.evasion!],
      moves: [0, 1, 2, 3].map((i) => (slots[i] ? moveNumber(slots[i]!.id) : 0)),
      pp: [0, 1, 2, 3].map((i) => slots[i]?.pp ?? 0),
      heldItem: sim.item ? T.number('items', mon.heldItem) : 0,
      friendship: mon.friendship,
      weight: Math.round(sim.getWeight() * 10),
      ivs: [mon.ivs.hp, mon.ivs.attack, mon.ivs.defense, mon.ivs.speed, mon.ivs.spAttack, mon.ivs.spDefense],
      status,
      volatile: volatile >>> 0,
      moveEffects: effects,
      disabledMove: v.disable ? moveNumber((v.disable as unknown as { move: string }).move) : 0,
      disabledTurns: v.disable?.duration ?? 0,
      encoredMove: v.encore ? moveNumber((v.encore as unknown as { move: string }).move) : 0,
      encoredTurns: v.encore?.duration ?? 0,
      tauntedTurns: v.taunt?.duration ?? 0,
      embargoTurns: v.embargo?.duration ?? 0,
      magnetRiseTurns: v.magnetrise?.duration ?? 0,
      perishSongTurns: v.perishsong?.duration ?? 0,
      stockpileCount: v.stockpile?.layers ?? 0,
      // The sim clears `used` on entry. Last Resort itself and the controller's pass are not history.
      lastResortCount: new Set(slots.filter((s) => s.used && s.id !== PASS_MOVE && bare(src.packMove(s.id).id, 'MOVE_') !== 'LAST_RESORT').map((s) => s.id)).size,
      protectSuccessTurns: v.stall ? 1 : 0,
      // fakeOutTurnNumber: totalTurns when it came in.
      switchInTurn: src.totalTurns - sim.activeTurns,
      flashFire: !!v.flashfire,
    };
    cache.set(battler, b);
    return b;
  }

  const hasType = (b: AiBattler, type: number) => b.types[0] === type || b.types[1] === type;
  const abilityOf = (battler: number) => abilityName(battlerAbility(view, battler));
  /** Battler_IgnorableAbility: the defender has it and the attacker is no Mold Breaker. */
  const ignorable = (attacker: number, defender: number, ability: string) => abilityOf(attacker) !== 'MOLD_BREAKER' && abilityOf(defender) === ability;
  const heldEffect = (battler: number) => holdEffect(battlerHeldItem(view, battler));
  const heldParam = (battler: number) => holdParam(battlerHeldItem(view, battler));
  const noCloudNine = () => all.every((b) => battlerOf(b).hp === 0 || (abilityOf(b) !== 'CLOUD_NINE' && abilityOf(b) !== 'AIR_LOCK'));
  const countOurSide = (battler: number, ability: string) => [battler].filter((b) => battlerOf(b).hp && abilityOf(b) === ability).length;

  function fieldConditions(): number {
    const f = src.sim.field;
    let mask = 0;
    const w = f.weather as string;
    if (w === 'raindance') mask |= 1;
    else if (w === 'sandstorm') mask |= 1 << 2;
    else if (w === 'sunnyday') mask |= 1 << 4;
    else if (w === 'hail') mask |= 1 << 6;
    else if (w === 'fog') mask |= FIELD_CONDITION.DEEP_FOG;
    if (f.pseudoWeather.gravity) mask |= FIELD_CONDITION.GRAVITY;
    if (f.pseudoWeather.trickroom) mask |= TRICK_ROOM;
    return mask;
  }

  function sideConditions(side: number): number {
    const sc = src.sim.sides[side]!.sideConditions as Record<string, unknown>;
    let mask = 0;
    if (sc.reflect) mask |= SIDE.REFLECT;
    if (sc.lightscreen) mask |= SIDE.LIGHT_SCREEN;
    if (sc.spikes) mask |= SIDE_CONDITION.SPIKES;
    if (sc.safeguard) mask |= SIDE.SAFEGUARD;
    if (sc.mist) mask |= SIDE_CONDITION.MIST;
    if (sc.stealthrock) mask |= SIDE.STEALTH_ROCK;
    if (sc.tailwind) mask |= SIDE.TAILWIND;
    if (sc.toxicspikes) mask |= SIDE_CONDITION.TOXIC_SPIKES;
    if (sc.luckychant) mask |= SIDE.LUCKY_CHANT;
    return mask;
  }

  const layers = (side: number, id: string) => ((src.sim.sides[side]!.sideConditions as Record<string, { layers?: number }>)[id]?.layers ?? 0);

  /** ApplyTypeMultiplier: the damage scaled by one chart row and the MOVE_STATUS flags it raises. */
  function typeMultiplier(mul: number, damage: number, flags: { v: number }, ignore: boolean): number {
    if (!ignore && damage) damage = divide(damage * mul, 10);
    if (mul === 0) flags.v = (flags.v | MOVE_STATUS.INEFFECTIVE) & ~MOVE_STATUS.NOT_VERY_EFFECTIVE & ~MOVE_STATUS.SUPER_EFFECTIVE;
    else if (mul === 5) flags.v = flags.v & MOVE_STATUS.SUPER_EFFECTIVE ? flags.v & ~MOVE_STATUS.SUPER_EFFECTIVE : flags.v | MOVE_STATUS.NOT_VERY_EFFECTIVE;
    else if (mul === 20) flags.v = flags.v & MOVE_STATUS.NOT_VERY_EFFECTIVE ? flags.v & ~MOVE_STATUS.NOT_VERY_EFFECTIVE : flags.v | MOVE_STATUS.SUPER_EFFECTIVE;
    return damage;
  }

  const isStruggle = (n: number) => bare(move(n).id, 'MOVE_') === 'STRUGGLE';
  const damagingTurn = (n: number) => !NON_DAMAGING_TURN.has(bare(move(n).effect, 'BATTLE_EFFECT_'));

  const view: AiBattleView = {
    battleType: src.battleType,
    totalTurns: src.totalTurns,
    get fieldConditions() {
      return fieldConditions();
    },
    memory: src.memory,
    battler: battlerOf,
    sideConditions,
    spikesLayers: (side) => layers(side, 'spikes'),
    toxicSpikesLayers: (side) => layers(side, 'toxicspikes'),
    party(battler) {
      const side = sideOf(battler);
      return side.party.map((mon, i): AiPartyMon => {
        const sim = side.sims[i];
        const form = T.dex.form(mon.species, mon.form);
        const hp = sim ? sim.hp : mon.hp;
        const slots = sim ? sim.baseMoveSlots : null;
        const st = sim ? (sim.status as string) : '';
        return {
          species: T.number('species', mon.species),
          isEgg: mon.isEgg,
          hp,
          maxHp: mon.stats.hp,
          status: st === 'slp' ? 1 : st === 'psn' ? MON_CONDITION.POISON : st === 'brn' ? MON_CONDITION.BURN : st === 'frz' ? MON_CONDITION.FREEZE : st === 'par' ? MON_CONDITION.PARALYSIS : st === 'tox' ? MON_CONDITION.TOXIC : 0,
          moves: [0, 1, 2, 3].map((k) => (mon.moves[k] ? T.number('moves', mon.moves[k]!) : 0)),
          pp: [0, 1, 2, 3].map((k) => slots?.[k]?.pp ?? mon.pp[k] ?? 0),
          maxPp: [0, 1, 2, 3].map((k) => slots?.[k]?.maxpp ?? 0),
          heldItem: T.number('items', mon.heldItem),
          ability: T.number('abilities', mon.ability),
          types: [T.typeNumber(form.types[0]), T.typeNumber(form.types[1])],
          ivs: [mon.ivs.hp, mon.ivs.attack, mon.ivs.defense, mon.ivs.speed, mon.ivs.spAttack, mon.ivs.spDefense],
        };
      });
    },
    selectedPartySlot: (battler) => (exists(battler) ? sideOf(battler).active : 0),
    previousMove(battler) {
      const sim = activeSim(battler);
      return sim?.lastMove ? moveNumber(sim.lastMove.id) : 0;
    },
    lastHitBy(battler) {
      const sim = activeSim(battler);
      const last = sim?.attackedBy[sim.attackedBy.length - 1];
      if (!last?.move) return { move: 0, battler: 0xff };
      return { move: moveNumber(last.move), battler: src.battlerOf ? src.battlerOf(last.source) : last.source.side.n };
    },
    protectMove(battler) {
      const sim = activeSim(battler);
      const last = sim?.lastMove?.id;
      return last === 'protect' || last === 'detect' || last === 'endure' ? moveNumber(last) : 0;
    },
    recycleItem(battler) {
      const item = activeSim(battler)?.lastItem;
      return item ? T.number('items', src.packItem(item)) : 0;
    },
    // The DS mask marks absent/fainted positions, not a submitted voluntary switch command.
    switching: (battler) => !activeSim(battler)?.hp,

    invalidMoves(battler) {
      const b = battlerOf(battler);
      const sim = activeSim(battler)!;
      let mask = 0;
      const prev = view.previousMove(battler);
      const choice = ['CHOICE_ATK', 'CHOICE_SPEED', 'CHOICE_SPATK'].includes(heldEffect(battler));
      const locked = choice && (sim.volatiles as Record<string, { move?: string }>).choicelock?.move;
      const lockedMove = locked ? moveNumber(locked) : 0;
      for (let i = 0; i < 4; i++) {
        const m = b.moves[i]!;
        if (m === 0 || b.pp[i] === 0) mask |= 1 << i;
        if (b.disabledMove && m === b.disabledMove) mask |= 1 << i;
        if (b.volatile & VOLATILE.TORMENT && m === prev) mask |= 1 << i;
        if (b.tauntedTurns && m && move(m).power === 0) mask |= 1 << i;
        if (src.sim.field.pseudoWeather.gravity && m && ['FLY', 'BOUNCE', 'JUMP_KICK', 'HI_JUMP_KICK', 'SPLASH', 'MAGNET_RISE'].includes(bare(move(m).id, 'MOVE_'))) mask |= 1 << i;
        // Move_Imprisoned: a foe under Imprison knows the move.
        if (m && all.some((o) => (o & 1) !== (battler & 1) && activeSim(o)?.volatiles['imprison'] && battlerOf(o).moves.includes(m))) mask |= 1 << i;
        // Move_HealBlocked.
        if (b.moveEffects & EFFECT.HEAL_BLOCK && m && HEAL_BLOCKED.has(bare(move(m).id, 'MOVE_'))) mask |= 1 << i;
        if (b.encoredMove && b.encoredMove !== m) mask |= 1 << i;
        if (lockedMove && lockedMove !== m) mask |= 1 << i;
      }
      return mask;
    },

    speedValue: (battler) => speedValues[battler]!,

    compareSpeed(b1, b2) {
      const x = battlerOf(b1);
      const y = battlerOf(b2);
      if (x.hp === 0 && y.hp) return 1;
      if (x.hp && y.hp === 0) return 0;
      const speedOf = (battler: number, b: AiBattler): number => {
        const ability = abilityOf(battler);
        let stage = b.statStages[3]!;
        if (ability === 'SIMPLE') stage = Math.max(0, Math.min(12, 6 + (stage - 6) * 2));
        let speed = applyStage(b.speed, stage);
        const fc = fieldConditions();
        if (noCloudNine() && ((ability === 'SWIFT_SWIM' && fc & FIELD_CONDITION.RAINING) || (ability === 'CHLOROPHYLL' && fc & FIELD_CONDITION.SUNNY))) speed *= 2;
        // The speed-halving items count even under Klutz or Embargo (the DS reads the raw item).
        if (SPEED_HALVING.has(holdEffect(b.heldItem))) speed = Math.trunc(speed / 2);
        const item = heldEffect(battler);
        if (item === 'CHOICE_SPEED') speed = Math.trunc((speed * 15) / 10);
        if (item === 'DITTO_SPEED_UP' && T.speciesNames.get(b.species) === 'DITTO') speed *= 2;
        if (ability === 'QUICK_FEET' && b.status) speed = Math.trunc((speed * 15) / 10);
        else if (b.status & MON_CONDITION.PARALYSIS) speed = Math.trunc(speed / 4);
        const v = activeSim(battler)!.volatiles as Record<string, unknown>;
        if (ability === 'SLOW_START' && v['slowstart']) speed = Math.trunc(speed / 2);
        if (ability === 'UNBURDEN' && v['unburden'] && !b.heldItem) speed *= 2;
        if (sideConditions(battler & 1) & SIDE.TAILWIND) speed *= 2;
        return speed;
      };
      /** Quick Claw's roll (speedRand % (100 / param) == 0), or a Custap Berry at 1/param HP (Gluttony: param / 2). */
      const quick = (battler: number, b: AiBattler): boolean => {
        const item = heldEffect(battler);
        let param = heldParam(battler);
        if (item === 'SOMETIMES_PRIORITY') return src.speedRand[battler]! % Math.trunc(100 / param) === 0;
        if (item !== 'PINCH_PRIORITY') return false;
        if (abilityOf(battler) === 'GLUTTONY') param = Math.trunc(param / 2);
        return b.hp <= Math.trunc(b.maxHp / param);
      };
      const s1 = speedOf(b1, x);
      const s2 = speedOf(b2, y);
      speedValues[b1] = s1;
      speedValues[b2] = s2;
      const quick1 = quick(b1, x);
      const quick2 = quick(b2, y);
      const lag1 = heldEffect(b1) === 'PRIORITY_DOWN';
      const lag2 = heldEffect(b2) === 'PRIORITY_DOWN';
      const a1 = abilityOf(b1);
      const a2 = abilityOf(b2);
      const tie = () => (src.rng.next() & 1 ? 2 : 0);
      // The AI compares with ignoreQuickClaw: move priorities count as equal, the Quick Claw roll still counts.
      if (quick1 && quick2) return s1 < s2 ? 1 : s1 === s2 ? tie() : 0;
      if (quick1 !== quick2) return quick2 ? 1 : 0;
      if (lag1 && lag2) return s1 > s2 ? 1 : s1 === s2 ? tie() : 0;
      if (lag1 !== lag2) return lag1 ? 1 : 0;
      if (a1 === 'STALL' && a2 === 'STALL') return s1 > s2 ? 1 : s1 === s2 ? tie() : 0;
      if ((a1 === 'STALL') !== (a2 === 'STALL')) return a1 === 'STALL' ? 1 : 0;
      if (fieldConditions() & TRICK_ROOM) {
        const r = s1 > s2 ? 1 : 0;
        return s1 === s2 && src.rng.next() & 1 ? 2 : r;
      }
      const r = s1 < s2 ? 1 : 0;
      return s1 === s2 && src.rng.next() & 1 ? 2 : r;
    },

    applyTypeChart(n, inType, attacker, defender, damage, ignoreTypeChecks) {
      const flags = { v: 0 };
      if (isStruggle(n)) return { damage, flags: 0 };
      const a = battlerOf(attacker);
      const d = battlerOf(defender);
      const moveType = abilityOf(attacker) === 'NORMALIZE' ? T.normal : inType || T.typeNumber(move(n).type);
      const power = move(n).power;
      if (!ignoreTypeChecks && hasType(a, moveType)) damage = abilityOf(attacker) === 'ADAPTABILITY' ? damage * 2 : Math.trunc((damage * 15) / 10);
      const defItem = heldEffect(defender);
      if (ignorable(attacker, defender, 'LEVITATE') && typeName(moveType) === 'GROUND' && defItem !== 'SPEED_DOWN_GROUNDED') flags.v |= MOVE_STATUS.LEVITATED;
      else if (d.magnetRiseTurns && !(d.moveEffects & MOVE_EFFECT.INGRAIN) && typeName(moveType) === 'GROUND' && defItem !== 'SPEED_DOWN_GROUNDED') flags.v |= MOVE_STATUS.MAGNET_RISE;
      else {
        const applies = (def: number, mul: number) =>
          !((defItem === 'SPEED_DOWN_GROUNDED' || d.moveEffects & MOVE_EFFECT.INGRAIN) && typeName(def) === 'FLYING' && mul === 0) &&
          !(fieldConditions() & FIELD_CONDITION.GRAVITY && typeName(def) === 'FLYING' && mul === 0) &&
          !(d.moveEffects & EFFECT.MIRACLE_EYE && typeName(def) === 'DARK' && mul === 0);
        for (const [atk, def, mul, foresight] of T.chart) {
          if (foresight && (d.volatile & VOLATILE.FORESIGHT || abilityOf(attacker) === 'SCRAPPY')) break;
          if (atk !== moveType) continue;
          if (def === d.types[0] && applies(def, mul)) damage = typeMultiplier(mul, damage, flags, ignoreTypeChecks);
          if (def === d.types[1] && d.types[0] !== d.types[1] && applies(def, mul)) damage = typeMultiplier(mul, damage, flags, ignoreTypeChecks);
        }
      }
      if (ignorable(attacker, defender, 'WONDER_GUARD') && damagingTurn(n) && (!(flags.v & MOVE_STATUS.SUPER_EFFECTIVE) || (flags.v & MOVE_STATUS_BASIC_EFFECTIVENESS) === MOVE_STATUS_BASIC_EFFECTIVENESS) && power) {
        flags.v |= MOVE_STATUS.WONDER_GUARD;
      } else if (!ignoreTypeChecks) {
        if (flags.v & MOVE_STATUS.SUPER_EFFECTIVE && power) {
          if (ignorable(attacker, defender, 'FILTER') || ignorable(attacker, defender, 'SOLID_ROCK')) damage = divide(damage * 3, 4);
          if (heldEffect(attacker) === 'POWER_UP_SE') damage = Math.trunc((damage * (100 + heldParam(attacker))) / 100);
        }
        if (flags.v & MOVE_STATUS.NOT_VERY_EFFECTIVE && power && abilityOf(attacker) === 'TINTED_LENS') damage *= 2;
      } else flags.v &= ~MOVE_STATUS_BASIC_EFFECTIVENESS;
      return { damage, flags: flags.v };
    },

    calcEffectiveness(n, inType, attackerAbility, defenderAbility, defenderHoldEffect, t1, t2) {
      const flags = { v: 0 };
      if (isStruggle(n)) return 0;
      const atkAbility = abilityName(attackerAbility);
      const defAbility = abilityName(defenderAbility);
      const holdName = reg.aiScripts.size ? [...reg.aiScripts.values()][0]!.holdEffects[defenderHoldEffect] ?? '' : '';
      const moveType = atkAbility === 'NORMALIZE' ? T.normal : inType || T.typeNumber(move(n).type);
      const gravity = fieldConditions() & FIELD_CONDITION.GRAVITY;
      if (atkAbility !== 'MOLD_BREAKER' && defAbility === 'LEVITATE' && typeName(moveType) === 'GROUND' && !gravity && holdName !== 'SPEED_DOWN_GROUNDED') {
        flags.v |= MOVE_STATUS.INEFFECTIVE;
      } else {
        const noOverride = (def: number, mul: number) => !((holdName === 'SPEED_DOWN_GROUNDED' || gravity) && typeName(def) === 'FLYING' && mul === 0);
        for (const [atk, def, mul, foresight] of T.chart) {
          if (foresight && atkAbility === 'SCRAPPY') break;
          if (atk !== moveType) continue;
          if (def === t1 && noOverride(def, mul)) typeMultiplier(mul, 0, flags, true);
          if (def === t2 && t1 !== t2 && noOverride(def, mul)) typeMultiplier(mul, 0, flags, true);
        }
      }
      if (atkAbility !== 'MOLD_BREAKER' && defAbility === 'WONDER_GUARD' && damagingTurn(n) && (!(flags.v & MOVE_STATUS.SUPER_EFFECTIVE) || (flags.v & MOVE_STATUS_BASIC_EFFECTIVENESS) === MOVE_STATUS_BASIC_EFFECTIVENESS)) {
        flags.v |= MOVE_STATUS.INEFFECTIVE;
      }
      return flags.v;
    },

    calcMoveDamage(n, attacker, defender, inPower, inType) {
      const m = move(n);
      const a = battlerOf(attacker);
      const d = battlerOf(defender);
      const aAbility = abilityOf(attacker);
      const aItem = heldEffect(attacker);
      const aParam = heldParam(attacker);
      const dItem = heldEffect(defender);
      const fc = fieldConditions();
      const sc = sideConditions(defender & 1);
      let attack = a.attack;
      let defense = d.defense;
      let spAttack = a.spAttack;
      let spDefense = d.spDefense;
      let atkStage = a.statStages[1]! - 6;
      let defStage = d.statStages[2]! - 6;
      let spaStage = a.statStages[4]! - 6;
      let spdStage = d.statStages[5]! - 6;
      let power = inPower || m.power;
      const moveType = aAbility === 'NORMALIZE' ? T.normal : inType === T.normal ? T.typeNumber(m.type) : inType & 0x3f;
      power = Math.trunc((power * src.powerMul) / 10);
      const typeIs = (name: string) => typeName(moveType) === name;
      const speciesIs = (b: AiBattler, ...names: string[]) => names.includes(T.speciesNames.get(b.species) ?? '');
      if (a.moveEffects & EFFECT.CHARGE && typeIs('ELECTRIC')) power *= 2;
      if (aAbility === 'TECHNICIAN' && !isStruggle(n) && power <= 60) power = Math.trunc((power * 15) / 10);
      const cls = m.category;
      if (aAbility === 'HUGE_POWER' || aAbility === 'PURE_POWER') attack *= 2;
      if (STRENGTHEN[aItem] && typeIs(STRENGTHEN[aItem]!)) power = Math.trunc((power * (100 + aParam)) / 100);
      if (aItem === 'CHOICE_ATK') attack = Math.trunc((attack * 150) / 100);
      if (aItem === 'CHOICE_SPATK') spAttack = Math.trunc((spAttack * 150) / 100);
      if (aItem === 'LATI_SPECIAL' && !(src.battleType & BATTLE_TYPE.FRONTIER) && speciesIs(a, 'LATIOS', 'LATIAS')) spAttack = Math.trunc((spAttack * 150) / 100);
      if (dItem === 'LATI_SPECIAL' && !(src.battleType & BATTLE_TYPE.FRONTIER) && speciesIs(d, 'LATIOS', 'LATIAS')) spDefense = Math.trunc((spDefense * 150) / 100);
      if (aItem === 'CLAMPERL_SPATK' && speciesIs(a, 'CLAMPERL')) spAttack *= 2;
      if (dItem === 'CLAMPERL_SPDEF' && speciesIs(d, 'CLAMPERL')) spDefense *= 2;
      if (aItem === 'PIKA_SPATK_UP' && speciesIs(a, 'PIKACHU')) power *= 2;
      if (dItem === 'DITTO_DEF_UP' && speciesIs(d, 'DITTO')) defense *= 2;
      if (aItem === 'CUBONE_ATK_UP' && speciesIs(a, 'CUBONE', 'MAROWAK')) attack *= 2;
      if (aItem === 'DIALGA_BOOST' && (typeIs('DRAGON') || typeIs('STEEL')) && speciesIs(a, 'DIALGA')) power = Math.trunc((power * (100 + aParam)) / 100);
      if (aItem === 'PALKIA_BOOST' && (typeIs('DRAGON') || typeIs('WATER')) && speciesIs(a, 'PALKIA')) power = Math.trunc((power * (100 + aParam)) / 100);
      if (aItem === 'GIRATINA_BOOST' && (typeIs('DRAGON') || typeIs('GHOST')) && !(a.volatile & VOLATILE.TRANSFORM) && speciesIs(a, 'GIRATINA')) power = Math.trunc((power * (100 + aParam)) / 100);
      if (aItem === 'POWER_UP_PHYS' && cls === 'physical') power = Math.trunc((power * (100 + aParam)) / 100);
      if (aItem === 'POWER_UP_SPEC' && cls === 'special') power = Math.trunc((power * (100 + aParam)) / 100);
      if (ignorable(attacker, defender, 'THICK_FAT') && (typeIs('FIRE') || typeIs('ICE'))) power = Math.trunc(power / 2);
      if (aAbility === 'HUSTLE') attack = Math.trunc((attack * 150) / 100);
      if (aAbility === 'GUTS' && a.status) attack = Math.trunc((attack * 150) / 100);
      if (ignorable(attacker, defender, 'MARVEL_SCALE') && d.status) defense = Math.trunc((defense * 150) / 100);
      if (aAbility === 'PLUS' && countOurSide(attacker ^ 2, 'MINUS')) spAttack = Math.trunc((spAttack * 150) / 100);
      if (aAbility === 'MINUS' && countOurSide(attacker ^ 2, 'PLUS')) spAttack = Math.trunc((spAttack * 150) / 100);
      const anyEffect = (bit: number) => all.some((b) => battlerOf(b).moveEffects & bit);
      if (typeIs('ELECTRIC') && anyEffect(EFFECT.MUD_SPORT)) power = Math.trunc(power / 2);
      if (typeIs('FIRE') && anyEffect(EFFECT.WATER_SPORT)) power = Math.trunc(power / 2);
      const pinch = a.hp <= Math.trunc(a.maxHp / 3);
      if (pinch && ((typeIs('GRASS') && aAbility === 'OVERGROW') || (typeIs('FIRE') && aAbility === 'BLAZE') || (typeIs('WATER') && aAbility === 'TORRENT') || (typeIs('BUG') && aAbility === 'SWARM'))) {
        power = Math.trunc((power * 150) / 100);
      }
      if (typeIs('FIRE') && ignorable(attacker, defender, 'HEATPROOF')) power = Math.trunc(power / 2);
      if (typeIs('FIRE') && ignorable(attacker, defender, 'DRY_SKIN')) power = Math.trunc((power * 125) / 100);
      const clamp = (s: number) => Math.max(-6, Math.min(6, s));
      if (aAbility === 'SIMPLE') {
        atkStage = clamp(atkStage * 2);
        spaStage = clamp(spaStage * 2);
      }
      if (ignorable(attacker, defender, 'SIMPLE')) {
        defStage = clamp(defStage * 2);
        spdStage = clamp(spdStage * 2);
      }
      if (ignorable(attacker, defender, 'UNAWARE')) atkStage = spaStage = 0;
      if (aAbility === 'UNAWARE') defStage = spdStage = 0;
      if (aAbility === 'RIVALRY' && a.gender !== 2 && d.gender !== 2) power = Math.trunc((power * (a.gender === d.gender ? 125 : 75)) / 100);
      if (aAbility === 'IRON_FIST' && PUNCHING.has(bare(m.id, 'MOVE_'))) power = Math.trunc((power * 12) / 10);
      if (noCloudNine()) {
        if (fc & FIELD_CONDITION.SUNNY && aAbility === 'SOLAR_POWER') spAttack = Math.trunc((spAttack * 15) / 10);
        if (fc & FIELD_CONDITION.SANDSTORM && (typeName(d.types[0]) === 'ROCK' || typeName(d.types[1]) === 'ROCK')) spDefense = Math.trunc((spDefense * 15) / 10);
        if (fc & FIELD_CONDITION.SUNNY && countOurSide(attacker, 'FLOWER_GIFT')) attack = Math.trunc((attack * 15) / 10);
        if (fc & FIELD_CONDITION.SUNNY && aAbility !== 'MOLD_BREAKER' && countOurSide(defender, 'FLOWER_GIFT')) spDefense = Math.trunc((spDefense * 15) / 10);
      }
      if (bare(m.effect, 'BATTLE_EFFECT_') === 'HALVE_DEFENSE') defense = Math.trunc(defense / 2);
      // u16 stats, as the DS keeps them.
      attack &= 0xffff;
      defense &= 0xffff;
      spAttack &= 0xffff;
      spDefense &= 0xffff;
      power &= 0xffff;
      const levelFactor = Math.trunc((a.level * 2) / 5) + 2;
      let damage = 0;
      const screens = bare(m.effect, 'BATTLE_EFFECT_') !== 'REMOVE_SCREENS';
      const doubles = !!(src.battleType & BATTLE_TYPE.DOUBLES);
      const defenders = all.filter((b) => (b & 1) === (defender & 1) && battlerOf(b).hp > 0).length;
      const screenDamage = (n: number) => doubles && defenders === 2 ? Math.trunc((n * 2) / 3) : Math.trunc(n / 2);
      if (cls === 'physical') {
        damage = Math.trunc(Math.trunc(Math.trunc(applyStage(attack, atkStage + 6) * power * levelFactor) / applyStage(defense, defStage + 6)) / 50);
        if (a.status & MON_CONDITION.BURN && aAbility !== 'GUTS') damage = Math.trunc(damage / 2);
        if (sc & SIDE.REFLECT && screens) damage = screenDamage(damage);
      } else if (cls === 'special') {
        damage = Math.trunc(Math.trunc(Math.trunc(applyStage(spAttack, spaStage + 6) * power * levelFactor) / applyStage(spDefense, spdStage + 6)) / 50);
        if (sc & SIDE.LIGHT_SCREEN && screens) damage = screenDamage(damage);
      }
      const range = m.target;
      if (doubles && (range === 'ADJACENT_OPPONENTS' && defenders === 2
        || range === 'ALL_ADJACENT' && all.filter((b) => b !== defender && battlerOf(b).hp > 0).length >= 2)) {
        damage = Math.trunc((damage * 3) / 4);
      }
      if (noCloudNine()) {
        if (fc & FIELD_CONDITION.RAINING) {
          if (typeIs('FIRE')) damage = Math.trunc(damage / 2);
          else if (typeIs('WATER')) damage = Math.trunc((damage * 15) / 10);
        }
        if (fc & (FIELD_CONDITION.RAINING | FIELD_CONDITION.SANDSTORM | FIELD_CONDITION.HAILING) && bare(m.id, 'MOVE_') === 'SOLAR_BEAM') damage = Math.trunc(damage / 2);
        if (fc & FIELD_CONDITION.SUNNY) {
          if (typeIs('FIRE')) damage = Math.trunc((damage * 15) / 10);
          else if (typeIs('WATER')) damage = Math.trunc(damage / 2);
        }
      }
      if (a.flashFire && typeIs('FIRE')) damage = Math.trunc((damage * 15) / 10);
      return damage + 2;
    },

    typeMatchup(attacking, d1, d2) {
      let mul = 40;
      for (const [atk, def, m] of T.chart) {
        if (atk !== attacking) continue;
        if (def === d1) mul = Math.trunc((mul * m) / 10);
        if (def === d2 && d1 !== d2) mul = Math.trunc((mul * m) / 10);
      }
      return mul;
    },
  };
  return view;
}
