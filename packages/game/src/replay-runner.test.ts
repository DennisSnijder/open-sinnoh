import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, formatClock, type Id } from '@opensinnoh/core';
import type { GameSnapshot, Registries } from '@opensinnoh/contracts';
import { createGame } from './game.ts';
import { checkAssert, gameDriver, runReplay } from './replay-runner.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const game = (...packs: string[]) =>
  createGame({ packs: packs.map(readPack), createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}) });

describe('checkAssert text by id', () => {
  const registries = { texts: new Map([['t:Hi', { id: 't:Hi', text: 'Hello, {var 0}.{clear}You have {var 1} coins\nleft.{clear}' }]]) } as unknown as Registries;
  const snap = (text: string | null) => ({ view: { message: text === null ? null : { text } } }) as unknown as GameSnapshot;
  const a = (page: number, vars: Record<number, string> = {}) => ({ type: 'assert', what: 'text-id', id: 't:Hi', page, vars }) as const;
  it('matches a page of the record, {var n} as the given value or any line text', () => {
    expect(checkAssert(a(0), snap('Hello, Ari.'), registries)).toBeUndefined();
    expect(checkAssert(a(1, { 1: '120' }), snap('You have 120 coins\nleft.'), registries)).toBeUndefined();
    expect(checkAssert(a(1, { 1: '12' }), snap('You have 120 coins\nleft.'), registries)).toMatch(/expected that page/);
    expect(checkAssert(a(0), snap(null), registries)).toMatch(/got null/);
    expect(checkAssert(a(5), snap('x'), registries)).toMatch(/no such page/);
    expect(checkAssert({ ...a(0), id: 't:Nope' as never }, snap('x'), registries)).toMatch(/unknown text/);
  });

  it('a slot value that is a record id stands for its name in the game\'s language, a text id for its words', () => {
    const named = {
      texts: new Map([...registries.texts, ['t:Word', { id: 't:Word', text: 'ALLE' }]]),
      species: new Map([['t:SPECIES_BIDOOF', { name: 'BIDIZA' }]]),
      items: new Map(),
      moves: new Map(),
      abilities: new Map(),
    } as unknown as Registries;
    expect(checkAssert(a(0, { 0: 't:SPECIES_BIDOOF' }), snap('Hello, BIDIZA.'), named)).toBeUndefined();
    expect(checkAssert(a(0, { 0: 't:Word' }), snap('Hello, ALLE.'), named)).toBeUndefined();
    expect(checkAssert(a(0, { 0: 't:SPECIES_BIDOOF' }), snap('Hello, BIDOOF.'), named)).toMatch(/expected that page/);
    expect(() => checkAssert(a(0, { 0: 't:SPECIES_NOPE' }), snap('Hello, x.'), named)).toThrow(/no record t:SPECIES_NOPE/);
  });
  it('assert state with a record id expects that record\'s words', () => {
    const named = { texts: new Map([['t:Nick', { id: 't:Nick', text: 'Kadabi' }]]), species: new Map(), items: new Map(), moves: new Map(), abilities: new Map() } as unknown as Registries;
    const state = (nickname: string) => ({ state: { party: [{ nickname }] } }) as unknown as GameSnapshot;
    const nick = { type: 'assert' as const, what: 'state' as const, path: ['party', 0, 'nickname'], source: 'party[0].nickname', value: null, name: 't:Nick' as Id };
    expect(checkAssert(nick, state('Kadabi'), named)).toBeUndefined();
    expect(checkAssert(nick, state('Kazza'), named)).toBe('assert state party[0].nickname: expected "Kadabi", got "Kazza"');
  });
});

