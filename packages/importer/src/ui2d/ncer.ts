/**
 * NCER cell banks (`RECN`, block `KBEC`), as GBATEK, NitroPaint and nitrogfx describe them:
 * `u16 cell count, u16 bank type (1 = cells carry bounds), u32 cell data offset, u32 mapping mode,
 * u32 VRAM-transfer offset (0 = none), u32, u32 user-extension offset` (offsets from block + 8).
 * Each cell: `u16 OAM count, u16 attributes, u32 offset of its OAMs (from the end of the cell table)`,
 * plus `s16 maxX, maxY, minX, minY` in extended banks. Each OAM is the hardware's three u16 attributes.
 */
import { blocks, need } from './nitro2d.ts';

/** OBJ sizes by [shape][size] (GBATEK "OBJ Attribute 0/1"). */
const OBJ_SIZES: [number, number][][] = [
  [[8, 8], [16, 16], [32, 32], [64, 64]],
  [[16, 8], [32, 8], [32, 16], [64, 32]],
  [[8, 16], [8, 32], [16, 32], [32, 64]],
];

export interface Oam {
  /** Position relative to the cell origin. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Character name (attr2 bits 0–9), in units of the bank's mapping. */
  char: number;
  palette: number;
  bitDepth: 4 | 8;
  hFlip: boolean;
  vFlip: boolean;
  /** Affine OBJ (drawn unrotated); `doubleSize` doubles its box with the image centred. */
  affine: boolean;
  doubleSize: boolean;
  priority: number;
}

export interface Cell {
  oams: Oam[];
  /** VRAM transfer: the cell's characters are this byte range of the NCGR data, its `char` 0 at `offset`. */
  transfer?: { offset: number; size: number };
}

export interface CellBank {
  cells: Cell[];
  /** 0–3 = 1D mapping with 32/64/128/256 KB boundaries (a char name is `32 << mapping` bytes), 4 = 2D (a 32-character-wide grid). */
  mapping: number;
}

export function readNcer(bytes: Uint8Array): CellBank {
  const { r, blocks: b } = blocks(bytes, 'RECN');
  const o = need(b, 'KBEC', 'NCER');
  const count = r.u16(o + 8);
  const extended = r.u16(o + 10);
  if (extended > 1) throw new Error(`2D NCER: bank type ${extended}`);
  const table = o + 8 + r.u32(o + 12);
  const mapping = r.u32(o + 16);
  if (mapping > 4) throw new Error(`2D NCER: mapping mode ${mapping}`);
  const transferAt = r.u32(o + 20);
  const entry = extended ? 16 : 8;
  const oamBase = table + count * entry;
  const cells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const e = table + i * entry;
    const oams: Oam[] = [];
    for (let k = 0; k < r.u16(e); k++) {
      const a = oamBase + r.u32(e + 4) + k * 6;
      const a0 = r.u16(a);
      const a1 = r.u16(a + 2);
      const a2 = r.u16(a + 4);
      const shape = a0 >> 14;
      const size = OBJ_SIZES[shape]?.[a1 >> 14];
      if (!size) throw new Error(`2D NCER: cell ${i} OAM ${k} has the prohibited shape 3`);
      const affine = (a0 & 0x100) !== 0;
      oams.push({
        x: ((a1 & 0x1ff) << 23) >> 23,
        y: ((a0 & 0xff) << 24) >> 24,
        width: size[0],
        height: size[1],
        char: a2 & 0x3ff,
        palette: a2 >> 12,
        bitDepth: a0 & 0x2000 ? 8 : 4,
        hFlip: !affine && (a1 & 0x1000) !== 0,
        vFlip: !affine && (a1 & 0x2000) !== 0,
        affine,
        doubleSize: affine && (a0 & 0x200) !== 0,
        priority: (a2 >> 10) & 3,
      });
    }
    cells.push({ oams });
  }
  if (transferAt) {
    const t = o + 8 + transferAt;
    const list = t + r.u32(t + 4);
    for (let i = 0; i < count; i++) cells[i]!.transfer = { offset: r.u32(list + i * 8), size: r.u32(list + i * 8 + 4) };
  }
  return { cells, mapping };
}
