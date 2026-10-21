/**
 * The title's CONTINUE scatters the roamers (decomp FieldTask_LoadSavedGameMap; `Game.onContinue`), a plain load does
 * not (the replays' save round trip; docs/decisions.md "roamers scatter on the title's CONTINUE only"). On the real
 * ROM (OPENSINNOH_NDS_ROM), from m6-mesprit-roam's end: Mesprit roaming.
 */
import { describe, expect, it } from 'vitest';
import type { GameState } from '@opensinnoh/contracts';
import { ROM } from '../rom.ts';
import { chainAnchor, storyGame } from './checkpoints-anchors.ts';

describe.skipIf(!ROM)('roamers on CONTINUE (OPENSINNOH_NDS_ROM)', () => {
  it('a load gives back the saved roamers; the title’s CONTINUE then moves Mesprit to another route', async () => {
    for (const seed of [1, 2, 3]) {
      const save = await chainAnchor('m6-mesprit-roam.replay', seed);
      const saved = (JSON.parse(save) as { state: GameState }).state;
      expect(saved.roamers.slots[0]?.species).toBe('platinum:SPECIES_MESPRIT');
      const game = storyGame(seed);
      game.load(JSON.parse(save));
      expect(game.state.roamers).toEqual(saved.roamers);
      expect(game.state.encounterRng).toEqual(saved.encounterRng);
      game.onContinue();
      expect(game.state.roamers.routes[0]).not.toBe(saved.roamers.routes[0]);
      expect(game.state.roamers.slots[0]).toEqual(saved.roamers.slots[0]);
      expect(game.state.encounterRng).not.toEqual(saved.encounterRng);
    }
  }, 600_000);
});
