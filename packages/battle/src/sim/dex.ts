/**
 * The `gen4os` dex mod: @pkmn/sim's gen 4 data with the packs' records written over it, so the ROM and
 * mods are authoritative for numbers (base stats, types, power, accuracy, PP, priority) and Showdown supplies
 * behaviour by move, ability and item id. Records the sim does not know (the fixture's original creatures,
 * mod additions) become custom entries; a custom move's behaviour comes from its decomp battle effect where
 * we map it, otherwise it is a plain hit and the effect is logged as a stub.
 *
 * Also the hidden "pass" move, which the controller gives a battler for a turn spent outside the sim (a failed run, a
 * bag item, a trainer's item), so the others still act. It never runs: its before-turn callback takes it out of the
 * queue, so no move-time effect sees it (Taunt, a Choice lock, sleep, paralysis or confusion would stop or hurt it,
 * Encore would replace it, and it would become the battler's last move for Mimic, Sketch and Copycat; on the DS an
 * item turn is no move).
 */
import { Battle, Dex, toID } from '@pkmn/sim';
import { monGender, type Dex as MonDex, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type BattleKind, type BattleWeather, type Move, type Registries, type StubLog } from '@opensinnoh/contracts';
import { accuracyAbilities, accuracyItems, accuracyMoves, accuracyScripts } from './accuracy.ts';
import { substitute } from './substitute.ts';
import { skilllink } from './multihit.ts';
import { pursuit } from './pursuit.ts';

export const PASS_MOVE = 'opensinnohpass';
/** A roamer's escape (the controller runs it itself): the lowest priority, so it comes after the player's command. */
export const ESCAPE_MOVE = 'opensinnohescape';

/**
 * The ROM import's namespace: its species and moves must all map to the sim's (by decomp name, with the
 * renames below); an unknown one throws instead of becoming a custom entry. The listed species are not
 * Pokémon and never battle.
 */
const ROM_NAMESPACE = 'platinum';
const ROM_NOT_POKEMON = new Set(['SPECIES_NONE', 'SPECIES_EGG', 'SPECIES_BAD_EGG']);

/** Decomp names that Showdown's ids and aliases miss (ROM test: every ROM move maps). */
const MOVE_RENAMES: Record<string, string> = { SMELLING_SALT: 'smellingsalts' };

/** Decomp RANGE_* → Showdown targets, for custom moves. */
const TARGETS: Record<string, string> = {
  SINGLE_TARGET: 'normal',
  SINGLE_TARGET_ME_FIRST: 'normal',
  ALL_ADJACENT: 'allAdjacent',
  ADJACENT_OPPONENTS: 'allAdjacentFoes',
  RANDOM_OPPONENT: 'randomNormal',
  USER: 'self',
  USER_SIDE: 'allySide',
  OPPONENT_SIDE: 'foeSide',
  FIELD: 'all',
  ALLY: 'adjacentAlly',
  USER_OR_ALLY: 'adjacentAllyOrSelf',
};

const STAT_EFFECTS: Record<string, [boolean, string, number]> = {
  LOWER_ATTACK: [false, 'atk', -1],
  LOWER_DEFENSE: [false, 'def', -1],
  LOWER_SPEED: [false, 'spe', -1],
  LOWER_ACCURACY: [false, 'accuracy', -1],
  RAISE_ATTACK: [true, 'atk', 1],
  RAISE_DEFENSE: [true, 'def', 1],
  RAISE_SPEED: [true, 'spe', 1],
};

