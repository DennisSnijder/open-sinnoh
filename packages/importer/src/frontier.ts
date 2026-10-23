/**
 * The Battle Frontier: its scene table and scripts (overlay 104 sFrontierScenes, fr_script.narc), the
 * frontier trainers and sets (pl_btdtr, pl_btdpm), the Battle Tower's tables (arm9 unk_0204AEE8.c, unk_02049D08.c;
 * overlay 104 frontier_opponents.c), the exchange counters (arm9 ScrCmd_PokeMartFrontier, overlay 7
 * Shop_GetItemBPPrice), and the scenes' 2D art: the rooms (frontier_bg), the 2D characters (wifi2dchar through
 * overlay 63's gfx table) and the frontier_obj sprites.
 */
import type { BattleFactoryTables, BattleHallTables, FactoryPool, FrontierSceneData, FrontierSetData, FrontierTables, FrontierTrainerData, Mart, Movement, Sequence } from '@opensinnoh/contracts';
import { asId, type Command, type Id } from '@opensinnoh/core';
import { readNarc, Reader, type NitroFs } from '@opensinnoh/nds';
import { decodeFrontierScripts, FRONTIER_SCRIPT_FILES, frontierFileLabelName } from '@opensinnoh/vm';
import type { Names } from './names.ts';
import { renderCell } from './ui2d/compose.ts';
import { readNanr } from './ui2d/nanr.ts';
import { readNcer } from './ui2d/ncer.ts';
import { PaletteRam, readNclr, readNcgr, readNcgrData, readNscr, renderScreen, rgb555, type Characters, type Screen } from './ui2d/nitro2d.ts';
import { animations, type Sheets } from './ui2d/sheets.ts';


/** The ROM tables this module reads (each SHA1-checked by the caller, platinum.ts `TABLES`). */
export interface FrontierRomTables {
  /** overlay 104 sFrontierScenes: 17 rows of 40 bytes. */
  scenes: Uint8Array;
  /** arm9 sBattleTowerTrainerRangesPerRoom, sBattleTowerBossTrainerRangesPerRoom: {u16 first, u16 last} × 8. */
  ranges: Uint8Array;
  bossRanges: Uint8Array;
  /** arm9 sBattleTowerReservedItems: u16 × 4. */
  reservedItems: Uint8Array;
  /** arm9 soloBattlePoints: u8 × 8. */
  battlePoints: Uint8Array;
  /** overlay 104 sTrainerClassToObjectID (frontier_opponents.c): {u16 class, u16 gfx} × 63. */
  classObjects: Uint8Array;
  /** overlay 63 Unk_ov63_0222D9A0: {u16 gfx, u16 wifi2dchar character} × 151. */
  characters: Uint8Array;
  /** overlay 104 Unk_ov104_022417D8: the frontier_obj SpriteTemplates, 52 bytes × 4. */
  objects: Uint8Array;
  /** overlay 7 Shop_GetItemBPPrice: {u16 item, u16 BP} × 41. */
  prices: Uint8Array;
  /** arm9 BattleFrontierLeft/RightExchangeServiceCorner: u16 items, 0xFFFF-ended. */
  martLeft: Uint8Array;
  martRight: Uint8Array;
  /** arm9 sBattleFrontierBanlist: u16 species × 18. */
  banlist: Uint8Array;
  /**
   * overlay 104 battle_factory_helpers.c: sBattleFactoryOpponentPools (u16 × 4 per round), sTradeCountsNeededForUpgrades
   * (s32 × 5), sOpenLevelPlayerPools, sLevel50Pools, sOpenLevelOpponentPools (BattleFactoryPokemonPool, 8 bytes × 10);
   * battle_factory.c sBPPerRoundSolo (u8 × 9).
   */
  factory: { opponentPools: Uint8Array; tradeUpgrades: Uint8Array; openPlayerPools: Uint8Array; level50Pools: Uint8Array; openOpponentPools: Uint8Array; battlePoints: Uint8Array };
  /**
   * overlay 104 battle_hall.c sBPPerRoundSolo (u8 × 19); battle_hall_helpers.c sIVsPerTypeRank ({u8, u8 ivs, u16} × 10),
   * sMatchupGroupRanges and sPotentialMatchupRangesByRank ({u16 min, u16 max}), sBattleHallAppGridOrder (u8 × 20),
   * sBattleHallPotentialOpponents (u16 × 477) and their types (u16 × 2 × 477), sHallTrainerClassesByRank (u16 × 8 × 10),
   * sHallTrainerClassesBySelectedType (u16 × 4 × 18), sFrontierTrainerClasses (u16 × 300); arm9 scrcmd_battle_hall.c
   * sBattleHallRecordMilestones ({u32 record, u32 bp} × 47).
   */
  hall: {
    battlePoints: Uint8Array;
    ivs: Uint8Array;
    groupRanges: Uint8Array;
    rankRanges: Uint8Array;
    grid: Uint8Array;
    opponents: Uint8Array;
    opponentTypes: Uint8Array;
    milestones: Uint8Array;
    classesByRank: Uint8Array;
    classesByCell: Uint8Array;
    trainerClasses: Uint8Array;
  };
}

