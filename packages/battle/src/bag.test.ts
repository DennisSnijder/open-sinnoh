/**
 * Bag and catching on the fixture pack's original creatures: the catch formula against values worked out by hand
 * from the decomp (BattleScript_CalcCatchShakes), catching (party, PC, broke free), the bag in battle
 * (medicine, a status cure, a battle item, an escape item), switching by choice, the replacement after a
 * faint, and the bag and party sheets' app requests.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type AppRequest, type Battle, type BattleDeps, type BattleSetup, type BattleView, type InputFrame } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { ballModifier, CAUGHT, catchShakes, type BallContext } from './catch.ts';
import { createBattle } from './index.ts';
import { gaugeFrame, gaugeTemp, HP_PIXELS } from './formulas.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const registries = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
const dex = dexOf(registries);
const f = (n: string) => `fixture:${n}` as Id;
const IDLE: InputFrame = { held: [], pressed: [], touch: null };

function mon(species: string, level: number, o: Partial<Pick<Pokemon, 'hp' | 'status'>> & { moves?: string[] } = {}): Pokemon {
  const m = createPokemon(dex, { species: f(species), level, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_CAPTURE_ORB'), ...(o.moves ? { moves: o.moves.map(f) } : {}) });
  if (o.hp !== undefined) m.hp = o.hp;
  if (o.status) m.status = o.status;
  return m;
}

const bag = (items: Record<string, number>) => {
  const b: Record<string, { item: Id; count: number }[]> = { items: [], medicine: [], balls: [], tmhms: [], berries: [], mail: [], battle_items: [], key_items: [] };
  for (const [name, count] of Object.entries(items)) b[registries.items.get(f(name))!.pocket]!.push({ item: f(name), count });
  return b;
};

function battle(party: Pokemon[], wild: { species: string; level: number }, seed: number, more: Partial<BattleDeps> = {}, log = new CountingStubLog(() => {})): Battle {
  const setup: BattleSetup = { kind: 'wild', trainers: [], wild: [{ species: f(wild.species), level: wild.level }], background: null, terrain: null, time: 'day' };
  return createBattle(setup, {
    registries,
    party,
    bag: bag({ ITEM_CAPTURE_ORB: 99, ITEM_TONIC: 2, ITEM_CALM_LEAF: 1, ITEM_SPARK_CHARM: 1, ITEM_SMOKE_PUFF: 1 }),
    pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
    met: { zone: f('MAP_TEST'), date: '2026-01-02' },
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
function until(b: Battle, max = 8000): { messages: string[]; view: BattleView } {
  const messages: string[] = [];
  // The message already up (the prompt's) is not new.
  let last = b.view().message?.text ?? '';
  for (let i = 0; i < max; i++) {
    b.step(IDLE);
    const v = b.view();
    if (v.message?.done && v.message.text !== last) messages.push((last = v.message.text));
    if (v.prompt || b.done()) return { messages, view: v };
  }
  throw new Error(`no prompt in ${max} ticks`);
}

const NONE: BallContext = { types: ['TYPE_NORMAL'], level: 5, terrain: null, time: 'day', caughtBefore: false, turns: 0 };

describe('catch formula (decomp BattleScript_CalcCatchShakes)', () => {
  const rolls = (...r: number[]) => {
    const list = [...r];
    return () => {
      const v = list.shift();
      if (v === undefined) throw new Error('no more rolls');
      return v;
    };
  };

  it('Poké Ball, full HP, no status: rate 45·10/10·20/60 = 15, threshold 0xFFFF0/√√(0xFF0000/15) = 1048560/32 = 32767', () => {
    const o = { catchRate: 45, ball: 'ITEM_POKE_BALL', ballMod: 10, maxHp: 20, hp: 20, status: 'none' as const };
    expect(catchShakes({ ...o, rand16: rolls(32766, 32766, 32766, 32766) })).toBe(CAUGHT);
    expect(catchShakes({ ...o, rand16: rolls(32766, 32766, 32766, 32767) })).toBe(3);
    expect(catchShakes({ ...o, rand16: rolls(0, 32767) })).toBe(1);
    expect(catchShakes({ ...o, rand16: rolls(32767) })).toBe(0);
  });

  it('Ultra Ball at 1 HP asleep: 90·58/60 = 87, ×2 = 174 → √√(96044) = 17 → 61680', () => {
    const o = { catchRate: 45, ball: 'ITEM_ULTRA_BALL', ballMod: 20, maxHp: 20, hp: 1, status: 'sleep' as const };
    expect(catchShakes({ ...o, rand16: rolls(61679, 61679, 61679, 61679) })).toBe(CAUGHT);
    expect(catchShakes({ ...o, rand16: rolls(61679, 61680) })).toBe(1);
  });

  it('paralysis, poison and burn ×1.5 (15 → 22: √√(759621) = 29 → 36157); freeze ×2 like sleep', () => {
    for (const status of ['paralysis', 'poison', 'toxic', 'burn'] as const) {
      const o = { catchRate: 45, ball: 'ITEM_POKE_BALL', ballMod: 10, maxHp: 20, hp: 20, status };
      expect(catchShakes({ ...o, rand16: rolls(36156, 36157) }), status).toBe(1);
    }
    // 15 × 2 = 30: 0xFF0000/30 = 557056 → 746 → 27 → 38835.
    const frozen = { catchRate: 45, ball: 'ITEM_POKE_BALL', ballMod: 10, maxHp: 20, hp: 20, status: 'freeze' as const };
    expect(catchShakes({ ...frozen, rand16: rolls(38834, 38835) })).toBe(1);
  });

  it('a rate of 255 or more catches without a roll; the Master Ball and always-catch battles too', () => {
    const none = () => {
      throw new Error('rolled');
    };
    expect(catchShakes({ catchRate: 255, ball: 'ITEM_ULTRA_BALL', ballMod: 20, maxHp: 20, hp: 1, status: 'none', rand16: none })).toBe(CAUGHT);
    expect(catchShakes({ catchRate: 3, ball: 'ITEM_MASTER_BALL', ballMod: 10, maxHp: 200, hp: 200, status: 'none', rand16: none })).toBe(CAUGHT);
    expect(catchShakes({ catchRate: 3, ball: 'ITEM_POKE_BALL', ballMod: 10, maxHp: 200, hp: 200, status: 'none', rand16: none, alwaysCatch: true })).toBe(CAUGHT);
  });

  it('ball modifiers ×10: the basic four, Net, Dive, Nest, Repeat, Timer, Dusk, Quick, others 10', () => {
    expect(['ITEM_ULTRA_BALL', 'ITEM_GREAT_BALL', 'ITEM_POKE_BALL', 'ITEM_SAFARI_BALL'].map((b) => ballModifier(b, NONE))).toEqual([20, 15, 10, 15]);
    expect(ballModifier('ITEM_NET_BALL', { ...NONE, types: ['TYPE_WATER', 'TYPE_ROCK'] })).toBe(30);
    expect(ballModifier('ITEM_NET_BALL', { ...NONE, types: ['TYPE_ROCK', 'TYPE_BUG'] })).toBe(30);
    expect(ballModifier('ITEM_NET_BALL', NONE)).toBe(10);
    expect(ballModifier('ITEM_DIVE_BALL', { ...NONE, terrain: 'TERRAIN_WATER' })).toBe(35);
    expect(ballModifier('ITEM_DIVE_BALL', NONE)).toBe(10);
    expect([5, 30, 35, 39, 40].map((level) => ballModifier('ITEM_NEST_BALL', { ...NONE, level }))).toEqual([35, 10, 10, 10, 10]);
    expect(ballModifier('ITEM_REPEAT_BALL', { ...NONE, caughtBefore: true })).toBe(30);
    expect([0, 5, 29, 30, 40].map((turns) => ballModifier('ITEM_TIMER_BALL', { ...NONE, turns }))).toEqual([10, 15, 39, 40, 40]);
    expect(ballModifier('ITEM_DUSK_BALL', { ...NONE, time: 'night' })).toBe(35);
    expect(ballModifier('ITEM_DUSK_BALL', { ...NONE, terrain: 'TERRAIN_CAVE' })).toBe(35);
    expect(ballModifier('ITEM_DUSK_BALL', { ...NONE, time: 'twilight' })).toBe(10);
    expect([0, 1].map((turns) => ballModifier('ITEM_QUICK_BALL', { ...NONE, turns }))).toEqual([40, 10]);
    expect(['ITEM_LUXURY_BALL', 'ITEM_PREMIER_BALL', 'ITEM_HEAL_BALL', 'ITEM_CAPTURE_ORB'].map((b) => ballModifier(b, NONE))).toEqual([10, 10, 10, 10]);
  });
});

describe('catching (fixture pack)', () => {
  /** Throws orbs until the battle ends; the messages, throw count and result. */
  function throwUntilDone(b: Battle) {
    const messages: string[] = [];
    const entries: AppRequest[] = [];
    let throws = 0;
    for (let i = 0; i < 99 && !b.done(); i++) {
      const r = until(b);
      messages.push(...r.messages);
      if (b.done()) break;
      if (b.view().prompt?.kind === 'nickname') {
        b.choose({ kind: 'nickname', give: false });
        continue;
      }
      if (b.view().prompt?.kind === 'pokedex') {
        entries.push(b.app()!);
        b.appDone({ app: 'pokedex-entry' });
        continue;
      }
      b.choose({ kind: 'item', item: f('ITEM_CAPTURE_ORB') });
      throws++;
    }
    return { messages, throws, result: b.done(), entries };
  }

  it('a thrown ball catches the wild Pokémon: Gotcha, the Pokédex line, the party, the ball and met data', () => {
    const log = new CountingStubLog(() => {});
    const b = battle([mon('SPECIES_MOSSLET', 30)], { species: 'SPECIES_SKYLET', level: 3 }, 1, {}, log);
    const { messages, throws, result, entries } = throwUntilDone(b);
    expect(result).toMatchObject({ outcome: 'caught', caught: { box: null } });
    // After "data was added": the Pokédex entry of the new species (decomp SEQ_CATCH_MON_SET_POKEDEX_DATA).
    expect(entries).toEqual([{ app: 'pokedex-entry', species: f('SPECIES_SKYLET'), form: 0 }]);
    expect(messages).toContain('Ash tossed\na Capture Orb!');
    expect(messages).toContain('Got it!\nSkylet is yours!');
    expect(messages).toContain('Skylet was noted\nin the log.');
    const caught = result!.party[1]!;
    expect(result!.party).toHaveLength(2);
    expect(result!.caught!.mon).toBe(caught);
    expect(caught).toMatchObject({ species: f('SPECIES_SKYLET'), level: 3, ball: f('ITEM_CAPTURE_ORB'), otName: 'Ash', met: { zone: f('MAP_TEST'), level: 3, date: '2026-01-02' } });
    expect(result!.bag.balls).toEqual([{ item: f('ITEM_CAPTURE_ORB'), count: 99 - throws }]);
    expect(messages).toContain('Name the new\nSkylet?');
    expect(log.report().map((s) => s.key)).not.toContain('battle:pokedex-entry');
  });

  it('YES to the nickname question opens the naming screen; its name is the caught Pokémon\'s', () => {
    const b = battle([mon('SPECIES_MOSSLET', 30)], { species: 'SPECIES_SKYLET', level: 3 }, 1);
    for (let i = 0; i < 99 && b.view().prompt?.kind !== 'nickname'; i++) {
      until(b);
      if (b.view().prompt?.kind === 'command') b.choose({ kind: 'item', item: f('ITEM_CAPTURE_ORB') });
      if (b.view().prompt?.kind === 'pokedex') b.appDone({ app: 'pokedex-entry' });
    }
    b.choose({ kind: 'nickname', give: true });
    until(b);
    expect(b.view().prompt).toEqual({ kind: 'naming' });
    expect(b.app()).toMatchObject({ app: 'naming', kind: 'pokemon', initial: 'Skylet', maxLength: 10, pokemon: { species: f('SPECIES_SKYLET') } });
    b.appDone({ app: 'naming', name: 'Breezy' });
    for (let i = 0; i < 99 && !b.done(); i++) until(b);
    expect(b.done()!.caught!.mon.nickname).toBe('Breezy');
  });

  it('broke free: one of the four messages by the shakes, then the wild Pokémon acts', () => {
    let seen = false;
    for (let seed = 1; seed < 30 && !seen; seed++) {
      const b = battle([mon('SPECIES_MOSSLET', 30)], { species: 'SPECIES_SKYLET', level: 3 }, seed);
      until(b);
      b.choose({ kind: 'item', item: f('ITEM_CAPTURE_ORB') });
      const { messages } = until(b);
      if (b.done()) continue;
      seen = true;
      expect(['Oh no!\nIt slipped out!', 'So close!\nIt slipped out!', 'Argh!\nNearly had it!', 'Drat!\nThat was close!']).toContain(messages[1]);
      expect(messages[2]).toMatch(/^The wild Skylet tries\n/);
    }
    expect(seen).toBe(true);
  });

  it('a full party sends the catch to the PC box with room (message by the current box), a known species skips the Pokédex line', () => {
    const party = Array.from({ length: 6 }, () => mon('SPECIES_MOSSLET', 30));
    const b = battle(party, { species: 'SPECIES_SKYLET', level: 3 }, 1, { caught: [f('SPECIES_SKYLET')], pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 1, name: 'CRATE 2' }, metBebe: false } });
    const { messages, result } = throwUntilDone(b);
    expect(result).toMatchObject({ outcome: 'caught', caught: { box: 1 } });
    expect(result!.party).toHaveLength(6);
    expect(messages).toContain('CRATE 1 is full.');
    expect(messages).toContain('Skylet went to\nCRATE 2 instead.');
    expect(messages.join('|')).not.toContain('noted');
  });

  it('refuses a ball when the party and the PC are full, and items not in the bag', () => {
    const party = Array.from({ length: 6 }, () => mon('SPECIES_MOSSLET', 30));
    const b = battle(party, { species: 'SPECIES_SKYLET', level: 3 }, 1, { pc: { current: { box: 0, name: 'CRATE 1' }, free: null, metBebe: false } });
    until(b);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_CAPTURE_ORB') })).toThrow(/no room left in the PC/);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_BONUS_ORB') })).toThrow(/no Bonus Orb in the bag/);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_LAMP_OIL') })).toThrow(/no Lamp Oil in the bag/);
  });
});

