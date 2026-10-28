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

export const MANUAL: Record<string, Record<string, ManualPin>> = {
  'CPUD-rev0': {
    'platinum.weatherTasks': { offset: 0x31018, why: 'ov5 function pointers (code moves unlike data). Shift +0x20 (not the +0x1c before it): each 28-byte row has its task function at +24 there. formats/weather.ts matches the tasks by rank.' },
    'platinum.contestEffectClasses': { offset: 0x189bc, why: 'ov17 handler pointers (not read); at the ov17 shift +0x4, after contestActingMessages.' },
    'platinum.credits': { offset: 0x3f64, count: 224, why: 'German staff rows: 224 (US 237), messages 0–223 in order; creditsRows after it moved −0x50.' },
    'platinum.factoryLevel50Pools': { offset: 0x125ac, why: 'Other set ranges than US (no pointers); its ov104 neighbours are unmoved.' },
    'platinum.factoryOpenOpponentPools': { offset: 0x125fc, why: 'Other set ranges than US (no pointers); its ov104 neighbours are unmoved.' },
    'ui2d.healthboxParts': { offset: 0x34588, why: 'German status icons; the ov16 shift +0x1c (the tiles line up at +0x1c, not +0x20).' },
  },
};
