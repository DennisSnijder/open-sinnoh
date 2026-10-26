import { describe, expect, it } from 'vitest';
import { battle, configure, f, mon, untilPrompt } from './parity-fixture.ts';

describe('Transform', () => {
  it('keeps the target’s picture after the move, until the battler leaves', () => {
    const b = battle([mon('PIKACHU', 50, 'TRANSFORM'), mon('SQUIRTLE', 50, 'SPLASH')], { wild: [{ species: f('SPECIES_PSYDUCK'), level: 50 }] });
    configure(b, 1, mon('PSYDUCK', 50, 'SPLASH'));
    untilPrompt(b);
    expect(b.view().battlers[0]!.look).toBeUndefined();
    b.choose({ kind: 'move', slot: 0 });
    expect(untilPrompt(b).join('\n')).toContain('Pikachu: PokemonTransformedIntoPokemon Psyduck');
    const own = b.view().battlers[0]!;
    expect(own.look).toEqual({ species: f('SPECIES_PSYDUCK'), form: 0, shiny: false, gender: b.view().battlers[1]!.gender });
    expect(own.species).toBe(f('SPECIES_PIKACHU'));
    expect(own.name).toBe('Pikachu');
    b.choose({ kind: 'switch', slot: 1 });
    untilPrompt(b);
    expect(b.view().battlers[0]!.species).toBe(f('SPECIES_SQUIRTLE'));
    expect(b.view().battlers[0]!.look).toBeUndefined();
  });
});
