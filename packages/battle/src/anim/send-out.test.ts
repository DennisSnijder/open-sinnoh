/**
 * The send-out effect on synthetic records (no ROM): the seals' start delays and places (decomp ov12_02237EA0,
 * ov12_02236520, ov12_022365D4), the effect's lifetime, and in a fixture battle the hold (only a capsule holds the
 * send-out; the battle's outcome is unchanged).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPokemon, readPackFolder, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, newGameRecord, type BattleAnimData, type BattleSetup, type InputFrame, type ParticleEmitter, type ParticleSystem, type Registries, type SealTables } from '@opensinnoh/contracts';
import { CountingStubLog, loadGamePacks } from '@opensinnoh/game';
import { createBattle } from '../index.ts';
import { SendOutEffect, sealDelay, sealPos, sendOutAnchor } from './send-out.ts';
import { SplRandom } from './spl.ts';

const emitter: ParticleEmitter = {
  // Point emission, self-maintaining (bit 14): it ends 4 frames in, its particles 6 frames after they start.
  flags: 1 << 14,
  basePos: [0, 0, 0],
  count: 4096,
  radius: 0,
  length: 0,
  axis: [0, 4096, 0],
  color: 0x7fff,
  velPos: 0,
  velAxis: 0,
  scale: 4096,
  aspect: 4096,
  startDelay: 0,
  minRotation: 0,
  maxRotation: 0,
  initAngle: 0,
  emitterLife: 4,
  particleLife: 6,
  attenuation: [0, 0, 0],
  interval: 1,
  alpha: 31,
  air: 255,
  texture: 0,
  loopFrames: 0,
  dbbScale: 0,
  tileS: 0,
  tileT: 0,
  scaleDir: 0,
  faceEmitter: false,
  flipS: false,
  flipT: false,
  polygonX: 0,
  polygonY: 0,
};
const ballSystem = (n: number, emitterLife = 4): ParticleSystem => {
  const e = { ...emitter, emitterLife };
  return { id: `test:ball_particles/${n}` as Id, sourceIndex: n, archive: 'ball', textures: 'test:ui2d/b' as Id, textureParams: [0], emitters: [e, e, e] };
};
const types = Array.from({ length: 81 }, (_, id) => ({ sheet: 184, name: id, particle: 36 + id, alphabet: id >= 50 && id <= 77, price: 0, description: 0 }));
const tables: SealTables = {
  types,
  marts: [],
  trainerCapsules: [],
  delays: [0, 8, 14, 20, 20, 16, 16],
  ballOpen: Array.from({ length: 20 }, (_, i) => ({ particle: i < 17 ? i + 1 : 36, emitters: 2 })),
};
const positions = Array.from({ length: 6 }, (_, type) => Array.from({ length: 12 }, () => [[0, 0, 0] as [number, number, number], [type * 4096, 2 * 4096, 0] as [number, number, number]]));

describe('the send-out effect', () => {
  it('starts a seal by its distance from the capsule centre (190, 70); alphabet seals after 8 frames', () => {
    const at = (x: number, y: number, seal = 1) => sealDelay(tables, { seal, x, y });
    expect([at(190, 70), at(190 + 18, 70), at(190 + 19, 70), at(190, 70 - 38), at(190, 70 - 39), at(190 + 55, 70), at(190 + 56, 70), at(190, 130)]).toEqual([0, 0, 8, 8, 14, 14, 20, 20]);
    // ⌊√(30² + 40²)⌋ = 50: step 2.
    expect(at(220, 110)).toBe(14);
    expect(at(190, 70, 50)).toBe(8);
    expect(at(240, 110, 77)).toBe(8);
  });

  it('places the anchor by battler type and a seal at its capsule offset, 30 px up, y flipped', () => {
    expect(sendOutAnchor(positions, 0)).toEqual([0 - 172 * 10, 8192 - 172 * 16, 0]);
    expect(sendOutAnchor(positions, 1)).toEqual([4096 - 172 * -5, 8192 - 172 * 7, 0]);
    expect(sendOutAnchor(positions, 5)).toEqual([5 * 4096 - 172 * -6, 8192 - 172 * 3, 0]);
    expect(sealPos([100, 200, 0], { seal: 1, x: 190, y: 70 })).toEqual([100, 200 + 172 * 30, 0]);
    expect(sealPos([100, 200, 0], { seal: 1, x: 200, y: 40 })).toEqual([100 + 1720, 200 + 172 * 60, 0]);
  });

  it('a capsule: one system per seal, each from its delay, active until every one has started and ended', () => {
    const loaded: number[] = [];
    const system = (n: number) => (loaded.push(n), ballSystem(n));
    const fx = new SendOutEffect(tables, positions, 1, { capsule: { seals: [{ seal: 1, x: 190, y: 70 }, { seal: 2, x: 190 + 60, y: 70 }] } }, system, new SplRandom(1));
    expect(loaded).toEqual([37, 38]);
    expect(fx.holds).toBe(true);
    let frames = 0;
    let drawn = 0;
    while (fx.active) {
      fx.tick();
      drawn += fx.particles.length;
      frames++;
      if (frames > 100) throw new Error('still active');
    }
    // The rim seal starts 20 frames in, then its emitter (4 frames) and particles (6) run out.
    expect(frames).toBeGreaterThanOrEqual(20 + 4 + 6);
    expect(frames).toBeLessThan(20 + 4 + 6 + 4);
    expect(drawn).toBeGreaterThan(0);
  });

  it('no capsule: the ball burst (row ball − 1, emitters 0 … n − 1) at the anchor, which does not hold', () => {
    const loaded: number[] = [];
    const fx = new SendOutEffect(tables, positions, 0, { ball: 4 }, (n) => (loaded.push(n), ballSystem(n)), new SplRandom(1));
    expect(loaded).toEqual([4]);
    expect(fx.holds).toBe(false);
    expect(fx.active).toBe(true);
    new SendOutEffect(tables, positions, 0, { ball: 0 }, (n) => (loaded.push(n), ballSystem(n)), new SplRandom(1));
    expect(loaded).toEqual([4, 4]);
  });
});

describe('the send-out effect in a battle (fixture pack)', () => {
  const root = join(import.meta.dirname, '../../../../packs/fixture');
  const read = (p: string) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
  const base = loadGamePacks([readPackFolder(read, 'packs/fixture')]).registries;
  const newGame = newGameRecord(base);
  const data: BattleAnimData = { id: 'test:battle_anim_data' as Id, positions, axes: [], backgrounds: [], statChange: [] };
  const registries: Registries = {
    ...base,
    newGame: new Map([[newGame.id, { ...newGame, seals: tables }]]),
    battleAnimData: new Map([[data.id, data]]),
    particleSystems: new Map([...Array.from({ length: 17 }, (_, i) => i + 1), ...Array.from({ length: 81 }, (_, i) => i + 36)].map((n) => [ballSystem(n).id, ballSystem(n, 90)])),
  };
  const dex = dexOf(registries);
  const f = (n: string) => `fixture:${n}` as Id;
  const IDLE: InputFrame = { held: [], pressed: [], touch: null };

  /** A wild battle to its first command prompt: the ticks, the messages and the frames with send-out particles. */
  function intro(capsule: Pokemon['capsule']) {
    const lead = createPokemon(dex, { species: f('SPECIES_MOSSLET'), level: 8, pid: 0x1234, ivs: 15, otId: 77, otName: 'Ash', otGender: 'male', ball: f('ITEM_POKE_BALL') });
    if (capsule) lead.capsule = capsule;
    const setup: BattleSetup = { kind: 'wild', trainers: [], wild: [{ species: f('SPECIES_SKYLET'), level: 3 }], background: null, terrain: null, time: 'day' };
    const se: number[] = [];
    const b = createBattle(setup, {
      registries,
      party: [lead],
      bag: {},
      pc: { current: { box: 0, name: 'CRATE 1' }, free: { box: 0, name: 'CRATE 1' }, metBebe: false },
      met: { zone: null, date: null },
      player: { name: 'Ash', gender: 'male', trainerId: 77, rival: 'Bo' },
      money: 3000,
      badges: 0,
      caught: [],
      seed: 7,
      textSpeed: 4,
      log: new CountingStubLog(() => {}),
      sound: { victory: () => {}, se: (n) => se.push(n) },
    });
    const messages: string[] = [];
    let particles = 0;
    for (let tick = 0; tick < 5000; tick++) {
      b.step(IDLE);
      const v = b.view();
      if (v.sendOut?.length) particles++;
      if (v.message?.done && messages.at(-1) !== v.message.text) messages.push(v.message.text);
      if (v.prompt) return { tick, messages, particles, se };
    }
    throw new Error('no prompt');
  }

  it('a capsule holds the send-out until its seals end; the ball burst does not; the messages are the same', () => {
    const plain = intro(undefined);
    const sealed = intro({ id: 1, seals: [{ seal: 1, x: 190, y: 70 }, { seal: 2, x: 250, y: 70 }] });
    expect(plain.se).toEqual([1798]);
    expect(sealed.se).toEqual([1798]);
    expect(plain.particles).toBeGreaterThan(0);
    expect(sealed.particles).toBeGreaterThan(plain.particles);
    expect(sealed.messages).toEqual(plain.messages);
    // The seals (90 frames here) outlast the 8-frame flash and the trainer's slide-off.
    expect(sealed.tick).toBeGreaterThan(plain.tick);
    const empty = intro({ id: 1, seals: [] });
    expect(empty.tick).toBe(plain.tick);
  });
});
