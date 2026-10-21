/** Test helpers: fixture pack registries, a fake FieldHost and an input driver. Not used at runtime. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUTTONS, DEFAULT_CLOCK, emptyDaycare, loadPacks, readPackFolder, type Button, type ClockTime, type Id, type Pokemon } from '@opensinnoh/core';
import { newPoketchState, newRoamerState, REGISTRIES, setupPokemon, newFashionCase } from '@opensinnoh/contracts';
import type { AudioHost, BattleLogEntry, BattleRequest, BattleResult, Facing, FieldHost, GameState, InputFrame, Labels, PlayerPosition, Registries, ScriptRunner, StubLog } from '@opensinnoh/contracts';
import { createScriptRunner } from './runner.ts';
import { TEXT_SPEED } from '@opensinnoh/text';

const fixtureRoot = join(import.meta.dirname, '../../../packs/fixture');

export function loadFixture(): { registries: Registries; labels: Labels } {
  const read = (p: string) => (existsSync(join(fixtureRoot, p)) ? readFileSync(join(fixtureRoot, p), 'utf8') : undefined);
  const loaded = loadPacks([readPackFolder(read, 'packs/fixture')], '0.1.0', () => {});
  const labels = new Map([...loaded.labels].map(([id, l]) => [id, { pack: l.pack, commands: l.binding.commands }]));
  // loadPacks omits empty registries; the game adds empty maps (as here).
  const registries = Object.fromEntries(REGISTRIES.map((r) => [r, loaded.registries[r] ?? new Map()]));
  return { registries: registries as unknown as Registries, labels };
}

/** A Pokémon of the given registries (contracts `setupPokemon` on a fresh test state, slot 0). */
export function testMon(registries: Registries, species: string, level: number, moves: string[] = []): Pokemon {
  return setupPokemon(newState(), registries, 0, species as Id, level, moves as Id[]);
}

export function newState(): GameState {
  return {
    schemaVersion: 19,
    packs: [],
    names: { player: 'Ari', rival: 'Bo' },
    gender: 'male',
    trainerId: 0x12345678,
    flags: {},
    vars: {},
    party: [],
    boxes: [],
    currentBox: 0,
    money: 3000,
    bag: Object.fromEntries(['items', 'medicine', 'balls', 'tmhms', 'berries', 'mail', 'battle_items', 'key_items'].map((p) => [p, []])),
    player: { zone: 'fixture:TOWN', x: 38, z: 14, y: 0, facing: 'right' },
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
    weather: 'fixture:OVERWORLD_WEATHER_CLEAR',
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
    signature: null,
    options: { sound: 0, battleScene: 0, battleStyle: 0, buttonMode: 0, frame: 0 },
    daycare: emptyDaycare(),
    roamers: newRoamerState(),
    hallOfFame: { total: 0, entries: [] },
  };
}