/** The pack ↔ sim id maps of one set of registries. */
export interface SimData {
  /**
   * A simulator battle bound to this pack's private dex. The first battle and the catching tutorial have no
   * critical hits (decomp BtlCmd_CalcCrit returns 1 for both); the tutorial's moves also never miss
   * (BattleControllerPlayer_CheckMoveHitAccuracy). `gameType` 'multi' (0.25.0): four sides, one battler each
   * (p1 the player, p2 and p4 the enemies, p3 the AI partner). 'doubles' (0.27.1): two sides with two out each
   * (trainer doubles, type 3; two enemy trainers in one sim side, type 19).
   */
  /**
   * A battle on this pack's dex. `weather` is the field condition at entry; `rules` are extra format
   * callbacks (the controller's faint snapshot).
   */
  createBattle(kind: BattleKind, gameType: SimGameType, options: Omit<ConstructorParameters<typeof Battle>[0], 'format' | 'formatid'>, extra?: { weather?: BattleWeather; rules?: object }): Battle;
  /** The sim species (the forme for a form that has its own types or stats). */
  species(id: Id, form?: number): string;
  move(id: Id): string;
  /** The pack move behind a sim move id (protocol lines name moves by their sim name). */
  packMove(simName: string): Move;
  ability(id: Id | null): string;
  /**
   * The sim item name, '' for none. An item the sim lacks is inert in its battle when its hold effect is
   * NONE or one that acts outside the sim (`OUTSIDE_SIM`); any other is a logged stub.
   */
  item(id: Id | null): string;
  /** The pack item behind a sim item id (what a Pokémon holds after a battle). */
  packItem(simId: string): Id;
  /** Sim nature name with the same raised and lowered stats. */
  nature(up: string | null, down: string | null): string;
}

export type SimGameType = 'singles' | 'doubles' | 'multi';

/**
 * The owner of a sim Pokémon when one sim side holds two owners' parties (two enemy trainers against the player
 * alone, type 19: the enemy side holds both rosters). Absent for every other battle: a side is one owner.
 * Beat Up, Assist, Heal Bell and Aromatherapy scan the user's owner's party only (decomp BattleSystem_GetParty by
 * battler in TAG battles).
 */
export const simOwners = new WeakMap<object, number>();
const sameOwner = (a: object, b: object) => simOwners.get(a) === simOwners.get(b);

const built = new WeakMap<Registries, SimData>();
let mods = 0;

/**
 * A pack dex belongs to its registries and battles, not Showdown's process-wide mod directory.
 * The factory below supplies only this dex's formats. Parent-generation lookups stay shared.
 */
class PackDex extends Dex.ModdedDex {
  override forFormat(): this { return this; }
  override mod(mod: string | undefined, modData?: Parameters<typeof Dex.mod>[1]): typeof Dex {
    if (mod === this.currentMod) return this;
    return super.mod(mod, modData);
  }
}

/** Strips the namespace and a decomp prefix: `platinum:MOVE_TACKLE` → `TACKLE`. */
const bare = (id: Id, prefix: string) => {
  const name = id.slice(id.indexOf(':') + 1);
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
};

/**
 * Hold effects of items the sim's gen 4 lacks that act outside the battle engine: the controller applies
 * them (exp, prize money, friendship, escape) or the field does (encounters, evolution). Every ROM item the
 * sim lacks has one of these or none (ROM test).
 */
export const OUTSIDE_SIM = new Set(['NONE', 'EXP_SHARE', 'EXP_UP', 'MONEY_UP', 'FRIENDSHIP_UP', 'FLEE', 'ENCOUNTERS_DOWN', 'NO_EVOLVE']);

/**
 * Moves that take or swap held items fail for the enemy side outside the Battle Frontier (decomp
 * BtlCmd_TryStealItem and BtlCmd_TrySwapItems: "AI trainers are unable to steal items"); wild Pokémon are
 * on that side too. Thief and Covet still hit, they only take nothing; Trick and Switcheroo fail.
 */
const STEAL_MOVES = ['thief', 'covet'];
const SWAP_MOVES = ['trick', 'switcheroo'];

const STAT_KEYS = { hp: 'hp', attack: 'atk', defense: 'def', speed: 'spe', spAttack: 'spa', spDefense: 'spd' } as const;

