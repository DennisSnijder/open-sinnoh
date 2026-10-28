/** The title import on the real ROM (OPENSINNOH_NDS_ROM; skipped without it). */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NitroFs } from '@opensinnoh/nds';
import { romBuildOfHeader } from '../layout.ts';
import { importTitle } from './index.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('title import (OPENSINNOH_NDS_ROM)', () => {
  let title: ReturnType<typeof importTitle>;
  beforeAll(() => {
    const bytes = new Uint8Array(readFileSync(romPath!));
    title = importTitle(new NitroFs(bytes, { paths: romBuildOfHeader(bytes).paths }));
  });

  it('writes the 3D only: no DS logo, glow or credit layers', () => {
    expect(Object.keys(title.titleScreen).sort()).toEqual(['background', 'id', 'model']);
    expect([...title.assets.keys()].every((p) => p.startsWith('title/giratina/') || p.startsWith('title/portal/'))).toBe(true);
    expect(title.titleScreen.model!.camera).toMatchObject({ position: [-64, 192, 484], target: [0, 100, -18] });
  });

  it('converts Giratina: rigidly skinned glTF with its 121-frame loop and the wing scroll', () => {
    const gltf = JSON.parse(new TextDecoder().decode(title.assets.get('title/giratina/giratina.gltf'))) as { skins?: { joints: number[] }[]; animations?: { name: string }[]; images?: { uri: string }[] };
    expect(gltf.skins?.[0]?.joints).toHaveLength(27);
    expect(gltf.animations?.map((a) => a.name)).toEqual(['title_gira']);
    for (const img of gltf.images ?? []) expect(title.assets.has(`title/giratina/${img.uri}`)).toBe(true);
    expect(title.titleScreen.model!.scroll!.map((s) => [s.material, s.frames, typeof s.translateT])).toContainEqual(['lambert2', 121, 'object']);
    expect(title.models.map((m) => m.gltf)).toEqual(['platinum:title/giratina/giratina.gltf', 'platinum:title/portal/portal.gltf']);
  });

  it('converts the intro portal as the background scene, with the intro camera', () => {
    const bg = title.titleScreen.background!;
    expect(bg.model).toBe('platinum:MODEL_TITLE_PORTAL');
    expect(bg.clip).toBe('op_ana');
    expect(bg.scroll!.length).toBeGreaterThan(0);
    expect(bg.camera.target).toEqual([0, 0, 0]);
    expect(bg.camera.position[1]).toBeCloseTo(102.94, 1);
    expect(bg.camera.fovY).toBeCloseTo(43.988, 3);
  });
});
