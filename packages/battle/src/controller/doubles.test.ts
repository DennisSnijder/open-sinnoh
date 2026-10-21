/**
 * Doubles goldens on the fixture pack (no ROM; docs/research/double-battles.md §7.1, the rows that apply to type
 * 75): the player and an AI partner against two trainers on the sim's `multi` format. Topology checks, the
 * two-trainer messages, targets, per-owner replacements, the story loss rule, per-foe exp, the prize sum and
 * determinism.
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
const TAG: Partial<BattleSetup> = { trainers: [f('TRAINER_PAIR_A'), f('TRAINER_PAIR_B')], topology: 'ai-partner', partner: f('TRAINER_PARTNER') };

function mon(species: string, level: number, moves?: string[]): Pokemon {
  return createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), heldItem: null, ...(moves ? { moves: moves.map(f) } : {}) });
}

function battle(party: Pokemon[], seed: number, extra: Partial<BattleSetup> = TAG, money = 3000): Battle {
  const setup: BattleSetup = { kind: 'trainer', trainers: [], wild: [], background: null, terrain: null, time: 'day', ...extra };
  return createBattle(setup, { registries, party, bag: {}, pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' }, money, badges: 1, caught: [], seed, textSpeed: 4, log: new CountingStubLog(() => {}) });
}

/** Answers every prompt with `pick` (default: move 1) until the end; the finished messages, views and command prompts. */
function play(b: Battle, pick: (v: BattleView) => BattleChoice = () => ({ kind: 'move', slot: 0 }), max = 60000) {
  const messages: string[] = [];
  const views: BattleView[] = [];
  let last = '';
  let prompts = 0;
  for (let i = 0; i < max && !b.done(); i++) {
    const v = b.view();
    if (v.prompt?.kind === 'command') {
      prompts++;
      b.choose(pick(v));
    } else if (v.prompt?.kind === 'learn') b.choose({ kind: 'keep' });
    else if (v.prompt?.kind === 'learn-ask') b.choose({ kind: 'answer', yes: v.prompt.ask === 'give-up' });
    else if (v.prompt?.kind === 'party') {
      const slot = v.prompt.forced ? [0, 1, 2, 3, 4, 5].find((s) => { try { b.choose({ kind: 'switch', slot: s }); return true; } catch { return false; } }) : undefined;
      if (slot === undefined) throw new Error('no replacement');
    }
    b.step(IDLE);
    const after = b.view();
    views.push(after);
    if (after.message?.done && after.message.text !== last) messages.push((last = after.message.text));
  }
  if (!b.done()) throw new Error('the battle did not end');
  return { messages, views, prompts };
}

