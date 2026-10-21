/** Fishing task semantics: pret/pokeplatinum 1dc13dc overlay005/fishing.c (SysTask GoFish),
 * overlay006/wild_encounters.c GetRodEncounterSlot / TryFishingEncounter. One update = one 30 Hz tick.
 * Ability encounter-rate doubling is a native no-op bug (ModifyEncounterRateWithFieldParams). */
import type { EncounterTable, InputFrame } from '@opensinnoh/contracts';
import { FEEBAS_LEVELS, Prng, type Id, type PrngState } from '@opensinnoh/core';
import type { WildRoll } from './encounters.ts';

/**
 * WildEncounters_TryFishingEncounter: the rate test, then on a Feebas zone a 50% gate and the facing tile
 * among the day's four (every slot becomes Feebas at 10–20), then the rod slot and GetWildMonLevel, which
 * swaps an inverted level range.
 */
export function fishingRoll(
  table: EncounterTable,
  rod: 0 | 1 | 2,
  random: PrngState,
  feebas?: { species: Id; facing: () => boolean },
): { roll: WildRoll | null; random: PrngState } {
  const rng = Prng.from(random);
  const water = [table.oldRod, table.goodRod, table.superRod][rod]!;
  const done = (roll: WildRoll | null) => ({ roll, random: rng.save() });
  if (water.rate === 0) return done(null);
  if (water.slots.length !== 5) throw new Error(`fishing ${table.id}: expected five rod slots`);
  if (rng.below(100) >= water.rate) return done(null);
  const isFeebas = !!feebas && rng.below(2) !== 0 && feebas.facing();
  const r = rng.below(100);
  const limits = rod === 0 ? [60, 90, 95, 99, 100] : [40, 80, 95, 99, 100];
  const slot = isFeebas ? { species: feebas.species, minLevel: FEEBAS_LEVELS.min, maxLevel: FEEBAS_LEVELS.max } : water.slots[limits.findIndex((n) => r < n)]!;
  const min = Math.min(slot.minLevel, slot.maxLevel);
  const max = Math.max(slot.minLevel, slot.maxLevel);
  return done({ species: slot.species, level: min + rng.below(max - min + 1) });
}

export class FishingTask {
  phase: 'prepare' | 'cast' | 'wait' | 'bite' | 'missed' | 'reel' | 'message' | 'put-away' | 'done' = 'prepare';
  private ticks = 34;
  private caught = false;
  constructor(
    private rod: 0 | 1 | 2,
    private roll: WildRoll | null,
    private next: () => number,
    private notice: (name: string) => void,
    /** FishingTask_FishGotAway: its game record and TV segment. */
    private gotAway: () => void,
  ) {}
  /** TRUE while task owns input. Messages are driven by the shared script notice, with fresh presses. */
  step(input: InputFrame, messageRunning: boolean): boolean {
    const a = input.pressed.includes('a');
    const say = (name: string) => { this.phase = 'message'; this.notice(`CommonStrings_Text_${name}`); };
    switch (this.phase) {
      case 'prepare':
        // FishingTask_Start chains to PreparePlayerAvatar, which yields before CastRod.
        this.phase = 'cast';
        break;
      case 'cast':
        if (--this.ticks > 0) break;
        this.phase = 'wait';
        this.ticks = this.roll ? (this.next() % 4 + 1) * 30 : 120;
        // GoFish chains actions returning TRUE in the same tick (SetFishWait -> WaitForFish).
        this.ticks--;
        if (a) say('ReeledItInTooQuickly');
        break;
      case 'wait':
        if (a) say('ReeledItInTooQuickly');
        else if (--this.ticks <= 0) {
          if (!this.roll) say('NotEvenANibble');
          else { this.phase = 'bite'; this.ticks = [45, 30, 15][this.rod]! - 1; }
        }
        break;
      case 'bite':
        if (a) { this.caught = true; this.phase = 'reel'; this.ticks = 16; }
        else if (--this.ticks <= 0) this.phase = 'missed';
        break;
      case 'missed':
        say('ThePokemonGotAway');
        this.gotAway();
        break;
      case 'reel':
        if (--this.ticks === 0) say('LandedAPokemon');
        break;
      case 'message':
        if (!messageRunning) { this.phase = 'put-away'; this.ticks = 3; }
        break;
      case 'put-away':
        if (--this.ticks === 0) this.phase = 'done';
        break;
      case 'done': return false;
    }
    return true;
  }
  result(): WildRoll | null { return this.caught ? this.roll : null; }
}
