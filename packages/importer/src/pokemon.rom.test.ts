/**
 * The Pokémon data and model on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): counts, sample
 * records by decomp name, stats by the decomp formula, and trainer parties whose PIDs follow the decomp's
 * TrainerData_BuildParty derivation (recomputed here with BigInt LCRNG arithmetic).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { REGISTRIES, type Registries, type Species, type Trainer } from '@opensinnoh/contracts';
import { createTrainerPokemon, Dex, ENGLISH, genderOf, loadPacks, natureIndex, type Id } from '@opensinnoh/core';
import { NitroFs, readNarc } from '@opensinnoh/nds';
import { readTrainerHeader, readTrainerParty } from './formats/data.ts';
import type { ImportReport } from './platinum.ts';
import { romSlice } from '../../../tests/rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (s: string) => `platinum:${s}` as Id;

/** Decomp TrainerData_BuildParty, written out independently: LCRNG(seed) advanced `trainerClass` times, then (rnd << 8) + 136/120. */
function decompTrainerPid(ivScale: number, level: number, species: number, trainer: number, trainerClass: number, female: boolean): number {
  let state = BigInt(ivScale + level + species + trainer);
  let rnd = state;
  for (let i = 0; i < trainerClass; i++) {
    state = (state * 1103515245n + 24691n) & 0xffffffffn;
    rnd = state >> 16n;
  }
  return Number(((rnd << 8n) + (female ? 120n : 136n)) & 0xffffffffn);
}

