/**
 * The type 19 scratch proof (docs/research/double-battles.md §5.2 and
 * §7.3): two enemy trainers against the player alone (decomp BATTLE_TYPE_TAG_DOUBLES) on the sim's native
 * `doubles` format, with both enemy parties in one sim side (6 + 6 = 12 members) and an owner map. The sim does
 * not know owners, so this checks where it would mix them and that a small adapter keeps them apart:
 *
 * 1. Forced replacements: the sim offers every reserve of the side; the adapter offers only the owner's, the
 *    12th member included. When one owner is out but the other has reserves, the sim refuses to leave the slot
 *    empty ("Can't pass"); the adapter does not flag that battler for a replacement (`checkFainted`).
 * 2. Roar and Whirlwind drag a random member of the whole side; the adapter's `dragIn` draws from the owner of
 *    the slot dragged out.
 * 3. Party scans: Beat Up counts, Assist samples and Heal Bell / Aromatherapy cure the whole side; owner-aware
 *    overrides keep them to the user's owner (decomp BattleSystem_GetParty(battler) in TAG battles).
 *
 * Sim only (Showdown's gen 4 data, our own hand-built sets; no ROM, no imported content). Each case first shows
 * the unfiltered sim crossing owners, then the adapter keeping them apart.
 */
import { Battle, Dex, PRNG } from '@pkmn/sim';
import { describe, expect, it } from 'vitest';
import { Lcrng } from './dex.ts';

type SimMon = Battle['p1']['pokemon'][number];
type Side = Battle['p1'];

/** The owner of each enemy sim Pokémon (0 = the first enemy trainer, 1 = the second); player Pokémon have none. */
const owners = new WeakMap<object, number>();
const sameOwner = (a: SimMon, b: SimMon) => owners.get(a) === owners.get(b);

/** The owner-aware party scans (the adapter's dex-mod overrides). */
const MOVES = {
  beatup: {
    inherit: true,
    onModifyMove(this: unknown, move: { type: string; category: string; allies?: SimMon[]; multihit?: number }, pokemon: SimMon) {
      pokemon.addVolatile('beatup');
      move.type = '???';
      move.category = 'Physical';
      move.allies = pokemon.side.pokemon.filter((ally) => sameOwner(ally, pokemon) && !ally.fainted && !ally.status);
      move.multihit = move.allies.length;
    },
  },
  assist: {
    inherit: true,
    onHit(this: { dex: typeof Dex; sample<T>(a: T[]): T; actions: { useMove(m: string, p: SimMon): void } }, target: SimMon) {
      const moves = target.side.pokemon.filter((p) => p !== target && sameOwner(p, target)).flatMap((p) => p.moveSlots.map((s) => s.id)).filter((id) => !this.dex.moves.get(id).flags['noassist']);
      if (!moves.length) return false;
      this.actions.useMove(this.sample(moves), target);
    },
  },
  healbell: {
    inherit: true,
    onHit(this: { add(...a: unknown[]): void }, target: SimMon, source: SimMon) {
      this.add('-activate', source, 'move: Heal Bell');
      for (const ally of target.side.pokemon) if (sameOwner(ally, source)) ally.cureStatus(true);
    },
  },
  aromatherapy: {
    inherit: true,
    onHit(this: { add(...a: unknown[]): void }, target: SimMon, source: SimMon) {
      this.add('-cureteam', source, '[from] move: Aromatherapy');
      for (const ally of target.side.pokemon) if (sameOwner(ally, source)) ally.clearStatus();
    },
  },
};

let mods = 0;
function format(owned: boolean) {
  const mod = `opensinnohtagproof${mods++}`;
  Dex.mod(mod, { Scripts: { inherit: 'gen4', gen: 4 }, ...(owned ? { Moves: MOVES } : {}) } as never);
  return new Dex.Format({ name: `Tag proof ${mod}`, mod, gameType: 'doubles', debug: true, ruleset: [] } as never);
}

const set = (species: string, level: number, moves: string[]) => ({ name: species, species, moves, level, ability: 'No Ability', evs: {}, ivs: {}, item: '' });

/** Owner A's six, owner B's six: their moves tell them apart (A: Ember family, B: Water Gun family). */
const A = ['Charmander', 'Vulpix', 'Growlithe', 'Ponyta', 'Magby', 'Slugma'].map((s) => set(s, 5, ['ember', 'beatup', 'assist']));
const B = ['Squirtle', 'Psyduck', 'Poliwag', 'Tentacool', 'Horsea', 'Goldeen'].map((s) => set(s, 5, ['watergun', 'healbell', 'bubble']));

