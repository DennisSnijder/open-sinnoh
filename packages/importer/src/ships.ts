/** Resource identities and camera from boat_cutscene/{canalave_ship,snowpoint_ship}.c; no copied code. */
import type { Model, ShipScene } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { decodeTexture, encodePng, findPalette, findTexture, modelToGltf, readColorAnimations, readJointAnimations, readModels, readPatternAnimations, readSrtAnimations, readTex0 } from '@opensinnoh/g3d';
import { readNarc, type NitroFs } from '@opensinnoh/nds';

export function importShips(fs: NitroFs, assets: Map<string, Uint8Array>): { scenes: ShipScene[]; models: Model[] } {
  const canalave = readNarc(fs.file('/arc/ship_demo.narc'));
  const snowpoint = readNarc(fs.file('/arc/ship_demo_pl.narc'));
  const models: Model[] = [];
  const scenes = [
    { archive: canalave, model: 2, joint: 0, color: 1, srt: 3, pattern: 4 },
    { archive: snowpoint, model: 5, joint: 7, color: 6, srt: 4 },
    { archive: snowpoint, model: 1, joint: 3, color: 2, srt: 0 },
    { archive: canalave, model: 17, joint: 15, color: 16, srt: 18, pattern: 19 },
  ].map((entry, direction): ShipScene => {
    const b = (i: number) => entry.archive[i]!;
    const [model, ...rest] = readModels(b(entry.model));
    const tex = readTex0(b(entry.model));
    const [joint, ...more] = readJointAnimations(b(entry.joint));
    if (!model || rest.length || !tex || !joint || more.length) throw new Error(`ship ${direction}: expected one textured model and joint animation`);
    const srt = readSrtAnimations(b(entry.srt));
    // The animated texture matrix replaces the model's initial matrix for these materials.
    for (const m of model.materials) {
      if (!srt.some(a => a.materials.some(s => s.material === m.name))) continue;
      m.flag &= ~1;
      m.texParam &= 0x3fffffff;
    }
    const converted = modelToGltf(model, { embed: tex, animations: [{ clip: joint.name, animation: joint }] });
    if (converted.warnings.length) throw new Error(`ship ${direction}: ${converted.warnings.join('; ')}`);
    const dir = `ships/${direction}`;
    assets.set(`${dir}/scene.gltf`, new TextEncoder().encode(JSON.stringify(converted.gltf)));
    for (const [file, png] of converted.images) assets.set(`${dir}/${file}`, png);
    const patterns = entry.pattern === undefined ? [] : readPatternAnimations(b(entry.pattern)).map(a => ({
      frames: a.frames,
      materials: a.materials.map(m => ({ material: m.material, keys: m.keys.map(k => {
        const path = `${dir}/${k.texture}__${k.palette}.png`;
        if (!assets.has(path)) {
          const t = findTexture(tex, k.texture);
          assets.set(path, encodePng(t.width, t.height, decodeTexture(tex, t, findPalette(tex, k.palette))));
        }
        return { frame: k.frame, image: asId(`platinum:${path}`) };
      }) })),
    }));
    const id = asId(`platinum:MODEL_SHIP_${direction}`);
    models.push({ id, gltf: asId(`platinum:${dir}/scene.gltf`) });
    const pitch = -10750 * Math.PI * 2 / 65536;
    const distance = 0x29aec1 / 4096;
    return {
      model: id, clip: joint.name, frames: joint.frames,
      camera: { position: [0, -Math.sin(pitch) * distance, Math.cos(pitch) * distance], target: [0, 0, 0], fovY: 1473 * 720 / 65536, near: 150, far: 900 },
      srt, colors: readColorAnimations(b(entry.color)), patterns,
    };
  });
  return { scenes, models };
}