/** Fake world: movements take `movementTicks` field steps; fades and warps finish after `fadeTicks`. */
export class FakeField implements FieldHost {
  calls: string[] = [];
  movementTicks = 3;
  fadeTicks = 4;
  /** Ticks a trainer approach / obstacle animation takes. */
  approachTicks = 0;
  obstacleTicks = 0;
  private approachLeft = 0;
  private obstacleLeft = 0;
  private moving = new Map<number, number>();
  private fadeLeft = 0;
  private warpLeft = 0;
  constructor(private readonly state: GameState) {}
  /** World tick (vm.step then world.step, as in the game loop). */
  step(): void {
    if (this.cutInLeft > 0) this.cutInLeft--;
    for (const [k, v] of this.moving) {
      if (v <= 1) this.moving.delete(k);
      else this.moving.set(k, v - 1);
    }
    if (this.fadeLeft) this.fadeLeft--;
    if (this.approachLeft) this.approachLeft--;
    if (this.obstacleLeft) this.obstacleLeft--;
    if (this.warpLeft) this.warpLeft--;
    if (this.liftLeft) this.liftLeft--;
    if (this.buttonLeft) this.buttonLeft--;
    if (this.boatLeft) this.boatLeft--;
    const c = this.clock;
    if (c.phase === 'running') {
      if (c.left > 0) c.left--;
      if (c.left === 0) c.phase = c.message ? 'message' : 'done';
    }
  }
  player(): PlayerPosition {
    return { ...this.state.player };
  }
  applyMovement(target: number, movement: Id): void {
    this.calls.push(`applyMovement ${target} ${movement}`);
    this.moving.set(target, this.movementTicks);
  }
  movementDone(target: number | 'all'): boolean {
    return target === 'all' ? this.moving.size === 0 : !this.moving.has(target);
  }
  private log = (name: string) => (...args: unknown[]) => void this.calls.push([name, ...args].join(' '));
  lockAll = this.log('lockAll');
  releaseAll = this.log('releaseAll');
  lockObject = this.log('lockObject');
  releaseObject = this.log('releaseObject');
  forceBicycling = this.log('forceBicycling') as (on: boolean) => void;
  setPlayerHeightCalculation = this.log('setPlayerHeightCalculation') as (enabled: boolean) => void;
  setBgEventPosition = this.log('setBgEventPosition');
  initPlatformLift = this.log('initPlatformLift');
  /** platformLiftNotUsedWhenEntered's answer; a triggered ride takes `liftTicks` field steps. */
  liftNotUsed = true;
  liftTicks = 0;
  private liftLeft = 0;
  platformLiftNotUsedWhenEntered = () => this.liftNotUsed;
  triggerPlatformLift(): void {
    this.calls.push('triggerPlatformLift');
    this.liftLeft = this.liftTicks;
  }
  platformLiftDone = () => this.liftLeft === 0;
  initMapFeatures = this.log('initMapFeatures');
  distortionObject = this.log('distortionObject');
  resetDistortionCameraAngles = this.log('resetDistortionCameraAngles');
  giratinaShadowEvent = this.log('giratinaShadowEvent');
  setStoryScene = this.log('setStoryScene');
  objectPosition = (): [number, number, number] => [0, 0, 0];
  faceObject = this.log('faceObject');
  initContainmentUnits = this.log('initContainmentUnits');
  deactivateContainmentUnits = this.log('deactivateContainmentUnits');
  containmentUnitsDone = () => true;
  initSunyshoreGym = this.log('initSunyshoreGym');
  pressSunyshoreGymButton = this.log('pressSunyshoreGymButton');
  sunyshoreGymButtonDone = () => true;
  moveGreatMarshTram = this.log('moveGreatMarshTram');
  greatMarshTramDone = () => true;
  greatMarshLookout = this.log('greatMarshLookout');
  greatMarshLookoutDone = () => true;
  honeyTreeStops = 0;
  stopHoneyTreeShaking(): void {
    this.honeyTreeStops++;
  }
  /** advanceEternaGymClock's answer, and its task: field steps before the message (null = no message) and after it. */
  clockAdvances = true;
  clockPlan: { before: number; message: boolean; after: number } = { before: 0, message: false, after: 0 };
  private clock: { phase: 'running' | 'message' | 'done'; left: number; message: boolean; after: number } = { phase: 'done', left: 0, message: false, after: 0 };
  advanceEternaGymClock(): boolean {
    this.calls.push('advanceEternaGymClock');
    if (!this.clockAdvances) return false;
    this.clock = { phase: 'running', left: this.clockPlan.before, message: this.clockPlan.message, after: this.clockPlan.after };
    return true;
  }
  eternaGymClock = () => this.clock.phase;
  eternaGymClockContinue(): void {
    this.calls.push('eternaGymClockContinue');
    if (this.clock.phase !== 'message') throw new Error('fake field: the clock is not at its message');
    this.clock = { phase: 'running', left: this.clock.after, message: false, after: 0 };
  }
  /** pressPastoriaGymButton's task: field steps until done. */
  buttonTicks = 0;
  private buttonLeft = 0;
  pressPastoriaGymButton(): void {
    this.calls.push('pressPastoriaGymButton');
    this.buttonLeft = this.buttonTicks;
  }
  pastoriaGymButtonDone = () => this.buttonLeft === 0;
  shakes: number[] = [];
  shakeCamera(x: number): void {
    this.shakes.push(x);
  }
  /** playBoatCutscene's trip: field steps until done. */
  boatTicks = 0;
  private boatLeft = 0;
  playBoatCutscene(travelDir: number, exit: string, zone: string, x: number, z: number): void {
    this.calls.push(`playBoatCutscene ${travelDir} ${exit} ${zone} ${x} ${z}`);
    this.boatLeft = this.boatTicks;
  }
  boatCutsceneDone = () => this.boatLeft === 0;
  /** trainerPostBattleMovement's answer. */
  featureMovesTrainers = false;
  trainerPostBattleMovement(localId: number): boolean {
    this.calls.push(`trainerPostBattleMovement ${localId}`);
    return this.featureMovesTrainers;
  }
  turnPlayer = this.log('turnPlayer');
  setObjectVisible = this.log('setObjectVisible');
  setPlayerAvatar(avatar: 'heal'): void {
    this.calls.push(`setPlayerAvatar ${avatar}`);
  }
  setPlayerState(s: GameState['playerState']): void {
    this.calls.push(`setPlayerState ${s}`);
    this.state.playerState = s;
  }
  trainerApproach(localId: number): void {
    this.calls.push(`trainerApproach ${localId}`);
    this.approachLeft = this.approachTicks;
  }
  trainerApproachDone = () => this.approachLeft === 0;
  destroyObstacle(obstacle: number): void {
    this.calls.push(`destroyObstacle ${obstacle}`);
    this.obstacleLeft = this.obstacleTicks;
  }
  destroyObstacleDone = () => this.obstacleLeft === 0;
  setPositionLive = this.log('setPositionLive') as (localId: number, x: number, z: number, facing: Facing) => void;
  objectMoving = (): boolean => false;
  facePlayer = this.log('facePlayer');
  addObject = this.log('addObject');
  removeObject = this.log('removeObject');
  setObjectPosition = this.log('setObjectPosition');
  setObjectFacing = this.log('setObjectFacing') as (localId: number, facing: Facing) => void;
  setObjectMovementType = this.log('setObjectMovementType');
  switchMovementType = this.log('switchMovementType');
  setObjectPassThrough = this.log('setObjectPassThrough') as (localId: number, passThrough: boolean) => void;
  setObjectPersistent = this.log('setObjectPersistent');
  setWarpPosition = this.log('setWarpPosition');
  setWarpDestination = this.log('setWarpDestination') as (index: number, zone: Id) => void;
  warp(zone: Id, x: number, z: number, facing: Facing): void {
    this.calls.push(`warp ${zone} ${x} ${z} ${facing}`);
    this.warpLeft = this.fadeTicks;
  }
  warpDone = () => this.warpLeft === 0;
  fade(kind: 'in' | 'out', frames: number, color: 'black' | 'white'): void {
    this.calls.push(`fade ${kind} ${frames} ${color}`);
    this.fadeLeft = this.fadeTicks;
  }
  fadeDone = () => this.fadeLeft === 0;
  addFreeCamera = this.log('addFreeCamera');
  restoreCamera = this.log('restoreCamera');
  playDoor = this.log('playDoor');
  playPcAnimation = this.log('playPcAnimation');
  doorDone = () => true;
  setWeather(weather: Id): void {
    this.calls.push(`setWeather ${weather}`);
    this.state.weather = weather;
  }
  moveCamera = this.log('moveCamera');
  shakeObject = this.log('shakeObject');
  shakeObjectDone = () => true;
  elevator = this.log('elevator') as (direction: 'up' | 'down', loops: number) => void;
  elevatorDone = () => true;
  private cutInLeft = 0;
  hmCutIn = () => { this.cutInLeft = 59; };
  hmCutInDone = () => this.cutInLeft === 0;
  surf = this.log('surf');
  surfDone = () => true;
  waterfall = this.log('waterfall');
  waterfallDone = () => true;
  rockClimb = this.log('rockClimb');
  rockClimbDone = () => true;
  /** The battles started; the next one ends with `nextOutcome` (a won battle by default). */
  battles: BattleRequest[] = [];
  nextOutcome: BattleResult['outcome'] = 'won';
  private result: BattleResult | null = null;
  startBattle = (setup: BattleRequest) => {
    this.calls.push(`battle ${setup.kind}`);
    this.battles.push(setup);
    this.result = { outcome: this.nextOutcome, turns: 1, party: [], money: 0, bag: {}, caught: null, seen: [], levelled: [] };
  };
  battleDone = () => this.result;
  blackOut = () => void this.calls.push('blackOut');
  activateRoamer = (slot: number) => void this.calls.push(`activateRoamer ${slot}`);
  healAnimation = this.log('healAnimation') as (balls: number) => void;
  healAnimationDone = () => true;
  watering = 0;
  startWatering = () => void ((this.watering = 3), this.calls.push('startWatering'));
  wateringDone = () => --this.watering <= 0;
  endWatering = () => void this.calls.push('endWatering');
}

