import { describe, expect, it } from 'vitest';
import { addHallOfFameEntry, HALL_OF_FAME_ENTRIES, HALL_OF_FAME_TOTAL_MAX, setupPokemon } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { createGame } from './game.ts';
import { CountingStubLog } from './stub-log.ts';
import { createFakeScriptRunner, createFakeWorld } from '../test/fakes.ts';
import { readPack } from '../test/packs.ts';

const newGame = () => createGame({ packs: [readPack('fixture')], createWorld: createFakeWorld, createScriptRunner: createFakeScriptRunner, seed: 1, log: new CountingStubLog(() => {}), now: () => 'now' });

describe('Hall of Fame history (decomp HallOfFame_AddEntry)', () => {
  it('leaves Eggs out, keeps the last 30 teams oldest first, counts every entry and stops at 9999', () => {
    const game = newGame();
    const s = game.state;
    s.party = [setupPokemon(s, game.registries, 0, 'fixture:SPECIES_EMBERKIT' as Id, 5), setupPokemon(s, game.registries, 1, 'fixture:SPECIES_DRIPLING' as Id, 7)];
    s.party[0]!.isEgg = true;
    addHallOfFameEntry(s, '2009-03-22');
    expect(s.hallOfFame.total).toBe(1);
    expect(s.hallOfFame.entries[0]).toMatchObject({ date: '2009-03-22', party: [{ species: 'fixture:SPECIES_DRIPLING', level: 7 }] });
    for (let i = 2; i <= 31; i++) addHallOfFameEntry(s, `2009-04-${String(i % 28 + 1).padStart(2, '0')}`);
    expect(s.hallOfFame.total).toBe(31);
    expect(s.hallOfFame.entries).toHaveLength(HALL_OF_FAME_ENTRIES);
    expect(s.hallOfFame.entries[0]!.date).toBe('2009-04-03');
    s.hallOfFame.total = HALL_OF_FAME_TOTAL_MAX;
    addHallOfFameEntry(s, '2010-01-01');
    expect(s.hallOfFame.total).toBe(HALL_OF_FAME_TOTAL_MAX);
    expect(s.hallOfFame.entries.at(-1)!.date).not.toBe('2010-01-01');
  });
});
