/**
 * The send-out effect (docs/research/seals.md §6; decomp battle_anim/ov12_02235E94.c BallCapsuleSealEffect,
 * ov12_02237E54.c): when the ball opens, a Pokémon with a Ball Capsule starts one `ball_particle.narc` system per
 * placed seal, each after a delay by its distance from the capsule's centre; a Pokémon without one starts its
 * ball's default burst. Run headless on the battle's SPL (`ParticleManager`): `tick()` once a frame, `particles`
 * what to draw. It never touches the battle's randomness (its own SPL stream).
 */
import type { AnimParticle, ParticleSystem, SealTables } from '@opensinnoh/contracts';
import { CAPSULE_CIRCLE } from '@opensinnoh/contracts';
import type { BallSeal } from '@opensinnoh/core';
import { ParticleCamera } from './camera.ts';
import { ParticleManager, type Emitter, type SplRandom } from './spl.ts';
import type { Vec } from './fx.ts';

/** ov12_02236520's per battler type offsets (DS px), subtracted (with (10, 32)) from the battler type's world position. */
const ANCHOR_OFFSETS: [number, number][] = [[0, -16], [-15, -25], [-8, -12], [-14, -25], [-8, -12], [-16, -29]];
/** fx32 per DS px under the orthographic particle camera (the decomp's 172). */
const FX_PER_PX = 172;
/** ov12_022365D4: a seal sits this many px above the capsule's centre's place. */
const SEAL_LIFT = 30;
/** ov12_02237EA0: from this distance on a seal uses the last step. */
const RIM = CAPSULE_CIRCLE.r - 4;

/** ov12_02237EA0: a seal's start delay in frames: alphabet seals step 1; others by ⌊distance⌋ from the centre. */
export function sealDelay(tables: SealTables, seal: BallSeal): number {
  const type = tables.types[seal.seal];
  if (!type || seal.seal === 0) throw new Error(`send-out: no seal type ${seal.seal}`);
  let step = 1;
  if (!type.alphabet) {
    const d = Math.floor(Math.hypot(seal.x - CAPSULE_CIRCLE.x, seal.y - CAPSULE_CIRCLE.y));
    step = d >= RIM ? 3 : Math.min(3, Math.floor((d + 1) / 20));
  }
  const delay = tables.delays[step];
  if (delay === undefined) throw new Error(`send-out: no delay step ${step}`);
  return delay;
}

/** ov12_02236520: the effect's anchor for a battler type, from its orthographic world position (kind 0). */
export function sendOutAnchor(positions: readonly (readonly (readonly Vec[])[])[], type: number): Vec {
  const p = positions[type]?.[0]?.[1];
  const off = ANCHOR_OFFSETS[type];
  if (!p || !off) throw new Error(`send-out: no world position for battler type ${type}`);
  return [p[0] - FX_PER_PX * (10 + off[0]), p[1] - FX_PER_PX * (32 + off[1]), p[2]];
}

/** ov12_022365D4: a seal's emitter position: the anchor plus its capsule offset, y up. */
export function sealPos(anchor: Vec, seal: BallSeal): Vec {
  return [anchor[0] + FX_PER_PX * (seal.x - CAPSULE_CIRCLE.x), anchor[1] + FX_PER_PX * (CAPSULE_CIRCLE.y - seal.y + SEAL_LIFT), anchor[2]];
}

/** The Pokémon's part of the effect: its capsule, or its ball (1–17; others draw a Poké Ball's, as the decomp's clamp). */
export type SendOutSource = { capsule: { seals: BallSeal[] } } | { ball: number };

interface Pending {
  ps: ParticleManager;
  delay: number;
  pos: Vec;
  created: boolean;
}

export class SendOutEffect {
  private readonly pending: Pending[] = [];
  private readonly bursts: ParticleManager[] = [];
  /** Hold the Pokémon's cry and animation while it runs (the DS does for both; OpenSinnoh only for a capsule). */
  readonly holds: boolean;
  particles: AnimParticle[] = [];

  /**
   * `system(member)` is the `ball_particle.narc` record; `type` the battler type (0 solo player, 1 solo enemy, 2–5
   * doubles). Starts at once: construct it on the frame the ball opens.
   */
  constructor(tables: SealTables, positions: readonly (readonly (readonly Vec[])[])[], type: number, source: SendOutSource, system: (member: number) => ParticleSystem, rng: SplRandom) {
    const anchor = sendOutAnchor(positions, type);
    const manager = (member: number) => new ParticleManager(system(member), new ParticleCamera(), rng);
    if ('capsule' in source) {
      this.holds = true;
      for (const seal of source.capsule.seals) {
        const particle = tables.types[seal.seal]?.particle;
        if (particle === undefined || seal.seal === 0) throw new Error(`send-out: no seal type ${seal.seal}`);
        this.pending.push({ ps: manager(particle), delay: sealDelay(tables, seal), pos: sealPos(anchor, seal), created: false });
      }
      return;
    }
    this.holds = false;
    const row = tables.ballOpen[(source.ball < 1 || source.ball > 17 ? 4 : source.ball) - 1];
    if (!row) throw new Error(`send-out: no ball burst for ball ${source.ball}`);
    const ps = manager(row.particle);
    for (let i = 0; i < row.emitters; i++) ps.createEmitter(i, (e) => place(e, anchor));
    this.bursts.push(ps);
  }

  /** One frame: start the seals whose delay ran out (ov12_02236430), then draw and update every system. */
  tick(): void {
    for (const p of this.pending) {
      if (p.created) continue;
      if (p.delay > 0) {
        p.delay--;
        continue;
      }
      p.ps.createEmitter(0, (e) => place(e, p.pos));
      p.created = true;
    }
    const systems = [...this.bursts, ...this.pending.filter((p) => p.created).map((p) => p.ps)];
    this.particles = [];
    for (const ps of systems) ps.draw(this.particles);
    for (const ps of systems) ps.update();
  }

  /** ov12_022363CC: until every system has started and has no active emitter. */
  get active(): boolean {
    return this.pending.some((p) => !p.created || p.ps.activeEmitters > 0) || this.bursts.some((ps) => ps.activeEmitters > 0);
  }
}

/** SPLEmitter_SetPos in the create callback (the resource's base position is added). */
function place(e: Emitter, pos: Vec): void {
  e.setPos(0, pos[0]);
  e.setPos(1, pos[1]);
  e.setPos(2, pos[2]);
}