describe('runReplay (headless, fake world and VM)', () => {
  it('reports the failing line and the expected value', async () => {
    const g = game('fixture');
    const r = await runReplay(gameDriver(g), '0 assert position fixture:ROOM 14 16\n3 assert flag fixture:FLAG_TALKED_TO_HELPER true\n', { registries: g.registries });
    expect(r).toMatchObject({ ok: false, ticks: 3, assertions: 1, error: 'Replay line 2 (tick 3): assert flag fixture:FLAG_TALKED_TO_HELPER: expected true, got false' });
    const facing = await runReplay(gameDriver(g), `0 assert facing player ${g.state.player.facing === 'up' ? 'down' : 'up'}\n`, { registries: g.registries });
    expect(facing.error).toMatch(/assert facing player: expected/);
    const missing = await runReplay(gameDriver(g), '0 assert facing 99 up\n', { registries: g.registries });
    expect(missing.error).toMatch(/assert facing 99: 0 objects have that local id/);
    const parse = await runReplay(gameDriver(g), '0 jump\n', { registries: g.registries });
    expect(parse.error).toMatch(/Replay line 1: cannot parse/);
  });

  it('skips the save round-trip while a script runs, and reports it', async () => {
    const g = game('fixture');
    const r = await runReplay(gameDriver(g), '2 assert message open\n2 screenshot intro\n', { registries: g.registries });
    expect(r).toMatchObject({ ok: true, roundTrip: { skipped: 'cannot save while a script is running' }, skipped: ['line 2: screenshot intro'] });
  });

  it('fails when save → reset → load → save changes the state', async () => {
    const g = game('fixture');
    const driver = gameDriver(g);
    const r = await runReplay({ ...driver, load: (json, entry) => (driver.load(json, entry), void (g.state.money = 1)) }, '0 assert map fixture:ROOM\n', {
      registries: g.registries,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/save round-trip changed the state/);
  });

  it('fails when a second run from the same seed ends differently', async () => {
    const g = game('fixture');
    const driver = gameDriver(g);
    let resets = 0;
    const r = await runReplay({ ...driver, reset: (seed) => (driver.reset(seed), void (++resets === 2 && (g.state.money = 1))) }, '0 assert map fixture:ROOM\n', {
      registries: g.registries,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/replay is not deterministic/);
    expect(r.determinism).toBe('not-run');
  });

  it('event setup lines (0.28): a dev event by name; an unknown one or a pack without its records fails loudly', async () => {
    const g = game('fixture');
    expect((await runReplay(gameDriver(g), 'event mew\n0 assert map fixture:ROOM\n', { registries: g.registries })).error).toMatch(/unknown event mew/);
    expect((await runReplay(gameDriver(g), 'event regigigas\n0 assert map fixture:ROOM\n', { registries: g.registries })).error).toMatch(/no species 486/);
  });

  it('player and clock setup lines (0.8, 0.14): the bike needs a zone that allows it; the clock holds until reset', async () => {
    const g = game('fixture');
    const room = await runReplay(gameDriver(g), 'player cycle 1\n0 assert map fixture:ROOM\n', { registries: g.registries });
    expect(room.error).toMatch(/line 1: player cycle: fixture:ROOM does not allow the bike/);
    let seen = '';
    const r = await runReplay(gameDriver(g), 'player cycle 1\nwarp fixture:TOWN 38 14\ndate 2024-02-29 21:30\n0 assert state cyclingGear 1\n+0 assert state playerState "cycle"\n+0 assert state gameTime.now {"date":"2024-02-29","hour":21,"minute":30,"second":0}\n+0 assert state gameTime.penaltyMinutes 0\n+0 time 04:15\n+1 assert state gameTime.now {"date":"2024-02-29","hour":4,"minute":15,"second":0}\n', {
      registries: g.registries,
      beforeLine: () => void (seen = formatClock(g.clock())),
    });
    expect(r).toMatchObject({ ok: true, assertions: 5 });
    // The setup moved the saved clock with it (no penalty); the timed line stepped it back (no penalty either).
    expect(seen).toBe('2024-02-29 04:15:00');
    expect(g.state.gameTime.penaltyMinutes).toBe(0);
    // Cycling carried over from the `from` replay into a zone without the bike fails at the warp line.
    const files: Record<string, string> = { 'bike.replay': 'player cycle 1\nwarp fixture:TOWN 38 14\nuntil idle\n' };
    const carried = await runReplay(gameDriver(g), 'from bike.replay\nwarp fixture:ROOM 14 16\n', { registries: g.registries, name: 'next.replay', resolve: (f) => ({ name: f, text: files[f]! }) });
    expect(carried.error).toBe('next.replay line 2: warp while cycling: fixture:ROOM does not allow the bike');
    g.reset(1);
    expect(g.clock()).toEqual(DEFAULT_CLOCK);
    const fm = await runReplay(gameDriver(g), '0 field move 0 fixture:MOVE_DEFOG\n', { registries: g.registries });
    expect(fm.error).toMatch(/line 1 \(tick 0\): field move 0 fixture:MOVE_DEFOG: no Pokémon in party slot 0/);
  });

  it('reload saves and loads mid-replay; it fails while a script runs or when the load changes the state', async () => {
    const g = game('fixture');
    const ok = await runReplay(gameDriver(g), 'warp fixture:TOWN 10 14 left\nuntil idle\n+0 assert facing player left\n+0 reload\nuntil idle\n+0 assert position fixture:TOWN 10 14\n', { registries: g.registries });
    expect(ok).toMatchObject({ ok: true, assertions: 2 });
    const busy = await runReplay(gameDriver(g), '2 reload\n', { registries: g.registries });
    expect(busy.error).toBe('Replay line 1 (tick 2): reload: cannot save while a script is running');
    const driver = gameDriver(g);
    let loads = 0;
    const changed = await runReplay({ ...driver, load: (json, entry) => (driver.load(json, entry), void (++loads === 2 && (g.state.money += 1))) }, 'warp fixture:TOWN 10 14\nuntil idle\n+0 reload\n', { registries: g.registries, repeat: false });
    expect(changed.error).toMatch(/^Replay line 3 \(tick \d+\): reload changed the state/);
  });

  it('runs twice and round-trips when the replay ends idle (the pack replays run on the real engine in opensinnoh test)', async () => {
    const g = game('fixture');
    const r = await runReplay(gameDriver(g), '0 assert map fixture:ROOM\n', { registries: g.registries });
    expect(r).toMatchObject({ ok: true, determinism: 'identical', roundTrip: 'identical', assertions: 1 });
  });

  it('relative ticks and until idle: waits out the intro message, fails loudly at max', async () => {
    const g = game('fixture');
    const stuck = await runReplay(gameDriver(g), '+12 assert message open\nuntil idle 30\n', { registries: g.registries });
    expect(stuck.error).toMatch(/^Replay line 2 \(tick 12\): until idle: still busy after 30 ticks \(player fixture:ROOM 14,16 facing up; script running; message \(waiting\) /);
    const r = await runReplay(gameDriver(g), '+12 assert message open\n+68 press a\n+2 release a\nuntil idle\n+0 assert message closed\n+1 assert var fixture:VAR_ROOM_INTRO 1\n', { registries: g.registries });
    expect(r).toMatchObject({ ok: true, assertions: 3, determinism: 'identical', roundTrip: 'identical' });
    expect(r.ticks).toBeGreaterThan(82);
  });

  it('until message, advance text and until state wait on the game, not on ticks; battle asserts read the log by content', async () => {
    const g = game('fixture');
    const text = [
      'until message 200',
      '+0 assert message open',
      'advance text',
      '+0 assert message closed',
      'until state vars["fixture:VAR_ROOM_INTRO"] 1 5',
      '+0 assert battles trainer 0',
      '+0 assert battle wild * fled',
    ].join('\n');
    const r = await runReplay(gameDriver(g), text, { registries: g.registries });
    expect(r).toMatchObject({ ok: true, assertions: 4, determinism: 'identical', roundTrip: 'identical' });
    const missing = await runReplay(gameDriver(g), '+0 assert battle trainer fixture:TRAINER_NOBODY won\n', { registries: g.registries });
    expect(missing.error).toMatch(/assert battle trainer fixture:TRAINER_NOBODY: no such entry/);
    const stuck = await runReplay(gameDriver(g), 'until position 99 99 10\n', { registries: g.registries });
    expect(stuck.error).toMatch(/^Replay line 1 \(tick 0\): until position 99 99: still not there after 10 ticks \(player fixture:ROOM /);
  });

  it('advance message answers the box page by page and ends on the tick it closes, as a press a / release a chain does', async () => {
    const g = game('fixture');
    const chain = await runReplay(gameDriver(g), ['until message 200', '+0 press a', '+1 release a', '+0 assert message closed'].join('\n'), { registries: g.registries });
    const close = await runReplay(gameDriver(g), ['until message 200', 'advance message', '+0 assert message closed'].join('\n'), { registries: g.registries });
    expect(chain).toMatchObject({ ok: true });
    expect(close).toMatchObject({ ok: true, ticks: chain.ticks, determinism: 'identical' });
    const stuck = await runReplay(gameDriver(g), ['until message 200', 'advance message', 'advance message 5'].join('\n'), { registries: g.registries });
    expect(stuck.error).toMatch(/advance message: /);
  });

  it('until position reads {path} and {path|k=v} arguments from the state when the step runs, and fails loudly', async () => {
    const g = game('fixture');
    const r = await runReplay(gameDriver(g), 'until position {player.x} {player.z|3=5,16=16} 10\n', { registries: g.registries });
    expect(r).toMatchObject({ ok: true, determinism: 'identical' });
    const mapped = await runReplay(gameDriver(g), 'until position {player.x} {player.z|16=15} 10\n', { registries: g.registries });
    expect(mapped.error).toMatch(/^Replay line 1 \(tick 0\): until position 14 15: still not there after 10 ticks/);
    const fail = async (arg: string) => (await runReplay(gameDriver(g), `until position ${arg} 16 10\n`, { registries: g.registries })).error;
    expect(await fail('{mapFeatures.correctDoor}')).toMatch(/^Replay line 1 \(tick 0\): state argument \{mapFeatures.correctDoor\}: no such state$/);
    expect(await fail('{player.zone}')).toMatch(/state argument \{player.zone\}: not a number: "fixture:ROOM"$/);
    expect(await fail('{player.x|1=4,2=8}')).toMatch(/state argument \{player.x\}: 14 is not one of 1, 2$/);
  });

  it('setup lines edit the state before tick 0, are echoed, and assert state reads state and battle log', async () => {
    const g = game('fixture');
    const text = [
      'set flag fixture:FLAG_TALKED_TO_HELPER true',
      'set var fixture:VAR_SCENE 2',
      'give badge fixture:BADGE_TEST',
      'party 0 fixture:SPECIES_MOSSLET 7 fixture:MOVE_SURF',
      'warp fixture:TOWN 10 14',
      'until idle',
      '+0 assert position fixture:TOWN 10 14',
      '+0 assert flag fixture:FLAG_TALKED_TO_HELPER true',
      '+0 assert state vars["fixture:VAR_SCENE"] 2',
      '+0 assert state badges ["fixture:BADGE_TEST"]',
      '+0 assert state party[0].species "fixture:SPECIES_MOSSLET"',
      '+0 assert state party[0].moves ["fixture:MOVE_SURF"]',
      '+0 assert state party[0].level 7',
      '+0 assert state pokedex.caught ["fixture:SPECIES_MOSSLET"]',
      '+0 assert state battles []',
    ].join('\n');
    const r = await runReplay(gameDriver(g), text, { registries: g.registries, name: 'setup.replay' });
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ ok: true, assertions: 9, roundTrip: 'identical' });
    expect(r.setup).toEqual(['setup.replay:1 set flag fixture:FLAG_TALKED_TO_HELPER true', 'setup.replay:2 set var fixture:VAR_SCENE 2', 'setup.replay:3 give badge fixture:BADGE_TEST', 'setup.replay:4 party 0 fixture:SPECIES_MOSSLET 7 fixture:MOVE_SURF', 'setup.replay:5 warp fixture:TOWN 10 14']);
    const bad = await runReplay(gameDriver(g), 'give item fixture:ITEM_NOPE\n0 assert map fixture:ROOM\n', { registries: g.registries });
    expect(bad.error).toBe('replay line 1: unknown item fixture:ITEM_NOPE');
    const gap = await runReplay(gameDriver(g), 'party 1 fixture:SPECIES_MOSSLET 5\n', { registries: g.registries });
    expect(gap.error).toMatch(/party slot 1: the party has 0/);
    const wrong = await runReplay(gameDriver(g), '0 assert state pokedex {"obtained": true, "national": false}\n', { registries: g.registries });
    expect(wrong.error).toBe('Replay line 1 (tick 0): assert state pokedex: expected {"obtained":true,"national":false}, got {"obtained":false,"national":false,"seen":[],"caught":[],"forms":{}}');
    const missing = await runReplay(gameDriver(g), '0 assert state battles[0].trainers []\n', { registries: g.registries });
    expect(missing.error).toMatch(/assert state battles\[0\]\.trainers: expected \[\], got nothing/);
  });

  it('from runs the named replay first (relative to the naming one), then this one from its end', async () => {
    const g = game('fixture');
    const files: Record<string, string> = {
      'cp/intro.replay': '+80 press a\n+2 release a\nuntil idle\n',
      'cp/next.replay': 'from intro.replay\n+0 assert var fixture:VAR_ROOM_INTRO 1\n+0 screenshot here\n',
      'cp/loop.replay': 'from loop.replay\n',
    };
    const resolve = (file: string, base: string | undefined) => {
      const name = base ? base.replace(/[^/]*$/, '') + file : file;
      if (!(name in files)) throw new Error(`no ${name}`);
      return { name, text: files[name]! };
    };
    const r = await runReplay(gameDriver(g), files['cp/next.replay']!, { registries: g.registries, name: 'cp/next.replay', resolve });
    expect(r).toMatchObject({ ok: true, assertions: 1, skipped: ['line 3: screenshot here'] });
    expect(r.ticks).toBeGreaterThan(82);
    const cycle = await runReplay(gameDriver(g), files['cp/loop.replay']!, { registries: g.registries, name: 'cp/loop.replay', resolve });
    expect(cycle.error).toBe('cp/loop.replay line 1: "from" cycle through cp/loop.replay');
    const noResolver = await runReplay(gameDriver(g), 'from x.replay\n', { registries: g.registries });
    expect(noResolver.error).toMatch(/"from" needs a replay resolver/);
  });

  it('chainedScreenshots takes the screenshot lines of the matching `from` replays too', async () => {
    const g = game('fixture');
    const files: Record<string, string> = {
      'parts/a.replay': '+1 screenshot part-beat\n',
      'main.replay': 'from parts/a.replay\n+1 screenshot main-beat\n',
    };
    const resolve = (file: string) => ({ name: file, text: files[file]! });
    const plain = await runReplay(gameDriver(g), files['main.replay']!, { registries: g.registries, name: 'main.replay', resolve, repeat: false });
    expect(plain.skipped).toEqual(['line 2: screenshot main-beat']);
    const chained = await runReplay(gameDriver(g), files['main.replay']!, { registries: g.registries, name: 'main.replay', resolve, repeat: false, chainedScreenshots: /^parts\// });
    expect(chained.skipped).toEqual(['line 1: screenshot part-beat', 'line 2: screenshot main-beat']);
  });

  it('beforeLine sees each main line at its tick and can skip it', async () => {
    const g = game('fixture');
    const seen: [number, number][] = [];
    const r = await runReplay(gameDriver(g), '+3 assert map fixture:ROOM\n+2 assert map fixture:NOPE\n', {
      registries: g.registries,
      repeat: false,
      beforeLine: (line, tick) => (seen.push([line.line, tick]), line.line !== 2),
    });
    expect(r).toMatchObject({ ok: true, assertions: 1 });
    expect(seen).toEqual([[1, 3], [2, 5]]);
  });
});

