import type { Battle, Pokemon } from '@pkmn/sim';

/** TryPursuit scans current battler state when a switch occurs, in DS battler order. */
export function pursuit(parent: (this: Battle, pokemon: Pokemon) => unknown) {
  return {
    inherit: true,
    beforeTurnCallback(pokemon: Pokemon) {
      for (const target of pokemon.foes()) {
        target.addVolatile('pursuit');
        const state = target.volatiles['pursuit']!;
        (state.sources ??= []).push(pokemon);
      }
    },
    condition: {
      inherit: true,
      onBeforeSwitchOut(this: Battle, pokemon: Pokemon) {
        const sources = this.effectState.sources as Pokemon[];
        this.effectState.sources = sources.filter((source) => source.hp > 0
          && source.status !== 'slp' && source.status !== 'frz'
          && !(source.hasAbility('truant') && source.volatiles['truant'])
          && source.getMoveData('pursuit')!.pp > 0)
          .sort((a, b) => (a.position * 2 + a.side.n) - (b.position * 2 + b.side.n));
        const result = parent.call(this, pokemon);
        // Interceptions use useMove directly, so the sim's ordinary BeforeMove Truant toggle never runs.
        for (const source of this.effectState.sources as Pokemon[]) {
          if (source.moveThisTurn === 'pursuit' && source.hasAbility('truant')) source.addVolatile('truant');
        }
        return result;
      },
    },
  };
}
