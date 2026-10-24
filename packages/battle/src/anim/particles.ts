/**
 * The particle simulation for packages outside the battle (`@opensinnoh/battle/particles`): the Battle Frontier's
 * scenes load their own particle systems (decomp frontier_particle_system.c) on the same SPL port.
 */
export { ParticleManager, SplRandom, type Emitter } from './spl.ts';
export { ParticleCamera } from './camera.ts';
