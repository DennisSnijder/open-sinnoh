import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NitroFs, readNarc } from '@opensinnoh/nds';
import { importFont, readNfgr } from './nfgr.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('NFGR fonts on the ROM', () => {
  it('reads the message font and converts it', () => {
    const fs = new NitroFs(new Uint8Array(readFileSync(romPath!)));
    const fonts = readNarc(fs.file('/graphic/pl_font.narc'));
    const f = readNfgr(fonts[1]!);
    expect([f.numGlyphs, f.cellWidth, f.cellHeight, f.maxWidth]).toEqual([509, 16, 16, 16]);
    expect(f.widths.every((w) => w <= 16)).toBe(true);
    // Placeholder charmap (the real one comes from the importer): private-use code points.
    const charmap = new Map(Array.from({ length: 509 }, (_, i) => [i + 1, String.fromCodePoint(0xe000 + i)]));
    const { record, png } = importFont(fonts[1]!, charmap);
    expect(Array.from(record.chars)).toHaveLength(509);
    expect(png.length).toBeGreaterThan(1000);
  });
});
