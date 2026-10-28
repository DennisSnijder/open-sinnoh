import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { REGISTRIES, type NewGame, type Ui2dSheet, type Zone } from '@opensinnoh/contracts';
import { loadPacks, type Id, type JsonValue, type PackData, type RegistryRecord } from '@opensinnoh/core';
import { importPlatinum, type ImportReport } from './platinum.ts';
import { decodeImage } from './ui2d/index.ts';
import { romBuildOfHeader } from './layout.ts';

it('rejects ROMs it does not support, with the hash it saw', async () => {
  await expect(importPlatinum(new Uint8Array([1, 2, 3]))).rejects.toThrow(/Unsupported ROM: SHA1 7037807198c22a7d2b0807371d763779a84fdfcf.*Platinum \(US, rev 0\)/);
});

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('Platinum import (OPENSINNOH_NDS_ROM)', () => {
  const stages = new Set<string>();
  let pack: PackData;
  let report: ImportReport;
  let assets: Map<string, Uint8Array>;
  /** The build's game language (decomp LANGUAGE_ENGLISH 2, LANGUAGE_GERMAN 5). */
  let language: number;
  beforeAll(async () => {
    const rom = new Uint8Array(readFileSync(romPath as string));
    language = { en: 2, de: 5 }[romBuildOfHeader(rom).rom.language];
    ({ pack, report, assets } = await importPlatinum(rom, (s) => stages.add(s), { names: { player: 'Ari', rival: 'Bo' }, gender: 'female' }));
  });
  const reg = <T>(name: string) => new Map(((pack.registries[name] ?? []) as unknown as (T & { id: Id })[]).map((r) => [r.id, r]));
  const zone = (name: string) => {
    const z = reg<Zone>('zones').get(`platinum:${name}` as Id);
    if (!z) throw new Error(`no zone ${name}`);
    return z;
  };
  const counts = (z: Zone) => [z.events.bgs.length, z.events.objects.length, z.events.warps.length, z.events.coords.length];

  it('builds the platinum base pack with every registry', () => {
    expect(pack.manifest).toMatchObject({ id: 'platinum', version: '0.1.0', engine: '^0.1.0' });
    expect(pack.provenance).toBe('rom-derived');
    expect([...stages]).toEqual(['verify', 'text', 'sound', 'zones', 'maps', 'data', 'scripts', 'assets', '2d art']);
    expect(report.counts).toMatchObject({ zones: 593, matrices: 292, chunks: 666, areas: 75, props: 527, cameras: 17, lights: 4, models: 1367, sprites: 465, weathers: 36, fieldEffects: 101, fonts: 2, titleScreens: 1, species: 496, trainers: 928, ui2d: 1698, pokemonSprites: 494, trainerSprites: 105, battleBackgrounds: 23, battleTerrains: 24, aiScripts: 1, battleAnimations: 518, particleSystems: 590, battleAnimData: 1 });
    expect(report.unknowns.char).toBeUndefined();
  });

  it('imports generic move OBJ sheets with cell animations and nonempty atlases', () => {
    const sheets = [...reg<Ui2dSheet>('ui2d').values()].filter((s) => s.id.startsWith('platinum:ui2d/battle/objects/'));
    expect(sheets).toHaveLength(30);
    for (const sheet of sheets) {
      expect(sheet.cells.length, sheet.id).toBeGreaterThan(0);
      expect(sheet.animations?.length, sheet.id).toBeGreaterThan(0);
      const png = assets.get(sheet.atlas.slice('platinum:'.length));
      expect(png, sheet.id).toBeDefined();
      const image = decodeImage(png!);
      expect(image.rgba.some((value, i) => i % 4 === 3 && value > 0), sheet.id).toBe(true);
    }
  });

  it('imports Sunyshore pointer tables and the HQ/Spear Pillar channel endpoints', () => {
    const ng = reg<NewGame>('newGame').get('platinum:NEW_GAME')!;
    expect(ng.gyms!.sunyshore!.map(r => [r.gears.length, r.rectangles.length, r.collisions.map(c => c.length)])).toEqual([
      [3, 12, [6, 6, 6, 6]], [6, 18, [11, 11, 11, 11]], [13, 40, [14, 14, 14, 14]],
    ]);
    expect(ng.containment).toEqual({ prop: 'platinum:prop/496', loopFrames: 61, openingFrames: 3 });
    expect(Object.keys(ng.spearPillar!.models)).toHaveLength(27);
    expect(ng.spearPillar!.models['6']!.frames).toBe(201);
    expect(ng.spearPillar!.models['79']!.visibility).toHaveLength(601);
    expect(ng.spearPillar!.models['79']!.visibility![0]).toHaveLength(42);
    expect(ng.spearPillar!.models['38']!.frames).toBe(241);
    for (const id of Object.values(ng.spearPillar!.backgrounds)) expect(assets.has(id.slice('platinum:'.length))).toBe(true);
  });

  it('imports the slice zones (research doc §9)', () => {
    const bedroom = zone('MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F');
    expect(bedroom).toMatchObject({ sourceIndex: 415, matrix: 'platinum:matrix/129', area: 'platinum:area/20', camera: 'platinum:CAMERA_TYPE_INTERIOR_ORTHOGRAPHIC', mapType: 'indoors' });
    expect(counts(bedroom)).toEqual([5, 1, 1, 4]);
    expect(bedroom.events.warps[0]).toEqual({ x: 8, z: 4, toZone: 'platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_1F', toWarp: 1 });
    expect(bedroom.events.objects[0]).toMatchObject({ localId: 0, hideFlag: 'platinum:FLAG_HIDE_TWINLEAF_TOWN_PLAYER_HOUSE_2F_RIVAL', facing: 'left', x: 10, z: 4 });
    // Clones name the zone whose object they copy: Twinleaf lists Route 201's arrow signpost, and back.
    const clonesOf = (name: string) => zone(name).events.objects.filter((o) => o.cloneOf).map((o) => [o.localId, o.sprite, o.cloneOf]);
    expect(clonesOf('MAP_HEADER_TWINLEAF_TOWN')).toEqual([[3, 'platinum:OBJ_EVENT_GFX_ARROW_SIGNPOST', 'platinum:MAP_HEADER_ROUTE_201']]);
    expect(clonesOf('MAP_HEADER_ROUTE_201')).toEqual([
      [5, 'platinum:OBJ_EVENT_GFX_SIGNBOARD', 'platinum:MAP_HEADER_SANDGEM_TOWN'],
      [3, 'platinum:OBJ_EVENT_GFX_GUITARIST', 'platinum:MAP_HEADER_TWINLEAF_TOWN'],
    ]);
    expect(bedroom.events.coords.map((c) => c.label)).toEqual([
      'platinum:TwinleafTownPlayerHouse2F_CoordEvent_RivalNorth',
      'platinum:TwinleafTownPlayerHouse2F_CoordEvent_RivalWest',
      'platinum:TwinleafTownPlayerHouse2F_CoordEvent_RivalEast',
      'platinum:TwinleafTownPlayerHouse2F_CoordEvent_RivalSouth',
    ]);
    expect(bedroom.events.coords[0]).toMatchObject({ var: 'platinum:VAR_PLAYER_HOUSE_RIVAL_STATE', value: 0 });
    expect(bedroom.events.bgs[0]).toMatchObject({ label: 'platinum:TwinleafTownPlayerHouse2F_Wii', facing: 'any', kind: 'interact' });
    expect(bedroom.mapScripts).toEqual({
      onTransition: 'platinum:TwinleafTownPlayerHouse2F_OnTransition',
      onFrame: [{ var: 'platinum:VAR_PLAYER_HOUSE_SPECIAL_PROGRAM_STATE', value: 0, label: 'platinum:TwinleafTownPlayerHouse2F_OnFrame_ConcludeSpecialProgram' }],
    });
    const twinleaf = zone('MAP_HEADER_TWINLEAF_TOWN');
    expect(twinleaf).toMatchObject({ sourceIndex: 411, matrix: 'platinum:matrix/0', area: 'platinum:area/6', camera: 'platinum:CAMERA_TYPE_DEFAULT', mapType: 'town' });
    expect(counts(twinleaf)).toEqual([1, 8, 4, 2]);
    const route = zone('MAP_HEADER_ROUTE_201');
    expect(counts(route).slice(1)).toEqual([13, expect.any(Number), 6]);
    expect(route.events.objects.find((o) => o.label === 'platinum:FollowerPartners_Rival')).toBeDefined();
    expect(route.events.objects.some((o) => typeof o.sprite === 'object' && o.sprite.var === 'platinum:VAR_OBJ_GFX_ID_0')).toBe(true);
    expect(zone('MAP_HEADER_LAKE_VERITY_LOW_WATER')).toMatchObject({ matrix: 'platinum:matrix/101', camera: 'platinum:CAMERA_TYPE_ZOOMED_IN', mapType: 'cave' });
  });

  it('imports matrices, chunks and cameras', () => {
    const m = reg<{ width: number; chunks: (Id | null)[]; altitudes?: number[] }>('matrices');
    expect(m.get('platinum:matrix/129')?.chunks).toEqual(['platinum:chunk/187']);
    const world = m.get('platinum:matrix/0');
    expect(world?.width).toBe(30);
    expect(world?.chunks[3 + 27 * 30]).toBe('platinum:chunk/0');
    expect([world?.chunks[3 + 26 * 30], world?.chunks[4 + 26 * 30]]).toEqual(['platinum:chunk/5', 'platinum:chunk/6']);
    expect(m.get('platinum:matrix/101')?.chunks).toEqual([531, 532, 533, 534, 535, 536].map((i) => `platinum:chunk/${i}`));
    const chunk = reg<{ tiles: number[]; model: Id; terrain: { points: unknown[] } }>('chunks').get('platinum:chunk/187');
    expect(chunk?.tiles).toHaveLength(1024);
    expect(chunk?.model).toBe('platinum:MODEL_LAND_187');
    expect(chunk?.terrain.points.length).toBeGreaterThan(1);
    const area = reg<object>('areas').get('platinum:area/20');
    expect(area).toEqual({ id: 'platinum:area/20', sourceIndex: 20, light: 'platinum:light/1', mapTextures: 'platinum:textures/map/20', propTextures: 'platinum:textures/build/16' });
    const cam = reg<{ projection: string; fovY: number; angle: number[] }>('cameras').get('platinum:CAMERA_TYPE_DEFAULT');
    expect(cam?.projection).toBe('perspective');
    expect(cam?.fovY).toBeCloseTo(16.18, 2);
    expect(cam?.angle[0]).toBeCloseTo(-59.05, 2);
    expect(reg<{ projection: string }>('cameras').get('platinum:CAMERA_TYPE_INTERIOR_ORTHOGRAPHIC')?.projection).toBe('orthographic');
  });

  it('imports the midday area light templates, and the slice areas use the outdoor and indoor sets', () => {
    const areas = reg<{ light: Id }>('areas');
    // Twinleaf Town and Route 201 (areas 6, 62) use light set 0 (outdoor); the bedroom (area 20) set 1 (indoor).
    expect(areas.get('platinum:area/6')?.light).toBe('platinum:light/0');
    expect(areas.get('platinum:area/20')?.light).toBe('platinum:light/1');
    expect(areas.get('platinum:area/62')?.light).toBe('platinum:light/0');
    const lights = reg<{ lights: ({ color: number[]; direction: number[] } | null)[]; diffuse: number[] }>('lights');
    const outdoor = lights.get('platinum:light/0');
    const indoor = lights.get('platinum:light/1');
    // Shape only (no ROM values in the repo): 4 slots, light 1 off in both, light 3 on outdoors only.
    expect(outdoor?.lights.map((l) => l !== null)).toEqual([true, false, true, true]);
    expect(indoor?.lights.map((l) => l !== null)).toEqual([true, false, true, false]);
    for (const t of [outdoor, indoor]) {
      for (const c of [...(t?.lights.flatMap((l) => (l ? [l.color] : [])) ?? []), t?.diffuse ?? []]) for (const x of c) expect(x * 31).toBeCloseTo(Math.round(x * 31), 6);
      const sun = t?.lights[0]?.direction ?? [];
      expect(Math.hypot(...sun)).toBeCloseTo(1, 1);
      expect(sun[1]).toBeLessThan(0);
    }
    expect(outdoor).not.toEqual(indoor);
    // AreaDataManager_IsOutdoorsLighting: land takes the template's material colours under arealight 0 and 3 only.
    expect([0, 1, 2, 3].map((i) => (lights.get(`platinum:light/${i}` as Id) as { indoor?: true }).indoor ?? false)).toEqual([false, true, true, false]);
  });

  it('imports flags, vars, species, items, trainers and texts by decomp name', () => {
    expect(reg('flags').get('platinum:FLAG_HIDE_TWINLEAF_TOWN_PLAYER_HOUSE_2F_RIVAL')).toEqual({ id: 'platinum:FLAG_HIDE_TWINLEAF_TOWN_PLAYER_HOUSE_2F_RIVAL', sourceIndex: 371, initial: false, scope: 'saved' });
    expect(reg('flags').get('platinum:FLAG_MAP_LOCAL_0x01')).toMatchObject({ sourceIndex: 1, scope: 'map' });
    expect(reg('vars').get('platinum:VAR_PLAYER_HOUSE_STATE')).toMatchObject({ sourceIndex: 0x40a4, scope: 'saved' });
    expect(reg('vars').get('platinum:VAR_PLAYER_STARTER')).toMatchObject({ sourceIndex: 0x4030 });
    expect(reg('vars').get('platinum:VAR_MAP_LOCAL_0x00')).toMatchObject({ scope: 'map' });
    expect(reg('vars').get('platinum:VAR_RESULT')).toMatchObject({ sourceIndex: 0x800c, scope: 'temp' });
    const species = reg<{ sourceIndex: number; starterSlot?: number }>('species');
    expect([387, 390, 393].map((i) => [...species.values()].find((s) => s.sourceIndex === i)?.starterSlot)).toEqual([0, 1, 2]);
    expect(species.get('platinum:SPECIES_TURTWIG')?.starterSlot).toBe(0);
    expect(reg('items').get('platinum:ITEM_POTION')).toMatchObject({ sourceIndex: 17, pocket: 'medicine' });
    expect(reg('items').get('platinum:ITEM_POKE_BALL')).toMatchObject({ pocket: 'balls' });
    const rival = reg<{ party: { species: Id; level: number }[] }>('trainers');
    for (const t of ['TURTWIG', 'CHIMCHAR', 'PIPLUP']) {
      const party = rival.get(`platinum:TRAINER_RIVAL_ROUTE_201_${t}` as Id)?.party;
      expect(party).toHaveLength(1);
      expect(party?.[0]?.level).toBe(5);
      expect(['platinum:SPECIES_TURTWIG', 'platinum:SPECIES_CHIMCHAR', 'platinum:SPECIES_PIPLUP']).toContain(party?.[0]?.species);
    }
    const texts = reg<{ text: string }>('texts');
    expect(texts.get('platinum:TwinleafTownPlayerHouse2F_Text_ItsAWii')?.text).toMatch(/\n/);
    expect(texts.get('platinum:TwinleafTownPlayerHouse2F_Text_PCPokemonBasics')?.text).toMatch(/^\{var 0\}.*\{clear\}/s);
    // The VM's buffer_pocket_name reads TEXT_BANK_BAG_POCKET_NAMES_WITH_ICONS (bank 396) by these ids: one per pocket, with colour codes.
    for (let p = 0; p < 8; p++) expect(texts.get(`platinum:pl_msg_00000396_0000${p}`)?.text).toMatch(/^\{color \d+\}.+\{color 0\}\S/);
  });

  it('imports trainer classes, double battles and field messages (trtbl)', () => {
    type T = { class: Id; double: boolean; messages: Record<string, Id> };
    const trainers = reg<T>('trainers');
    const texts = reg<{ text: string }>('texts');
    const rival = trainers.get('platinum:TRAINER_RIVAL_ROUTE_201_PIPLUP' as Id)!;
    expect(rival).toMatchObject({ class: 'platinum:TRAINER_CLASS_RIVAL', double: false });
    expect(Object.keys(rival.messages)).toEqual(expect.arrayContaining(['firstDamage', 'activeBattlerHalfHp', 'defeat']));
    const tristan = trainers.get('platinum:TRAINER_YOUNGSTER_TRISTAN' as Id)!;
    expect(tristan.class).toBe('platinum:TRAINER_CLASS_YOUNGSTER');
    expect(Object.keys(tristan.messages).sort()).toEqual(['defeat', 'postBattle', 'preBattle', 'rematch']);
    for (const id of Object.values(tristan.messages)) expect(texts.get(id)?.text.length).toBeGreaterThan(0);
    expect(trainers.get('platinum:TRAINER_TWINS_LIV_AND_LIZ' as Id)?.double).toBe(true);
    expect(report.unknowns['trainer-class']).toBeUndefined();
    expect(report.unknowns['trainer-battle-type']).toBeUndefined();
  });

  it('imports wild encounters (pl_enc_data) and tile behaviours', () => {
    type E = { landRate: number; land: { species: Id; minLevel: number; maxLevel: number }[]; surf: unknown[]; oldRod: { rate: number; slots: unknown[] }; variants: Record<string, { slot: number; species: Id }[]> };
    expect(zone('MAP_HEADER_ROUTE_201').encounters).toBe('platinum:encounters_route_201');
    expect(zone('MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F').encounters).toBeUndefined();
    const route201 = reg<E>('encounters').get('platinum:encounters_route_201' as Id)!;
    expect(route201.landRate).toBeGreaterThan(0);
    expect(route201.land).toHaveLength(12);
    expect(route201.land[0]).toEqual({ species: 'platinum:SPECIES_STARLY', minLevel: 2, maxLevel: 2 });
    expect(route201.land[1]).toEqual({ species: 'platinum:SPECIES_BIDOOF', minLevel: 2, maxLevel: 2 });
    expect(route201.variants.swarm).toEqual([
      { slot: 0, species: 'platinum:SPECIES_DODUO' },
      { slot: 1, species: 'platinum:SPECIES_DODUO' },
    ]);
    expect(report.counts.encounters).toBe(183);
    const behaviours = reg<{ sourceIndex: number; name: string }>('tileBehaviors');
    expect(behaviours.get('platinum:TILE_BEHAVIOR_TALL_GRASS' as Id)).toMatchObject({ sourceIndex: 0x02, name: 'TALL_GRASS' });
    expect(behaviours.get('platinum:TILE_BEHAVIOR_DOOR' as Id)).toMatchObject({ sourceIndex: 0x69, name: 'DOOR' });
  });

  it('builds newGame from StartNewSave and the options', () => {
    expect(pack.registries.newGame).toEqual([
      {
        id: 'platinum:NEW_GAME',
        zone: 'platinum:MAP_HEADER_TWINLEAF_TOWN_PLAYER_HOUSE_2F',
        x: 4,
        z: 6,
        facing: 'up',
        money: 3000,
        label: 'platinum:InitNewGame',
        names: { player: 'Ari', rival: 'Bo' },
        gender: 'female',
        language,
        playerSprite: { male: 'platinum:OBJ_EVENT_GFX_PLAYER_M', female: 'platinum:OBJ_EVENT_GFX_PLAYER_F' },
        playerHealSprite: { male: 'platinum:OBJ_EVENT_GFX_PLAYER_M_POKECENTER_HEAL', female: 'platinum:OBJ_EVENT_GFX_PLAYER_F_POKECENTER_HEAL' },
        playerVsSeekerSprite: { male: 'platinum:OBJ_EVENT_GFX_PLAYER_M_VS_SEEKER', female: 'platinum:OBJ_EVENT_GFX_PLAYER_F_VS_SEEKER' },
        playerCycleSprite: { male: 'platinum:OBJ_EVENT_GFX_PLAYER_M_BIKE', female: 'platinum:OBJ_EVENT_GFX_PLAYER_F_BIKE' },
        playerSurfSprite: { male: 'platinum:OBJ_EVENT_GFX_PLAYER_M_SURF', female: 'platinum:OBJ_EVENT_GFX_PLAYER_F_SURF' },
        messageFont: 'platinum:FONT_MESSAGE',
        unownFont: 'platinum:FONT_UNOWN',
        trainerApproach: 'platinum:scripts_battles/928',
        exclamationSprite: 'platinum:SPRITE_EXCLAMATION',
        doubleExclamationSprite: 'platinum:SPRITE_DOUBLE_EXCLAMATION',
        pockets: [
          { name: 'items', size: 165, max: 999, sorted: false },
          { name: 'medicine', size: 40, max: 999, sorted: false },
          { name: 'balls', size: 15, max: 999, sorted: false },
          { name: 'tmhms', size: 100, max: 99, sorted: true },
          { name: 'berries', size: 64, max: 999, sorted: true },
          { name: 'mail', size: 12, max: 999, sorted: false },
          { name: 'battle_items', size: 30, max: 999, sorted: false },
          { name: 'key_items', size: 50, max: 999, sorted: false },
        ],
        boxNames: [6, ...Array.from({ length: 17 }, (_, i) => i + 7)].map((m, i) => (i ? `platinum:pl_msg_00000018_${String(m).padStart(5, '0')}` : 'platinum:PokemonStorageSystem_Text_Box1')),
        pokeBall: 'platinum:ITEM_POKE_BALL',
        premierBall: 'platinum:ITEM_PREMIER_BALL',
        healMachine: { machine: 'platinum:prop/123', ball: 'platinum:prop/517', hallOfFame: 'platinum:prop/507', screen: 'platinum:prop/124' },
        repelWoreOff: 'platinum:CommonScript_RepelsEffectWoreOff',
        hatchEgg: 'platinum:CommonScript_HatchEgg',
        platformLiftProps: { ironIsland: 'platinum:prop/258', pokemonLeague: 'platinum:prop/502' },
        // The boat trips (boat_cutscene.c): regular_ship, the two Canalave bridges, a cinematic length per direction.
        boat: expect.objectContaining({ ship: 'platinum:prop/34', snowpointShip: 'platinum:prop/538', bridges: ['platinum:prop/31', 'platinum:prop/32'], cinematicFrames: [90, 90, 90, 90], scenes: expect.arrayContaining([expect.objectContaining({ model: 'platinum:MODEL_SHIP_2' })]) }),
        pokedexUnknown: { category: 'platinum:text/711/0', height: 'platinum:text/709/0', weight: 'platinum:text/707/0' },
        // The area map (tests/integration/pokedex.rom.test.ts checks its use).
        pokedexMap: expect.objectContaining({ image: 'platinum:ui2d/pokedex/area_map', origin: [89, 30], dungeonOrigin: [92, 32], cell: 5, columns: 30, rows: 30 }),
        // The Town Map's fly mode (tests/integration/sys-fly.rom.test.ts flies it): 20 fly locations, 182 named cells;
        // sSpawnLocations' fly positions (Twinleaf's first).
        townMap: expect.objectContaining({
          screen: 'platinum:ui2d/town_map/screen',
          matrix: 'platinum:matrix/0',
          cells: expect.toSatisfy((c: unknown[]) => c.length === 182),
          locations: expect.arrayContaining([{ zone: 'platinum:MAP_HEADER_JUBILIFE_CITY', flag: 'platinum:FLAG_FIRST_ARRIVAL_JUBILIFE_CITY', shape: 2, palette: 1, sprite: [31, 164], spawn: 6 }]),
        }),
        flyDestinations: expect.toSatisfy((d: { zone: string; x: number; z: number }[]) => d.length === 20 && d[0]!.zone === 'platinum:MAP_HEADER_TWINLEAF_TOWN' && d[0]!.x === 116 && d[0]!.z === 886),
        // sRibbonDataTable: 80 ribbons; a special (Mystery Gift) description is the fresh save's SPECIAL_DESCRIPTIONS_START.
        ribbons: expect.arrayContaining([
          { name: 'platinum:RibbonName_Text_HoennChampion', description: 'platinum:RibbonDesc_Text_HoennChampion' },
          { name: 'platinum:RibbonName_Text_Red', description: 'platinum:pl_msg_00000535_00146' },
        ]),
        gameRecords: { scoreIncrements: expect.any(Array), highLimit: expect.any(Array) },
        // The side systems' tables (tests/integration/side-systems.rom.test.ts checks them).
        berries: expect.objectContaining({ soil: 'platinum:OBJ_EVENT_GFX_BERRY_SOIL', sprout: 'platinum:OBJ_EVENT_GFX_BERRY_SPROUT' }),
        amitySquare: expect.objectContaining({ stepVar: 'platinum:VAR_AMITY_SQUARE_STEP_COUNT' }),
        seals: expect.objectContaining({ types: expect.toSatisfy((t: unknown[]) => t.length === 81), marts: expect.toSatisfy((m: unknown[]) => m.length === 7) }),
        underground: expect.objectContaining({ zone: 'platinum:MAP_HEADER_UNDERGROUND' }),
        // The Game Corner, the Villa, the journal and the diplomas (game-corner.rom.test.ts and villa-journal.rom.test.ts check them).
        slots: expect.objectContaining({ modes: expect.toSatisfy((m: unknown[]) => m.length === 12) }),
        villa: expect.any(Object),
        journal: expect.objectContaining({ gyms: expect.toSatisfy((g: unknown[]) => g.length === 8) }),
        tv: expect.objectContaining({ programs: expect.toSatisfy((p: unknown[]) => p.length === 9) }),
        diploma: expect.objectContaining({ sinnoh: 'platinum:ui2d/diploma/sinnoh', national: 'platinum:ui2d/diploma/national' }),
        contestHallFlag: 'platinum:FLAG_CONTEST_HALL_VISITED',
        // The start menu's objectives (objectives.ts): our texts, the first and last steps' checks.
        objectives: expect.objectContaining({
          title: 'platinum:OpenSinnoh_Objective_Title',
          explore: 'platinum:OpenSinnoh_Objective_Explore',
          steps: expect.arrayContaining([
            { text: 'platinum:OpenSinnoh_Objective_VisitBarry', done: [{ kind: 'flag', flag: 'platinum:FLAG_RIVAL_LEFT_HOME' }, { kind: 'var', var: 'platinum:VAR_PLAYER_STARTER', atLeast: 1 }], to: 'platinum:MAP_HEADER_TWINLEAF_TOWN' },
            { text: 'platinum:OpenSinnoh_Objective_StarkDepths', done: [{ kind: 'flag', flag: 'platinum:FLAG_BATTLED_STARK_MOUNTAIN_ROOM_3_HEATRAN' }, { kind: 'flag', flag: 'platinum:FLAG_CAUGHT_HEATRAN' }] },
          ]),
        }),
        // The contests' tables (tests/integration/contests.rom.test.ts checks them).
        contests: expect.objectContaining({ playerSprite: { male: 'platinum:OBJ_EVENT_GFX_PLAYER_M_CONTEST', female: 'platinum:OBJ_EVENT_GFX_PLAYER_F_CONTEST' } }),
        specialEncounters: expect.objectContaining({ swarms: expect.toSatisfy((z: unknown[]) => z.length === 22) }),
        moveTutors: expect.objectContaining({ shards: ['platinum:ITEM_RED_SHARD', 'platinum:ITEM_BLUE_SHARD', 'platinum:ITEM_YELLOW_SHARD', 'platinum:ITEM_GREEN_SHARD'] }),
        npcTrades: expect.toSatisfy((t: unknown[]) => t.length === 4),
        gyms: expect.any(Object),
        containment: { prop: 'platinum:prop/496', loopFrames: 61, openingFrames: 3 },
        spearPillar: expect.any(Object),
        // The Distortion World's shared overlay 9 tables (distortion/distortion.rom.test.ts checks them).
        distortionWorld: expect.objectContaining({ playerSprite: { male: 'platinum:OBJ_EVENT_GFX_DIST_WORLD_PLAYER_M', female: 'platinum:OBJ_EVENT_GFX_DIST_WORLD_PLAYER_F' } }),
        sizeIntervals: expect.any(Array),
        // The Battle Frontier's tables: checked in tests/integration/frontier.rom.test.ts.
        frontier: expect.objectContaining({ trainerMessages: expect.any(String) }),
        // The Great Marsh (tests/integration/safari.rom.test.ts checks the tables' use).
        greatMarsh: expect.objectContaining({
          flag: 'platinum:FLAG_SAFARI_GAME_ACTIVE',
          zones: [1, 2, 3, 4, 5, 6].map((n) => `platinum:MAP_HEADER_GREAT_MARSH_${n}`),
          labels: { outOfSteps: 'platinum:SafariGame_OutOfSteps', outOfBalls: 'platinum:SafariGame_OutOfSafariBalls_Field', outOfBallsBattle: 'platinum:SafariGame_OutOfSafariBalls_Battle', retire: 'platinum:SafariGame_Retire', noRoom: 'platinum:SafariGame_OutOfRoomForPokemon' },
          tram: 'platinum:prop/475',
        }),
        // sEndCreditStringProps (overlay 99): 237 rows in US, 224 in German, the first two centred, the last the final screen's.
        creditsRide: expect.objectContaining({ models: expect.any(Array), rows: expect.any(Array), nightTrees: expect.any(Array) }),
        credits: expect.arrayContaining(
          language === 5
            ? [
                { text: 'platinum:pl_msg_00000548_00000', y: 0, centered: true },
                { text: 'platinum:pl_msg_00000548_00002', y: 171, centered: false },
                { text: 'platinum:pl_msg_00000548_00223', y: 7562, centered: false },
              ]
            : [
                { text: 'platinum:pl_msg_00000548_00000', y: 0, centered: true },
                { text: 'platinum:pl_msg_00000548_00002', y: 146, centered: false },
                { text: 'platinum:pl_msg_00000548_00236', y: 7581, centered: false },
              ],
        ),
      },
    ]);
    expect((pack.registries.newGame![0] as unknown as NewGame).credits).toHaveLength(language === 5 ? 224 : 237);
    // The SHA1-checked gym tables (structure and names only; overlay 8 gym_features.c).
    const gyms = (pack.registries.newGame![0] as unknown as NewGame).gyms!;
    expect(gyms.eterna).toMatchObject({ zone: 'platinum:MAP_HEADER_ETERNA_CITY_GYM', clockVar: 'platinum:VAR_ETERNA_GYM_FLOWER_CLOCK_STATE', message: 'platinum:EternaGym_Text_FountainWaterLevelDropped' });
    expect([gyms.eterna.times.length, gyms.eterna.clock.length, gyms.veilstone.bags.length, gyms.veilstone.stacks.length, gyms.veilstone.track.length]).toEqual([5, 5, 9, 11, 1024]);
    expect(gyms.hearthome.rooms.map((r) => [r.zone, r.doorCount, r.doors.length])).toEqual([
      ['platinum:MAP_HEADER_HEARTHOME_CITY_GYM_TRAINER_ROOM_1', 3, 3],
      ['platinum:MAP_HEADER_HEARTHOME_CITY_GYM_TRAINER_ROOM_2', 5, 5],
    ]);
    // The SHA1-checked game record tables: one increment per score event, one limit per record (structure only).
    const { scoreIncrements, highLimit } = (pack.registries.newGame![0] as unknown as NewGame).gameRecords;
    expect(scoreIncrements).toHaveLength(51);
    expect(scoreIncrements.every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    expect(highLimit).toHaveLength(148);
    // The decomp's initializer: RECORD_STEPS high, RECORD_UNK_003 and RECORD_CAUGHT_POKEMON low.
    expect([highLimit[0], highLimit[3], highLimit[9]]).toEqual([true, false, false]);
  });

  it('loads as a pack; every record and IR reference resolves', () => {
    const loaded = loadPacks([pack], '0.1.0', (registry) => {
      if (!(REGISTRIES as readonly string[]).includes(registry)) throw new Error(`unknown registry ${registry}`);
    });
    const known = new Set<string>([...Object.values(loaded.registries).flatMap((m) => [...m.keys()]), ...loaded.labels.keys(), ...[...assets.keys()].map((p) => `platinum:${p}`)]);
    const missing = new Set<string>();
    // Trainer classes, egg groups and battle effects are plain ids with no registry.
    const walk = (v: JsonValue, key: string) => {
      if (typeof v === 'string' && /^platinum:[A-Z_]|^platinum:[a-z]+\/\d/.test(v) && key !== 'id' && key !== 'class' && key !== 'eggGroups' && key !== 'effect' && key !== 'battleEffects' && key !== 'relicBadge' && key !== 'badge' && !known.has(v)) missing.add(v);
      else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, k));
    };
    for (const records of Object.values(loaded.registries)) for (const r of records.values()) walk(r as RegistryRecord, '');
    for (const cmds of Object.values(pack.scripts.labels)) for (const c of cmds) for (const a of c.args) if ('id' in a && !known.has(a.id)) missing.add(a.id);
    expect([...missing]).toEqual([]);
  });

  it('keys sprites by object gfx: billboards for walk and static sets, model objects otherwise', () => {
    const sprites = reg<{ sourceIndex: number; atlas?: string; model?: string | null; frameCount?: number; frameSize?: number; animations?: Record<string, { frame: number; ticks: number }[]> }>('sprites');
    expect(sprites.get('platinum:OBJ_EVENT_GFX_PLAYER_M')).toMatchObject({ sourceIndex: 0, atlas: 'platinum:sprites/90.png' });
    expect(sprites.get('platinum:OBJ_EVENT_GFX_MAILBOX')).toMatchObject({ model: 'platinum:MODEL_FLDEFF_70' });
    expect(assets.has('models/fldeff/70/model.gltf')).toBe(true);
    // Shaped billboards: the Galactic HQ door (its 16×32 slab, galactic_hq_door.nsbmd with its texture set),
    // the Celestic ruin wall and its shards are drawn, and the grunt groups (gset1, gset2: one wide quad on a
    // full-billboard node, under the anchor offset node).
    expect(sprites.get('platinum:OBJ_EVENT_GFX_GALACTIC_HQ_DOOR')).toMatchObject({ model: 'platinum:MODEL_MMODEL_436_369' });
    expect(assets.has('models/mmodel/436-369/model.gltf')).toBe(true);
    for (const gfx of ['CAVE_PAINTING', 'CAVE_PAINTING_SHARDS_LEFT', 'CAVE_PAINTING_SHARDS_RIGHT']) expect(sprites.get(`platinum:OBJ_EVENT_GFX_${gfx}`)!.model).toMatch(/^platinum:MODEL_MMODEL_/);
    for (const [gfx, member, textures] of [['GRUNTS_GROUP_OF_4', 441, 411], ['GRUNTS_GROUP_OF_3', 444, 412]] as const) {
      expect(sprites.get(`platinum:OBJ_EVENT_GFX_${gfx}`)).toMatchObject({ model: `platinum:MODEL_MMODEL_${member}_${textures}` });
      const gltf = JSON.parse(new TextDecoder().decode(assets.get(`models/mmodel/${member}-${textures}/model.gltf`))) as { scene: number; scenes: { nodes: number[] }[]; nodes: { translation?: number[]; children?: number[]; mesh?: number; extras?: { lantern?: { billboard?: string } } }[] };
      const offset = gltf.nodes[gltf.scenes[gltf.scene]!.nodes[0]!]!;
      expect(offset.translation).toEqual([0, 0, 6]);
      expect(offset.children!.map((c) => gltf.nodes[c]!.extras?.lantern?.billboard)).toEqual(['full']);
    }
    // Static sets in the slice: the briefcase and the Poké Ball show one frame, Starly loops its 4.
    expect(sprites.get('platinum:OBJ_EVENT_GFX_BRIEFCASE')).toMatchObject({ atlas: 'platinum:sprites/153.png', frameSize: 32, frameCount: 1 });
    expect(sprites.get('platinum:OBJ_EVENT_GFX_POKEBALL')).toMatchObject({ atlas: 'platinum:sprites/85.png', frameSize: 16, frameCount: 1 });
    const starly = sprites.get('platinum:OBJ_EVENT_GFX_STARLY')!;
    expect(starly).toMatchObject({ frameCount: 4 });
    expect(starly.animations!['stand-down']).toEqual([{ frame: 0, ticks: 1 }]);
    expect(starly.animations!['walk-left']!.map((f) => f.frame)).toEqual([0, 1, 2, 3]);
    expect(assets.has('sprites/153.png')).toBe(true);
    // Frame-table sets: the nurse walks and bows, the heal set gives and receives (21 ticks each).
    const nurse = sprites.get('platinum:OBJ_EVENT_GFX_POKECENTER_NURSE')!.animations!;
    expect(nurse['walk-down']).toHaveLength(4);
    expect(nurse['pose-bow']!.reduce((n, f) => n + f.ticks, 0)).toBe(5);
    const heal = sprites.get('platinum:OBJ_EVENT_GFX_PLAYER_M_POKECENTER_HEAL')!.animations!;
    expect(['pose-give', 'pose-receive'].map((k) => heal[k]!.reduce((n, f) => n + f.ticks, 0))).toEqual([21, 21]);
    expect(Object.keys(sprites.get('platinum:OBJ_EVENT_GFX_PLAYER_M_POKETCH')!.animations!)).toContain('pose-poketch-left');
    // Left as model: null: gfx 117 and 119, the berry soil (its plant is drawn instead), the invisible gfx (the snowball is the fldeff model).
    expect(sprites.get('platinum:OBJ_EVENT_GFX_GIRATINA_ORIGIN')).toMatchObject({ atlas: 'platinum:sprites/393.png', frameSize: 128, frameCount: 2 });
    expect(sprites.get('platinum:OBJ_EVENT_GFX_GIRATINA_ORIGIN')!.animations!['stand-down']).toEqual([{ frame: 0, ticks: 10 }, { frame: 1, ticks: 10 }]);
    expect([...sprites.values()].filter((s) => s.model === null)).toHaveLength(4);
    // The berry sprout and trees (berry_tree frame sequence): square cells, the sway looping while they stand.
    expect(sprites.get('platinum:OBJ_EVENT_GRAPHICS_CHERI_FRUIT')).toMatchObject({ frameSize: 32, frameCount: 2 });
    expect(sprites.get('platinum:OBJ_EVENT_GFX_BERRY_SPROUT')!.animations!['stand-up']).toHaveLength(2);
    expect(report.unknowns['sprite-model']).toHaveLength(1);
    expect(sprites.get('platinum:SPRITE_EXCLAMATION')).toMatchObject({ frameSize: 16, frameCount: 1 });
  });

  it('gives door props open/close clips: BCA joint clips, or BTP0 texture patterns (the elevator door)', () => {
    const props = reg<{ sourceIndex: number; model: string; animations?: Record<string, { clip: string; ticks: number }> }>('props');
    const anims = reg<{ id: string; kind: string; texture?: string; frames: { texture: string; ticks: number }[] }>('textureAnimations');
    const doors = [...props.values()].filter((p) => p.animations?.open);
    // All 20 models of the decomp door table (DoorAnimation_FindDoorAndLoad doorModelIDs).
    expect(doors).toHaveLength(20);
    for (const d of doors) {
      expect(Object.keys(d.animations!)).toEqual(['open', 'close']);
      if (d.sourceIndex === 75) continue;
      const gltf = JSON.parse(new TextDecoder().decode(assets.get(d.model.replace('platinum:MODEL_BUILD_', 'models/build/') + '.gltf'))) as { animations: { name: string }[] };
      expect(gltf.animations.map((a) => a.name)).toEqual(['open', 'close']);
    }
    // elevator_door: bm_anime 51/52 (ele_door1_op/_cl, 8 frames) swap ele_door.1-4 on its one material.
    const elevator = doors.find((d) => d.sourceIndex === 75)!;
    const open = anims.get(elevator.animations!.open!.clip as Id)!;
    const close = anims.get(elevator.animations!.close!.clip as Id)!;
    expect(elevator.animations).toMatchObject({ open: { ticks: 8 }, close: { ticks: 8 } });
    expect([open.kind, open.texture, close.texture]).toEqual(['frames', 'ele_door.1', 'ele_door.1']);
    expect(open.frames.map((f) => f.ticks)).toEqual([1, 4, 2, 1]);
    expect(close.frames.map((f) => f.ticks)).toEqual([1, 2, 4, 1]);
    const listed = new Set([...assets.keys()].filter((k) => k.startsWith('textures/build/') && k.endsWith('.png')).map((k) => k.replace(/^.*\//, '').replace(/__.*$/, '')));
    for (const f of [...open.frames, ...close.frames]) expect(listed.has(f.texture), f.texture).toBe(true);
    // The elevator door's model lists no texture animation: its clips are not loops.
    expect(reg<{ animations?: string[] }>('models').get(elevator.model as Id)!.animations).toBeUndefined();
  });

  it('gives the PC props boot-up and shut-down clips (decomp pc_animation.c): BTP0 patterns on one texture', () => {
    const props = reg<{ sourceIndex: number; animations?: Record<string, { clip: string; ticks: number }> }>('props');
    const anims = reg<{ kind: string; texture?: string; frames: { texture: string; ticks: number }[] }>('textureAnimations');
    const pcs = [...props.values()].filter((p) => p.animations?.['pc-on']);
    // pcMapProps: desk_drawer_laptop (112), …_facing_right (115), pokecenter_pc (119), …_facing_left (248).
    expect(pcs.map((p) => p.sourceIndex).sort((a, b) => a - b)).toEqual([112, 115, 119, 248]);
    for (const p of pcs) {
      expect(Object.keys(p.animations!)).toEqual(['pc-on', 'pc-off']);
      const [on, off] = [anims.get(p.animations!['pc-on']!.clip as Id)!, anims.get(p.animations!['pc-off']!.clip as Id)!];
      expect([on.kind, off.kind]).toEqual(['frames', 'frames']);
      expect(on.texture).toBe(off.texture);
      expect(on.frames.reduce((n, f) => n + f.ticks, 0)).toBe(p.animations!['pc-on']!.ticks);
    }
  });

  it('converts the looping prop animations: BCA0 clips, BTA0 scrolls and BTP0 patterns', () => {
    const props = reg<{ model: string; animations?: Record<string, { clip: string; ticks: number; loop?: boolean }> }>('props');
    const loops = [...props.values()].filter((p) => p.animations?.loop);
    expect(loops.length).toBe(15);
    expect(props.get('platinum:prop/496')!.animations!.opening).toEqual({ clip: 'opening', ticks: 3 });
    for (const p of loops) {
      expect(p.animations!.loop).toMatchObject({ clip: 'loop', loop: true });
      const gltf = JSON.parse(new TextDecoder().decode(assets.get(p.model.replace('platinum:MODEL_BUILD_', 'models/build/') + '.gltf'))) as { animations: { name: string }[] };
      expect(gltf.animations.map((a) => a.name)).toContain('loop');
    }
    const anims = reg<{ id: string; kind: string; texture?: string; frames: unknown }>('textureAnimations');
    const patterns = [...anims.values()].filter((a) => a.kind === 'frames' && a.id.startsWith('platinum:TEXANIM_BUILD_'));
    // 16 loops, the elevator doors, 4 PCs' boot/shutdown patterns, and the healing ball's and machine screen's one-shots.
    expect(patterns.length).toBe(28);
    // Every pattern frame is a listed texture in some prop set.
    const listed = new Set([...assets.keys()].filter((k) => k.startsWith('textures/build/') && k.endsWith('.png')).map((k) => k.replace(/^.*\//, '').replace(/__.*$/, '')));
    for (const a of patterns) for (const f of a.frames as { texture: string }[]) expect(listed.has(f.texture), f.texture).toBe(true);
    // Scripted animations (bike slopes, gym puzzles) are not loops.
    expect(report.unknowns.asset!.some((w) => w.startsWith('prop animation not converted (scripted/one-shot'))).toBe(true);
  });

  it('decodes the weather task table: fog, particles, darkness and yearly weathers', () => {
    const weathers = reg<{ name: string; particles?: { kind: string; count: number; sprites: { image: string; cells: { w: number; h: number }[]; frames: number[] }; spawner: unknown }; fog?: { slope: number; offset: number; densities: number[] }; darkness?: { radius: number }; yearly?: string[]; pending?: unknown }>('weathers');
    const w = (n: string) => weathers.get(`platinum:${n}`)!;
    // Weather BG layers we do not import yet: SLOW_ASHFALL, 20, 23–25.
    expect([...weathers.values()].filter((x) => x.pending).map((x) => [x.name, x.pending])).toEqual(['SLOW_ASHFALL', '20', '23', '24', '25'].map((n) => [n, ['layer']]));
    expect(w('OVERWORLD_WEATHER_FOG').fog).toMatchObject({ slope: 6, offset: 30037 });
    expect(w('OVERWORLD_WEATHER_FOG').fog!.densities.slice(0, 3)).toEqual([0, 4, 8]);
    expect(w('OVERWORLD_WEATHER_BLIZZARD').particles).toMatchObject({ kind: 'blizzard', count: 48, spawner: { load: [10, 1], steady: [10, 1], prewarm: [20, 2, 2] } });
    // The OAM sets (weather_sys members 61–64): heavy snow's four 8×8 flakes; rain's three streaks (32, 48 and 64 rows)
    // and its splash, all ending 64 rows under the sprite; the snowing set shows its flakes in reverse frame order.
    const heavy = w('OVERWORLD_WEATHER_HEAVY_SNOW').particles!.sprites;
    expect(heavy.image).toBe('platinum:weather/sprites1.png');
    expect(heavy.cells.map((c) => [c.w, c.h])).toEqual([[8, 8], [8, 8], [8, 8], [8, 8]]);
    expect(w('OVERWORLD_WEATHER_RAINING').particles!.sprites.cells.map((c) => c.h)).toEqual([32, 48, 64, 8]);
    expect(w('OVERWORLD_WEATHER_SNOWING').particles!.sprites.frames).toEqual([3, 2, 1, 0]);
    expect(w('OVERWORLD_WEATHER_DARK_FLASH').darkness).toEqual({ radius: 32 });
    expect(w('weather/24').fog!.densities.slice(0, 4)).toEqual([0x38, 0x30, 0x28, 0x20]);
    expect(w('OVERWORLD_WEATHER_ROUTE_216').yearly).toHaveLength(366);
    expect(w('OVERWORLD_WEATHER_ROUTE_212_SOUTH').yearly![0]).toBe('platinum:OVERWORLD_WEATHER_RAINING');
  });

  it('imports the weather BG layers: cloud shade, fog veil, sand and snow (Unk_ov5_021F8D90)', () => {
    const weathers = reg<{ name: string; layer?: { image: string; scroll: [number, number]; alpha: number; under?: true } }>('weathers');
    const layers = Object.fromEntries([...weathers.values()].filter((x) => x.layer).map((x) => [x.name, x.layer]));
    expect(layers).toEqual({
      CLOUDY: { image: 'platinum:weather/bg5.png', scroll: [0, 0], alpha: 4 / 16 },
      BLIZZARD: { image: 'platinum:weather/bg0.png', scroll: [24, -12], alpha: 1 },
      SANDSTORM: { image: 'platinum:weather/bg1.png', scroll: [12, -6], alpha: 1 },
      FOG: { image: 'platinum:weather/bg6.png', scroll: [0, 0], alpha: 9 / 16 },
      DEEP_FOG: { image: 'platinum:weather/bg6.png', scroll: [0, 0], alpha: 9 / 16 },
      '21': { image: 'platinum:weather/bg0.png', scroll: [6, -6], alpha: 1 },
      // Behind the 3D field (BG2 priority 3): the League's white sky, and CLEAR_13's BG.
      CLEAR_8: { image: 'platinum:weather/bg6.png', scroll: [0, 0], alpha: 1, under: true },
      CLEAR_13: { image: 'platinum:weather/bg8.png', scroll: [0, 0], alpha: 1, under: true },
    });
    expect([...assets.keys()].filter((k) => k.startsWith('weather/bg')).sort()).toEqual(['weather/bg0.png', 'weather/bg1.png', 'weather/bg5.png', 'weather/bg6.png', 'weather/bg8.png']);
    // The cloud and fog BGs are one flat colour: dark slate (7, 7, 8) and white.
    const pixel = (path: string) => [...decodeImage(assets.get(path)!).rgba.subarray(0, 4)];
    expect(pixel('weather/bg5.png')).toEqual([58, 58, 66, 255]);
    expect(pixel('weather/bg6.png')).toEqual([255, 255, 255, 255]);
  });

  it('imports the field effects from fldeff: models, pattern splashes and billboards', () => {
    const effects = reg<{ name: string; model?: string; sprite?: string; animations?: Record<string, { clip: string; ticks: number; loop?: boolean }> }>('fieldEffects');
    const e = (n: string) => effects.get(`platinum:FIELD_EFFECT_${n}`)!;
    expect(e('SHADOW').model).toBe('platinum:MODEL_FLDEFF_17');
    expect(e('SURF_BLOB').model).toBe('platinum:MODEL_FLDEFF_81');
    expect(e('PUDDLE_SPLASH').animations!.splash).toMatchObject({ ticks: 12 });
    expect(e('TALL_GRASS').animations).toEqual({ rustle: { clip: 'rustle', ticks: 13 } });
    // The world holds grass once its clip has played: the DS checks the occupant on update 13 (grass) and 3 (mud grass).
    expect(e('VERY_TALL_GRASS').animations).toEqual({ rustle: { clip: 'rustle', ticks: 13 } });
    expect(e('MUD_GRASS').animations).toEqual({ rustle: { clip: 'rustle', ticks: 3 } });
    expect(e('SHALLOW_WATER_RIPPLE').animations!.ripple!.loop).toBe(true);
    const sprites = reg<{ frameCount: number; animations: Record<string, { frame: number; ticks: number }[]> }>('sprites');
    expect(sprites.get(e('TALL_GRASS').sprite! as Id)!.animations.rustle).toEqual([{ frame: 0, ticks: 4 }, { frame: 1, ticks: 4 }, { frame: 2, ticks: 4 }, { frame: 3, ticks: 1 }]);
    expect(assets.has('models/fldeff/15/index.json')).toBe(true);
  });

  it('imports the Cut and Rock Smash animations from hiden_effect (ov6_02248050.c)', () => {
    const effects = reg<{ name: string; model?: string; sourceIndex?: number; animations?: Record<string, { clip: string; ticks: number }> }>('fieldEffects');
    expect(effects.get('platinum:FIELD_EFFECT_CUT' as Id)).toEqual({ id: 'platinum:FIELD_EFFECT_CUT', name: 'CUT', model: 'platinum:MODEL_HIDEN_EFFECT_3', animations: { cut: { clip: 'cut', ticks: 45 } } });
    expect(effects.get('platinum:FIELD_EFFECT_ROCK_SMASH' as Id)).toEqual({ id: 'platinum:FIELD_EFFECT_ROCK_SMASH', name: 'ROCK_SMASH', model: 'platinum:MODEL_HIDEN_EFFECT_8', animations: { smash: { clip: 'smash', ticks: 45 } } });
    const models = reg<{ gltf: string; animations?: string[] }>('models');
    expect(models.get('platinum:MODEL_HIDEN_EFFECT_3' as Id)!.animations).toBeUndefined();
    expect(models.get('platinum:MODEL_HIDEN_EFFECT_8' as Id)!.animations).toEqual(['platinum:TEXANIM_HIDEN_EFFECT_8_lambert3']);
    const dust = reg<{ kind: string; texture: string; frames: { texture: string; ticks: number }[] }>('textureAnimations').get('platinum:TEXANIM_HIDEN_EFFECT_8_lambert3' as Id)!;
    expect(dust).toMatchObject({ kind: 'frames', texture: 'kemuri.1' });
    expect(dust.frames.map((f) => f.ticks)).toEqual([8, 9, 7, 8, 8, 5]);
    // The joint clips are glTF animations named after the use, 45 frames at 30 fps.
    for (const [m, clip] of [[3, 'cut'], [8, 'smash']] as const) {
      const gltf = JSON.parse(new TextDecoder().decode(assets.get(`models/hiden_effect/${m}/model.gltf`))) as { animations: { name: string }[] };
      expect(gltf.animations.map((a) => a.name)).toEqual([clip]);
    }
    expect(JSON.parse(new TextDecoder().decode(assets.get('models/hiden_effect/8/index.json')))).toHaveLength(6);
  });

  it('imports the elevator lights as on-demand scrolls on build model 498 (FieldTask_PlayElevatorAnimation)', () => {
    const props = [...reg<{ model: string; animations?: Record<string, { clip: string; ticks: number; loop?: boolean }> }>('props').values()].filter((p) => p.model === 'platinum:MODEL_BUILD_498');
    expect(props).toHaveLength(1);
    expect(props[0]!.animations).toEqual({
      'elevator-up': { clip: 'platinum:TEXANIM_BUILD_498_ev_o01_up', ticks: 31 },
      'elevator-down': { clip: 'platinum:TEXANIM_BUILD_498_ev_o01_down', ticks: 31 },
    });
    const anims = reg<{ kind: string; material: string; frames: number; translateS: number; translateT: number[] }>('textureAnimations');
    const up = anims.get('platinum:TEXANIM_BUILD_498_ev_o01_up' as Id)!;
    const down = anims.get('platinum:TEXANIM_BUILD_498_ev_o01_down' as Id)!;
    expect(up).toMatchObject({ kind: 'scroll', material: 'ev_o01', frames: 31, translateS: 0 });
    // One texture height per 31 frames: up scrolls T down to -1, down up to +1.
    expect([up.translateT[0], up.translateT[15], up.translateT[30]]).toEqual([0, -0.5, -1]);
    expect([down.translateT[0], down.translateT[15], down.translateT[30]]).toEqual([0, 0.5, 1]);
    // Not a model-wide animation: the renderer plays it only through FieldView.elevatorLights.
    expect(reg<{ animations?: string[] }>('models').get('platinum:MODEL_BUILD_498' as Id)!.animations).toBeUndefined();
  });

  it('gives water, waterfall and rock-climb behaviours their FIELD_MOVES scripts', () => {
    const b = reg<{ name: string; fieldMove?: { move: string; label: string } }>('tileBehaviors');
    const by = (n: string) => [...b.values()].find((x) => x.name === n)!.fieldMove;
    expect(by('WATER_SEA')).toEqual({ move: 'platinum:MOVE_SURF', label: 'platinum:FieldMoves_Water' });
    expect(by('WATERFALL')).toEqual({ move: 'platinum:MOVE_WATERFALL', label: 'platinum:FieldMoves_Waterfall' });
    expect(by('ROCK_CLIMB_E_W')).toEqual({ move: 'platinum:MOVE_ROCK_CLIMB', label: 'platinum:FieldMoves_RockyWall' });
    expect(by('PUDDLE')).toBeUndefined();
  });

  it('imports bg facing axes (BG_EVENT_DIR_WEST_EAST / NORTH_SOUTH)', () => {
    const facings = [...reg<Zone>('zones').values()].flatMap((z) => z.events.bgs.map((b) => b.facing));
    expect(facings.filter((f) => f === 'horizontal')).toHaveLength(1);
    expect(report.unknowns['bg-facing']).toBeUndefined();
  });
});
