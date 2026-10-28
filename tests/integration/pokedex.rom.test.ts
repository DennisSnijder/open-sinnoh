/**
 * The Pokédex import on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): every Sinnoh dex species has
 * its entry texts and area lists, the area map's fields and dungeons resolve, footprints follow the ROM,
 * and the menus' own sorts and filters (packages/menus searchDex) give exactly the ROM's precomputed lists
 * (zukan_data members 11–57).
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { REGISTRIES, dexOf, newGameRecord, type GameState, type Registries } from '@opensinnoh/contracts';
import { ENGLISH, loadPacks, type Id } from '@opensinnoh/core';
import { NitroFs } from '@opensinnoh/nds';
import { BODY_SHAPES, dexLists, numericalRows, searchDex, NO_QUERY, type DexQuery } from '@opensinnoh/menus';
import { readDexLists } from '@opensinnoh/importer';
import { romSlice } from '../rom.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;
const P = (s: string) => `platinum:${s}` as Id;

describe.skipIf(!romPath)('Pokédex data (OPENSINNOH_NDS_ROM)', () => {
  let reg: Registries;
  let romLists: number[][];
  beforeAll(() => {
    const loaded = loadPacks([romSlice().pack], '0.1.0', () => {});
    reg = Object.fromEntries(REGISTRIES.map((r) => [r, loaded.registries[r] ?? new Map()])) as unknown as Registries;
    // Giratina's entry is its Altered Forme: the lists of zukan_data_gira, which the DS reads while it shows that form.
    romLists = readDexLists(new NitroFs(new Uint8Array(readFileSync(romPath as string))), true);
  }, 120_000);
  const text = (id: Id) => reg.texts.get(id)?.text;
  /** The English build's imperial texts; the other builds' metric ones ("0,4m", "5,2kg") read the species' own decimetres and hectograms. */
  const english = () => dexOf(reg).language === ENGLISH;
  const metric = (s: string | undefined, unit: 'm' | 'kg') => Math.round(Number(s!.trim().replace(unit, '').trim().replace(',', '.')) * 10);

  it('every Sinnoh dex species has its category, description, height and weight texts and area lists', () => {
    const regional = dexLists(reg).regional;
    expect(regional).toHaveLength(210);
    expect(regional[0]!.species.id).toBe(P('SPECIES_TURTWIG'));
    expect(regional.at(-1)!.species.id).toBe(P('SPECIES_GIRATINA'));
    const map = newGameRecord(reg).pokedexMap!;
    for (const { species, dex } of regional) {
      expect(text(dex.category), species.id).toMatch(english() ? /Pokémon$/ : /\S/);
      expect(text(dex.description)?.length, species.id).toBeGreaterThan(20);
      if (english()) {
        expect(text(dex.heightText), species.id).toMatch(/^\s*\d+’\d\d”$/);
        expect(text(dex.weightText), species.id).toMatch(/^\s*\d+\.\d lbs\.$/);
      } else {
        expect(metric(text(dex.heightText), 'm'), species.id).toBe(dex.height);
        expect(metric(text(dex.weightText), 'kg'), species.id).toBe(dex.weight);
      }
      for (const list of Object.values(dex.area)) {
        for (const f of list.fields) expect(map.fields[f], `${species.id} field ${f}`).toBeDefined();
        for (const d of list.dungeons) expect(map.dungeons[d], `${species.id} dungeon ${d}`).toBeDefined();
      }
    }
    // 120 live in the wild; the starters, fossils, evolved forms and legendaries show Area Unknown.
    const somewhere = regional.filter((e) => Object.values(e.dex.area).some((l) => l.fields.length || l.dungeons.length));
    expect(somewhere.length).toBe(120);
    expect(regional.find((e) => e.species.id === P('SPECIES_TURTWIG'))!.dex.area.day).toEqual({ fields: [], dungeons: [] });
    expect(somewhere.some((e) => e.species.id === P('SPECIES_STARLY'))).toBe(true);
  });

  it('samples: Piplup and Giratina (Altered here, Origin as its form) and the seen-only texts', () => {
    const piplup = reg.species.get(P('SPECIES_PIPLUP'))!.dex!;
    expect([piplup.height, piplup.weight, piplup.shape]).toEqual([4, 52, 1]);
    if (english()) expect([text(piplup.category), text(piplup.heightText)?.trim(), text(piplup.weightText)?.trim()]).toEqual(['Penguin Pokémon', '1’04”', '11.5 lbs.']);
    expect(piplup.footprint).toBe(P('pokedex/footprints/393.png'));
    expect(reg.species.get(P('SPECIES_ZUBAT'))!.dex!.footprint).toBeNull();
    const giratina = reg.species.get(P('SPECIES_GIRATINA'))!.dex!;
    expect(giratina.forms).toHaveLength(1);
    expect(giratina.weight).not.toBe(giratina.forms![0]!.weight);
    const unknown = newGameRecord(reg).pokedexUnknown!;
    expect(text(unknown.category)).toMatch(english() ? /^\?{5} Pokémon$/ : /\?{5}/);
    // The species leaving no footprint (decomp data.json footprint.has false) have blank pictures.
    expect(dexLists(reg).national.filter((e) => !e.dex.footprint).length).toBe(108);
  });

  it('the menus sort and filter exactly as the ROM lists (A to Z, weight, height, name groups, types, shapes)', () => {
    const { national, regional, types } = dexLists(reg);
    expect(national).toHaveLength(493);
    const all = national.map((e) => e.species.id);
    const state = { pokedex: { obtained: true, national: true, seen: all, caught: all } } as unknown as GameState;
    const numbers = (q: Partial<DexQuery>) => searchDex(national, { ...NO_QUERY, ...q }, state, types, dexOf(reg).language).map((e) => e.national);
    expect(numericalRows(national, state).map((e) => e!.national)).toEqual(romLists[0]);
    expect(regional.map((e) => e.national)).toEqual(romLists[1]);
    for (let order = 1; order <= 5; order++) expect(numbers({ order }), `order ${order}`).toEqual(romLists[1 + order]);
    for (let g = 1; g <= 9; g++) expect(numbers({ order: 1, name: g }), `name group ${g}`).toEqual(romLists[6 + g]);
    // ROM type lists: type order without Mystery, as the menus' type options.
    expect(types).toEqual(['NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST', 'STEEL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON', 'DARK'].map((t) => P(`TYPE_${t}`)));
    types.forEach((_, t) => expect(numbers({ type1: t + 1 }), `type ${t}`).toEqual(romLists[16 + t]));
    for (let s = 0; s < BODY_SHAPES; s++) expect(numbers({ shape: s + 1 }), `shape ${s}`).toEqual(romLists[33 + s]);
  });

  it('imports the Pokédex art the menus draw', () => {
    for (const path of ['area_map', 'area_fields', 'area_fields_special', 'height_check', 'info_background', 'types', 'shapes', 'body_shapes', 'size_check_icons', 'dungeon_highlight', 'time_day_icons', 'unseen_icon'])
      expect(reg.ui2d.get(P(`ui2d/pokedex/${path}`)), path).toBeDefined();
    expect(reg.ui2d.get(P('ui2d/pokedex/shapes'))!.names).toEqual(Array.from({ length: BODY_SHAPES }, (_, s) => `shape_${s}`));
  });
});
