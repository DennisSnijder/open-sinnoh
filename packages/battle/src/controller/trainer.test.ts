/**
 * Trainer battles, the first battle and the catching tutorial on the fixture pack (no ROM): the intro,
 * the trainer AI driving the foe, prize money and the loss penalty, exp boosts, the tutorial's capture.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, expGain, expShares, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type Battle, type BattleChoice, type BattleDeps, type BattleKind, type BattleSetup, type BattleView, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { PRNG } from '@pkmn/sim';
import { createBattle, moneyPenalty, prizeMoney, simData } from '../index.ts';

const root = join(import.meta.dirname, '../../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };

function mon(species: string, level: number, o: { moves?: string[]; item?: string; otId?: number } = {}): Pokemon {
  return createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: o.otId ?? 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), heldItem: o.item ? f(o.item) : null, ...(o.moves ? { moves: o.moves.map(f) } : {}) });
}

function battle(kind: BattleKind, party: Pokemon[], seed: number, extra: Partial<BattleSetup> = {}, money = 3000, bag: Record<string, { item: Id; count: number }[]> = {}, deps: Partial<BattleDeps> = {}): Battle {
  const setup: BattleSetup = { kind, trainers: [], wild: [], background: null, terrain: null, time: 'day', ...extra };
  return createBattle(setup, { registries, party, bag, pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false }, met: { zone: null, date: null }, player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' }, money, badges: 1, caught: [], seed, textSpeed: 4, log: new CountingStubLog(() => {}), ...deps });
}

/** Fights with `slot` until the end; every finished message and the views along the way. */
function play(b: Battle, slot = 0, max = 30000): { messages: string[]; views: BattleView[] } {
  const messages: string[] = [];
  const views: BattleView[] = [];
  let last = '';
  for (let i = 0; i < max && !b.done(); i++) {
    const v = b.view();
    if (v.prompt?.kind === 'command') b.choose({ kind: 'move', slot });
    else if (v.prompt?.kind === 'learn') b.choose({ kind: 'keep' });
    else if (v.prompt?.kind === 'learn-ask') b.choose({ kind: 'answer', yes: v.prompt.ask === 'give-up' });
    b.step(IDLE);
    const after = b.view();
    views.push(after);
    if (after.message?.done && after.message.text !== last) messages.push((last = after.message.text));
  }
  if (!b.done()) throw new Error('the battle did not end');
  return { messages, views };
}

