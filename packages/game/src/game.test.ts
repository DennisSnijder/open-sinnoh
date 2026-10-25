import { describe, expect, it } from 'vitest';
import { setupPokemon, type CreateScriptRunner, type CreateWorld, type InputFrame, type ScriptView } from '@opensinnoh/contracts';
import type { Id, PackData } from '@opensinnoh/core';
import { applyButtonMode, BUTTON_MODE, computePressed, InputState } from './input.ts';
import { createGame, reloadGame, type GameOptions } from './game.ts';
import { CountingStubLog } from './stub-log.ts';
import { PackMismatchError } from './save.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const fixture = () => [readPack('fixture')];
const options = (extra: Partial<GameOptions> = {}): GameOptions => ({
  packs: fixture(),
  createWorld: createFakeWorld,
  createScriptRunner: createFakeScriptRunner,
  seed: 7,
  log: new CountingStubLog(() => {}),
  now: () => '2026-10-14T00:00:00.000Z',
  ...extra,
});

describe('input', () => {
  it('computes pressed from held', () => {
    expect(computePressed(new Set(['a', 'up']), new Set(['up']))).toEqual(['a']);
    expect(computePressed(new Set(['b', 'a']), new Set())).toEqual(['a', 'b']);
    const input = new InputState();
    input.press('a');
    expect(input.sample()).toEqual({ held: ['a'], pressed: ['a'], touch: null });
    expect(input.sample()).toEqual({ held: ['a'], pressed: [], touch: null });
    input.release('a');
    input.press('right');
    input.touch(10, 20);
    expect(input.sample()).toEqual({ held: ['right'], pressed: ['right'], touch: { x: 10, y: 20 } });
  });

  it('remaps keys by the BUTTON MODE option (decomp ApplyButtonModeToInput)', () => {
    const frame: InputFrame = { held: ['l', 'r', 'start'], pressed: ['l', 'start'], touch: null };
    expect(applyButtonMode(frame, BUTTON_MODE.normal)).toBe(frame);
    expect(applyButtonMode(frame, BUTTON_MODE.startIsX)).toEqual({ held: ['x', 'l', 'r', 'start'], pressed: ['x', 'l', 'start'], touch: null });
    expect(applyButtonMode(frame, BUTTON_MODE.lIsA)).toEqual({ held: ['a', 'start'], pressed: ['a', 'start'], touch: null });
  });
});

