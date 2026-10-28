/** The game's language: its text, its `/resource/<dir>/` files and the language its Pokémon are from. */
export type RomLanguage = 'en' | 'de';

/**
 * Supported ROMs, keyed by whole-file SHA-1: US rev 0 from pret/pokeplatinum platinum.us/rom_rev0.sha1; German rev 0
 * measured on a dump (docs/research/german-rom.md). Each id has a table layout in the importer (importer/src/layout.ts).
 */
export interface SupportedRom {
  id: string;
  name: string;
  gameCode: string;
  revision: number;
  language: RomLanguage;
}

export const SUPPORTED_ROMS: Readonly<Record<string, SupportedRom>> = {
  ce81046eda7d232513069519cb2085349896dec7: { id: 'platinum-us-rev0', name: 'Platinum (US, rev 0)', gameCode: 'CPUE', revision: 0, language: 'en' },
  '5d009a175c77d4387cde26d34efb71aee825a938': { id: 'platinum-de-rev0', name: 'Platin-Edition (German, rev 0)', gameCode: 'CPUD', revision: 0, language: 'de' },
};

/**
 * HeartGold/SoulSilver, accepted only as the source of the optional follower add-on (docs/decisions.md),
 * never as a base game: US 1.0 (header revision 0), keyed by whole-file SHA-1 from the HGSS decomp fork
 * (pinned 3cbb878) heartgold.us/rom.sha1 and soulsilver.us/rom.sha1 (docs/research/hgss-import.md §1).
 */
export interface HgssRom extends SupportedRom {
  edition: 'heartgold' | 'soulsilver';
}

export const HGSS_ROMS: Readonly<Record<string, HgssRom>> = {
  '4fcded0e2713dc03929845de631d0932ea2b5a37': { id: 'heartgold-us-rev0', name: 'HeartGold (US, rev 0)', gameCode: 'IPKE', revision: 0, language: 'en', edition: 'heartgold' },
  f8dc38ea20c17541a43b58c5e6d18c1732c7e582: { id: 'soulsilver-us-rev0', name: 'SoulSilver (US, rev 0)', gameCode: 'IPGE', revision: 0, language: 'en', edition: 'soulsilver' },
};
