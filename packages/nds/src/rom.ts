import { Reader } from './bytes.ts';
import { decompressBackward } from './blz.ts';

export interface NdsHeader {
  title: string;
  gameCode: string;
  makerCode: string;
  version: number;
  fntOffset: number;
  fntSize: number;
  fatOffset: number;
  fatSize: number;
  arm9OverlayOffset: number;
  arm9OverlaySize: number;
  arm9Offset: number;
  arm9Size: number;
  arm9RamAddress: number;
}

/**
 * One arm9 overlay table entry (32 B). `overlay()` rejects compressed ones (none are in Platinum US rev0);
 * `overlayCode()` decompresses them (backward LZ, blz.ts; HeartGold/SoulSilver).
 */
export interface OverlayEntry {
  id: number;
  ramAddress: number;
  ramSize: number;
  fileId: number;
  compressed: boolean;
  /** Flags bits 0–23: the stored (compressed) size. */
  storedSize: number;
}

/** The ARM9 footer's and the module parameters' nitro codes (crt0 _start_ModuleParams). */
const NITRO_CODE = 0xdec00621;
const NITRO_CODE_LE = 0x2106c0de;

export function readHeader(rom: Uint8Array): NdsHeader {
  const r = new Reader(rom);
  return {
    title: r.ascii(0, 12).replace(/\0+$/, ''),
    gameCode: r.ascii(0x0c, 4),
    makerCode: r.ascii(0x10, 2),
    version: r.u8(0x1e),
    arm9Offset: r.u32(0x20),
    arm9RamAddress: r.u32(0x28),
    arm9Size: r.u32(0x2c),
    fntOffset: r.u32(0x40),
    fntSize: r.u32(0x44),
    fatOffset: r.u32(0x48),
    fatSize: r.u32(0x4c),
    arm9OverlayOffset: r.u32(0x50),
    arm9OverlaySize: r.u32(0x54),
  };
}

/**
 * The ROM's bytes, read a range at a time: the whole image in memory, or a file read piece by piece (the import
 * worker reads the picked File, so the 134 MB image is never held at once). `read` returns at least the bytes asked for.
 */
export interface RomSource {
  readonly size: number;
  read(start: number, end: number): Uint8Array;
}

/** A RomSource whose whole-file SHA-1 the caller has computed (the importers check it against the supported ROMs). */
export interface HashedRom extends RomSource {
  readonly sha1: string;
}

/**
 * NitroFS: maps paths ("/a/b.narc") to file ids and byte ranges. On a Uint8Array, files are views of the ROM
 * buffer (no copies); on a RomSource, each read is the source's own bytes. `paths` maps a path the caller asks for
 * to the one this ROM has it at (a localized build keeps some files elsewhere; the importer asks by the US paths).
 */
export class NitroFs {
  readonly header: NdsHeader;
  private readonly source: RomSource;
  private readonly fat: Reader;
  private readonly fnt: Reader;
  private readonly paths = new Map<string, number>();
  private readonly aliases: Readonly<Record<string, string>>;

  constructor(rom: Uint8Array | RomSource, options: { paths?: Readonly<Record<string, string>> } = {}) {
    this.aliases = options.paths ?? {};
    this.source = rom instanceof Uint8Array ? { size: rom.length, read: (start, end) => rom.subarray(start, end) } : rom;
    this.header = readHeader(this.read(0, Math.min(0x200, this.source.size)));
    this.fat = new Reader(this.read(this.header.fatOffset, this.header.fatOffset + this.header.fatSize));
    this.fnt = new Reader(this.read(this.header.fntOffset, this.header.fntOffset + this.header.fntSize));
    this.walk(0xf000, '/');
  }

  private read(start: number, end: number): Uint8Array {
    if (start < 0 || end > this.source.size || start > end) throw new RangeError(`NitroFS: bytes ${start}..${end} outside the ${this.source.size}-byte ROM`);
    return this.source.read(start, end);
  }

  get fileCount(): number {
    return this.header.fatSize / 8;
  }

  listPaths(): string[] {
    return [...this.paths.keys()];
  }

  fileId(path: string): number {
    const at = this.aliases[path] ?? path;
    const id = this.paths.get(at);
    if (id === undefined) throw new Error(`NitroFS: no file at ${at}${at === path ? '' : ` (for ${path})`}`);
    return id;
  }

  /** File by id; ids below the first named file are overlays. */
  fileById(id: number): Uint8Array {
    if (id < 0 || id >= this.fileCount) throw new Error(`NitroFS: file id ${id} out of range`);
    return this.read(this.fat.u32(id * 8), this.fat.u32(id * 8 + 4));
  }

