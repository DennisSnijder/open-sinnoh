/**
 * The doubles command card on the fixture pack (no ROM): what the doubles command card and target screen read from the battle. Each
 * move's `aim` (the DS target screen's battlers, cursor order 3, 1, 0, 2), the target prompt the keys open (cursor,
 * group, B back to the moves, CANCEL), RUN as CANCEL on the second battler's card, and the party sheet's other
 * battler and first pick. The pure cursor walk is `targetCursor`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Button, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattlePrompt, type BattleSetup, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle } from '../index.ts';
import { TARGET_CANCEL, targetCursor } from './target-screen.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };

function mon(species: string, level: number): Pokemon {
  return createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), heldItem: null });
}

function battle(party: Pokemon[], override: Partial<BattleSetup> = {}): Battle {
  const setup: BattleSetup = { kind: 'trainer', trainers: [f('TRAINER_TWINS')], wild: [], background: null, terrain: null, time: 'day', topology: 'double', ...override };
  return createBattle(setup, {
    registries,
    party,
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
  });
}

function untilPrompt(b: Battle): void {
  for (let i = 0; i < 20000 && (i === 0 || !b.view().prompt) && !b.done(); i++) b.step(IDLE);
}

/** One tick with `buttons` pressed. */
function press(b: Battle, ...buttons: Button[]): BattlePrompt | null {
  b.step({ held: buttons, pressed: buttons, touch: null });
  return b.view().prompt;
}

const party = () => [mon('SPECIES_MOSSGROVE', 20), mon('SPECIES_EMBERKIT', 15), mon('SPECIES_DRIPLING', 15)];

