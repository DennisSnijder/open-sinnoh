/** DWWarp_InitModel: titledemo 16 (model), 17 (texture SRT), 18 (joints). All payloads come from the ROM. */
import type { Model, ShipScene } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { modelToGltf, readJointAnimations, readModels, readSrtAnimations, readTex0 } from '@opensinnoh/g3d';
import { readNarc, type NitroFs } from '@opensinnoh/nds';

export function importDistortionWarp(fs: NitroFs, assets: Map<string, Uint8Array>): { model: Model; scene: ShipScene } {
  const arc = readNarc(fs.file('/demo/title/titledemo.narc'));
  const [model, ...rest] = readModels(arc[16]!);
  const tex = readTex0(arc[16]!);
  const [joint, ...more] = readJointAnimations(arc[18]!);
  if (!model || rest.length || !tex || !joint || more.length) throw new Error('DW warp: expected one textured model and joint animation');
  const srt = readSrtAnimations(arc[17]!);
  for (const m of model.materials) {
    if (!srt.some(a => a.materials.some(s => s.material === m.name))) continue;
    m.flag &= ~1;
    m.texParam &= 0x3fffffff;
  }
  const converted = modelToGltf(model, { embed: tex, animations: [{ clip: joint.name, animation: joint }] });
  if (converted.warnings.length) throw new Error(`DW warp: ${converted.warnings.join('; ')}`);
  const dir = 'distortion/warp';
  assets.set(`${dir}/scene.gltf`, new TextEncoder().encode(JSON.stringify(converted.gltf)));
  for (const [file, png] of converted.images) assets.set(`${dir}/${file}`, png);
  const id = asId('platinum:MODEL_DW_WARP');
  // DWWarp_InitCamera overrides the initial pitch with -0x3fef; perspective half-angle is 22 degrees.
  const pitch = -0x3fef * Math.PI * 2 / 65536;
  return {
    model: { id, gltf: asId(`platinum:${dir}/scene.gltf`) },
    scene: {
      model: id, clip: joint.name, frames: joint.frames, loop: true,
      camera: { position: [0, -Math.sin(pitch) * 160, Math.cos(pitch) * 160], target: [0, 0, 0], fovY: Math.trunc(22 * 65535 / 360) * 720 / 65536, near: 0.01, far: 300 },
      srt, colors: [], patterns: [],
    },
  };
}
