import { describe, expect, it } from 'vitest';
import { battle, configure, f, mon, untilPrompt } from './parity-fixture.ts';

describe('Shadow Force charge message', () => {
  it.each([false, true])('prints the charging battler’s sided message (opponent %s)', (opponent) => {
    const b = battle([mon('DUSKULL', 50, opponent ? 'SPLASH' : 'SHADOW_FORCE')], { wild: [{ species: f('SPECIES_DUSKULL'), level: 50 }] });
    configure(b, 1, mon('DUSKULL', 50, opponent ? 'SHADOW_FORCE' : 'SPLASH'));
    untilPrompt(b);
    b.choose({ kind: 'move', slot: 0 });
    const charge = untilPrompt(b);
    expect(charge).toContain(`${opponent ? 'wild ' : ''}Duskull: PokemonVanishedInstantly`);
    b.choose({ kind: 'move', slot: 0 });
    expect(untilPrompt(b)).not.toContain(`${opponent ? 'wild ' : ''}Duskull: PokemonVanishedInstantly`);
  });
});
