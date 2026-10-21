import { describe, expect, it } from 'vitest';
import { calcStats } from '@opensinnoh/core';
import { battle, configure, damageRolls, dex, f, IDLE, mon, registries, untilPrompt } from './parity-fixture.ts';

function trainerKo(language: number | undefined, ot: { otId?: number; otName?: string; otGender?: 'male' | 'female' } = {}, luckyEgg = false, gameLanguage = 2) {
  const lead = mon('PIKACHU');
  Object.assign(lead, ot);
  lead.language = language;
  if (luckyEgg) lead.heldItem = f('ITEM_LUCKY_EGG');
  const trainer = { ...registries.trainers.get(f('TRAINER_CAMPER'))!, party: [{ ...registries.trainers.get(f('TRAINER_CAMPER'))!.party[0]!, species: f('SPECIES_BULBASAUR'), level: 10, moves: [f('MOVE_SPLASH')], heldItem: null }] };
  const reg = { ...registries, trainers: new Map([[trainer.id, trainer]]) };
  const b = battle([lead], { kind: 'trainer', trainers: [trainer.id], wild: [] }, reg, gameLanguage);
  const foe = mon('BULBASAUR', 10, 'SPLASH');
  foe.hp = 1;
  configure(b, 1, foe);
  expect(new Set(damageRolls(b.sim, b.sim.p1.active[0]!, b.sim.p2.active[0]!, 'seismictoss'))).toEqual(new Set([50]));
  untilPrompt(b);
  const exp = lead.exp;
  b.choose({ kind: 'move', slot: 0 });
  const messages = untilPrompt(b);
  expect(b.done()?.outcome).toBe('won');
  expect(b.sim.log).toContainEqual(expect.stringContaining('|-damage|p2a:'));
  expect(lead.hp).toBe(160);
  return { gain: lead.exp - exp, messages };
}

