/**
 * Small stand-ins for the World and the VM, only for packages/game's tests. They follow the
 * contracts closely enough to drive the fixture replays: 8 ticks per tile, turning by walking into a
 * blocked tile, A on a later tick to advance a message page, d-pad + A in yes/no and choice panels.
 * They are not the engine; real timings come from the world and the VM.
 */
import { LOCALID_PLAYER, setupPokemon, type CreateScriptRunner, type CreateWorld, type Facing, type GameState, type InputFrame, type Labels, type ObjectState, type Registries, type ScriptRunner, type ScriptStart, type ScriptView, type World, type Zone } from '@opensinnoh/contracts';
import type { Arg, Command, Id } from '@opensinnoh/core';

const STEP_TICKS = 8;
const DELTA: Record<Facing, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const DIRS: Facing[] = ['up', 'down', 'left', 'right'];
const COMPASS: Record<string, Facing> = { north: 'up', south: 'down', west: 'left', east: 'right' };

const flagValue = (r: Registries, s: GameState, id: Id) => s.flags[id] ?? r.flags.get(id)!.initial;
const varValue = (r: Registries, s: GameState, id: Id) => s.vars[id] ?? r.vars.get(id)!.initial;

interface Mover {
  steps: { op: string; ticks: number }[];
}

export const createFakeWorld: CreateWorld = ({ registries, state, scripts }) => {
  let step: { dir: Facing; progress: number } | null = null;
  let warp: { ticks: number; zone: Id; x: number; z: number; facing: Facing } | null = null;
  let arrived = false;
  const movers = new Map<number, Mover>();
  const zone = (): Zone => registries.zones.get(state.player.zone)!;

  const tile = (x: number, z: number): number => {
    const m = registries.matrices.get(zone().matrix)!;
    const cx = Math.floor(x / 32);
    const cz = Math.floor(z / 32);
    if (x < 0 || z < 0 || cx >= m.width || cz >= m.height) return 0x8000;
    const chunk = m.chunks[cx + cz * m.width];
    return chunk ? registries.chunks.get(chunk)!.tiles[(x % 32) + (z % 32) * 32]! : 0x8000;
  };
  const objectAt = (x: number, z: number) => state.objects.find((o) => o.x === x && o.z === z);
  const front = () => {
    const [dx, dz] = DELTA[state.player.facing];
    return [state.player.x + dx, state.player.z + dz] as const;
  };
  const target = (localId: number): { x: number; z: number; facing: Facing } => {
    if (localId === LOCALID_PLAYER) return state.player;
    const o = state.objects.find((x) => x.localId === localId);
    if (!o) throw new Error(`fake world: no object ${localId}`);
    return o;
  };

  const loadMap = () => {
    for (const id of Object.keys(state.flags) as Id[]) if (registries.flags.get(id)!.scope === 'map') delete state.flags[id];
    for (const id of Object.keys(state.vars) as Id[]) if (registries.vars.get(id)!.scope === 'map') delete state.vars[id];
    const z = zone();
    if (z.mapScripts.onTransition) scripts.runImmediate({ label: z.mapScripts.onTransition, zone: z.id, source: 'transition' });
    state.objects = z.events.objects
      .filter((o) => !(o.hideFlag && flagValue(registries, state, o.hideFlag)))
      .map((o): ObjectState => ({ zone: z.id, localId: o.localId, x: o.x, z: o.z, y: o.y, facing: o.facing, movementType: o.movementType }));
    if (z.mapScripts.onLoad) scripts.runImmediate({ label: z.mapScripts.onLoad, zone: z.id, source: 'load' });
  };

  const startWarp = (toZone: Id, toWarp: number) => {
    const w = registries.zones.get(toZone)!.events.warps[toWarp]!;
    world.warp(toZone, w.x, w.z, 'down');
  };

  const world: World = {
    hmCutIn() {},
    hmCutInDone: () => true,
    player: () => ({ ...state.player }),
    applyMovement(localId, movement) {
      target(localId);
      const steps = registries.movements.get(movement)!.steps.flatMap((s) => Array.from({ length: s.count }, () => ({ op: s.op, ticks: s.op.startsWith('walk_') ? STEP_TICKS : 1 })));
      movers.set(localId, { steps });
    },
    movementDone: (t) => (t === 'all' ? movers.size === 0 : !movers.has(t)),
    lockAll() {},
    releaseAll() {},
    lockObject() {},
    setObjectVisible() {},
    setPlayerState(s) {
      state.playerState = s;
    },
    setPlayerAvatar() {},
    cameraFlash() {},
    trainerApproach() {
      throw new Error('fake world: trainerApproach not implemented');
    },
    trainerApproachDone: () => true,
    destroyObstacle() {},
    destroyObstacleDone: () => true,
    turnPlayer() {},
    objectMoving: () => false,
    view: () => ({ zone: state.player.zone, matrix: 'fake:MATRIX', area: 'fake:AREA', loads: 0, actors: [], camera: { cur: [0, 0, 0], prev: [0, 0, 0] }, weather: state.weather, darkness: null, effects: [], cameraOffset: [0, 0, 0], clock: { seconds: 12 * 3600, period: 'day' }, previews: [] }),
    facePlayer(localId) {
      const o = target(localId);
      const opposite: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'right', right: 'left' };
      o.facing = opposite[state.player.facing];
    },
    addObject() {},
    removeObject(localId) {
      state.objects = state.objects.filter((o) => o.localId !== localId);
    },
    setObjectPosition(localId, x, z) {
      Object.assign(target(localId), { x, z });
    },
    setObjectFacing(localId, facing) {
      target(localId).facing = facing;
    },
    setObjectMovementType() {},
    switchMovementType() {},
    setObjectPassThrough() {},
    setObjectPersistent() {},
    setPositionLive() {
      throw new Error('fake world: setPositionLive not implemented');
    },
    setWarpPosition() {},
    setWarpDestination() {},
    warp(zoneId, x, z, facing) {
      warp = { ticks: 16, zone: zoneId, x, z, facing };
    },
    warpDone: () => warp === null,
    fade() {},
    fadeDone: () => true,
    addFreeCamera() {},
    restoreCamera() {},
    playDoor() {},
    playPcAnimation() {},
    doorDone: () => true,
    setWeather(weather) {
      state.weather = weather;
    },
    moveCamera() {},
    shakeObject() {},
    shakeObjectDone: () => true,
    elevator() {},
    elevatorDone: () => true,
    surf() {},
    surfDone: () => true,
    waterfall() {},
    waterfallDone: () => true,
    rockClimb() {},
    rockClimbDone: () => true,
    startBattle: () => {
      throw new Error('fake world: no battles');
    },
    battleDone: () => null,
    blackOut: () => {
      throw new Error('fake world: no battles');
    },
    activateRoamer: () => {
      throw new Error('fake world: no roamers');
    },
    healAnimation() {},
    healAnimationDone: () => true,
    startWatering() {},
    wateringDone: () => true,
    endWatering() {},
    releaseObject() {},
    forceBicycling() {},
    setPlayerHeightCalculation() {},
    setBgEventPosition() {},
    initPlatformLift() {
      throw new Error('fake world: no platform lifts');
    },
    platformLiftNotUsedWhenEntered: () => true,
    triggerPlatformLift() {
      throw new Error('fake world: no platform lifts');
    },
    platformLiftDone: () => true,
    setStoryScene() {},
    objectPosition: () => [0, 0, 0],
    faceObject() {},
    initContainmentUnits() {},
    deactivateContainmentUnits() {},
    containmentUnitsDone: () => true,
    initSunyshoreGym() {},
    pressSunyshoreGymButton() {},
    sunyshoreGymButtonDone: () => true,
    moveGreatMarshTram() {
      throw new Error('fake world: no Great Marsh');
    },
    greatMarshTramDone: () => true,
    greatMarshLookout() {
      throw new Error('fake world: no Great Marsh');
    },
    greatMarshLookoutDone: () => true,
    vistaBinoculars() {
      throw new Error('fake world: no Vista Lighthouse');
    },
    vistaBinocularsDone: () => true,
    startVsSeeker() {
      throw new Error('fake world: no Vs. Seeker task');
    },
    vsSeekerResult: () => null,
    lookoutView: () => null,
    initMapFeatures() {
      throw new Error('fake world: no map features');
    },
    fieldReturned() {},
    weatherTick() {},
    continued() {},
    distortionObject() {
      throw new Error('fake world: no Distortion World');
    },
    resetDistortionCameraAngles() {
      throw new Error('fake world: no Distortion World');
    },
    giratinaShadowEvent() {
      throw new Error('fake world: no Distortion World');
    },
    advanceEternaGymClock() {
      throw new Error('fake world: no map features');
    },
    eternaGymClock: () => 'done' as const,
    eternaGymClockContinue() {
      throw new Error('fake world: no map features');
    },
    pressPastoriaGymButton() {
      throw new Error('fake world: no map features');
    },
    pastoriaGymButtonDone: () => true,
    playBoatCutscene() {
      throw new Error('fake world: no boat');
    },
    boatCutsceneDone: () => true,
    shakeCamera() {},
    trainerPostBattleMovement: () => false,
    enter: loadMap,
    checkTriggers(input: InputFrame) {
      if (!world.idle()) return;
      const z = zone();
      const row = z.mapScripts.onFrame.find((r) => varValue(registries, state, r.var) === r.value);
      if (row) return scripts.start({ label: row.label, zone: z.id, source: 'frame' });
      if (input.pressed.includes('a')) {
        const [fx, fz] = front();
        const o = objectAt(fx, fz);
        const event = o && z.events.objects.find((e) => e.localId === o.localId);
        if (event?.label) return scripts.start({ label: event.label, zone: z.id, lastTalked: o!.localId, source: 'object' });
        const bg = z.events.bgs.find((b) => b.x === fx && b.z === fz && (b.facing === 'any' || b.facing === state.player.facing));
        if (bg) return scripts.start({ label: bg.label, zone: z.id, source: 'bg' });
      }
      if (!arrived) return;
      arrived = false;
      const { x, z: pz } = state.player;
      const coord = z.events.coords.find((c) => x >= c.x && x < c.x + c.width && pz >= c.z && pz < c.z + c.length && varValue(registries, state, c.var) === c.value);
      if (coord) return scripts.start({ label: coord.label, zone: z.id, source: 'coord' });
      const w = z.events.warps.find((e) => e.x === x && e.z === pz);
      if (w) startWarp(w.toZone === 'dynamic' ? fail('dynamic warp') : w.toZone, w.toWarp);
    },
    step(input: InputFrame) {
      if (warp && --warp.ticks <= 0) {
        Object.assign(state.player, { zone: warp.zone, x: warp.x, z: warp.z, facing: warp.facing });
        warp = null;
        movers.clear();
        loadMap();
      }
      for (const [id, mover] of movers) {
        const t = target(id);
        const s = mover.steps[0]!;
        const m = /^(?:walk_normal|face)_(north|south|west|east)$/.exec(s.op);
        if (m) t.facing = COMPASS[m[1]!]!;
        if (--s.ticks > 0) continue;
        if (s.op.startsWith('walk_') && m) {
          const [dx, dz] = DELTA[t.facing];
          t.x += dx;
          t.z += dz;
        }
        mover.steps.shift();
        if (!mover.steps.length) movers.delete(id);
      }
      if (step && ++step.progress >= STEP_TICKS) {
        const [dx, dz] = DELTA[step.dir];
        state.player.x += dx;
        state.player.z += dz;
        step = null;
        const z = zone();
        const { x, z: pz } = state.player;
        arrived = z.events.coords.some((c) => x >= c.x && x < c.x + c.width && pz >= c.z && pz < c.z + c.length) || z.events.warps.some((w) => w.x === x && w.z === pz);
        if (arrived) return;
      }
      if (step || warp || scripts.running()) return;
      const dir = DIRS.find((d) => input.held.includes(d));
      if (!dir) return;
      state.player.facing = dir;
      const [fx, fz] = front();
      if (!(tile(fx, fz) & 0x8000) && !objectAt(fx, fz)) step = { dir, progress: 0 };
      else {
        // Exit mats: walking into a blocked warp tile warps.
        const w = zone().events.warps.find((e) => e.x === fx && e.z === fz);
        if (w) startWarp(w.toZone === 'dynamic' ? fail('dynamic warp') : w.toZone, w.toWarp);
      }
    },
    idle: () => !step && !warp && movers.size === 0,
    fadeState: () => null,
    fishingCheck: () => null,
    fish: () => {},
    bicycleCheck: () => null,
    fly(slot, dest) {
      throw new Error(`fake world: fly ${slot} ${JSON.stringify(dest)}`);
    },
    flyDone: () => true,
    flyScene: () => null,
    teleport(slot, dest, kind) {
      throw new Error(`fake world: ${kind ?? 'teleport'} ${slot} ${JSON.stringify(dest)}`);
    },
    teleportDone: () => true,
    pokeRadarCheck: () => null,
    pokeRadar() {},
    radarChain: () => null,
    radarPatches: () => null,
    sweetScent() {},
    stopHoneyTreeShaking() {},
    explorerKitCheck: () => 'generic',
    enterUnderground() {},
    exitUnderground() {},
    undergroundRequest: () => null,
    undergroundAppDone() {},
    undergroundAhead: () => null,
    undergroundMiningRand: () => null,
    undergroundDecoration: () => {
      throw new Error('fake world: no Underground');
    },
    undergroundTrapShadow: () => {
      throw new Error('fake world: no Underground');
    },
    undergroundTransition: () => null,
    undergroundPlace: () => null,
    undergroundView: () => null,
    talkToFollower: () => null,
    followerTalkPose: () => fail('follower talk'),
    followerBubble: () => fail('follower talk'),
  };
  return world;
};

