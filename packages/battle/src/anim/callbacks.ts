/**
 * Emitter callbacks (decomp battle_particle_util.c sEmitterCallbackTable, emitter_callbacks.c and
 * generic_emitter_callback*.c): run once as CreateEmitter makes the emitter. They place it at a battler's
 * particle position, aim its axis from attacker to defender, and set behaviour targets; the generic callback
 * (17) reads its modes from the SetExtraParams that follow the CreateEmitter in the script.
 * Battlers are ids; their types (solo in singles, slots in doubles) pick the tables' rows. In a contest (0.36.1) the
 * generic callback takes the decomp's contest branches: the contest spots and axes, the contest camera angle.
 */
import { degToIdx, s16, type Vec } from './fx.ts';
import { PIXEL, sideOf } from './tasks.ts';
import type { Emitter, ParticleManager } from './spl.ts';
import type { AnimVm } from './vm.ts';

/** SetPosBasedOnBattlers (DS px by attacker type, then defender type; the solo rows are 0, unset pairings 0). */
const POS_BY_BATTLERS: Record<number, Record<number, [number, number]>> = {
  2: { 3: [-16, 16], 5: [-16, 16] },
  3: { 2: [32, 0], 4: [32, 0] },
  4: { 3: [16, 0], 5: [4, 0] },
  5: { 2: [-16, 24], 4: [0, 24] },
};

/** BATTLE_3D_CENTER_*: (0, 1/1.28, 0). */
const CENTER: Vec = [0, 3200, 0];

export function createEmitterCallback(vm: AnimVm, ps: ParticleManager, e: Emitter, id: number): void {
  const atk = vm.attacker;
  const def = vm.defender;
  const setPos = (p: Vec) => {
    e.setPos(0, p[0]);
    e.setPos(1, p[1]);
    e.setPos(2, p[2]);
  };
  switch (id) {
    case 0:
    case 22:
      return;
    case 1:
      // SetPosToEnemy1: always enemy 1's position (the decomp's commented-out logic aside).
      setPos(vm.worldPos(1));
      return;
    case 2:
      // SetPosToPlayer1, the camera's up by the defender (BattleAnimUtil_GetUpVectorForBattler: player 1 or not).
      setPos(vm.worldPos(0));
      ps.camera.up = def === 0 ? [0, 4096, 0] : [0, -4096, 0];
      return;
    case 3:
    case 21:
      setPos(vm.worldPos(atk));
      return;
    case 4:
      setPos(vm.worldPos(def));
      return;
    case 5:
      axisAndPos(vm, ps, e, atk, def, 'none', 'origin');
      return;
    case 6:
      axisAndPos(vm, ps, e, def, atk, 'none', 'origin');
      return;
    case 7:
    case 8:
    case 9:
    case 10:
    case 11:
      axisAndPos(vm, ps, e, atk, def, 'convergence', (['sign', 'center', 'defender', 'attacker', 'explicit'] as const)[id - 7]!);
      return;
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
      axisAndPos(vm, ps, e, atk, def, 'magnet', (['sign', 'center', 'defender', 'attacker', 'explicit'] as const)[id - 12]!);
      return;
    case 17:
      generic(vm, ps, e);
      return;
    case 18: {
      // SetPosBasedOnBattlers: solo player and enemy rows are 0, 0.
      const [x, y] = POS_BY_BATTLERS[vm.typeOf(atk)]?.[vm.typeOf(def)] ?? [0, 0];
      setPos([x * PIXEL, y * PIXEL, 0]);
      return;
    }
    case 19:
    case 20:
      setPos(vm.worldPos(id === 19 ? atk : def));
      return;
    default:
      throw new Error(`battle anim: emitter callback ${id}`);
  }
}

