import { describe, expect, it } from 'vitest';
import { followerAnimations, followerSets, importHgssFollowers, platinumSpeciesOf } from './followers.ts';

describe('HGSS follower add-on readers (original values)', () => {
  /** 493 species, one set each, plus the extra forms and female sets given. */
  const tables = (extraForms: Record<number, number>, female: Set<number>) => {
    const modelIndex = [0];
    const formMax: number[] = [];
    const fem: number[] = [];
    let next = 0;
    for (let s = 1; s <= 493; s++) {
      modelIndex.push(next);
      formMax.push(extraForms[s] ?? 0);
      fem.push(female.has(s) ? 1 : 0);
      next += 1 + (extraForms[s] ?? 0) + (female.has(s) ? 1 : 0);
    }
    return { modelIndex, formMax, fem, total: next };
  };

  it('enumerates forms and female sets after each species base, every set once', () => {
    // 73 extra sets in all: 71 forms over five species, two female sets.
    const t = tables({ 201: 27, 493: 17, 386: 3, 479: 5, 12: 19 }, new Set([3, 25]));
    expect(t.total).toBe(566);
    const sets = followerSets(t.modelIndex, t.formMax, t.fem);
    expect(sets).toHaveLength(566);
    expect(sets.filter((s) => s.species === 3)).toEqual([
      { species: 3, form: 0, female: false, set: 2 },
      { species: 3, form: 0, female: true, set: 3 },
    ]);
    expect(sets.filter((s) => s.species === 479).map((s) => s.form)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('rejects tables that do not use every set once', () => {
    const t = tables({}, new Set());
    expect(() => followerSets(t.modelIndex, t.formMax, t.fem)).toThrow(/expected each of 0–565 once/);
  });

  it('reads the sequence as one loop per direction in equal windows', () => {
    // 6 frames over a span of 40: up 0–9 (tex 0 for 5, tex 1 for 5), down 10–19, left 20–29, right 30–39.
    const start = [0, 5, 10, 20, 30, 35];
    const tex = [0, 1, 2, 4, 6, 7];
    const b = new Uint8Array(4 + 6 * 4);
    const v = new DataView(b.buffer);
    v.setUint32(0, 6, true);
    start.forEach((s, i) => v.setUint16(4 + i * 2, s, true));
    tex.forEach((t, i) => (b[16 + i] = t));
    // A span of 40 needs the last frame (35) to last as long as the first (5): 40 / 4 = 10.
    expect(followerAnimations(b)).toEqual({
      up: [{ frame: 0, ticks: 5 }, { frame: 1, ticks: 5 }],
      down: [{ frame: 2, ticks: 10 }],
      left: [{ frame: 4, ticks: 10 }],
      right: [{ frame: 6, ticks: 5 }, { frame: 7, ticks: 5 }],
    });
    b[22] = 1;
    expect(() => followerAnimations(b)).toThrow(/palette/);
  });

  it('translates species by National Pokédex number only within 1–493', () => {
    expect(platinumSpeciesOf(25)).toBe('platinum:SPECIES_PIKACHU');
    expect(platinumSpeciesOf(493)).toBe('platinum:SPECIES_ARCEUS');
    expect(() => platinumSpeciesOf(494)).toThrow(/no Platinum species/);
  });

  it('accepts only the pinned HGSS identities', async () => {
    await expect(importHgssFollowers(new Uint8Array(64), platinumSpeciesOf)).rejects.toThrow(/Unsupported ROM: SHA1 [0-9a-f]{40}.*HeartGold \(US, rev 0\).*SoulSilver/);
  });
});
