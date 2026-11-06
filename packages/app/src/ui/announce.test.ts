import { describe, expect, it } from 'vitest';
import type { Game } from '@opensinnoh/game';
import { Announcer, announceFrame } from './announce.ts';

const make = () => {
  const said: string[] = [];
  return { said, a: new Announcer((t) => said.push(t)) };
};

describe('message pages', () => {
  it('a page is announced once, when it is finished, never while it types', () => {
    const { a, said } = make();
    a.message('He', false, 0);
    a.message('Hello', false, 100);
    a.message('Hello there!', false, 200);
    expect(said).toEqual([]);
    a.message('Hello there!\nHow are you?', true, 300);
    a.message('Hello there!\nHow are you?', true, 400);
    expect(said).toEqual(['Hello there! How are you?']);
  });

  it('a page that closes by itself is announced once it has stopped changing', () => {
    const { a, said } = make();
    a.message('Saved.', false, 0);
    a.message('Saved.', false, 1000);
    expect(said).toEqual([]);
    a.message('Saved.', false, 1600);
    a.message('Saved.', false, 2000);
    expect(said).toEqual(['Saved.']);
  });

  it('the next page and an identical page after a clear are announced again', () => {
    const { a, said } = make();
    a.message('One.', true, 0);
    a.message('', false, 10);
    a.message('One.', true, 20);
    a.message(null, false, 30);
    a.message('One.', true, 40);
    expect(said).toEqual(['One.', 'One.', 'One.']);
  });

  it('a page that scrolls repeats only its last line, which is not read twice', () => {
    const { a, said } = make();
    a.message('The first line.\nThe second line.', true, 0);
    a.message('The second line.\nThe third line.', true, 10);
    expect(said).toEqual(['The first line. The second line.', 'The third line.']);
    // A new message is a new start.
    a.message(null, false, 20);
    a.message('The third line.\nAnd more.', true, 30);
    expect(said.at(-1)).toBe('The third line. And more.');
  });
});

describe('choices', () => {
  it('say the cursor row when it changes, not every frame, and again after the choice closes', () => {
    const { a, said } = make();
    a.choice('yesno', 'YES');
    a.choice('yesno', 'YES');
    a.choice('yesno', 'NO');
    a.choice('yesno', null);
    a.choice('yesno', 'NO');
    expect(said).toEqual(['YES', 'NO', 'NO']);
  });
});

describe('the game', () => {
  const field = (view: object, battle?: object) => ({ inBattle: () => !!battle, battle: battle ? { view: () => battle } : null, scripts: { view: () => ({ message: null, yesNo: null, menu: null, ...view }) } }) as unknown as Game;

  it('reads the field message, the YES/NO cursor and a scripted menu row with its place', () => {
    const { a, said } = make();
    announceFrame(a, field({ message: { text: 'Will you go?', waitingForInput: true } }), null, 0);
    announceFrame(a, field({ message: { text: 'Will you go?', waitingForInput: true }, yesNo: { yes: 'YES', no: 'NO', cursor: 0 } }), null, 1);
    announceFrame(a, field({ yesNo: { yes: 'YES', no: 'NO', cursor: 1 } }), null, 2);
    announceFrame(a, field({ menu: { entries: ['Bag', 'Party'], cursor: 1 } }), null, 3);
    expect(said).toEqual(['Will you go?', 'YES', 'NO', 'Party, 2 of 2']);
  });

  it('reads the battle message when it is complete and the command card cursor', () => {
    const { a, said } = make();
    announceFrame(a, field({}, { message: { text: 'A wild Starly\nappeared!', done: false } }), null, 0);
    announceFrame(a, field({}, { message: { text: 'A wild Starly\nappeared!', done: true } }), 'FIGHT', 1);
    announceFrame(a, field({}, { message: null }), 'BAG', 2);
    expect(said).toEqual(['A wild Starly appeared!', 'FIGHT', 'BAG']);
  });
});
