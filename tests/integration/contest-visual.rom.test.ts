/**
 * The visual round on the ROM (docs/research/contests.md §5): the imported accessory pictures, Pokémon masks and NPC
 * outfits; the round's model driven tick by tick (the intro's pages, the Fashion Case, the limit, the stage and the
 * Pokémon, the backdrops, DONE and the clock, the photo and its points, the judging's draws); the lobby's photo viewer
 * as a replay.
 */
import { describe, expect, it } from 'vitest';
import type { ContestRound, ContestSession, ContestVisualRoundView, InputFrame, NewGame } from '@opensinnoh/contracts';
import { setupPokemon } from '@opensinnoh/contracts';
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp, createContestRound } from '@opensinnoh/menus';
import { accessoryHit, accessoryOpaque, contestRandom, dressUpPoints, newContest, npcOutfit } from '@opensinnoh/services';
import type { Id } from '@opensinnoh/core';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

const ROM = process.env.OPENSINNOH_NDS_ROM;
const game = () => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });
const frame = (o: Partial<InputFrame> = {}): InputFrame => ({ held: [], pressed: [], touch: null, ...o });

/** A visual round over a fresh contest of `rank` with Staravia and the given Fashion Case. */
function setup(rank: number, accessories: Record<number, number>, backdrops: number[] = [], seed = 7) {
  const g = game();
  g.state.party.push(setupPokemon(g.state, g.registries, 0, 'platinum:SPECIES_STARAVIA' as Id, 20, ['platinum:MOVE_WING_ATTACK' as Id, 'platinum:MOVE_QUICK_ATTACK' as Id]));
  for (const [a, n] of Object.entries(accessories)) g.state.fashionCase.accessories[Number(a)] = n;
  g.state.fashionCase.backdrops = backdrops;
  const session: ContestSession = newContest(g.state, g.registries, { mode: 'official', rank, type: 0, competition: 2, partySlot: 0, seed });
  let draws = 0;
  const round = createContestRound('visual', { session, registries: g.registries, state: g.state, host: {} as never, log: g.log, rng: () => (draws++, contestRandom(session)) });
  const tables = (g.registries.newGame.get('platinum:NEW_GAME' as Id) as NewGame).contests!;
  const view = () => round.view() as ContestVisualRoundView;
  const step = (f: InputFrame = frame()) => round.step(f);
  return { g, session, round, tables, view, step, draws: () => draws };
}

/** Steps until `done`, failing after `max` ticks. */
function until(r: { step: (f?: InputFrame) => unknown }, done: () => boolean, max: number, f: () => InputFrame = () => frame()): number {
  for (let n = 1; n <= max; n++) {
    r.step(f());
    if (done()) return n;
  }
  throw new Error(`not done after ${max} ticks`);
}

/** Through the intro's pages to the dress-up's first frame. */
function toDress(t: ReturnType<typeof setup>) {
  while (t.view().phase === 'intro') t.step(t.view().message ? frame({ pressed: ['a'] }) : frame());
  until(t, () => t.view().dress?.seconds === 59, 30);
}

/** A point of an item's picture that picks it (an opaque pixel). */
function grip(t: ReturnType<typeof setup>, item: { id: number; x: number; y: number; kind: string }): [number, number] {
  if (item.kind === 'backdrop') return [item.x + 16, item.y + 16];
  const pic = t.tables.accessories[item.id]!;
  for (let v = 0; v < pic.height; v++) for (let u = 0; u < pic.width; u++) if (accessoryOpaque(pic, u, v) && accessoryHit(pic, item.x, item.y, item.x + u, item.y + v)) return [item.x + u, item.y + v];
  throw new Error(`accessory ${item.id} has no opaque pixel`);
}
/** Drags from (x0, y0) to (x1, y1) with the stylus: down, a move, up. */
function drag(t: ReturnType<typeof setup>, [x0, y0]: [number, number], [x1, y1]: [number, number]) {
  t.step(frame({ tap: `dress:${x0},${y0}` }));
  t.step(frame({ tap: `dress:${x1},${y1}` }));
  t.step(frame({ tap: 'dress-up' }));
}
const caseItems = (t: ReturnType<typeof setup>) => t.view().dress!.items.filter((i) => i.x < 120 && !i.held);

