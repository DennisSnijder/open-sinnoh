/**
 * The particle simulation for packages outside the battle (`@opensinnoh/battle/particles`): the Battle Frontier's
 * scenes load their own particle systems (decomp frontier_particle_system.c) on the same SPL port, and the capsule
 * editor's Test plays the send-out effect (decomp capsule_menu, ov12_02236004).
 */
export { ParticleManager, SplRandom, type Emitter } from './spl.ts';
export { ParticleCamera } from './camera.ts';
export { SendOutEffect, type SendOutSource } from './send-out.ts';
