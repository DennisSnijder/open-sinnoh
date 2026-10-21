/**
 * `data/tw_arc_etc.narc`, the Distortion World sky (decomp InitSkyBackground, InitSkyClouds and the
 * `sSkyClouds*NARCIndexes` tables): member 0 the BG characters (NCGR), 1 its palette (NCLR), 2 its
 * screen (NSCR), drawn on main BG2; then seven cloud sets of cells (NCER), characters (NCGR) and
 * animations (NANR) at 3 + 3k, 4 + 3k, 5 + 3k; and 24 the one cloud palette (NCLR). Every member is
 * parsed with the shared 2D readers; this returns what each holds.
 */
import { readNanr } from '../ui2d/nanr.ts';
import { readNcer } from '../ui2d/ncer.ts';
import { readNclr, readNcgrData, readNscr } from '../ui2d/nitro2d.ts';
import { DistortionFormatError } from './tw-arc.ts';

export const SKY_CLOUD_SETS = 7;
const MEMBERS = 3 + SKY_CLOUD_SETS * 3 + 1;

export interface DwSky {
  background: { characters: number; bitDepth: 4 | 8; colors: number; screen: { width: number; height: number } };
  clouds: { cells: number; characters: number; animations: number }[];
  cloudColors: number;
}

const tiles = (data: Uint8Array, bitDepth: 4 | 8) => data.length / (bitDepth * 8);

export function readSky(members: Uint8Array[]): DwSky {
  if (members.length !== MEMBERS) throw new DistortionFormatError(`tw_arc_etc: ${members.length} members, expected ${MEMBERS}`);
  const at = <T>(i: number, read: (b: Uint8Array) => T): T => {
    try {
      return read(members[i]!);
    } catch (e) {
      throw new DistortionFormatError(`tw_arc_etc member ${i}: ${(e as Error).message}`);
    }
  };
  const chars = at(0, readNcgrData);
  const screen = at(2, readNscr);
  return {
    background: { characters: tiles(chars.data, chars.bitDepth), bitDepth: chars.bitDepth, colors: at(1, readNclr).colors.length, screen: { width: screen.width, height: screen.height } },
    clouds: Array.from({ length: SKY_CLOUD_SETS }, (_, k) => {
      const c = at(4 + 3 * k, readNcgrData);
      return { cells: at(3 + 3 * k, readNcer).cells.length, characters: tiles(c.data, c.bitDepth), animations: at(5 + 3 * k, readNanr).length };
    }),
    cloudColors: at(24, readNclr).colors.length,
  };
}
