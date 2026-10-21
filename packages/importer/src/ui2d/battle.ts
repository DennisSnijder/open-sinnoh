/**
 * Battle art: the backgrounds (pl_batt_bg, decomp battle_main.c BattleSystem_SetupBattleScreen), the
 * platforms (pl_batt_obj, terrain.c), the healthboxes and their parts (healthbox.c), the party gauge
 * (party_gauge.c), the type and category icons (type_icon.c) and the thrown balls
 * (battle_anim/ov12_02235E94.c). pl_batt_obj member numbers follow res/graphics/battle/sprites.order.
 */
import type { BattleBackground, BattlePlatform, BattleTerrain } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, renderCell, type CellImage } from './compose.ts';
import { readNcer } from './ncer.ts';
import { charactersOf, PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555 } from './nitro2d.ts';
import { encodeImage } from './png.ts';
import type { Sheets } from './sheets.ts';
import { readSpa, spaTexture } from '../battle/spa.ts';

const BATT_BG = { path: '/battle/graphic/pl_batt_bg.narc', count: 342 };
const BATT_OBJ = { path: '/battle/graphic/pl_batt_obj.narc', count: 343 };

/** decomp BACKGROUND_* (generated/battle_backgrounds.txt). The first six have day/twilight/night palettes (BattleSystem_GetBackgroundTimeOffset). */
export const BACKGROUNDS = ['PLAIN', 'WATER', 'CITY', 'FOREST', 'MOUNTAIN', 'SNOW', 'INDOORS_1', 'INDOORS_2', 'INDOORS_3', 'CAVE_1', 'CAVE_2', 'CAVE_3', 'AARON', 'BERTHA', 'FLINT', 'LUCIAN', 'CYNTHIA', 'DISTORTION_WORLD', 'BATTLE_TOWER', 'BATTLE_FACTORY', 'BATTLE_ARCADE', 'BATTLE_CASTLE', 'BATTLE_HALL'];
const TIMED_BACKGROUNDS = 6;
const TIMES = ['day', 'twilight', 'night'] as const;
/** pl_batt_bg: the shared BG3 tilemap, each background's 8bpp tiles and its three palettes. */
const BG_TILEMAP = 2;
const bgTiles = (bg: number) => 3 + bg;
const bgPalette = (bg: number, time: number) => 172 + bg * 3 + time;

/**
 * pl_batt_obj platform graphics (sprites.order `terrain/<name>/{player,enemy}.NCGR.lz` and the
 * `{day,evening,night}`/`all` palettes), by graphic name: [player NCGR, enemy NCGR, first palette].
 */