export function simData(reg: Registries, log: StubLog): SimData {
  const cached = built.get(reg);
  if (cached) return cached;
  const gen4 = Dex.forGen(4);
  const typeName = (id: Id) => {
    const t = gen4.types.get(toID(bare(id, 'TYPE_')));
    if (t.exists) return t.name;
    if (bare(id, 'TYPE_') === 'MYSTERY') return '???';
    throw new Error(`battle: type ${id} has no sim type`);
  };
  const stats = (s: Record<keyof typeof STAT_KEYS, number>) => Object.fromEntries(Object.entries(STAT_KEYS).map(([k, v]) => [v, s[k as keyof typeof STAT_KEYS]]));

  const fromRom = (id: Id) => id.startsWith(`${ROM_NAMESPACE}:`);
  const Pokedex: Record<string, unknown> = {};
  const speciesIds = new Map<Id, string>();
  /** `species#form` → the sim forme, for forms that are formes in the sim. */
  const formIds = new Map<string, string>();
  let customNum = 10000;
  for (const s of reg.species.values()) {
    const simId = toID(bare(s.id, 'SPECIES_'));
    const known = gen4.species.get(simId);
    const types = [...new Set(s.types.map(typeName))];
    if (known.exists && known.num > 0) {
      Pokedex[known.id] = { inherit: true, baseStats: stats(s.baseStats), types };
      speciesIds.set(s.id, known.id);
      for (const f of s.forms ?? []) {
        // A form with its own types or stats is one of the sim's other formes: the one in the same place
        // (decomp form order), else the one with the same types (Arceus); a form like its base (cloaks,
        // seas, Unown) is the base species.
        const fTypes = [...new Set(f.types.map(typeName))];
        const same = (t: readonly string[]) => t.length === fTypes.length && t.every((x, i) => x === fTypes[i]);
        const formes = (known.otherFormes ?? []).map((n) => gen4.species.get(n));
        const forme = (formes[f.form - 1] && same(formes[f.form - 1]!.types) ? formes[f.form - 1] : formes.find((x) => same(x.types))) ?? null;
        if (forme) {
          Pokedex[forme.id] = { inherit: true, baseStats: stats(f.baseStats), types: fTypes };
          formIds.set(`${s.id}#${f.form}`, forme.id);
        } else if (!same(types) || JSON.stringify(f.baseStats) !== JSON.stringify(s.baseStats)) {
          if (fromRom(s.id)) throw new Error(`battle: the ROM form ${s.id} #${f.form} maps to no sim forme`);
          log.stub(`battle:form:${s.id}#${f.form}`, 'no sim forme with its types: it battles as the base species');
        }
      }
    } else if (fromRom(s.id)) {
      if (!ROM_NOT_POKEMON.has(bare(s.id, ''))) throw new Error(`battle: the ROM species ${s.id} maps to no sim species`);
    } else if (toID(s.name)) {
      const name = s.name.charAt(0) + s.name.slice(1).toLowerCase();
      Pokedex[toID(name)] = { num: customNum++, name, types, baseStats: stats(s.baseStats), abilities: { 0: 'No Ability' }, heightm: 1, weightkg: 10, color: 'Gray', eggGroups: ['Undiscovered'] };
      speciesIds.set(s.id, toID(name));
    }
  }

  const Moves: Record<string, unknown> = {
    [PASS_MOVE]: {
      num: -1000,
      name: 'OpenSinnoh Pass',
      type: 'Normal',
      category: 'Status',
      basePower: 0,
      accuracy: true,
      pp: 1,
      noPPBoosts: true,
      priority: 6,
      target: 'self',
      // Not one Assist may call from an ally's slots while the slot is there.
      flags: { noassist: 1 },
      beforeTurnCallback(this: Battle, pokemon: unknown) {
        if (!this.queue.cancelMove(pokemon as never)) throw new Error('battle: the pass move is not in the queue');
      },
      onTryMove: () => {
        throw new Error('battle: the pass move ran (its before-turn callback cancels it)');
      },
    },
    [ESCAPE_MOVE]: { num: -1001, name: 'OpenSinnoh Escape', type: 'Normal', category: 'Status', basePower: 0, accuracy: true, pp: 1, noPPBoosts: true, priority: -8, target: 'self', flags: {}, onTryMove: () => null },
  };
  const moveIds = new Map<Id, string>();
  const packMoves = new Map<string, Move>();
  for (const m of reg.moves.values()) {
    const name = bare(m.id, 'MOVE_');
    const simId = MOVE_RENAMES[name] ?? toID(name);
    const known = gen4.moves.get(simId);
    const numbers = {
      // The ROM keeps power 0/1 for moves whose power the battle computes; the sim's callbacks own those.
      ...(m.power > 1 ? { basePower: m.power } : {}),
      accuracy: m.accuracy === 0 ? true : m.accuracy,
      pp: m.pp,
      priority: m.priority,
      type: typeName(m.type),
    };
    if (known.exists && known.num > 0) {
      Moves[known.id] = { inherit: true, ...numbers };
      moveIds.set(m.id, known.id);
      packMoves.set(known.id, m);
      continue;
    }
    if (fromRom(m.id)) throw new Error(`battle: the ROM move ${m.id} maps to no sim move`);
    const id = toID(m.name);
    const effect = bare(m.effect, 'BATTLE_EFFECT_');
    const custom: Record<string, unknown> = {
      num: -1 - moveIds.size,
      name: m.name,
      category: m.category === 'physical' ? 'Physical' : m.category === 'special' ? 'Special' : 'Status',
      basePower: m.power,
      target: TARGETS[m.target] ?? 'normal',
      flags: { protect: 1, ...(m.flags.includes('MAKES_CONTACT') ? { contact: 1 } : {}) },
      ...numbers,
    };
    const stat = STAT_EFFECTS[effect];
    if (stat) {
      const [self, key, n] = stat;
      if (self) custom.self = { boosts: { [key]: n } };
      else custom.boosts = { [key]: n };
      if (self) custom.target = 'self';
    } else if (effect !== 'HIT') log.stub(`battle:move-effect:${effect}`, `custom move ${m.id}: effect not mapped, it only deals damage`);
    Moves[id] = custom;
    moveIds.set(m.id, id);
    packMoves.set(id, m);
  }

  /** The enemy sides: p2 (and p4 in multi), the odd DS battlers. */
  type Side = { side: { n: number } };
  const enemy = (source: Side) => (source.side.n & 1) === 1;
  for (const id of STEAL_MOVES) {
    const take = gen4.moves.get(id).onAfterHit as unknown as (this: unknown, target: Side, source: Side, move: unknown) => unknown;
    Moves[id] = {
      inherit: true,
      ...(Moves[id] as object | undefined),
      onAfterHit(this: unknown, target: Side, source: Side, move: unknown) {
        return enemy(source) ? undefined : take.call(this, target, source, move);
      },
    };
  }
  // Decomp BtlCmd_TryPartyStatusRefresh: Heal Bell and Aromatherapy cure the user's party and its partner battler
  // in the field. With an AI partner (multi) the sim also cures the partner's whole party; this keeps the
  // partner's bench out (singles have no ally side: unchanged).
  type Ally = { isActive: boolean; hasAbility(a: string): boolean; cureStatus(silent: boolean): void; clearStatus(): void };
  type Team = { side: { pokemon: Ally[]; allySide: { active: Ally[] } | null } };
  const party = (target: Team, source: Ally) => [...target.side.pokemon, ...(target.side.allySide?.active ?? [])].filter((p) => sameOwner(p, source));
  Moves['healbell'] = {
    inherit: true,
    ...(Moves['healbell'] as object | undefined),
    onHit(this: { add(...a: unknown[]): void; suppressingAbility(p: Ally): boolean }, target: Team, source: Ally) {
      this.add('-activate', source, 'move: Heal Bell');
      for (const ally of party(target, source)) {
        if (ally.hasAbility('soundproof') && !this.suppressingAbility(ally)) {
          if (ally.isActive) this.add('-immune', ally, '[from] ability: Soundproof');
          continue;
        }
        ally.cureStatus(true);
      }
    },
  };
  Moves['aromatherapy'] = {
    inherit: true,
    ...(Moves['aromatherapy'] as object | undefined),
    onHit(this: { add(...a: unknown[]): void }, target: Team, source: Ally) {
      this.add('-cureteam', source, '[from] move: Aromatherapy');
      for (const ally of party(target, source)) ally.clearStatus();
    },
  };
  // Beat Up and Assist as gen 4 has them, with the party scan kept to the user's owner (type 19; see simOwners).
  type Mon = { side: { pokemon: Mon[] }; fainted: boolean; status: string; moveSlots: { id: string }[]; volatiles: Record<string, unknown>; addVolatile(id: string): void };
  Moves['beatup'] = {
    inherit: true,
    ...(Moves['beatup'] as object | undefined),
    onModifyMove(move: { type: string; category: string; allies?: Mon[]; multihit?: number }, pokemon: Mon) {
      pokemon.addVolatile('beatup');
      move.type = '???';
      move.category = 'Physical';
      move.allies = pokemon.side.pokemon.filter((ally) => !ally.fainted && !ally.status && sameOwner(ally, pokemon));
      move.multihit = move.allies.length;
    },
  };
  Moves['assist'] = {
    inherit: true,
    ...(Moves['assist'] as object | undefined),
    onHit(this: { dex: { moves: { get(id: string): { flags: Record<string, number> } } }; field: { pseudoWeather: Record<string, unknown> }; sample<T>(a: T[]): T; actions: { useMove(m: string, p: Mon): void } }, target: Mon) {
      const moves: string[] = [];
      for (const pokemon of target.side.pokemon) {
        if (pokemon === target || !sameOwner(pokemon, target)) continue;
        for (const slot of pokemon.moveSlots) {
          const move = this.dex.moves.get(slot.id);
          if (move.flags['noassist'] || (this.field.pseudoWeather['gravity'] && move.flags['gravity']) || (target.volatiles['healblock'] && move.flags['heal'])) continue;
          moves.push(slot.id);
        }
      }
      const pick = moves.length ? this.sample(moves) : '';
      if (!pick) return false;
      this.actions.useMove(pick, target);
    },
  };
  for (const id of SWAP_MOVES) Moves[id] ={ inherit: true, ...(Moves[id] as object | undefined), onTryHit: (_target: Side, source: Side) => (enemy(source) ? false : undefined) };

  const dexOfItems = dexOf(reg);
  const packItems = new Map<string, Id>();
  for (const i of reg.items.values()) {
    const known = gen4.items.get(toID(bare(i.id, 'ITEM_')));
    if (known.exists && known.num > 0) packItems.set(known.id, i.id);
  }

  // Fog is a weather condition so the sim's Cloud Nine/Air Lock suppression applies to its hooks.
  const Conditions = {
    fog: {
      name: 'Fog', effectType: 'Weather',
      onModifyAccuracyPriority: 7.5,
      onModifyAccuracy(accuracy: number | true) {
        if (typeof accuracy === 'number') return Math.floor(accuracy * 6 / 10);
      },
      onBasePower(this: Battle, _power: number, _source: unknown, _target: unknown, move: { id: string }) {
        if (move.id === 'solarbeam') return this.chainModify(0.5);
      },
      onFieldStart(this: Battle) { this.add('-weather', 'Fog'); },
      onFieldResidualOrder: 1,
      onFieldResidual(this: Battle) { this.add('-weather', 'Fog', '[upkeep]'); },
      onFieldEnd(this: Battle) { this.add('-weather', 'none'); },
    },
  };
  const defog = gen4.moves.get('defog').onHit as Exclude<NonNullable<ReturnType<typeof gen4.moves.get>['onHit']>, boolean>;
  Moves['defog'] = { inherit: true, ...(Moves['defog'] as object | undefined), onHit(this: Battle, ...args: Parameters<typeof defog>) {
    const result = defog.apply(this, args);
    if (this.field.weather === 'fog') {
      this.add('-message', 'opensinnoh-defog', args[1], 'Defog');
      this.field.clearWeather();
    }
    return result;
  } };
  const weatherBall = gen4.moves.get('weatherball').onModifyMove!;
  Moves['weatherball'] = { inherit: true, ...(Moves['weatherball'] as object | undefined), onModifyMove(this: Battle, ...args: Parameters<typeof weatherBall>) {
    weatherBall.apply(this, args);
    if (args[1].effectiveWeather() === 'fog') args[0].basePower *= 2;
  } };
  for (const id of ['moonlight', 'morningsun', 'synthesis']) {
    const recover = gen4.moves.get(id).onHit as typeof defog;
    Moves[id] = { inherit: true, ...(Moves[id] as object | undefined), onHit(this: Battle, ...args: Parameters<typeof recover>) {
      if (this.field.isWeather('fog')) this.heal(args[0].baseMaxhp / 4);
      else return recover.apply(this, args);
    } };
  }

  const pursuitPatch = pursuit(gen4.moves.get('pursuit').condition!.onBeforeSwitchOut!);
  for (const [id, patch] of Object.entries({ ...accuracyMoves, substitute, pursuit: pursuitPatch })) Moves[id] = { ...(Moves[id] as object | undefined), ...patch };

  const modid = `gen4os${mods++}`;
  const dex = new PackDex(modid);
  // loadData consumes inheritance markers, including nested conditions. Every pack needs its own patch data.
  dex.loadData(dex.deepClone({ Scripts: { inherit: 'gen4', gen: 4, ...doublesScripts(gen4) }, Pokedex, Moves, Conditions, Abilities: { ...accuracyAbilities, skilllink }, Items: accuracyItems }) as never);
  const formats = new Map<string, unknown>();
  const formatFor = (kind: BattleKind, gameType: SimGameType = 'singles', weather?: BattleWeather) => {
    const key = kind === 'first' || kind === 'tutorial' ? kind : 'normal';
    let f = formats.get(`${key} ${gameType} ${weather ?? 'clear'}`);
    if (!f) {
      const rules = {
        ...(weather ? { onBattleStart(this: Battle) {
          const source = this.p1.pokemon[0]!;
          if (weather === 'trickroom') this.field.addPseudoWeather('trickroom', source);
          else {
            this.field.setWeather(({ rain: 'raindance', sun: 'sunnyday', hail: 'hail', sandstorm: 'sandstorm', fog: 'fog' })[weather], source);
            // Field weather lasts until replaced, unlike a five-turn weather move.
            this.field.weatherState.duration = 0;
          }
        } } : {}),
        ...(key !== 'normal' ? { onCriticalHit: () => false } : {}),
        ...(key === 'tutorial' ? { onAccuracy: () => true } : {}),
      };
      f = new Dex.Format({ name: `OS ${modid} ${key}${gameType === 'singles' ? '' : ` ${gameType}`}${weather ? ` ${weather}` : ''}`, mod: modid, gameType, debug: true, ruleset: [], ...rules } as never);
      formats.set(`${key} ${gameType} ${weather ?? 'clear'}`, f);
    }
    return f;
  };

  const natures = [...dex.natures.all()];
  const data: SimData = {
    createBattle: (kind, gameType, options, { weather, rules } = {}) => {
      const format = formatFor(kind, gameType, weather);
      return new Battle({ ...options, format: rules ? { ...(format as object), ...rules } : format } as ConstructorParameters<typeof Battle>[0], dex);
    },
    species(id, form = 0) {
      const f = form ? formIds.get(`${id}#${form}`) : undefined;
      if (f) return f;
      const s = speciesIds.get(id);
      if (!s) throw new Error(`battle: unknown species ${id}`);
      return s;
    },
    move(id) {
      const m = moveIds.get(id);
      if (!m) throw new Error(`battle: unknown move ${id}`);
      return m;
    },
    packMove(simName) {
      const m = packMoves.get(toID(simName));
      if (!m) throw new Error(`battle: the sim used ${simName}, which is no pack move`);
      return m;
    },
    ability(id) {
      if (!id) return 'No Ability';
      const a = dex.abilities.get(toID(bare(id, 'ABILITY_')));
      if (a.exists && a.num > 0) return a.name;
      log.stub(`battle:ability:${id}`, 'no sim ability; it has no effect in battle');
      return 'No Ability';
    },
    item(id) {
      if (!id) return '';
      const i = dex.items.get(toID(bare(id, 'ITEM_')));
      if (i.exists && i.num > 0) return i.name;
      if (!OUTSIDE_SIM.has(dexOfItems.holdEffect(id).holdEffect)) log.stub(`battle:item:${id}`, 'no sim item; it has no effect in battle');
      return '';
    },
    packItem(simId) {
      const id = packItems.get(simId);
      if (!id) throw new Error(`battle: the sim item ${simId} is no pack item`);
      return id;
    },
    nature(up, down) {
      const plus = up && STAT_KEYS[up as keyof typeof STAT_KEYS];
      const minus = down && STAT_KEYS[down as keyof typeof STAT_KEYS];
      const n = natures.find((x) => (plus && minus && plus !== minus ? x.plus === plus && x.minus === minus : !x.plus));
      if (!n) throw new Error(`battle: no sim nature for +${up} -${down}`);
      return n.name;
    },
  };
  built.set(reg, data);
  return data;
}

