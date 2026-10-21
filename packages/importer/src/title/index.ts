/**
 * Title screen import (decomp src/applications/title_screen.c): the Giratina model with its loop clip and
 * wing texture scroll, the intro's portal scene behind it, and the `titleScreens` record. The DS logo,
 * glow and credit layers are not imported: the app draws its own wordmark.
 *
 * Pack paths: `title/giratina/giratina.gltf` and `title/portal/portal.gltf` (+ their textures). Ids:
 * `platinum:TITLE_SCREEN`, `platinum:MODEL_TITLE_GIRATINA`, `platinum:MODEL_TITLE_PORTAL`.
 */
import type { Model, TitleModel, TitleScreen } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { modelToGltf, readJointAnimations, readModels, readSrtAnimations, readTex0 } from '@opensinnoh/g3d';
import { readNarc, type NitroFs } from '@opensinnoh/nds';

/** titledemo.narc members (decomp res/graphics/title_screen/titledemo.order). */
const TITLEDEMO = {
  path: '/demo/title/titledemo.narc',
  count: 29,
  giratinaNsbta: 0,
  giratinaNsbmd: 1,
  giratinaNsbca: 2,
  portalNsbmd: 16,
  portalNsbta: 17,
  portalNsbca: 18,
} as const;

const fx = (v: number) => v / 4096;

/**
 * TitleScreen_InitCoordinates: the title camera ends at (−64, 192, 484) looking at (0, 100, −18) (the
 * DS moves it in from (0, 192, 600); we open on the final view); FOV index 15.996° is the half angle
 * (NNS perspective takes its sine and cosine). Light 0 points from the camera to the target, light 1 is
 * fixed; both white once the intro is over. Clipping is (0, 300), which with a zero near plane clips
 * nothing on the DS; we use (1, 2000).
 */
function titleCamera(): Pick<TitleModel, 'camera' | 'lights'> {
  const position: [number, number, number] = [-64, 192, 484];
  const target: [number, number, number] = [0, 100, -18];
  const d = target.map((t, i) => t - position[i]!);
  const len = Math.hypot(...d);
  return {
    camera: { position, target, fovY: 2 * 15.996, near: 1, far: 2000 },
    lights: [
      { direction: d.map((v) => v / len) as [number, number, number], color: [1, 1, 1] },
      { direction: [-fx(2267), fx(1953), -fx(2797)], color: [1, 1, 1] },
    ],
  };
}

/**
 * The intro camera (TitleScreen_LoadGfx): target 0, distance 160, pitch 319.94° (Camera_AdjustPositionAroundTarget:
 * y = sin(−pitch)·d, z = cos(pitch)·d), FOV half-angle 21.994°, at the end of the intro's move. Lit like the
 * title (light 0 from the title camera).
 */
function introCamera(): Pick<TitleModel, 'camera' | 'lights'> {
  const pitch = (319.94 * Math.PI) / 180;
  return { camera: { position: [0, Math.sin(-pitch) * 160, Math.cos(pitch) * 160], target: [0, 0, 0], fovY: 2 * 21.994, near: 1, far: 4000 }, lights: titleCamera().lights };
}

export interface TitleImport {
  titleScreen: TitleScreen;
  models: Model[];
  /** Pack path → bytes. */
  assets: Map<string, Uint8Array>;
}

export function importTitle(fs: NitroFs): TitleImport {
  const title = readNarc(fs.file(TITLEDEMO.path));
  if (title.length !== TITLEDEMO.count) throw new Error(`${TITLEDEMO.path}: ${title.length} members, expected ${TITLEDEMO.count}`);
  const t = (i: number) => title[i]!;
  const assets = new Map<string, Uint8Array>();

  /** A title model: glTF with embedded textures, its one loop clip and its texture scrolls. */
  const convert = (name: string, bmd: Uint8Array, bca: Uint8Array, bta: Uint8Array) => {
    const [model, ...more] = readModels(bmd);
    const tex = readTex0(bmd);
    if (!model || more.length || !tex) throw new Error(`title ${name}: expected one model with its own textures`);
    const [clip, ...moreClips] = readJointAnimations(bca);
    if (!clip || moreClips.length) throw new Error(`title ${name}: expected one joint animation`);
    const converted = modelToGltf(model, { embed: tex, animations: [{ clip: clip.name, animation: clip }] });
    if (converted.warnings.length) throw new Error(`title ${name}: ${converted.warnings.join('; ')}`);
    assets.set(`title/${name}/${name}.gltf`, new TextEncoder().encode(JSON.stringify(converted.gltf)));
    for (const [file, png] of converted.images) assets.set(`title/${name}/${file}`, png);
    const scroll: TitleModel['scroll'] = readSrtAnimations(bta).flatMap((a) =>
      a.materials.map((m) => {
        if (m.scaleS !== 1 || m.scaleT !== 1 || m.rotation[0] !== 0 || m.rotation[1] !== 1) throw new Error(`title ${name}: SRT ${m.material} scales or rotates`);
        return { material: m.material, frames: a.frames, translateS: m.translateS, translateT: m.translateT };
      }),
    );
    const record: Model = { id: asId(`platinum:MODEL_TITLE_${name.toUpperCase()}`), gltf: asId(`platinum:title/${name}/${name}.gltf`) };
    return { record, clip: clip.name, scroll };
  };
  // Giratina (wing scroll) and the intro's portal (Spear Pillar ring, clouds, its own SRT scrolls).
  const giratina = convert('giratina', t(TITLEDEMO.giratinaNsbmd), t(TITLEDEMO.giratinaNsbca), t(TITLEDEMO.giratinaNsbta));
  const portal = convert('portal', t(TITLEDEMO.portalNsbmd), t(TITLEDEMO.portalNsbca), t(TITLEDEMO.portalNsbta));

  const titleScreen: TitleScreen = {
    id: asId('platinum:TITLE_SCREEN'),
    model: { model: giratina.record.id, clip: giratina.clip, scroll: giratina.scroll, ...titleCamera() },
    background: { model: portal.record.id, clip: portal.clip, scroll: portal.scroll, ...introCamera() },
  };
  return { titleScreen, models: [giratina.record, portal.record], assets };
}