/** FRONTIER_TRAINER_TOWER_TYCOON_PALMER_SILVER, _GOLD and FRONTIER_TRAINER_TRAINER_CHERYL_CHERYL (generated/frontier_trainers.txt). */
const PALMER = [305, 306] as const;
/** FRONTIER_TRAINER_HALL_MATRON_ARGENTA_SILVER, _GOLD and FRONTIER_TRAINER_FACTORY_HEAD_THORTON_SILVER, _GOLD. */
const ARGENTA = [307, 308] as const;
const THORTON = [309, 310] as const;
/** Decomp sBattleHallAppGridOrder's BATTLE_HALL_MON_SUMMARY cells. */
const HALL_SUMMARY_CELL = 0xfe;
/**
 * frontier_bg members (res/graphics/frontier/backgrounds/frontier_backgrounds.order): the Factory app's characters,
 * tilemaps and palette, the Hall app's.
 */
const FACTORY_APP = { ncgr: 4, selection: 5, noScreens: 7, conveyor: 8, wheel: 9, summary: 10, nclr: 130, palettes: 11 } as const;
const HALL_APP = { ncgr: 23, nscr: 24, nclr: 134, palettes: 6 } as const;
/** frontier_obj members (narc_frontier_obj.h): BATTLE_FACTORY_APP_SPRITES, BATTLE_HALL_APP_CURSOR_BOX. */
const FACTORY_APP_SPRITES = { ncgr: 0, nanr: 1, ncer: 2, nclr: 36 } as const;
const HALL_APP_CURSOR = { ncgr: 12, nanr: 13, ncer: 14, nclr: 38 } as const;
const FIRST_PARTNER = 300;
/** The BP after beating Palmer (decomp BattleTower_GiveBattlePointsReward: `battlePoints = 20`). */
const PALMER_BP = 20;
/** OBJ_EVENT_GFX_SCHOOL_KID_M: BattleFrontier_GetObjectIDFromTrainerClass's default. */
const DEFAULT_OBJECT_GFX = 3;
/** Scenes 0–2 (FRONTIER_SCENE_0..2) are leftovers no script or op launches (their script member is unused or another scene's). */
const UNUSED_SCENES = 3;
/** NARC_INDEX_FRONTIER_BACKGROUNDS. */
const FRONTIER_BG_NARC = 150;
const SCENE_ROW = 40;
/** BG_SCREEN_SIZE_256x256, 512x512 (decomp FR_SCENE_SCREEN_SIZE). */
const SCREEN_SIZES: Record<number, number> = { 1: 256, 4: 512 };
/** wifi2dchar: the shadow (cells 0, animations 1, characters 2), the cell and animation banks, then {palette, characters} per character from 13. */
const W2D = { shadow: { ncer: 0, nanr: 1, ncgr: 2 }, firstCharacter: 13 } as const;
/** ov63_0222B374's banks by the character's tiles: bytes → [cells, animations] (type 0 full, type 1 with and without flips, type 2). */
const CHARACTER_BANKS: Record<number, [number, number]> = { 0x2400: [3, 4], 0x1800: [7, 8], 0x1200: [5, 6], 0x800: [11, 12], 0x600: [9, 10] };