const PLATFORM_GFX: Record<string, [number, number, number]> = {
  grass: [127, 130, 1],
  water: [133, 134, 4],
  path: [135, 136, 7],
  ice: [137, 138, 10],
  rocky: [139, 140, 13],
  snow: [141, 142, 16],
  indoors: [143, 144, 19],
  sand: [145, 146, 22],
  mud: [147, 148, 25],
  cave: [149, 150, 28],
  path_puddles: [151, 152, 31],
  league_aaron: [153, 154, 34],
  league_bertha: [155, 156, 37],
  league_flint: [157, 158, 40],
  league_lucian: [159, 160, 43],
  league_cynthia: [161, 162, 46],
  distortion_world: [163, 164, 49],
  battle_tower: [165, 166, 52],
  battle_factory: [167, 168, 55],
  battle_arcade: [169, 170, 58],
  battle_castle: [171, 172, 61],
  battle_hall: [173, 174, 64],
  giratina: [175, 176, 67],
};
const PLATFORM_CELLS = { player: { ncer: 128, nanr: 129 }, enemy: { ncer: 131, nanr: 132 } };
/** decomp TERRAIN_* with terrain.c's sources: [player graphic, enemy graphic, palette graphic]. */
const TERRAINS: [string, string, string, string][] = [
  ['PLAIN', 'path', 'path', 'path'],
  ['SAND', 'sand', 'sand', 'sand'],
  ['GRASS', 'grass', 'grass', 'grass'],
  ['PUDDLE', 'path_puddles', 'path_puddles', 'path_puddles'],
  ['MOUNTAIN', 'rocky', 'rocky', 'rocky'],
  ['CAVE', 'cave', 'cave', 'cave'],
  ['SNOW', 'snow', 'snow', 'snow'],
  ['WATER', 'water', 'water', 'water'],
  ['ICE', 'ice', 'ice', 'ice'],
  ['BUILDING', 'indoors', 'indoors', 'indoors'],
  ['GREAT_MARSH', 'mud', 'mud', 'mud'],
  // As in the decomp: the bridge's player platform is the puddle path, the enemy's the marsh, both in the marsh palettes.
  ['BRIDGE', 'path_puddles', 'mud', 'mud'],
  ['AARON', 'league_aaron', 'league_aaron', 'league_aaron'],
  ['BERTHA', 'league_bertha', 'league_bertha', 'league_bertha'],
  ['FLINT', 'league_flint', 'league_flint', 'league_flint'],
  ['LUCIAN', 'league_lucian', 'league_lucian', 'league_lucian'],
  ['CYNTHIA', 'league_cynthia', 'league_cynthia', 'league_cynthia'],
  ['DISTORTION_WORLD', 'distortion_world', 'distortion_world', 'distortion_world'],
  ['BATTLE_TOWER', 'battle_tower', 'battle_tower', 'battle_tower'],
  ['BATTLE_FACTORY', 'battle_factory', 'battle_factory', 'battle_factory'],
  ['BATTLE_ARCADE', 'battle_arcade', 'battle_arcade', 'battle_arcade'],
  ['BATTLE_CASTLE', 'battle_castle', 'battle_castle', 'battle_castle'],
  ['BATTLE_HALL', 'battle_hall', 'battle_hall', 'battle_hall'],
  ['GIRATINA', 'giratina', 'giratina', 'giratina'],
];
/** Resting positions (battle_display.c: enemy 24·8, 8·11; player 64, 128 + 8) and slide-in starts (terrain.c sTerrainSpriteTemplates). */
const PLATFORM_AT = { player: { x: 64, y: 136, start: [336, 136] as [number, number] }, enemy: { x: 192, y: 88, start: [-80, 88] as [number, number] } };

/** Healthbox sets (healthbox.c templates): [characters, cells, animations, palette]; palette 71 = healthbox/primary, 81 = safari. */
const HEALTHBOXES: Record<string, [number, number, number, number]> = {
  enemy: [188, 187, 186, 71],
  player_singles: [191, 190, 189, 71],
  player_doubles: [200, 199, 198, 71],
  safari: [253, 254, 255, 81],
  arrows_thin: [182, 181, 180, 71],
  arrows_wide: [185, 184, 183, 71],
};
/**
 * The healthbox parts strip (healthbox.c sHealthBoxPartsBitmap, embedded in the battle overlay 16):
 * 78 4bpp characters in HealthBoxPart order, drawn with the primary healthbox palette.
 */
export const HEALTHBOX_PARTS = { overlay: 16, offset: 0x3456c, size: 78 * 32 };
const PART_NAMES = [
  'hp_h', 'hp_p',
  ...['green', 'yellow', 'red'].flatMap((c) => Array.from({ length: 9 }, (_, i) => `hp_${c}_fill_${i}`)),
  ...Array.from({ length: 9 }, (_, i) => `exp_fill_${i}`),
  ...['healthy', 'paralysis', 'freeze', 'sleep', 'poison', 'burn', 'empty'].flatMap((s) => [0, 1, 2].map((i) => (s === 'empty' ? `empty_${i}` : `status_${s}_${i}`))),
  'caught_indicator',
  'level_female_top_0', 'level_female_top_1', 'level_male_top_0', 'level_male_top_1', 'level_genderless_top_0', 'level_genderless_top_1',
  'hp_h_2', 'hp_p_2', 'bar_end', 'slash', 'numbers_left', 'numbers_right',
  'level_female_bottom_0', 'level_female_bottom_1', 'level_male_bottom_0', 'level_male_bottom_1', 'level_genderless_bottom_0', 'level_genderless_bottom_1',
];
/**
 * The healthbox numbers (level, HP): the first ten 8×8 characters of pl_font's font_special_chars
 * (font_special_chars.c, digits 0–9), drawn as battle_main.c sets them up: FontSpecialChars_Init(14, 2, 15),
 * so ink 1 → primary healthbox colour 14 (white), ink 2 → colour 2 (the dark outline), the rest the
 * box's own colour 15, left transparent here (it is the box's fill under them).
 */
