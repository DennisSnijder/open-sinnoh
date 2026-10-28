/**
 * The battle controller on the fixture pack's original creatures (no ROM): a whole wild battle through
 * the sim, determinism, running (with the hidden pass turn), exp and EVs, the move-learn prompt, and the
 * formulas against values worked out from the decomp.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleDeps, type BattleSetup, type BattleView, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { barColor, canEscape, ppColor, createBattle, gaugeCells, gaugeFrame, levelUpFriendship, pages } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };

function mon(species: string, level: number, o: { moves?: string[]; exp?: number } = {}): Pokemon {
  const m = createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_POKE_BALL'), ...(o.moves ? { moves: o.moves.map(f) } : {}) });
  if (o.exp !== undefined) m.exp = o.exp;
  return m;
}

function battle(party: Pokemon[], wild: { species: string; level: number }, seed: number, log = new CountingStubLog(() => {}), more: Partial<BattleDeps> = {}): Battle {
  const setup: BattleSetup = { kind: 'wild', trainers: [], wild: [{ species: f(wild.species), level: wild.level }], background: null, terrain: null, time: 'day' };
  return createBattle(setup, {
    registries,
    party,
    bag: {},
    pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
    met: { zone: null, date: null },
    player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' },
    money: 3000,
    badges: 0,
    caught: [],
    seed,
    textSpeed: 4,
    log,
    ...more,
  });
}

/** Ticks until a prompt waits or the battle is over; the finished messages on the way. */
function until(b: Battle, max = 5000): { messages: string[]; view: BattleView } {
  const messages: string[] = [];
  let last = '';
  for (let i = 0; i < max; i++) {
    b.step(IDLE);
    const v = b.view();
    if (v.message?.done && v.message.text !== last) messages.push((last = v.message.text));
    if (v.prompt || b.done()) return { messages, view: v };
  }
  throw new Error(`no prompt in ${max} ticks`);
}

function fight(b: Battle, slot = 0): string[] {
  const all: string[] = [];
  for (let turn = 0; turn < 50; turn++) {
    const { messages, view } = until(b);
    all.push(...messages);
    if (b.done()) return all;
    if (view.prompt?.kind !== 'command') throw new Error(`unexpected prompt ${view.prompt?.kind}`);
    b.choose({ kind: 'move', slot });
  }
  throw new Error('the battle did not end');
}

