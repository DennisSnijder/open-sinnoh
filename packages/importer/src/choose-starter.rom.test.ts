/** The starter-choice scene's import on the real ROM (OPENSINNOH_NDS_ROM; skipped without it). */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NitroFs } from '@opensinnoh/nds';
import { CHOOSE_STARTER_MODELS, importChooseStarter } from './choose-starter.ts';
import { decodeImage, Sheets } from './ui2d/index.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('choose-starter import (OPENSINNOH_NDS_ROM)', () => {
  let out: ReturnType<typeof importChooseStarter>;
  const sheets = new Sheets();
  beforeAll(() => {
    out = importChooseStarter(new NitroFs(new Uint8Array(readFileSync(romPath!))), sheets);
  });

  it('converts the briefcase, the balls and the floor; the briefcase and the balls keep their clips', () => {
    expect(out.models.map((m) => m.id)).toEqual(CHOOSE_STARTER_MODELS.map((n) => `platinum:MODEL_CHOOSE_STARTER_${n.toUpperCase()}`));
    const clips = (name: string) => (JSON.parse(new TextDecoder().decode(out.assets.get(`choose_starter/${name}/${name}.gltf`)!)) as { animations?: { name: string }[] }).animations?.map((a) => a.name) ?? [];
    expect(clips('briefcase')).toEqual(['psel_all']);
    expect(clips('ball_0')).toEqual(['psel_mb_a']);
    expect(clips('ball_2')).toEqual(['psel_mb_c']);
    expect(clips('briefcase_open')).toEqual([]);
    expect(clips('floor')).toEqual([]);
  });

  it('draws the cursor, the preview disc and the text colours', () => {
    const byId = new Map(sheets.records.map((s) => [s.id, s]));
    const image = (id: string) => decodeImage(sheets.assets.get(byId.get(id as never)!.atlas.slice('platinum:'.length))!);
    // The pointing hand: one 32×32 cell centred on its origin.
    expect(byId.get('platinum:ui2d/choose_starter/cursor' as never)!.cells).toEqual([{ x: 0, y: 0, w: 32, h: 32, ox: 16, oy: 16 }]);
    // The disc: 128×128, opaque white in its middle, transparent in the corners.
    const disc = image('platinum:ui2d/choose_starter/preview_window');
    expect([disc.width, disc.height]).toEqual([128, 128]);
    const at = (x: number, y: number) => [...disc.rgba.subarray((y * 128 + x) * 4, (y * 128 + x) * 4 + 4)];
    expect(at(64, 64)).toEqual([255, 255, 255, 255]);
    expect(at(2, 2)[3]).toBe(0);
    // The message colours: dark grey letters (1) on white (15); COLOR 1–3 are red, blue and green.
    const text = image('platinum:ui2d/choose_starter/text_colors');
    const colour = (i: number) => [...text.rgba.subarray(i * 4, i * 4 + 3)];
    expect(text.width).toBe(16);
    expect(colour(15)).toEqual([255, 255, 255]);
    const [r3, g3, b3] = colour(3);
    expect(r3! > 200 && g3! < 80 && b3! < 80).toBe(true);
    const [r7, g7, b7] = colour(7);
    expect(g7! > r7! && g7! > b7!).toBe(true);
  });
});