describe('trainer battles (fixture pack)', () => {
  it('intro, AI foe, win: defeat line, prize money (last level · 4 · class), exp ×1.5', () => {
    const lead = mon('SPECIES_MOSSLET', 12);
    const exp0 = lead.exp;
    const b = battle('trainer', [lead], 3, { trainers: [f('TRAINER_CAMPER')] });
    const { messages } = play(b);
    expect(messages.slice(0, 3)).toEqual(['Scout Ash\nwants a match!', 'Scout Ash\ncalls on Skylet!', 'Your turn, Mosslet!']);
    expect(messages).toContain('Rival Skylet is out!'); // the fixture's foe wording
    const r = b.done()!;
    expect(r.outcome).toBe('won');
    const prize = 4 * 4 * 4; // Skylet L4 · 4 · class prize 4
    expect(r.money).toBe(3000 + prize);
    expect(messages).toContain(`Ash earned\n$${prize}!`);
    expect(messages).toContain('You won against\nScout Ash!');
    expect(messages.indexOf('You won against\nScout Ash!')).toBeLessThan(messages.indexOf('The fire went out.'));
    const gained = expGain(expShares(dex.species(f('SPECIES_SKYLET')).baseExp, 4, 1, 0).gained, { luckyEgg: false, trainerBattle: true, outsider: false });
    expect(r.party[0]!.exp).toBe(exp0 + gained);
    expect(gained).toBe(Math.floor((Math.floor((dex.species(f('SPECIES_SKYLET')).baseExp * 4) / 7) * 150) / 100));
  });

  it('a trainer battle refuses Run and gives the prompt back', () => {
    const b = battle('trainer', [mon('SPECIES_MOSSLET', 12)], 3, { trainers: [f('TRAINER_CAMPER')] });
    while (!b.view().prompt) b.step(IDLE);
    b.choose({ kind: 'run' });
    b.step(IDLE);
    const texts = new Set<string>();
    while (!b.view().prompt) {
      b.step(IDLE);
      if (b.view().message?.done) texts.add(b.view().message!.text);
    }
    expect([...texts]).toEqual(['You cannot slip away\nfrom a match!', 'What should Mosslet try?']);
    expect(b.view().prompt?.kind).toBe('command');
  });

  it('a ball in a trainer battle is blocked ("Don’t be a thief!"), stays in the bag, and the turn passes', () => {
    const balls = { balls: [{ item: f('ITEM_CAPTURE_ORB'), count: 3 }] };
    const b = battle('trainer', [mon('SPECIES_MOSSLET', 12)], 3, { trainers: [f('TRAINER_CAMPER')] }, 3000, balls);
    while (!b.view().prompt) b.step(IDLE);
    b.choose({ kind: 'item', item: f('ITEM_CAPTURE_ORB') });
    b.step(IDLE);
    const texts: string[] = [];
    while (!b.view().prompt) {
      b.step(IDLE);
      const m = b.view().message;
      if (m?.done && texts[texts.length - 1] !== m.text) texts.push(m.text);
    }
    expect(texts.slice(0, 3)).toEqual(['Ash tossed\na Capture Orb!', 'The opponent swatted\nthe orb away!', 'Hands off my companion!']);
    expect(texts[3]).toMatch(/^Rival Skylet tries\n/);
    play(b);
    expect(b.done()!.bag).toEqual(balls);
  });

  it('the rival is named after the player’s rival; the first battle has no Run', () => {
    const b = battle('first', [mon('SPECIES_DRIPLING', 5)], 2, { trainers: [f('TRAINER_RIVAL_FIRST')] });
    const intro = new Set<string>();
    while (!b.view().prompt) {
      b.step(IDLE);
      if (b.view().message?.done) intro.add(b.view().message!.text);
    }
    expect([...intro].slice(0, 2)).toEqual(['Rival Bo\nwants a match!', 'Rival Bo\ncalls on Emberkit!']);
    expect(b.view().prompt).toMatchObject({ kind: 'command', enabled: [true, false, false, false] });
    expect(() => b.choose({ kind: 'run' })).toThrow(/not available/);
    expect(play(b).messages).toContain('You won against\nRival Bo!');
  });

  it('the first battle and the tutorial have no critical hits (decomp BtlCmd_CalcCrit)', () => {
    // A sim whose every random roll is 0: each crit check passes unless the battle's format rules it out.
    const crits = (kind: BattleKind) => {
      const prng = new PRNG('sodium,00000000000000000000000000000000');
      (prng as unknown as { rng: { next: () => number; getSeed: () => string } }).rng = { next: () => 0, getSeed: () => 'zero' };
      const sim = simData(registries, new CountingStubLog(() => {})).createBattle(kind, 'singles', { prng });
      const set = { species: 'Bidoof', moves: ['tackle'], ability: 'Simple', level: 50, evs: {}, ivs: {} };
      sim.setPlayer('p1', { name: 'a', team: [{ ...set, name: 'A' }] } as never);
      sim.setPlayer('p2', { name: 'b', team: [{ ...set, name: 'B' }] } as never);
      sim.choose('p1', 'move 1');
      sim.choose('p2', 'move 1');
      return sim.log.filter((l) => l.startsWith('|-crit|')).length;
    };
    expect(crits('trainer')).toBe(2);
    expect(crits('wild')).toBe(2);
    expect(crits('first')).toBe(0);
    expect(crits('tutorial')).toBe(0);
  });

  it('a loss pays the penalty (max level · 4 · badge multiplier) and blacks out', () => {
    // Stare only: the player cannot win.
    const b = battle('trainer', [mon('SPECIES_MOSSLET', 2, { moves: ['MOVE_STARE'] })], 1, { trainers: [f('TRAINER_HIKER')] }, 1000);
    const { messages } = play(b);
    const r = b.done()!;
    expect(r.outcome).toBe('lost');
    const penalty = 2 * 4 * 4; // level 2 · 4 · 4 (one badge)
    expect(r.money).toBe(1000 - penalty);
    expect(messages.slice(-4)).toEqual(['Ash has no one\nleft to battle!', `Ash handed over\n$${penalty}.`, '...', 'Ash ran out of companions!']);
  });

  it('the trainer AI uses its items (m2-trainer-items): the rival drinks its Tonic when low', () => {
    let used = 0;
    for (let seed = 1; seed <= 30 && !used; seed++) {
      const b = battle('trainer', [mon('SPECIES_DRIPLING', 9)], seed, { trainers: [f('TRAINER_RIVAL_FIRST')] });
      const { messages } = play(b);
      const i = messages.indexOf('Rival Bo\nreached for a Tonic!');
      if (i >= 0) used++;
    }
    expect(used).toBe(1);
  });

  it('Exp. Share and Lucky Egg (decomp BtlCmd_CalcExpGain and the get-exp task)', () => {
    const lead = mon('SPECIES_MOSSLET', 12, { item: 'ITEM_LUCKY_CHARM' });
    const bench = mon('SPECIES_DRIPLING', 5, { item: 'ITEM_SHARE_CHARM', otId: 99 });
    const [l0, b0] = [lead.exp, bench.exp];
    const b = battle('trainer', [lead, bench], 3, { trainers: [f('TRAINER_CAMPER')] });
    play(b);
    const [l1, b1] = b.done()!.party;
    const base = Math.floor((dex.species(f('SPECIES_SKYLET')).baseExp * 4) / 7);
    const half = Math.floor(base / 2);
    // The lead fought: half, ×1.5 Lucky Egg, ×1.5 trainer. The bench holds the Exp. Share: half, ×1.5 trainer, ×1.5 traded.
    expect(l1!.exp - l0).toBe(Math.floor((Math.floor((half * 150) / 100) * 150) / 100));
    expect(b1!.exp - b0).toBe(Math.floor((Math.floor((half * 150) / 100) * 150) / 100));
  });
});

