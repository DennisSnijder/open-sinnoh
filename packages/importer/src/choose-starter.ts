/**
 * The starter-choice scene (decomp src/choose_starter/choose_starter_app.c, `graphic/ev_pokeselect.narc`):
 * the briefcase's 3D models and the scene's 2D art. See docs/research/starter-choice.md.
 *
 * Models (glTF with embedded textures; the clip keeps the NSBCA's name): the closed briefcase and its
 * opening clip, the open briefcase, the three balls with their wobble clip, and the grass floor.
 * Ids `platinum:MODEL_CHOOSE_STARTER_<NAME>`, pack paths `choose_starter/<name>/<name>.gltf`.
 * 2D (`ui2d` sheets): the pointing-hand cursor (NCGR/NCLR/NCER/NANR), the white disc the Pokémon pops up
 * on (a 128×128 software sprite), and the message window's 16 text colours as a 16×1 image.
 */
import type { Model } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import { modelToGltf, readJointAnimations, readModels, readTex0 } from '@opensinnoh/g3d';
import { readNarc, type NitroFs } from '@opensinnoh/nds';
import { blankImage, indexes, readNcgrData, readNclr, rgb555, Sheets, type Image } from './ui2d/index.ts';

/** ev_pokeselect.narc members (decomp Make3DGraphics, MakeCursorOAM, MakePreviewWindow, MakeMessageWindow). */
export const EV_POKESELECT = {
  path: '/graphic/ev_pokeselect.narc',
  count: 18,
  briefcaseNsbca: 0,
  briefcaseNsbmd: 1,
  /** Ball i: model 3 + 2i, animation 2 + 2i. */
  ballNsbca: [2, 4, 6],
  ballNsbmd: [3, 5, 7],
  briefcaseOpenNsbmd: 8,
  floorNsbmd: 9,
  cursor: { ncgr: 10, nclr: 11, ncer: 12, nanr: 13 },
  previewNcgr: 14,
  previewNclr: 15,
  /** Loaded into the message window's palette (FRAME_PALETTE_INDEX): its text colours. */
  messageNclr: 16,
} as const;

export const CHOOSE_STARTER_MODELS = ['briefcase', 'briefcase_open', 'ball_0', 'ball_1', 'ball_2', 'floor'] as const;
export type ChooseStarterModel = (typeof CHOOSE_STARTER_MODELS)[number];
export const chooseStarterModelId = (ns: string, name: ChooseStarterModel): Id => asId(`${ns}:MODEL_CHOOSE_STARTER_${name.toUpperCase()}`);

export interface ChooseStarterImport {
  models: Model[];
  /** Pack path → bytes. */
  assets: Map<string, Uint8Array>;
}

/** A scanned 4bpp NCGR drawn with palette 0 of `colors` (index 0 transparent). */
function scannedImage(ncgr: Uint8Array, colors: Uint16Array): Image {
  const c = readNcgrData(ncgr);
  if (!c.scanned || c.bitDepth !== 4 || c.width < 1 || c.height < 1) throw new Error(`choose starter: preview window is not a scanned 4bpp NCGR of known size`);
  const img = blankImage(c.width * 8, c.height * 8);
  indexes(c.data, 4).forEach((v, i) => {
    if (v) img.rgba.set([...rgb555(colors[v]!), 255], i * 4);
  });
  return img;
}

export function importChooseStarter(fs: NitroFs, sheets: Sheets): ChooseStarterImport {
  const narc = readNarc(fs.file(EV_POKESELECT.path));
  if (narc.length !== EV_POKESELECT.count) throw new Error(`${EV_POKESELECT.path}: ${narc.length} members, expected ${EV_POKESELECT.count}`);
  const assets = new Map<string, Uint8Array>();
  const models: Model[] = [];

  const convert = (name: ChooseStarterModel, bmd: number, bca?: number) => {
    const [model, ...more] = readModels(narc[bmd]!);
    const tex = readTex0(narc[bmd]!);
    if (!model || more.length || !tex) throw new Error(`choose starter ${name}: expected one model with its own textures`);
    const clips = bca === undefined ? [] : readJointAnimations(narc[bca]!);
    if (bca !== undefined && clips.length !== 1) throw new Error(`choose starter ${name}: expected one joint animation, got ${clips.length}`);
    const converted = modelToGltf(model, { embed: tex, animations: clips.map((clip) => ({ clip: clip.name, animation: clip })) });
    if (converted.warnings.length) throw new Error(`choose starter ${name}: ${converted.warnings.join('; ')}`);
    const dir = `choose_starter/${name}`;
    assets.set(`${dir}/${name}.gltf`, new TextEncoder().encode(JSON.stringify(converted.gltf)));
    for (const [file, png] of converted.images) assets.set(`${dir}/${file}`, png);
    models.push({ id: chooseStarterModelId('platinum', name), gltf: asId(`platinum:${dir}/${name}.gltf`) });
  };
  convert('briefcase', EV_POKESELECT.briefcaseNsbmd, EV_POKESELECT.briefcaseNsbca);
  convert('briefcase_open', EV_POKESELECT.briefcaseOpenNsbmd);
  for (const i of [0, 1, 2] as const) convert(`ball_${i}`, EV_POKESELECT.ballNsbmd[i], EV_POKESELECT.ballNsbca[i]);
  convert('floor', EV_POKESELECT.floorNsbmd);

  sheets.obj('choose_starter/cursor', narc, EV_POKESELECT.cursor);
  sheets.image('choose_starter/preview_window', scannedImage(narc[EV_POKESELECT.previewNcgr]!, readNclr(narc[EV_POKESELECT.previewNclr]!).colors));
  const text = readNclr(narc[EV_POKESELECT.messageNclr]!).colors;
  const palette = blankImage(16, 1);
  for (let i = 0; i < 16; i++) palette.rgba.set([...rgb555(text[i]!), 255], i * 4);
  sheets.image('choose_starter/text_colors', palette);
  return { models, assets };
}
