/**
 * The Underground's tables (contracts `UndergroundTables`; decomp overlay 23 `underground` and arm9 data), read from the
 * player's ROM. Each region is checked by SHA-1 in platinum.ts (`TABLES`) before it is read here.
 * - mining.c sMiningObjects (overlay 23): 20 bytes each {void *shape, u16 weights[4], u8 width, u8 height, u8 itemID,
 *   u8 pad, u16 spriteNARCIndex, u16 paletteNARCIndex}; a shape points into the overlay (`x`/`o` bytes, width/2 per row).
 * - underground.c sMiningItems (arm9): u16 bag item per treasure from MINING_TREASURE_OVAL_STONE.
 * - scrcmd_fossil.c sFossilItemToSpeciesMapping (arm9): {u16 item, u16 species} × 7.
 * - trap_prices.c sTrapPrices, treasure_prices.c sTreasurePrices (overlay 23): SpherePrice {u8 type, u8 min, u8 max}.
 * - goods.c sGoodData (arm9): 28 bytes each {u8 width, u8 depth, u8 collision[9], SpherePrice, int moneyPrice,
 *   int interactMessageID, u8 natDexRequired, u8 ungiftable}; the interact message is a TEXT_BANK_UNDERGROUND_RECORDS
 *   entry (SomethingWrittenTotalScore … FlagsRegistered) or 0.
 * - vendors.c sUndergroundVendors (overlay 23): {u16 vendorType, u16 x, u16 z} × 20.
 * - traps.c Traps_SpawnRandomTrap's `traps` (overlay 23): u8 trap id × 26.
 */
import type { MiningObject, Model, SpherePrice, UndergroundBaseTables, UndergroundTables, UndergroundTrapTables } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { modelToGltf, readModels, readTex0 } from '@opensinnoh/g3d';
import { Reader, type NitroFs } from '@opensinnoh/nds';

export const MINING_OBJECTS = 85;
export const MINING_OBJECT_SIZE = 20;
export const TREASURE_ITEMS = 49;
export const FOSSILS = 7;
export const TRAPS = 34;
export const SPAWN_TRAPS = 26;
export const MINING_IDS = 60;
export const GOODS = 139;
export const GOOD_SIZE = 28;
export const VENDORS = 20;
const VENDOR_KINDS = ['goods', 'traps', 'treasures'] as const;

export interface UndergroundRegions {
  miningObjects: Uint8Array;
  /** The shapes' bytes and the RAM address of their first byte (the table's pointers are RAM addresses). */
  shapes: { bytes: Uint8Array; ram: number };
  treasureItems: Uint8Array;
  fossils: Uint8Array;
  trapPrices: Uint8Array;
  treasurePrices: Uint8Array;
  goods: Uint8Array;
  vendors: Uint8Array;
  spawnTraps: Uint8Array;
}

const price = (b: Uint8Array, at: number): SpherePrice => {
  const p = { sphere: b[at]!, min: b[at + 1]!, max: b[at + 2]! };
  if (p.sphere > 6 || p.min > p.max) throw new Error(`underground: bad sphere price ${JSON.stringify(p)} at ${at}`);
  return p;
};

export function readMiningObjects(table: Uint8Array, shapes: UndergroundRegions['shapes']): MiningObject[] {
  const r = new Reader(table);
  return Array.from({ length: MINING_OBJECTS }, (_, i) => {
    const o = i * MINING_OBJECT_SIZE;
    const ptr = r.u32(o);
    const width = r.u8(o + 12);
    const height = r.u8(o + 13);
    if (width % 2 || height % 2 || !width || !height) throw new Error(`mining object ${i}: odd size ${width}×${height}`);
    let shape: string | null = null;
    if (ptr) {
      const at = ptr - shapes.ram;
      const n = (width / 2) * (height / 2);
      if (at < 0 || at + n > shapes.bytes.length) throw new Error(`mining object ${i}: shape pointer 0x${ptr.toString(16)} outside the shapes`);
      // The game tests each byte for 'o' only; anything else is part of the object (the Damp Rock's short rows).
      shape = Array.from(shapes.bytes.subarray(at, at + n), (c) => (c === 0x6f ? 'o' : 'x')).join('');
    }
    return {
      id: r.u8(o + 14),
      weights: [r.u16(o + 4), r.u16(o + 6), r.u16(o + 8), r.u16(o + 10)],
      width: width / 2,
      height: height / 2,
      shape,
      sprite: r.u16(o + 16),
      palette: r.u16(o + 18),
    };
  });
}