/** Sim Pokémon and move as the doubles rules below read them. */
type SimMon = { hp: number; fainted: boolean; isAlly(p: SimMon): boolean };
type SimMove = { target: string; spreadHit?: boolean; openSinnohGone?: Set<SimMon> };
type Actions = { battle: { gameType: string; getAllActive(): SimMon[] } };
type Fn = (this: unknown, ...a: unknown[]) => unknown;

/**
 * Double-battle rules where the DS and the sim differ (docs/research/double-battles.md §5.2, §7.3):
 *
 * - Spread damage after a KO. The DS hits a spread move's targets one at a time and takes 3/4 when, at that hit,
 *   two battlers stand on the defender's side (RANGE_ADJACENT_OPPONENTS) or two besides the defender anywhere
 *   (RANGE_ALL_ADJACENT; decomp BattleSystem_CalcMoveDamage, BattleSystem_CountAliveBattlers). The sim computes
 *   every target's damage first and takes 3/4 whenever the move has two targets. Here each target's damage counts
 *   the battlers the earlier targets' damage will knock out (in the sim's target order; the DS's is speed order).
 * - A normal move aimed at an ally that fainted before it moves goes at a random foe (decomp BattleSystem_Defender
 *   then BattleSystem_RandomOpponent); the sim keeps the fainted ally and the move has no target.
 *
 * Singles never reach either (one target, no ally).
 */