describe('the bag in battle (fixture pack)', () => {
  it('a one-move PP item (Focus Drops, like an Ether) needs the move; 10 PP back for that move only', () => {
    const lead = mon('SPECIES_MOSSLET', 30);
    lead.pp = [3, 0, 5, 5];
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 2, { bag: { medicine: [{ item: f('ITEM_FOCUS_DROPS'), count: 1 }] } });
    until(b);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_FOCUS_DROPS'), target: 0 })).toThrow(/which move/);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_FOCUS_DROPS'), target: 0, move: 4 })).toThrow(/which move/);
    b.choose({ kind: 'item', item: f('ITEM_FOCUS_DROPS'), target: 0, move: 1 });
    const { messages } = until(b);
    expect(messages[0]).toBe('Its moves are refreshed.');
    b.choose({ kind: 'run' });
    until(b);
    const r = b.done()!;
    expect(r.party[0]!.pp).toEqual([3, 10, 5, 5]);
    expect(r.bag.medicine).toEqual([]);
  });

  it('a Tonic on the hurt lead: 20 HP back (gauge and message), the bag loses one, the foe acts', () => {
    const lead = mon('SPECIES_MOSSLET', 30);
    lead.hp = 10;
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 2);
    until(b);
    b.choose({ kind: 'item', item: f('ITEM_TONIC'), target: 0 });
    const { messages, view } = until(b);
    expect(messages[0]).toBe('Mosslet got back\n20 HP.');
    expect(messages[1]).toMatch(/^The wild Skylet tries\n/);
    expect(view.battlers[0]!.hp).toBeGreaterThan(10);
    b.choose({ kind: 'run' });
    until(b);
    const r = b.done()!;
    expect(r.bag.medicine).toContainEqual({ item: f('ITEM_TONIC'), count: 1 });
  });

  it('moves the HP gauge one UpdateGauge frame a tick (Task_UpdateHPGauge is a main-loop SysTask)', () => {
    const lead = mon('SPECIES_MOSSLET', 30);
    lead.hp = 10;
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 2);
    until(b);
    const max = b.view().battlers[0]!.maxHp;
    b.choose({ kind: 'item', item: f('ITEM_TONIC'), target: 0 });
    const shown: number[] = [];
    for (let i = 0; i < 2000 && shown.at(-1) !== 30; i++) {
      b.step(IDLE);
      const hp = b.view().battlers[0]!.hp;
      if (hp !== 10) shown.push(hp);
    }
    // The DS sequence, frame by frame from 10 to 30; at two frames a tick every other value would be missing.
    const expected: number[] = [];
    for (let s = { temp: gaugeTemp(max, 10, HP_PIXELS), shown: 10 }; s.shown !== 30 || s.temp !== gaugeTemp(max, 30, HP_PIXELS); ) {
      s = gaugeFrame(max, 10, 30, HP_PIXELS, s.temp);
      expected.push(s.shown);
    }
    expect(expected.length).toBeGreaterThan(1);
    expect(shown.slice(0, expected.length)).toEqual(expected);
  });

  it('refuses medicine that would do nothing, and needs a target', () => {
    const b = battle([mon('SPECIES_MOSSLET', 30)], { species: 'SPECIES_SKYLET', level: 3 }, 2);
    until(b);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_TONIC'), target: 0 })).toThrow(/won't have any effect/);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_TONIC') })).toThrow(/needs a party Pokémon/);
    expect(() => b.choose({ kind: 'item', item: f('ITEM_CALM_LEAF'), target: 0 })).toThrow(/won't have any effect/);
  });

  it('a Calm Leaf cures the poisoned lead (healthbox status cleared)', () => {
    const b = battle([mon('SPECIES_MOSSLET', 30, { status: 'poison' })], { species: 'SPECIES_SKYLET', level: 3 }, 2);
    until(b);
    expect(b.view().battlers[0]!.status).toBe('poison');
    b.choose({ kind: 'item', item: f('ITEM_CALM_LEAF'), target: 0 });
    const { messages, view } = until(b);
    expect(messages[0]).toBe('Mosslet is free\nof poison.');
    expect(view.battlers[0]!.status).toBe('none');
  });

  it('a battle item raises a stage once per use (+1, Gen 4) and friendship; Smoke Puff flees a wild battle', () => {
    const lead = mon('SPECIES_MOSSLET', 30);
    const friendship = lead.friendship;
    const b = battle([lead], { species: 'SPECIES_SKYLET', level: 3 }, 2);
    until(b);
    b.choose({ kind: 'item', item: f('ITEM_SPARK_CHARM') });
    const { messages } = until(b);
    expect(messages.slice(0, 2)).toEqual(['The Spark Charm is used!', 'Mosslet: Power\nwent up!']);
    b.choose({ kind: 'item', item: f('ITEM_SMOKE_PUFF') });
    const end = until(b);
    expect(end.messages.slice(0, 2)).toEqual(['The Smoke Puff is used!', 'You slipped away!']);
    expect(b.done()).toMatchObject({ outcome: 'fled' });
    expect(b.done()!.party[0]!.friendship).toBe(Math.min(255, friendship + (friendship < 100 ? 1 : friendship < 200 ? 1 : 0)));
  });
});

