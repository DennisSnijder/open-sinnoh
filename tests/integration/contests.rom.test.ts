/**
 * Super Contests on the ROM (docs/research/contests.md): the imported tables, entry eligibility in the party's contest
 * mode, the rivals and judges a contest draws, and the full circuit as replays (each twice on seeds 1–3 with the save
 * round trip).
 */
import { describe, expect, it } from 'vitest';
import type { NewGame } from '@opensinnoh/contracts';
import { CountingStubLog, createGame } from '@opensinnoh/game';
import { createWorld } from '@opensinnoh/world';
import { CONTEST_ROUNDS_STATUS, createScriptRunner } from '@opensinnoh/vm';
import { createBattle } from '@opensinnoh/battle';
import { createApp, createContestRound } from '@opensinnoh/menus';
import { setupPokemon, type GameState } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { contestEligible, contestRibbon, newContest, opponentPool } from '@opensinnoh/services';
import { romSlice } from '../rom.ts';
import { poffinReplay } from './poffin-replays.ts';

const game = () => createGame({ packs: [romSlice().pack], createWorld, createScriptRunner, createBattle, createApp, seed: 1, log: new CountingStubLog(() => {}), now: () => '2009-03-22T12:00:00Z' });

describe.skipIf(!process.env.OPENSINNOH_NDS_ROM)('Super Contests (OPENSINNOH_NDS_ROM)', () => {
  it('imports contest_data.narc: opponents, judges, outfits, the twelve themes', () => {
    const { pack } = romSlice();
    const c = (pack.registries.newGame as unknown as NewGame[])[0]!.contests!;
    expect(c.opponents).toHaveLength(96);
    expect(c.judges).toHaveLength(12);
    expect(c.dressUps).toHaveLength(96);
    expect(c.themes.map((t) => t.length)).toEqual(Array.from({ length: 12 }, () => 100));
    expect(c.opponents[0]).toMatchObject({ species: 'platinum:SPECIES_PIKACHU', rank: 0, types: [0, 4], pool: 0, practice: false });
    // Every rank has one main-judge candidate and two side judges per type.
    for (let rank = 0; rank < 4; rank++) {
      for (let type = 0; type < 5; type++) {
        const roles = c.judges.filter((j) => j.rank === rank).map((j) => j.roles[type]);
        expect(roles.filter((r) => r === 2)).toHaveLength(1);
        expect(roles.filter((r) => r === 1)).toHaveLength(2);
      }
    }
    // The post-game stars (pool 3) are Master rank.
    expect(c.opponents.filter((o) => o.pool === 3).map((o) => o.rank)).toEqual([3, 3, 3]);
    expect((pack.registries.texts as { id: string }[]).some((x) => x.id === 'platinum:Lantern_Contest_Placeholder')).toBe(true);
  });

  it('every rank and type has rivals enough, before and after the post-game, and practice ones at Normal', () => {
    const c = (romSlice().pack.registries.newGame as unknown as NewGame[])[0]!.contests!;
    for (let rank = 0; rank < 4; rank++) {
      for (let type = 0; type < 5; type++) {
        expect(opponentPool(c, rank, type, 2, false).length, `rank ${rank} type ${type}`).toBeGreaterThanOrEqual(3);
        expect(opponentPool(c, rank, type, 2, true).length).toBeGreaterThanOrEqual(3);
      }
    }
    for (const comp of [3, 5, 7]) for (let type = 0; type < 5; type++) expect(opponentPool(c, 0, type, comp, false).length).toBeGreaterThanOrEqual(3);
    expect(opponentPool(c, 3, 0, 2, true).some((i) => c.opponents[i]!.pool === 3)).toBe(true);
    expect(opponentPool(c, 3, 0, 2, false).some((i) => c.opponents[i]!.pool >= 2)).toBe(false);
  });

  it('a new contest draws the same rivals and judges for the same seed; the post-game seats a star at Master', () => {
    const g = game();
    g.state.party.push(setupPokemon(g.state, g.registries, 0, 'platinum:SPECIES_STARAVIA' as Id, 20, ['platinum:MOVE_WING_ATTACK' as Id, 'platinum:MOVE_QUICK_ATTACK' as Id]));
    const make = (state: GameState, rank: number) => newContest(state, g.registries, { mode: 'official', rank, type: 0, competition: 2, partySlot: 0, seed: 1234 });
    const a = make(g.state, 0);
    const b = make(g.state, 0);
    expect(a).toEqual(b);
    expect(a.entrants[0]!.opponent).toBeNull();
    expect(a.entrants.slice(1).map((e) => e.mon.level)).toEqual([10, 10, 10]);
    expect(new Set(a.entrants.map((e) => e.opponent)).size).toBe(4);
    expect(a.judges).toHaveLength(3);
    const c = (g.registries.newGame.get('platinum:NEW_GAME' as Id) as NewGame).contests!;
    const post = structuredClone(g.state);
    post.flags['platinum:FLAG_GAME_COMPLETED' as Id] = true;
    post.pokedex.national = true;
    for (let seed = 0; seed < 5; seed++) {
      const s = newContest(post, g.registries, { mode: 'official', rank: 3, type: 0, competition: 2, partySlot: 0, seed });
      expect(s.entrants.slice(1).filter((e) => c.opponents[e.opponent!]!.pool === 3)).toHaveLength(1);
    }
  });

  it('the party in contest mode marks who may enter: an Egg, one move or too few ribbons may not', () => {
    const g = game();
    const add = (species: string, moves: string[]) => g.state.party.push(setupPokemon(g.state, g.registries, g.state.party.length, `platinum:${species}` as Id, 20, moves.map((m) => `platinum:${m}` as Id)));
    add('SPECIES_STARAVIA', ['MOVE_WING_ATTACK', 'MOVE_QUICK_ATTACK']);
    add('SPECIES_MAGIKARP', ['MOVE_SPLASH']);
    add('SPECIES_BUNEARY', ['MOVE_POUND', 'MOVE_SPLASH']);
    g.state.party[2]!.ribbons = [contestRibbon(1, 0)];
    expect(g.state.party.map((m) => contestEligible(m, 0, 0))).toEqual([true, false, true]);
    expect(g.state.party.map((m) => contestEligible(m, 1, 1))).toEqual([false, false, true]);
    const app = createApp({ app: 'contest-select', rank: 1, type: 1 }, { registries: g.registries, state: g.state, log: g.log, host: { options: () => ({}), setOption() {}, save() {}, fieldMoveCheck: () => null, useFieldMove() {}, fieldItemCheck: () => null, useFieldItem() {}, clock: () => g.clock() } as never });
    const view = app.view() as { mode: string; notes: (string | null)[] };
    expect(view.mode).toBe('contest');
    const able = g.registries.texts.get('platinum:PartyMenu_Text_EligibleForContest' as Id)!.text;
    expect(view.notes.slice(0, 3).map((n) => n === able)).toEqual([false, false, true]);
  });

  it('the coverage report knows which rounds are placeholders (vm CONTEST_ROUNDS_STATUS = the rounds behind the seam)', () => {
    const g = game();
    g.state.party.push(setupPokemon(g.state, g.registries, 0, 'platinum:SPECIES_STARAVIA' as Id, 20, ['platinum:MOVE_WING_ATTACK' as Id, 'platinum:MOVE_QUICK_ATTACK' as Id]));
    const session = newContest(g.state, g.registries, { mode: 'official', rank: 0, type: 0, competition: 2, partySlot: 0, seed: 1 });
    // The visual round's outfit, which the dance draws.
    session.dressUp = { accessories: [], monPriority: 0, backdrop: 0 };
    for (const kind of ['visual', 'dance', 'acting'] as const) {
      const round = createContestRound(kind, { session, registries: g.registries, state: g.state, host: {} as never, log: g.log, rng: () => 0 });
      expect(round.placeholder, kind).toBe(CONTEST_ROUNDS_STATUS[kind] === 'placeholder');
    }
  });

  poffinReplay('sys-contest-normal-cool');
  poffinReplay('sys-contest-hall-story');
});
