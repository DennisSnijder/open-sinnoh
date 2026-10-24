/**
 * The frontier scenes' particles and room effects on the real ROM (frontier_particle_system.c through the SPL port;
 * BF_FUNC_UPDATE_BACKGROUND; the Hall battle room's light animation): each facility's sys replay sampled per tick,
 * and the emitter sets the scripts wait on run to their end.
 */
import { describe, expect, it } from 'vitest';
import { SplRandom } from '@opensinnoh/battle/particles';
import { newGameRecord, type FrontierView, type ParticleSystem } from '@opensinnoh/contracts';
import { FrontierParticles } from '../../packages/vm/src/frontier/effects.ts';
import { romSlice } from '../rom.ts';
import { sampleFrontier } from './frontier-effects.ts';

const inScene = (views: FrontierView[], scene: number) => views.filter((v) => v.scene === scene);

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('frontier scene effects (OPENSINNOH_NDS_ROM)', () => {
  it('the Factory battle room lights its door through the five palette steps', async () => {
    const { game, views } = await sampleFrontier('sys-factory-single');
    const lights = newGameRecord(game.registries).frontier!.effects!.factoryDoorLights;
    const patches = new Set(inScene(views, 4).flatMap((v) => (v.bgPatch ? [v.bgPatch.sheet] : [])));
    expect([...patches].sort()).toEqual([...lights].sort());
    expect(inScene(views, 4).find((v) => v.bgPatch)!.bgPatch).toMatchObject({ x: 24, y: 80 });
  }, 600_000);

  it('the Hall battle room swaps its two light frames and draws its lights', async () => {
    const { game, views } = await sampleFrontier('sys-hall-single');
    const tables = newGameRecord(game.registries).frontier!;
    const room = inScene(views, 10);
    expect(new Set(room.map((v) => v.bg?.sheet))).toEqual(new Set([tables.scenes[10]!.bg!.sheet, tables.effects!.hallLights]));
    // ov104_0223DB48: a swap every 13 frames.
    const swaps = room.flatMap((v, i) => (i && v.bg?.sheet !== room[i - 1]!.bg?.sheet ? [i] : []));
    expect(swaps.length).toBeGreaterThan(3);
    expect(swaps.slice(1, 4).map((s, i) => s - swaps[i]!)).toEqual([13, 13, 13]);
    expect(Math.max(...room.map((v) => v.particles?.length ?? 0))).toBeGreaterThan(4);
  }, 600_000);

  it('the Castle battle room twinkles under its characters', async () => {
    const { views } = await sampleFrontier('sys-castle-single');
    const room = inScene(views, 12);
    expect(room.every((v) => v.spritesOnTop)).toBe(true);
    expect(room.filter((v) => v.particles?.length).length).toBeGreaterThan(100);
  }, 600_000);

  it('every frontier particle system draws, and the emitter sets the scripts wait on end', () => {
    const { pack } = romSlice();
    const systems = (pack.registries.particleSystems as unknown as ParticleSystem[]).filter((p) => p.archive === 'frontier');
    const systemOf = (n: number) => systems.find((p) => p.sourceIndex === n)!;
    // frontier_particles.order: 2 the Hall, 3 and 4 the Arcade's, 5 the Factory, 6 the Castle.
    expect([2, 3, 4, 5, 6].map((n) => systemOf(n).emitters.length)).toEqual([21, 48, 2, 3, 1]);
    const run = (narcIdx: number, emitters: number[]) => {
      const p = new FrontierParticles(new SplRandom(0), systemOf);
      p.init(0, narcIdx, 1);
      for (const e of emitters) p.createEmitter(0, e);
      let frames = 0;
      let drawn = 0;
      for (; frames < 900 && !p.idle(); frames++) {
        p.step();
        drawn = Math.max(drawn, p.drawn.length);
      }
      return { frames, drawn, idle: p.idle() };
    };
    // The Factory head's entrance (smoke, clouds, rising blocks) and the Hall's round lights: waited on (WaitForParticleSystemEmitters).
    for (const [narcIdx, emitters] of [[5, [0, 1, 2]], [2, [2, 3]], [2, [4, 6]], [2, [4, 6, 0, 1]]] as const) {
      const r = run(narcIdx, [...emitters]);
      expect(r.idle, `${narcIdx}: ${emitters.join(',')}`).toBe(true);
      expect(r.drawn, `${narcIdx}: ${emitters.join(',')}`).toBeGreaterThan(0);
    }
    // The Arcade's roulette effects and the Castle's twinkle draw (they run until the system is freed).
    for (const [narcIdx, emitters] of [[3, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]], [4, [0, 1]], [6, [0]]] as const) expect(run(narcIdx, [...emitters]).drawn).toBeGreaterThan(0);
  });
});