/** BattleParticleUtil_SetEmitterAxisPosEx: seven axis vectors in the params (one per battler pairing), then a position. */
function axisAndPos(
  vm: AnimVm,
  ps: ParticleManager,
  e: Emitter,
  from: number,
  to: number,
  behaviour: 'none' | 'convergence' | 'magnet',
  target: 'origin' | 'sign' | 'center' | 'defender' | 'attacker' | 'explicit',
): void {
  void ps;
  // PlToEm, P1ToE1, P1ToE2, P1ToP2, P2ToE1, P2ToE2, P2ToP1; negated from the enemy's side.
  const [plToEm, p1e1, p1e2, p1p2, p2e1, p2e2, p2p1] = Array.from({ length: 7 }, () => vm.extraParams(3) as Vec) as [Vec, Vec, Vec, Vec, Vec, Vec, Vec];
  const neg = (v: Vec): Vec => [-v[0], -v[1], -v[2]];
  const ft = vm.typeOf(from);
  const tt = vm.typeOf(to);
  const byType: Record<number, Vec> = {
    1: neg(plToEm),
    2: tt === 3 ? p1e1 : tt === 5 ? p1e2 : p1p2,
    3: tt === 2 ? neg(p1e1) : tt === 5 ? neg(p1p2) : neg(p2e1),
    4: tt === 3 ? p2e1 : tt === 5 ? p2e2 : p2p1,
    5: tt === 3 ? neg(p2p1) : tt === 2 ? neg(p1e2) : neg(p2e2),
  };
  const dir: Vec = byType[ft] ?? plToEm;
  const sign = sideOf(from) === 'enemy' ? -1 : 1;
  const explicit = vm.extraParams(3) as Vec;
  const attackerPos = vm.worldPos(from);
  let pos: Vec;
  let sg = sign;
  if (explicit[0] === 0 && explicit[1] === 0 && explicit[2] === 0) pos = attackerPos;
  else {
    if (explicit[0] === CENTER[0] && explicit[1] === CENTER[1]) sg = 1;
    pos = [explicit[0] * sg, explicit[1] * sg, attackerPos[2] * sg];
  }
  e.setPos(0, pos[0]);
  e.setPos(1, pos[1]);
  e.setPos(2, pos[2]);
  if (behaviour !== 'none') {
    let t: Vec = [0, 0, 0];
    const res = e.res;
    if (target === 'sign') {
      const cur = behaviour === 'convergence' ? res.convergence?.target : res.magnet?.target;
      t = cur ? [cur[0] * sg, cur[1] * sg, cur[2] * sg] : [0, 0, 0];
    } else if (target === 'center') t = [CENTER[0] * sg, CENTER[1] * sg, CENTER[2] * sg];
    else if (target === 'defender') t = vm.worldPos(to);
    else if (target === 'attacker') t = vm.worldPos(from);
    else if (target === 'explicit') {
      const p = vm.extraParams(4);
      t = applySign(p[3]!, sg, [p[0]!, p[1]!, p[2]!]);
    }
    t = [t[0] - pos[0], t[1] - pos[1], t[2] - pos[2]];
    if (behaviour === 'convergence' && res.convergence) res.convergence.target = t;
    if (behaviour === 'magnet' && res.magnet) res.magnet.target = t;
  }
  e.axis = [s16(dir[0]), s16(dir[1]), s16(dir[2])];
}

/** BattleParticleUtil_ApplySignToVector (BATTLE_PTCL_SIGN_MODE_*: none, x, y, z, xy, xz, yz, xyz). */
function applySign(mode: number, sign: number, v: Vec): Vec {
  const axes = [[], [0], [1], [2], [0, 1], [0, 2], [1, 2], [0, 1, 2]][mode];
  if (!axes) throw new Error(`battle anim: particle sign mode ${mode}`);
  const out: Vec = [...v];
  for (const a of axes) out[a] = out[a]! * sign;
  return out;
}