describe('the catching tutorial (fixture pack)', () => {
  it('the counterpart fights once, then throws a ball that always catches; the player’s party is untouched', () => {
    const own = mon('SPECIES_DRIPLING', 5);
    const b = battle('tutorial', [own], 4, { wild: [{ species: f('SPECIES_SKYLET'), level: 2 }], counterpart: { name: 'Dee', gender: 'female', species: f('SPECIES_EMBERKIT') } });
    const { messages, views } = play(b);
    expect(views.some((v) => v.prompt)).toBe(false);
    expect(messages).toContain('Your turn, Emberkit!');
    expect(messages).toContain('Emberkit tries\nBop!');
    expect(messages.slice(-3)).toEqual(['It is tired now.\nOrb time!', 'Dee tossed\na Capture Orb!', 'Got it!\nSkylet is yours!']);
    // The real capture sequence: the ball flies, opens, three shakes (tilted), the caught stars, then it fades out.
    const balls = views.map((v) => v.ball).filter((x) => x !== null);
    expect(balls.some((x) => x.anim === 1)).toBe(true);
    expect(new Set(balls.filter((x) => x.tilt !== 0).map((x) => Math.sign(x.tilt)))).toEqual(new Set([-1, 1]));
    expect(balls.some((x) => x.stars !== null)).toBe(true);
    expect(balls.at(-1)!.alpha).toBe(0);
    const r = b.done()!;
    expect(r.outcome).toBe('caught');
    expect(r.party).toEqual([own]);
    expect(r.money).toBe(3000);
  });
});

describe('money formulas (decomp)', () => {
  it('prize: the last party member’s level (u8) · 4 · Amulet Coin · class', () => {
    expect(prizeMoney([12, 12, 14], 50, 1)).toBe(14 * 4 * 50);
    expect(prizeMoney([5], 4, 2)).toBe(160);
  });
  it('penalty: highest level · 4 · {2,4,6,9,12,16,20,25,30}[badges], at most the money', () => {
    expect(moneyPenalty([5, 9], 0, 3000)).toBe(9 * 4 * 2);
    expect(moneyPenalty([30], 8, 99999)).toBe(30 * 4 * 30);
    expect(moneyPenalty([30], 3, 100)).toBe(100);
  });
});