describe('Platinum EXP adapter parity (battle-parity E1–E5)', () => {
  it('E1: Lucky Egg + trainer + foreign OT gives 346 EXP in another language, 306 in the game language', () => {
    expect(trainerKo(1, { otId: 88 }, true).gain).toBe(346);
    expect(trainerKo(2, { otId: 88 }, true).gain).toBe(306);
    expect(trainerKo(undefined, { otId: 88 }, true).gain).toBe(306);
    expect(trainerKo(2, { otId: 88 }, true, 1).gain).toBe(346);
  });

  it.each([{ otId: 88 }, { otName: 'Dawn' }, { otGender: 'female' as const }])('E2: OT identity includes ID, name and gender: %j', (ot) => {
    expect(trainerKo(2, ot).gain).toBe(204);
  });

  it('E2: matching full OT identity has no outsider bonus, regardless of language', () => {
    expect(trainerKo(2).gain).toBe(136);
    expect(trainerKo(1).gain).toBe(136);
  });

  it('E3: an earlier KO pays 14 EXP before a later Night Shade KOs the participant', () => {
    const lead = mon('PIKACHU', 50, 'QUICK_ATTACK');
    lead.hp = 1;
    const partner = { ...registries.trainers.get(f('TRAINER_PARTNER'))!, party: [{ ...registries.trainers.get(f('TRAINER_PARTNER'))!.party[0]!, moves: [f('MOVE_SPLASH')] }] };
    const reg = { ...registries, trainers: new Map(registries.trainers).set(partner.id, partner) };
    const b = battle([lead], { topology: 'ai-partner', partner: partner.id, wild: [{ species: f('SPECIES_MAGIKARP'), level: 5 }, { species: f('SPECIES_DUSKULL'), level: 50 }] }, reg);
    const fish = mon('MAGIKARP', 5, 'SPLASH'); fish.hp = 1;
    const ghost = mon('DUSKULL', 50, 'NIGHT_SHADE'); ghost.stats.speed = 50;
    configure(b, 1, fish);
    configure(b, 3, ghost);
    const ally = b.sim.p3!.active[0]!;
    ally.moveSlots = [{ ...b.sim.p2.active[0]!.moveSlots[0]! }];
    ally.baseMoveSlots.splice(0, ally.baseMoveSlots.length, ...ally.moveSlots);
    const hits = damageRolls(b.sim, b.sim.p1.active[0]!, b.sim.p2.active[0]!, 'quickattack');
    expect([Math.min(...hits), Math.max(...hits)]).toEqual([16, 19]);
    expect(new Set(damageRolls(b.sim, b.sim.p4!.active[0]!, b.sim.p1.active[0]!, 'nightshade'))).toEqual(new Set([50]));
    untilPrompt(b);
    const exp = lead.exp;
    b.choose({ kind: 'move', slot: 0, target: 1 });
    const messages = untilPrompt(b);
    expect(b.done()?.outcome).toBe('lost');
    expect(lead.hp).toBe(0);
    expect(lead.exp - exp).toBe(14);
    const award = messages.findIndex((m) => m.includes('earned') && m.includes('14'));
    const faint = messages.indexOf('Pikachu is out!');
    expect(award).toBeGreaterThanOrEqual(0);
    expect(faint).toBeGreaterThan(award);
    expect(lead.level).toBe(50);
  });

  it('E3: Self-Destruct faints without an HP damage line and must not award the user EXP', () => {
    const lead = mon('PIKACHU', 50, 'SELF_DESTRUCT');
    const b = battle([lead]);
    const fish = mon('MAGIKARP', 5, 'SPLASH'); fish.hp = 1;
    configure(b, 1, fish);
    untilPrompt(b);
    const exp = lead.exp;
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt(b);
    expect(lead.hp).toBe(0);
    expect(lead.exp).toBe(exp);
    expect(b.done()).not.toBeNull();
  });

  it('E4: two participants with one Exp. Share get separate 22/45 pools (67 and 22 EXP)', () => {
    const lead = mon('PIKACHU');
    lead.heldItem = f('ITEM_EXP_SHARE');
    const other = mon('PIDGEY', 50, 'SPLASH');
    const b = battle([lead, other], { wild: [{ species: f('SPECIES_BULBASAUR'), level: 10 }] });
    const foe = mon('BULBASAUR', 10, 'SPLASH'); foe.hp = 1;
    configure(b, 1, foe);
    untilPrompt(b);
    b.choose({ kind: 'switch', slot: 1 }); untilPrompt(b);
    b.choose({ kind: 'switch', slot: 0 }); untilPrompt(b);
    const exp = [lead.exp, other.exp];
    b.choose({ kind: 'move', slot: 0 }); untilPrompt(b);
    expect(b.done()?.outcome).toBe('won');
    expect([lead.exp - exp[0]!, other.exp - exp[1]!]).toEqual([67, 22]);
  });

  it('E5: a level-100 Seismic Toss KO awards neither EXP nor Speed EVs', () => {
    const lead = mon('PIKACHU', 100);
    const b = battle([lead]);
    const fish = mon('MAGIKARP', 5, 'SPLASH'); fish.hp = 1;
    configure(b, 1, fish);
    expect(new Set(damageRolls(b.sim, b.sim.p1.active[0]!, b.sim.p2.active[0]!, 'seismictoss'))).toEqual(new Set([100]));
    untilPrompt(b);
    const exp = lead.exp;
    b.choose({ kind: 'move', slot: 0 });
    untilPrompt(b);
    expect(b.done()?.outcome).toBe('won');
    expect(lead.exp).toBe(exp);
    expect(lead.evs).toEqual({ hp: 0, attack: 0, defense: 0, spAttack: 0, spDefense: 0, speed: 0 });
  });

  it('E6: a double, the second Pokémon levels up before later damage in the turn: the healthbox adds the gain to the HP shown, then takes the damage', () => {
    // The sim runs the whole turn first: the HP it holds at the level-up is the turn's end (after the poison).
    const lead = mon('DUSKULL', 50, 'SPLASH');
    const second = mon('PIDGEY', 30, 'SEISMIC_TOSS');
    second.stats = calcStats(dex.form(second.species, second.form).baseStats, 30, second.ivs, second.evs, dex.nature(second.pid));
    second.hp = second.stats.hp - 5;
    second.status = 'poison';
    second.exp = dex.expTable(dex.form(second.species, second.form).growthRate)[31]! - 1;
    const camper = registries.trainers.get(f('TRAINER_CAMPER'))!;
    const member = { ...camper.party[0]!, species: f('SPECIES_MAGIKARP'), level: 50, moves: [f('MOVE_SPLASH')], heldItem: null };
    const trainer = { ...camper, double: true, party: [member, member] };
    const b = battle([lead, second], { kind: 'trainer', trainers: [trainer.id], wild: [], topology: 'double' }, { ...registries, trainers: new Map([[trainer.id, trainer]]) });
    const fish = mon('MAGIKARP', 50, 'SPLASH'); fish.hp = 1;
    configure(b, 1, fish);
    configure(b, 3, mon('MAGIKARP', 50, 'SPLASH'));
    const [max, hp] = [second.stats.hp, second.hp];
    untilPrompt(b);
    b.choose({ kind: 'move', slot: 0, target: 1 });
    untilPrompt(b);
    b.choose({ kind: 'move', slot: 0, target: 1 });
    const shown: number[] = [];
    for (let i = 0; i < 30000 && !(b.view().prompt && i > 50); i++) {
      b.step(IDLE);
      const view = b.battlers[2]!.view;
      if (shown.at(-1) !== view.hp) shown.push(view.hp);
    }
    expect(second.level).toBe(31);
    const gain = second.stats.hp - max;
    const poison = Math.floor(second.stats.hp / 8);
    expect(gain).toBeGreaterThan(0);
    // The level-up: what was shown plus the gain; then the poison's gauge down, never below where it ends.
    expect(shown[1]).toBe(hp + gain);
    expect(Math.min(...shown)).toBe(hp + gain - poison);
    expect(b.battlers[2]!.view).toMatchObject({ hp: hp + gain - poison, maxHp: second.stats.hp });
    expect(second.hp).toBe(hp + gain - poison);
    expect(b.teams[2]!.sims[1]!.hp).toBe(second.hp);
  });
});