describe('the doubles card (fixture, type 3)', () => {
  it('START toggles both friendly HP displays only at commands, persists through targets, and resets for a new battle', () => {
    const b = battle(party());
    untilPrompt(b);
    const modes = () => b.view().battlers.map((v) => !!v.healthbox.numbers);
    expect(modes()).toEqual([false, false, false, false]);
    press(b, 'start');
    expect(modes()).toEqual([true, false, true, false]);
    press(b, 'a');
    press(b, 'start');
    expect(modes()).toEqual([true, false, true, false]);
    press(b, 'a');
    expect(b.view().prompt?.kind).toBe('target');
    press(b, 'start');
    expect(modes()).toEqual([true, false, true, false]);
    press(b, 'b');
    press(b, 'b');
    press(b, 'start');
    expect(modes()).toEqual([false, false, false, false]);
    expect(battle(party()).view().battlers.every((v) => !v.healthbox.numbers)).toBe(true);
    const single = battle(party(), { kind: 'wild', topology: 'single', trainers: [], wild: [{ species: f('SPECIES_SKYLET'), level: 5 }] });
    untilPrompt(single);
    press(single, 'start');
    expect(single.view().battlers.every((v) => !v.healthbox.numbers)).toBe(true);
  });

  it('the HP display mode survives a replacement and stays synchronized between the two friendly boxes', () => {
    const b = battle(party());
    untilPrompt(b);
    press(b, 'start');
    b.choose({ kind: 'switch', slot: 2 });
    untilPrompt(b);
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt(b);
    expect(b.view().battlers[0]!.species).toBe(f('SPECIES_DRIPLING'));
    expect(b.view().battlers.filter((v) => v.side === 'player').every((v) => v.healthbox.numbers)).toBe(true);
    press(b, 'start');
    expect(b.view().battlers.every((v) => !v.healthbox.numbers)).toBe(true);
  });

  it('Giratina holds above the scene, enters vertically shaded, then clears its tint before the healthbox and commands', () => {
    const b = battle(party(), { kind: 'legendary', topology: 'single', trainers: [], wild: [{ species: f('SPECIES_SKYLET'), level: 5 }], giratina: true });
    const entrance = [];
    for (let i = 0; i < 1000 && !b.view().prompt; i++) {
      b.step(IDLE);
      const v = b.view();
      const foe = v.battlers.find((b) => b.side === 'enemy')!;
      if (foe.introShade !== undefined) {
        expect(foe.healthbox.visible).toBe(false);
        expect(v.prompt).toBeNull();
        entrance.push({ dy: foe.dy, dx: foe.dx, shade: foe.introShade });
      }
    }
    expect(entrance).toHaveLength(70);
    expect(entrance.slice(0, 28).every((e) => e.dy === -136 && e.dx === 0 && e.shade === 0.5)).toBe(true);
    expect(entrance.slice(28, 62).map((e) => e.dy)).toEqual(Array.from({ length: 34 }, (_, i) => -132 + i * 4));
    expect(entrance.slice(62).map((e) => e.shade)).toEqual([7, 6, 5, 4, 3, 2, 1, 0].map((n) => n / 16));
    expect(b.view().battlers[1]).toMatchObject({ dx: 0, dy: 0, healthbox: { visible: true } });
    expect(b.view().battlers[1]!.introShade).toBeUndefined();
    expect(b.view().prompt?.kind).toBe('command');
  });

  it('gives each move the target screen it opens: a single target its battlers in the cursor order, spread and self moves a group', () => {
    const b = battle(party());
    untilPrompt(b);
    const p = b.view().prompt as Extract<BattlePrompt, { kind: 'command' }>;
    expect(p.actor).toBe(0);
    for (const m of p.moves) {
      expect(m.aim, m.name).toBeDefined();
      expect(m.aim!.targets.length, m.name).toBeGreaterThan(0);
      // The order is the DS cursor's: 3, 1, 0, 2.
      expect(m.aim!.targets, m.name).toEqual([3, 1, 0, 2].filter((x) => m.aim!.targets.includes(x)));
      if (!m.aim!.group) expect(m.aim!.targets, m.name).not.toContain(0);
    }
    const single = p.moves.find((m) => !m.aim!.group && m.aim!.targets.length === 3)!;
    expect(single.aim!.targets).toEqual([3, 1, 2]);
  });

  it('A on a move opens the target screen; the d-pad walks it, B goes back to the moves, A aims the move', () => {
    const b = battle(party());
    untilPrompt(b);
    const moves = (b.view().prompt as Extract<BattlePrompt, { kind: 'command' }>).moves;
    const slot = moves.findIndex((m) => !m.aim!.group && m.aim!.targets.length === 3);
    let p = press(b, 'a');
    expect(p).toMatchObject({ kind: 'fight', actor: 0 });
    for (let i = 0; i < slot; i++) {
      press(b, i % 2 ? 'down' : 'right');
      b.step(IDLE);
    }
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: slot });
    p = press(b, 'a');
    expect(p).toMatchObject({ kind: 'target', cursor: 3, slot, actor: 0 });
    b.step(IDLE);
    expect(press(b, 'right')).toMatchObject({ kind: 'target', cursor: 1 });
    b.step(IDLE);
    expect(press(b, 'down')).toMatchObject({ kind: 'target', cursor: 2 });
    b.step(IDLE);
    expect(press(b, 'down')).toMatchObject({ kind: 'target', cursor: TARGET_CANCEL });
    b.step(IDLE);
    // A on CANCEL: back to the moves, the cursor on the move.
    expect(press(b, 'a')).toMatchObject({ kind: 'fight', cursor: slot });
    b.step(IDLE);
    press(b, 'a');
    b.step(IDLE);
    expect(press(b, 'b')).toMatchObject({ kind: 'fight', cursor: slot });
    b.step(IDLE);
    press(b, 'a');
    b.step(IDLE);
    press(b, 'right');
    b.step(IDLE);
    // A aims at enemy 1: battler 2's command comes next, and CANCEL can take it back.
    press(b, 'a');
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 2, canRewind: true });
  });

  it('the second battler\'s RUN is CANCEL: A on it goes back to the first battler', () => {
    const b = battle(party());
    untilPrompt(b);
    const moves = (b.view().prompt as Extract<BattlePrompt, { kind: 'command' }>).moves;
    b.choose({ kind: 'move', slot: 0, ...(moves[0]!.aim!.group ? {} : { target: moves[0]!.aim!.targets[0]! }) });
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 2, canRewind: true });
    press(b, 'down');
    b.step(IDLE);
    expect(b.view().prompt).toMatchObject({ cursor: 3 });
    press(b, 'a');
    untilPrompt(b);
    expect(b.view().prompt).toMatchObject({ kind: 'command', actor: 0 });
  });

  it('the party sheet knows the other battler\'s Pokémon and the first command\'s pick', () => {
    const b = battle([...party(), mon('SPECIES_SKYLET', 12)]);
    untilPrompt(b);
    b.choose({ kind: 'party' });
    b.step(IDLE);
    expect(b.app()).toMatchObject({ app: 'party-select', active: 0, inBattle: 1, forced: false });
    expect(b.app()).not.toHaveProperty('selected');
    b.appDone({ app: 'party-select', slot: 2 });
    untilPrompt(b);
    b.choose({ kind: 'party' });
    b.step(IDLE);
    expect(b.app()).toMatchObject({ app: 'party-select', active: 1, inBattle: 0, selected: 2 });
  });
});

describe('the target screen cursor (decomp sSelectTargetMenuButtonLayout)', () => {
  const walk = (cursor: number, aim: { targets: number[]; group: boolean }, ...dirs: ('up' | 'down' | 'left' | 'right')[]) =>
    dirs.reduce((c, d) => targetCursor(c, aim, (x) => x === d), cursor);
  it('moves between the battlers a single-target move may aim at, skipping the rest, down to CANCEL', () => {
    const others = { targets: [3, 1, 2], group: false };
    expect(walk(3, others, 'right')).toBe(1);
    expect(walk(1, others, 'left')).toBe(3);
    expect(walk(3, others, 'down')).toBe(2);
    expect(walk(1, others, 'down')).toBe(2);
    expect(walk(2, others, 'left')).toBe(2);
    expect(walk(2, others, 'down')).toBe(TARGET_CANCEL);
    expect(walk(TARGET_CANCEL, others, 'up')).toBe(2);
    expect(walk(2, others, 'up')).toBe(1);
    const foes = { targets: [3, 1], group: false };
    expect(walk(1, foes, 'down')).toBe(TARGET_CANCEL);
    expect(walk(TARGET_CANCEL, foes, 'up')).toBe(3);
  });
  it('a group is one stop over its battlers, CANCEL under it', () => {
    const spread = { targets: [3, 1], group: true };
    expect(walk(3, spread, 'right', 'left')).toBe(3);
    expect(walk(3, spread, 'down')).toBe(TARGET_CANCEL);
    expect(walk(TARGET_CANCEL, spread, 'up')).toBe(3);
  });
});