export interface FrontierImport {
  tables: FrontierTables;
  labels: Record<Id, Command[]>;
  movements: Movement[];
  marts: Mart[];
  files: number;
  instructions: number;
}

/**
 * Reads the frontier. `bankId(n)` is a text bank's id by pl_msg number; `sequenceId(n)` a sequence by sdat number
 * (null in packs without sound); `sheets` collects the 2D art (null: no art, the rooms and characters stay null/empty).
 */
export function importFrontier(fs: NitroFs, names: Names, rom: FrontierRomTables, deps: { bankId: (bank: number) => Id; bankIndex: (name: string) => number; sequences: readonly Sequence[]; sheets: Sheets }): FrontierImport {
  const u16s = (b: Uint8Array) => {
    const r = new Reader(b);
    return Array.from({ length: b.length / 2 }, (_, i) => r.u16(i * 2));
  };
  const pairs = (b: Uint8Array) => {
    const v = u16s(b);
    return Array.from({ length: v.length / 2 }, (_, i) => [v[i * 2]!, v[i * 2 + 1]!] as [number, number]);
  };

  // --- scenes (decomp FrontierScene, 40-byte rows: u32 bgMode, two function pointers, u16 fields, u8 flags) ---
  const sceneRows = Array.from({ length: rom.scenes.length / SCENE_ROW }, (_, i) => {
    const r = new Reader(rom.scenes.subarray(i * SCENE_ROW, (i + 1) * SCENE_ROW));
    return {
      setup: r.u32(4) !== 0 || r.u32(8) !== 0,
      script: r.u16(12),
      textBank: r.u16(14),
      bgm: r.u16(16),
      screenSize: r.u16(18),
      narc: r.u16(20),
      tilemap: r.u16(22),
      tiles: r.u16(24),
      palette: r.u16(26),
      subTilemap: r.u16(28),
      subTiles: r.u16(30),
      subPalette: r.u16(32),
      fgFollows: r.u8(35),
    };
  });
  const scriptMembers = readNarc(fs.file('/frontier/script/fr_script.narc'));
  if (scriptMembers.length !== FRONTIER_SCRIPT_FILES.length) throw new Error(`fr_script has ${scriptMembers.length} members, the frontier command table lists ${FRONTIER_SCRIPT_FILES.length}`);
  const decoded = decodeFrontierScripts({
    members: scriptMembers,
    scenes: sceneRows.map((s, i) => (i < UNUSED_SCENES ? null : { member: s.script, textBank: s.textBank })),
    names: { text: (b, m) => names.text(b, m), var: (v) => names.var(v) },
  });

  const bgNarc = readNarc(fs.file('/resource/eng/frontier_graphic/frontier_bg.narc'));
  const bgSheets = new Map<string, NonNullable<FrontierSceneData['bg']>>();
  /**
   * A room layer: the 8bpp affine-extended BG over its extended palettes (decomp ov104_0223CC74), colour 0 transparent
   * (the backdrop, black after the scene's PaletteData_FillBufferRange, is the scene's: the Factory corridor's floor
   * shows through BG3 from below).
   */
  const room = (tilemap: number, tiles: number, palette: number): NonNullable<FrontierSceneData['bg']> => {
    const key = `${tilemap}-${tiles}-${palette}`;
    const known = bgSheets.get(key);
    if (known) return known;
    const member = (i: number) => {
      const b = bgNarc[i];
      if (!b) throw new Error(`frontier_bg has no member ${i}`);
      return b;
    };
    const screen = readNscr(member(tilemap));
    const chars = readNcgr(member(tiles));
    const colors = readNclr(member(palette)).colors;
    const sheet = deps.sheets.image(`frontier/room_${tilemap}`, { width: screen.width, height: screen.height, rgba: renderAffineExt(screen, chars, colors) });
    const out = { sheet, width: screen.width, height: screen.height };
    bgSheets.set(key, out);
    return out;
  };
  const scenes: (FrontierSceneData | null)[] = sceneRows.map((s, i) => {
    if (i < UNUSED_SCENES) return null;
    if (s.narc !== FRONTIER_BG_NARC) throw new Error(`frontier scene ${i}: room NARC ${s.narc}, not frontier_bg`);
    const size = SCREEN_SIZES[s.screenSize];
    if (size === undefined) throw new Error(`frontier scene ${i}: screen size ${s.screenSize}`);
    const bgm = deps.sequences.find((q) => q.sourceIndex === s.bgm)?.id ?? null;
    const bg = room(s.tilemap, s.tiles, s.palette);
    const fg = s.subTilemap === 0xffff ? null : room(s.subTilemap, s.subTiles, s.subPalette);
    if (s.fgFollows > 1) throw new Error(`frontier scene ${i}: FR_SCENE_FLAG_2 ${s.fgFollows}`);
    return { entry: `platinum:${frontierFileLabelName(FRONTIER_SCRIPT_FILES[s.script]!)}/0` as Id, textBank: deps.bankId(s.textBank), bgm, bg, fg, setup: s.setup, ...(fg && s.fgFollows === 0 ? { fgFixed: true as const } : {}) };
  });

  // --- trainers (pl_btdtr: u16 class, u16 set count, u16 sets[]) and sets (pl_btdpm: FrontierPokemonBase) ---
  const namesBank = deps.bankIndex('TEXT_BANK_FRONTIER_TRAINER_NAMES');
  const classNamesBank = deps.bankIndex('TEXT_BANK_TRAINER_CLASS_NAMES');
  const trainers: FrontierTrainerData[] = readNarc(fs.file('/battle/b_pl_tower/pl_btdtr.narc')).map((b, i) => {
    const r = new Reader(b);
    const count = r.u16(2);
    if (b.length < 4 + count * 2) throw new Error(`pl_btdtr ${i}: ${count} sets in ${b.length} bytes`);
    return { class: names.trainerClass(r.u16(0)), className: names.text(classNamesBank, r.u16(0)), name: names.text(namesBank, i), sets: Array.from({ length: count }, (_, k) => r.u16(4 + k * 2)) };
  });
  const readSets = (path: string): FrontierSetData[] => readNarc(fs.file(path)).map((b, i) => {
    if (b.length !== 16) throw new Error(`${path} ${i}: ${b.length} bytes, expected 16`);
    const r = new Reader(b);
    const item = r.u16(12);
    return {
      species: names.species(r.u16(0)),
      form: r.u16(14),
      moves: [2, 4, 6, 8].map((o) => r.u16(o)).filter((m) => m !== 0).map((m) => names.move(m)),
      evFlags: r.u8(10),
      nature: names.nature(r.u8(11)),
      item: item === 0 ? null : names.item(item),
    };
  });
  const sets = readSets('/battle/b_pl_tower/pl_btdpm.narc');
  for (const [i, t] of trainers.entries()) for (const s of t.sets) if (!sets[s]) throw new Error(`frontier trainer ${i}: set ${s} of ${sets.length}`);

  // --- the 2D characters (wifi2dchar through overlay 63's table) and the frontier_obj sprites ---
  const w2d = readNarc(fs.file('/graphic/wifi2dchar.narc'));
  const characters: Record<string, Id> = {};
  const characterSheets = new Map<number, Id>();
  for (const [gfx, c] of pairs(rom.characters)) {
    const done = characterSheets.get(c);
    if (done) {
      characters[gfx] = done;
      continue;
    }
    const ncgr = w2d[W2D.firstCharacter + 1 + c * 2];
    const nclr = w2d[W2D.firstCharacter + c * 2];
    if (!ncgr || !nclr) throw new Error(`wifi2dchar has no character ${c} (gfx ${gfx})`);
    const data = readNcgrData(ncgr);
    const bank = CHARACTER_BANKS[data.data.length];
    if (!bank) throw new Error(`wifi2dchar character ${c}: ${data.data.length} bytes of characters (no bank for that size)`);
    const cells = readNcer(w2d[bank[0]]!);
    const colors = readNclr(nclr).colors;
    const images = cells.cells.map((cell) => renderCell(cell, data.data, colors, { mapping: cells.mapping }));
    const sheet = deps.sheets.add(`frontier/char_${c}`, images, { animations: animations(readNanr(w2d[bank[1]]!)) });
    characterSheets.set(c, sheet);
    characters[gfx] = sheet;
  }
  let shadow: Id;
  {
    // The shadow under every character (ov63_0222B7E8: cells 0, animations 1, characters 2, a player character's palette).
    const cells = readNcer(w2d[W2D.shadow.ncer]!);
    const chars = readNcgrData(w2d[W2D.shadow.ncgr]!);
    const colors = readNclr(w2d[W2D.firstCharacter]!).colors;
    shadow = deps.sheets.add('frontier/shadow', cells.cells.map((cell) => renderCell(cell, chars.data, colors, { mapping: cells.mapping })));
  }
  const objNarc = readNarc(fs.file('/resource/eng/frontier_graphic/frontier_obj.narc'));
  const objects: Record<string, Id> = {};
  const objectSheets = new Map<string, Id>();
  for (let i = 0; i < rom.objects.length / 52; i++) {
    const r = new Reader(rom.objects.subarray(i * 52, (i + 1) * 52));
    const [ncgr, nclr, ncer, nanr] = [20, 24, 28, 32].map((o) => r.u32(o)) as [number, number, number, number];
    const key = `${ncgr}_${nclr}_${ncer}_${nanr}`;
    let sheet = objectSheets.get(key);
    if (!sheet) objectSheets.set(key, (sheet = deps.sheets.obj(`frontier/obj_${key}`, objNarc, { ncgr, nclr, ncer, nanr })));
    objects[String(i)] = sheet;
  }

  // --- the Battle Factory and the Battle Hall ---
  const factory = importFactory(rom.factory, objNarc, bgNarc, deps.sheets);
  const hall = importHall(rom.hall, readSets('/battle/b_pl_stage/pl_bsdpm.narc'), trainers, names, objNarc, bgNarc, deps.sheets);

  // --- the Battle Tower ---
  const bp = [...rom.battlePoints];
  const tables: FrontierTables = {
    scenes,
    trainers,
    sets,
    trainerMessages: asId('platinum:TEXT_BANK_FRONTIER_TRAINER_MESSAGES'),
    tower: {
      ranges: pairs(rom.ranges),
      bossRanges: pairs(rom.bossRanges),
      palmer: [...PALMER],
      partners: FIRST_PARTNER,
      reservedItems: u16s(rom.reservedItems).map((i) => names.item(i)),
      battlePoints: bp,
      palmerBattlePoints: PALMER_BP,
      classObjects: pairs(rom.classObjects).map(([cls, gfx]) => ({ class: names.trainerClass(cls), gfx })),
      defaultObject: DEFAULT_OBJECT_GFX,
    },
    factory,
    hall,
    characters,
    objects,
    shadow,
    banlist: u16s(rom.banlist).map((s) => names.species(s)),
    prices: pairs(rom.prices).map(([item, price]) => ({ item: names.item(item), bp: price })),
    judgeMessages: [],
  };
  const mart = (b: Uint8Array, name: string): Mart => {
    const items = u16s(b);
    if (items[items.length - 1] !== 0xffff) throw new Error(`${name}: no SHOP_ITEM_END`);
    return { id: asId(`platinum:${name}`), items: items.slice(0, -1).map((i) => ({ item: names.item(i), minBadges: 0 })) };
  };
  // Decomp MART_FRONTIER_ID_EXCHANGE_SERVICE_CORNER_RIGHT (0) and _LEFT (1) (generated/mart_frontier_id.txt).
  const marts = [mart(rom.martRight, 'MART_FRONTIER_ID_EXCHANGE_SERVICE_CORNER_RIGHT'), mart(rom.martLeft, 'MART_FRONTIER_ID_EXCHANGE_SERVICE_CORNER_LEFT')];
  for (const m of marts) for (const { item } of m.items) if (!tables.prices.some((p) => p.item === item)) throw new Error(`${m.id}: ${item} has no BP price`);
  return { tables, labels: decoded.ir.labels, movements: decoded.movements, marts, files: decoded.files, instructions: decoded.instructions };
}