describe.skipIf(!ROM)('the visual round (OPENSINNOH_NDS_ROM)', () => {
  it('imports the accessories\' pictures, the Pokémon masks and NPC outfits inside the photo', () => {
    const { pack } = romSlice();
    const c = (pack.registries.newGame as unknown as NewGame[])[0]!.contests!;
    expect(c.accessories).toHaveLength(100);
    expect(c.accessories[0]).toMatchObject({ width: 16, height: 16 });
    expect(c.accessories.every((a) => [16, 32, 64].includes(a.width) && [16, 32, 64].includes(a.height) && atob(a.mask).length === (a.width * a.height) / 8)).toBe(true);
    // Every NPC outfit lies in the photo's stage frame (72, 56)–(184, 185) give or take a picture's margin.
    for (const d of c.dressUps) for (const a of d.accessories) {
      expect(a.x).toBeGreaterThanOrEqual(72 - 20);
      expect(a.x).toBeLessThan(184);
      expect(a.y).toBeGreaterThanOrEqual(56 - 20);
      expect(a.y).toBeLessThan(185);
    }
    const sprites = pack.registries.pokemonSprites as { id: string; forms: { front: { opaque?: string }; frontFemale?: { opaque?: string } }[] }[];
    expect(sprites.every((s) => s.forms.every((f) => f.front.opaque && (!f.frontFemale || f.frontFemale.opaque)))).toBe(true);
  });

  it('runs the intro\'s pages, the stage and the 1800-frame clock, which ends the round at 0 (frame 1771)', () => {
    const t = setup(0, { 0: 2 });
    // The BGM's fade: 30 frames without a message.
    for (let n = 0; n < 29; n++) t.step();
    expect(t.view()).toMatchObject({ phase: 'intro', message: null, intro: { seconds: 60, limit: 5 } });
    t.step();
    const pages: string[] = [];
    while (t.view().phase === 'intro') {
      const m = t.view().message;
      if (m) pages.push(m.text);
      t.step(m ? frame({ pressed: ['a'] }) : frame());
    }
    expect(pages).toHaveLength(6);
    expect(pages[4]).toContain('5');
    expect(t.view().intro).toBeNull();
    const ticks = until(t, () => t.view().dress?.seconds === 59, 30);
    expect(ticks).toBeLessThanOrEqual(10);
    const n = until(t, () => t.view().dress?.seconds === 0, 2000);
    expect(n).toBe(1770);
    expect(t.view().dress!.hurry).toBe(true);
    until(t, () => t.view().phase === 'scoring', 200);
  });

  it('keeps the rank\'s limit: the sixth accessory at Normal rank goes back with the no-space line', () => {
    const t = setup(0, { 0: 9 });
    toDress(t);
    expect(caseItems(t)).toHaveLength(9);
    for (let k = 0; k < 5; k++) {
      const item = caseItems(t)[0]!;
      drag(t, grip(t, item), [150 + k * 18, 30]);
    }
    expect(t.view().dress!.placed).toBe(5);
    const item = caseItems(t)[0]!;
    drag(t, grip(t, item), [160, 120]);
    expect(t.view().dress!.status).toBe(t.g.registries.texts.get('platinum:pl_msg_00000385_00003' as Id)!.text);
    expect(t.view().dress!.placed).toBe(5);
    for (let k = 0; k < 6; k++) t.step();
    expect(caseItems(t)).toHaveLength(4);
    expect(caseItems(t).some((i) => i.x === item.x && i.y === item.y)).toBe(true);
  });

  it('drops in the case where let go, sends a stage accessory taken off back to the case, picks a backdrop', () => {
    const t = setup(1, { 0: 1, 30: 1 }, [4, 9]);
    toDress(t);
    const fluff = caseItems(t)[0]!;
    drag(t, grip(t, fluff), [60, 120]);
    for (let k = 0; k < 6; k++) t.step();
    const moved = caseItems(t).find((i) => i.id === 0)!;
    expect([moved.x, moved.y]).not.toEqual([fluff.x, fluff.y]);
    // Onto the stage, then off it to the buttons: back into the case (its page by id).
    drag(t, grip(t, moved), [200, 40]);
    expect(t.view().dress!.placed).toBe(1);
    const staged = t.view().dress!.items.find((i) => i.x > 120)!;
    drag(t, grip(t, staged), [100, 170]);
    expect(t.view().dress!.placed).toBe(0);
    for (let k = 0; k < 6; k++) t.step();
    expect(caseItems(t).filter((i) => i.id === 0)).toHaveLength(1);
    // NEXT turns to the next page that holds something (accessory 30's).
    t.step(frame({ tap: 'case-next' }));
    expect(t.view().dress!.page).toBe(5);
    // The backdrops: picking one shows it on the stage; it goes back to its place.
    t.step(frame({ tap: 'tab-backdrops' }));
    expect(t.view().dress!.tab).toBe('backdrops');
    const icon = caseItems(t).find((i) => i.kind === 'backdrop' && i.id === 9)!;
    expect([icon.x, icon.y]).toEqual([48, 24]);
    drag(t, grip(t, icon), [190, 60]);
    expect(t.view().dress!.backdrop).toBe(9);
    for (let k = 0; k < 6; k++) t.step();
    expect(caseItems(t).find((i) => i.id === 9)).toMatchObject({ x: 48, y: 24 });
  });

  it('photographs the accessories on the Pokémon (in the photo\'s place), scores them on the theme and judges with the contest RNG', () => {
    const t = setup(2, { 0: 3, 3: 1 });
    toDress(t);
    // The hand: Y to the first accessory, A, Y to Staravia's head, A; then one dropped far from it.
    t.step(frame({ pressed: ['y'], held: ['y'] }));
    t.step(frame({ pressed: ['a'], held: ['a'] }));
    t.step(frame({ pressed: ['y'], held: ['y'] }));
    const onHead = t.view().dress!.items.find((i) => i.held)!;
    t.step(frame({ pressed: ['a'], held: ['a'] }));
    const far = caseItems(t)[0]!;
    drag(t, grip(t, far), [226, 126]);
    expect(t.view().dress!.placed).toBe(2);
    const drawsBefore = t.draws();
    t.step(frame({ tap: 'done' }));
    until(t, () => t.view().phase === 'scoring', 200);
    expect(t.draws()).toBe(drawsBefore);
    let outcome: ReturnType<ContestRound['step']> = null;
    let ticks = 0;
    for (; ticks < 3000 && !outcome; ticks++) outcome = t.step(t.view().message ? frame({ pressed: ['a'] }) : frame());
    if (outcome?.kind !== 'visual') throw new Error('no visual outcome');
    // One draw a frame of the judging, and four or five a heart.
    expect(t.draws() - drawsBefore).toBeGreaterThanOrEqual(ticks);
    expect(outcome.outfit.accessories).toEqual([{ accessory: onHead.id, x: onHead.x - 64, y: onHead.y + 40, priority: -1 }]);
    expect(outcome.outfit.monPriority).toBe(-2);
    expect(outcome.dressUp[0]).toBe(dressUpPoints(t.tables, t.session.theme, outcome.outfit));
    for (const id of [1, 2, 3]) expect(outcome.dressUp[id]).toBe(dressUpPoints(t.tables, t.session.theme, npcOutfit(t.tables, t.session.entrants[id]!.opponent!, t.session.theme)));
  });

  poffinReplay('sys-contest-photo');
});