describe.skipIf(!romPath)('Pokémon data (OPENSINNOH_NDS_ROM)', () => {
  let report: ImportReport;
  let reg: Registries;
  let dex: Dex;
  beforeAll(async () => {
    const out = romSlice();
    report = out.report;
    const loaded = loadPacks([out.pack], '0.1.0', () => {});
    reg = Object.fromEntries(REGISTRIES.map((r) => [r, loaded.registries[r] ?? new Map()])) as unknown as Registries;
    dex = new Dex(reg);
  }, 120_000);
  const species = (n: string) => reg.species.get(P(`SPECIES_${n}`)) as Species;

  it('Pokédex texts per species, move and ability descriptions (summary and Pokédex)', () => {
    const text = (id: Id) => reg.texts.get(id)?.text;
    // The entry itself: tests/integration/pokedex.rom.test.ts.
    const turtwig = species('TURTWIG').dex!;
    // The English build's samples; every build's texts are checked in tests/integration/pokedex.rom.test.ts.
    const english = new Dex(reg).language === ENGLISH;
    if (english) expect([text(turtwig.category), text(turtwig.heightText)?.trim(), text(turtwig.weightText)?.trim()]).toEqual(['Tiny Leaf Pokémon', '1’04”', '22.5 lbs.']);
    for (const id of [turtwig.category, turtwig.heightText, turtwig.weightText, turtwig.description]) expect(text(id)).toMatch(/\S/);
    expect(species('NONE').dex).toBeUndefined();
    expect(species('EGG').dex).toBeUndefined();
    expect(text(reg.moves.get(P('MOVE_POUND'))!.description)).toMatch(english ? /^The foe is physically\npounded/ : /\S/);
    expect(text(reg.abilities.get(P('ABILITY_OVERGROW'))!.description)).toMatch(/\S/);
  });
  const trainer = (n: string) => reg.trainers.get(P(`TRAINER_${n}`)) as Trainer;
  const source = (registry: 'species' | 'trainers', id: Id) => reg[registry].get(id)!.sourceIndex!;
  /** The trainer's raw trpoke entries (ivScale, level, native species). */
  const rawParty = (trainerId: number) => {
    const fs = new NitroFs(new Uint8Array(readFileSync(romPath as string)));
    const header = readTrainerHeader(readNarc(fs.file('/poketool/trainer/trdata.narc'))[trainerId]!);
    return readTrainerParty(readNarc(fs.file('/poketool/trainer/trpoke.narc'))[trainerId]!, header);
  };

  it('imports every species, move, ability, nature, type, growth rate, item, trainer and mart', () => {
    expect(report.counts).toMatchObject({ species: 496, moves: 467, abilities: 123, natures: 25, types: 18, growthRates: 8, items: 446, trainers: 928, marts: 23 });
    expect(report.unknowns['evolution-param']).toBeUndefined();
    expect(report.unknowns['trainer-move-gap']).toBeUndefined();
  });

  it('species: personal data, learnsets, TMs, egg moves, evolutions, regional dex, forms', () => {
    const piplup = species('PIPLUP');
    expect(piplup).toMatchObject({
      baseStats: { hp: 53, attack: 51, defense: 53, speed: 40, spAttack: 61, spDefense: 56 },
      types: [P('TYPE_WATER'), P('TYPE_WATER')],
      genderRatio: 31,
      growthRate: P('EXP_RATE_MEDIUM_SLOW'),
      abilities: [P('ABILITY_TORRENT'), null],
      evolutions: [{ method: 'LEVEL', target: P('SPECIES_PRINPLUP'), level: 16 }],
      regionalDex: 7,
      starterSlot: 2,
    });
    expect(piplup.learnset.slice(0, 2)).toEqual([
      { level: 1, move: P('MOVE_POUND') },
      { level: 4, move: P('MOVE_GROWL') },
    ]);
    expect(piplup.tms).toContain(P('ITEM_HM03'));
    expect(piplup.eggMoves).toContain(P('MOVE_HYDRO_PUMP'));
    expect(species('EEVEE').evolutions.map((e) => e.method)).toEqual(expect.arrayContaining(['USE_ITEM', 'LEVEL_HAPPINESS_DAY', 'LEVEL_HAPPINESS_NIGHT', 'LEVEL_MOSS_ROCK', 'LEVEL_ICE_ROCK']));
    expect(species('ROTOM').forms?.map((f) => f.name)).toEqual(['HEAT', 'WASH', 'FROST', 'FAN', 'MOW']);
    expect(species('GIRATINA').forms?.[0]).toMatchObject({ form: 1, name: 'ORIGIN', abilities: [P('ABILITY_LEVITATE'), null] });
    expect(species('BULBASAUR').regionalDex).toBeUndefined();
  });

  it('moves, items, natures, growth rates and marts', () => {
    expect(reg.moves.get(P('MOVE_TACKLE'))).toMatchObject({ type: P('TYPE_NORMAL'), category: 'physical', power: 35, accuracy: 95, pp: 35, priority: 0, target: 'SINGLE_TARGET' });
    expect(reg.moves.get(P('MOVE_QUICK_ATTACK'))?.priority).toBe(1);
    expect(reg.moves.get(P('MOVE_SURF'))).toMatchObject({ category: 'special', power: 95, target: 'ALL_ADJACENT' });
    expect(reg.items.get(P('ITEM_TM01'))?.tm).toBe(P('MOVE_FOCUS_PUNCH'));
    expect(reg.items.get(P('ITEM_HM03'))?.tm).toBe(P('MOVE_SURF'));
    expect(reg.items.get(P('ITEM_POTION'))).toMatchObject({ price: 300, pocket: 'medicine', partyUse: { flags: ['hpRestore'], hp: 20 } });
    expect(reg.items.get(P('ITEM_EVERSTONE'))?.holdEffect).toBe('NO_EVOLVE');
    expect(reg.natures.get(P('NATURE_ADAMANT'))).toMatchObject({ sourceIndex: 3, up: 'attack', down: 'spAttack' });
    expect(reg.natures.get(P('NATURE_HARDY'))).toMatchObject({ up: null, down: null });
    expect(reg.growthRates.get(P('EXP_RATE_MEDIUM_SLOW'))?.exp[100]).toBe(1059860);
    expect(reg.growthRates.get(P('EXP_RATE_ERRATIC'))?.exp[100]).toBe(600000);
    const common = reg.marts.get(P('MART_COMMON'))!.items;
    expect(common.slice(0, 2)).toEqual([
      { item: P('ITEM_POKE_BALL'), minBadges: 0 },
      { item: P('ITEM_GREAT_BALL'), minBadges: 3 },
    ]);
    expect(reg.marts.get(P('MART_SPECIALTIES_ID_JUBILIFE'))!.items.map((i) => i.item)).toEqual([P('ITEM_AIR_MAIL'), P('ITEM_HEAL_BALL')]);
  });

  it('stats by the decomp formula (Pokemon_CalcStats)', () => {
    const base = { ivs: 0, otId: 0, otName: 'T', otGender: 'male' as const, ball: P('ITEM_POKE_BALL') };
    // Level 5 Piplup, IVs 0, a neutral nature (pid 0 = Hardy): HP ⌊106·5/100⌋+15, others ⌊2b·5/100⌋+5.
    const piplup = createTrainerPokemon(dex, { species: P('SPECIES_PIPLUP'), level: 5, ivs: 0, pid: 0, otId: 0 }, 'T', P('ITEM_POKE_BALL'));
    expect(piplup.stats).toEqual({ hp: 20, attack: 10, defense: 10, speed: 9, spAttack: 11, spDefense: 10 });
    expect(piplup.moves).toEqual([P('MOVE_POUND'), P('MOVE_GROWL')]);
    // Level 50 Garchomp, IVs 31, Adamant (pid 3): HP ⌊(216+31)·50/100⌋+60 = 183; attack (⌊(260+31)/2⌋+5)·1.1 = 165.
    const chomp = createTrainerPokemon(dex, { species: P('SPECIES_GARCHOMP'), level: 50, ivs: 31, pid: 3, otId: 0 }, 'T', base.ball);
    expect(natureIndex(dex, chomp.pid)).toBe(3);
    expect(chomp.stats).toEqual({ hp: 183, attack: 165, defense: 115, speed: 122, spAttack: 90, spDefense: 105 });
    // Shedinja (base HP 1) always has 1 HP.
    expect(createTrainerPokemon(dex, { species: P('SPECIES_SHEDINJA'), level: 30, ivs: 31, pid: 0, otId: 0 }, 'T', base.ball).stats.hp).toBe(1);
  });

  it("the rival's first battle (Route 201): level, moves and the decomp PID", () => {
    const rival = trainer('RIVAL_ROUTE_201_PIPLUP');
    expect(rival).toMatchObject({ class: P('TRAINER_CLASS_RIVAL'), gender: 'male', double: false });
    expect(rival.party).toHaveLength(1);
    const m = rival.party[0]!;
    expect(m).toMatchObject({ species: P('SPECIES_TURTWIG'), level: 5 });
    const cls = 63; // TRAINER_CLASS_RIVAL
    const [raw] = rawParty(source('trainers', rival.id));
    expect(m.pid).toBe(decompTrainerPid(raw!.ivScale, 5, source('species', m.species), source('trainers', rival.id), cls, false));
    expect(m.pid & 0xff).toBe(136);
    const mon = createTrainerPokemon(dex, m, rival.name, P('ITEM_POKE_BALL'));
    expect(mon.moves).toEqual([P('MOVE_TACKLE'), P('MOVE_WITHDRAW')]);
    expect(mon.level).toBe(5);
    expect(genderOf(species('TURTWIG').genderRatio, mon.pid)).toBe('male');
  });

  it("Roark (Oreburgh Gym): levels, moves, items and decomp PIDs", () => {
    const roark = trainer('LEADER_ROARK');
    expect(roark).toMatchObject({ class: P('TRAINER_CLASS_LEADER_ROARK'), gender: 'male', items: [P('ITEM_POTION'), P('ITEM_POTION')] });
    expect(roark.party.map((m) => [m.species, m.level, m.moves])).toEqual([
      [P('SPECIES_GEODUDE'), 12, [P('MOVE_STEALTH_ROCK'), P('MOVE_ROCK_THROW')]],
      [P('SPECIES_ONIX'), 12, [P('MOVE_STEALTH_ROCK'), P('MOVE_ROCK_THROW'), P('MOVE_SCREECH')]],
      [P('SPECIES_CRANIDOS'), 14, [P('MOVE_HEADBUTT'), P('MOVE_PURSUIT'), P('MOVE_LEER')]],
    ]);
    const cls = 62; // TRAINER_CLASS_LEADER_ROARK
    const raw = rawParty(source('trainers', roark.id));
    raw.forEach((r, k) => {
      expect(roark.party[k]!.ivs).toBe(Math.floor((r.ivScale * 31) / 255));
      expect(roark.party[k]!.pid).toBe(decompTrainerPid(r.ivScale, r.level, r.species, source('trainers', roark.id), cls, false));
    });
    const cranidos = createTrainerPokemon(dex, roark.party[2]!, roark.name, P('ITEM_POKE_BALL'));
    expect(cranidos).toMatchObject({ level: 14, ivs: { hp: roark.party[2]!.ivs }, moves: [P('MOVE_HEADBUTT'), P('MOVE_PURSUIT'), P('MOVE_LEER')], pp: [15, 20, 30] });
  });
});
