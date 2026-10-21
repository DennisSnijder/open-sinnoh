/** Little-endian reader over a byte view. Out-of-range reads throw (ROM input is a boundary). */
export class Reader {
  readonly view: DataView;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  u8(o: number): number {
    this.check(o, 1);
    return this.view.getUint8(o);
  }
  u16(o: number): number {
    this.check(o, 2);
    return this.view.getUint16(o, true);
  }
  u32(o: number): number {
    this.check(o, 4);
    return this.view.getUint32(o, true);
  }
  i16(o: number): number {
    this.check(o, 2);
    return this.view.getInt16(o, true);
  }
  i32(o: number): number {
    this.check(o, 4);
    return this.view.getInt32(o, true);
  }
  ascii(o: number, n: number): string {
    this.check(o, n);
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.bytes[o + i] as number);
    return s;
  }
  slice(start: number, end: number): Uint8Array {
    if (start < 0 || end > this.bytes.length || start > end) throw new RangeError(`slice ${start}..${end} outside ${this.bytes.length} bytes`);
    return this.bytes.subarray(start, end);
  }
  private check(o: number, n: number): void {
    if (o < 0 || o + n > this.bytes.length) throw new RangeError(`read of ${n} bytes at 0x${o.toString(16)} outside ${this.bytes.length} bytes`);
  }
}
