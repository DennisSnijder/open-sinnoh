/**
 * A roamer's battle on the fixture pack (no ROM): the saved PID, IVs, HP and status, the escape after the
 * player's command whatever its speed or status (decomp AI_FLAG_ROAMING_POKEMON, BattleControllerPlayer_FleeCommand,
 * subscript_enemy_escape), and its HP and status in the result.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id, type Pokemon, type StatusCondition } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleSetup, type BattleView, type InputFrame, type WildSpec } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const IVS = { hp: 10, attack: 11, defense: 12, speed: 31, spAttack: 14, spDefense: 15 };

const lead = (level: number): Pokemon => createPokemon(dex, { species: f('SPECIES_MOSSLET'), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_POKE_BALL'), moves: [f('MOVE_BOP')] });

function battle(party: Pokemon[], wild: WildSpec, seed = 3): Battle {
  const setup: BattleSetup = { kind: 'wild', trainers: [], wild: [wild], background: null, terrain: null, time: 'day' };
  return createBattle(setup, {
    registries,
    party,
    bag: {},
    pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
    met: { zone: null, date: null },
    player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' },
    money: 3000,
    badges: 0,
    caught: [],
    seed,
    textSpeed: 4,
    log: new CountingStubLog(() => {}),
  });
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

const roamer = (hp: number, status: StatusCondition = 'none', level = 20): WildSpec => ({ species: f('SPECIES_SKYLET'), level, roamer: { pid: 0xabcdef01, ivs: IVS, hp, status } });

describe('roamer battle (fixture pack)', () => {
  it('starts from the saved roamer and flees after the player’s move on the first turn; the result carries its HP', () => {
    const b = battle([lead(20)], roamer(40, 'burn'));
    const intro = until(b);
    const foe = intro.view.battlers.find((x) => x.side === 'enemy')!;
    expect([foe.hp, foe.status]).toEqual([40, 'burn']);
    b.choose({ kind: 'move', slot: 0 });
    const turn = until(b);
    const used = turn.messages.indexOf('Mosslet tries\nBop!');
    const fled = turn.messages.indexOf('The wild Skylet slipped away!');
    expect(used).toBeGreaterThanOrEqual(0);
    expect(fled).toBeGreaterThan(used);
    // FIGHT_END: no end-of-turn effect after the escape (the burn would hurt it).
    expect(turn.messages.slice(fled)).not.toContain('The burn hurts wild Skylet!');
    const r = b.done()!;
    expect(r.outcome).toBe('fled');
    expect(r.roamer!.status).toBe('burn');
    expect(r.roamer!.hp).toBeLessThan(40);
    expect(r.caught).toBeNull();
  });

  it('flees asleep too (the flee command is no move); a roamer knocked out first does not flee', () => {
    const asleep = battle([lead(5)], roamer(60, 'sleep'));
    until(asleep);
    asleep.choose({ kind: 'move', slot: 0 });
    expect(until(asleep).messages).toContain('The wild Skylet slipped away!');
    expect(asleep.done()).toMatchObject({ outcome: 'fled', roamer: { status: 'sleep' } });

    const weak = battle([lead(60)], roamer(1, 'none', 5));
    until(weak);
    weak.choose({ kind: 'move', slot: 0 });
    const { messages } = until(weak);
    expect(messages).not.toContain('The wild Skylet slipped away!');
    expect(weak.done()).toMatchObject({ outcome: 'won', roamer: { hp: 0 } });
  });

  it('an ordinary wild Pokémon does not flee and has no roamer result', () => {
    const b = battle([lead(60)], { species: f('SPECIES_SKYLET'), level: 3 });
    until(b);
    b.choose({ kind: 'move', slot: 0 });
    expect(until(b).messages).not.toContain('The wild Skylet slipped away!');
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    expect(r.roamer).toBeUndefined();
  });
});