describe('wild battle (fixture pack)', () => {
  it('runs a whole battle: intro, turns, faint, exp and EVs, and returns the party', () => {
    const lead = mon('SPECIES_MOSSLET', 8);
    const exp = lead.exp;
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 7);
    const messages = fight(b);
    expect(messages.slice(0, 3)).toEqual(['A wild Skylet leaps out!', 'Your turn, Mosslet!', 'What should Mosslet try?']);
    expect(messages).toContain('Mosslet tries\nBop!');
    expect(messages).toContain('The wild Skylet is out!');
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    expect(r.turns).toBeGreaterThan(0);
    const after = r.party[0]!;
    // Skylet: base exp from the fixture, foe level 3, one participant (decomp BtlCmd_CalcExpGain).
    const gained = Math.floor((dex.species(f('SPECIES_SKYLET')).baseExp * 3) / 7);
    expect(after.exp).toBe(exp + gained);
    expect(messages).toContain(`Mosslet earned\n${gained} experience!`);
    expect(after.evs).toEqual(dex.species(f('SPECIES_SKYLET')).evYield);
    expect(after.pp[0]).toBeLessThan(dex.move(f('MOVE_BOP')).pp);
    expect(after.hp).toBeLessThanOrEqual(after.stats.hp);
  });

  it('plays the victory music once, with the first exp after the wild foe faints (decomp SEQ_GET_EXP_START)', () => {
    const events: string[] = [];
    const b = battle([mon('SPECIES_MOSSLET', 8)], { species: 'SPECIES_SKYLET', level: 3 }, 7, undefined, { sound: { victory: () => void events.push('victory') } });
    for (let i = 0; i < 5000 && !b.done(); i++) {
      b.step(IDLE);
      const v = b.view();
      if (v.message?.done && /experience/.test(v.message.text) && !events.includes('exp')) events.push('exp');
      if (v.prompt?.kind === 'command') b.choose({ kind: 'move', slot: 0 });
    }
    expect(events).toEqual(['victory', 'exp']);
  });

  it('is deterministic: the same seed and choices give the same battle, tick for tick', () => {
    const play = (seed: number) => {
      const b = battle([mon('SPECIES_MOSSLET', 8)], { species: 'SPECIES_BURROWBIT', level: 4 }, seed);
      const views: string[] = [];
      for (let turn = 0; turn < 50 && !b.done(); turn++) {
        const { view } = until(b);
        views.push(JSON.stringify(view));
        if (view.prompt) b.choose({ kind: 'move', slot: 0 });
      }
      return { views, result: b.done() };
    };
    expect(play(3)).toEqual(play(3));
    expect(play(3).views).not.toEqual(play(4).views);
  });

  it('a slow lead may fail to run; the foe still acts (the hidden pass move), then running works', () => {
    let failed = false;
    for (let seed = 1; seed < 40 && !failed; seed++) {
      const b = battle([mon('SPECIES_MOSSLET', 2)], { species: 'SPECIES_SKYLET', level: 30 }, seed);
      until(b);
      b.choose({ kind: 'run' });
      const { messages } = until(b);
      if (messages[0] !== 'No way out!') {
        expect(messages[0]).toBe('You slipped away!');
        expect(b.done()).toMatchObject({ outcome: 'fled' });
        continue;
      }
      failed = true;
      expect(messages[1]).toMatch(/^The wild Skylet tries\n/);
      expect(messages.join('|')).not.toMatch(/OpenSinnoh Pass/);
    }
    expect(failed).toBe(true);
  });

  it('asks before forgetting a move at a level-up with four moves known', () => {
    const table = dex.expTable(dex.species(f('SPECIES_MOSSLET')).growthRate);
    const lead = mon('SPECIES_MOSSLET', 12, { moves: ['MOVE_BOP', 'MOVE_STARE', 'MOVE_LEAF_TAP', 'MOVE_DIG_PAW'] });
    lead.exp = table[13]! - 1;
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 2);
    let prompt: BattleView['prompt'] = null;
    for (let turn = 0; turn < 50; turn++) {
      const { view } = until(b);
      if (view.prompt?.kind === 'learn-ask') {
        prompt = view.prompt;
        break;
      }
      b.choose({ kind: 'move', slot: 0 });
    }
    // Decomp SEQ_GET_EXP_*: "wants to learn", "can't learn more than four", "Make it forget another move?".
    expect(prompt).toMatchObject({ kind: 'learn-ask', ask: 'forget', cursor: 0 });
    expect(() => b.choose({ kind: 'move', slot: 0 })).toThrow(/answer yes\|no/);
    const press = (button: InputFrame['pressed'][number]) => b.step({ held: [button], pressed: [button], touch: null });
    // NO: "Well, then…" and "Should it give up?"; NO again: the questions start over.
    press('right');
    press('a');
    let { messages: asked } = until(b);
    expect(asked).toEqual(['Alright...', 'Skip the new move\nfor good?']);
    expect(b.view().prompt).toMatchObject({ kind: 'learn-ask', ask: 'give-up' });
    press('b');
    ({ messages: asked } = until(b));
    expect(asked).toEqual(['Mosslet longs to know\nBark Shield.', 'Yet Mosslet holds\nfour moves already.', 'Let go of an old\nmove?']);
    expect(b.view().prompt).toMatchObject({ kind: 'learn-ask', ask: 'forget' });
    // YES: "Which move goes?" and the forget screen.
    press('a');
    until(b);
    expect(b.view().prompt).toMatchObject({ kind: 'learn', move: { move: f('MOVE_BARK_SHIELD') } });
    expect(() => b.choose({ kind: 'move', slot: 0 })).toThrow(/forget <slot> or keep/);
    press('right');
    expect(b.view().prompt).toMatchObject({ kind: 'learn', cursor: 1 });
    press('down');
    expect(b.view().prompt).toMatchObject({ kind: 'learn', cursor: 3 });
    press('right');
    expect(b.view().prompt).toMatchObject({ kind: 'learn', cursor: 4 });
    press('left');
    expect(b.view().prompt).toMatchObject({ kind: 'learn', cursor: 3 });
    press('up');
    expect(b.view().prompt).toMatchObject({ kind: 'learn', cursor: 1 });
    // A on Stare: "1, 2, and… Poof!" and the new move, no further question (decomp SEQ_GET_EXP_ONE_TWO_POOF).
    press('a');
    const { messages } = until(b);
    expect(messages).toEqual(['One, two... gone!', 'Mosslet let go of\nStare.', 'Then...', 'Mosslet now knows\nBark Shield!']);
    const after = b.done()!.party[0]!;
    expect(after.level).toBe(13);
    expect(after.moves).toEqual(['MOVE_BOP', 'MOVE_BARK_SHIELD', 'MOVE_LEAF_TAP', 'MOVE_DIG_PAW'].map(f));
  });

  it('refuses choices with no prompt, a missing move or no PP', () => {
    const lead = mon('SPECIES_MOSSLET', 8, { moves: ['MOVE_BOP', 'MOVE_STARE'] });
    lead.pp[1] = 0;
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 1);
    expect(() => b.choose({ kind: 'move', slot: 0 })).toThrow(/no prompt/);
    until(b);
    expect(() => b.choose({ kind: 'move', slot: 2 })).toThrow(/no move in slot 3/);
    // From the command prompt (replays) a move that can't be used is an error; the move list refuses it (below).
    expect(() => b.choose({ kind: 'move', slot: 1 })).toThrow(/Stare can't be used now: That move has run dry!/);
    b.choose({ kind: 'move', slot: 0 });
  });

  it('the move list refuses a move with no PP (decomp BattleSystem_CanUseMove): its message, then the list again on it', () => {
    const lead = mon('SPECIES_MOSSLET', 8, { moves: ['MOVE_BOP', 'MOVE_STARE'] });
    lead.pp[1] = 0;
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 1);
    until(b);
    const press = (button: InputFrame['pressed'][number]) => b.step({ held: [button], pressed: [button], touch: null });
    // The d-pad: A on Stare.
    press('a');
    press('right');
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 1 });
    press('a');
    expect(b.view().prompt).toBeNull();
    let shown = until(b);
    expect(shown.messages).toEqual(['That move has\nrun dry!']);
    expect(shown.view.prompt).toMatchObject({ kind: 'fight', cursor: 1 });
    // The card (a click answers between ticks): the same, and a key press in the next tick is no second answer.
    b.choose({ kind: 'move', slot: 1 });
    press('a');
    shown = until(b);
    expect(shown.messages).toEqual(['That move has\nrun dry!']);
    expect(shown.view.prompt).toMatchObject({ kind: 'fight', cursor: 1 });
    // B goes back to the commands, which ask again.
    press('b');
    shown = until(b);
    expect(shown.messages).toEqual(['What should Mosslet try?']);
    expect(shown.view.prompt).toMatchObject({ kind: 'command' });
    press('a');
    press('left');
    press('a');
    expect(until(b).messages[0]).toMatch(/^Mosslet tries\nBop!|^The wild Skylet tries\n/);
  });

  it('a key press in the tick after the card answered is not a second answer', () => {
    const b = battle([mon('SPECIES_MOSSLET', 8, { moves: ['MOVE_BOP', 'MOVE_STARE', 'MOVE_LEAF_TAP', 'MOVE_DIG_PAW'] })], { species: 'SPECIES_SKYLET', level: 3 }, 1);
    until(b);
    b.choose({ kind: 'fight' });
    b.step({ held: ['down'], pressed: ['down'], touch: null });
    b.step({ held: ['right'], pressed: ['right'], touch: null });
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 3 });
    // The card picks Bop; A on Dig Paw arrives in the same tick: Bop is used.
    b.choose({ kind: 'move', slot: 0 });
    expect(() => b.step({ held: ['a'], pressed: ['a'], touch: null })).not.toThrow();
    expect(until(b).messages.join('|')).toMatch(/Mosslet tries\nBop!/);
  });

  it('Fight remembers the last chosen move after a turn and after cancelling', () => {
    const b = battle([mon('SPECIES_MOSSLET', 20, { moves: ['MOVE_BOP', 'MOVE_STARE'] })], { species: 'SPECIES_SKYLET', level: 20 }, 1);
    until(b);
    b.choose({ kind: 'move', slot: 1 });
    until(b);
    const press = (button: InputFrame['pressed'][number]) => b.step({ held: [button], pressed: [button], touch: null });
    press('a');
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 1 });
    press('b');
    press('a');
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 1 });
  });

  it('pointer Fight shares keyboard cursor memory, kept independently for each switched Pokémon', () => {
    const b = battle([
      mon('SPECIES_MOSSLET', 30, { moves: ['MOVE_BOP', 'MOVE_STARE'] }),
      mon('SPECIES_DRIPLING', 30),
    ], { species: 'SPECIES_SKYLET', level: 3 }, 1);
    until(b);
    b.choose({ kind: 'move', slot: 1 });
    until(b);
    b.choose({ kind: 'fight' });
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 1 });
    b.step({ held: ['b'], pressed: ['b'], touch: null });
    b.choose({ kind: 'switch', slot: 1 });
    until(b);
    b.choose({ kind: 'fight' });
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 0 });
    b.step({ held: ['b'], pressed: ['b'], touch: null });
    b.choose({ kind: 'switch', slot: 0 });
    until(b);
    b.choose({ kind: 'fight' });
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 1 });
  });

  it('the d-pad drives the command card: A on Fight opens the moves, A picks one, B goes back', () => {
    const b = battle([mon('SPECIES_MOSSLET', 8)], { species: 'SPECIES_SKYLET', level: 3 }, 1);
    until(b);
    const press = (button: InputFrame['pressed'][number]) => b.step({ held: [button], pressed: [button], touch: null });
    press('down');
    expect(b.view().prompt).toMatchObject({ kind: 'command', cursor: 3 });
    press('up');
    press('a');
    expect(b.view().prompt).toMatchObject({ kind: 'fight', cursor: 0 });
    press('b');
    expect(b.view().prompt).toMatchObject({ kind: 'command' });
    press('a');
    press('a');
    expect(b.view().prompt).toBeNull();
    expect(until(b).messages[0]).toMatch(/^Mosslet tries\n|^The wild Skylet tries\n/);
  });
});