export class TestLog implements StubLog {
  keys = new Map<string, number>();
  stub(key: string): void {
    this.keys.set(key, (this.keys.get(key) ?? 0) + 1);
  }
}

/**
 * A sound system stand-in for VM tests: it records what plays, and a sound effect, fanfare or cry plays
 * for fixed tick counts (`TICKS`), counted by `tick()`. The game's real one is packages/game `SoundSystem`.
 */
export class FakeAudio implements AudioHost {
  static readonly TICKS = { se: 10, fanfare: 45, cry: 20 };
  readonly played: string[] = [];
  private left = { se: 0, fanfare: 0, cry: 0, fade: 0 };
  private bgm: Id | null = null;
  tick(): void {
    for (const k of ['se', 'fanfare', 'cry', 'fade'] as const) if (this.left[k] > 0) this.left[k]--;
  }
  playBgm(seq: Id | null) {
    this.played.push(`bgm ${seq}`);
    this.bgm = seq;
  }
  stopBgm() {
    this.played.push('stop bgm');
    this.bgm = null;
  }
  fadeOutBgm(volume: number, ticks: number) {
    this.played.push(`fade out ${volume} ${ticks}`);
    this.left.fade = ticks;
  }
  fadeInBgm(ticks: number) {
    this.played.push(`fade in ${ticks}`);
    this.left.fade = ticks;
  }
  fadeActive() {
    return this.left.fade > 0;
  }
  currentBgm() {
    return this.bgm;
  }
  fieldBgm() {
    return null;
  }
  effectiveBgm() {
    return null;
  }
  fadeToBgm(seq: Id | null) {
    this.played.push(`fade to ${seq}`);
    this.bgm = seq;
  }
  setSpecialBgm(seq: Id | null) {
    this.played.push(`special ${seq}`);
  }
  setBgmFixed() {}
  setBgmPaused() {}
  swapBgm(seq: Id) {
    this.played.push(`swap ${seq}`);
    this.bgm = seq;
  }
  playSe(seq: Id) {
    this.played.push(`se ${seq}`);
    this.left.se = FakeAudio.TICKS.se;
  }
  stopSe() {
    this.left.se = 0;
  }
  sePlaying() {
    return this.left.se > 0;
  }
  sequencePlaying() {
    return this.left.se > 0;
  }
  setPlayerVolume() {}
  playFanfare(seq: Id) {
    this.played.push(`fanfare ${seq}`);
    this.left.fanfare = FakeAudio.TICKS.fanfare;
  }
  waitFanfare() {
    return this.left.fanfare > 0;
  }
  setDualCry(_enabled: boolean): void {}
  setFieldVolume(volume: number): void {
    this.played.push(`field volume ${volume}`);
  }
  playCry(species: Id) {
    this.played.push(`cry ${species}`);
    this.left.cry = FakeAudio.TICKS.cry;
  }
  cryPlaying() {
    return this.left.cry > 0;
  }
}

