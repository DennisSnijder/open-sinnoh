import { Reader } from '@opensinnoh/nds';

/** One billboard animation of an object gfx (decomp `BillboardAnim`): frames start..end inclusive. */
export interface BillboardAnim {
  start: number;
  end: number;
  loop: boolean;
}

/** decomp `ObjectEventGfxModelAnimEntry`: billboard model, frame sequence and animation table per gfx. */
export interface ObjectGfxAnims {
  gfx: number;
  /** decomp `BillboardModel` (0 = generic 32×32, 1 = 16×16, 5 = 64×64, others are special shapes). */
  billboardModel: number;
  /** decomp `BillboardFrameSequence`; the table is mmodel member 445 + frameSeq. */
  frameSeq: number;
  anims: BillboardAnim[];
}

/** decomp BILLBOARD_ANIM_TYPE_*: LOOP 0, ONESHOT 1, TABLE_END 2. */
const ANIM_LOOP = 0;
const ANIM_ONESHOT = 1;
const ANIM_TABLE_END = 2;

/**
 * Overlay 5 `gObjectEventGfxModelAnimsTable`: `{u32 gfx, u32 model, u32 frameSeq, u32 animsPtr}` until
 * gfx 0xFFFF. `animsPtr` is an overlay RAM address of `{int start, end, type}` entries ending with
 * TABLE_END; `overlay`/`ramAddress` resolve it.
 */
export function readObjectGfxAnims(table: Uint8Array, overlay: Uint8Array, ramAddress: number): ObjectGfxAnims[] {
  const t = new Reader(table);
  const ov = new Reader(overlay);
  const out: ObjectGfxAnims[] = [];
  for (let o = 0; ; o += 16) {
    const gfx = t.u32(o);
    if (gfx === 0xffff) {
      if (o + 16 !== table.length) throw new Error('object gfx anims table: sentinel before the end of the table');
      return out;
    }
    const anims: BillboardAnim[] = [];
    let p = t.u32(o + 12) - ramAddress;
    if (p < 0 || p >= overlay.length) throw new Error(`object gfx anims: gfx ${gfx} animation pointer outside overlay 5`);
    for (; ; p += 12) {
      const type = ov.u32(p + 8);
      if (type === ANIM_TABLE_END) break;
      if (type !== ANIM_LOOP && type !== ANIM_ONESHOT) throw new Error(`object gfx anims: gfx ${gfx} has animation type ${type}`);
      const start = ov.u32(p);
      const end = ov.u32(p + 4);
      if (end < start) throw new Error(`object gfx anims: gfx ${gfx} animation ends (${end}) before it starts (${start})`);
      anims.push({ start, end, loop: type === ANIM_LOOP });
    }
    out.push({ gfx, billboardModel: t.u32(o + 4), frameSeq: t.u32(o + 8), anims });
  }
}

/** A 3D model object (signposts, mailboxes): its field-effect model and the DS draw offset. */
export interface ModelObject {
  gfx: number;
  /** `/data/mmodel/fldeff.narc` member (a BMD0 with its own TEX0). */
  fldeff: number;
  /** World units, added to the object's position (decomp `gObjectEventGfxOverworldAnimsInitialPosTable`). */
  offset: [number, number, number];
}

/**
 * Overlay 5 tables of the 3D-model object renderer (decomp ov5_021F10E8.c `Unk_ov5_02200230`:
 * `{u32 gfx, u32 fldeff member}`, a fixed-size list) and the initial-position table
 * (`{u32 gfx, fx32 x, y, z}` until gfx 0xFFFF).
 */
export function readModelObjects(models: Uint8Array, offsets: Uint8Array): ModelObject[] {
  const m = new Reader(models);
  const o = new Reader(offsets);
  const offsetOf = new Map<number, [number, number, number]>();
  for (let p = 0; ; p += 16) {
    const gfx = o.u32(p);
    if (gfx === 0xffff) {
      if (p + 16 !== offsets.length) throw new Error('model object offsets: sentinel before the end of the table');
      break;
    }
    offsetOf.set(gfx, [o.i32(p + 4) / 4096, o.i32(p + 8) / 4096, o.i32(p + 12) / 4096]);
  }
  const out: ModelObject[] = [];
  for (let p = 0; p < models.length; p += 8) {
    const gfx = m.u32(p);
    const offset = offsetOf.get(gfx);
    if (!offset) throw new Error(`model objects: gfx ${gfx} has no initial position`);
    out.push({ gfx, fldeff: m.u32(p + 4), offset });
  }
  return out;
}

/**
 * Overlay 5 `gObjectEventGfxModelsTable`: `{u32 billboard model, u32 mmodel member}` until model 0xFFFF.
 * The billboard model is the quad (or shaped model) a gfx's textures are drawn on.
 */
export function readBillboardModels(table: Uint8Array): Map<number, number> {
  const t = new Reader(table);
  const out = new Map<number, number>();
  for (let o = 0; ; o += 8) {
    const model = t.u32(o);
    if (model === 0xffff) {
      if (o + 8 !== table.length) throw new Error('billboard models table: sentinel before the end of the table');
      return out;
    }
    out.set(model, t.u32(o + 4));
  }
}