describe('battle formulas (decomp)', () => {
  it('escape: faster always runs; slower rolls u8(speed·128/foe + attempts·30) against rand % 256, wrapping', () => {
    const r = (v: number) => () => v;
    expect(canEscape({ speed: 50, foeSpeed: 50, attempts: 0, smokeBall: false, runAway: false, rand16: r(255) })).toBe(true);
    // 40·128/100 = 51: escapes on rolls below 51.
    expect(canEscape({ speed: 40, foeSpeed: 100, attempts: 0, smokeBall: false, runAway: false, rand16: r(50) })).toBe(true);
    expect(canEscape({ speed: 40, foeSpeed: 100, attempts: 0, smokeBall: false, runAway: false, rand16: r(51) })).toBe(false);
    // 99·128/100 = 126, + 5·30 = 276 → u8 20: the fifth retry is worse than the first.
    expect(canEscape({ speed: 99, foeSpeed: 100, attempts: 5, smokeBall: false, runAway: false, rand16: r(0x100 + 20) })).toBe(false);
    expect(canEscape({ speed: 99, foeSpeed: 100, attempts: 5, smokeBall: false, runAway: false, rand16: r(19) })).toBe(true);
    expect(canEscape({ speed: 1, foeSpeed: 255, attempts: 0, smokeBall: true, runAway: false, rand16: r(255) })).toBe(true);
  });

  it('level-up friendship: +5/+3/+2 by tier, Luxury Ball +1, Soothe Bell ×1.5, capped', () => {
    expect(levelUpFriendship(70, false, false)).toBe(75);
    expect(levelUpFriendship(150, false, false)).toBe(153);
    expect(levelUpFriendship(220, true, false)).toBe(223);
    expect(levelUpFriendship(70, true, true)).toBe(79);
    expect(levelUpFriendship(254, false, false)).toBe(255);
  });

  it('gauges: pixel fill with at least one pixel, bar colours, and the DS drain speed', () => {
    expect(gaugeCells(20, 1, 6)).toEqual({ pixels: 2, fill: [2, 0, 0, 0, 0, 0] });
    expect(gaugeCells(200, 1, 6)).toEqual({ pixels: 1, fill: [1, 0, 0, 0, 0, 0] });
    expect(gaugeCells(20, 20, 6).fill).toEqual([8, 8, 8, 8, 8, 8]);
    expect([barColor(25), barColor(24), barColor(10), barColor(9)]).toEqual(['green', 'yellow', 'yellow', 'red']);
    // Move PP colours (GetPPTextColor): a quarter or less orange, a half or less yellow; small maxima by count.
    expect([35, 18, 17, 9, 8, 1, 0].map((pp) => ppColor(pp, 35))).toEqual(['normal', 'normal', 'yellow', 'yellow', 'orange', 'orange', 'red']);
    expect([5, 3, 2, 1, 0].map((pp) => ppColor(pp, 5))).toEqual(['normal', 'normal', 'yellow', 'orange', 'red']);
    expect([2, 1, 0].map((pp) => ppColor(pp, 2))).toEqual(['normal', 'orange', 'red']);
    // Small max (20 < 48 px): one pixel per frame in 8.8 fixed point.
    let s = { temp: 20 << 8, shown: 20 };
    let frames = 0;
    while (s.shown !== 10) {
      s = gaugeFrame(20, 20, 10, 48, s.temp);
      frames++;
    }
    expect(frames).toBe(25); // 20·256/48 = 106 per frame: 2560 / 106
    // Big max: the pixel distance in points per frame (100 of 200 = 24 px → 24 points a frame).
    expect(gaugeFrame(200, 200, 100, 48, 200)).toEqual({ temp: 176, shown: 176 });
  });

  it('pages: {clear} starts a page, {scroll} keeps the last line, slots are filled', () => {
    expect(pages('A {var 0}\nB{scroll}C{clear}D', ['x'])).toEqual(['A x\nB', 'B\nC', 'D']);
  });
});
