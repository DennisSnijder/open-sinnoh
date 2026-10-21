/** The trainer card's rules on the fixture pack: the trainer score, Pokédex completion, the stars and the signature. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readPackFolder, type Id } from '@opensinnoh/core';
import { decodeSignature, encodeSignature, SIGNATURE_HEIGHT, SIGNATURE_WIDTH, TRAINER_SCORE_MAX, type GameState } from '@opensinnoh/contracts';
import { loadGamePacks, newGameState } from '@opensinnoh/game';
import { addToGameRecord, cardStars, incrementTrainerScore, localDexCompleted, nationalCaughtCount, nationalDexCompleted, nationalDexGoal, penLine, scoreBattle, scoreCatch, SignaturePad } from './index.ts';

const root = join(import.meta.dirname, '../../../packs/fixture');
const pack = readPackFolder((p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined), 'packs/fixture');
const { registries, loaded } = loadGamePacks([pack]);
const record = [...registries.newGame.values()][0]!;
const id = (s: string) => `fixture:${s}` as Id;
const fresh = (): GameState => newGameState(record, registries, loaded.order, 1);
/** Fixture species: MOSSLET … SKYLET and MOSSGROVE are Sinnoh (regional), BURROWBIT is national only. */
const ALL = ['MOSSLET', 'EMBERKIT', 'DRIPLING', 'SKYLET', 'BURROWBIT', 'MOSSGROVE'].map((n) => id(`SPECIES_${n}`));

/** The fixture's original tables (NewGame.gameRecords): event e scores e + 1; even record ids use the high limit. */
describe('trainer score (decomp sTrainerScoreIncrements, from the pack)', () => {
  it('adds each event its increment, by name or script number, capped at TRAINER_SCORE_LIMIT', () => {
    const s = fresh();
    incrementTrainerScore(s, registries, 'BADGE_EARNED'); // event 23
    incrementTrainerScore(s, registries, 4); // SIGNED_TRAINER_CARD
    incrementTrainerScore(s, registries, 27); // NATIONAL_DEX_DIPLOMA_RECEIVED
    expect(s.records.score).toBe(24 + 5 + 28);
    s.records.score = TRAINER_SCORE_MAX - 1;
    incrementTrainerScore(s, registries, 'CAUGHT_SPECIES');
    expect(s.records.score).toBe(TRAINER_SCORE_MAX);
    expect(() => incrementTrainerScore(s, registries, 51)).toThrow(/no event 51/);
  });

  it('scores battles as encounter.c UpdateGameRecords does, and a species only on its first catch', () => {
    const s = fresh();
    const score = (f: () => void) => {
      const before = s.records.score;
      f();
      return s.records.score - before;
    };
    expect(score(() => scoreBattle(s, registries, 'wild', 'won', null))).toBe(9); // WON_WILD_BATTLE (8)
    expect(score(() => scoreBattle(s, registries, 'wild', 'caught', id('SPECIES_MOSSLET')))).toBe(10); // CAPTURED_REGIONAL_MON (9)
    expect(score(() => scoreBattle(s, registries, 'wild', 'caught', id('SPECIES_BURROWBIT')))).toBe(11); // CAPTURED_NATIONAL_MON (10)
    expect(score(() => scoreBattle(s, registries, 'wild', 'fled', null))).toBe(0);
    expect(score(() => scoreBattle(s, registries, 'trainer', 'won', null))).toBe(12); // WON_TRAINER_BATTLE (11)
    expect(score(() => scoreBattle(s, registries, 'first', 'won', null))).toBe(12);
    expect(score(() => scoreBattle(s, registries, 'tutorial', 'won', null))).toBe(0);
    expect(score(() => scoreCatch(s, registries, id('SPECIES_MOSSLET')))).toBe(23); // CAUGHT_SPECIES (22)
    s.pokedex.caught.push(id('SPECIES_MOSSLET'));
    expect(score(() => scoreCatch(s, registries, id('SPECIES_MOSSLET')))).toBe(0);
  });
});

describe('game records (decomp GameRecords_AddToRecordValue, GetRecordLimit)', () => {
  it('adds to a record up to its u32/u16 high or low limit; the score and unknown ids throw', () => {
    const s = fresh();
    addToGameRecord(s, registries, 34, 1);
    addToGameRecord(s, registries, 34, 150000);
    expect(s.records.counts[34]).toBe(150001);
    addToGameRecord(s, registries, 34, 999999999);
    expect(s.records.counts[34]).toBe(999999999); // u32, high
    addToGameRecord(s, registries, 35, 1000000);
    expect(s.records.counts[35]).toBe(999999); // u32, low
    addToGameRecord(s, registries, 80, 70000);
    expect(s.records.counts[80]).toBe(0xffff); // u16, high
    addToGameRecord(s, registries, 81, 10000);
    expect(s.records.counts[81]).toBe(9999); // u16, low
    expect(() => addToGameRecord(s, registries, 1, 1)).toThrow(/trainer score/);
    expect(() => addToGameRecord(s, registries, 148, 1)).toThrow(/no record 148/);
  });
});

