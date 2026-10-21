import type { Model, ShipScene, SpearPillarAssets } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import {
  decodeTexture,
  encodePng,
  findPalette,
  findTexture,
  modelToGltf,
  readColorAnimations,
  readJointAnimations,
  readModels,
  readPatternAnimations,
  readSrtAnimations,
  readTex0,
  readVisibilityAnimations,
} from '@opensinnoh/g3d';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { animationFrames } from './gyms/index.ts';
import { PaletteRam, readNcgr, readNclr, readNscr, renderScreen } from './ui2d/nitro2d.ts';

/** Archive member identities from the scene research, never asset bytes from the reference project. */
const INVENTORY: [number, number[]][] = [
  [6, [4, 5]],
  [12, [11]],
  [8, [7]],
  [10, [9]],
  [46, []],
  [24, [22, 23]],
  [79, [77, 78, 80, 81]],
  [84, [82, 83]],
  [65, []],
  [66, [67]],
  [68, [69]],
  [61, [62]],
  [63, [64]],
  [13, [14]],
  [60, []],
  [59, [57, 58]],
  [45, [43, 44]],
  [17, [15, 16]],
  [53, [51, 52]],
  [55, [54, 56]],
  [26, [25, 27]],
  [29, [28, 30]],
  [32, [31, 33]],
  [35, [34, 36]],
  [38, [37, 39]],
  [41, [40]],
  [42, []],
];
const camera: ShipScene['camera'] = { position: [0, 0, 1], target: [0, 0, 0], fovY: 30, near: 1, far: 2048 };

export function importSpearPillar(
  fs: NitroFs,
  assets: Map<string, Uint8Array>,
  messages: Id[],
): { tables: SpearPillarAssets; models: Model[] } {
  const archive = readNarc(fs.file('/arc/demo_tengan_gra.narc'));
  const records: Model[] = [];
  const models: SpearPillarAssets['models'] = {};
  for (const [member, tracks] of INVENTORY) {
    const bytes = archive[member]!;
    const [model, ...more] = readModels(bytes);
    const tex = readTex0(bytes);
    if (!model || more.length || !tex) throw new Error(`Tengan ${member}: expected one textured model`);
    const joint = tracks.flatMap((i) =>
      String.fromCharCode(...archive[i]!.subarray(0, 4)) === 'BCA0' ? readJointAnimations(archive[i]!) : [],
    );
    if (joint.length > 1) throw new Error(`Tengan ${member}: multiple joint tracks`);
    const srt = tracks.flatMap((i) =>
      String.fromCharCode(...archive[i]!.subarray(0, 4)) === 'BTA0' ? readSrtAnimations(archive[i]!) : [],
    );
    const colors = tracks.flatMap((i) =>
      String.fromCharCode(...archive[i]!.subarray(0, 4)) === 'BMA0' ? readColorAnimations(archive[i]!) : [],
    );
    for (const m of model.materials)
      if (m.projectionMap || srt.some((a) => a.materials.some((t) => t.material === m.name))) {
        m.flag &= ~1;
        m.texParam &= 0x3fffffff;
      }
    const converted = modelToGltf(model, {
      textureMatrices: true,
      localJointVertices: true,
      embed: tex,
      animations: joint.map((animation) => ({ clip: animation.name, animation })),
    });
    if (converted.warnings.length) throw new Error(`Tengan ${member}: ${converted.warnings.join('; ')}`);
    const dir = `scenes/tengan/${member}`;
    assets.set(`${dir}/model.gltf`, new TextEncoder().encode(JSON.stringify(converted.gltf)));
    for (const [path, image] of converted.images) assets.set(`${dir}/${path}`, image);
    const patterns = tracks
      .flatMap((i) => (String.fromCharCode(...archive[i]!.subarray(0, 4)) === 'BTP0' ? readPatternAnimations(archive[i]!) : []))
      .map((a) => ({
        frames: a.frames,
        materials: a.materials.map((m) => ({
          material: m.material,
          keys: m.keys.map((k) => {
            const path = `${dir}/${k.texture}__${k.palette}.png`;
            const t = findTexture(tex, k.texture);
            if (!assets.has(path)) assets.set(path, encodePng(t.width, t.height, decodeTexture(tex, t, findPalette(tex, k.palette))));
            return { frame: k.frame, image: asId(`platinum:${path}`) };
          }),
        })),
      }));
    const visibility = tracks.flatMap((i) =>
      String.fromCharCode(...archive[i]!.subarray(0, 4)) === 'BVA0' ? readVisibilityAnimations(archive[i]!) : [],
    );
    const id = asId(`platinum:MODEL_TENGAN_${member}`);
    records.push({ id, gltf: asId(`platinum:${dir}/model.gltf`) });
    models[member] = {
      model: id,
      clip: joint[0]?.name ?? '',
      frames: Math.max(1, ...tracks.map((i) => animationFrames(archive[i]!))),
      camera,
      srt,
      colors,
      patterns,
      ...(visibility[0] ? { visibility: visibility[0].visible } : {}),
    };
  }
  const backgrounds: Record<string, Id> = {};
  for (const [name, chars, palette, map] of [
    ['chain', 74, 75, 76],
    ['guardians', 70, 71, 72],
    ['giratina', 18, 19, 20],
  ] as const) {
    const screen = readNscr(archive[map]!);
    const ram = new PaletteRam();
    ram.load(readNclr(archive[palette]!), 0);
    const path = `scenes/tengan/${name}.png`;
    assets.set(path, encodePng(screen.width, screen.height, renderScreen(screen, readNcgr(archive[chars]!), ram)));
    backgrounds[name] = asId(`platinum:${path}`);
  }
  return { tables: { models, backgrounds, messages }, models: records };
}
