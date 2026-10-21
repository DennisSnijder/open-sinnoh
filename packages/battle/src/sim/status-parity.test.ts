import { expect, it } from 'vitest';
import { set, start } from './parity-fixture.ts';

it.each([['brn', 140], ['psn', 140], ['tox', 150]] as const)('%s uses Gen 4 residual fractions', (status, hp) => {
  const b = start();
  b.p1.active[0]!.setStatus(status);
  b.makeChoices('move 1', 'move 1');
  expect(b.p1.active[0]!.hp).toBe(hp);
  if (status === 'tox') {
    b.makeChoices('move 1', 'move 1');
    expect(b.p1.active[0]!.hp).toBe(130);
  }
});

it('Toxic divides before multiplying, caps at stage 15, and resets on switching', () => {
  const b = start([set(['splash']), set(['splash'])]);
  const p = b.p1.active[0]!;
  p.maxhp = p.baseMaxhp = p.hp = 175;
  p.setStatus('tox');
  p.statusState.stage = 15;
  b.makeChoices('move 1', 'move 1');
  expect(p.hp).toBe(25); // floor(175 / 16) * 15 = 150
  b.makeChoices('switch 2', 'move 1');
  b.makeChoices('switch 2', 'move 1');
  expect(p.hp).toBe(15);
});

it.each([['No Ability', 2, 'slp'], ['Early Bird', 2, '']])('sleep decrements before moving (%s)', (ability, time, status) => {
  const b = start([set(['splash'], ability)]);
  const p = b.p1.active[0]!;
  p.setStatus('slp');
  p.statusState.time = time;
  b.makeChoices('move 1', 'move 1');
  expect(p.status).toBe(status);
  expect(b.log.some((l) => l.startsWith('|move|p1a:'))).toBe(status === '');
});

it('sleep keeps its remaining turns across a switch', () => {
  const b = start([set(['splash']), set(['splash'])]);
  const p = b.p1.active[0]!;
  p.setStatus('slp');
  p.statusState.time = 4;
  b.makeChoices('move 1', 'move 1');
  b.makeChoices('switch 2', 'move 1');
  b.makeChoices('switch 2', 'move 1');
  expect(p.statusState.time).toBe(3);
  b.makeChoices('move 1', 'move 1');
  expect(p.statusState.time).toBe(2);
});

it.each([['No Ability', true, 25], ['Magic Guard', false, 25], ['Quick Feet', true, 150]] as const)('paralysis movement and speed (%s)', (ability, blocked, speed) => {
  const b = start([set(['splash'], ability)]);
  const p = b.p1.active[0]!;
  p.setStatus('par');
  b.randomChance = () => true;
  expect(p.getStat('spe')).toBe(speed);
  b.makeChoices('move 1', 'move 1');
  expect(b.log.some((l) => l.startsWith('|cant|p1a:') && l.endsWith('|par'))).toBe(blocked);
});

it('freeze rolls 1/5 to thaw, and a defrost move works even when that roll fails', () => {
  for (const [move, thaw] of [['splash', false], ['splash', true], ['flamewheel', false]] as const) {
    const b = start([set([move])]);
    const p = b.p1.active[0]!;
    p.setStatus('frz');
    b.randomChance = (n, d) => d === 5 ? thaw : d === 100;
    b.makeChoices('move 1', 'move 1');
    expect(p.status).toBe(thaw || move === 'flamewheel' ? '' : 'frz');
  }
});

it('confusion uses a 40-power self hit, ends before the last check, and checks before paralysis', () => {
  const b = start();
  const p = b.p1.active[0]!;
  p.addVolatile('confusion', p);
  p.volatiles['confusion']!.time = 2;
  p.setStatus('par');
  b.randomChance = () => false; // confusion's 1/2 continue roll fails
  b.randomizer = (damage) => damage;
  b.makeChoices('move 1', 'move 1');
  expect(p.hp).toBe(141); // L50, Atk/Def100: base17 + 2, no STAB
  b.makeChoices('move 1', 'move 1');
  expect(p.volatiles['confusion']).toBeUndefined();
  expect(p.hp).toBe(141);
});
