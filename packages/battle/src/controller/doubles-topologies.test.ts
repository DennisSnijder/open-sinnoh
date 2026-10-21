/**
 * Doubles goldens on the fixture pack for the topologies after step 0 (no ROM; docs/research/double-battles.md §7.1):
 * one double trainer (3), two trainers against the player alone (19, a 6 + 6 roster) and a wild double with an AI
 * partner (74). Topology checks, the messages by decomp id, the player's two commands with CANCEL and the item
 * commit gate, reserved switches, per-owner replacements and empty slots, catching and running with two wild
 * Pokémon, exp for the player's party only, prizes and determinism.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, expGain, expShares, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleChoice, type BattleSetup, type BattleView, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle, prizeMoney } from '../index.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const TWINS: Partial<BattleSetup> = { trainers: [f('TRAINER_TWINS')], topology: 'double' };
const PAIR: Partial<BattleSetup> = { trainers: [f('TRAINER_SIX_A'), f('TRAINER_SIX_B')], topology: 'trainer-pair' };
const WILD: Partial<BattleSetup> = { kind: 'wild', wild: [{ species: f('SPECIES_SKYLET'), level: 3 }, { species: f('SPECIES_MOSSLET'), level: 3 }], topology: 'ai-partner', partner: f('TRAINER_PARTNER') };

function mon(species: string, level: number, moves?: string[]): Pokemon {
  return createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), heldItem: null, ...(moves ? { moves: moves.map(f) } : {}) });
}

function battle(party: Pokemon[], seed: number, extra: Partial<BattleSetup>, bag: Record<string, { item: Id; count: number }[]> = {}) {
  const setup: BattleSetup = { kind: 'trainer', trainers: [], wild: [], background: null, terrain: null, time: 'day', ...extra };
  const log = new CountingStubLog(() => {});
  const victories: number[] = [];
  const b: Battle = createBattle(setup, {
    registries,
    party,
    bag,
    pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
    met: { zone: null, date: null },
    player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' },
    money: 3000,
    badges: 1,
    caught: [],
    seed,
    textSpeed: 4,
    log,
    sound: { victory: () => victories.push(b.view().tick) },
  });
  return { b, log, victories };
}

/** Steps until a prompt waits (or the battle ends); the finished messages on the way. */
function untilPrompt(b: Battle, messages: string[] = []): string[] {
  for (let i = 0; i < 20000 && (i === 0 || !b.view().prompt) && !b.done(); i++) {
    b.step(IDLE);
    const m = b.view().message;
    if (m?.done && messages[messages.length - 1] !== m.text) messages.push(m.text);
  }
  return messages;
}

/** Answers every prompt with `pick` until the end; the finished messages and every view. */
function play(b: Battle, pick: (v: BattleView) => BattleChoice, max = 80000) {
  const messages: string[] = [];
  const views: BattleView[] = [];
  for (let i = 0; i < max && !b.done(); i++) {
    const v = b.view();
    if (v.prompt?.kind === 'command') b.choose(pick(v));
    else if (v.prompt?.kind === 'learn') b.choose({ kind: 'keep' });
    else if (v.prompt?.kind === 'learn-ask') b.choose({ kind: 'answer', yes: v.prompt.ask === 'give-up' });
    else if (v.prompt?.kind === 'nickname') b.choose({ kind: 'nickname', give: false });
    else if (v.prompt?.kind === 'pokedex') b.appDone({ app: 'pokedex-entry' });
    else if (v.prompt?.kind === 'next') b.choose({ kind: 'party' });
    else if (v.prompt?.kind === 'party') {
      const slot = [0, 1, 2, 3, 4, 5].find((s) => {
        try {
          b.choose({ kind: 'switch', slot: s });
          return true;
        } catch {
          return false;
        }
      });
      if (slot === undefined) throw new Error('no replacement');
    }
    b.step(IDLE);
    const after = b.view();
    views.push(after);
    if (after.message?.done && messages[messages.length - 1] !== after.message.text) messages.push(after.message.text);
  }
  if (!b.done()) throw new Error(`the battle did not end: ${messages.slice(-12).join(' | ')}`);
  return { messages, views };
}

