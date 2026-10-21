/**
 * Battle text coverage on the real ROM (OPENSINNOH_NDS_ROM): every third singles trainer of the ROM fights a
 * party built from another trainer's (levelled to match), both sides picking random usable moves, and every
 * protocol line the sim writes must print its decomp battle string. The lines that still have no message are
 * listed here, each with the reason; anything else that comes up fails.
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, Prng, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';
import { BattleText, pages } from '../messages.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;

/** Protocol lines with no message yet (logged stubs), by key pattern. */
const LISTED: [RegExp, string][] = [
  [/^battle:protocol:-formechange\|/, 'in-battle form changes (Cherrim, Castform): the forme sprite swap is not implemented'],
  [/^battle:protocol:-activate\|P\|ability: Shed Skin$/, 'ability status cures need the status names (decomp TAG 17)'],
  [/^battle:protocol:-curestatus\|P\|\w+\|\[msg\]$/, 'the cure after Shed Skin and Natural Cure: same'],
  [/^battle:protocol:-activate\|P\|move: Mimic\|/, 'Mimic\'s learned line has no foe or wild variant in the bank'],
];

describe.skipIf(!ROM)('battle text coverage (OPENSINNOH_NDS_ROM)', () => {
  it('every protocol line of a third of the ROM trainers\' battles prints its battle string, or is listed', () => {
    const { pack } = romSlice() as { pack: PackData };
    const { registries: reg } = loadGamePacks([pack]);
    const dex = dexOf(reg);
    const log = new CountingStubLog(() => {});
    const rng = new Prng(5);
    const trainers = [...reg.trainers.values()].filter((t) => !t.double && t.party.length);
    const text = new BattleText(reg);
    let battles = 0;
    /** Battles whose start had switch-in effects (Intimidate, Pressure, weather, Download, Frisk …). */
    let withStart = 0;
    trainers.forEach((t, n) => {
      if (n % 3) return;
      const other = trainers[rng.below(trainers.length)]!;
      const level = Math.max(...t.party.map((x) => x.level));
      const party = other.party.map((m) => createTrainerPokemon(dex, { ...m, level }, 'Lucas', P('ITEM_POKE_BALL')));
      const b = createBattle(
        { kind: 'trainer', trainers: [t.id], wild: [], background: null, terrain: null, time: 'day' },
        { registries: reg, party, bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 3000, badges: 0, caught: [], seed: n + 1, textSpeed: 1, log },
      );
      // The battle's start lines (the sim writes them inside setPlayer): the switch-in effects after the two
      // send-outs. When there are any, they print between the player's send-out and the first command.
      const simLog = (b as unknown as { sim: { log: string[] } }).sim.log;
      const turn1 = simLog.indexOf('|turn|1');
      let lastSwitch = turn1;
      while (!simLog[lastSwitch]!.startsWith('|switch|')) lastSwitch--;
      const startEffects = simLog.slice(lastSwitch + 1, turn1).filter((l) => l !== '|' && !l.startsWith('|t:|'));
      const intro: string[] = [];
      let commands = 0;
      for (let i = 0; i < 60000 && !b.done(); i++) {
        const p = b.view().prompt;
        const m = b.view().message;
        if (!commands && m?.done && m.text !== intro.at(-1)) intro.push(m.text);
        if (p?.kind === 'command' && !commands++ && startEffects.length) {
          withStart++;
          const lead = party[0]!;
          const go = intro.indexOf(pages(text.get('GoPokemon', [lead.nickname ?? reg.species.get(lead.species)!.name]), [])[0]!);
          const what = pages(text.get('WhatWillPokemonDo', [lead.nickname ?? reg.species.get(lead.species)!.name]), [])[0]!;
          expect(go, t.id).toBeGreaterThanOrEqual(0);
          expect(intro.slice(go + 1).filter((x) => x !== what).length, `${t.id}: ${startEffects.join(' ')}`).toBeGreaterThan(0);
        }
        if (p?.kind === 'command') {
          // A random move the battle takes (with PP, not disabled); with no PP anywhere, Struggle.
          const moves = p.moves.flatMap((m, k) => (m.pp > 0 ? [k] : []));
          const start = moves.length ? rng.below(moves.length) : 0;
          const taken = moves.some((_, j) => {
            try {
              b.choose({ kind: 'move', slot: moves[(start + j) % moves.length]! });
              return true;
            } catch {
              return false;
            }
          });
          if (!taken) b.choose({ kind: 'move', slot: 0 });
        } else if (p?.kind === 'learn' || p?.kind === 'shift') b.choose({ kind: 'keep' });
        else if (p?.kind === 'learn-ask') b.choose({ kind: 'answer', yes: p.ask === 'give-up' });
        else if (p?.kind === 'party') {
          // After a faint: the first Pokémon the battle accepts.
          const req = b.app() as { party: { hp: number; isEgg: boolean }[]; active: number };
          b.choose({ kind: 'switch', slot: req.party.findIndex((m, k) => k !== req.active && m.hp > 0 && !m.isEgg) });
        }
        b.step(IDLE);
      }
      expect(b.done(), t.id).not.toBeNull();
      battles++;
    });
    const unlisted = log.report().filter((s) => s.key.startsWith('battle:protocol') && !LISTED.some(([re]) => re.test(s.key)));
    expect(battles).toBeGreaterThan(250);
    expect(withStart).toBeGreaterThan(20);
    expect(unlisted.map((s) => `${s.key} ×${s.count}`)).toEqual([]);
  }, 300_000);
});