function doublesScripts(gen4: unknown) {
  const scripts = (gen4 as { data: { Scripts: { actions: Record<string, Fn> } } }).data.Scripts;
  const parent = scripts.actions;
  return {
    getTarget(this: { gameType: string; getRandomTarget(p: SimMon, m: unknown): SimMon | null; dex: { moves: { get(m: unknown): { target: string } } } }, pokemon: SimMon, move: unknown, targetLoc: number, originalTarget: unknown) {
      const target = (Battle.prototype as unknown as { getTarget: Fn }).getTarget.call(this, pokemon, move, targetLoc, originalTarget) as SimMon | null;
      const range = this.dex.moves.get(move).target;
      if (target && target !== pokemon && target.fainted && target.isAlly(pokemon) && (range === 'normal' || range === 'any')) return this.getRandomTarget(pokemon, move);
      return target;
    },
    actions: {
      inherit: true,
      ...accuracyScripts(parent as never),
      getSpreadDamage(this: Actions, damage: unknown[], targets: (SimMon | false | null)[], source: unknown, move: SimMove, ...rest: unknown[]) {
        if (this.battle.gameType === 'singles' || targets.filter(Boolean).length < 2) return (Object.getPrototypeOf(this) as Record<string, Fn>).getSpreadDamage!.call(this, damage, targets, source, move, ...rest);
        move.openSinnohGone = new Set();
        try {
          for (const [i, t] of targets.entries()) {
            if (!t) continue;
            const one = (Object.getPrototypeOf(this) as Record<string, Fn>).getSpreadDamage!.call(this, [damage[i]], [t], source, move, ...rest) as unknown[];
            damage[i] = one[0];
            if (typeof one[0] === 'number' && one[0] >= t.hp) move.openSinnohGone.add(t);
          }
        } finally {
          delete move.openSinnohGone;
        }
        return damage;
      },
      modifyDamage(this: Actions, baseDamage: number, pokemon: SimMon, target: SimMon, move: SimMove, ...rest: unknown[]) {
        const range = move.target;
        if (this.battle.gameType === 'singles' || (range !== 'allAdjacentFoes' && range !== 'allAdjacent')) return parent.modifyDamage!.call(this, baseDamage, pokemon, target, move, ...rest);
        const standing = this.battle.getAllActive().filter((p) => p.hp > 0 && !move.openSinnohGone?.has(p));
        const spread = range === 'allAdjacentFoes' ? standing.filter((p) => p === target || p.isAlly(target)).length === 2 : standing.filter((p) => p !== target).length >= 2;
        const saved = move.spreadHit;
        move.spreadHit = spread;
        try {
          return parent.modifyDamage!.call(this, baseDamage, pokemon, target, move, ...rest);
        } finally {
          move.spreadHit = saved;
        }
      },
    },
  };
}

