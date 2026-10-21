/** Credits' roadside scenery: ending.order models and the ROM's overlay-99 row/tree tables. */
import type { Model, NewGame } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { modelToGltf, readModels, readTex0 } from '@opensinnoh/g3d';
import { Reader, readNarc, type NitroFs } from '@opensinnoh/nds';

export function importCreditsRide(fs: NitroFs, assets: Map<string, Uint8Array>, rows: Uint8Array, trees: Uint8Array): { models: Model[]; ride: NonNullable<NewGame['creditsRide']> } {
  const ending = readNarc(fs.file('/graphic/ending.narc'));
  const models: Model[] = [];
  // ending.order: day/night lamps, morning near/far trees, night normal/snow/far trees.
  for (let member = 78; member <= 84; member++) {
    const bytes = ending[member]!;
    const [model, ...rest] = readModels(bytes);
    const tex = readTex0(bytes);
    if (!model || rest.length || !tex) throw new Error(`credits ${member}: expected one textured model`);
    const converted = modelToGltf(model, { embed: tex });
    if (converted.warnings.length) throw new Error(`credits ${member}: ${converted.warnings.join('; ')}`);
    const dir = `credits/models/${member}`;
    assets.set(`${dir}/model.gltf`, new TextEncoder().encode(JSON.stringify(converted.gltf)));
    for (const [name, png] of converted.images) assets.set(`${dir}/${name}`, png);
    models.push({ id: asId(`platinum:MODEL_CREDITS_${member}`), gltf: asId(`platinum:${dir}/model.gltf`) });
  }
  const r = new Reader(rows);
  const t = new Reader(trees);
  return {
    models,
    ride: {
      models: models.map(m => m.id),
      rows: Array.from({ length: 3 }, (_, scene) => Array.from({ length: 2 }, (_, row) => {
        const o = (scene * 2 + row) * 28;
        return { count: r.u16(o), speed: r.u16(o + 2), start: [r.i32(o + 4), r.i32(o + 12), r.i32(o + 20)], spacing: [r.i32(o + 8), r.i32(o + 16), r.i32(o + 24)] };
      })),
      nightTrees: Array.from({ length: trees.length / 2 }, (_, i) => t.u16(i * 2)),
    },
  };
}