/** records.c DECORATION_MESSAGES_START … _MAX: the goods' A messages in TEXT_BANK_UNDERGROUND_RECORDS. */
const INTERACT = { first: 32, last: 45 };

export function readUndergroundTables(
  b: UndergroundRegions,
  ids: {
    zone: Id;
    item: (i: number) => Id;
    species: (i: number) => Id;
    flags: UndergroundTables['flags'];
    vars: UndergroundTables['vars'];
    sparkle: Id;
    /** The good's prop (the Underground area's prop list at the good id), null when not converted. */
    goodProp: (good: number) => Id | null;
    traps: UndergroundTrapTables;
    base: UndergroundBaseTables;
  },
): UndergroundTables {
  const items = new Reader(b.treasureItems);
  const fossils = new Reader(b.fossils);
  const goods = new Reader(b.goods);
  const vendors = new Reader(b.vendors);
  return {
    zone: ids.zone,
    miningObjects: readMiningObjects(b.miningObjects, b.shapes),
    treasureItems: Array.from({ length: TREASURE_ITEMS }, (_, i) => ids.item(items.u16(i * 2))),
    fossils: Array.from({ length: FOSSILS }, (_, i) => ({ item: ids.item(fossils.u16(i * 4)), species: ids.species(fossils.u16(i * 4 + 2)) })),
    trapPrices: Array.from({ length: TRAPS }, (_, i) => price(b.trapPrices, i * 3)),
    treasurePrices: Array.from({ length: MINING_IDS }, (_, i) => price(b.treasurePrices, i * 3)),
    goods: Array.from({ length: GOODS }, (_, i) => {
      const o = i * GOOD_SIZE;
      const nat = goods.u8(o + 24);
      if (nat > 1) throw new Error(`good ${i}: natDexRequired ${nat}`);
      const width = goods.u8(o);
      const depth = goods.u8(o + 1);
      if (width > 3 || depth > 3) throw new Error(`good ${i}: ${width}×${depth} is over MAX_GOOD_WIDTH × MAX_GOOD_DEPTH`);
      const collision = Array.from({ length: 9 }, (_, k) => goods.u8(o + 2 + k));
      if (collision.some((c) => c > 1)) throw new Error(`good ${i}: collision ${collision.join(',')}`);
      const interact = goods.u32(o + 20);
      if (interact !== 0 && (interact < INTERACT.first || interact > INTERACT.last)) throw new Error(`good ${i}: interact message ${interact} outside the records' decoration messages`);
      return { price: price(b.goods, o + 11), natDex: nat === 1, width, depth, collision, interact, prop: i === 0 ? null : ids.goodProp(i) };
    }),
    vendors: Array.from({ length: VENDORS }, (_, i) => {
      const kind = VENDOR_KINDS[vendors.u16(i * 6)];
      if (!kind) throw new Error(`vendor ${i}: type ${vendors.u16(i * 6)}`);
      return { kind, x: vendors.u16(i * 6 + 2), z: vendors.u16(i * 6 + 4) };
    }),
    spawnTraps: [...b.spawnTraps],
    flags: ids.flags,
    vars: ids.vars,
    sparkle: ids.sparkle,
    traps: ids.traps,
    base: ids.base,
  };
}

/** /data/ug_base_cur.nsbmd: the decoration's cursor (DecorateCursor_Init), its embedded textures. */
const BASE_CURSOR = { path: '/data/ug_base_cur.nsbmd', id: 'platinum:MODEL_UG_BASE_CURSOR', dir: 'models/underground/base_cursor' };

/** The decoration cursor as a model record, its glTF and textures written to `assets`. */
export function convertBaseCursor(fs: NitroFs, assets: Map<string, Uint8Array>, warn: (w: string) => void): Model {
  const bytes = fs.file(BASE_CURSOR.path);
  const [model, ...rest] = readModels(bytes);
  if (!model || rest.length) throw new Error(`${BASE_CURSOR.path}: expected one model`);
  const tex0 = readTex0(bytes);
  const res = modelToGltf(model, tex0 ? { embed: tex0 } : {});
  res.warnings.forEach(warn);
  for (const [file, png] of res.images) assets.set(`${BASE_CURSOR.dir}/${file}`, png);
  assets.set(`${BASE_CURSOR.dir}/model.gltf`, new TextEncoder().encode(JSON.stringify(res.gltf)));
  return { id: BASE_CURSOR.id as Id, gltf: `platinum:${BASE_CURSOR.dir}/model.gltf` };
}