describe('ai-partner trainer battles (type 75, fixture pack)', () => {
  it('rejects contradictory setups: one enemy, the same trainer twice, no partner, one wild Pokémon, a pair with a partner', () => {
    const party = [mon('SPECIES_MOSSGROVE', 20)];
    expect(() => battle(party, 1, { ...TAG, trainers: [f('TRAINER_PAIR_A')] })).toThrow(/two distinct enemy trainers/);
    expect(() => battle(party, 1, { ...TAG, trainers: [f('TRAINER_PAIR_A'), f('TRAINER_PAIR_A')] })).toThrow(/two distinct enemy trainers/);
    expect(() => battle(party, 1, { trainers: TAG.trainers!, topology: 'ai-partner' })).toThrow(/and a partner/);
    expect(() => battle(party, 1, { kind: 'wild', wild: [{ species: f('SPECIES_SKYLET'), level: 3 }], topology: 'ai-partner', partner: f('TRAINER_PARTNER') })).toThrow(/two wild Pokémon and a partner/);
    expect(() => battle(party, 1, { ...TAG, topology: 'trainer-pair' })).toThrow(/no partner/);
  });

  it('four battlers by DS id with owners and positions; the two-trainer intro; the partner never prompts', () => {
    const b = battle([mon('SPECIES_MOSSGROVE', 20)], 1);
    const intro: string[] = [];
    while (!b.view().prompt) {
      b.step(IDLE);
      const m = b.view().message;
      if (m?.done && intro[intro.length - 1] !== m.text) intro.push(m.text);
    }
    const v = b.view();
    expect(v.topology).toBe('ai-partner');
    expect(v.battlers.map((x) => [x.battler, x.owner, x.position, x.side, x.name])).toEqual([
      [0, 'player', 0, 'player', 'Mossgrove'],
      [1, 'enemy', 0, 'enemy', 'Skylet'],
      [2, 'partner', 1, 'player', 'Dripling'],
      [3, 'enemy2', 1, 'enemy', 'Mosslet'],
    ]);
    expect(v.battlers.every((x) => x.visible && x.healthbox.visible)).toBe(true);
    expect(intro).toEqual([
      'Scout Rue and\nRambler Ivy want a match!',
      'Scout Rue calls on Skylet!\nRambler Ivy calls on Mosslet!',
      'Mountaineer Wren calls on Dripling!\nYour turn, Mossgrove!',
      'What should Mossgrove try?',
    ]);
    expect(v.prompt).toMatchObject({ kind: 'command', actor: 0 });
    // Run is refused against trainers; a choice for another battler is refused.
    expect(() => b.choose({ kind: 'move', slot: 0, battler: 2 })).toThrow(/does not act now/);
  });

  it('Fight opens the DS target screen (cursor on enemy 2), B cancels to the move, A sends the move at the cursor', () => {
    const b = battle([mon('SPECIES_DRIPLING', 30, ['MOVE_BOP', 'MOVE_SURF'])], 2);
    while (!b.view().prompt) b.step(IDLE);
    b.choose({ kind: 'fight' });
    b.choose({ kind: 'move', slot: 0 });
    expect(b.view().prompt).toMatchObject({ kind: 'target', cursor: 3, slot: 0 });
    const press = (button: InputFrame['pressed'][number]) => b.step({ held: [button], pressed: [button], touch: null });
    press('b');
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 0 });
    b.choose({ kind: 'move', slot: 0 });
    press('right');
    expect(b.view().prompt).toMatchObject({ kind: 'target', cursor: 1 });
    press('a');
    const turn: string[] = [];
    for (let i = 0; i < 10000 && !b.view().prompt; i++) {
      b.step(IDLE);
      const m = b.view().message;
      if (m?.done && turn.at(-1) !== m.text) turn.push(m.text);
    }
    expect(turn).toContain('Rival Skylet is out!');
    expect(turn).not.toContain('Rival Mosslet is out!');
  });

  it('a spread move opens the target screen as a group, confirmed as one', () => {
    const b = battle([mon('SPECIES_DRIPLING', 30, ['MOVE_BOP', 'MOVE_SURF'])], 2);
    while (!b.view().prompt) b.step(IDLE);
    b.choose({ kind: 'fight' });
    b.choose({ kind: 'move', slot: 1 });
    // Surf hits both foes and the ally: all three lit, the cursor on the group's first.
    expect(b.view().prompt).toMatchObject({ kind: 'target', cursor: 3, slot: 1, move: { aim: { targets: [3, 1, 2], group: true } } });
    b.step({ held: ['a'], pressed: ['a'], touch: null });
    expect(b.view().prompt).toBeNull();
  });

  it('targets: a single-target move aims at a chosen battler; self, an empty slot and singles are refused', () => {
    const b = battle([mon('SPECIES_DRIPLING', 30, ['MOVE_BOP', 'MOVE_SURF'])], 2);
    while (!b.view().prompt) b.step(IDLE);
    expect(() => b.choose({ kind: 'move', slot: 0, target: 0 })).toThrow(/can't aim at battler 0 \(it may aim at 3, 1, 2\)/);
    expect(() => b.choose({ kind: 'move', slot: 0, target: 4 })).toThrow(/can't aim/);
    b.choose({ kind: 'move', slot: 0, target: 3 });
    b.step(IDLE);
    const turn: string[] = [];
    while (!b.view().prompt) {
      b.step(IDLE);
      const m = b.view().message;
      if (m?.done && turn[turn.length - 1] !== m.text) turn.push(m.text);
    }
    expect(turn).toContain('Dripling tries\nBop!');
    // The second enemy (battler 3, Mosslet) took the hit and fainted; its owner's reserve came in; the first enemy is untouched.
    expect(turn.slice(0, 2)).toEqual(['Dripling tries\nBop!', 'Rival Mosslet is out!']);
    const v = b.view();
    expect(v.battlers[3]!.name).toBe('Skylet');
    expect(v.battlers[1]!.hp).toBe(v.battlers[1]!.maxHp);
    const single = createBattle({ kind: 'trainer', trainers: [f('TRAINER_CAMPER')], wild: [], background: null, terrain: null, time: 'day' }, { registries, party: [mon('SPECIES_DRIPLING', 30)], bag: {}, pc: { current: { box: 0, name: 'C' }, free: null, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' }, money: 0, badges: 0, caught: [], seed: 1, textSpeed: 4, log: new CountingStubLog(() => {}) });
    while (!single.view().prompt) single.step(IDLE);
    expect(() => single.choose({ kind: 'move', slot: 0, target: 1 })).toThrow(/single battle takes no move target/);
  });

  it('a spread move takes no chosen target (one given is ignored) and hits every adjacent battler, the partner too', () => {
    const b = battle([mon('SPECIES_DRIPLING', 12, ['MOVE_SURF'])], 5);
    while (!b.view().prompt) b.step(IDLE);
    b.choose({ kind: 'move', slot: 0, target: 1 });
    b.step(IDLE);
    const hp0 = [1, 2, 3].map((id) => b.view().battlers[id]!.maxHp);
    while (!b.view().prompt && !b.done()) b.step(IDLE);
    const v = b.view();
    expect([1, 2, 3].map((id) => v.battlers[id]!.hp < hp0[id - 1]! || !v.battlers[id]!.visible || v.battlers[id]!.maxHp !== hp0[id - 1])).toEqual([true, true, true]);
  });

  it('wins: each enemy replaces from its own party, exp per defeated foe, both defeat lines, the prize is both trainers’', () => {
    const lead = mon('SPECIES_MOSSGROVE', 30);
    const exp0 = lead.exp;
    const b = battle([lead], 3);
    const { messages, views } = play(b, (v) => {
      // Aim at the first enemy standing (the second slot first, as the DS cursor does).
      const foe = [3, 1].find((id) => v.battlers.find((x) => x.battler === id)?.visible);
      return { kind: 'move', slot: 0, ...(foe === undefined ? {} : { target: foe }) };
    });
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    // Owners' reserves: battler 1 only ever shows PAIR_A's Pokémon, battler 3 PAIR_B's.
    const shown = (id: number) => [...new Set(views.map((v) => v.battlers.find((x) => x.battler === id)!).filter((x) => x.visible).map((x) => x.name))];
    expect(shown(1)).toEqual(['Skylet', 'Burrowbit']);
    expect(shown(3)).toEqual(['Mosslet', 'Skylet']);
    expect(shown(2)).toEqual(['Dripling']);
    expect(messages).toContain('Scout Rue\ncalls on Burrowbit!');
    expect(messages).toContain('Rambler Ivy\ncalls on Skylet!');
    const end = messages.indexOf('You won against Scout Rue\nand Rambler Ivy!');
    expect(end).toBeGreaterThan(0);
    expect(messages.slice(end + 1, end + 3)).toEqual(['Our plan needed a third.', 'Back to the drawing board.']);
    const a = registries.trainers.get(f('TRAINER_PAIR_A'))!;
    const bb = registries.trainers.get(f('TRAINER_PAIR_B'))!;
    const prize = prizeMoney(a.party.map((m) => m.level), a.classPrize, 1) + prizeMoney(bb.party.map((m) => m.level), bb.classPrize, 1);
    expect(prize).toBe(5 * 4 * 4 + 6 * 4 * 4);
    expect(r.money).toBe(3000 + prize);
    expect(messages).toContain(`Ash earned\n$${prize}!`);
    // Exp: the player's lead faced every foe (it was always out), one share each, trainer ×1.5; none for the partner.
    const gain = (species: string, level: number) => expGain(expShares(dex.species(f(species)).baseExp, level, 1, 0).gained, { luckyEgg: false, trainerBattle: true, outsider: false });
    const total = gain('SPECIES_SKYLET', 4) + gain('SPECIES_BURROWBIT', 5) + gain('SPECIES_MOSSLET', 4) + gain('SPECIES_SKYLET', 6);
    expect(r.party).toHaveLength(1);
    expect(r.party[0]!.exp).toBe(exp0 + total);
    expect(messages.filter((m) => m.startsWith('Mossgrove earned'))).toHaveLength(4);
    // No SHIFT question and no trainer interjections in doubles.
    expect(views.some((v) => v.prompt?.kind === 'shift')).toBe(false);
  });

  it('the player loses once the own party is out, whatever the partner has left (decomp CheckBattleOver for AI partners)', () => {
    const b = battle([mon('SPECIES_SKYLET', 2)], 4);
    const { messages, views } = play(b, () => ({ kind: 'move', slot: 1 })); // Stare: no damage
    const r = b.done()!;
    expect(r.outcome).toBe('lost');
    const lastView = views[views.length - 1]!;
    expect(lastView.battlers[2]!.hp).toBeGreaterThan(0);
    expect(messages).toContain('Ash has no one\nleft to battle!');
  });

  it('is deterministic: same setup, seed and choices give the same messages and ticks', () => {
    const run = () => {
      const b = battle([mon('SPECIES_MOSSGROVE', 25), mon('SPECIES_EMBERKIT', 12)], 9);
      const { messages, views } = play(b);
      return { messages, ticks: views.length, result: b.done() };
    };
    expect(run()).toEqual(run());
  });
});