  file(path: string): Uint8Array {
    return this.fileById(this.fileId(path));
  }

  /** The static arm9 binary (no nitrocode footer). */
  arm9(): Uint8Array {
    const h = this.header;
    return this.read(h.arm9Offset, h.arm9Offset + h.arm9Size);
  }

  overlays(): OverlayEntry[] {
    const h = this.header;
    if (h.arm9OverlaySize % 32) throw new Error(`NitroFS: overlay table size ${h.arm9OverlaySize} is not a multiple of 32`);
    const out: OverlayEntry[] = [];
    const r = new Reader(this.read(h.arm9OverlayOffset, h.arm9OverlayOffset + h.arm9OverlaySize));
    for (let o = 0; o < h.arm9OverlaySize; o += 32) {
      const flags = r.u32(o + 28);
      out.push({ id: r.u32(o), ramAddress: r.u32(o + 4), ramSize: r.u32(o + 8), fileId: r.u32(o + 24), compressed: (flags & 0x01000000) !== 0, storedSize: flags & 0xffffff });
    }
    return out;
  }

  /** Raw overlay bytes; throws for compressed overlays (no BLZ decoder until a supported ROM needs one). */
  overlay(id: number): Uint8Array {
    const e = this.overlays().find((o) => o.id === id);
    if (!e) throw new Error(`NitroFS: no overlay ${id}`);
    if (e.compressed) throw new Error(`NitroFS: overlay ${id} is compressed (unsupported)`);
    return this.fileById(e.fileId);
  }

  /**
   * The ARM9 static module as loaded in RAM before its bss: the stored bytes, with the backward-compressed
   * part decompressed. The ROM footer after the ARM9 (nitro code, module parameters offset) locates the
   * module parameters; their `compressed static end` (RAM address, 0 = not compressed) ends the
   * compressed part. Both nitro codes are checked: anything else is not an executable we read.
   */
  arm9Code(): Uint8Array {
    const h = this.header;
    const arm9 = this.arm9();
    const footer = new Reader(this.read(h.arm9Offset + h.arm9Size, h.arm9Offset + h.arm9Size + 8));
    if (footer.u32(0) !== NITRO_CODE) throw new Error('NitroFS: no nitro code after the ARM9 (no module parameters)');
    const params = footer.u32(4);
    const a = new Reader(arm9);
    if (params + 0x24 > arm9.length || a.u32(params + 0x1c) !== NITRO_CODE || a.u32(params + 0x20) !== NITRO_CODE_LE) throw new Error(`NitroFS: no ARM9 module parameters at 0x${params.toString(16)}`);
    const end = a.u32(params + 0x14);
    if (end === 0) return arm9;
    const stored = end - h.arm9RamAddress;
    if (stored <= params + 0x24 || stored > arm9.length) throw new Error(`NitroFS: ARM9 compressed end 0x${end.toString(16)} outside the module`);
    const code = decompressBackward(arm9.subarray(0, stored));
    const out = new Uint8Array(code.length + arm9.length - stored);
    out.set(code);
    out.set(arm9.subarray(stored), code.length);
    return out;
  }

  /** An overlay as loaded in RAM before its bss: decompressed when its entry says so; its size is checked. */
  overlayCode(id: number): Uint8Array {
    const e = this.overlays().find((o) => o.id === id);
    if (!e) throw new Error(`NitroFS: no overlay ${id}`);
    const file = this.fileById(e.fileId);
    if (!e.compressed) return file;
    if (e.storedSize !== file.length) throw new Error(`NitroFS: overlay ${id} stores ${file.length} bytes, its entry says ${e.storedSize}`);
    const code = decompressBackward(file);
    if (code.length !== e.ramSize) throw new Error(`NitroFS: overlay ${id} decompresses to ${code.length} bytes, its entry says ${e.ramSize}`);
    return code;
  }

  private walk(dirId: number, prefix: string): void {
    const r = this.fnt;
    const entry = (dirId & 0xfff) * 8;
    let p = r.u32(entry);
    let fileId = r.u16(entry + 4);
    for (;;) {
      const t = r.u8(p++);
      if (t === 0) return;
      const name = r.ascii(p, t & 0x7f);
      p += t & 0x7f;
      if (t & 0x80) {
        const child = r.u16(p);
        p += 2;
        this.walk(child, `${prefix}${name}/`);
      } else {
        this.paths.set(prefix + name, fileId++);
      }
    }
  }
}