const SPECIAL_CHARS = { path: '/graphic/pl_font.narc', member: 4, digits: 10, fg: 14, shadow: 2 };

/** type_icon.c: type order (TYPE_*), then the contest types and the move classes; palette (of 3) per icon. pl_batt_obj members per sprites.order. */
const TYPE_ICONS: [string, number, number][] = [
  ['normal', 234, 0], ['fighting', 225, 0], ['flying', 227, 1], ['poison', 235, 1], ['ground', 229, 0], ['rock', 237, 0], ['bug', 231, 2], ['ghost', 228, 1], ['steel', 238, 0],
  ['mystery', 236, 2], ['fire', 226, 0], ['water', 241, 1], ['grass', 233, 2], ['electric', 222, 0], ['psychic', 223, 1], ['ice', 230, 1], ['dragon', 221, 2], ['dark', 224, 0],
  ['cool', 240, 0], ['beauty', 219, 1], ['cute', 220, 1], ['smart', 232, 2], ['tough', 239, 0],
  ['physical', 244, 0], ['special', 246, 1], ['status', 245, 0],
];
const TYPE_ICON_CELLS = 242;
const TYPE_ICON_PALETTES = 74;

/** Balls as thrown and caught (ov12_02235E94.c), members per sprites.order: [name, characters, cells, animations, palette]. */
const BALLS: [string, number, number, number, number][] = [
  ['poke_ball', 285, 284, 283, 91], ['master_ball', 288, 287, 286, 92], ['ultra_ball', 291, 290, 289, 93], ['great_ball', 294, 293, 292, 94],
  ['safari_ball', 297, 296, 295, 95], ['net_ball', 300, 299, 298, 96], ['dive_ball', 303, 302, 301, 97], ['nest_ball', 306, 305, 304, 98],
  ['repeat_ball', 309, 308, 307, 99], ['timer_ball', 312, 311, 310, 100], ['luxury_ball', 315, 314, 313, 101], ['premier_ball', 318, 317, 316, 102],
  ['quick_ball', 321, 320, 319, 103], ['dusk_ball', 324, 323, 322, 104], ['heal_ball', 327, 326, 325, 105], ['cherish_ball', 330, 329, 328, 106],
  ['park_ball', 333, 332, 331, 107], ['bait', 336, 335, 334, 108], ['mud', 339, 338, 337, 109],
];

/**
 * The caught ball's stars (decomp ov12_02235E94.c: the capture plays one emitter of the ball's catch
 * particle file, wazaeffect/effectdata/ball_particle.narc `catch_<ball>.spa`, sBallParticles' second
 * column): [ball, member, emitter]. Every ball's star emitter is the same but for its texture, which is
 * imported as `battle/ball_stars/<ball>`; the app draws the emitter (STAR_EMITTER, checked here).
 */
const BALL_PARTICLES = '/wazaeffect/effectdata/ball_particle.narc';
const BALL_STARS: [string, number, number][] = [
  ['master_ball', 19, 0], ['ultra_ball', 20, 2], ['great_ball', 21, 1], ['poke_ball', 22, 3], ['safari_ball', 23, 1], ['net_ball', 24, 1],
  ['dive_ball', 25, 1], ['nest_ball', 26, 1], ['repeat_ball', 27, 2], ['timer_ball', 28, 3], ['luxury_ball', 29, 1], ['premier_ball', 30, 0],
  ['dusk_ball', 31, 1], ['heal_ball', 32, 0], ['quick_ball', 33, 1], ['cherish_ball', 34, 1], ['park_ball', 35, 3],
];
/** The star emitter: 3 particles on a circle around its axis, 19 frames each, with gravity (app battle/scene.ts STARS). */
const STAR_EMITTER = { emission: 3, count: 3, radius: 305, velPos: 381, velAxis: 990, scale: 1457, color: 0x4fff, particleLife: 19, air: 123, gravityY: -73 };