describe('in-battle trainer lines and the shift question (fixture pack)', () => {
  /** Fights with move 0 until the end; `shift` answers "Will you switch?"; the messages and the prompts. */
  function fight(b: Battle, shift: BattleChoice = { kind: 'keep' }, max = 40000) {
    const messages: string[] = [];
    const prompts: string[] = [];
    let last = '';
    for (let i = 0; i < max && !b.done(); i++) {
      const p = b.view().prompt;
      if (p && prompts[prompts.length - 1] !== p.kind) prompts.push(p.kind);
      if (p?.kind === 'command') b.choose({ kind: 'move', slot: 0 });
      else if (p?.kind === 'learn') b.choose({ kind: 'keep' });
      else if (p?.kind === 'learn-ask') b.choose({ kind: 'answer', yes: p.ask === 'give-up' });
      else if (p?.kind === 'shift') b.choose(shift);
      b.step(IDLE);
      const m = b.view().message;
      if (m?.done && m.text !== last) messages.push((last = m.text));
    }
    if (!b.done()) throw new Error('the battle did not end');
    return { messages, prompts };
  }

  const ace = (party: Pokemon[], deps: Partial<BattleDeps> = {}) => battle('trainer', party, 3, { trainers: [f('TRAINER_ACE')] }, 3000, {}, deps);
  const team = () => [mon('SPECIES_MOSSLET', 8), mon('SPECIES_DRIPLING', 8)];

  it('decomp BattleSystem_CheckTrainerMessage: first damage, the last Pokémon, half HP, each once, before the commands', () => {
    const { messages } = fight(ace(team()));
    const at = (m: string) => messages.indexOf(m);
    // The first damage (timesDamaged 1) is said at the next turn's start, before its command.
    expect(at('A scratch! Only a scratch.')).toBe(at('Mosslet: Guard\nwent down!') + 1);
    expect(messages[at('A scratch! Only a scratch.') + 1]).toBe('What should Mosslet try?');
    // The last Pokémon right after it came out, half HP once it is down to half.
    expect(messages[at('Scout Vale\ncalls on Burrowbit!') + 1]).toBe('My last one. Make it count!');
    expect(at('Hold steady out there!')).toBeGreaterThan(at('My last one. Make it count!'));
    for (const line of ['A scratch! Only a scratch.', 'My last one. Make it count!', 'Hold steady out there!']) expect(messages.filter((m) => m === line)).toHaveLength(1);
  });

  it('SHIFT style: "will you switch?" before the next one comes; NO keeps the Pokémon in', () => {
    const { messages, prompts } = fight(ace(team()), { kind: 'keep' });
    expect(prompts.filter((p) => p === 'shift')).toHaveLength(1);
    const ask = messages.indexOf('Scout Vale calls\nBurrowbit next.');
    expect(messages.slice(ask, ask + 3)).toEqual(['Scout Vale calls\nBurrowbit next.', 'Swap companions, Ash?', 'Scout Vale\ncalls on Burrowbit!']);
    expect(messages).not.toContain('What should Dripling try?');
  });

  it('the horizontal switch question accepts Left/Right and A, as well as Up/Down and B', () => {
    const b = ace(team());
    for (let i = 0; i < 40000 && b.view().prompt?.kind !== 'shift'; i++) {
      if (b.view().prompt?.kind === 'command') b.choose({ kind: 'move', slot: 0 });
      b.step(IDLE);
    }
    expect(b.view().prompt).toMatchObject({ kind: 'shift', cursor: 0 });
    const press = (button: InputFrame['pressed'][number]) => b.step({ held: [button], pressed: [button], touch: null });
    press('right');
    expect(b.view().prompt).toMatchObject({ kind: 'shift', cursor: 1 });
    press('left');
    expect(b.view().prompt).toMatchObject({ kind: 'shift', cursor: 0 });
    press('down');
    expect(b.view().prompt).toMatchObject({ kind: 'shift', cursor: 1 });
    press('up');
    expect(b.view().prompt).toMatchObject({ kind: 'shift', cursor: 0 });
    press('right');
    press('a');
    expect(b.view().prompt).toBeNull();
    fight(b);
    expect(b.done()?.outcome).toBe('won');
  });

  it('YES and a Pokémon: it goes in first, then the foe sends out, and no turn passes', () => {
    const { messages } = fight(ace(team()), { kind: 'switch', slot: 1 });
    const ask = messages.indexOf('Swap companions, Ash?');
    expect(messages.slice(ask + 1, ask + 5)).toEqual(['Mosslet, that will do!\nBack you come!', 'Your turn, Dripling!', 'Scout Vale\ncalls on Burrowbit!', 'My last one. Make it count!']);
    expect(messages[ask + 5]).toBe('What should Dripling try?');
  });

  it('no question in SET style, nor with no other Pokémon that can fight', () => {
    expect(fight(ace(team(), { options: { scene: true, style: 'set' } })).prompts).not.toContain('shift');
    expect(fight(ace([mon('SPECIES_MOSSLET', 8)])).prompts).not.toContain('shift');
  });
});
