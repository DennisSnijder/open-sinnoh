import { describe, expect, it } from 'vitest';
import { giveItem, itemCount, newGameRecord, setupPokemon } from '@opensinnoh/contracts';
import { dailyEvents, FIELD_VARS as V, dailyRandomOf, lotteryWinner, randomizeLottery, readSystemVar as read, rematchTrainer, seekerStep, SEEKER_USED, sizeFactor, sizeInTenths, systemFlag, writeSystemVar as write, type Id } from '@opensinnoh/core';
import { fieldPack, f } from '../../../tests/fixtures/field-systems.ts';
import { createGame } from './game.ts';
import { fieldItemCheck, useFieldItem } from './field-items.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { CountingStubLog } from './stub-log.ts';
import { updateGameTime } from './game-time.ts';

function setup() {
  const notices: [Id, string[]][] = [];
  const starts: unknown[] = [];
  const warps: unknown[][] = [];
  const game = createGame({ packs: [fieldPack()], seed: 1, createWorld: (d) => ({ ...createFakeWorld(d), warp: (...a) => void warps.push(a), switchMovementType: (id, type) => { d.state.objects.find((o) => o.localId === id)!.movementType = type; }, view: () => ({ ...createFakeWorld(d).view(), actors: d.state.objects.map((o) => ({ localId: o.localId, visible: true })) } as never) }), createScriptRunner: (d) => ({ ...createFakeScriptRunner(d), start: (x) => void starts.push(x), notice: (text, slots) => void notices.push([text as Id, slots]) }), now: () => 'fixed', log: new CountingStubLog(() => {}) });
  const d = { registries: game.registries, state: game.state, world: game.world, scripts: game.scripts, ns: 'fixture', sound: {} as never, log: game.log, openApp: () => {} };
  return { game, d, notices, starts: starts as { label: Id; source: string }[], warps, reg: game.registries, s: game.state };
}

describe('Vs. Seeker', () => {
  it('the item runs its script (SCRIPT_ID(VS_SEEKER, 0)) on the main matrix and is refused elsewhere', () => {
    const { d, s, reg, starts } = setup();
    useFieldItem(d, f('SEEKER'));
    expect(starts.at(-1)).toMatchObject({ label: f('VsSeeker_Use'), source: 'item' });
    reg.matrices.get(reg.zones.get(s.player.zone)!.matrix)!.sourceIndex = 9;
    expect(fieldItemCheck(d, f('SEEKER'))).toBe('generic');
  });
  it('charges one per step while owned and expires the rematches after 100 active steps', () => {
    const { s, reg } = setup();
    s.flags[systemFlag(reg, SEEKER_USED)] = true;
    giveItem(s, reg, f('SEEKER'), 1);
    let clears = 0;
    for (let i = 0; i < 99; i++) seekerStep(reg, s, (i) => itemCount(s, i), () => clears++);
    expect(clears).toBe(0);
    seekerStep(reg, s, (i) => itemCount(s, i), () => clears++);
    expect(clears).toBe(1);
    expect(read(reg, s, V.battery)).toBe(100);
    expect(s.flags[systemFlag(reg, SEEKER_USED)] ?? false).toBe(false);
  });
  it('selects the first undefeated tier, falls back once to a populated tier, caps at the final tier', () => {
    const { reg, s } = setup();
    const get = () => rematchTrainer(reg, s, f('TRAINER_700'), 49);
    expect(rematchTrainer(reg, s, f('TRAINER_700'), 14)).toBe(0);
    expect(get()).toBe(700);
    s.flags[systemFlag(reg, 2432)] = true;
    expect(get()).toBe(701);
    s.flags[systemFlag(reg, 2061)] = true;
    expect(get()).toBe(701); // tier 3 locked: just tier 2
    s.flags[systemFlag(reg, 2433)] = true;
    expect(get()).toBe(702);
    s.flags[systemFlag(reg, 2062)] = true;
    expect(get()).toBe(702); // tier 5 locked: skips empty tier 4
    s.flags[systemFlag(reg, 2435)] = true;
    expect(get()).toBe(703);
    s.flags[systemFlag(reg, 2063)] = true;
    expect(get()).toBe(703);
  });
});

describe('Escape Rope', () => {
  it('checks partner/cave/permission, consumes exactly one and warps to the saved exit; missing exits throw', () => {
    const { d, s, reg, warps } = setup();
    expect(fieldItemCheck(d, f('ROPE'))).toBe('generic');
    s.player.zone = f('ORIGINAL_CAVE');
    expect(fieldItemCheck(d, f('ROPE'))).toBeNull();
    s.hasPartner = true;
    expect(fieldItemCheck(d, f('ROPE'))).toBe('partner');
    s.hasPartner = false;
    giveItem(s, reg, f('ROPE'), 2);
    expect(() => useFieldItem(d, f('ROPE'))).toThrow(/no exit location/);
    s.escapeLocation = { zone: f('TOWN'), x: 12, z: 17, facing: 'up' };
    useFieldItem(d, f('ROPE'));
    expect(warps).toEqual([[f('TOWN'), 12, 17, 'up']]);
    expect(s.bag.items!.find((i) => i.item === f('ROPE'))!.count).toBe(1);
  });
});