/** Runs a VM against a fake field, one game tick at a time. */
export class Driver {
  readonly vm: ScriptRunner;
  readonly field: FakeField;
  readonly log = new TestLog();
  readonly battles: Omit<BattleLogEntry, 'tick'>[] = [];
  readonly audio = new FakeAudio();
  ticks = 0;
  /** Frames per character for field messages (the game's text speed option). */
  textSpeed: number = TEXT_SPEED.normal;
  /** The game clock the runner reads (`clock` dep); tests may replace it. */
  clock: ClockTime = { ...DEFAULT_CLOCK };
  constructor(
    readonly registries: Registries,
    labels: Labels,
    readonly state: GameState,
  ) {
    this.field = new FakeField(state);
    let seed = 7;
    this.vm = createScriptRunner({ registries, labels, state, field: () => this.field, rng: () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0), textSpeed: () => this.textSpeed, log: this.log, battleLog: (e) => void this.battles.push(e), clock: () => this.clock, audio: this.audio });
  }
  tick(input: Partial<InputFrame> = {}): void {
    this.vm.step({ held: input.held ?? [], pressed: input.pressed ?? [], touch: input.touch ?? null });
    this.field.step();
    this.audio.tick();
    this.ticks++;
  }
  press(button: Button): void {
    if (!BUTTONS.includes(button)) throw new Error(button);
    this.tick({ held: [button], pressed: [button] });
  }
  /** Idle ticks until `cond` holds (throws after `max`). Returns the number of ticks taken. */
  until(cond: () => boolean, max = 2000): number {
    for (let n = 0; n < max; n++) {
      if (cond()) return n;
      this.tick();
    }
    throw new Error(`condition not met after ${max} ticks; view=${JSON.stringify(this.vm.view())}`);
  }
  /** Waits until the message box waits for input, checks its text, and presses A. */
  readMessage(expected: string | RegExp): void {
    this.until(() => this.vm.view().message?.waitingForInput === true);
    const text = this.vm.view().message!.text;
    if (typeof expected === 'string' ? text !== expected : !expected.test(text)) throw new Error(`message "${text}" does not match ${expected}`);
    this.press('a');
  }
}
