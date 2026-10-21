import { expect, it } from 'vitest';
import { set, start } from './parity-fixture.ts';

it('drains half the HP actually removed from a Substitute, rounding down', () => {
  const b = start([set(['absorb'])], [set(['substitute'])]);
  const source = b.p1.active[0]!;
  const target = b.p2.active[0]!;
  source.hp = 80;
  target.addVolatile('substitute', target);
  target.volatiles['substitute']!.hp = 5;
  b.makeChoices('move 1', 'move 1');
  expect(source.hp).toBe(82);
});

it('Substitute costs one quarter of max HP and fails at exactly that HP', () => {
  for (const hp of [40, 41, 160]) {
    const b = start([set(['substitute'])]);
    const p = b.p1.active[0]!;
    p.hp = hp;
    b.makeChoices('move 1', 'move 1');
    expect(p.hp).toBe(hp === 40 ? 40 : hp - 40);
    expect(p.volatiles['substitute']?.hp).toBe(hp === 40 ? undefined : 40);
  }
});

it.each(['toxic', 'sing', 'thunderwave', 'willowisp'])('Substitute blocks %s', (move) => {
  const b = start([set([move])]);
  const target = b.p2.active[0]!;
  target.addVolatile('substitute', target);
  b.randomChance = () => true;
  b.makeChoices('move 1', 'move 1');
  expect(target.status).toBe('');
  expect(target.volatiles['substitute']!.hp).toBe(40);
});

it('a breaking hit spills no damage or secondary status through to the holder', () => {
  const b = start([set(['thunderbolt'])]);
  const target = b.p2.active[0]!;
  target.addVolatile('substitute', target);
  target.volatiles['substitute']!.hp = 1;
  b.randomChance = () => true;
  b.makeChoices('move 1', 'move 1');
  expect(target.hp).toBe(160);
  expect(target.status).toBe('');
  expect(target.volatiles['substitute']).toBeUndefined();
});

it('later hits of a multi-hit move reach the holder after breaking Substitute', () => {
  const b = start([set(['doublekick'])]);
  const target = b.p2.active[0]!;
  target.addVolatile('substitute', target);
  target.volatiles['substitute']!.hp = 1;
  b.randomChance = (_n, d) => d === 100;
  b.randomizer = (damage) => damage;
  b.makeChoices('move 1', 'move 1');
  expect(target.hp).toBe(145); // only kick two: BP30, L50, Atk/Def100 = 15
  expect(b.log.find((l) => l.startsWith('|-hitcount|'))?.split('|')[3]).toBe('2');
});