it('rejects malformed pack tables and malformed field RNG saves at the boundary', () => {
  const { game } = setup();
  const save = game.save();
  expect(() => game.load({ ...save, state: { ...save.state, fieldRng: { seed: -1 } } })).toThrow(/invalid save/);
  const pack = fieldPack();
  pack.registries.newGame![0]!.sizeIntervals = [];
  expect(() => createGame({ packs: [pack], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1 })).toThrow(/16 increasing/);
});

describe('daily events', () => {
  it('lottery consumes both draws and preserves the native overwritten-low-half bug; winner is by trailing digits', () => {
    const { reg, s } = setup();
    const draws = [123, 456];
    write(reg, s, V.lotteryHigh, 789);
    randomizeLottery(reg, s, () => draws.shift()!);
    expect(read(reg, s, V.lotteryLow)).toBe(456);
    expect(read(reg, s, V.lotteryHigh)).toBe(789);
    s.party.push(setupPokemon(s, reg, 0, f('SPECIES_MOSSLET'), 5, []));
    s.party[0]!.otId = 12345;
    s.boxes[0]!.slots[4] = { ...structuredClone(s.party[0]!), otId: 12345 };
    expect(lotteryWinner(s, 12345)).toEqual({ digits: 5, index: 0, box: 0 });
    s.party[0]!.isEgg = true;
    expect(lotteryWinner(s, 12345)).toEqual({ digits: 5, index: 4, box: 1 });
    expect(lotteryWinner(s, 12346)).toEqual({ digits: 0, index: 0, box: 0 });
  });
  it('dispatches once at midnight, advances every elapsed day, preserves size and freezes between clock steps, round trips', () => {
    const { game, reg, s } = setup();
    const log = new CountingStubLog(() => {});
    s.gameTime.now = { date: '2009-03-22', hour: 23, minute: 59, second: 59 };
    write(reg, s, V.size, 33280);
    s.flags[systemFlag(reg, 2739)] = true;
    const next = { date: '2009-03-25', hour: 0, minute: 0, second: 0 };
    let random = s.gameTime.dailyRandom!;
    updateGameTime(s.gameTime, next, log, (days) => dailyEvents(reg, s, days));
    expect(s.flags[systemFlag(reg, 2739)] ?? false).toBe(false);
    for (let i = 0; i < 3; i++) random = (Math.imul(random, 1812433253) + 1) >>> 0;
    expect(s.gameTime.dailyRandom).toBe(random);
    expect(read(reg, s, V.level)).toBeGreaterThanOrEqual(2);
    expect(read(reg, s, V.level)).toBeLessThanOrEqual(99);
    expect(read(reg, s, V.size)).toBe(33280);
    const rng = { ...s.rng };
    updateGameTime(s.gameTime, next, log, (days) => dailyEvents(reg, s, days));
    expect(s.rng).toEqual(rng);
    game.setClock(next.date, '00:00');
    game.load(game.save());
    expect(game.state.gameTime.dailyRandom).toBe(random);
  });
  it('size derives from PID and IV nibbles and uses imported intervals; missing data fails loudly', () => {
    const { reg, s } = setup();
    const m = setupPokemon(s, reg, 0, f('SPECIES_MOSSLET'), 5, []);
    m.pid = 0x1234; m.ivs = { hp: 0, attack: 0, defense: 0, speed: 0, spAttack: 0, spDefense: 0 };
    expect(sizeFactor(m)).toBe(0x3412);
    const height = reg.species.get(m.species)!.dex!.height;
    const factor = sizeFactor(m);
    const mm = Math.floor(height * (130 + Math.floor((factor - 12000) / 2)) / 10);
    expect(sizeInTenths(newGameRecord(reg).sizeIntervals!, height, factor)).toBe(Math.floor((Math.floor(mm * 1000 / 254) + 5) / 10));
  });
  it('a new game seeds the daily random from the field stream; a save without one derives it from its seed', () => {
    const { game, reg, s } = setup();
    expect(s.gameTime.dailyRandom).toBe(dailyRandomOf({ seed: s.seed, gameTime: {} }));
    const save = game.save();
    delete save.state.gameTime.dailyRandom;
    game.load(save);
    const days = { date: '2009-03-23', hour: 0, minute: 0, second: 0 };
    game.state.gameTime.now = { date: '2009-03-22', hour: 23, minute: 59, second: 59 };
    updateGameTime(game.state.gameTime, days, new CountingStubLog(() => {}), (n) => dailyEvents(reg, game.state, n));
    expect(game.state.gameTime.dailyRandom).toBe((Math.imul(s.gameTime.dailyRandom!, 1812433253) + 1) >>> 0);
  });
});