describe('switching (fixture pack)', () => {
  it('a voluntary switch takes the turn: come back, the send-out line by the foe\'s HP, the foe acts', () => {
    const b = battle([mon('SPECIES_MOSSLET', 30), mon('SPECIES_EMBERKIT', 30)], { species: 'SPECIES_SKYLET', level: 3 }, 3);
    until(b);
    expect(() => b.choose({ kind: 'switch', slot: 0 })).toThrow(/already in battle/);
    b.choose({ kind: 'switch', slot: 1 });
    const { messages, view } = until(b);
    expect(messages[0]).toBe('Mosslet, swap out!\nBack you come!');
    expect(messages[1]).toBe('Your turn, Emberkit!');
    expect(messages[2]).toMatch(/^The wild Skylet tries\n/);
    expect(view.battlers[0]!.name).toBe('Emberkit');
    expect(view.prompt).toMatchObject({ kind: 'command' });
  });

  it('after a faint: "Use next Pokémon?", a fainted or active Pokémon is refused, the pick goes in', () => {
    const party = [mon('SPECIES_MOSSLET', 2, { moves: ['MOVE_STARE'] }), mon('SPECIES_EMBERKIT', 5, { hp: 0 }), mon('SPECIES_DRIPLING', 40)];
    const b = battle(party, { species: 'SPECIES_SKYLET', level: 30 }, 4);
    let view: BattleView | null = null;
    for (let turn = 0; turn < 30; turn++) {
      view = until(b).view;
      if (view.prompt?.kind !== 'command') break;
      b.choose({ kind: 'move', slot: 0 });
    }
    expect(view?.prompt).toMatchObject({ kind: 'next' });
    expect(() => b.choose({ kind: 'switch', slot: 1 })).toThrow(/no energy left/);
    expect(() => b.choose({ kind: 'switch', slot: 0 })).toThrow(/already in battle|no energy left/);
    b.choose({ kind: 'party' });
    b.step(IDLE);
    expect(b.view().prompt).toEqual({ kind: 'party', forced: true });
    const req = b.app();
    expect(req).toMatchObject({ app: 'party-select', forced: true, active: 0 });
    expect(() => b.appDone({ app: 'party-select', slot: null })).toThrow(/cannot be cancelled/);
    b.appDone({ app: 'party-select', slot: 2 });
    const { messages, view: after } = until(b);
    expect(messages[0]).toMatch(/Dripling!$/);
    expect(after.battlers[0]!.name).toBe('Dripling');
  });

  it('the last standing Pokémon fainting ends the battle when another entered it fainted (no command for the fainted)', () => {
    const party = [mon('SPECIES_MOSSLET', 2, { moves: ['MOVE_STARE'] }), mon('SPECIES_EMBERKIT', 5, { hp: 0 })];
    const b = battle(party, { species: 'SPECIES_SKYLET', level: 30 }, 4);
    for (let turn = 0; turn < 30 && until(b).view.prompt?.kind === 'command'; turn++) {
      expect(b.view().battlers[0]!.hp).toBeGreaterThan(0);
      b.choose({ kind: 'move', slot: 0 });
    }
    expect(b.view().prompt?.kind).not.toBe('next');
    expect(b.done()).toMatchObject({ outcome: 'lost' });
  });

  it('a sheet answered directly (replays) is closed: no app request while its answer waits for the step', () => {
    const party = [mon('SPECIES_MOSSLET', 2, { moves: ['MOVE_STARE'] }), mon('SPECIES_DRIPLING', 40)];
    const b = battle(party, { species: 'SPECIES_SKYLET', level: 30 }, 4);
    for (let turn = 0; turn < 30 && until(b).view.prompt?.kind === 'command'; turn++) b.choose({ kind: 'move', slot: 0 });
    expect(b.view().prompt).toMatchObject({ kind: 'next' });
    b.choose({ kind: 'party' });
    b.step(IDLE);
    expect(b.app()).toMatchObject({ app: 'party-select', forced: true });
    // The game hosts the sheet while `app()` asks for it, and steps the battle only once it is closed.
    b.choose({ kind: 'switch', slot: 1 });
    expect(b.app()).toBeNull();
    expect(until(b).view.battlers[0]!.name).toBe('Dripling');
  });

  it('the command card opens the bag and party sheets as app requests; cancelling returns to the commands', () => {
    const b = battle([mon('SPECIES_MOSSLET', 30, { hp: 5 }), mon('SPECIES_EMBERKIT', 30)], { species: 'SPECIES_SKYLET', level: 3 }, 3);
    until(b);
    b.choose({ kind: 'bag' });
    b.step(IDLE);
    expect(b.view().prompt).toEqual({ kind: 'bag' });
    expect(b.app()).toMatchObject({ app: 'bag-select', active: 0, noRoomForBall: false, noEffect: [], party: [{ hp: 5 }, {}] });
    b.appDone({ app: 'bag-select', item: null, target: null });
    expect(until(b).view.prompt).toMatchObject({ kind: 'command' });
    b.choose({ kind: 'party' });
    b.step(IDLE);
    expect(b.app()).toMatchObject({ app: 'party-select', forced: false });
    b.appDone({ app: 'party-select', slot: null });
    expect(until(b).view.prompt).toMatchObject({ kind: 'command' });
    b.choose({ kind: 'bag' });
    b.step(IDLE);
    b.appDone({ app: 'bag-select', item: f('ITEM_TONIC'), target: 0 });
    expect(until(b).messages[0]).toBe('Mosslet got back\n20 HP.');
  });
});