/** Fight with move 1 at the first foe standing (the DS target screen's order: the second enemy first). */
const atFoe = (v: BattleView): BattleChoice => {
  const t = [3, 1].find((id) => v.battlers.find((x) => x.battler === id)?.visible);
  return { kind: 'move', slot: 0, ...(t === undefined ? {} : { target: t }) };
};
const shown = (views: BattleView[], id: number) => [...new Set(views.map((v) => v.battlers.find((x) => x.battler === id)).filter((x) => x?.visible).map((x) => x!.name))];

describe('one double trainer (type 3, fixture pack)', () => {
  it('rejects contradictory setups and a party with one Pokémon that can fight', () => {
    const two = [mon('SPECIES_MOSSGROVE', 20), mon('SPECIES_EMBERKIT', 15)];
    expect(() => battle(two, 1, { ...TWINS, trainers: [f('TRAINER_TWINS'), f('TRAINER_TWINS')] })).toThrow(/one trainer/);
    expect(() => battle(two, 1, { ...TWINS, partner: f('TRAINER_PARTNER') })).toThrow(/one trainer/);
    expect(() => battle(two, 1, { trainers: [f('TRAINER_TWINS')] })).toThrow(/double battle trainer/);
    const fainted = mon('SPECIES_EMBERKIT', 15);
    fainted.hp = 0;
    expect(() => battle([mon('SPECIES_MOSSGROVE', 20), fainted], 1, TWINS)).toThrow(/needs two Pokémon that can fight/);
  });

  it('four battlers, the player owning 0 and 2; the intro by decomp ids 973 and 978; the player commands both', () => {
    const { b } = battle([mon('SPECIES_MOSSGROVE', 20), mon('SPECIES_EMBERKIT', 15), mon('SPECIES_DRIPLING', 15)], 1, TWINS);
    const intro = untilPrompt(b);
    const v = b.view();
    expect(v.topology).toBe('double');
    expect(v.battlers.map((x) => [x.battler, x.owner, x.position, x.side, x.name])).toEqual([
      [0, 'player', 0, 'player', 'Mossgrove'],
      [1, 'enemy', 0, 'enemy', 'Skylet'],
      [2, 'player', 1, 'player', 'Emberkit'],
      [3, 'enemy', 1, 'enemy', 'Skylet'],
    ]);
    expect(intro).toEqual(['Pair Pip & Pim\nwants a match!', 'Pair Pip & Pim calls on\nSkylet and Skylet!', 'Your turn, Mossgrove\nand Emberkit!', 'What should Mossgrove try?']);
    expect(v.prompt).toMatchObject({ kind: 'command', actor: 0 });
    expect(v.prompt).not.toHaveProperty('canRewind');
    // No run from a trainer; no choice for the second battler yet.
    expect(() => b.choose({ kind: 'move', slot: 0, battler: 2 })).toThrow(/does not act now/);
    expect(() => b.choose({ kind: 'cancel' })).toThrow(/nothing to go back to/);
    b.choose({ kind: 'move', slot: 0, target: 3 });
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 2, canRewind: true, moves: [{ name: 'Bop' }, { name: 'Stare' }, { name: 'Ember Flick' }, { name: 'Quick Dash' }] });
    // CANCEL (the choice, or B on the card) goes back to the first battler; its command is asked again.
    b.choose({ kind: 'cancel' });
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 0 });
    b.choose({ kind: 'move', slot: 0, target: 3 });
    untilPrompt(b);
    b.step({ held: [], pressed: ['b'], touch: null });
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 0 });
  });

  it('a switch by the first battler reserves its Pokémon; the one already out is refused too', () => {
    const { b } = battle([mon('SPECIES_MOSSGROVE', 20), mon('SPECIES_EMBERKIT', 15), mon('SPECIES_DRIPLING', 15)], 1, TWINS);
    untilPrompt(b);
    expect(() => b.choose({ kind: 'switch', slot: 1 })).toThrow(/already in battle/);
    b.choose({ kind: 'switch', slot: 2 });
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ actor: 2 });
    expect(() => b.choose({ kind: 'switch', slot: 2 })).toThrow(/already coming in/);
    expect(() => b.choose({ kind: 'switch', slot: 0 })).toThrow(/already in battle/);
    b.choose({ kind: 'move', slot: 0, target: 1 });
    const turn = untilPrompt(b);
    expect(turn).toContain('Mossgrove, back you come!');
    expect(turn).toContain('Your turn, Dripling!');
    expect(b.view().battlers[0]!.name).toBe('Dripling');
  });

  it('the commit gate (decomp: the first command an item with an id above 16): no CANCEL after it, its effect is in before the second command', () => {
    const party = [mon('SPECIES_MOSSGROVE', 20), mon('SPECIES_EMBERKIT', 15)];
    party[0]!.pp[0] = 3;
    party[1]!.hp = 10;
    const bag = { medicine: [{ item: f('ITEM_FOCUS_DROPS'), count: 1 }, { item: f('ITEM_TONIC'), count: 2 }] };
    const drops = battle(structuredClone(party), 1, TWINS, structuredClone(bag)).b;
    untilPrompt(drops);
    // Focus Drops is item 19 (> 16): it restores at once and commits the first command.
    drops.choose({ kind: 'item', item: f('ITEM_FOCUS_DROPS'), target: 0, move: 0 });
    untilPrompt(drops);
    const second = drops.view().prompt;
    expect(second).toMatchObject({ kind: 'command', actor: 2 });
    expect(second).not.toHaveProperty('canRewind');
    expect(drops.app()).toBeNull();
    // Tonic is item 2 (≤ 16, the ROM's balls): the first command stays open and the Tonic acts when the turn runs.
    const tonic = battle(structuredClone(party), 1, TWINS, structuredClone(bag)).b;
    untilPrompt(tonic);
    tonic.choose({ kind: 'item', item: f('ITEM_TONIC'), target: 1 });
    untilPrompt(tonic);
    expect(tonic.view().prompt).toMatchObject({ actor: 2, canRewind: true });
    expect(tonic.view().battlers[2]!.hp).toBe(10);
    tonic.choose({ kind: 'move', slot: 0, target: 1 });
    const turn = untilPrompt(tonic);
    expect(turn.slice(0, 2)).toEqual(['What should Emberkit try?', 'Emberkit got back\n20 HP.']);
  });

  it('wins: one party behind both enemy battlers, never the same Pokémon twice; exp for both of the player’s per foe; the prize twice; both defeat lines', () => {
    const lead = mon('SPECIES_MOSSGROVE', 20);
    const second = mon('SPECIES_EMBERKIT', 15);
    const exp0 = [lead.exp, second.exp];
    const { b, victories } = battle([lead, second], 2, TWINS);
    const { messages, views } = play(b, atFoe);
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    expect(shown(views, 1)).toEqual(['Skylet']);
    expect(shown(views, 3)).toEqual(['Skylet']);
    const end = messages.indexOf('You won against\nPair Pip & Pim!');
    expect(end).toBeGreaterThan(0);
    expect(messages.slice(end + 1, end + 3)).toEqual(['Pip: Oh! We lost!', 'Pim: Together, though.']);
    const twins = registries.trainers.get(f('TRAINER_TWINS'))!;
    const prize = 2 * prizeMoney(twins.party.map((m) => m.level), twins.classPrize, 1);
    expect(r.money).toBe(3000 + prize);
    expect(messages).toContain(`Ash earned\n$${prize}!`);
    // Both of the player's Pokémon faced both foes: each foe's exp split between them (×1.5, a trainer).
    const each = expGain(expShares(dex.species(f('SPECIES_SKYLET')).baseExp, 3, 2, 0).gained, { luckyEgg: false, trainerBattle: true, outsider: false });
    expect(r.party.map((m, i) => m.exp - exp0[i]!)).toEqual([2 * each, 2 * each]);
    expect(victories).toHaveLength(1);
    expect(views.some((v) => v.prompt?.kind === 'shift')).toBe(false);
  });

  it('a fainted battler of the player is replaced from the party (the party prompt names it); with none left its slot stays empty and the battle goes on', () => {
    const weak = mon('SPECIES_SKYLET', 5, ['MOVE_STARE']);
    const reserve = mon('SPECIES_BURROWBIT', 5, ['MOVE_STARE']);
    weak.hp = 1;
    reserve.hp = 1;
    const { b } = battle([mon('SPECIES_MOSSGROVE', 30, ['MOVE_STARE', 'MOVE_LEAF_TAP']), weak, reserve], 4, TWINS);
    const forced: (number | undefined)[] = [];
    let empty = false;
    const { views } = play(b, (v) => {
      const p = v.prompt as Extract<BattleView['prompt'], { kind: 'command' }>;
      if (p.actor === 2) return { kind: 'move', slot: 0 };
      // Stare until both of the 1-HP Pokémon are down and the second slot is empty; then win.
      empty ||= !v.battlers[2]!.visible && v.battlers[2]!.name === 'Burrowbit';
      return empty ? { ...atFoe(v), slot: 1 } : { kind: 'move', slot: 0 };
    });
    for (const v of views) if (v.prompt?.kind === 'party' && v.prompt.forced) forced.push(v.prompt.actor);
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    expect(new Set(forced)).toEqual(new Set([2]));
    expect(shown(views, 2)).toEqual(['Skylet', 'Burrowbit']);
    expect(empty).toBe(true);
    // The turns after: only battler 0 is asked.
    const last = views.filter((v) => v.prompt?.kind === 'command').at(-1)!;
    expect(last.prompt).toMatchObject({ actor: 0 });
  });

  it('is deterministic', () => {
    const run = () => {
      const { b } = battle([mon('SPECIES_MOSSGROVE', 18), mon('SPECIES_EMBERKIT', 14)], 9, TWINS);
      const { messages, views } = play(b, atFoe);
      return { messages, ticks: views.length, result: b.done() };
    };
    expect(run()).toEqual(run());
  });
});

