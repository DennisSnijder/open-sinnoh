import { expect, it } from 'vitest';
import { set, start } from './parity-fixture.ts';

it('checks sleep at the U-turn interception, after earlier actions in doubles', () => {
  const b = start([set(['pursuit']), set(['splash'])], [set(['spore']), set(['uturn']), set(['splash'])], 'doubles');
  b.p1.active[0]!.storedStats.spe = 30;
  b.p2.active[0]!.storedStats.spe = 150;
  b.p2.active[1]!.storedStats.spe = 120;
  b.randomChance = () => true;
  b.makeChoices('move 1 2, move 1', 'move 1 1, move 1 2');
  expect(b.p1.active[0]!.status).toBe('slp');
  expect(b.log.some((l) => l.startsWith('|move|p1a:') && l.includes('|Pursuit|'))).toBe(false);
});

it('Pursuit hits the outgoing battler at double power and spends Pressure PP once', () => {
  const b = start([set(['pursuit'])], [set(['splash'], 'Pressure'), set(['splash'])]);
  const source = b.p1.active[0]!;
  const target = b.p2.active[0]!;
  const before = source.moveSlots[0]!.pp;
  b.randomChance = (_n, d) => d === 100;
  b.randomizer = (damage) => damage;
  b.makeChoices('move 1', 'switch 2');
  expect(target.hp).toBe(123); // BP80: floor(22 * 80 / 50) + 2 = 37
  expect(source.moveSlots[0]!.pp).toBe(before - 2);
  expect(b.p2.active[0]!.hp).toBe(160);
  expect(b.log.filter((l) => l.startsWith('|move|p1a:') && l.includes('|Pursuit|'))).toHaveLength(1);
});

it('a successful Pursuit interception consumes the active turn of Truant', () => {
  const b = start([set(['pursuit'], 'Truant')], [set(['splash']), set(['splash'])]);
  b.randomChance = (_n, d) => d === 100;
  b.makeChoices('move 1', 'switch 2');
  const log = b.log.length;
  b.makeChoices('move 1', 'move 1');
  expect(b.log.slice(log).some((l) => l.startsWith('|cant|p1a:') && l.includes('Truant'))).toBe(true);
});
