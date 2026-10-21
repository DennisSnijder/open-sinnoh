import { expect, it } from 'vitest';
import { set, start } from './parity-fixture.ts';

it('combines accuracy and evasion stages before applying the hit-rate fraction', () => {
  const b = start([set(['tackle'])]);
  b.p1.active[0]!.boosts.accuracy = 2;
  b.p2.active[0]!.boosts.evasion = 1;
  // Gen 4 Tackle accuracy 95, net stage +1: floor(95 * 4/3) = 126.
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return true; };
  b.makeChoices('move 1', 'move 1');
  expect(rates[0]).toBe(126);
});

it('floors each modifier in order: Compound Eyes, fog, Bright Powder, Wide Lens, Gravity', () => {
  const b = start([set(['sing'], 'Compound Eyes', 'Wide Lens')], [set(['splash'], 'No Ability', 'Bright Powder')]);
  b.field.setWeather('fog');
  b.field.addPseudoWeather('gravity', b.p1.active[0]!);
  // 55 -> 71 -> 42 -> 37 -> 40 -> 66, all integer divisions.
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return true; };
  b.makeChoices('move 1', 'move 1');
  expect(rates[0]).toBe(66);
});

it('an always-hit move does not consume Micle Berry accuracy', () => {
  const b = start([set(['aerialace'])]);
  b.p1.active[0]!.addVolatile('micleberry', b.p1.active[0]!);
  b.makeChoices('move 1', 'move 1');
  expect(b.p1.active[0]!.volatiles['micleberry']).toBeDefined();
});

it('Micle Berry waits until a numbered accuracy check, without a turn limit', () => {
  const b = start([set(['splash', 'sing'])]);
  b.p1.active[0]!.addVolatile('micleberry', b.p1.active[0]!);
  for (let turn = 0; turn < 3; turn++) b.makeChoices('move 1', 'move 1');
  expect(b.p1.active[0]!.volatiles['micleberry']).toBeDefined();
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return false; };
  b.makeChoices('move 2', 'move 1');
  expect(rates).toEqual([66]);
  expect(!!b.p1.active[0]!.volatiles['micleberry']).toBe(false);
});

it('weather guarantees a nominally numeric move after consuming Micle Berry', () => {
  const b = start([set(['blizzard'])]);
  b.field.setWeather('hail', b.p1.active[0]!);
  b.p1.active[0]!.addVolatile('micleberry', b.p1.active[0]!);
  b.makeChoices('move 1', 'move 1');
  expect(!!b.p1.active[0]!.volatiles['micleberry']).toBe(false);
});

it.each([
  [-6, 0, 'No Ability', 'No Ability', 31], [0, 6, 'No Ability', 'No Ability', 31],
  [6, -6, 'No Ability', 'No Ability', 285], [6, 6, 'No Ability', 'No Ability', 95],
  [2, 1, 'Simple', 'No Ability', 190], [1, 2, 'No Ability', 'Simple', 47],
  [6, 6, 'Simple', 'Simple', 95], [2, 1, 'No Ability', 'Unaware', 71],
  [2, 6, 'Unaware', 'No Ability', 158],
] as const)('accuracy %i / evasion %i (%s / %s): %i', (accuracy, evasion, attacker, defender, expected) => {
  const b = start([set(['tackle'], attacker)], [set(['splash'], defender)]);
  b.p1.active[0]!.boosts.accuracy = accuracy;
  b.p2.active[0]!.boosts.evasion = evasion;
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return d === 100; };
  b.makeChoices('move 1', 'move 1');
  expect(rates).toEqual([expected]);
});

it.each(['No Guard', 'No Ability'])('always-hit moves bypass lowered accuracy and fog (%s)', (ability) => {
  const b = start([set([ability === 'No Guard' ? 'tackle' : 'aerialace'], ability)]);
  b.field.setWeather('fog');
  b.p1.active[0]!.boosts.accuracy = -6;
  b.p2.active[0]!.boosts.evasion = 6;
  b.randomChance = () => false;
  b.makeChoices('move 1', 'move 1');
  expect(b.p2.active[0]!.hp).toBeLessThan(160);
});

it('OHKO moves ignore stage/modifier changes but still require the attacker level', () => {
  const b = start([set(['fissure'], 'Hustle', 'Wide Lens')]);
  b.field.setWeather('fog');
  b.p1.active[0]!.boosts.accuracy = -6;
  b.p2.active[0]!.boosts.evasion = 6;
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return false; };
  b.makeChoices('move 1', 'move 1');
  expect(rates).toEqual([30]);
  const higherLevel = start([set(['fissure'])], [{ ...set(['splash']), level: 51 }]);
  let checks = 0;
  higherLevel.randomChance = (_n, d) => { if (d === 100) checks++; return false; };
  higherLevel.makeChoices('move 1', 'move 1');
  expect(checks).toBe(0);
});

it.each(['Sand Veil', 'Snow Cloak'])('%s precedes Hustle and lens rounding', (defender) => {
  const b = start([set(['tackle'], 'Hustle', 'Wide Lens')], [set(['splash'], defender, 'Lax Incense')]);
  b.field.setWeather(defender === 'Sand Veil' ? 'sandstorm' : 'hail', b.p2.active[0]!);
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return d === 100; };
  b.makeChoices('move 1', 'move 1');
  expect(rates).toEqual([59]); // 95 -> 76 -> 60 -> 54 -> 59
});

it('Tangled Feet and Zoom Lens keep their ordered integer truncations', () => {
  const b = start([set(['tackle'], 'Hustle', 'Zoom Lens')], [set(['splash'], 'Tangled Feet', 'Bright Powder')]);
  b.p2.active[0]!.storedStats.spe = 150;
  b.p2.active[0]!.addVolatile('confusion', b.p2.active[0]!);
  b.p2.active[0]!.volatiles['confusion']!.time = 5;
  const rates: number[] = [];
  b.randomChance = (n, d) => { if (d === 100) rates.push(n); return true; };
  b.makeChoices('move 1', 'move 1');
  expect(rates).toEqual([40]); // 95 -> 76 -> 38 -> 34 -> 40
});
