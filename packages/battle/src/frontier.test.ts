/**
 * A Battle Frontier battle on the fixture pack (no ROM): the frontier's own trainer and parties, no BAG,
 * and RUN asking to forfeit: NO goes back to the commands, YES ends the battle lost with the money untouched.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleView, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };

const mon = (species: string, level: number, otName: string): Pokemon => createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: 77, otName, otGender: 'male', ball: f('ITEM_POKE_BALL'), moves: [f('MOVE_BOP')] });

function battle(): Battle {
  return createBattle(
    {
      kind: 'trainer',
      trainers: [],
      wild: [],
      background: null,
      terrain: null,
      time: 'day',
      frontier: { facility: 'tower', party: [mon('SPECIES_MOSSLET', 50, 'Ash')], trainers: [{ id: 7, name: 'Vera', class: f('TRAINER_CLASS_HIKER'), className: f('Text_Class_Hiker'), party: [mon('SPECIES_SKYLET', 50, 'Vera')] }] },
    },
    {
      registries,
      party: [mon('SPECIES_EMBERKIT', 5, 'Ash')],
      bag: {},
      pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
      met: { zone: null, date: null },
      player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' },
      money: 3000,
      badges: 0,
      caught: [],
      seed: 3,
      textSpeed: 4,
      log: new CountingStubLog(() => {}),
    },
  );
}

function until(b: Battle, max = 5000): { messages: string[]; view: BattleView } {
  const messages: string[] = [];
  let last = '';
  for (let i = 0; i < max; i++) {
    b.step(IDLE);
    const v = b.view();
    if (v.message?.done && v.message.text !== last) messages.push((last = v.message.text));
    if (v.prompt || b.done()) return { messages, view: v };
  }
  throw new Error(`no prompt in ${max} ticks`);
}

describe('frontier battle (fixture pack)', () => {
  it("fights the frontier trainer's party with the frontier party, without the BAG", () => {
    const b = battle();
    const { view } = until(b);
    expect(view.prompt).toMatchObject({ kind: 'command', enabled: [true, false, true, true] });
    expect(view.battlers.find((x) => x.side === 'player')?.species).toBe(f('SPECIES_MOSSLET'));
    expect(view.battlers.find((x) => x.side === 'enemy')?.species).toBe(f('SPECIES_SKYLET'));
    expect(() => b.choose({ kind: 'bag' })).toThrow(/not available/);
  });

  it('RUN asks to forfeit: NO goes back, YES ends it lost with no money paid', () => {
    const b = battle();
    until(b);
    b.choose({ kind: 'run' });
    expect(until(b).view.prompt?.kind).toBe('forfeit');
    b.choose({ kind: 'answer', yes: false });
    expect(until(b).view.prompt?.kind).toBe('command');
    b.choose({ kind: 'run' });
    until(b);
    b.choose({ kind: 'answer', yes: true });
    const { messages } = until(b);
    expect(messages).toContain('You gave up\nthe match.');
    expect(b.done()).toMatchObject({ outcome: 'lost', money: 3000 });
  });
});