/** The generic callback's params: priority, target, position, axis, behaviour flags, camera (EMITTER_*). */
function generic(vm: AnimVm, ps: ParticleManager, e: Emitter): void {
  const [prio, targetMode, posMode, axisMode, bhv, camera] = vm.extraParams(6) as [number, number, number, number, number, number];
  const reverse = targetMode === 1 || targetMode === 3;
  const start = reverse ? vm.defender : vm.attacker;
  const end = reverse ? vm.attacker : vm.defender;
  const dirOf = (b: number) => (sideOf(b) === 'enemy' ? -1 : 1);
  let position: Vec = [0, 0, 0];

  // Position (GenericEmitterCallback_ApplyPosition).
  if (posMode !== 0) {
    const offset = (pos: Vec): Vec => {
      const p = vm.extraParams(4);
      const d = p[0] === 1 ? 1 : dirOf(start);
      return [pos[0] + p[1]! * d, pos[1] + p[2]! * d, pos[2] + p[3]! * d];
    };
    const world = (b: number, kind: number) => vm.worldPos(b, kind);
    const kinds: Record<number, [number, number]> = {
      1: [start, 0],
      2: [end, 0],
      6: [start, 1],
      7: [end, 1],
      8: [start, 11],
      9: [end, 11],
      10: [start, 2],
      11: [end, 2],
      14: [start, 3],
      15: [end, 3],
      16: [start, 4],
      17: [end, 4],
      18: [start, 5],
      19: [end, 5],
      20: [start, 6],
      21: [end, 6],
      22: [start, 7],
      23: [end, 7],
      24: [start, 8],
      25: [end, 8],
      26: [start, 9],
      27: [end, 9],
      34: [start, 0],
    };
    const k = kinds[posMode];
    if (k) position = world(k[0], k[1]);
    else if (posMode === 3) {
      const p = vm.extraParams(4);
      const d = p[0] === 1 ? 1 : dirOf(start);
      position = [p[1]! * d, p[2]! * d, p[3]!];
    } else if (posMode === 4 || posMode === 5) position = offset(world(posMode === 4 ? start : end, 0));
    else if (posMode === 100 || posMode === 101) {
      // One offset per battler type (6); the battler's own applies.
      const b = posMode === 100 ? start : end;
      let mine: number[] = [];
      for (let type = 0; type < 6; type++) {
        const p = vm.extraParams(4);
        if (type === vm.typeOf(b)) mine = p;
      }
      const d = mine[0] === 1 ? 1 : dirOf(start);
      const w = world(b, 0);
      position = [w[0] + mine[1]! * d, w[1] + mine[2]! * d, w[2] + mine[3]! * d];
    } else if (posMode === 12 || posMode === 13) {
      // The attacker's or the defender's side: the solo battler type of that side (GetAttackerSidePosition).
      const side = sideOf(posMode === 12 ? vm.attacker : vm.defender);
      position = offset(vm.typePos(side === 'player' ? 0 : 1, 0));
    } else if (posMode === 31 || posMode === 30 || posMode === 32) {
      // Bubble, Baton Pass and Dragon Breath spots by the start battler's type (generic_emitter_callback.c); Baton
      // Pass and Dragon Breath have a contest spot (their row 6), Bubble none.
      const spots: Record<number, Vec[]> = {
        31: [fxv(-1.4063, -1.0625), fxv(2.3164, -0.4844), fxv(-2.871, 0.8008), fxv(3.3613, -0.3574), fxv(-1.3125, -0.6855), fxv(1.7051, 0.502)],
        30: [fxv(-2.6904, -0.8516), fxv(2.6562, 1.8691), fxv(-3.6768, -0.7715), fxv(3.662, 1.7676), fxv(-2.0078, -1.125), fxv(2.0566, 2.1719), fxv(3.662, -0.6719)],
        32: [fxv(-1.125, -1.0938), fxv(1.8613, 0.5488), fxv(-2.2031, -0.7368), fxv(3.1875, 0.6875), fxv(-0.5938, -1.1719), fxv(1.5156, 0.9375), fxv(1.7266, -0.8906)],
      };
      position = spots[posMode]![vm.contest && posMode !== 31 ? 6 : vm.typeOf(start)]!;
    } else if (posMode === 28) position = fxv(2.8047, 0);
    else if (posMode === 33) position = fxv(-1.2207, -1.4648);
    else throw new Error(`battle anim: generic emitter position mode ${posMode}`);
    e.setPos(0, position[0]);
    e.setPos(1, position[1]);
    e.setPos(2, position[2]);
  }

  // Axis (GenericEmitterCallback_ApplyAxis).
  if (axisMode !== 0) e.axis = vm.contest ? contestAxis(vm, axisMode, targetMode, start, end) : genericAxis(vm, axisMode, start, end);

  // Behaviours (GenericEmitterCallback_ApplyBehavior): one SetExtraParams of 5 per flag, in bit order.
  const res = e.res;
  for (let bit = 1; bit <= 13; bit++) {
    if (!((bhv >>> bit) & 1)) continue;
    if (![1, 4, 5, 6, 7, 12, 13].includes(bit)) continue;
    const [mode, flip, x, y, z] = vm.extraParams(5) as [number, number, number, number, number];
    const d = flip === 1 ? 1 : dirOf(start);
    if (bit === 1) {
      // Gravity: the default mode subtracts the emitter position from a zero vector (a decomp quirk), kept.
      let g: Vec = mode === 1 ? [x * d, y * d, z * d] : [0, 0, 0];
      if (mode !== 1) g = [-position[0], -position[1], -position[2]];
      if (res.gravity) res.gravity = [s16(g[0]), s16(g[1]), s16(g[2])];
    } else if (bit === 4) {
      let t: Vec = [0, 0, 0];
      if (mode === 0) t = res.magnet ? [res.magnet.target[0] * d, res.magnet.target[1] * d, res.magnet.target[2] * d] : [0, 0, 0];
      else if (mode === 1) t = [x * d, y * d, z * d];
      else if (mode === 2) t = vm.worldPos(start);
      else if (mode === 3) t = vm.worldPos(end);
      t = [t[0] - position[0], t[1] - position[1], t[2]];
      if (res.magnet) res.magnet.target = t;
    } else if (bit === 5) {
      const f = mode === 0 ? (res.magnet?.force ?? 0) * d : mode === 1 ? x * d : 0;
      if (res.magnet) res.magnet.force = s16(f);
    } else if (bit === 6) {
      const a = mode === 0 ? (res.spin?.angle ?? 0) * d : mode === 1 ? x * d : 0;
      if (res.spin) res.spin.angle = a & 0xffff;
    } else if (bit === 7) {
      const a = mode === 0 ? (res.spin?.axis ?? 0) : mode === 1 ? x : 0;
      if (res.spin) res.spin.axis = a & 0xffff;
    } else if (bit === 12) {
      let t: Vec = [0, 0, 0];
      if (mode === 0) t = res.convergence ? [res.convergence.target[0] * d, res.convergence.target[1] * d, res.convergence.target[2] * d] : [0, 0, 0];
      else if (mode === 1) t = [x * d, y * d, z * d];
      else if (mode === 4) {
        const w = vm.worldPos(end);
        t = [Math.trunc((w[0] * x) / y), Math.trunc((w[1] * x) / y), Math.trunc((w[2] * x) / y)];
      } else if (mode === 2) t = vm.worldPos(start);
      else if (mode === 3) t = vm.worldPos(end);
      t = [t[0] - position[0], t[1] - position[1], t[2] - position[2]];
      if (res.convergence) res.convergence.target = t;
    } else if (bit === 13) {
      const f = mode === 0 ? (res.convergence?.force ?? 0) * d : mode === 1 ? x * d : 0;
      if (res.convergence) res.convergence.force = s16(f);
    }
  }

  // Camera (GenericEmitterCallback_ApplyCameraFunc).
  const cam = ps.camera;
  const angle = (x: number, y: number, z: number) => cam.setAngleAroundTarget([x, y, z]);
  switch (camera) {
    case 0:
      angle(0, 0, 0);
      break;
    case 1:
      cam.projection = 1;
      angle(degToIdx(45) + 1, degToIdx(45) + 1, 0);
      break;
    case 2: {
      const p = vm.extraParams(4);
      angle(p[1]!, p[2]!, p[3]!);
      break;
    }
    case 3:
      cam.projection = 1;
      angle(-degToIdx(67.502), degToIdx(45) + 1, degToIdx(22.5) + 1);
      break;
    case 4:
      // GenericEmitterCallback_ApplyFixedAngle4: a contest has its own angle.
      cam.projection = 1;
      if (vm.contest) angle(degToIdx(272.817), degToIdx(32.696), degToIdx(22.5) + 1);
      else angle(degToIdx(50.8) + 1, degToIdx(20.567), 0);
      break;
    case 5:
      cam.projection = 1;
      angle(degToIdx(272.817), degToIdx(32.696), degToIdx(22.5) + 1);
      break;
    case 6:
      cam.projection = 1;
      angle(0, 0, -degToIdx(32.96));
      break;
    case 7:
    case 8:
      cam.setTarget(vm.worldPos(camera === 7 ? start : end, 10));
      break;
    default:
      throw new Error(`battle anim: generic emitter camera mode ${camera}`);
  }

  // Priority (GenericEmitterCallback_ApplyPriority): a depth toward or behind the end battler.
  if (prio === 1 || prio === 2) {
    const solo = vm.typeOf(end) === 0;
    e.setPos(2, prio === 1 ? (solo ? 256 : -5120) : solo ? 0 : -5376);
  }
}