/** The entry label of a scene's script, read from the raw scene table (the field decoder runs before `importFrontier`). */
export function frontierSceneEntry(scenes: Uint8Array, scene: number): Id | undefined {
  if (scene < UNUSED_SCENES || (scene + 1) * SCENE_ROW > scenes.length) return undefined;
  const file = FRONTIER_SCRIPT_FILES[new Reader(scenes.subarray(scene * SCENE_ROW, (scene + 1) * SCENE_ROW)).u16(12)];
  return file === undefined ? undefined : asId(`platinum:${frontierFileLabelName(file)}/0`);
}

/**
 * An affine-extended BG (8bpp characters, a 16-bit entry per tile stored row by row, extended palettes picked by the
 * entry's palette bits) to RGBA. Colour 0 is transparent.
 */
function renderAffineExt(screen: Screen, chars: Characters, colors: Uint16Array): Uint8Array {
  if (chars.bitDepth !== 8) throw new Error('frontier room: an extended BG needs 8bpp characters');
  const out = new Uint8Array(screen.width * screen.height * 4);
  const cols = screen.width / 8;
  if (screen.entries.length < cols * (screen.height / 8)) throw new Error(`frontier room: ${screen.entries.length} entries for ${screen.width}×${screen.height}`);
  for (let ty = 0; ty < screen.height / 8; ty++)
    for (let tx = 0; tx < cols; tx++) {
      const e = screen.entries[ty * cols + tx]!;
      // A character past the loaded ones reads cleared VRAM (decomp InitBackgrounds clears BG VRAM): transparent.
      const tile = chars.tiles[e & 0x3ff];
      if (!tile) continue;
      const base = (e >> 12) * 256;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const index = tile[(e & 0x800 ? 7 - y : y) * 8 + (e & 0x400 ? 7 - x : x)]!;
          if (index === 0) continue;
          const color = colors[base + index];
          if (color === undefined) throw new Error(`frontier room: palette ${e >> 12} colour ${index} past ${colors.length}`);
          out.set([...rgb555(color), 255], ((ty * 8 + y) * screen.width + tx * 8 + x) * 4);
        }
    }
  return out;
}


