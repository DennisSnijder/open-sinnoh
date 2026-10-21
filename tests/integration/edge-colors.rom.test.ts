/**
 * The field's edge colour tables on the real ROM (OPENSINNOH_NDS_ROM; skipped without it): overlay 5 holds
 * area_data.c's sIndoorsEdgeMarkings then sOutdoorsEdgeMarkings, 16 RGB555 words, exactly once, and they
 * are the renderer's EDGE_COLORS (COLOR_BLACK, COLOR_DARK_GRAY = RGB(4, 4, 4) = 0x1084).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NitroFs } from '@opensinnoh/nds';
import { EDGE_COLORS } from '../../packages/render/src/composite.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('field edge marking colours (OPENSINNOH_NDS_ROM)', () => {
  it('overlay 5 holds the renderer tables, indoors then outdoors', () => {
    const ov5 = new NitroFs(new Uint8Array(readFileSync(romPath as string))).overlay(5);
    // Our colours back to RGB555 (0..1 → 0..31; rgb5 expands c to (c << 3 | c >> 2) / 255).
    const c5 = (x: number) => Math.round(x * 255) >> 3;
    const words = [...EDGE_COLORS.indoors, ...EDGE_COLORS.outdoors].map((c) => c5(c.r) | (c5(c.g) << 5) | (c5(c.b) << 10));
    expect(words.slice(0, 2)).toEqual([0, 0x1084]);
    const bytes = new Uint8Array(new Uint16Array(words).buffer);
    const hits: number[] = [];
    for (let i = 0; i + bytes.length <= ov5.length; i += 2) if (bytes.every((b, k) => ov5[i + k] === b)) hits.push(i);
    expect(hits).toHaveLength(1);
  });
});