const fxv = (x: number, y: number): Vec => [Math.round(x * 4096), Math.round(y * 4096), 0];

/**
 * GenericEmitterCallback_ApplyAxis in a contest: most start-to-end axes are fixed (EMITTER_TARGET_MODE_DEFENDER, 2,
 * picks the reverse of some), the side axes take config 1 with X turned round; the others are as in a battle.
 */
function contestAxis(vm: AnimVm, mode: number, targetMode: number, start: number, end: number): Vec {
  const fixed = (x: number, y: number, z: number): Vec => [Math.round(x * 4096), Math.round(y * 4096), Math.round(z * 4096)];
  const defender = targetMode === 2;
  switch (mode) {
    case 1:
    case 2:
      return defender ? fixed(-0.8145, 0.4492, 0.1797) : fixed(0.5703, -0.3516, 0.1797);
    case 4:
    case 5: {
      const v = vm.data.axes[0]![vm.typeOf(start)]![vm.typeOf(end)]!;
      return [s16(-v[0]!), s16(v[1]!), s16(Math.trunc(v[2]! / 2))];
    }
    case 6:
    case 7: {
      // START_TO_END_SP: the contest config for every pairing, turned round from the enemy's type.
      const c = fixed(-0.5703, 0.3516, 0.1797);
      return vm.typeOf(start) === 1 ? [-c[0], -c[1], -c[2]] : c;
    }
    case 8:
    case 9:
      return defender ? fixed(-0.5703, 0.3516, 0.1797) : fixed(0.5703, -0.3516, 0.1797);
    case 12:
    case 13:
      return fixed(-0.7168, 0.3516, 0.1797);
    case 10:
    case 11:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
    case 19:
      return fixed(-0.5703, 0.3516, 0.1797);
    case 20:
    case 21:
      return fixed(-1.0586, 0.3516, 0.1797);
    default:
      return genericAxis(vm, mode, start, end);
  }
}