const u16sOf = (b: Uint8Array): number[] => {
  const r = new Reader(b);
  return Array.from({ length: b.length / 2 }, (_, i) => r.u16(i * 2));
};
const pairsOf = (b: Uint8Array): [number, number][] => {
  const v = u16sOf(b);
  return Array.from({ length: v.length / 2 }, (_, i) => [v[i * 2]!, v[i * 2 + 1]!]);
};

/** A text BG (4bpp) over a palette RAM, with the tiles in `rect` (tiles) moved to `palette` (decomp Bg_ChangeTilemapRectPalette). */
function textBg(screen: Screen, chars: Characters, ram: PaletteRam, rect?: { x: number; y: number; w: number; h: number; palette: number }): { width: number; height: number; rgba: Uint8Array } {
  if (chars.bitDepth !== 4) throw new Error('frontier app: a text BG needs 4bpp characters');
  if (!rect) return { width: screen.width, height: screen.height, rgba: renderScreen(screen, chars, ram) };
  if (screen.width > 256) throw new Error('frontier app: a palette rect on a map wider than one screen block');
  const entries = Uint16Array.from(screen.entries);
  const cols = screen.width / 8;
  for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) entries[y * cols + x] = (entries[y * cols + x]! & 0x0fff) | (rect.palette << 12);
  return { width: screen.width, height: screen.height, rgba: renderScreen({ ...screen, entries }, chars, ram) };
}

