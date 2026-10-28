/**
 * The shared 2D module: Nitro 2D decoders (NCLR, NCGR, NSCR, NCER, NANR, LZ10 via nds), the OBJ/BG
 * compositor, the Platinum picture descrambling, and the 2D art import (Pokémon, trainers, battle,
 * windows, map-name signboards, the Pokédex) used by battles and menus.
 */
import { placeTables, type RomBuild } from '../layout.ts';
import type { BattleBackground, BattleTerrain, PokemonSprites, TrainerSprite, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { sha1Hex, type NitroFs } from '@opensinnoh/nds';
import { HEALTHBOX_PARTS, importBattleArt } from './battle.ts';
import { importBattleButtons, MOVE_PALETTES } from './battle-buttons.ts';
export { BACKGROUNDS } from './battle.ts';
import { importPokemon } from './pokemon.ts';
import { Sheets } from './sheets.ts';
import { importTrainerSprites } from './trainers.ts';
import { importWindowFrames } from './windows.ts';
import { importMenuArt, RIBBON_COUNT, RIBBON_ROW_SIZE, type RibbonText } from './menus.ts';
import { importMapPopups } from './map-popups.ts';
import { importPartyArt } from './party.ts';
import { importSummaryArt } from './summary.ts';
export { mapPopupSheet, MAP_POPUP_STYLES } from './map-popups.ts';
import { importIconFrames, importItemIcons, ITEM_ARCHIVE_ENTRIES } from './items.ts';
import { importPokedexArt } from './pokedex.ts';
import { importEvolutionArt } from './evolution.ts';
import { importEggHatchArt } from './egg-hatch.ts';
import { importLibraryTvArt } from './library-tv.ts';
import { importMoveReminderArt, importTradeArt } from './side-screens.ts';
import { importPoffinArt } from './poffins.ts';
import { importContestArt } from './contests.ts';
import { importIntroArt } from './intro.ts';
import { importHallOfFameArt } from './hall-of-fame.ts';
import { importShopArt } from './shop.ts';
import { importStartMenuArt } from './start-menu.ts';
import { importPoketchArt } from './poketch.ts';
import { importBagArt } from './bag.ts';
import { importBoxArt } from './box.ts';
import { DANCE_PRESS_STEPS, DANCE_TIMELINE_TILES, importContestDanceArt } from './contest-dance.ts';
import { importTownMapArt, type HiddenPatch } from './town-map.ts';
import { importContestActingArt } from './contest-acting.ts';
import { importSealArt } from './seals.ts';
import { importDiplomaArt, importJournalArt } from './journal-diploma.ts';

export * from './compose.ts';
export * from './nanr.ts';
export * from './ncer.ts';
export * from './nitro2d.ts';
export * from './png.ts';
export * from './pokegra.ts';
export { Sheets, sheetId } from './sheets.ts';
export { importTrapArt, importUndergroundArt, miningObjectCell } from './underground.ts';
export { accessoryPictures } from './contests.ts';
export { importSlotArt } from './slots.ts';

/** Code tables the 2D import reads, each verified by SHA1. */
const TABLES = {
  /** pokemon_icon.c sPokemonIconPaletteIndex (generated species_icon_palettes.h): u8 palette per icon. */
  iconPalettes: { where: 'arm9', offset: 0xf0780, size: 540, sha1: '0657e956fab3593c015e89100e25b26bd4ac48e6' },
  /** item.c sItemArchiveIDs (generated item_id_map.h): {dataID, iconID, paletteID, gen3ID} per item. */
  itemArchive: { where: 'arm9', offset: 0xf0cc4, size: ITEM_ARCHIVE_ENTRIES * 8, sha1: '29454be469cee01f941d09948470ffead730e58a' },
  /** ribbon.c sRibbonDataTable: {u32 monDataParam, u16 spriteID, u16 paletteNum, u16 nameID, u16 descriptionID} per ribbon. */
  ribbons: { where: 'arm9', offset: 0xf51ac, size: RIBBON_COUNT * RIBBON_ROW_SIZE, sha1: '89f0a7d94d6ebe4c82c58a98fdcbcce41d0e32a4' },
  healthboxParts: { where: HEALTHBOX_PARTS.overlay, offset: HEALTHBOX_PARTS.offset, size: HEALTHBOX_PARTS.size, sha1: '6d0c3404d49a6b4ffdaa9203eaf142abd31c9b14' },
  /** move_palettes.c: the move buttons' type palettes. */
  movePalettes: { where: MOVE_PALETTES.overlay, offset: MOVE_PALETTES.offset, size: MOVE_PALETTES.size, sha1: '48ad44a2b65ae05f6fb025cd2a9c62f2fdb3fdcb' },
  /** ov17_0223F7E4.c Unk_ov17_022534B8: the acting round's move buttons, five palettes of 16 BGR555 colours. */
  contestButtonPalettes: { where: 17, offset: 0x18378, size: 160, sha1: '88229a78266a8e8de6b1f9f93f3fdee09ac60f55' },
  /** ov17_0224A0FC.c Unk_ov17_02254898: the Dance Competition's variant-1 timeline tiles; ov17_022492DC.c Unk_ov17_02254630: its buttons' press steps. */
  danceTimeline: { where: 17, offset: 0x19758, size: DANCE_TIMELINE_TILES * 2, sha1: '624dd31f936eb7f30b500241a03835bd14d4d5f2' },
  dancePress: { where: 17, offset: 0x194f0, size: DANCE_PRESS_STEPS * 4 * 12, sha1: '160299e6981f1d57359c421a84d5668b50dccba7' },
} as const;
/** The US layout of these tables (tools/relocate.ts finds them in other builds). */
export { TABLES as UI2D_TABLES };

export interface Ui2dImport {
  ui2d: Ui2dSheet[];
  pokemonSprites: PokemonSprites[];
  trainerSprites: TrainerSprite[];
  battleBackgrounds: BattleBackground[];
  battleTerrains: BattleTerrain[];
  /** Each ribbon's name and description (TEXT_BANK_RIBBON_NAMES message numbers), by ribbon id. */
  ribbons: RibbonText[];
  /** Item index (sourceIndex) → its icon PNG's pack path. */
  itemIcons: Map<number, string>;
  /** Where the Town Map's hidden-location patches go (enum HiddenLocation order). */
  townMapPatches: HiddenPatch[];
  /** Pack path → bytes. */
  assets: Map<string, Uint8Array>;
}

/** `speciesIds`/`classIds`: species and trainer class ids by index (names.json order). */
export async function importUi2d(fs: NitroFs, build: RomBuild, speciesIds: Id[], classIds: Id[], onProgress: (done: number, total: number) => void = () => {}): Promise<Ui2dImport> {
  const tables = placeTables(TABLES, build.layout, 'ui2d');
  const table = async (key: keyof typeof TABLES): Promise<Uint8Array> => {
    const t = tables[key];
    const src = t.where === 'arm9' ? fs.arm9() : fs.overlay(t.where);
    const bytes = src.subarray(t.offset, t.offset + t.size);
    const got = await sha1Hex(bytes);
    if (got !== t.sha1) throw new Error(`ROM table ${key} at ${t.where}:0x${t.offset.toString(16)} has SHA1 ${got}, expected ${t.sha1}`);
    return bytes;
  };
  const sheets = new Sheets();
  onProgress(0, 4);
  const pokemon = await importPokemon(fs, speciesIds, await table('iconPalettes'));
  onProgress(1, 4);
  const trainerSprites = importTrainerSprites(fs, classIds, sheets);
  onProgress(2, 4);
  const battle = importBattleArt(fs, sheets, pokemon.assets, await table('healthboxParts'));
  importBattleButtons(fs, sheets, await table('movePalettes'));
  onProgress(3, 4);
  importWindowFrames(fs, sheets);
  const ribbons = importMenuArt(fs, sheets, await table('ribbons'));
  importPartyArt(fs, sheets);
  importSummaryArt(fs, sheets);
  importMapPopups(fs, sheets);
  importIconFrames(fs, sheets);
  importPokedexArt(fs, sheets);
  importEvolutionArt(fs, sheets);
  importEggHatchArt(fs, sheets);
  importLibraryTvArt(fs, sheets);
  importMoveReminderArt(fs, sheets);
  importTradeArt(fs, sheets);
  importPoffinArt(fs, sheets);
  importContestArt(fs, sheets);
  importIntroArt(fs, sheets);
  importHallOfFameArt(fs, sheets);
  importShopArt(fs, sheets);
  importStartMenuArt(fs, sheets);
  importPoketchArt(fs, sheets);
  importBagArt(fs, sheets);
  importBoxArt(fs, sheets);
  importSealArt(fs, sheets);
  importContestDanceArt(fs, sheets, await table('danceTimeline'), await table('dancePress'));
  const townMapPatches = importTownMapArt(fs, sheets);
  importJournalArt(fs, sheets);
  importDiplomaArt(fs, sheets);
  {
    const b = await table('contestButtonPalettes');
    importContestActingArt(fs, sheets, Array.from({ length: 5 }, (_, p) => Array.from({ length: 16 }, (_, c) => b[(p * 16 + c) * 2]! | (b[(p * 16 + c) * 2 + 1]! << 8))));
  }
  const items = importItemIcons(fs, await table('itemArchive'));
  onProgress(4, 4);
  const assets = new Map([...pokemon.assets, ...sheets.assets, ...items.assets]);
  return { ui2d: sheets.records, pokemonSprites: pokemon.records, trainerSprites, battleBackgrounds: battle.backgrounds, battleTerrains: battle.terrains, ribbons, itemIcons: items.icons, townMapPatches, assets };
}
