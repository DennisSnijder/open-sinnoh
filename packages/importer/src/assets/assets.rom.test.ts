import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NitroFs, readNarc } from '@opensinnoh/nds';
import { decodeShape, readModels, readTex0, triangulate } from '@opensinnoh/g3d';
import { drawnByMatShp, importAssets, landDataModel, readAreaData, readMatShp, SLICE_AREAS } from './index.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('asset import on the real ROM (OPENSINNOH_NDS_ROM)', () => {
  let fs: NitroFs;
  beforeAll(() => { fs = new NitroFs(new Uint8Array(readFileSync(romPath!))); });

  it('decodes every land chunk to its header vertex count, with ground faces pointing up', () => {
    const land = readNarc(fs.file('/fielddata/land_data/land_data.narc'));
    expect(land).toHaveLength(666);
    let down = 0;
    let up = 0;
    let sliceDown = 0;
    const slice = new Set(Object.values(SLICE_AREAS).flat());
    land.forEach((bytes, i) => {
      const [model] = readModels(landDataModel(bytes));
      let vertices = 0;
      for (const d of model!.draws) {
        for (const p of decodeShape(model!, model!.shapes[d.shape]!, [1, 1, 1])) {
          vertices += p.vertices.length;
          const t = triangulate(p);
          for (let k = 0; k < t.length; k += 3) {
            const [a, b, c] = [t[k]!, t[k + 1]!, t[k + 2]!].map((j) => p.vertices[j]!.position as number[]) as [number[], number[], number[]];
            const ny = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!);
            // only clearly horizontal faces: their facing is unambiguous
            const len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!) * Math.hypot(c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!);
            if (b[1] === a[1] && c[1] === a[1] && len > 0) {
              if (ny > 0) up++;
              else if (ny < 0) {
                down++;
                if (slice.has(i)) sliceDown++;
              }
            }
          }
        }
      }
      expect(vertices, `land_data ${i}`).toBe(model!.numVertex);
    });
    // Measured: flat faces point up; the few downward ones are undersides (bridges, overhangs), none in the slice.
    console.log(`flat land faces: ${up} up, ${down} down`);
    expect(down / up).toBeLessThan(0.02);
    expect(sliceDown).toBe(0);
  });

  it('finds no 4x4 or direct textures in the map and prop texture sets', () => {
    const sets = [...readNarc(fs.file('/fielddata/areadata/area_map_tex/map_tex_set.narc')), ...readNarc(fs.file('/fielddata/areadata/area_build_model/areabm_texset.narc'))];
    const formats = new Set(sets.flatMap((b) => readTex0(b)?.textures.map((t) => t.format) ?? []));
    expect(formats.has('4x4')).toBe(false);
    expect(formats.has('direct')).toBe(false);
  });

  it('imports the v0.1 slice with every name binding resolved', () => {
    const { records, assets, warnings } = importAssets(fs, { slice: true });
    const areas = readAreaData(fs);
    expect(Object.keys(SLICE_AREAS).map((a) => areas[Number(a)])).toEqual([
      { propSet: 0, mapTex: 6 },
      { propSet: 16, mapTex: 20 },
      { propSet: 58, mapTex: 61 },
    ]);
    // every slice chunk material resolves to a PNG in its area's map texture set
    for (const [area, chunks] of Object.entries(SLICE_AREAS)) {
      const set = areas[Number(area)]!.mapTex;
      for (const c of chunks) {
        const gltf = JSON.parse(new TextDecoder().decode(assets.get(`models/land/${c}.gltf`))) as { materials: { extras: { lantern: { texture?: string; palette?: string } } }[] };
        for (const m of gltf.materials) {
          const { texture, palette } = m.extras.lantern;
          if (!texture) continue;
          expect(assets.has(`textures/map/${set}/${texture}__${palette}.png`), `${c}: ${texture}/${palette}`).toBe(true);
          expect(JSON.parse(new TextDecoder().decode(assets.get(`textures/map/${set}/index.json`))), `${c}: index.json`).toContain(`${texture}__${palette}`);
        }
      }
    }
    expect(records.models.filter((m) => m.id.startsWith('platinum:MODEL_LAND_'))).toHaveLength(15);
    // Lucas (90) walks and runs; NPC sets (e.g. 0) walk.
    const lucas = records.sprites.find((s) => s.id === 'platinum:SPRITE_90')!;
    expect(lucas.frameCount).toBe(32);
    expect(Object.keys(lucas.animations)).toHaveLength(12);
    expect(records.sprites.find((s) => s.id === 'platinum:SPRITE_0')!.animations['walk-down']).toHaveLength(4);
    // Lake Verity water scroll on props 74 and 311, map frame swap for lakep.1
    expect(records.models.find((m) => m.id === 'platinum:MODEL_BUILD_311')!.animations).toEqual(['platinum:TEXANIM_BUILD_311_l_lake']);
    expect(records.textureAnimations.find((a) => a.kind === 'frames' && a.texture === 'lakep.1')).toBeTruthy();
    expect(warnings.join('\n')).not.toMatch(/resolve in no map texture set|embedded TEX0/);
  });

  it('draws material/shape-listed build models without node transforms (Twinleaf houses keep their door inside)', () => {
    const lists = readMatShp(fs.file('/fielddata/build_model/build_model_matshp.dat'));
    const anim = readNarc(fs.file('/arc/bm_anime_list.narc'));
    // Listed models are exactly the unanimated ones' subset: none has a bm_anime entry.
    lists.forEach((pairs, i) => {
      if (pairs.length) expect(new DataView(anim[i]!.buffer, anim[i]!.byteOffset).getInt32(4, true), `build_model ${i}`).toBe(-1);
    });
    // t1_s01 (23): its door shape hangs under node t1_door1:pCube1, translated into the doorway.
    const [house] = readModels(readNarc(fs.file('/fielddata/build_model/build_model.narc'))[23]!);
    expect(house!.nodes.map((n) => n.name)).toEqual(['polySurface11', 't1_door1:pCube1']);
    const flat = drawnByMatShp(house!, lists[23]!);
    expect(flat.nodes).toHaveLength(1);
    expect(flat.draws.map((d) => `${d.material}/${d.shape}`).sort()).toEqual(house!.draws.map((d) => `${d.material}/${d.shape}`).sort());
    const { assets } = importAssets(fs, { slice: true });
    const gltf = JSON.parse(new TextDecoder().decode(assets.get('models/build/23.gltf'))) as { nodes: { matrix?: number[] }[] };
    expect(gltf.nodes).toHaveLength(1);
    expect(gltf.nodes[0]!.matrix).toBeUndefined();
  });

  it('imports everything within the storage budget', () => {
    const t0 = performance.now();
    const { assets, records } = importAssets(fs);
    const ms = performance.now() - t0;
    const bytes = [...assets.values()].reduce((n, b) => n + b.length, 0);
    console.log(`full asset import: ${ms.toFixed(0)} ms, ${(bytes / 1e6).toFixed(1)} MB, ${assets.size} files, ${records.models.length} models`);
    expect(records.models.filter((m) => m.id.startsWith('platinum:MODEL_LAND_'))).toHaveLength(666);
    expect(bytes).toBeLessThan(150e6);
  }, 120_000);
});