/** The Battle Factory's tables (overlay 104) and its rental app's art. */
function importFactory(rom: FrontierRomTables['factory'], objNarc: Uint8Array[], bgNarc: Uint8Array[], sheets: Sheets): BattleFactoryTables {
  const pools = (b: Uint8Array): FactoryPool[] => {
    const r = new Reader(b);
    return Array.from({ length: b.length / 8 }, (_, i) => {
      const upgradable = r.u8(i * 8 + 7);
      if (upgradable > 1) throw new Error(`battle factory pool ${i}: canBeUpgraded ${upgradable}`);
      return { trainerMax: r.u16(i * 8), setMin: r.u16(i * 8 + 2), setMax: r.u16(i * 8 + 4), ivs: r.u8(i * 8 + 6), upgradable: upgradable === 1 };
    });
  };
  const ranges = u16sOf(rom.opponentPools);
  const upgrades = new Reader(rom.tradeUpgrades);
  const member = (i: number) => {
    const b = bgNarc[i];
    if (!b) throw new Error(`frontier_bg has no member ${i}`);
    return b;
  };
  // Decomp battle_factory/main.c LoadPalette: the app's first 11 palettes at BG palette 0.
  const ram = new PaletteRam().load(readNclr(member(FACTORY_APP.nclr)), 0, FACTORY_APP.palettes * 32);
  const chars = readNcgr(member(FACTORY_APP.ncgr));
  const layer = (path: string, nscr: number, rect?: Parameters<typeof textBg>[3]) => sheets.image(`frontier/factory_app_${path}`, textBg(readNscr(member(nscr)), chars, ram, rect));
  const art = {
    // Decomp UpdateWheelPalette: the wheel's whole 32×32 map cycles through palettes 6–9.
    wheel: [6, 7, 8, 9].map((palette) => layer(`wheel_${palette}`, FACTORY_APP.wheel, { x: 0, y: 0, w: 32, h: 32, palette })),
    conveyor: layer('conveyor', FACTORY_APP.conveyor),
    // Decomp BACKGROUND_PANEL_SHOWN: palette 2 over the panel (21 × 11 tiles while picking, 32 × 11 on the confirm panel).
    selection: layer('selection', FACTORY_APP.selection, { x: 0, y: 0, w: 21, h: 11, palette: 2 }),
    noScreens: layer('no_screens', FACTORY_APP.noScreens),
    summary: layer('summary', FACTORY_APP.summary, { x: 0, y: 0, w: 32, h: 11, palette: 2 }),
    sprites: sheets.obj('frontier/factory_app_sprites', objNarc, FACTORY_APP_SPRITES),
    // Decomp PALETTE_POKEBALL_NOT_SELECTED (Sprite_SetExplicitPalette 1).
    unpicked: sheets.obj('frontier/factory_app_sprites_unpicked', objNarc, { ...FACTORY_APP_SPRITES, palette: 1 }),
  };
  return {
    opponentRanges: Array.from({ length: ranges.length / 4 }, (_, i) => ranges.slice(i * 4, i * 4 + 4) as [number, number, number, number]),
    level50Pools: pools(rom.level50Pools),
    openOpponentPools: pools(rom.openOpponentPools),
    openPlayerPools: pools(rom.openPlayerPools),
    tradeUpgrades: Array.from({ length: rom.tradeUpgrades.length / 4 }, (_, i) => upgrades.u32(i * 4)),
    battlePoints: [...rom.battlePoints],
    thorton: [...THORTON],
    art,
  };
}