/**
 * The combined enemy roster: the two leads first (they take positions a and b), then A's reserve, then B's.
 * Sim positions 1–12: A1, B1, A2–A6, B2–B6.
 */
function start(seed: number, owned: boolean, player = [set('Pidgeot', 60, ['whirlwind', 'wingattack']), set('Machamp', 60, ['crosschop', 'karatechop'])]) {
  const prng = new PRNG('sodium,00000000000000000000000000000000');
  (prng as unknown as { rng: Lcrng }).rng = new Lcrng(seed);
  const battle = new Battle({ format: format(owned), prng, strictChoices: true } as never);
  battle.setPlayer('p1', { name: 'player', team: player } as never);
  battle.setPlayer('p2', { name: 'enemies', team: [A[0], B[0], ...A.slice(1), ...B.slice(1)] } as never);
  battle.p2.pokemon.forEach((p, i) => owners.set(p, i === 0 || (i >= 2 && i < 7) ? 0 : 1));
  if (owned) adapter(battle);
  return battle;
}

/**
 * The adapter's sim hooks: Roar/Whirlwind drag from the dragged-out battler's owner; a fainted battler whose owner
 * has no reserve is not replaced although the other owner has some (`checkFainted` is where the sim flags fainted
 * battlers for a replacement).
 */
function adapter(battle: Battle): void {
  const side = battle.p2;
  const checkFainted = battle.checkFainted.bind(battle);
  battle.checkFainted = () => {
    checkFainted();
    for (const p of side.active) if (p.fainted && !reserve(side, owners.get(p)!).length) p.switchFlag = false;
  };
  const actions = battle.actions as unknown as { dragIn(side: Side, pos: number): boolean; switchIn(p: SimMon, pos: number, effect: null, dragged: boolean): boolean };
  actions.dragIn = (side, pos) => {
    const out = side.active[pos]!;
    const pool = side.pokemon.slice(side.active.length).filter((p) => !p.fainted && (owners.get(out) === undefined || sameOwner(p, out)));
    if (!pool.length || !out.hp) return false;
    if (!battle.runEvent('DragOut', out)) return false;
    return actions.switchIn(battle.sample(pool), pos, null, true);
  };
}

/** The adapter's replacement offer: the bench members of the owner of the fainted battler at `pos` (sim 1-based positions). */
function reserve(side: Side, owner: number): number[] {
  return side.pokemon.map((p, i) => ({ p, i })).filter(({ p, i }) => i >= side.active.length && !p.fainted && owners.get(p) === owner).map(({ i }) => i + 1);
}

/** The adapter's answer to a forced replacement: per slot, the owner's first reserve, else pass. */
function replace(side: Side): string {
  const taken = new Set<number>();
  return side.active
    .map((p) => {
      if (!p.switchFlag) return 'pass';
      const next = reserve(side, owners.get(p)!).find((i) => !taken.has(i));
      if (next === undefined) return 'pass';
      taken.add(next);
      return `switch ${next}`;
    })
    .join(', ');
}

/** Faints a sim Pokémon outside a turn (a fixture's pre-fainted member). */
function faintNow(p: SimMon) {
  p.hp = 0;
  p.fainted = true;
  p.side.pokemonLeft--;
}

const owner = (side: Side, pos: number) => owners.get(side.active[pos]!);