describe('createGame', () => {
  it('shares the field view between popup and music observers on ticks, resets and loads', () => {
    let views = 0;
    const createWorld: CreateWorld = (deps) => {
      const world = createFakeWorld(deps);
      return { ...world, view: () => { views++; return world.view(); } };
    };
    const createScriptRunner: CreateScriptRunner = (deps) => ({ ...createFakeScriptRunner(deps), start() {}, runImmediate() {} });
    const game = createGame(options({ createWorld, createScriptRunner }));
    expect(views).toBe(1);
    views = 0;
    game.advance(30);
    expect(views).toBe(30);
    const save = game.save();
    views = 0;
    game.reset();
    expect(views).toBe(1);
    views = 0;
    game.load(save);
    expect(views).toBe(1);
  });

  it('builds new game state from the newGame record and runs its label before the first map load', () => {
    const calls: string[] = [];
    const runner: CreateScriptRunner = (deps) => {
      const vm = createFakeScriptRunner(deps);
      return { ...vm, runImmediate: (s) => (calls.push(`runImmediate ${s.label} ${s.source}`), vm.runImmediate(s)) };
    };
    const world: CreateWorld = (deps) => {
      const w = createFakeWorld(deps);
      return { ...w, enter: (entry) => (calls.push('enter'), w.enter(entry)) };
    };
    const game = createGame(options({ createWorld: world, createScriptRunner: runner, newGame: { names: { player: 'Kai', rival: 'Mo' }, gender: 'female' } }));
    expect(calls).toEqual(['runImmediate fixture:NewGame_Init new-game', 'enter']);
    expect(game.state).toMatchObject({
      packs: [{ id: 'fixture', version: '0.1.0' }],
      names: { player: 'Kai', rival: 'Mo' },
      gender: 'female',
      money: 3000,
      player: { zone: 'fixture:ROOM', x: 14, z: 16, y: 0, facing: 'up' },
      flags: { 'fixture:FLAG_NEW_GAME_DONE': true },
      tick: 0,
    });
    expect(game.state.objects.map((o) => o.localId)).toEqual([0]);
  });

  it('runs the tick order input → triggers → vm.step → world.step, and skips triggers while busy', () => {
    const order: string[] = [];
    let running = false;
    const view: ScriptView = { message: null, yesNo: null, menu: null, panel: { kind: 'idle', title: '' }, app: null };
    const runner: CreateScriptRunner = () => ({
      start: () => {},
      runImmediate: () => {},
      running: () => running,
      step: (f: InputFrame) => order.push(`vm ${f.pressed.join()}`),
      view: () => view,
      takeStartMenuRequest: () => false,
      fieldReturn: () => {},
      appDone: () => {},
      notice: () => {},
      ask: () => {},
    });
    const world: CreateWorld = (deps) => ({
      ...createFakeWorld(deps),
      enter: () => {},
      checkTriggers: (f) => order.push(`triggers ${f.pressed.join()}`),
      step: (f) => order.push(`world ${f.held.join()}`),
      idle: () => true,
    });
    const game = createGame(options({ createWorld: world, createScriptRunner: runner }));
    game.press('a');
    game.tick();
    running = true;
    game.tick();
    expect(order).toEqual(['triggers a', 'vm a', 'world a', 'vm ', 'world a']);
    expect(game.state.tick).toBe(2);
  });

  it('owns the PRNG in state', () => {
    let rng: () => number = () => 0;
    const runner: CreateScriptRunner = (deps) => ((rng = deps.rng), createFakeScriptRunner(deps));
    const a = createGame(options({ createScriptRunner: runner }));
    const before = a.state.rng.seed;
    const first = rng();
    expect(a.state.rng.seed).not.toBe(before);
    a.reset(7);
    expect(rng()).toBe(first);
  });

  it('saves only when idle, and loads strictly', () => {
    const game = createGame(options());
    game.advance(2); // the room intro message is open
    expect(game.snapshot().view.message).not.toBeNull();
    expect(() => game.save()).toThrow('cannot save while a script is running');
    game.press('a');
    game.advance(2);
    game.release('a');
    game.advance(2);
    const save = game.save();
    expect(save).toMatchObject({ format: 'lantern-nds-save', version: 1, savedAt: '2026-10-14T00:00:00.000Z' });
    expect(save.state.vars).toEqual({ 'fixture:VAR_ROOM_INTRO': 1 });

    game.reset();
    expect(game.state.vars).toEqual({});
    game.reset(undefined, { names: { player: 'Kai', rival: 'Mo' }, gender: 'female' });
    expect([game.state.names, game.state.gender]).toEqual([{ player: 'Kai', rival: 'Mo' }, 'female']);
    game.reset(); // the new names are kept
    expect(game.state.names.player).toBe('Kai');
    game.load(JSON.parse(JSON.stringify(save)));
    expect(game.state).toEqual(save.state);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edits raw save JSON
    type Raw = Record<string, any>;
    const bad = (edit: (s: Raw) => void) => {
      const copy = structuredClone(save) as unknown as Raw;
      edit(copy);
      return () => game.load(copy);
    };
    expect(bad((s) => (s.format = 'other'))).toThrow('This file is not an OpenSinnoh save');
    expect(bad((s) => (s.state.flags['fixture:FLAG_NOPE'] = true))).toThrow('invalid save: state.flags.fixture:FLAG_NOPE (key): unknown flags fixture:FLAG_NOPE');
    const mon = setupPokemon(game.state, game.registries, 0, 'fixture:SPECIES_MOSSLET' as Id, 5);
    expect(bad((s) => (s.state.party = [{ ...mon, species: 'fixture:SPECIES_X' }]))).toThrow('state.party[0].species: unknown species fixture:SPECIES_X');
    expect(bad((s) => (s.state.party = [{ ...mon, pp: [] }]))).toThrow('state.party[0]: moves, pp and ppUps must be parallel');
    expect(bad((s) => (s.state.party = Array.from({ length: 7 }, () => mon)))).toThrow('party has 7 members');
    expect(bad((s) => (s.state.player.zone = 'fixture:NOWHERE'))).toThrow('state.player.zone: unknown zones fixture:NOWHERE');
    const follower = { zone: 'fixture:TOWN', localId: 0, x: 1, z: 1, y: 0, facing: 'up', movementType: 0, sprite: 'fixture:SPRITE_HERO' };
    expect(bad((s) => (s.state.follower = { ...follower, label: 'fixture:NO_LABEL' }))).toThrow('state.follower.label: unknown labels fixture:NO_LABEL');
    expect(bad((s) => (s.state.follower = { ...follower, label: 'fixture:Town_Guide' }))).not.toThrow();
    expect(bad((s) => (s.state.extra = 1))).toThrow('invalid save: state.extra: unknown field');
    expect(bad((s) => delete s.state.rng)).toThrow('invalid save: state.rng: missing');
    expect(bad((s) => (s.state.packs = [{ id: 'fixture', version: '0.2.0' }]))).toThrow('save was made with packs [fixture@0.2.0], but [fixture@0.1.0] are loaded');
    expect(bad((s) => (s.state.packs = [{ id: 'fixture', version: '0.2.0' }]))).toThrow(PackMismatchError);
    expect(bad(() => {})).not.toThrow();
  });

  it('keeps progress when a cosmetic (art-only) pack is added or removed', () => {
    const art = (extra: Partial<PackData> = {}): PackData => ({
      manifest: { id: 'art', name: 'Art', version: '1.0.0', engine: '^0.1.0', dependencies: { fixture: '*' }, loadAfter: [], cosmetic: true },
      registries: { followers: [] },
      scripts: { labels: {} },
      patches: [],
      remove: [],
      provenance: 'original',
      ...extra,
    });
    const plain = createGame(options());
    plain.state.money = 4321;
    const save = JSON.parse(JSON.stringify(plain.save()));
    const withArt = createGame(options({ packs: [...fixture(), art()] }));
    withArt.load(save);
    expect(withArt.state.money).toBe(4321);
    const saveWithArt = JSON.parse(JSON.stringify(withArt.save()));
    saveWithArt.state.packs = [...saveWithArt.state.packs, { id: 'art', version: '1.0.0' }]; // a save from before the flag listed it
    withArt.load(saveWithArt);
    expect(withArt.state.money).toBe(4321);
    expect(() => createGame(options({ packs: [...fixture(), art({ registries: { items: [] } })] }))).toThrow('a cosmetic pack may only touch sprites, followers, followerTalk, not "items"');
  });

  it('hot-reloads edited packs between scripts, keeping the state', () => {
    const game = createGame(options());
    game.state.money = 1234;
    const edited = fixture();
    edited[0]!.registries.texts!.find((t) => t.id === 'fixture:Text_TvShow')!.text = 'Edited.';
    const next = reloadGame(game, options({ packs: edited }));
    expect(next.state.money).toBe(1234);
    expect(next.registries.texts.get('fixture:Text_TvShow')!.text).toBe('Edited.');
    next.advance(2); // the room intro opens
    expect(() => reloadGame(next, options())).toThrow('cannot save while a script is running');
  });
});
