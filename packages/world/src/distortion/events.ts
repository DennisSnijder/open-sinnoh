import { CascadeMount } from './surf.ts';
import type { DwCommand, Facing } from '@opensinnoh/contracts';
import type { Actor } from '../npc.ts';
import { TILE } from '../tiles.ts';
import type { DistortionWorld } from './feature.ts';
import { isRoom } from './elevator.ts';

/**
 * The Distortion World's native event commands (decomp overlay 9 sEventCmdHandlers, CallLoadedEventHandler): a
 * position event's list, or a waterfall's, runs as one field task. Each command is a generator: `yield` ends the
 * frame (EVENT_CMD_HANDLER_RES_CONTINUE); returning finishes the command and the next starts in the same frame.
 */
export type Task = Generator<void, void, void>;

const FX = 4096;
/** Decomp DIST_WORLD_PUZZLE_FLAG_* the tutorials set. */
const PUZZLE = { UXIE_TUTO: 10, AZELF_TUTO: 11, MESPRIT_TUTO: 12, UXIE_IN_B6F: 13, AZELF_IN_B6F: 14, MESPRIT_IN_B6F: 15 } as const;
/** DIST_WORLD_MAP_OBJECT_* local ids the commands add. */
const OBJ = { B5F_UXIE: 131, B5F_AZELF: 132, B5F_MESPRIT: 133, B6F_MESPRIT: 131, B6F_UXIE: 132, B6F_AZELF: 133, GIRATINA: 128 } as const;
/** DIST_WORLD_PLATFORM_FLAG_B5F_1. */
const PLATFORM_B5F_1 = 7;

/** Runs a command list (RunEventCommands). */
export function* runCommands(w: DistortionWorld, commands: readonly DwCommand[]): Task {
  for (const c of commands) yield* command(w, c);
}

function* command(w: DistortionWorld, c: DwCommand): Task {
  switch (c.kind) {
    case 'set-map-object-animation':
      return yield* setAnimation(w, c.localId, c.action);
    case 'move-platform':
      return yield* movePlatform(w, c);
    case 'add-map-object':
      w.addObject(c.zone, c.localId, true);
      return;
    case 'delete-map-object': {
      const a = w.h.objectById(c.localId);
      if (!a) throw new Error(`world: Distortion World event deletes object ${c.localId}, which is not present`);
      w.h.deleteObject(a);
      return;
    }
    case 'start-script':
      // ScriptManager_Start on the event's task: the task waits for the script, then finishes the command.
      w.h.startScript(c.label);
      yield;
      while (w.h.scriptRunning()) yield;
      return;
    case 'set-progress':
      w.setProgress(c.progress);
      return;
    case 'set-giratina-animation-flag':
      w.setFlag(`FLAG_DISTORTION_WORLD_GIRATINA_SHADOW_${c.animation + 1}`);
      return;
    case 'set-puzzle-flag':
      w.slot.puzzleFlags |= 1 << c.flag;
      return;
    case 'clear-puzzle-flag':
      w.slot.puzzleFlags &= ~(1 << c.flag);
      return;
    case 'show-giratina-shadow':
      w.startShadow(c);
      yield;
      while (!w.shadowDone()) yield;
      w.endShadow();
      return;
    case 'cascade-down':
    case 'cascade-up':
      return yield* cascade(w, c);
    case 'play-giratina-arrival':
      return yield* giratinaArrival(w);
    case 'show-uxie-boulder-tutorial':
      return yield* uxieTutorial(w);
    case 'show-azelf-boulder-tutorial':
      return yield* azelfTutorial(w);
    case 'show-mesprit-boulder-tutorial':
      return yield* mespritTutorial(w);
    case 'show-giratina-room-platforms':
      return yield* giratinaRoomPlatforms(w, true);
    case 'hide-giratina-room-platforms':
      return yield* giratinaRoomPlatforms(w, false);
  }
}

/** EventCmdSetMapObjectAnimation: once the object can take an action, it runs `action`; the command waits for its end. */
function* setAnimation(w: DistortionWorld, localId: number, action: string): Task {
  const a = w.h.objectById(localId);
  if (!a) throw new Error(`world: Distortion World event animates object ${localId}, which is not present`);
  yield;
  while (moving(a)) yield;
  w.h.applySteps(a, [{ op: action, count: 1 }]);
  yield;
  while (scripted(a)) yield;
}

