/**
 * Doubles over the real ROM's data (OPENSINNOH_NDS_ROM): every double trainer (type 3) and samples of two trainers
 * against the player alone (19), a wild double with a walking partner (74) and two trainers with a partner (75)
 * fight to the end, both sides on random usable moves and random targets, the player's party built from another
 * trainer's. Every battle must end, and every protocol line print its decomp battle string (the protocol test's
 * listed exceptions aside).
 */
import { describe, expect, it } from 'vitest';
import { createTrainerPokemon, Prng, type Id, type PackData } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleSetup, type InputFrame, type Trainer } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ROM, romSlice } from '../../../../tests/rom.ts';
import { createBattle } from '../controller.ts';

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const P = (s: string) => `platinum:${s}` as Id;
/** As in protocol.rom.test.ts: protocol lines with no message yet. */
const LISTED = [/^battle:protocol:-formechange\|/, /^battle:protocol:-activate\|P\|ability: Shed Skin$/, /^battle:protocol:-curestatus\|P\|\w+\|\[msg\]$/, /^battle:protocol:-activate\|P\|move: Mimic\|/];

describe.skipIf(!ROM)('doubles over the ROM (OPENSINNOH_NDS_ROM)', () => {
  it('every double trainer, and samples of the other topologies, fight to the end with every line shown', () => {
    const { pack } = romSlice() as { pack: PackData };
    const { registries: reg } = loadGamePacks([pack]);
    const dex = dexOf(reg);
    const log = new CountingStubLog(() => {});
    const rng = new Prng(11);
    const singles = [...reg.trainers.values()].filter((t) => !t.double && t.party.length);
    const doubles = [...reg.trainers.values()].filter((t) => t.double && t.party.length >= 2);
    const partyFor = (level: number) => {
      const other = singles[rng.below(singles.length)]!;
      const party = other.party.map((m) => createTrainerPokemon(dex, { ...m, level }, 'Lucas', P('ITEM_POKE_BALL')));
      // Two that can fight for the player's two battlers.
      while (party.length < 2) party.push(createTrainerPokemon(dex, { ...other.party[0]!, level }, 'Lucas', P('ITEM_POKE_BALL')));
      return party;
    };
    const top = (ts: Trainer[]) => Math.max(...ts.flatMap((t) => t.party.map((x) => x.level)));
    const fight = (setup: Partial<BattleSetup>, level: number, seed: number): Battle => {
      const b = createBattle(
        { kind: 'trainer', trainers: [], wild: [], background: null, terrain: null, time: 'day', ...setup },
        { registries: reg, party: partyFor(level), bag: {}, pc: { current: { box: 0, name: 'BOX 1' }, free: { box: 0, name: 'BOX 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Lucas', gender: 'male', trainerId: 1, rival: 'Barry' }, money: 3000, badges: 0, caught: [], seed, textSpeed: 1, log },
      );
      for (let i = 0; i < 90000 && !b.done(); i++) {
        const p = b.view().prompt;
        if (p?.kind === 'command') {
          const moves = p.moves.flatMap((m, k) => (m.pp > 0 ? [k] : []));
          const start = moves.length ? rng.below(moves.length) : 0;
          // A random target first (none: the DS default), then the others in turn.
          const order = [3, 1, 0, 2, undefined];
          const off = rng.below(order.length);
          const targets = order.map((_, k) => order[(off + k) % order.length]);
          const taken = moves.some((_, j) =>
            targets.some((t) => {
              try {
                b.choose({ kind: 'move', slot: moves[(start + j) % moves.length]!, ...(t === undefined ? {} : { target: t }) });
                return true;
              } catch {
                return false;
              }
            }),
          );
          if (!taken) b.choose({ kind: 'move', slot: 0 });
        } else if (p?.kind === 'learn' || p?.kind === 'shift') b.choose({ kind: 'keep' });
        else if (p?.kind === 'learn-ask') b.choose({ kind: 'answer', yes: p.ask === 'give-up' });
        else if (p?.kind === 'next') b.choose({ kind: 'party' });
        else if (p?.kind === 'party') {
          const slot = [0, 1, 2, 3, 4, 5].find((s) => {
            try {
              b.choose({ kind: 'switch', slot: s });
              return true;
            } catch {
              return false;
            }
          });
          if (slot === undefined) throw new Error('no replacement accepted');
        }
        b.step(IDLE);
      }
      return b;
    };
    const ended: Record<string, number> = { double: 0, 'trainer-pair': 0, 'ai-partner wild': 0, 'ai-partner trainer': 0 };
    doubles.forEach((t, n) => {
      expect(fight({ trainers: [t.id], topology: 'double' }, top([t]), n + 1).done(), t.id).not.toBeNull();
      ended.double!++;
    });
    const cheryl = reg.trainers.get(P('TRAINER_CHERYL_ETERNA_FOREST'))!;
    const species = [...reg.species.values()].filter((s) => s.sourceIndex && s.sourceIndex > 0 && s.sourceIndex < 494);
    for (let n = 0; n < 24; n++) {
      const a = singles[rng.below(singles.length)]!;
      let b = singles[rng.below(singles.length)]!;
      while (b === a) b = singles[rng.below(singles.length)]!;
      expect(fight({ trainers: [a.id, b.id], topology: 'trainer-pair' }, top([a, b]), 100 + n).done(), `${a.id} ${b.id}`).not.toBeNull();
      ended['trainer-pair']!++;
      expect(fight({ trainers: [a.id, b.id], topology: 'ai-partner', partner: cheryl.id }, top([a, b]), 200 + n).done(), `${a.id} ${b.id} 75`).not.toBeNull();
      ended['ai-partner trainer']!++;
      const wild = [0, 1].map(() => ({ species: species[rng.below(species.length)]!.id, level: 5 + rng.below(40) }));
      expect(fight({ kind: 'wild', wild, topology: 'ai-partner', partner: cheryl.id }, Math.max(...wild.map((w) => w.level)), 300 + n).done(), JSON.stringify(wild)).not.toBeNull();
      ended['ai-partner wild']!++;
    }
    console.log(`doubles over the ROM: ${JSON.stringify(ended)}`);
    expect(doubles.length).toBeGreaterThan(8);
    const unlisted = log.report().filter((s) => (s.key.startsWith('battle:protocol') && !LISTED.some((re) => re.test(s.key))) || s.key === 'battle:party-in-battle');
    expect(unlisted.map((s) => `${s.key} ×${s.count}`)).toEqual([]);
  }, 600_000);
});