describe('two trainers against the player alone (type 19, a 6 + 6 roster, fixture pack)', () => {
  it('each enemy battler sends out its own trainer’s six only, the twelfth member included; an owner out leaves its slot empty; both prizes', () => {
    const { b } = battle([mon('SPECIES_MOSSGROVE', 40, ['MOVE_ROCK_SLIDE', 'MOVE_LEAF_TAP']), mon('SPECIES_EMBERKIT', 30)], 1, PAIR);
    const intro = untilPrompt(b);
    expect(intro.slice(0, 3)).toEqual(['Scout Oak and\nRambler Elm want a match!', 'Scout Oak calls on Skylet!\nRambler Elm calls on Mosslet!', 'Your turn, Mossgrove\nand Emberkit!']);
    expect(b.view().battlers.map((x) => x.owner)).toEqual(['player', 'enemy', 'player', 'enemy2']);
    // Leaf Tap at the first trainer's battler (1) while it stands, then at the second's; the second battler only
    // Stares (a KO'd target would send its move at the other foe), so the first trainer runs out first.
    const { messages, views } = play(b, (v) => {
      const p = v.prompt as Extract<BattleView['prompt'], { kind: 'command' }>;
      if (p.actor === 2) return { kind: 'move', slot: 1 };
      return { kind: 'move', slot: 1, target: v.battlers[1]!.visible ? 1 : 3 };
    });
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    const a = registries.trainers.get(f('TRAINER_SIX_A'))!;
    const bb = registries.trainers.get(f('TRAINER_SIX_B'))!;
    const names = (t: typeof a) => [...new Set(t.party.map((m) => registries.species.get(m.species)!.name))].sort();
    expect(shown(views, 1).sort()).toEqual(names(a));
    expect(shown(views, 3).sort()).toEqual(names(bb));
    // Every member of both rosters came out (the 12th, B's last Dripling, too): 6 + 6 send-outs counted per owner.
    const sentOut = (trainer: string) => messages.filter((m) => m.startsWith(trainer) && m.includes('calls on')).length;
    expect(sentOut('Scout Oak\n')).toBe(5);
    expect(sentOut('Rambler Elm\n')).toBe(5);
    // Once Oak is out, his slot stays empty while Elm still fights (decomp: the replacement scans the owner's party).
    expect(views.some((v) => v.prompt?.kind === 'command' && !v.battlers[1]!.visible && v.battlers[3]!.visible)).toBe(true);
    const end = messages.indexOf('You won against Scout Oak\nand Rambler Elm!');
    expect(messages.slice(end + 1, end + 3)).toEqual(['Six was not enough.', 'Neither was mine.']);
    const prize = prizeMoney(a.party.map((m) => m.level), a.classPrize, 1) + prizeMoney(bb.party.map((m) => m.level), bb.classPrize, 1);
    expect(r.money).toBe(3000 + prize);
  });

  it('is deterministic', () => {
    const run = () => {
      const { b } = battle([mon('SPECIES_MOSSGROVE', 40), mon('SPECIES_EMBERKIT', 30)], 3, PAIR);
      const { messages, views } = play(b, atFoe);
      return { messages, ticks: views.length, result: b.done() };
    };
    expect(run()).toEqual(run());
  });
});

