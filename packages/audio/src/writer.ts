import type { InstrumentRegion } from '@opensinnoh/contracts';

/**
 * Our own writers for the DS sound formats: sequence bytecode, SSEQ, SBNK, SWAR and SDAT files. Tests
 * parse what these write, and the fixture pack's original music is built with `Seq`. Nothing here is
 * read from a ROM.
 */

/** Builds SSEQ event bytecode; labels resolve 24-bit jump, call and open-track targets. */
export class Seq {
  private readonly out: number[] = [];
  private readonly labels = new Map<string, number>();
  private readonly fixups: { at: number; label: string }[] = [];

  label(name: string): this {
    this.labels.set(name, this.out.length);
    return this;
  }
  bytes(...b: number[]): this {
    this.out.push(...b.map((x) => x & 0xff));
    return this;
  }
  private varlen(v: number): number[] {
    const groups = [v & 0x7f];
    for (v >>= 7; v > 0; v >>= 7) groups.unshift((v & 0x7f) | 0x80);
    return groups;
  }
  private ref(label: string): this {
    this.fixups.push({ at: this.out.length, label });
    return this.bytes(0, 0, 0);
  }
  note(key: number, velocity: number, length: number): this {
    return this.bytes(key, velocity, ...this.varlen(length));
  }
  wait(ticks: number): this {
    return this.bytes(0x80, ...this.varlen(ticks));
  }
  program(n: number): this {
    return this.bytes(0x81, ...this.varlen(n));
  }
  allocateTracks(mask: number): this {
    return this.bytes(0xfe, mask & 0xff, mask >> 8);
  }
  openTrack(track: number, label: string): this {
    return this.bytes(0x93, track).ref(label);
  }
  jump(label: string): this {
    return this.bytes(0x94).ref(label);
  }
  call(label: string): this {
    return this.bytes(0x95).ref(label);
  }
  ret(): this {
    return this.bytes(0xfd);
  }
  tempo(bpm: number): this {
    return this.bytes(0xe1, bpm & 0xff, bpm >> 8);
  }
  volume(v: number): this {
    return this.bytes(0xc1, v);
  }
  pan(p: number): this {
    return this.bytes(0xc0, p);
  }
  noteWait(on: boolean): this {
    return this.bytes(0xc7, on ? 1 : 0);
  }
  loopStart(count: number): this {
    return this.bytes(0xd4, count);
  }
  loopEnd(): this {
    return this.bytes(0xfc);
  }
  end(): this {
    return this.bytes(0xff);
  }
  build(): Uint8Array {
    const out = Uint8Array.from(this.out);
    for (const f of this.fixups) {
      const at = this.labels.get(f.label);
      if (at === undefined) throw new Error(`Seq: no label ${f.label}`);
      out[f.at] = at & 0xff;
      out[f.at + 1] = (at >> 8) & 0xff;
      out[f.at + 2] = at >> 16;
    }
    return out;
  }
}

class Bytes {
  readonly b: number[] = [];
  u8(v: number) {
    this.b.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v).u8(v >> 8);
  }
  u32(v: number) {
    return this.u16(v & 0xffff).u16(v >>> 16);
  }
  ascii(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  pad(n: number) {
    for (let i = 0; i < n; i++) this.u8(0);
    return this;
  }
  align(n: number) {
    while (this.b.length % n) this.u8(0);
    return this;
  }
  set32(at: number, v: number) {
    this.b[at] = v & 0xff;
    this.b[at + 1] = (v >> 8) & 0xff;
    this.b[at + 2] = (v >> 16) & 0xff;
    this.b[at + 3] = (v >>> 24) & 0xff;
  }
  bytes(src: ArrayLike<number>) {
    for (let i = 0; i < src.length; i++) this.b.push(src[i]!);
    return this;
  }
}

