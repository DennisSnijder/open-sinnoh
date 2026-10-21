/**
 * The Distortion World's art: its prop models (`data/mmodel/fldeff.narc`, decomp sProp3DModelNARCIndexByKind,
 * one member per `PropKind` from 0x7C) with their animation sets (sPropAnimSetNARCIndexByKind), and the sky
 * (`data/tw_arc_etc.narc`: the BG2 picture and the seven cloud sets). The member numbers and the per-kind
 * position offsets (sPropInitialPosOffsetByKind, in world units) are the decomp's constants; every pixel and
 * vertex comes from the player's ROM.
 */
import type { DistortionWorldTables, DwPropKind, Model, TextureAnimation } from '@opensinnoh/contracts';
import { DW_PROP_KINDS } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { modelToGltf, readJointAnimations, readModels, readSrtAnimations, readTex0 } from '@opensinnoh/g3d';
import { renderCell } from '../ui2d/compose.ts';
import { screenImage } from '../ui2d/menus.ts';
import { readNcer } from '../ui2d/ncer.ts';
import { readNclr, readNcgrData } from '../ui2d/nitro2d.ts';
import { encodeImage } from '../ui2d/png.ts';
import { DistortionFormatError } from './tw-arc.ts';

/** sProp3DModelNARCIndexByKind: kind k is member 0x7C + k. */
const FIRST_PROP_MEMBER = 0x7c;
/** sPropAnimSetNARCIndexByKind by prop kind: BCA0 joint clips and BTA0 texture scrolls. */
const ANIMATION: Partial<Record<DwPropKind, number>> = { 'giratina-shadow': 0xc6, 'land-vine-flower': 0xbf, 'land-rock': 0xc0, waterfall: 0xc8, portal: 0xc1 };
/** sPropInitialPosOffsetByKind in world units (fx32 / 4096): most props stand 25 units below and 6 north of the tile. */
const OFFSET: Partial<Record<DwPropKind, [number, number, number]>> = {
  'large-elevator-platform-1': [-8, -25, 2],
  'large-elevator-platform-2': [-8, -25, 2],
  'large-elevator-platform-4': [-8, -25, 10],
  'giratina-shadow': [0, -32, -6],
  waterfall: [0, -32, -6],
  'land-vine-flower': [0, -32, -6],
  'land-rock': [0, -32, -6],
  portal: [0, -14, 8],
};

/** tw_arc_etc: the BG picture (NSCR 2 over NCGR 0, the first palette of NCLR 1) and the cloud sets (cells 3 + 3k, characters 4 + 3k; palette 24). */
const SKY = { screen: 2, characters: 0, palette: 1, cloudSets: 7, cloudPalette: 24 } as const;

export interface DistortionArt {
  models: Model[];
  textureAnimations: TextureAnimation[];
  tables: Pick<DistortionWorldTables, 'props' | 'sky'>;
}

const enc = new TextEncoder();

export function importDistortionArt(fldeff: Uint8Array[], etc: Uint8Array[], assets: Map<string, Uint8Array>, warn: (w: string) => void): DistortionArt {
  const models: Model[] = [];
  const textureAnimations: TextureAnimation[] = [];
  const member = (i: number) => fldeff[i] ?? (() => { throw new DistortionFormatError(`fldeff: no member ${i}`); })();
  const props = Object.fromEntries(
    DW_PROP_KINDS.map((kind, k) => {
      const index = FIRST_PROP_MEMBER + k;
      const bytes = member(index);
      const [model, ...rest] = readModels(bytes);
      if (!model || rest.length) throw new DistortionFormatError(`fldeff ${index}: expected one model`);
      // The Giratina shadow is untextured (no TEX0).
      const tex0 = readTex0(bytes);
      const anim = ANIMATION[kind];
      const magic = anim === undefined ? null : String.fromCharCode(...member(anim).subarray(0, 4));
      const joints = magic === 'BCA0' ? readJointAnimations(member(anim!)) : [];
      if (joints.length > 1) throw new DistortionFormatError(`fldeff ${anim}: ${joints.length} joint animations`);
      const res = modelToGltf(model, { ...(tex0 ? { embed: tex0 } : {}), animations: joints.map((animation) => ({ clip: 'anim', animation })) });
      res.warnings.forEach(warn);
      const dir = `models/fldeff/${index}`;
      for (const [file, png] of res.images) assets.set(`${dir}/${file}`, png);
      assets.set(`${dir}/model.gltf`, enc.encode(JSON.stringify(res.gltf)));
      const id = `platinum:MODEL_FLDEFF_${index}` as Id;
      const record: Model = { id, gltf: `platinum:${dir}/model.gltf` as Id };
      if (magic === 'BTA0') {
        record.animations = [];
        for (const a of readSrtAnimations(member(anim!))) {
          for (const m of a.materials) {
            if (m.scaleS !== 1 || m.scaleT !== 1 || m.rotation[0] !== 0 || m.rotation[1] !== 1) warn(`fldeff ${anim}: texture SRT scale or rotation not drawn`);
            const tid = `platinum:TEXANIM_FLDEFF_${index}_${anim}_${m.material.replace(/[^A-Za-z0-9_.-]/g, '_')}` as Id;
            textureAnimations.push({ id: tid, kind: 'scroll', material: m.material, frames: a.frames, translateS: m.translateS, translateT: m.translateT });
            record.animations.push(tid);
          }
        }
      } else if (magic !== null && magic !== 'BCA0') throw new DistortionFormatError(`fldeff ${anim}: ${magic}, expected BCA0 or BTA0`);
      models.push(record);
      const art = { model: id, offset: OFFSET[kind] ?? [0, -25, -6], clip: joints[0] ? { name: 'anim', frames: joints[0].frames } : null };
      return [kind, art];
    }),
  ) as DistortionWorldTables['props'];

  // The sky: the BG2 picture with its backdrop, and each cloud set's first cell drawn with the cloud palettes.
  const png = (path: string, img: { width: number; height: number; rgba: Uint8Array }) => {
    assets.set(path, encodeImage(img));
    return `platinum:${path}` as Id;
  };
  const picture = screenImage(etc, SKY.screen, SKY.characters, SKY.palette, true, 1);
  const cloudColors = readNclr(etc[SKY.cloudPalette]!).colors;
  const clouds = Array.from({ length: SKY.cloudSets }, (_, k) => {
    const bank = readNcer(etc[3 + 3 * k]!);
    const cell = bank.cells[0];
    if (!cell) throw new DistortionFormatError(`tw_arc_etc ${3 + 3 * k}: no cells`);
    const img = renderCell(cell, readNcgrData(etc[4 + 3 * k]!).data, cloudColors, { mapping: bank.mapping });
    return { image: png(`distortion/sky/cloud-${k}.png`, img), originX: img.originX, originY: img.originY };
  });
  const sky = { background: png('distortion/sky/background.png', picture), clouds };
  return { models, textureAnimations, tables: { props, sky } };
}
