/**
 * Every US-pinned ROM region the importer reads, as relocate-scan.ts `Pin`s, keyed `<set>.<table>` (the keys of the
 * importer's layouts, packages/importer/src/layout.ts). A new pinned table set belongs here too, so `pnpm relocate`
 * finds it in the other builds.
 */
import { ANIM_TABLES } from '../packages/importer/src/battle/anim.ts';
import { PLATINUM_TABLES } from '../packages/importer/src/platinum.ts';
import { UI2D_TABLES } from '../packages/importer/src/ui2d/index.ts';
import type { Pin } from './relocate-scan.ts';

export const PINS: Pin[] = [
  ...Object.entries(PLATINUM_TABLES).map(([k, t]): Pin => ({ key: `platinum.${k}`, where: t.where, offset: t.offset, length: t.count * t.size, size: t.size, sha1: t.sha1 })),
  ...Object.entries(ANIM_TABLES).map(([k, t]): Pin => ({ key: `anim.${k}`, where: t.overlay, offset: t.offset, length: t.size, size: t.size, sha1: t.sha1 })),
  ...Object.entries(UI2D_TABLES).map(([k, t]): Pin => ({ key: `ui2d.${k}`, where: t.where, offset: t.offset, length: t.size, size: t.size, sha1: t.sha1 })),
];

/**
 * Pins the scan can't prove, placed by hand per build (`<gameCode>-rev<n>`): the offset, a row count where the
 * build's table is longer or shorter, and why. The layout takes the build's own SHA-1 there; the importer's readers
 * check the contents. A manual entry for a pin the scan finds is an error (it would hide a change).
 */
export interface ManualPin {
  offset: number;
  count?: number;
  why: string;
}

export const MANUAL: Record<string, Record<string, ManualPin>> = {};
