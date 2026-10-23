/** The Seal Case and Ball Capsule rules (decomp ball_seal_info.c, capsule_menu) on original data. */
import { describe, expect, it } from 'vitest';
import type { Pokemon } from '@opensinnoh/core';
import { newSealCase, trainerCapsule, type GameState, type SealTables } from '@opensinnoh/contracts';
import {
  canGiveOrTakeSeal, capsuleDistance, capsuleHolder, detachCapsule, giveOrTakeSeal, onCapsule, removeCapsule, returnSeal, saveCapsule, sealList,
  sealsOwned, setCapsule, shiftCapsules, totalSeals, uniqueSeals,
} from './seals.ts';

const mon = (isEgg = false): Pokemon => ({ isEgg }) as unknown as Pokemon;
const state = (party: Pokemon[]): GameState => ({ party, sealCase: newSealCase() }) as unknown as GameState;

describe('the Seal Case (GiveOrTakeSeal, GiveOrTakeSeal2, SealCase_CountUniqueSeals)', () => {
  it('counts owned seals as loose plus placed, and caps the owned total at 99', () => {
    const c = newSealCase();
    expect(giveOrTakeSeal(c, 3, 5)).toBe(true);
    c.capsules[0] = [{ seal: 3, x: 190, y: 70 }, { seal: 3, x: 180, y: 70 }];
    expect(sealsOwned(c, 3)).toBe(7);
    expect(canGiveOrTakeSeal(c, 3, 92)).toBe(true);
    expect(giveOrTakeSeal(c, 3, 93)).toBe(false);
    expect(c.counts[2]).toBe(5);
    expect(giveOrTakeSeal(c, 3, 92)).toBe(true);
    expect(sealsOwned(c, 3)).toBe(99);
  });

  it('takes only loose seals and never below 0', () => {
    const c = newSealCase();
    c.counts[0] = 2;
    c.capsules[1] = [{ seal: 1, x: 190, y: 70 }];
    expect(giveOrTakeSeal(c, 1, -3)).toBe(false);
    expect(giveOrTakeSeal(c, 1, -2)).toBe(true);
    expect(c.counts[0]).toBe(0);
    expect(sealsOwned(c, 1)).toBe(1);
  });

  it('the drop-off checks the placed count only and clamps the loose count to 99', () => {
    const c = newSealCase();
    c.counts[4] = 99;
    expect(returnSeal(c, 5)).toBe(true);
    expect(c.counts[4]).toBe(99);
    c.counts[4] = 0;
    c.capsules = Array.from({ length: 12 }, () => Array.from({ length: 8 }, () => ({ seal: 5, x: 190, y: 70 })));
    expect(returnSeal(c, 5, 3)).toBe(true);
    expect(returnSeal(c, 5, 4)).toBe(false);
  });

  it('counts unique and total seals, and lists those loose or placed', () => {
    const c = newSealCase();
    c.counts[9] = 3;
    c.capsules[2] = [{ seal: 50, x: 190, y: 70 }];
    expect(uniqueSeals(c)).toBe(2);
    expect(totalSeals(c)).toBe(4);
    expect(sealList(c)).toEqual([10, 50]);
  });

  it('rejects ids outside 1–80', () => {
    expect(() => giveOrTakeSeal(newSealCase(), 81, 1)).toThrow();
    expect(() => sealsOwned(newSealCase(), 0)).toThrow();
  });
});

describe('the capsule circle (SealAnim_GetDistance)', () => {
  it('keeps a seal at most 60 px from (190, 70), any pixel, no snapping', () => {
    expect(capsuleDistance(190, 70)).toBe(0);
    expect(capsuleDistance(250, 70)).toBe(60);
    expect(onCapsule(250, 70)).toBe(true);
    expect(onCapsule(251, 70)).toBe(false);
    expect(capsuleDistance(233, 113)).toBe(60);
    expect(onCapsule(233, 113)).toBe(true);
    expect(onCapsule(234, 114)).toBe(false);
  });
});

describe('capsules on Pokémon', () => {
  it('SET gives a copy and the id; a second capsule is refused', () => {
    const s = state([mon(), mon()]);
    s.sealCase.capsules[3] = [{ seal: 7, x: 200, y: 60 }];
    expect(setCapsule(s, 1, 3)).toBe('set');
    expect(s.party[1]!.capsule).toEqual({ id: 4, seals: [{ seal: 7, x: 200, y: 60 }] });
    expect(capsuleHolder(s.party, 3)).toBe(1);
    s.sealCase.capsules[3]![0]!.x = 1;
    expect(s.party[1]!.capsule!.seals[0]!.x).toBe(200);
    s.sealCase.capsules[5] = [{ seal: 8, x: 190, y: 70 }];
    expect(setCapsule(s, 1, 5)).toBe('two');
    expect(capsuleHolder(s.party, 5)).toBe(-1);
  });

  it('REMOVE lets the holder go; SHIFT swaps the capsules and the holders follow', () => {
    const s = state([mon(), mon()]);
    s.sealCase.capsules[0] = [{ seal: 1, x: 190, y: 70 }];
    s.sealCase.capsules[1] = [{ seal: 2, x: 190, y: 70 }];
    setCapsule(s, 0, 0);
    shiftCapsules(s, 0, 1);
    expect(s.sealCase.capsules[1]![0]!.seal).toBe(1);
    expect(s.party[0]!.capsule!.id).toBe(2);
    expect(capsuleHolder(s.party, 1)).toBe(0);
    removeCapsule(s.party, 1);
    expect(s.party[0]!.capsule).toBeUndefined();
  });

  it('CONFIRM refreshes the holder copy, and an emptied capsule comes off', () => {
    const s = state([mon()]);
    s.sealCase.capsules[2] = [{ seal: 1, x: 190, y: 70 }];
    setCapsule(s, 0, 2);
    saveCapsule(s, 2, [{ seal: 9, x: 150, y: 40 }, { seal: 1, x: 190, y: 70 }]);
    expect(s.party[0]!.capsule!.seals).toHaveLength(2);
    saveCapsule(s, 2, []);
    expect(s.party[0]!.capsule).toBeUndefined();
    expect(() => saveCapsule(s, 2, Array.from({ length: 9 }, () => ({ seal: 1, x: 190, y: 70 })))).toThrow();
  });

  it('detaching clears it; an NPC trainer capsule is id 1 with a copy of capsule n − 1', () => {
    const m = mon();
    m.capsule = { id: 3, seals: [] };
    detachCapsule(m);
    expect(m.capsule).toBeUndefined();
    const tables = { trainerCapsules: [[{ seal: 4, x: 170, y: 60 }], []] } as unknown as SealTables;
    expect(trainerCapsule(tables, 1)).toEqual({ id: 1, seals: [{ seal: 4, x: 170, y: 60 }] });
    expect(() => trainerCapsule(tables, 3)).toThrow();
  });
});