/** A NITRO file: magic, BOM, version, size, header size 16, one block. */
function nitroFile(magic: string, block: Bytes): Uint8Array {
  const f = new Bytes().ascii(magic).u16(0xfeff).u16(0x0100).u32(16 + block.b.length).u16(16).u16(1);
  f.bytes(block.b);
  return Uint8Array.from(f.b);
}

/** SSEQ: a DATA block whose data offset points just past it. */
export function sseqFile(events: Uint8Array): Uint8Array {
  const block = new Bytes().ascii('DATA').u32(12 + events.length).u32(16 + 12);
  block.bytes(events);
  return nitroFile('SSEQ', block);
}

/** SBNK: one record per instrument (null = none); one region → types 1–3, several → a key split. */
export function sbnkFile(instruments: (InstrumentRegion[] | null)[]): Uint8Array {
  const block = new Bytes().ascii('DATA').u32(0).pad(32).u32(instruments.length);
  const table = block.b.length;
  block.pad(instruments.length * 4);
  const typeOf = (r: InstrumentRegion) => ({ pcm: 1, psg: 2, noise: 3 })[r.type];
  const regionData = (r: InstrumentRegion) => {
    if (r.type === 'pcm') block.u16(r.wave!).u16(r.archive!);
    else block.u16(r.duty ?? 0).u16(0);
    block.u8(r.baseKey).u8(r.attack).u8(r.decay).u8(r.sustain).u8(r.release).u8(r.pan);
  };
  instruments.forEach((regions, i) => {
    const e = table + i * 4;
    if (!regions || regions.length === 0) return;
    const at = 16 + block.b.length;
    if (regions.length === 1 && regions[0]!.low === 0 && regions[0]!.high === 127) {
      block.b[e] = typeOf(regions[0]!);
      regionData(regions[0]!);
    } else {
      if (regions.length > 8) throw new Error('sbnkFile: a key split has at most 8 regions');
      block.b[e] = 17;
      for (let k = 0; k < 8; k++) block.u8(regions[k]?.high ?? 0);
      for (const r of regions) {
        block.u16(typeOf(r));
        regionData(r);
      }
    }
    block.b[e + 1] = at & 0xff;
    block.b[e + 2] = at >> 8;
    block.align(4);
  });
  block.set32(4, block.b.length);
  return nitroFile('SBNK', block);
}

export interface WaveSpec {
  /** 0 PCM8, 1 PCM16 (ADPCM is decoded only; tests build ADPCM bodies by hand). */
  format: 0 | 1;
  rate: number;
  loop: boolean;
  /** Sample index the loop starts at (a whole number of words). */
  loopStart: number;
  samples: number[];
}

export function swavBody(w: WaveSpec): Uint8Array {
  const perWord = w.format === 0 ? 4 : 2;
  if (w.samples.length % perWord || w.loopStart % perWord) throw new Error('swavBody: samples and loop start must fill whole words');
  const b = new Bytes()
    .u8(w.format)
    .u8(w.loop ? 1 : 0)
    .u16(w.rate)
    .u16(Math.round(16756991 / w.rate))
    .u16(w.loopStart / perWord)
    .u32((w.samples.length - w.loopStart) / perWord);
  for (const s of w.samples) {
    if (w.format === 0) b.u8(s);
    else b.u16(s);
  }
  return Uint8Array.from(b.b);
}

export function swarFile(waves: WaveSpec[]): Uint8Array {
  const block = new Bytes().ascii('DATA').u32(0).pad(32).u32(waves.length);
  const table = block.b.length;
  block.pad(waves.length * 4);
  waves.forEach((w, i) => {
    block.set32(table + i * 4, 16 + block.b.length);
    block.bytes(swavBody(w));
  });
  block.set32(4, block.b.length);
  return nitroFile('SWAR', block);
}

export interface SdatSpec {
  sequences: ({ name: string; file: number; bank: number; volume: number; channelPriority: number; playerPriority: number; player: number } | null)[];
  banks: ({ name: string; file: number; waveArchives: (number | null)[] } | null)[];
  waveArchives: ({ name: string; file: number } | null)[];
  players: ({ name: string; maxSequences: number; channels: number; heapSize: number } | null)[];
  files: Uint8Array[];
}

