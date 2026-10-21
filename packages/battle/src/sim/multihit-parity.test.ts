import { expect, it } from 'vitest';
import { set, start } from './parity-fixture.ts';

it('Skill Link does not bypass Triple Kick accuracy checks after the first hit', () => {
  const b = start([set(['triplekick'], 'Skill Link')]);
  let checks = 0;
  b.randomChance = (_n, d) => d === 100 ? ++checks === 1 : false;
  b.makeChoices('move 1', 'move 1');
  expect(b.log.find((l) => l.startsWith('|-hitcount|'))?.split('|')[3]).toBe('1');
  expect(checks).toBe(2);
});

it('Triple Kick combines accuracy and evasion stages for every kick', () => {
  const b = start([set(['triplekick'])]);
  b.p1.active[0]!.boosts.accuracy = 1;
  b.p2.active[0]!.boosts.evasion = 2;
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return d === 100; };
  b.makeChoices('move 1', 'move 1');
  expect(rates).toEqual([67, 67, 67]);
});

it.each(['No Guard', 'Lock-On'])('%s overrides only the first Triple Kick accuracy check', (override) => {
  const b = start([set(['triplekick'], override === 'No Guard' ? override : 'No Ability')]);
  if (override === 'Lock-On') b.p1.active[0]!.addVolatile('lockon', b.p2.active[0]!);
  b.randomChance = () => false;
  b.makeChoices('move 1', 'move 1');
  expect(b.log.find((l) => l.startsWith('|-hitcount|'))?.split('|')[3]).toBe('1');
});

it.each(['doublekick', 'furyattack'])('%s checks accuracy once and rolls damage separately per hit', (move) => {
  const b = start([set([move], 'Skill Link')]);
  let accuracy = 0;
  let damage = 0;
  b.randomChance = (_n, d) => { if (d === 100) accuracy++; return d === 100; };
  b.randomizer = (base) => { damage++; return base; };
  b.makeChoices('move 1', 'move 1');
  expect(accuracy).toBe(1);
  expect(damage).toBe(move === 'doublekick' ? 2 : 5);
});

it('multi-hit stops when the attacker falls asleep between hits', () => {
  const b = start([set(['doublekick'])], [set(['splash'], 'Effect Spore')]);
  // Effect Spore: activate, then choose sleep. Accuracy always hits; criticals do not.
  b.randomChance = (_n, d) => d === 100 || d === 10;
  b.sample = (choices) => choices[0]!;
  b.makeChoices('move 1', 'move 1');
  expect(b.p1.active[0]!.status).toBe('slp');
  expect(b.log.find((l) => l.startsWith('|-hitcount|'))?.split('|')[3]).toBe('1');
});
