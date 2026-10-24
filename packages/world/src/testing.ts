import { fixtureAudio } from '../../../tests/fixtures/audio.ts';
/** Shared world test harness: the fixture pack, a fake ScriptRunner and a tick driver. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { DEFAULT_CLOCK, emptyDaycare, loadPacks, readPackFolder, type Button, type ClockTime, type Id } from '@opensinnoh/core';
import { newPoketchState, newRoamerState, REGISTRIES, setupPokemon, type BattleSetup, type Facing, type GameState, type InputFrame, type MapEntry, type Registries, type ScriptRunner, type ScriptStart, type ScriptView, newFashionCase, newSealCase, newTvState, DRESS_UP_PHOTOS } from '@opensinnoh/contracts';
import type { Pokemon } from '@opensinnoh/core';
import { createWorld, type OpenSinnohWorld, type WorldDeps } from './world.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
const loaded = loadPacks([readPackFolder(read, 'packs/fixture')], '0.1.0', () => {}).registries;
/** Every registry, empty where the fixture pack has none (as the game's pack loader gives them). */
export const registries = Object.fromEntries(REGISTRIES.map((name) => [name, loaded[name] ?? new Map()])) as unknown as Registries;

export const f = (name: string) => `fixture:${name}` as Id;

/** A fixture Pokémon (contracts `setupPokemon`, slot 0 of a seed-1 state). */
export const mon = (species: string, level: number, moves: string[] = []): Pokemon => setupPokemon(newState(), registries, 0, f(species), level, moves.map(f));

/** Records starts; scripts finish at once unless `hold` is set. Simulates a few fixture scripts' var writes. */
export class FakeRunner implements ScriptRunner {
  starts: ScriptStart[] = [];
  immediates: ScriptStart[] = [];
  hold = false;
  private busy = false;
  constructor(private readonly state: GameState) {}
  start(s: ScriptStart): void {
    if (this.busy) throw new Error('already running');
    this.starts.push(s);
    if (s.label === f('Room_OnFrame_Intro')) this.state.vars[f('VAR_ROOM_INTRO')] = 1;
    this.busy = this.hold;
  }
  finish(): void {
    this.busy = false;
  }
  runImmediate(s: ScriptStart): void {
    this.immediates.push(s);
    if (s.label === f('Town_OnTransition')) {
      this.state.vars[f('VAR_OBJ_GFX_ID_0')] = 3;
      this.state.vars[f('VAR_MAP_LOCAL_0')] = (this.state.vars[f('VAR_MAP_LOCAL_0')] ?? 0) + 1;
    }
  }
  running(): boolean {
    return this.busy;
  }
  step(): void {}
  view(): ScriptView {
    return { message: null, yesNo: null, menu: null, panel: { kind: 'idle', title: '' }, app: null };
  }
  takeStartMenuRequest(): boolean {
    return false;
  }
  appDone(): void {}
  notice(): void {
    throw new Error('fake runner: no field messages');
  }
  ask(): void {
    throw new Error('fake runner: no field questions');
  }
}

export function newState(zone = 'ROOM', x = 14, z = 16, facing: Facing = 'up'): GameState {
  return {
    schemaVersion: 23,
    packs: [],
    names: { player: 'Ari', rival: 'Bo' },
    gender: 'male',
    trainerId: 0x12345678,
    flags: {},
    vars: {},
    party: [],
    boxes: [],
    currentBox: 0,
    money: 0,
    bag: Object.fromEntries(['items', 'medicine', 'balls', 'tmhms', 'berries', 'mail', 'battle_items', 'key_items'].map((p) => [p, []])),
    player: { zone: f(zone), x, z, y: 0, facing },
    objects: [],
    hasPartner: false, runningShoes: false,
    follower: null,
    rng: { seed: 1 },
    seed: 1,
    encounterRng: { seed: 2 },
    badges: [],
    pokedex: { obtained: false, national: false, seen: [], caught: [], forms: {} },
    poketch: newPoketchState(),
    playerState: 'walk',
    cyclingGear: 0,
    weather: f('OVERWORLD_WEATHER_CLEAR'),
    specialLocation: null,
    previousZone: null,
    platformLift: null,
    mapFeatures: null,
    gameTime: { now: { ...DEFAULT_CLOCK }, penaltyMinutes: 0 },
    tick: 0,
    startDate: null,
    playTime: { hours: 0, minutes: 0, seconds: 0 },
    coins: 0,
    registeredItem: null,
    wallpapersUnlocked: 0,
    repel: 0,
    records: { score: 0, hallOfFame: null, timesLinked: 0, linkBattleWins: 0, linkBattleLosses: 0, linkTrades: 0, counts: {} },
    berryPatches: [],
    poffins: [],
    fashionCase: newFashionCase(),
    sealCase: newSealCase(),
    contestPhotos: [null, null, null, null, null],
    journal: [],
    tv: newTvState(),
    dressUpPhotos: Array.from({ length: DRESS_UP_PHOTOS.count }, () => null),
    signature: null,
    options: { sound: 0, battleScene: 0, battleStyle: 0, buttonMode: 0, frame: 0 },
    daycare: emptyDaycare(),
    roamers: newRoamerState(),
    hallOfFame: { total: 0, entries: [] },
  };
}

/**
 * `date` sets the saved clock's date (yearly weathers); `clock` is the live clock (default: the saved clock's reading);
 * `entry` how the world enters the map (default an arrival; `load` for a saved state).
 */
export function setup(state = newState(), { introDone = true, regs = registries, date, clock, followerWalkInPlace, autoRun, hgssCharacter, entry = 'arrival' }: { introDone?: boolean; regs?: Registries; date?: string; clock?: ClockTime; followerWalkInPlace?: WorldDeps['followerWalkInPlace']; autoRun?: WorldDeps['autoRun']; hgssCharacter?: WorldDeps['hgssCharacter']; entry?: MapEntry } = {}) {
  if (introDone) state.vars[f('VAR_ROOM_INTRO')] = 1;
  if (date) state.gameTime.now = { ...state.gameTime.now, date };
  const scripts = new FakeRunner(state);
  const stubs: string[] = [];
  /** Battles the world started (the game would run them; here they end at once as nothing). */
  const battles: BattleSetup[] = [];
  const audio = fixtureAudio(regs, state);
  const deps: WorldDeps = {
    audio,
    registries: regs,
    followerWalkInPlace,
    ...(autoRun ? { autoRun } : {}),
    ...(hgssCharacter ? { hgssCharacter } : {}),
    state,
    scripts,
    log: { stub: (k) => void stubs.push(k) },
    battleLog: () => {},
    battles: { start: (s) => void battles.push(s), done: () => null, blackOut: () => {} },
    clock: () => clock ?? state.gameTime.now,
  };
  const world = createWorld(deps) as OpenSinnohWorld;
  let last: Button[] = [];
  const tick = (held: Button[] = []) => {
    const input: InputFrame = { held, pressed: held.filter((b) => !last.includes(b)), touch: null };
    last = held;
    audio.tick();
    world.checkTriggers(input);
    world.step(input);
    state.tick++;
  };
  const hold = (held: Button[], ticks: number) => {
    for (let i = 0; i < ticks; i++) tick(held);
  };
  const settle = () => {
    for (let i = 0; i < 200 && !world.idle(); i++) tick();
    expect(world.idle()).toBe(true);
  };
  world.enter(entry);
  settle();
  return { world, audio, state, scripts, stubs, battles, tick, hold, settle };
}

export const pos = (s: GameState) => [s.player.zone, s.player.x, s.player.z, s.player.facing];

export type Harness = ReturnType<typeof setup>;