export interface BattleArtImport {
  backgrounds: BattleBackground[];
  terrains: BattleTerrain[];
}

/** `healthboxParts`: the overlay bytes of HEALTHBOX_PARTS (checked by the caller). */
export function importBattleArt(fs: NitroFs, sheets: Sheets, assets: Map<string, Uint8Array>, healthboxParts: Uint8Array): BattleArtImport {
  const bg = readNarc(fs.file(BATT_BG.path));
  const obj = readNarc(fs.file(BATT_OBJ.path));
  if (bg.length !== BATT_BG.count) throw new Error(`${BATT_BG.path}: ${bg.length} members, expected ${BATT_BG.count}`);
  if (obj.length !== BATT_OBJ.count) throw new Error(`${BATT_OBJ.path}: ${obj.length} members, expected ${BATT_OBJ.count}`);

  // Backgrounds: BG3, 512×256, 8bpp; transparent pixels show the backdrop, palette colour 0.
  const tilemap = readNscr(bg[BG_TILEMAP]!);
  const backgrounds = BACKGROUNDS.map((name, i): BattleBackground => {
    const chars = readNcgr(bg[bgTiles(i)]!);
    const paths = TIMES.map((time, t) => {
      if (i >= TIMED_BACKGROUNDS && t) return null;
      const path = `battle/backgrounds/${name.toLowerCase()}${i < TIMED_BACKGROUNDS ? `-${time}` : ''}.png`;
      const pal = readNclr(bg[bgPalette(i, t)]!);
      const ram = new PaletteRam().load(pal, 0, Math.min(512, pal.colors.length * 2));
      const rgba = renderScreen(tilemap, chars, ram);
      const [r, g, b] = rgb555(ram.colors[0]!);
      for (let p = 3; p < rgba.length; p += 4) if (!rgba[p]) rgba.set([r, g, b, 255], p - 3);
      assets.set(path, encodeImage({ width: tilemap.width, height: tilemap.height, rgba }));
      return asId(`platinum:${path}`);
    });
    const day = paths[0]!;
    return { id: asId(`platinum:BACKGROUND_${name}`), sourceIndex: i, day, twilight: paths[1] ?? day, night: paths[2] ?? day };
  });

  // Platforms: one sheet per graphic, side and distinct palette; terrains name them per time.
  const platformSheet = (gfx: string, side: 'player' | 'enemy', paletteGfx: string, time: number) => {
    const [playerChars, enemyChars] = PLATFORM_GFX[gfx]!;
    const paletteBase = PLATFORM_GFX[paletteGfx]![2];
    // "all" palettes repeat one file three times: reuse the day sheet when the bytes match.
    const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, k) => v === b[k]);
    const t = time && same(obj[paletteBase + time]!, obj[paletteBase]!) ? 0 : time;
    const path = `battle/terrain/${gfx}/${side}${paletteGfx === gfx ? '' : `-${paletteGfx}`}-${TIMES[t]}`;
    const id = asId(`platinum:ui2d/${path}`);
    if (!sheets.records.some((s) => s.id === id)) sheets.obj(path, obj, { ncgr: side === 'player' ? playerChars : enemyChars, nclr: paletteBase + t, ...PLATFORM_CELLS[side] });
    return id;
  };
  const terrains = TERRAINS.map(([name, playerGfx, enemyGfx, paletteGfx], i): BattleTerrain => {
    const platform = (side: 'player' | 'enemy', gfx: string): BattlePlatform => ({
      day: platformSheet(gfx, side, paletteGfx, 0),
      twilight: platformSheet(gfx, side, paletteGfx, 1),
      night: platformSheet(gfx, side, paletteGfx, 2),
      ...PLATFORM_AT[side],
    });
    return { id: asId(`platinum:TERRAIN_${name}`), sourceIndex: i, player: platform('player', playerGfx), enemy: platform('enemy', enemyGfx) };
  });

  for (const [name, [ncgr, ncer, nanr, nclr]] of Object.entries(HEALTHBOXES)) sheets.obj(`battle/healthbox/${name}`, obj, { ncgr, ncer, nanr, nclr });
  // The parts strip: one 8×8 cell per part.
  const primary = readNclr(obj[HEALTHBOXES.player_singles![3]]!).colors;
  const partTiles = charactersOf(healthboxParts, 4).tiles;
  if (partTiles.length !== PART_NAMES.length) throw new Error(`healthbox parts: ${partTiles.length} characters for ${PART_NAMES.length} names`);
  const parts: CellImage[] = partTiles.map((tile) => {
    const img = { ...blankImage(8, 8), originX: 0, originY: 0 };
    tile.forEach((index, p) => {
      if (index) img.rgba.set([...rgb555(primary[index]!), 255], p * 4);
    });
    return img;
  });
  sheets.add('battle/healthbox/parts', parts, { names: PART_NAMES });
  const special = charactersOf(readNcgrData(readNarc(fs.file(SPECIAL_CHARS.path))[SPECIAL_CHARS.member]!).data, 4).tiles;
  if (special.length < SPECIAL_CHARS.digits) throw new Error(`font_special_chars: ${special.length} characters, expected at least ${SPECIAL_CHARS.digits}`);
  const ink = [null, primary[SPECIAL_CHARS.fg]!, primary[SPECIAL_CHARS.shadow]!];
  const digits: CellImage[] = special.slice(0, SPECIAL_CHARS.digits).map((tile) => {
    const img = { ...blankImage(8, 8), originX: 0, originY: 0 };
    tile.forEach((index, p) => {
      const c = ink[index];
      if (c === undefined) throw new Error(`font_special_chars: colour index ${index} in a digit`);
      if (c !== null) img.rgba.set([...rgb555(c), 255], p * 4);
    });
    return img;
  });
  sheets.add('battle/healthbox/digits', digits, { names: digits.map((_, i) => String(i)) });
  sheets.obj('battle/party_gauge', obj, { ncgr: 340, ncer: 341, nanr: 342, nclr: 110 });

  // Type icons: one cell per icon, each in its palette of the shared file.
  const typeBank = readNcer(obj[TYPE_ICON_CELLS]!);
  const typeColors = readNclr(obj[TYPE_ICON_PALETTES]!).colors;
  if (typeBank.cells.length !== 1) throw new Error(`type icon cells: ${typeBank.cells.length}, expected 1`);
  const icons = TYPE_ICONS.map(([, ncgr, palette]) => renderCell(typeBank.cells[0]!, readNcgrData(obj[ncgr]!).data, typeColors, { mapping: typeBank.mapping, palette }));
  sheets.add('battle/type_icons', icons, { names: TYPE_ICONS.map(([n]) => n) });

  for (const [name, ncgr, ncer, nanr, nclr] of BALLS) sheets.obj(`battle/ball_throws/${name}`, obj, { ncgr, ncer, nanr, nclr });
  const particles = readNarc(fs.file(BALL_PARTICLES));
  for (const [name, member, emitter] of BALL_STARS) {
    const spa = readSpa(particles[member]!);
    const e = spa.emitters[emitter]!;
    const got = { emission: e.flags & 15, count: e.count, radius: e.radius, velPos: e.velPos, velAxis: e.velAxis, scale: e.scale, color: e.color, particleLife: e.particleLife, air: e.air, gravityY: e.gravity ? e.gravity[1] : null };
    const want = { ...STAR_EMITTER, count: STAR_EMITTER.count * 4096 };
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${BALL_PARTICLES} member ${member} emitter ${emitter} (${name} stars): ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    sheets.add(`battle/ball_stars/${name}`, [{ ...spaTexture(spa, e.texture), originX: 0, originY: 0 }]);
  }
  return { backgrounds, terrains };
}