describe('a wild double with an AI partner (type 74, fixture pack)', () => {
  it('rejects contradictory setups', () => {
    const party = [mon('SPECIES_MOSSGROVE', 20)];
    expect(() => battle(party, 1, { ...WILD, partner: undefined })).toThrow(/two wild Pokémon and a partner/);
    expect(() => battle(party, 1, { ...WILD, trainers: [f('TRAINER_PAIR_A')] })).toThrow(/two wild Pokémon and a partner/);
  });

  it('the intro by decomp ids 967 and 993; battlers 1 and 3 the wild Pokémon, 2 the partner’s; the player commands battler 0 only', () => {
    const { b } = battle([mon('SPECIES_MOSSGROVE', 20)], 1, WILD);
    const intro = untilPrompt(b);
    expect(intro).toEqual(['A wild Skylet and\nMosslet leap out!', 'Mountaineer Wren calls on Dripling!\nYour turn, Mossgrove!', 'What should Mossgrove try?']);
    expect(b.view().battlers.map((x) => [x.battler, x.owner, x.name])).toEqual([
      [0, 'player', 'Mossgrove'],
      [1, 'enemy', 'Skylet'],
      [2, 'partner', 'Dripling'],
      [3, 'enemy2', 'Mosslet'],
    ]);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 0, enabled: [true, true, true, true] });
  });

  it('a ball is refused while both wild Pokémon stand (decomp BattleBag_Text_CantUseBallTwoPokemon), not spent', () => {
    const { b } = battle([mon('SPECIES_MOSSGROVE', 20)], 1, WILD, { balls: [{ item: f('ITEM_CAPTURE_ORB'), count: 3 }] });
    untilPrompt(b);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_CAPTURE_ORB') })).toThrow(/two wild Pokémon stand/);
    b.choose({ kind: 'bag' });
    b.step(IDLE);
    expect(b.app()).toMatchObject({ app: 'bag-select', twoWild: true });
    // A bag that does not refuse it yet: back to the commands, logged.
    b.appDone({ app: 'bag-select', item: f('ITEM_CAPTURE_ORB'), target: null });
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 0 });
  });

  for (const first of [1, 3]) {
    it(`once wild battler ${first} is down the other is catchable in its slot`, () => {
      const wild = { ...WILD, wild: [{ species: f('SPECIES_SKYLET'), level: 7 }, { species: f('SPECIES_MOSSLET'), level: 7 }] };
      const { b } = battle([mon('SPECIES_MOSSGROVE', 40, ['MOVE_LEAF_TAP', 'MOVE_STARE'])], 5, wild, { balls: [{ item: f('ITEM_CAPTURE_ORB'), count: 30 }] });
      let thrown = 0;
      const { messages } = play(b, (v) => {
        const other = first === 1 ? 3 : 1;
        if (v.battlers[first]!.visible && v.battlers[first]!.hp > 0) return { kind: 'move', slot: 0, target: first };
        thrown++;
        expect(v.battlers[other]!.visible).toBe(true);
        return { kind: 'item', item: f('ITEM_CAPTURE_ORB') };
      });
      const r = b.done()!;
      expect(thrown).toBeGreaterThan(0);
      expect(r.outcome).toBe('caught');
      expect(r.caught!.mon.species).toBe(f(first === 1 ? 'SPECIES_MOSSLET' : 'SPECIES_SKYLET'));
      expect(messages.some((m) => m.startsWith('Got it!'))).toBe(true);
    });
  }

  it('wins with exp for the player’s party only; the victory music once both are down; the partner is not in the result', () => {
    const lead = mon('SPECIES_MOSSGROVE', 30);
    const exp0 = lead.exp;
    const { b, victories } = battle([lead], 2, WILD);
    const { messages } = play(b, atFoe);
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    expect(r.party).toHaveLength(1);
    const gain = (species: string) => expGain(expShares(dex.species(f(species)).baseExp, 3, 1, 0).gained, { luckyEgg: false, trainerBattle: false, outsider: false });
    expect(r.party[0]!.exp - exp0).toBe(gain('SPECIES_SKYLET') + gain('SPECIES_MOSSLET'));
    expect(messages.filter((m) => m.startsWith('Dripling earned'))).toEqual([]);
    expect(victories).toHaveLength(1);
  });

  it('runs: away, or a failed escape ends the player’s action only (the partner still acts)', () => {
    const outcomes = new Set<string>();
    let partnerActedAfterFail = false;
    for (let seed = 1; seed <= 12; seed++) {
      const { b } = battle([mon('SPECIES_SKYLET', 2, ['MOVE_STARE'])], seed, { ...WILD, wild: [{ species: f('SPECIES_SKYLET'), level: 9 }, { species: f('SPECIES_MOSSLET'), level: 9 }] });
      untilPrompt(b);
      b.choose({ kind: 'run' });
      const turn = untilPrompt(b);
      if (b.done() || turn.includes('You slipped away!')) outcomes.add('fled');
      if (turn.includes('No way out!')) {
        outcomes.add('failed');
        if (turn.slice(turn.indexOf('No way out!')).some((m) => m.startsWith('Dripling tries'))) partnerActedAfterFail = true;
      }
    }
    expect(outcomes).toEqual(new Set(['fled', 'failed']));
    expect(partnerActedAfterFail).toBe(true);
  });

  it('is lost once the player’s own party is out, whatever the partner has left', () => {
    const { b } = battle([mon('SPECIES_SKYLET', 2, ['MOVE_STARE'])], 4, { ...WILD, wild: [{ species: f('SPECIES_SKYLET'), level: 9 }, { species: f('SPECIES_MOSSLET'), level: 9 }] });
    const { messages } = play(b, () => ({ kind: 'move', slot: 0 }));
    expect(b.done()!.outcome).toBe('lost');
    expect(messages).toContain('Ash has no one\nleft to battle!');
  });

  it('is deterministic', () => {
    const run = () => {
      const { b } = battle([mon('SPECIES_MOSSGROVE', 20)], 9, WILD);
      const { messages, views } = play(b, atFoe);
      return { messages, ticks: views.length, result: b.done() };
    };
    expect(run()).toEqual(run());
  });
});