/** An SDAT with SYMB, INFO, FAT and FILE (no sequence archives, groups or streams). */
export function sdatFile(spec: SdatSpec): Uint8Array {
  const HEADER = 0x40;
  // SYMB: 8 list offsets, then lists and strings.
  const symb = new Bytes().ascii('SYMB').u32(0).pad(32).pad(24);
  const symbList = (slot: number, names: (string | null)[]) => {
    symb.align(4);
    symb.set32(8 + slot * 4, symb.b.length);
    symb.u32(names.length);
    const at = symb.b.length;
    symb.pad(names.length * 4);
    names.forEach((n, i) => {
      if (n === null) return;
      symb.set32(at + i * 4, symb.b.length);
      symb.ascii(n).u8(0);
    });
  };
  const nameOf = <T extends { name: string } | null>(list: T[]) => list.map((x) => x?.name ?? null);
  symbList(0, nameOf(spec.sequences));
  symbList(1, []);
  symbList(2, nameOf(spec.banks));
  symbList(3, nameOf(spec.waveArchives));
  symbList(4, nameOf(spec.players));
  symbList(5, []);
  symbList(6, []);
  symbList(7, []);
  symb.align(4);
  symb.set32(4, symb.b.length);

  const info = new Bytes().ascii('INFO').u32(0).pad(32).pad(24);
  const infoList = <T>(slot: number, list: (T | null)[], write: (x: T) => void) => {
    info.align(4);
    info.set32(8 + slot * 4, info.b.length);
    info.u32(list.length);
    const at = info.b.length;
    info.pad(list.length * 4);
    list.forEach((x, i) => {
      if (x === null) return;
      info.align(4);
      info.set32(at + i * 4, info.b.length);
      write(x);
    });
  };
  infoList(0, spec.sequences, (q) => info.u16(q.file).u16(0).u16(q.bank).u8(q.volume).u8(q.channelPriority).u8(q.playerPriority).u8(q.player).u16(0));
  infoList(1, [], () => {});
  infoList(2, spec.banks, (b) => {
    info.u16(b.file).u16(0);
    for (let k = 0; k < 4; k++) info.u16(b.waveArchives[k] ?? 0xffff);
  });
  infoList(3, spec.waveArchives, (w) => info.u16(w.file).u16(0));
  infoList(4, spec.players, (p) => info.u8(p.maxSequences).u8(0).u16(p.channels).u32(p.heapSize));
  infoList(5, [], () => {});
  infoList(6, [], () => {});
  infoList(7, [], () => {});
  info.align(4);
  info.set32(4, info.b.length);

  const symbAt = HEADER;
  const infoAt = symbAt + symb.b.length;
  const fatAt = infoAt + info.b.length;
  const fatSize = 12 + spec.files.length * 16;
  const fileAt = fatAt + fatSize;
  const fat = new Bytes().ascii('FAT ').u32(fatSize).u32(spec.files.length);
  const file = new Bytes().ascii('FILE').u32(0).u32(spec.files.length).u32(0);
  for (const f of spec.files) {
    file.align(32);
    fat.u32(fileAt + file.b.length).u32(f.length).pad(8);
    file.bytes(f);
  }
  file.set32(4, file.b.length);
  const total = fileAt + file.b.length;
  const h = new Bytes().ascii('SDAT').u16(0xfeff).u16(0x0100).u32(total).u16(HEADER).u16(4);
  h.u32(symbAt).u32(symb.b.length).u32(infoAt).u32(info.b.length).u32(fatAt).u32(fatSize).u32(fileAt).u32(file.b.length).pad(16);
  return Uint8Array.from([...h.b, ...symb.b, ...info.b, ...fat.b, ...file.b]);
}