describe('type 19 adapter proof: two enemy owners in one sim side (6 + 6)', () => {
  it('forced replacements: the sim offers every reserve; the adapter offers the owner’s, up to the 12th member', () => {
    const battle = start(1, false);
    expect(battle.p2.pokemon).toHaveLength(12);
    battle.p2.pokemon.slice(7, 11).forEach(faintNow); // B2–B5 are out: B6 (position 12) is B's last reserve
    battle.makeChoices('move 2 1, move 1 2', 'move 1 1, move 1 1'); // Wing Attack and Cross Chop: both leads faint
    expect(battle.p2.requestState).toBe('switch');
    expect((battle.p2.activeRequest as { forceSwitch: boolean[] }).forceSwitch).toEqual([true, true]);
    // The sim's offer: every bench member alive, both owners mixed.
    const offered = battle.p2.pokemon.map((p, i) => ({ p, i })).filter(({ p, i }) => i >= 2 && !p.fainted).map(({ i }) => i + 1);
    expect(offered).toEqual([3, 4, 5, 6, 7, 12]);
    // The sim accepts B's member for A's slot: ownership is the adapter's job.
    expect(() => start(1, false).p2.choose('switch 12, switch 3')).not.toThrow();
    // The adapter: A's slot from A's reserve, B's slot from B's (the 12th member).
    expect(reserve(battle.p2, 0)).toEqual([3, 4, 5, 6, 7]);
    expect(reserve(battle.p2, 1)).toEqual([12]);
    battle.choose('p2', `switch ${reserve(battle.p2, 0)[0]}, switch ${reserve(battle.p2, 1)[0]}`);
    expect(battle.p2.active.map((p) => [p.name, owners.get(p)])).toEqual([
      ['Vulpix', 0],
      ['Goldeen', 1],
    ]);
  });

  it('one owner out, the other with reserves: the sim refuses an empty slot; the adapter leaves it empty, turn after turn', () => {
    const team = [set('Pidgeot', 60, ['whirlwind', 'wingattack']), set('Blissey', 60, ['softboiled', 'toxic'])];
    const opening = (owned: boolean) => {
      const battle = start(2, owned, team);
      battle.p2.pokemon.slice(2, 7).forEach(faintNow); // A2–A6 are out: A1 is A's last
      battle.makeChoices('move 2 1, move 1', 'move 1 1, move 1 1'); // A1 faints, B1 stands
      return battle;
    };
    const sim = opening(false);
    expect((sim.p2.activeRequest as { forceSwitch: boolean[] }).forceSwitch).toEqual([true, false]);
    expect(() => sim.choose('p2', 'pass')).toThrow(/Can't pass/);
    // The adapter: A's slot is not replaced at all; the next turn comes with it empty.
    const battle = opening(true);
    expect(reserve(battle.p2, 0)).toEqual([]);
    expect(battle.p2.requestState).toBe('move');
    const seen = new Set<number | undefined>();
    for (let turn = 0; turn < 8 && !battle.ended; turn++) {
      // A's slot stays empty (decomp: the replacement scans the owner's party); B's comes from B's reserve.
      if (battle.p2.requestState === 'switch') battle.choose('p2', replace(battle.p2));
      expect(battle.p2.active[0]!.fainted).toBe(true);
      seen.add(owner(battle.p2, 1));
      battle.makeChoices('move 2 2, move 1', 'pass, move 1 1');
    }
    expect([...seen]).toEqual([1]);
    expect(battle.p2.pokemon.filter((p) => owners.get(p) === 1 && p.fainted).length).toBeGreaterThan(1);
  });

  it('Whirlwind drags from the whole side in the sim; the adapter drags from the dragged-out battler’s owner', () => {
    const crossed = (owned: boolean) => {
      let n = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const battle = start(seed, owned);
        battle.makeChoices('move 1 2, move 2 1', 'move 1 1, move 1 1'); // Whirlwind on B1 (position b); A1 faints
        const dragged = battle.p2.active[1]!;
        if (owners.get(dragged) !== 1) n++;
      }
      return n;
    };
    expect(crossed(false)).toBeGreaterThan(0);
    expect(crossed(true)).toBe(0);
  });

  it('Beat Up counts, Assist samples and Heal Bell cures the whole side in the sim; the adapter keeps them to the owner', () => {
    const scan = (owned: boolean) => {
      const battle = start(5, owned, [set('Blissey', 60, ['softboiled', 'toxic']), set('Chansey', 60, ['softboiled', 'toxic'])]);
      // Beat Up by A1: one hit per healthy party member (decomp: the attacker's party).
      battle.makeChoices('move 1, move 1', 'move 2 1, move 1 1');
      const hits = Number(battle.log.find((l) => l.startsWith('|-hitcount|'))?.split('|')[3]);
      // Assist by A1, many times: which owners' moves it calls.
      const called = new Set<string>();
      for (let t = 0; t < 12; t++) {
        battle.makeChoices('move 1, move 1', 'move 3, move 1 1');
        for (const l of battle.log.slice(-40)) if (l.startsWith('|move|p2a:') && !l.includes('|Assist|')) called.add(l.split('|')[3]!);
      }
      // Heal Bell by B1 with every enemy poisoned: whose members are cured.
      for (const p of battle.p2.pokemon) if (!p.fainted) p.setStatus('psn');
      battle.makeChoices('move 1, move 1', 'move 1 1, move 2');
      const cured = battle.p2.pokemon.filter((p) => !p.fainted && !p.status).map((p) => owners.get(p));
      return { hits, called: [...called].sort(), cured: [...new Set(cured)].sort() };
    };
    const sim = scan(false);
    expect(sim.hits).toBe(12);
    expect(sim.called).toContain('Water Gun');
    expect(sim.cured).toEqual([0, 1]);
    const adapted = scan(true);
    expect(adapted.hits).toBe(6);
    expect(adapted.called.every((m) => m === 'Ember' || m === 'Beat Up')).toBe(true);
    expect(adapted.cured).toEqual([1]);
  });
});