/** LocalMapObj_IsAnimationSet's opposite: the object moves or has an action list. */
const moving = (a: Actor) => a.motion !== null || a.script !== null;
/** An action list (or its last action) still runs. */
const scripted = (a: Actor) => a.script !== null || a.motion?.source === 'script';

/** A movement list on an object (MapObject_StartAnimation), waited for. */
function* animate(w: DistortionWorld, a: Actor, steps: [string, number][]): Task {
  w.h.applySteps(a, steps.map(([op, count]) => ({ op, count })));
  while (scripted(a)) yield;
}

/**
 * EventCmdMovePlatform: the platform shakes (3 units, shrinking), then moves by `finalOffset` tiles `step` fx32 a
 * frame, carrying the player when `movePlayer`; the player then stands on the tiles moved and takes the support
 * there (FindAndPrepareNewCurrentFloatingPlatform), its height calculated on the land only.
 */
function* movePlatform(w: DistortionWorld, c: Extract<DwCommand, { kind: 'move-platform' }>): Task {
  const offset = w.platformOffset(c.platform);
  const p = w.h.hero();
  const final = [c.finalOffset.x, c.finalOffset.y, c.finalOffset.z].map((v) => v * TILE * FX);
  const delta = [c.step.x, c.step.y, c.step.z];
  const cur = [0, 0, 0];
  const platformY = offset[1]!;
  const playerY = p.offset[1];
  if (c.movePlayer) w.h.setHeightCalculation(false);
  w.h.sound.playNamed('SEQ_SE_PL_FW089B');
  yield;
  // EventCmdMovePlatform_Vibrate.
  let vibration = 3 * FX;
  let vibrated = 0;
  for (;;) {
    offset[1] = platformY + vibration;
    if (c.movePlayer) p.offset[1] = playerY + vibration / FX;
    vibration = -vibration;
    if (vibration >= 0) {
      if (vibration > FX) vibration -= FX;
      else if (++vibrated >= 4) vibration = 0;
      if (vibration === 0) {
        offset[1] = platformY;
        if (c.movePlayer) p.offset[1] = playerY;
        yield;
        break;
      }
    }
    yield;
  }
  // EventCmdMovePlatform_Move.
  const y0 = p.y;
  for (;;) {
    for (let i = 0; i < 3; i++) {
      if (cur[i] === final[i]) continue;
      cur[i]! += delta[i]!;
      offset[i]! += delta[i]!;
    }
    if (c.movePlayer) {
      p.offset[0] = cur[0]! / FX;
      p.offset[2] = cur[2]! / FX;
      p.y = y0 + cur[1]! / FX;
    }
    yield;
    if (cur.every((v, i) => v === final[i])) break;
  }
  // EventCmdMovePlatform_EndMovement.
  if (c.movePlayer) {
    p.offset[0] = p.offset[2] = 0;
    p.x += c.finalOffset.x;
    p.z += c.finalOffset.z;
    p.y = y0 + c.finalOffset.y * TILE;
    w.relocate();
  }
  w.h.sound.stopNamed('SEQ_SE_PL_FW089B');
}

/**
 * EventCmdCascadeDown / EventCmdCascadeUp: the player
 * turns onto the falling water at half speed, rides it (the floor changes at `mapLoadOffset`), turns back as the
 * last tile nears, lands on `finishingFix` tiles from where it started and rides away. The camera follows the
 * cascade's own angles; the sprite turns with the rotator.
 */