describe('Pokédex completion and the card stars', () => {
  it('local: every Sinnoh species seen; national: every species caught but the mythicals', () => {
    const s = fresh();
    s.pokedex.seen.push(...ALL.filter((x) => x !== id('SPECIES_BURROWBIT')));
    expect(localDexCompleted(s, registries)).toBe(true);
    s.pokedex.seen.pop();
    expect(localDexCompleted(s, registries)).toBe(false);
    expect(nationalDexGoal(registries)).toBe(6);
    s.pokedex.caught.push(...ALL.slice(0, 5));
    expect(nationalCaughtCount(s, registries)).toBe(5);
    expect(nationalDexCompleted(s, registries)).toBe(false);
    s.pokedex.caught.push(id('SPECIES_MOSSGROVE'));
    expect(nationalDexCompleted(s, registries)).toBe(true);
  });

  it('counts the game completed, the national dex and any contest master rank (TrainerCase_CalculateTrainerCardLevel)', () => {
    const s = fresh();
    expect(cardStars(s, registries)).toBe(0);
    s.flags[id('FLAG_GAME_COMPLETED')] = true;
    expect(cardStars(s, registries)).toBe(1);
    s.pokedex.caught.push(...ALL);
    expect(cardStars(s, registries)).toBe(2);
    s.flags[id('FLAG_CONTEST_MASTER_SMART')] = true;
    s.flags[id('FLAG_CONTEST_MASTER_COOL')] = true;
    expect(cardStars(s, registries)).toBe(3);
  });
});

describe('signature (decomp signature.c)', () => {
  const inked = (px: Uint8Array) => {
    const out: string[] = [];
    for (let y = 0; y < SIGNATURE_HEIGHT; y++) for (let x = 0; x < SIGNATURE_WIDTH; x++) if (px[y * SIGNATURE_WIDTH + x]) out.push(`${x},${y}`);
    return out;
  };

  it('stamps the 2×2 pen at (x + 1, y + 1) along a Bresenham line, both ends included', () => {
    const px = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
    penLine(px, { x: 0, y: 0 }, { x: 4, y: 2 });
    // Steps along x from error 4 >> 1 = 2, less 2 per step: y moves at x 2 (error −2) and x 4; stamps at (0,0) (1,0) (2,1) (3,1) (4,2).
    expect(inked(px)).toEqual(['1,1', '2,1', '3,1', '1,2', '2,2', '3,2', '4,2', '5,2', '3,3', '4,3', '5,3', '6,3', '5,4', '6,4']);
  });

  it('draws the same line backwards from the end the DS starts at', () => {
    const a = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
    const b = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
    penLine(a, { x: 10, y: 5 }, { x: 30, y: 12 });
    penLine(b, { x: 30, y: 12 }, { x: 10, y: 5 });
    expect(inked(b).length).toBeGreaterThan(0);
    expect(inked(a).length).toBe(inked(b).length);
  });

  it('a stroke starts at its first sample: a lone tap draws nothing; pixels clip to the window', () => {
    const pad = new SignaturePad();
    pad.pen([{ x: 50, y: 20 }]);
    expect(inked(pad.pixels)).toEqual([]);
    pad.up();
    pad.pen([{ x: 190, y: 62 }, { x: 191, y: 63 }]);
    expect(inked(pad.pixels)).toEqual(['191,63']);
  });

  it('round-trips through the DS 1 bpp tile layout; blank is null', () => {
    const pad = new SignaturePad();
    pad.pen([{ x: 3, y: 4 }, { x: 150, y: 50 }]);
    const hex = encodeSignature(pad.pixels)!;
    expect(hex).toMatch(/^[0-9a-f]{3072}$/);
    expect(decodeSignature(hex)).toEqual(pad.pixels);
    // Pixel (8, 0) is tile 1, row 0, bit 0: byte 8.
    const one = new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT);
    one[8] = 1;
    expect(encodeSignature(one)!.slice(16, 18)).toBe('01');
    // Pixel (0, 8) is tile 24 (the second tile row), row 0: byte 192.
    one.fill(0);
    one[8 * SIGNATURE_WIDTH] = 1;
    expect(encodeSignature(one)!.slice(384, 386)).toBe('01');
    expect(encodeSignature(new Uint8Array(SIGNATURE_WIDTH * SIGNATURE_HEIGHT))).toBeNull();
  });
});
