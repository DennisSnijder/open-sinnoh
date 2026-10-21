import { Reader } from '@opensinnoh/nds';

/** Script file entry table (header only; the bytecode is the VM's): u32 rel per entry, until 0xFD13 or the first code byte. */
export function readScriptEntryOffsets(bytes: Uint8Array): number[] {
  const r = new Reader(bytes);
  const out: number[] = [];
  let lowest = bytes.length;
  for (let o = 0; o + 4 <= lowest; o += 4) {
    if (r.u16(o) === 0xfd13) break;
    const target = o + 4 + r.i32(o);
    if (target < o + 4 || target >= bytes.length) throw new Error(`script table: entry ${out.length} points to ${target}, outside the file`);
    out.push(target);
    lowest = Math.min(lowest, target);
  }
  return out;
}

/** trdata member (decomp `TrainerHeader`, 20 B). */
export interface TrainerHeader {
  monDataType: number;
  trainerClass: number;
  partySize: number;
  /** Battle items (0 = none). */
  items: number[];
  aiMask: number;
  /** decomp BATTLE_TYPE_* bits; BATTLE_TYPE_DOUBLES = 1 << 1. */
  battleType: number;
}

export function readTrainerHeader(bytes: Uint8Array): TrainerHeader {
  if (bytes.length !== 20) throw new Error(`trainer data: ${bytes.length} bytes, expected 20`);
  const r = new Reader(bytes);
  const monDataType = r.u8(0);
  if (monDataType > 3) throw new Error(`trainer data: mon data type ${monDataType}`);
  return { monDataType, trainerClass: r.u8(1), partySize: r.u8(3), items: [4, 6, 8, 10].map((o) => r.u16(o)), aiMask: r.u32(12), battleType: r.u32(16) };
}

/** Bytes per party member by mon data type: base, +moves, +item, +moves and item. */
const MON_SIZE = [8, 16, 10, 18];

export interface RawTrainerMon {
  ivScale: number;
  level: number;
  species: number;
  form: number;
  /** Data types 2 and 3. */
  item?: number;
  /** Data types 1 and 3: four move ids (0 = empty). */
  moves?: number[];
  ballSeal: number;
}

/**
 * trpoke member (decomp TrainerMon*): `partySize` mons of u16 ivScale, level, species (form in bits
 * 10–15), [item], [4 moves], ball seal.
 */
export function readTrainerParty(bytes: Uint8Array, header: TrainerHeader): RawTrainerMon[] {
  const size = MON_SIZE[header.monDataType] as number;
  const r = new Reader(bytes);
  if (bytes.length < size * header.partySize) throw new Error(`trainer party: ${bytes.length} bytes for ${header.partySize} × ${size}`);
  const withItem = header.monDataType >= 2;
  const withMoves = header.monDataType === 1 || header.monDataType === 3;
  return Array.from({ length: header.partySize }, (_, i) => {
    let o = i * size;
    const sp = r.u16(o + 4);
    const mon: RawTrainerMon = { ivScale: r.u16(o), level: r.u16(o + 2), species: sp & 0x3ff, form: sp >> 10, ballSeal: 0 };
    o += 6;
    if (withItem) {
      mon.item = r.u16(o);
      o += 2;
    }
    if (withMoves) {
      mon.moves = [0, 1, 2, 3].map((k) => r.u16(o + k * 2));
      o += 8;
    }
    mon.ballSeal = r.u16(o);
    return mon;
  });
}

/** Overlay 5 table (decomp `gObjectEventGfxTexturesTable`): `{u32 gfx, u32 mmodel member}` until gfx 0xFFFF. */
export function readObjectGfxTable(bytes: Uint8Array): Map<number, number> {
  const r = new Reader(bytes);
  const out = new Map<number, number>();
  for (let o = 0; ; o += 8) {
    const gfx = r.u32(o);
    if (gfx === 0xffff) {
      if (o + 8 !== bytes.length) throw new Error('object gfx table: sentinel before the end of the table');
      return out;
    }
    if (out.has(gfx)) throw new Error(`object gfx table: duplicate gfx ${gfx}`);
    out.set(gfx, r.u32(o + 4));
  }
}

/**
 * Trainer field messages (decomp Trainer_LoadMessage): trtblofs is a u16 byte offset per trainer into
 * trtbl, a list of {u16 trainer, u16 message type}; a trainer's entries are contiguous. Entry n is message
 * n of TEXT_BANK_NPC_TRAINER_MESSAGES. Returns message type → message index.
 */
export function readTrainerMessages(trtbl: Uint8Array, trtblofs: Uint8Array, trainer: number): Map<number, number> {
  const t = new Reader(trtbl);
  let offset = new Reader(trtblofs).u16(trainer * 2);
  const out = new Map<number, number>();
  for (; offset < trtbl.length && t.u16(offset) === trainer; offset += 4) {
    const type = t.u16(offset + 2);
    if (out.has(type)) throw new Error(`trainer ${trainer}: message type ${type} listed twice`);
    out.set(type, offset / 4);
  }
  return out;
}