/** The sim set of one of our Pokémon (`name`: its nickname or species name); our stats are written over the sim's later. */
export function simSet(data: SimData, dex: MonDex, mon: Pokemon, name: string) {
  const nature = dex.nature(mon.pid);
  const s = (o: Record<string, number>) => ({ hp: o.hp!, atk: o.attack!, def: o.defense!, spa: o.spAttack!, spd: o.spDefense!, spe: o.speed! });
  const gender = monGender(dex, mon);
  return {
    name,
    species: data.species(mon.species, mon.form),
    item: data.item(mon.heldItem),
    ability: data.ability(mon.ability),
    moves: mon.moves.map((m) => data.move(m)),
    nature: data.nature(nature.up, nature.down),
    gender: gender === 'male' ? 'M' : gender === 'female' ? 'F' : 'N',
    evs: s(mon.evs),
    ivs: s(mon.ivs),
    level: mon.level,
    happiness: mon.friendship,
  };
}

/**
 * Gen 4 LCRNG as the sim's random source (decomp BattleSystem_RandNext: seed·0x41C64E6D + 0x6073, the top 16
 * bits). The sim scales a u32 into ranges, so the 16 bits sit in the high half.
 */
export class Lcrng {
  constructor(private seed: number) {
    this.seed >>>= 0;
  }

  /** The next 16-bit value (decomp BattleSystem_RandNext). */
  next16(): number {
    this.seed = (Math.imul(this.seed, 0x41c64e6d) + 0x6073) >>> 0;
    return this.seed >>> 16;
  }

  /** The sim's RNG interface. */
  next(): number {
    return (this.next16() << 16) >>> 0;
  }

  getSeed(): string {
    return `lcrng,${this.seed}`;
  }
}
