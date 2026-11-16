/**
 * FIGHT under Encore on the fixture pack (no ROM): decomp PLAYER_INPUT_FIGHT skips the move list and uses the encored
 * move (moveEffectsData.encoredMoveSlot) at once; the command prompt names that slot (`encore`). Encore is put on the
 * sim between turns and its DisableMove event run again, as the sim does at a turn start.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleSetup, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import type { Battle as SimBattle, Pokemon as SimMon } from '@pkmn/sim';
import { createBattle } from '../index.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };
type Harness = Battle & { sim: SimBattle };

const mon = (species: string, level: number): Pokemon =>
  createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), heldItem: null });

function battle(override: Partial<BattleSetup> = {}, level = 40): Harness {
  const setup: BattleSetup = { kind: 'wild', trainers: [], wild: [{ species: f('SPECIES_SKYLET'), level: 30 }], background: null, terrain: null, time: 'day', topology: 'single', ...override };
  return createBattle(setup, {
    registries,
    party: [mon('SPECIES_MOSSGROVE', level), mon('SPECIES_EMBERKIT', level)],
    bag: {},
    pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
    met: { zone: null, date: null },
    player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' },
    money: 3000,
    badges: 1,
    caught: [],
    seed: 1,
    textSpeed: 4,
    log: new CountingStubLog(() => {}),
  }) as Harness;
}

function untilPrompt(b: Battle): void {
  for (let i = 0; i < 20000 && (i === 0 || !b.view().prompt) && !b.done(); i++) b.step(IDLE);
}

/** Encore on the player's lead (its last move), then the sim's DisableMove again (its turn start). */
function encore(b: Harness, index = 0): SimMon {
  const me = b.sim.p1.active[index]!;
  me.addVolatile('encore', b.sim.p2.active[0]!);
  for (const slot of me.moveSlots) slot.disabled = false;
  b.sim.runEvent('DisableMove', me);
  return me;
}

describe('FIGHT under Encore (fixture)', () => {
  it('uses the encored move at once, with no move list; the keys do the same', () => {
    for (const keys of [false, true]) {
      const b = battle();
      untilPrompt(b);
      const moves = b.sim.p1.active[0]!.moveSlots.length;
      expect(moves).toBeGreaterThan(1);
      const slot = moves - 1;
      b.choose({ kind: 'move', slot });
      untilPrompt(b);
      expect(b.view().prompt).toMatchObject({ kind: 'command' });
      const me = encore(b);
      const used = me.moveSlots[slot]!;
      expect(me.volatiles['encore']?.['move']).toBe(used.id);
      const pp = used.pp;
      if (keys) b.step({ held: ['a'], pressed: ['a'], touch: null });
      else b.choose({ kind: 'fight' });
      expect(b.view().prompt?.kind).not.toBe('fight');
      untilPrompt(b);
      expect(used.pp).toBe(pp - 1);
      expect(me.moveSlots.filter((m) => m !== used).every((m) => m.pp === m.maxpp)).toBe(true);
    }
  });

  it('the next command prompt names the encored slot; without Encore FIGHT opens the move list', () => {
    const b = battle();
    untilPrompt(b);
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt(b);
    expect(b.view().prompt).not.toHaveProperty('encore');
    encore(b);
    b.choose({ kind: 'fight' });
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', encore: 0 });
    const plain = battle();
    untilPrompt(plain);
    plain.choose({ kind: 'fight' });
    expect(plain.view().prompt).toMatchObject({ kind: 'fight' });
  });

  it('in a double the encored move takes a target of its own (decomp randomizeTarget)', () => {
    const b = battle({ kind: 'trainer', trainers: [f('TRAINER_TWINS')], wild: [], topology: 'double' }, 8);
    untilPrompt(b);
    for (const actor of [0, 2]) {
      expect(b.view().prompt).toMatchObject({ kind: 'command', actor });
      b.choose({ kind: 'move', slot: 0, target: 1 });
      untilPrompt(b);
    }
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 0 });
    encore(b);
    b.choose({ kind: 'fight' });
    expect(b.view().prompt?.kind).not.toBe('fight');
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 2 });
  });
});