type Wait = { kind: 'button' | 'page' | 'movement' | 'yesno' | 'choice'; since: number };

interface Thread {
  start: ScriptStart;
  commands: Command[];
  pc: number;
  cond: number;
  wait: Wait | null;
  pages: string[];
  temps: Map<Id, number>;
  chosen: number;
}

export const createFakeScriptRunner: CreateScriptRunner = ({ registries, labels, state, field, log }) => {
  let thread: Thread | null = null;
  let steps = 0;
  const view: ScriptView = { message: null, yesNo: null, menu: null, panel: { kind: 'idle', title: '' }, app: null };

  const commands = (label: Id) => {
    const l = (labels as Labels).get(label);
    if (!l) throw new Error(`fake vm: unknown label ${label}`);
    return l.commands;
  };
  const newThread = (start: ScriptStart): Thread => ({ start, commands: commands(start.label), pc: 0, cond: 0, wait: null, pages: [], temps: new Map(), chosen: 0 });
  const getVar = (t: Thread, id: Id) => (registries.vars.get(id)!.scope === 'temp' ? (t.temps.get(id) ?? 0) : varValue(registries, state, id));
  const setVar = (t: Thread, id: Id, v: number) => {
    const def = registries.vars.get(id)!;
    if (def.scope === 'temp') t.temps.set(id, v);
    else if (v === def.initial) delete state.vars[id];
    else state.vars[id] = v;
  };
  const value = (t: Thread, a: Arg): number => (a.kind === 'int' ? a.value : a.kind === 'var' ? getVar(t, a.id) : NaN);
  const id = (a: Arg | undefined): Id => (a && 'id' in a ? a.id : (() => { throw new Error('fake vm: expected a ref arg'); })());
  const starters = () => [...registries.species.values()].filter((s) => s.starterSlot !== undefined).sort((a, b) => a.starterSlot! - b.starterSlot!);
  const byVarSource = (source: number) => [...registries.vars.values()].find((v) => v.sourceIndex === source)!.id;

  /** Runs until a wait or the end. Returns false when the thread ended. */
  const run = (t: Thread, immediate: boolean): boolean => {
    const wait = (kind: Wait['kind']) => {
      if (immediate) throw new Error(`fake vm: ${t.commands[t.pc - 1]!.op} cannot wait in runImmediate`);
      t.wait = { kind, since: steps };
    };
    while (t.pc < t.commands.length && !t.wait) {
      const c = t.commands[t.pc++]!;
      const a = c.args;
      switch (c.op) {
        case 'end':
          return false;
        case 'lock_all':
        case 'release_all':
        case 'buffer_player_name':
          break;
        case 'face_player':
          if (t.start.lastTalked !== undefined) field().facePlayer(t.start.lastTalked);
          break;
        case 'set_flag':
        case 'clear_flag': {
          const f = id(a[0]);
          const v = c.op === 'set_flag';
          if (v === registries.flags.get(f)!.initial) delete state.flags[f];
          else state.flags[f] = v;
          break;
        }
        case 'check_flag':
          t.cond = flagValue(registries, state, id(a[0])) ? 1 : 0;
          break;
        case 'set_var_from_value':
          setVar(t, id(a[0]), value(t, a[1]!));
          break;
        case 'add_var':
          setVar(t, id(a[0]), getVar(t, id(a[0])) + value(t, a[1]!));
          break;
        case 'compare_var_to_value':
          t.cond = getVar(t, id(a[0])) === value(t, a[1]!) ? 1 : 0;
          break;
        case 'go_to_if':
          if ((a[0] as { value: string }).value === 'eq' && t.cond) Object.assign(t, { commands: commands(id(a[1])), pc: 0 });
          break;
        case 'go_to':
          Object.assign(t, { commands: commands(id(a[0])), pc: 0 });
          break;
        case 'message':
          t.pages = registries.texts.get(id(a[0]))!.text.split(/\{clear\}|\{scroll\}/);
          view.message = { text: t.pages.shift()!, waitingForInput: false };
          if (t.pages.length) wait('page');
          break;
        case 'wait_button':
          view.message = view.message && { ...view.message, waitingForInput: true };
          wait('button');
          break;
        case 'close_message':
          view.message = null;
          break;
        case 'apply_movement':
          field().applyMovement(value(t, a[0]!), id(a[1]));
          break;
        case 'wait_movement':
          wait('movement');
          break;
        case 'show_yes_no_menu':
          view.yesNo = { yes: 'YES', no: 'NO', cursor: 0 };
          wait('yesno');
          break;
        case 'start_choose_starter_scene':
          view.panel = { kind: 'choice', title: 'Choose', options: starters().map((s) => ({ id: s.id, label: s.name })), cursor: 0 };
          wait('choice');
          break;
        case 'save_chosen_starter':
          setVar(t, byVarSource(0x4030), registries.species.get(starters()[t.chosen]!.id)!.sourceIndex!);
          break;
        case 'get_player_starter_species':
          setVar(t, id(a[0]), getVar(t, byVarSource(0x4030)));
          break;
        case 'give_pokemon': {
          const index = value(t, a[0]!);
          const species = [...registries.species.values()].find((s) => s.sourceIndex === index)!;
          state.party.push(setupPokemon(state, registries, state.party.length, species.id, value(t, a[1]!)));
          break;
        }
        default:
          log.stub(`fake-vm:${c.op}`);
      }
    }
    return t.pc < t.commands.length || t.wait !== null;
  };

  const resolve = (t: Thread, input: InputFrame): boolean => {
    const w = t.wait!;
    const fresh = steps > w.since;
    const a = fresh && input.pressed.includes('a');
    switch (w.kind) {
      case 'movement':
        return field().movementDone('all');
      case 'page':
        if (a) view.message = { text: t.pages.shift()!, waitingForInput: false };
        if (a && t.pages.length) w.since = steps;
        return a && !t.pages.length;
      case 'button':
        return a;
      case 'yesno': {
        const yn = view.yesNo!;
        if (input.pressed.includes('down')) yn.cursor = 1;
        if (input.pressed.includes('up')) yn.cursor = 0;
        if (!a) return false;
        setVar(t, id(t.commands[t.pc - 1]!.args[0]), yn.cursor);
        view.yesNo = null;
        return true;
      }
      case 'choice': {
        const p = view.panel as Extract<ScriptView['panel'], { kind: 'choice' }>;
        if (input.pressed.includes('right')) p.cursor = Math.min(p.options.length - 1, p.cursor + 1);
        if (input.pressed.includes('left')) p.cursor = Math.max(0, p.cursor - 1);
        if (!a) return false;
        t.chosen = p.cursor;
        view.panel = { kind: 'idle', title: '' };
        return true;
      }
    }
  };

  const runner: ScriptRunner = {
    start(start) {
      if (thread) throw new Error('fake vm: a script is already running');
      thread = newThread(start);
    },
    runImmediate(start) {
      run(newThread(start), true);
    },
    running: () => thread !== null,
    step(input) {
      steps++;
      if (!thread) return;
      if (thread.wait) {
        if (!resolve(thread, input)) return;
        thread.wait = null;
      }
      if (!run(thread, false)) thread = null;
    },
    view: () => view,
    takeStartMenuRequest: () => false,
    fieldReturn() {
      const zone = registries.zones.get(state.player.zone)!;
      if (zone.mapScripts.onLoad) runner.runImmediate({ label: zone.mapScripts.onLoad, zone: zone.id, source: 'load' });
      field().fieldReturned();
      if (zone.mapScripts.onResume) runner.runImmediate({ label: zone.mapScripts.onResume, zone: zone.id, source: 'resume' });
    },
    appDone: () => {},
    notice: () => {
      throw new Error('fake vm: no field messages');
    },
    ask: () => {
      throw new Error('fake vm: no field questions');
    },
  };
  return runner;
};

function fail(what: string): never {
  throw new Error(`fake world: ${what} not supported`);
}
