/**
 * The battle's start lines and held items on the real ROM (OPENSINNOH_NDS_ROM):
 * - the switch-in effects the sim runs at the start (Intimidate, a berry eaten on entry) print their battle
 *   strings after the player's send-out line, before the first command;
 * - held items follow the battle into the party (decomp BtlIOCmd_UpdatePartyMon): an eaten berry is gone, a
 *   stolen item stays, a knocked-off item comes back (knockedOffItemsMask);
 * - the enemy side cannot take items (decomp BtlCmd_TryStealItem / BtlCmd_TrySwapItems).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PRNG } from '@pkmn/sim';
import { createPokemon, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleView, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';
import { BattleText, pages } from '../messages.ts';
import { simData } from '../sim/dex.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!ROM)('battle start lines and held items (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let text: BattleText;
  beforeAll(() => {
    reg = loadGamePacks([(romSlice() as { pack: PackData }).pack]).registries;
    text = new BattleText(reg);
  });

  const shinx = (o: { hp?: number; item?: string; moves?: string[] } = {}): Pokemon => {
    const m = createPokemon(dexOf(reg), { species: P('SPECIES_SHINX'), level: 8, pid: 0x1234, ivs: 15, otId: 1, otName: 'Lucas', otGender: 'male', ball: P('ITEM_POKE_BALL'), heldItem: o.item ? P(o.item) : null, ...(o.moves ? { moves: o.moves.map(P) } : {}) });
    m.ability = P('ABILITY_INTIMIDATE');
    if (o.hp !== undefined) m.hp = o.hp;
    return m;
  };

  const wild = (party: Pokemon[], seed: number, log = new CountingStubLog(() => {})): Battle =>
    createBattle(
      { kind: 'wild', trainers: [], wild: [{ species: P('SPECIES_BIDOOF'), level: 3 }], background: null, terrain: null, time: 'day' },
      { registries: reg, party, bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 3000, badges: 0, caught: [], seed, textSpeed: 1, log },
    );

  /** Ticks to the first command prompt; the finished messages on the way. */
  const toCommand = (b: Battle): { messages: string[]; view: BattleView } => {
    const messages: string[] = [];
    let last = '';
    for (let i = 0; i < 5000; i++) {
      b.step(IDLE);
      const v = b.view();
      if (v.message?.done && v.message.text !== last) messages.push((last = v.message.text));
      if (v.prompt) return { messages, view: v };
    }
    throw new Error('no prompt');
  };

  /** Fights with move 1 to the end. */
  const fight = (b: Battle) => {
    for (let i = 0; i < 60000 && !b.done(); i++) {
      const p = b.view().prompt;
      if (p?.kind === 'command') b.choose({ kind: 'move', slot: 0 });
      else if (p?.kind === 'learn' || p?.kind === 'nickname') b.choose(p.kind === 'learn' ? { kind: 'keep' } : { kind: 'nickname', answer: 'no' } as never);
      else if (p?.kind === 'learn-ask') b.choose({ kind: 'answer', yes: p.ask === 'give-up' });
      b.step(IDLE);
    }
    const r = b.done();
    if (!r) throw new Error('the battle did not end');
    return r;
  };

  it('Intimidate at the start prints its line right after the send-out line', () => {
    const log = new CountingStubLog(() => {});
    const b = wild([shinx()], 1, log);
    const { messages, view } = toCommand(b);
    // The line names the ability: the battler shows it (BattlerView.ability, the replay auto policy reads it).
    expect(view.battlers.map((x) => x.ability)).toEqual([P('ABILITY_INTIMIDATE'), undefined]);
    const name = (s: string) => reg.species.get(P(s))!.name;
    const go = pages(text.get('GoPokemon', [name('SPECIES_SHINX')]), [])[0]!;
    const cut = pages(text.get('PokemonsAbilityCutsPokemonsStat', [name('SPECIES_SHINX'), reg.abilities.get(P('ABILITY_INTIMIDATE'))!.name, name('SPECIES_BIDOOF'), text.stat('atk')], 'AllyWild'), [])[0]!;
    expect(messages.slice(messages.indexOf(go), messages.indexOf(go) + 2)).toEqual([go, cut]);
    expect(log.report().filter((s) => s.key.startsWith('battle:protocol'))).toEqual([]);
  });

  it('a berry eaten on entry is gone after the battle; a held item the battle did not touch stays', () => {
    // Oran Berry at under half HP: eaten as Shinx comes out (the sim's start), healing 10.
    const lead = shinx({ hp: 10, item: 'ITEM_ORAN_BERRY' });
    const b = wild([lead, shinx({ item: 'ITEM_EVERSTONE' })], 1);
    const { messages } = toCommand(b);
    expect(messages).toContain(pages(text.get('PokemonRestoredItsHealthUsingItsItem', [lead.nickname ?? reg.species.get(lead.species)!.name, reg.items.get(P('ITEM_ORAN_BERRY'))!.name], 'Ally'), [])[0]);
    const r = fight(b);
    expect(r.party[0]!.heldItem).toBeNull();
    expect(r.party[1]!.heldItem).toBe(P('ITEM_EVERSTONE'));
  });

  it('a stolen item stays with the thief; a knocked-off item comes back after the battle', () => {
    const b = wild([shinx({ item: 'ITEM_SITRUS_BERRY' }), shinx()], 2);
    toCommand(b);
    // The sim's own state, as Thief and Knock Off leave it (the moves' own checks are the sim's).
    const sims = (b as unknown as { own: { sims: { item: string; itemKnockedOff: boolean }[] } }).own.sims;
    sims[0]!.item = '';
    sims[0]!.itemKnockedOff = true;
    sims[1]!.item = 'leftovers';
    const r = fight(b);
    expect(r.party[0]!.heldItem).toBe(P('ITEM_SITRUS_BERRY'));
    expect(r.party[1]!.heldItem).toBe(P('ITEM_LEFTOVERS'));
  });

  it('the enemy side cannot steal or swap items; the player can', () => {
    const data = simData(reg, new CountingStubLog(() => {}));
    const run = (thiefSide: 'p1' | 'p2', move: string) => {
      const sim = data.createBattle('trainer', 'singles', { prng: new PRNG('sodium,00000000000000000000000000000000') } as never);
      const user = { species: 'Sneasel', name: 'U', moves: [move], level: 50, ability: 'Inner Focus', evs: {}, ivs: {} };
      const holder = { species: 'Snorlax', name: 'H', moves: ['splash'], level: 50, item: 'Leftovers', ability: 'Thick Fat', evs: {}, ivs: {} };
      sim.setPlayer('p1', { name: 'a', team: [thiefSide === 'p1' ? user : holder] } as never);
      sim.setPlayer('p2', { name: 'b', team: [thiefSide === 'p1' ? holder : user] } as never);
      sim.choose('p1', 'move 1');
      sim.choose('p2', 'move 1');
      return (sim[thiefSide === 'p1' ? 'p2' : 'p1'].pokemon[0] as unknown as { item: string }).item;
    };
    expect(run('p1', 'thief')).toBe('');
    expect(run('p2', 'thief')).toBe('leftovers');
    expect(run('p1', 'trick')).toBe('');
    expect(run('p2', 'trick')).toBe('leftovers');
    expect(run('p2', 'covet')).toBe('leftovers');
  });
});