/** The Battle Hall's tables (overlay 104, arm9), its sets (pl_bsdpm) and its board's art. */
function importHall(rom: FrontierRomTables['hall'], sets: FrontierSetData[], trainers: FrontierTrainerData[], names: Names, objNarc: Uint8Array[], bgNarc: Uint8Array[], sheets: Sheets): BattleHallTables {
  const opponents = u16sOf(rom.opponents).map((sp, i) => {
    const species = names.species(sp);
    // sBattleHallPotentialOpponents mirrors pl_bsdpm: entry i is set i + 1.
    if (sets[i + 1]?.species !== species) throw new Error(`battle hall: opponent ${i} is ${species}, set ${i + 1} ${sets[i + 1]?.species}`);
    return species;
  });
  const classes = u16sOf(rom.trainerClasses).map((c) => names.trainerClass(c));
  classes.forEach((c, i) => {
    if (trainers[i]?.class !== c) throw new Error(`battle hall: sFrontierTrainerClasses ${i} is ${c}, frontier trainer ${i} ${trainers[i]?.class}`);
  });
  const ivs = new Reader(rom.ivs);
  const milestones = new Reader(rom.milestones);
  const classRows = (b: Uint8Array, per: number) => {
    const v = u16sOf(b).map((c) => names.trainerClass(c));
    return Array.from({ length: v.length / per }, (_, i) => v.slice(i * per, (i + 1) * per));
  };
  const member = (i: number) => {
    const b = bgNarc[i];
    if (!b) throw new Error(`frontier_bg has no member ${i}`);
    return b;
  };
  // Decomp battle_hall/main.c LoadPalette: the app's first 6 palettes at BG palette 0.
  const ram = new PaletteRam().load(readNclr(member(HALL_APP.nclr)), 0, HALL_APP.palettes * 32);
  const chars = readNcgr(member(HALL_APP.ncgr));
  const screen = readNscr(member(HALL_APP.nscr));
  const board = (palette?: number) => textBg(screen, chars, ram, palette === undefined ? undefined : { x: 0, y: 0, w: 32, h: 24, palette });
  return {
    sets,
    opponents,
    opponentTypes: pairsOf(rom.opponentTypes).map(([a, b]) => [names.type(a), names.type(b)]),
    rankRanges: pairsOf(rom.rankRanges),
    groupRanges: pairsOf(rom.groupRanges),
    ivs: Array.from({ length: rom.ivs.length / 4 }, (_, i) => ivs.u8(i * 4 + 1)),
    trainerClasses: classes,
    classesByRank: classRows(rom.classesByRank, 8),
    classesByCell: classRows(rom.classesByCell, 4),
    grid: [...rom.grid].map((t) => (t === HALL_SUMMARY_CELL ? 'summary' : names.type(t))),
    battlePoints: [...rom.battlePoints],
    milestones: Array.from({ length: rom.milestones.length / 8 }, (_, i) => ({ record: milestones.u32(i * 8), bp: milestones.u32(i * 8 + 4) })),
    argenta: [...ARGENTA],
    art: {
      // Decomp ChangeCellBackground: palettes 0 (as loaded), 5 (selected) and 3 (unselectable) per cell.
      board: { normal: sheets.image('frontier/hall_app_board', board()), selected: sheets.image('frontier/hall_app_board_selected', board(5)), unselectable: sheets.image('frontier/hall_app_board_unselectable', board(3)) },
      cursor: sheets.obj('frontier/hall_app_cursor', objNarc, HALL_APP_CURSOR),
    },
  };
}
