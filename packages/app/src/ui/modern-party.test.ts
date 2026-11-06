import { describe, expect, it } from 'vitest';
import type { InputFrame, PartySlotView, PartyView } from '@opensinnoh/contracts';
import type { Button } from '@opensinnoh/core';
import { partyListInput } from './modern-party.ts';

/** The game's own cursor rule (packages/menus stack.ts `moveCursor`, two columns). */
function grid(c: number, count: number, dir: Button): number {
  const col = c % 2;
  if (dir === 'left') return col > 0 ? c - 1 : c;
  if (dir === 'right') return col < 1 && c + 1 < count ? c + 1 : c;
  if (dir === 'up') return c - 2 >= 0 ? c - 2 : c;
  if (dir === 'down') {
    if (c + 2 < count) return c + 2;
    return c < count - 1 - ((count - 1) % 2) ? count - 1 : c;
  }
  return c;
}

const member = {} as PartySlotView;
const view = (members: number, cursor: number, confirm = false): PartyView =>
  ({ slots: Array.from({ length: 6 }, (_, i) => (i < members ? member : null)), cursor, menu: null, message: null, yesNo: null, ...(confirm ? { confirm: 'OK' } : {}) }) as PartyView;
const frame = (b: Button): InputFrame => ({ held: [b], pressed: [b], touch: null });

describe('the Modern party list on the game’s 2-column cursor', () => {
  for (const members of [1, 2, 3, 4, 5, 6]) {
    for (const confirm of [false, true]) {
      it(`${members} members${confirm ? ', order mode' : ''}: up and down reach the next stop`, () => {
        const stops = members + (confirm ? 2 : 1);
        const viewCursor = (c: number) => (c < members ? c : c - members + 6);
        for (let c = 0; c < stops; c++) {
          const walk = (dir: Button) => partyListInput(frame(dir), view(members, viewCursor(c), confirm)).pressed.reduce((at, b) => grid(at, stops, b), c);
          expect(walk('down')).toBe(Math.min(c + 1, stops - 1));
          expect(walk('up')).toBe(Math.max(c - 1, 0));
          expect(walk('left')).toBe(c);
          expect(walk('right')).toBe(c);
        }
      });
    }
  }

  it('leaves other buttons, and a menu or message, to the game', () => {
    expect(partyListInput(frame('a'), view(6, 0)).pressed).toEqual(['a']);
    expect(partyListInput(frame('down'), view(6, 0)).held).toEqual([]);
    const menu = { ...view(6, 0), menu: { entries: [], cursor: 0 } };
    expect(partyListInput(frame('down'), menu).pressed).toEqual(['down']);
  });
});
