/**
 * The Villa's and the journal's ROM tables (docs/research/villa-journal.md §5): overlay 5's furniture placements, models
 * and scripts, arm9's visitor odds, the journal's gym and building tables and overlay 81's page-turn wipe. Each table is
 * located by offset and checked by SHA-1 in platinum.ts `TABLES` before it reaches these readers.
 */
import { VILLA_FURNITURE_COUNT, type JournalTables, type VillaFurnitureRow, type VillaTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Reader } from '@opensinnoh/nds';

/** Decomp sizeof(VillaFurniture): u16 type, u16 collision, VecFx32 position, s16 left, top, right, bottom. */
export const VILLA_ROW_SIZE = 24;
/** FX32_ONE. */
const FX = 4096;
/** Decomp VILLA_FURNITURE_TV. */
const VILLA_TV = 5;
/** Decomp SCRIPT_ID_OFFSET_TV_BROADCAST: the TV's script id in sVillaFurnitureScriptIDs. */
const TV_SCRIPT = 10100;

export interface VillaContext {
  zone: Id;
  resortArea: Id;
  /** FLAG_VILLA_FURNITURE_START + type. */
  flag: (type: number) => Id;
  prop: (model: number) => Id;
  /** A script id's label (the Villa's script file for its own entries, the common scripts for the TV). */
  label: (script: number) => Id;
  visitors: Omit<VillaTables['visitors'], 'chances' | 'counts'>;
}

/** sVillaFurnitures, sVillaFurnitureModelIDs, sVillaFurnitureScriptIDs, sVillaVisitorPercentChances, sNumPossibleVillaVisitors. */
export function readVillaTables(rows: Uint8Array, models: Uint8Array, scripts: Uint8Array, chances: Uint8Array, counts: Uint8Array, ctx: VillaContext): VillaTables {
  const m = new Reader(models);
  const s = new Reader(scripts);
  const furniture = Array.from({ length: VILLA_FURNITURE_COUNT }, (_, type) => {
    const script = s.u32(type * 4);
    if (type === VILLA_TV ? script !== TV_SCRIPT : script !== 0x15 + type) throw new Error(`sVillaFurnitureScriptIDs[${type}] = ${script}`);
    return { flag: ctx.flag(type), prop: ctx.prop(m.u32(type * 4)), label: ctx.label(script) };
  });
  const r = new Reader(rows);
  const out: VillaFurnitureRow[] = [];
  for (let o = 0; o < rows.length; o += VILLA_ROW_SIZE) {
    const type = r.u16(o);
    const collision = r.u16(o + 2);
    if (type >= VILLA_FURNITURE_COUNT || collision > 1) throw new Error(`sVillaFurnitures row ${o / VILLA_ROW_SIZE}: type ${type}, collision ${collision}`);
    out.push({
      type,
      collision: collision === 1,
      position: [r.i32(o + 4) / FX, r.i32(o + 8) / FX, r.i32(o + 12) / FX],
      box: { left: r.i16(o + 16), top: r.i16(o + 18), right: r.i16(o + 20), bottom: r.i16(o + 22) },
    });
  }
  const three = (b: Uint8Array) => [b[0]!, b[1]!, b[2]!] as [number, number, number];
  return { zone: ctx.zone, resortArea: ctx.resortArea, furniture, rows: out, tvType: VILLA_TV, visitors: { ...ctx.visitors, chances: three(chances), counts: three(counts) } };
}

export interface JournalContext extends Omit<JournalTables, 'gyms' | 'buildings' | 'pageTurn'> {
  trainer: (i: number) => Id;
  zone: (i: number) => Id;
  badge: (i: number) => Id;
}

/** journal.c sGymsInfo ({u32 trainer, u16 map header, u16 badge}) and sMapsInfo ({u32 label, u32 exited}); journal_controller.c Unk_ov81_021D33E8. */
export function readJournalTables(gyms: Uint8Array, buildings: Uint8Array, pageTurn: Uint8Array, ctx: JournalContext): JournalTables {
  const g = new Reader(gyms);
  const b = new Reader(buildings);
  const { trainer, zone, badge, ...rest } = ctx;
  return {
    ...rest,
    gyms: Array.from({ length: gyms.length / 8 }, (_, i) => ({ trainer: trainer(g.u32(i * 8)), zone: zone(g.u16(i * 8 + 4)), badge: badge(g.u16(i * 8 + 6)) })),
    buildings: Array.from({ length: buildings.length / 8 }, (_, i) => {
      const exited = b.u32(i * 8 + 4);
      if (exited > 1) throw new Error(`sMapsInfo[${i}]: useExited ${exited}`);
      return { label: b.u32(i * 8), exited: exited === 1 };
    }),
    pageTurn: Array.from({ length: pageTurn.length / 32 }, (_, i) => [...pageTurn.subarray(i * 32, i * 32 + 32)]),
  };
}