function* cascade(w: DistortionWorld, c: Extract<DwCommand, { kind: 'cascade-down' | 'cascade-up' }>): Task {
  const down = c.kind === 'cascade-down';
  const mount = w.cascadeMount = new CascadeMount(down);
  const p = w.h.hero();
  const start = { x: p.x, y: p.y, z: p.z };
  const final = [c.finalOffset.x, c.finalOffset.y, c.finalOffset.z].map((v) => v * FX);
  const mapLoad = [c.mapLoadOffset.x, c.mapLoadOffset.y, c.mapLoadOffset.z].map((v) => v * TILE * FX);
  const delta = [c.step.x >> 1, c.step.y >> 1, c.step.z >> 1];
  const cur = [0, 0, 0];
  let loaded = false;
  let cameraState = 0;
  let cameraDelay = 0;
  const bob = { on: false, value: 0, delta: 0, max: 0 };
  p.facing = down ? 'left' : 'right';
  p.offset[1] = 0;
  w.rotate(down ? 90 : -90, down ? 32 : 4);
  w.h.sound.playNamed('SEQ_SE_PL_FW463');
  /** CmdRunDataCascadeBase_Update: 'load', 'final', 'finishing' or null. */
  const update = (): 'load' | 'final' | 'finishing' | null => {
    for (let i = 0; i < 3; i++) if (cur[i] !== final[i]) cur[i]! += delta[i]!;
    if (bob.on) {
      bob.value += bob.delta;
      if (bob.value >= bob.max) {
        bob.value = bob.max;
        bob.delta = -bob.delta;
      } else if (bob.value <= FX) {
        bob.value = FX;
        bob.delta = -bob.delta;
      }
    }
    if (!loaded) {
      if (cur.every((v, i) => v === mapLoad[i])) {
        w.changeFloor(down ? 'down' : 'up', null);
        loaded = true;
      }
      return 'load';
    }
    if (cur.every((v, i) => v === final[i])) return 'final';
    const axis = c.axis === 0 ? 0 : c.axis === 1 ? 1 : 2;
    return Math.abs(final[axis]! - cur[axis]!) - 16 * FX === 0 ? 'finishing' : null;
  };
  const place = () => {
    p.offset[0] = cur[0]! / FX;
    p.offset[2] = cur[2]! / FX;
    p.y = start.y + cur[1]! / FX;
    // The bob is the sprite's jump offset on x (MapObject_SetSpriteJumpOffset): drawn only.
    if (bob.on) p.offset[0] += bob.value / FX;
  };
  /** UpdateCascadeDownCamera / UpdateCascadeUpCamera by the height ridden (whole tiles). */
  const camera = () => {
    const y = Math.trunc(Math.trunc(cur[1]! / 16) / FX);
    if (down) {
      if (cameraState === 0 && y === -20) {
        w.cameraTransition([245, 239, 0], 72);
        w.rotate(-32, 72);
        cameraState = 1;
      } else if (cameraState === 1 && y === -36) {
        p.facing = 'left';
        w.cameraTransition([0, 0, 0], 32);
        w.rotate(32, 31);
        cameraState = 2;
      }
      if (cameraState === 1 && cameraDelay >= 0 && ++cameraDelay >= 32) {
        p.facing = 'up';
        cameraDelay = -1;
      }
    } else if (cameraState === 0 && y === 20) {
      w.cameraTransition([55, 240, 0], 16);
      cameraState = 1;
    }
  };
  yield;
  // Rotate onto the water at half speed.
  for (let left = down ? 32 : 4; left > 0; left--) {
    update();
    place();
    camera();
    mount.turnIn();
    yield;
  }
  for (let i = 0; i < 3; i++) delta[i]! <<= 1;
  Object.assign(bob, { on: true, value: FX, delta: down ? 1024 : 512, max: 4 * FX });
  // Ride the water.
  for (;;) {
    const r = update();
    place();
    camera();
    mount.ride(cameraState, bob.value / FX);
    if (r === 'final') throw new Error('world: a cascade reached its end before its finishing tile');
    yield;
    if (r === 'finishing') break;
  }
  w.rotate(down ? 90 : -90, down ? 16 : 2);
  // Turn back as the last tile nears; land.
  for (;;) {
    const r = update();
    place();
    camera();
    mount.turnOut(bob.value / FX);
    if (r === 'final') break;
    yield;
  }
  p.offset[0] = p.offset[2] = 0;
  p.offset[1] = 0;
  p.x = start.x + c.finishingFix.x;
  p.z = start.z + c.finishingFix.z;
  p.y = (Math.trunc(start.y / 8) + c.finishingFix.y * 2) * 8;
  p.facing = down ? 'left' : 'right';
  w.relocate(down ? 'land' : 'ceiling');
  w.cascadeMount = null;
  w.h.sound.stopNamed('SEQ_SE_PL_FW463');
  if (down) {
    w.slot.platformFlags |= 1 << PLATFORM_B5F_1;
    w.addPlatformOf('B5F', 0);
  }
  yield;
  // Ride away (walks on the land; the ceiling's faster steps after the climb).
  yield* animate(w, p, down ? [['walk_slow_west', 1], ['walk_slower_west', 1]] : [['151', 1], ['147', 1], ['115', 1]]);
}

