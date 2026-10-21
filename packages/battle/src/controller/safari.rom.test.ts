/**
 * Safari battles on the real ROM (OPENSINNOH_NDS_ROM; decomp BATTLE_TYPE_SAFARI, battle_controller_player.c
 * SafariBallCommand / SafariBaitCommand / SafariRockCommand, battle_display.c Task_SafariPokemonSetCommandSelection,
 * subscript_throw_safari_ball / _safari_throw_bait / _safari_throw_rock / _safari_escape): no send-out, the Safari
 * healthbox, BALL / BAIT / MUD / RUN, the catch and escape stages, and the end of the balls.
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, type Id, type PackData, type Pokemon } from '@opensinnoh/core';
import { dexOf, type InputFrame, type Registries } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';
import { BattleText, pages } from '../messages.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;
type Stages = { safari: { balls: number; stage: number; escape: number } };

describe.skipIf(!ROM)('Safari battles (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  const load = () => (reg ??= loadGamePacks([romSlice().pack as PackData]).registries);
  const mon = (): Pokemon => createTrainerPokemon(dexOf(reg), { species: P('SPECIES_GARCHOMP'), level: 50, ivs: 31, pid: 0x10, otId: 1, moves: [P('MOVE_DRAGON_CLAW')] }, 'Lucas', P('ITEM_POKE_BALL'));
  const battle = (species: string, balls: number, seed: number) =>
    createBattle(
      { kind: 'safari', trainers: [], wild: [{ species: P(`SPECIES_${species}`), level: 27 }], background: null, terrain: null, time: 'day', safariBalls: balls },
      { registries: reg, party: [mon()], bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 0, badges: 8, caught: [], seed, textSpeed: 1, log: new CountingStubLog(() => {}) },
    );
  /** Steps to the next prompt (answering the nickname question NO), or the end; collects every finished page. */
  const untilPrompt = (b: ReturnType<typeof battle>, messages: string[]) => {
    for (let i = 0; i < 30000; i++) {
      if (b.done()) return;
      b.step(IDLE);
      const v = b.view();
      if (v.message?.done && messages.at(-1) !== v.message.text) messages.push(v.message.text);
      if (v.prompt?.kind === 'nickname') b.choose({ kind: 'nickname', give: false });
      else if (v.prompt?.kind === 'pokedex') b.appDone({ app: 'pokedex-entry' });
      else if (v.prompt) return;
    }
    throw new Error('the Safari battle never reached a prompt');
  };
  const page = (name: string, vars: string[]) => pages(new BattleText(reg).get(name, vars), [])[0]!;
  const stages = (b: ReturnType<typeof battle>) => (b as unknown as Stages).safari;

  it('opens without a send-out: the Safari healthbox, the trainer, "What will Lucas throw?", BALL/BAIT/MUD/RUN', () => {
    load();
    const b = battle('WOOPER', 30, 1);
    const messages: string[] = [];
    untilPrompt(b, messages);
    const v = b.view();
    expect(messages[0]).toBe(page('AWildPokemonAppeared', [reg.species.get(P('SPECIES_WOOPER'))!.name]));
    expect(v.kind).toBe('safari');
    expect(v.safari).toEqual({ balls: 30, healthbox: { visible: true, dx: 0 } });
    expect(v.battlers.find((x) => x.side === 'player')!.visible).toBe(false);
    expect(v.trainer).not.toBeNull();
    expect(v.prompt).toMatchObject({ kind: 'command', moves: [], enabled: [true, true, true, true] });
    expect(v.message!.text).toBe(page('WhatWillPlayerThrow', ['Lucas']));
    expect(() => b.choose({ kind: 'fight' })).toThrow(/Safari command card/);
    expect(() => b.choose({ kind: 'item', item: P('ITEM_POKE_BALL') })).toThrow(/Safari command card/);
  }, 120_000);

  it('Mud and Bait move the catch stage and the escape count as the decomp does, with their messages', () => {
    load();
    const name = reg.species.get(P('SPECIES_BIBAREL'))!.name;
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const b = battle('BIBAREL', 30, seed);
      const messages: string[] = [];
      untilPrompt(b, messages);
      b.choose({ kind: 'safari', action: 'mud' });
      untilPrompt(b, messages);
      expect(messages).toContain(page('PlayerThrewMudAtThePokemon', ['Lucas', name]));
      const angry = messages.includes(page('PokemonIsAngry', [name]));
      expect(angry || messages.includes(page('PokemonIsBesideItselfWithAnger', [name]))).toBe(true);
      // Mud: escape count down; the catch stage down too unless the draw was 0 ("beside itself with anger").
      expect(stages(b)).toMatchObject({ escape: 5, stage: angry ? 5 : 6 });
      seen.add(angry ? 'angry' : 'beside');
      if (b.done()) {
        expect(messages.at(-1)).toBe(page('TheWildPokemonFled', [name]));
        expect(b.done()!.outcome).toBe('enemy-fled');
        seen.add('fled');
        continue;
      }
      expect(messages).toContain(page('PokemonIsWatchingCarefully', [name]));
      const before = { ...stages(b) };
      b.choose({ kind: 'safari', action: 'bait' });
      untilPrompt(b, messages);
      expect(messages).toContain(page('PlayerThrewSomeBaitAtThePokemon', ['Lucas', name]));
      const eating = messages.includes(page('PokemonIsEating', [name]));
      expect(eating || messages.includes(page('PokemonIsBusyEating', [name]))).toBe(true);
      // Bait: catch stage up; the escape count up too unless the draw was 0 ("busy eating").
      expect(stages(b)).toMatchObject({ stage: before.stage + 1, escape: before.escape + (eating ? 1 : 0) });
      seen.add(eating ? 'eating' : 'busy');
      expect(stages(b).balls).toBe(30);
    }
    for (const k of ['angry', 'beside', 'fled', 'eating', 'busy']) expect(seen, k).toContain(k);
  }, 300_000);

  it('the last Safari Ball: a miss ends the game in the battle, a catch keeps the Pokémon; Run always gets away', () => {
    load();
    const name = reg.species.get(P('SPECIES_TANGELA'))!.name;
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 40 && outcomes.size < 2; seed++) {
      const b = battle('TANGELA', 1, seed);
      const messages: string[] = [];
      untilPrompt(b, messages);
      b.choose({ kind: 'safari', action: 'ball' });
      untilPrompt(b, messages);
      const result = b.done()!;
      expect(result.safariBalls).toBe(0);
      if (result.outcome === 'caught') {
        expect(result.caught!.mon.ball).toBe(P('ITEM_SAFARI_BALL'));
        expect(result.party).toHaveLength(2);
      } else {
        expect(result.outcome).toBe('fled');
        expect(messages).toContain(page('YoureOutOfSafariBallsGameOver', []));
        expect(messages).not.toContain(page('TheWildPokemonFled', [name]));
      }
      outcomes.add(result.outcome);
    }
    expect([...outcomes].sort()).toEqual(['caught', 'fled']);
    const run = battle('WOOPER', 12, 1);
    const messages: string[] = [];
    untilPrompt(run, messages);
    run.choose({ kind: 'run' });
    untilPrompt(run, messages);
    expect(run.done()).toMatchObject({ outcome: 'fled', safariBalls: 12 });
    expect(messages.at(-1)).toBe(page('GotAwaySafely', []));
  }, 300_000);
});
