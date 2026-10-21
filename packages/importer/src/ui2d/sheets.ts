/**
 * Building `ui2d` sheets: draw an NCER bank's cells (or BG images), pack them into one atlas PNG and
 * describe them as a `Ui2dSheet` record. Sheets are collected per import with their assets.
 */
import type { Ui2dAnimation, Ui2dSheet } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import { pack, renderCell, type CellImage, type Image } from './compose.ts';
import type { AnimSequence } from './nanr.ts';
import { readNanr } from './nanr.ts';
import { readNcer } from './ncer.ts';
import { readNclr, readNcgrData } from './nitro2d.ts';
import { encodeImage } from './png.ts';

export const sheetId = (path: string): Id => asId(`platinum:ui2d/${path}`);

export const animations = (seqs: AnimSequence[]): Ui2dAnimation[] =>
  seqs.map((s) => ({ mode: s.mode, loopStart: s.loopStart, frames: s.frames.map((f) => ({ ...f })) }));

/** NARC members of one OBJ resource set (decomp SpriteResourcesHeader: characters, palette, cells, animations). */
export interface ObjMembers {
  ncgr: number;
  nclr: number;
  ncer: number;
  nanr?: number;
  /** Replaces every OAM's palette number (NNS explicit palette offset). */
  palette?: number;
  /** First palette of the file to use (palette RAM loaded from a later palette of the file). */
  paletteFrom?: number;
  /** The NCLR is a compressed palette (`readNclr`'s option). */
  compressed?: boolean;
}

export class Sheets {
  readonly records: Ui2dSheet[] = [];
  readonly assets = new Map<string, Uint8Array>();
  private readonly ids = new Set<string>();

  /** Adds a sheet of drawn cells at `ui2d/<path>.png`, id `platinum:ui2d/<path>`. */
  add(path: string, cells: CellImage[], extra: Pick<Ui2dSheet, 'animations' | 'names' | 'nineSlice' | 'textColors' | 'emitters'> = {}): Id {
    if (this.ids.has(path)) throw new Error(`ui2d: sheet ${path} added twice`);
    this.ids.add(path);
    const packed = pack(cells);
    const asset = `ui2d/${path}.png`;
    this.assets.set(asset, encodeImage(packed.image));
    const record: Ui2dSheet = { id: sheetId(path), atlas: asId(`platinum:${asset}`), cells: packed.cells, ...extra };
    this.records.push(record);
    return record.id;
  }

  /** A single image (a BG render) as a one-cell sheet. */
  image(path: string, img: Image, extra: Pick<Ui2dSheet, 'nineSlice' | 'textColors'> = {}): Id {
    return this.add(path, [{ ...img, originX: 0, originY: 0 }], extra);
  }

  /** An OBJ resource set from a NARC: every cell drawn, the NANR sequences as animations. */
  obj(path: string, narc: Uint8Array[], m: ObjMembers): Id {
    const member = (i: number) => {
      const b = narc[i];
      if (!b) throw new Error(`ui2d ${path}: no NARC member ${i}`);
      return b;
    };
    const bank = readNcer(member(m.ncer));
    const chars = readNcgrData(member(m.ncgr));
    if (chars.scanned) throw new Error(`ui2d ${path}: member ${m.ncgr} is a scanned NCGR, not cell graphics`);
    const colors = readNclr(member(m.nclr), { compressed: !!m.compressed }).colors.subarray((m.paletteFrom ?? 0) * 16);
    const cells = bank.cells.map((c) => renderCell(c, chars.data, colors, { mapping: bank.mapping, ...(m.palette !== undefined ? { palette: m.palette } : {}) }));
    const anims = m.nanr === undefined ? undefined : animations(readNanr(member(m.nanr)));
    for (const a of anims ?? []) for (const f of a.frames) if (f.cell >= cells.length) throw new Error(`ui2d ${path}: animation frame names cell ${f.cell} of ${cells.length}`);
    return this.add(path, cells, anims ? { animations: anims } : {});
  }
}