/**
 * EventCmdPlayGiratinaArrival: Giratina's object is added 160 units up and descends (1 unit a frame, then 0.5) while the
 * sky darkens to its last level; its black RGB555 palette blend then falls from 16 to 0, 30 frames more.
 */
function* giratinaArrival(w: DistortionWorld): Task {
  const g = w.addObject(w.room.id, OBJ.GIRATINA, true);
  if (!g) throw new Error('world: Giratina did not appear for her arrival');
  let lift = 10 * 16 * FX;
  g.offset[1] = lift / FX;
  yield;
  g.paletteDarkness = 16;
  let sky = 0;
  w.sky.fixedDarkness = 0;
  w.sky.kind = 'giratina-room-dark';
  w.h.sound.playNamed('SEQ_SE_PL_GIRA');
  const target = 12 * FX;
  for (;;) {
    sky = Math.min(target, sky + Math.trunc((FX * 8) / 90));
    w.sky.fixedDarkness = Math.trunc(sky / FX);
    lift -= lift >= 16 * FX ? 0x1000 : 0x800;
    const done = lift < 0 && sky >= target;
    if (done) lift = 0;
    g.offset[1] = lift / FX;
    yield;
    if (done) break;
  }
  let darkness = 16 * FX;
  const step = Math.trunc((FX * 16) / 90);
  while (darkness >= 0) {
    darkness -= step;
    g.paletteDarkness = Math.trunc(Math.max(0, darkness) / FX);
    yield;
  }
  for (let i = 0; i < 30; i++) yield;
  delete g.paletteDarkness;
}

/** A lake guardian's sprite rises from its object (2 units a frame, 4 below the last tile) to `tiles` up. */
function* ascend(a: Actor, tiles: number): Task {
  let y = 0;
  for (;;) {
    y += Math.trunc(Math.trunc(y / 16) / FX) < tiles - 1 ? 4 * FX : 2 * FX;
    a.offset[1] = y / FX;
    if (Math.trunc(Math.trunc(y / 16) / FX) >= tiles) return;
    yield;
  }
}

/** It sinks back (accelerating by 0x200 to 2 units a frame), then moves to B6F: the tutorial seen, the guardian waiting there. */
function* descendToB6F(w: DistortionWorld, a: Actor, tuto: number, inB6F: number, b6f: number): Task {
  let y = Math.round(a.offset[1] * FX);
  let speed = 0;
  for (;;) {
    if (speed < 2 * FX) speed += 0x200;
    y -= speed;
    a.offset[1] = y / FX;
    if (Math.trunc(Math.trunc(y / 16) / FX) <= 0) break;
    yield;
  }
  w.h.deleteObject(a);
  w.slot.puzzleFlags |= (1 << tuto) | (1 << inB6F);
  w.addObject(w.zoneOf('B6F'), b6f, true);
}

function* uxieTutorial(w: DistortionWorld): Task {
  const a = w.addObject(w.zoneOf('B5F'), OBJ.B5F_UXIE, true)!;
  w.h.sound.cry('SPECIES_UXIE');
  yield;
  yield* ascend(a, 17);
  yield;
  let z = 0;
  for (;;) {
    z -= FX;
    a.offset[2] = z / FX;
    if (Math.trunc(Math.trunc(z / 16) / FX) <= -2) break;
    yield;
  }
  yield;
  const base = Math.round(a.offset[1] * FX);
  const hover = [0, 2048, 4096, 8192, 16384, 24576, 28672, 32768];
  let step = 0;
  let delta = 1;
  let repeat = 0;
  for (;;) {
    a.offset[1] = (base + hover[step >> 1]!) / FX;
    step += delta;
    if (step >= hover.length * 2 - 1 || step <= 0) {
      delta = -delta;
      if (step === 0 && ++repeat >= 3) {
        a.offset[1] = base / FX;
        yield;
        break;
      }
    }
    yield;
  }
  for (;;) {
    z += FX;
    a.offset[2] = z / FX;
    if (Math.trunc(Math.trunc(z / 16) / FX) === 1) break;
    yield;
  }
  yield;
  yield* descendToB6F(w, a, PUZZLE.UXIE_TUTO, PUZZLE.UXIE_IN_B6F, OBJ.B6F_UXIE);
}

