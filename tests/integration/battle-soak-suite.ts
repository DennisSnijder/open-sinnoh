/** Shared by the battle-soak ROM tests: each facility plays its fixed seeds to the end without an error. */
import { beforeAll, expect, it } from 'vitest';
import { romSlice } from '../rom.ts';
import { playSoak, soakCase, soakWorld, type SoakFacility, type SoakWorld } from '../battle-soak.ts';

const SEEDS = [1, 2, 3, 4, 5, 6];

export function soakSuite(facilities: SoakFacility[]): void {
  let world: SoakWorld;
  beforeAll(() => {
    world = soakWorld(romSlice().pack);
  });
  for (const facility of facilities) {
    it(`${facility}: seeds ${SEEDS.join(', ')} play to the end`, () => {
      for (const seed of SEEDS) {
        const result = playSoak(world, soakCase(world, facility, seed));
        expect(['won', 'lost', 'draw', 'turn-cap']).toContain(result.outcome);
      }
    });
  }
}
