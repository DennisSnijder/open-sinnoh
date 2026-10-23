/**
 * Battle message timing against the decomp's render rules (render_text.c RenderText,
 * BattleSys_SetRenderControlFlags, BtlCmd_WaitButtonABTime), on the fixture pack (no ROM). At NORMAL text
 * speed (4) a char takes 4 render calls and the print task runs twice a tick: one char per 2 ticks. A fresh A/B
 * press while a char waits speeds the printer up; from then on held A/B prints one char per call (2 a tick). In
 * battle a held touch prints one char per call even without a fresh press, a {clear} or {scroll} auto-scrolls
 * after 100 render calls and a fresh A/B or touch ends that wait early; the catching tutorial has neither.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Button, type Id } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleSetup, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle } from '../index.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;

const IDLE: InputFrame = { held: [], pressed: [], touch: null };
const press = (b: Button): InputFrame => ({ held: [b], pressed: [b], touch: null });
const hold = (b: Button): InputFrame => ({ held: [b], pressed: [], touch: null });
const TOUCH: InputFrame = { held: [], pressed: [], touch: { x: 128, y: 96 } };

/** "A wild Skylet leaps out!{clear}": 24 chars, then the auto-scrolling clear. */
const WILD = 'A wild Skylet leaps out!';

function battle(kind: 'wild' | 'tutorial' = 'wild', se?: (seq: number) => void): Battle {
  const lead = createPokemon(dex, { species: f('SPECIES_MOSSLET'), level: 8, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_POKE_BALL') });
  const setup: BattleSetup = {
    kind,
    trainers: [],
    wild: [{ species: f('SPECIES_SKYLET'), level: 3 }],
    background: null,
    terrain: null,
    time: 'day',
    ...(kind === 'tutorial' ? { counterpart: { name: 'Bo', gender: 'male' as const, species: f('SPECIES_MOSSLET') } } : {}),
  };
  return createBattle(setup, {
    registries,
    party: [lead],
    bag: {},
    pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
    met: { zone: null, date: null },
    player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' },
    money: 3000,
    badges: 0,
    caught: [],
    seed: 7,
    textSpeed: 4,
    log: new CountingStubLog(() => {}),
    ...(se ? { sound: { victory() {}, se } } : {}),
  });
}

const text = (b: Battle) => b.view().message?.text ?? '';

/** Steps with `before` until the wild line's first char shows (the tick it starts printing). */
function toWildLine(b: Battle, before: InputFrame = IDLE): void {
  for (let i = 0; i < 2000; i++) {
    b.step(before);
    if (text(b) && WILD.startsWith(text(b))) return;
  }
  throw new Error('the wild line never printed');
}

/** Ticks, counting the first char's, until the whole line shows; `input(n)` is tick n's input (n from 1). */
function printTicks(b: Battle, input: (n: number) => InputFrame): number {
  for (let n = 1; n < 500; n++) {
    if (n > 1) b.step(input(n));
    if (text(b) === WILD) return n;
  }
  throw new Error('the line never finished');
}

/** Ticks from the whole line until the next message's first char, with `input(n)` on tick n (from 1). */
function gapTicks(b: Battle, input: (n: number) => InputFrame): number {
  for (let n = 1; n < 500; n++) {
    b.step(input(n));
    if (text(b) !== WILD) return n;
  }
  throw new Error('the next message never started');
}

/** The wild line printed with no input, then its gap with `input`; `se` hears the battle's sound effects. */
function gap(input: (n: number) => InputFrame, kind: 'wild' | 'tutorial' = 'wild', se?: (seq: number) => void): number {
  const b = battle(kind, se);
  toWildLine(b);
  printTicks(b, () => IDLE);
  return gapTicks(b, input);
}

const at = (tick: number, frame: InputFrame) => (n: number) => (n === tick ? frame : IDLE);

describe('battle message speed (decomp RenderText, battle render flags)', () => {
  it('prints one char per 2 ticks; a fresh A or B press while printing, then the button held, prints two a tick', () => {
    const idle = battle();
    toWildLine(idle);
    // Char n on render call 4n - 3, two calls a tick: char 24 on call 93, tick 47.
    expect(printTicks(idle, () => IDLE)).toBe(47);
    for (const button of ['a', 'b'] as const) {
      const sped = battle();
      toWildLine(sped);
      // Tick 2: the press ends the char's delay on call 3 and call 4 prints (held + speedUp); then a char
      // every call: 2 chars by tick 2, 24 by tick 13.
      expect(printTicks(sped, (n) => (n === 2 ? press(button) : hold(button)))).toBe(13);
    }
  });

  it('A held from before the message does not speed it up: the printer needs a fresh press', () => {
    const b = battle();
    b.step(press('a'));
    toWildLine(b, hold('a'));
    expect(printTicks(b, () => hold('a'))).toBe(47);
  });

  it('a held touch prints one char per render call even without a fresh press; not in the catching tutorial', () => {
    const b = battle();
    toWildLine(b, TOUCH);
    // The touch was held when the line began: 2 chars on its first tick, 24 by tick 12.
    expect(text(b)).toBe('A ');
    expect(printTicks(b, () => TOUCH)).toBe(12);

    const tutorial = battle('tutorial');
    toWildLine(tutorial, TOUCH);
    expect(printTicks(tutorial, () => TOUCH)).toBe(47);
  });

  it('the {clear} after a line auto-scrolls after 100 render calls; a fresh A, B or tap ends it early, X does not', () => {
    // After char 24 (call 93): calls 94-96 are the {clear}'s own char delay, call 97 (gap tick 2) reads it,
    // calls 98-197 count the auto-scroll wait to 100, call 198 goes on, calls 199-201 are the next delay and
    // call 202 (gap tick 54) ends the message. Then the post-message wait (MESSAGE_HOLD, 20 ticks) and the
    // send-out line's first char on gap tick 75.
    expect(gap(() => IDLE)).toBe(75);
    // A fresh A, B or tap on gap tick 2 ends the wait on call 98: the message ends on call 102 (gap tick 4).
    expect(gap(at(2, press('a')))).toBe(25);
    expect(gap(at(2, press('b')))).toBe(25);
    expect(gap(at(2, TOUCH))).toBe(25);
    // X and Y end only the post-message wait (WaitButtonABTime), not the printer's.
    expect(gap(at(2, press('x')))).toBe(75);
    // The catching tutorial auto-scrolls without an early end (AUTO_SCROLL_ENABLED, no touch flag).
    expect(gap(at(2, press('a')), 'tutorial')).toBe(75);
    expect(gap(at(2, TOUCH), 'tutorial')).toBe(75);
  });

  it('the post-message wait ends at a fresh A, B, X or Y press or a tap, from its first tick (BtlCmd_WaitButtonABTime)', () => {
    // The message ends on gap tick 54; the wait reads ticks 55-74. A press there ends it, and the send-out
    // line prints on the same tick.
    for (const button of ['a', 'b', 'x', 'y'] as const) {
      expect(gap(at(55, press(button)))).toBe(55);
      expect(gap(at(74, press(button)))).toBe(74);
    }
    expect(gap(at(60, TOUCH))).toBe(60);
    // A touch already held when the wait began is not a tap; a held button is not a press.
    expect(gap((n) => (n >= 54 ? TOUCH : IDLE))).toBe(75);
    expect(gap((n) => (n >= 55 ? hold('a') : IDLE))).toBe(75);
  });

  it('a press that ends the {clear} early plays SE_CONFIRM once; the auto-scroll running out and the post-message wait are silent', () => {
    const heard = (input: (n: number) => InputFrame, kind: 'wild' | 'tutorial' = 'wild') => {
      const se: number[] = [];
      // The send-out's ball-open sound (1798) is not the printer's.
      gap(input, kind, (seq) => seq !== 1798 && se.push(seq));
      return se;
    };
    expect(heard(at(2, press('a')))).toEqual([1500]);
    expect(heard(at(2, press('b')))).toEqual([1500]);
    expect(heard(at(2, TOUCH))).toEqual([1500]);
    // Left to run out (decomp TextPrinter_WaitAutoMode reaching 100): no sound.
    expect(heard(() => IDLE)).toEqual([]);
    // The catching tutorial's printer takes no press at the wait.
    expect(heard(at(2, press('a')), 'tutorial')).toEqual([]);
    // A press during the post-message wait (BtlCmd_WaitButtonABTime) ends it silently.
    expect(heard(at(60, press('a')))).toEqual([]);
  });

  it('pressing to speed up a battle line is silent', () => {
    const se: number[] = [];
    const b = battle('wild', (seq) => se.push(seq));
    toWildLine(b);
    printTicks(b, (n) => (n === 2 ? press('a') : hold('a')));
    expect(se).toEqual([]);
  });
});