function* azelfTutorial(w: DistortionWorld): Task {
  const a = w.addObject(w.zoneOf('B5F'), OBJ.B5F_AZELF, true)!;
  w.h.sound.cry('SPECIES_AZELF');
  yield;
  yield* ascend(a, 13);
  yield* animate(w, a, [['delay_32', 1], ['walk_slower_east', 1], ['walk_slower_east', 1], ['walk_slow_west', 1], ['walk_slower_west', 1], ['delay_16', 1]]);
  yield* descendToB6F(w, a, PUZZLE.AZELF_TUTO, PUZZLE.AZELF_IN_B6F, OBJ.B6F_AZELF);
}

function* mespritTutorial(w: DistortionWorld): Task {
  const a = w.addObject(w.zoneOf('B5F'), OBJ.B5F_MESPRIT, true)!;
  w.h.sound.cry('SPECIES_MESPRIT');
  yield;
  yield* ascend(a, 9);
  const top = w.h.hero().z === 67;
  const circle: [string, number][] = [['walk_fast_east', 2], ['walk_fast_south', 2], ['walk_fast_west', 2], ['walk_fast_north', 2], ['walk_fast_east', 2], ['walk_fast_south', 2], ['walk_fast_west', 2]];
  const guardian: [string, number][] = [['delay_32', 1], ['walk_normal_east', 2], ['walk_fast_north', top ? 2 : 1], ...circle, ...(top ? [] : ([['walk_fast_north', 1]] as [string, number][])), ['walk_fast_west', 2], ['walk_normal_west', 1], ['walk_slow_west', 1], ['delay_32', 1], ['walk_slow_east', 2], ['walk_slower_east', 1], ['delay_16', 1]];
  const turns: Facing[] = ['left', 'up', 'right', 'down', 'left', 'up', 'right', 'down', 'left'];
  const face = (f: Facing) => `face_${{ up: 'north', down: 'south', left: 'west', right: 'east' }[f]}`;
  const player: [string, number][] = [['delay_32', 1], ['delay_8', 2], ...turns.flatMap((f, i) => (i < turns.length - 1 ? [[face(f), 1], ['delay_1', 3]] : [[face(f), 1]]) as [string, number][])];
  const p = w.h.hero();
  w.h.applySteps(a, guardian.map(([op, count]) => ({ op, count })));
  w.h.applySteps(p, player.map(([op, count]) => ({ op, count })));
  while (scripted(a) || scripted(p)) yield;
  yield* descendToB6F(w, a, PUZZLE.MESPRIT_TUTO, PUZZLE.MESPRIT_IN_B6F, OBJ.B6F_MESPRIT);
}

/**
 * EventCmdShowGiratinaRoomPlatforms / Hide: ghost groups 1–3 shown one by one (the camera tilting first, 36 then 48
 * frames apart), or hidden from 3 down (16 then 48 frames apart, 8 more).
 */
function* giratinaRoomPlatforms(w: DistortionWorld, show: boolean): Task {
  if (show) {
    w.cameraTransition([0x10, 0, 0], 0x14);
    let delay = 36;
    for (let group = 1; group <= 3; ) {
      if (--delay <= 0) {
        delay = 48;
        w.h.sound.stopNamed('SEQ_SE_PL_SYUWA3');
        w.ghostGroup(group++, true);
        if (group > 3) return;
      }
      yield;
    }
    return;
  }
  let delay = 16;
  for (let group = 3; ; ) {
    if (--delay <= 0) {
      if (group >= 1) {
        delay = 48;
        w.h.sound.stopNamed('SEQ_SE_PL_SYUWA3');
        w.ghostGroup(group--, false);
      } else break;
    }
    yield;
  }
  for (delay = 8; --delay > 0; ) yield;
}

/** sMapEventB4F_Waterfall / sMapEventB5F_Waterfall start where DistWorld_HandlePlayerMoved finds the waterfall. */
export const WATERFALLS = [
  { room: 'B4F', x: 104, y: 170, z: [76, 79], list: 'cascadeDown' },
  { room: 'B5F', x: 104, y: 128, z: [76, 79], list: 'cascadeUp' },
] as const;

export { isRoom };