/** GenericEmitterCallback_ApplyAxis by the start and end battlers' types. */
function genericAxis(vm: AnimVm, mode: number, start: number, end: number): Vec {
  const st = vm.typeOf(start);
  const et = vm.typeOf(end);
  const table = (config: number, s = st, t = et) => vm.data.axes[config - 1]![s]![t]!;
  const fixed = (x: number, y: number, z: number): Vec => [Math.round(x * 4096), Math.round(y * 4096), Math.round(z * 4096)];
  const half = (v: readonly number[]): Vec => [s16(v[0]!), s16(v[1]!), s16(Math.trunc(v[2]! / 2))];
  const full = (v: readonly number[]): Vec => [s16(v[0]!), s16(v[1]!), s16(v[2]!)];
  const neg = (v: Vec): Vec => [-v[0], -v[1], -v[2]];
  switch (mode) {
    case 1:
    case 2:
      return half(table(1));
    case 4:
    case 5:
      // The side variants: the pairing's own row on one side, else the solo pairing of the start's side.
      if (sideOf(start) === sideOf(end)) return half(table(1));
      return sideOf(start) === 'player' ? half(table(1, 0, 1)) : half(table(1, 1, 0));
    case 6:
    case 7: {
      // START_TO_END_SP: one axis per pairing, flipped for the enemy's side.
      const [pe, p1e1, p1p2, p1e2, p2p1, p2e1, p2e2] = [
        fixed(0.7754, 0.4785, -0.0723),
        fixed(0.789, 0.3906, 0.3828),
        fixed(1.461, 0.6094, 1.5156),
        fixed(0.6562, 0.3438, 0.375),
        fixed(-0.2188, 0.0938, 0.1953),
        fixed(0.5703, 0.3516, 0.1797),
        fixed(0.461, 0.4531, 0.4297),
      ] as const;
      switch (st) {
        case 1:
          return neg(pe);
        case 2:
          return et === 3 ? p1e1 : et === 5 ? p1e2 : p1p2;
        case 3:
          return et === 2 ? neg(p1e1) : et === 5 ? p2p1 : neg(p2e1);
        case 4:
          return et === 3 ? p2e1 : et === 5 ? p2e2 : p2p1;
        case 5:
          return et === 3 ? neg(p2p1) : et === 2 ? neg(p1e2) : neg(p2e2);
        default:
          return pe;
      }
    }
    case 8:
    case 9:
      return half(table(2));
    case 10:
    case 11: {
      // Decomp: x from config 3, y and z from config 2 (a likely typo, kept).
      const a = table(3);
      const b = table(2);
      return [s16(a[0]!), s16(b[1]!), s16(Math.trunc(b[2]! / 2))];
    }
    case 12:
    case 13:
      return full(table(4));
    case 14:
    case 15:
      return full(table(5));
    case 16:
    case 17:
      return full(table(6));
    case 18:
    case 19:
      return full(table(7));
    case 20:
    case 21:
      return full(table(8));
    case 3:
      return fixed(-0.1953, 0.293, 0.122);
    case 22:
      return fixed(-0.8325, -0.6455, 0);
    case 25:
      return fixed(-0.8398, 0.4766, 0);
    case 26:
      return sideOf(start) === 'player' ? fixed(0.9219, 0.5156, 0) : fixed(-1.4648, -0.537, 0);
    case 24: {
      const perType = [fixed(0.6992, 0.916, 0), fixed(-0.7188, 0.3555, 0), fixed(0.6934, -0.2085, 0), fixed(-0.918, -0.6191, 0), fixed(0.5586, 0.588, 0), fixed(-0.8086, -0.6777, 0)];
      return perType[st]!;
    }
    default:
      throw new Error(`battle anim: generic emitter axis mode ${mode}`);
  }
}
