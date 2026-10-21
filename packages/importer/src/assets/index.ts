/**
 * Asset import: converts field 3D data and overworld characters from the ROM into pack files.
 *
 * Pack paths and ids (the importer's records reference these):
 * - land chunk models   `models/land/<landDataIndex>.gltf`       id `platinum:MODEL_LAND_<i>`
 * - build (prop) models `models/build/<buildModelIndex>.gltf`    id `platinum:MODEL_BUILD_<i>`
 * - map texture sets    `textures/map/<mapTexSetIndex>/<texture>__<palette>.png`   (area_data.mapTextureArchiveID)
 * - prop texture sets   `textures/build/<propSetIndex>/<texture>__<palette>.png`   (area_data.mapPropArchivesID)
 *   Each set's `index.json` lists its `<texture>__<palette>` names.
 * - sprites             `sprites/<mmodelIndex>.png`               id `platinum:SPRITE_<i>` (walk sets and static sets)
 * - texture animations  map frame swaps `platinum:TEXANIM_MAP_<fldtanimeEntry>` (frames are textures
 *   `<texture>~<k>` in the same texture set); prop SRT scrolls `platinum:TEXANIM_BUILD_<model>_<material>` (chars an id cannot hold become `_`)
 *   (listed in that model's `animations`).
 *
 * Models carry no images: materials name texture + palette (`extras.lantern`) and the renderer binds
 * them from the area's texture set. Prop textures come from the area prop set (what the game renders),
 * with the model's embedded TEX0 filling names the set lacks.
 */
import type { Id } from '@opensinnoh/core';
import type { Model, BillboardSprite, FieldEffect, Prop, TextureAnimation } from '@opensinnoh/contracts';
import { NitroFs, Reader, readNarc } from '@opensinnoh/nds';
import {
  billboardAnimations,
  buildSpriteAtlas,
  decodeTexture,
  encodePng,
  modelToGltf,
  readFrameSequence,
  readFrameSwapTable,
  readJointAnimations,
  readModels,
  readPatternAnimations,
  readSrtAnimations,
  readTex0,
  type JointAnimation,
  type PatternAnimation,
  type Model as G3dModel,
  type Tex0,
  type TexelFormat,
} from '@opensinnoh/g3d';
import type { ModelObject, ObjectGfxAnims } from './object-gfx.ts';
import { importFieldEffects, importObstacleEffects } from './field-effects.ts';
import { FRAME_SEQ_NAMES, frameTableAnimations } from './poses.ts';
import { giratinaAtlas } from '../distortion/giratina.ts';
import { berryTreeAtlas } from './berry-trees.ts';

export interface ImportAssetsOptions {
  /** Limit to the v0.1 slice (areas 6, 20, 62 and their chunks); default: everything. */
  slice?: boolean;
  /** Progress/diagnostic sink. */
  log?: (message: string) => void;
  /**
   * Platinum's overlay-5 object gfx tables: gfx → mmodel set, per-gfx animation tables (frame-table
   * billboards) and the 3D model objects. Absent = walk and static sets only, no model objects.
   */
  objectGfx?: { mmodelOf: ReadonlyMap<number, number>; anims: ObjectGfxAnims[]; billboardModels: ReadonlyMap<number, number>; modelObjects: ModelObject[] };
  /**
   * Door build models (the ROM's `doorModelIDs` table, decomp ov5_021D431C.c DoorAnimation_FindDoorAndLoad):
   * their bm_anime entries 0 and 1 open and close, as BCA0 joint clips or BTP0 texture patterns (the
   * elevator door). Absent = no door clips (doors are drawn closed).
   */
  doorModels?: ReadonlySet<number>;
  /** Build models the slice converts too (the gym puzzles' props), so their placements and animations import as in the full import. */
  sliceModels?: ReadonlySet<number>;
}

export interface ImportAssetsResult {
  records: { models: Model[]; sprites: BillboardSprite[]; textureAnimations: TextureAnimation[]; fieldEffects: FieldEffect[] };
  /** Build model index → door clips (`Prop.animations`). */
  propAnimations: Map<number, NonNullable<Prop['animations']>>;
  /** Object gfx → converted model (3D model objects). */
  modelObjects: Map<number, Id>;
  /** The trainer-sight '!' (fldeff texture), a 16×16 billboard. */
  exclamation: BillboardSprite;
  /** Pack-relative path → bytes. */
  assets: Map<string, Uint8Array>;
  /** Features seen but not converted (one line per kind, with counts). */
  warnings: string[];
}

/** v0.1 slice: area → land_data chunks (docs/research/graphics-formats.md §1.3). */
export const SLICE_AREAS: Readonly<Record<number, readonly number[]>> = {
  6: [0, 1, 2, 3, 4, 5, 6],
  20: [186, 187],
  62: [537, 538, 539, 540, 541, 542],
};

const PATHS = {
  landData: '/fielddata/land_data/land_data.narc',
  mapTexSet: '/fielddata/areadata/area_map_tex/map_tex_set.narc',
  buildModel: '/fielddata/build_model/build_model.narc',
  buildMatShp: '/fielddata/build_model/build_model_matshp.dat',
  propTexSet: '/fielddata/areadata/area_build_model/areabm_texset.narc',
  areaBuild: '/fielddata/areadata/area_build_model/area_build.narc',
  areaData: '/fielddata/areadata/area_data.narc',
  bmAnime: '/arc/bm_anime.narc',
  bmAnimeList: '/arc/bm_anime_list.narc',
  fldtanime: '/data/fldtanime.narc',
  mmodel: '/data/mmodel/mmodel.narc',
  fldeff: '/data/mmodel/fldeff.narc',
  hidenEffect: '/graphic/hiden_effect.narc',
};

/** fldeff member holding the trainer-sight '!' texture (decomp ov5_021F5A10.c, texture slot 1). */
const FLDEFF_EXCLAMATION = 4;

/** mmodel members: 0–420 BTX0 character sets; frame-sequence tables generic_walk (445) and walk_and_run (446). */
const MMODEL = { sets: 421, genericWalk: 445, walkAndRun: 446, frameSeqs: 445 };

const enc = new TextEncoder();
const pairKey = (tex: string, pal: string) => `${tex}__${pal}`;

/** land_data member: 4 u32 sizes (attributes, props, NSBMD, BDHC) then the sections. */
export function landDataModel(bytes: Uint8Array): Uint8Array {
  const r = new Reader(bytes);
  const sizes = [r.u32(0), r.u32(4), r.u32(8), r.u32(12)] as const;
  if (16 + sizes[0] + sizes[1] + sizes[2] + sizes[3] !== bytes.length) throw new Error(`land_data: section sizes do not sum to ${bytes.length}`);
  return r.slice(16 + sizes[0] + sizes[1], 16 + sizes[0] + sizes[1] + sizes[2]);
}

/** area_data members: `u16 mapPropArchivesID, u16 mapTextureArchiveID, u16 unused, u16 areaLightArchiveID`. */
export function readAreaData(fs: NitroFs): { propSet: number; mapTex: number }[] {
  return readNarc(fs.file(PATHS.areaData)).map((b) => {
    const r = new Reader(b);
    if (b.length !== 8) throw new Error(`area_data: member of ${b.length} bytes`);
    return { propSet: r.u16(0), mapTex: r.u16(2) };
  });
}

export function importAssets(fs: NitroFs, opts: ImportAssetsOptions = {}): ImportAssetsResult {
  const log = opts.log ?? (() => {});
  const assets = new Map<string, Uint8Array>();
  const models: Model[] = [];
  const sprites: BillboardSprite[] = [];
  const textureAnimations: TextureAnimation[] = [];
  const propAnimations = new Map<number, NonNullable<Prop['animations']>>();
  const modelObjects = new Map<number, Id>();
  const warnings = new Map<string, number>();
  const warn = (w: string) => {
    const kind = w.replace(/ \(material .*\)$/, '');
    warnings.set(kind, (warnings.get(kind) ?? 0) + 1);
  };

  const land = readNarc(fs.file(PATHS.landData));
  const mapSets = readNarc(fs.file(PATHS.mapTexSet)).map((b) => must(readTex0(b), 'map_tex_set member without TEX0'));
  const buildFiles = readNarc(fs.file(PATHS.buildModel));
  const propSets = readNarc(fs.file(PATHS.propTexSet));
  const areaBuild = readNarc(fs.file(PATHS.areaBuild)).map((b) => {
    const r = new Reader(b);
    return Array.from({ length: r.u16(0) }, (_, i) => r.u16(2 + i * 2));
  });
  const areaData = readAreaData(fs);

  // ---- which chunks, map sets, prop sets ----
  let chunkIds: number[];
  let mapSetIds: number[];
  let propSetIds: number[];
  if (opts.slice) {
    const areas = Object.keys(SLICE_AREAS).map(Number);
    chunkIds = areas.flatMap((a) => SLICE_AREAS[a] as number[]);
    mapSetIds = [...new Set(areas.map((a) => must(areaData[a], `area ${a}`).mapTex))];
    propSetIds = [...new Set(areas.map((a) => must(areaData[a], `area ${a}`).propSet))];
  } else {
    chunkIds = land.map((_, i) => i);
    mapSetIds = mapSets.map((_, i) => i);
    propSetIds = [...new Set(areaData.map((a) => a.propSet))].filter((s) => s < propSets.length);
  }
  const listed = new Set(propSetIds.flatMap((s) => must(areaBuild[s], `area_build ${s}`)));
  // The slice also converts every listed door, PC and the elevator lights, so their animations import the same everywhere.
  const doorModels = opts.doorModels ?? new Set<number>();
  if (opts.slice) for (const id of [...doorModels, ...PC_MODELS, ELEVATOR_LIGHTS_MODEL, ...(opts.sliceModels ?? [])]) if (areaBuild.some((list) => list.includes(id))) listed.add(id);
  const buildIds = [...listed].sort((a, b) => a - b);

  const formatLookup = (sets: (Tex0 | null)[]) => {
    const formats = new Map<string, { format: TexelFormat; color0Transparent: boolean }>();
    for (const s of sets) for (const t of s?.textures ?? []) if (!formats.has(t.name) || t.format === 'a3i5' || t.format === 'a5i3') formats.set(t.name, t);
    return (name: string) => formats.get(name);
  };

  // ---- land chunk models ----
  const landFormats = formatLookup(mapSetIds.map((i) => must(mapSets[i], `map_tex_set ${i}`)));
  const landModels = new Map<number, G3dModel>();
  for (const i of chunkIds) {
    const [model, ...rest] = readModels(landDataModel(must(land[i], `land_data ${i}`)));
    if (!model || rest.length) throw new Error(`land_data ${i}: expected one model`);
    if (model.materials.some((m) => m.texture === null)) warn('land material without texture (drawn untextured)');
    const res = modelToGltf(model, { textureFormat: landFormats });
    if (res.vertexCount !== model.numVertex) throw new Error(`land_data ${i}: decoded ${res.vertexCount} vertices, header says ${model.numVertex}`);
    res.warnings.forEach(warn);
    landModels.set(i, model);
    assets.set(`models/land/${i}.gltf`, enc.encode(JSON.stringify(res.gltf)));
    models.push({ id: `platinum:MODEL_LAND_${i}`, gltf: `platinum:models/land/${i}.gltf` });
  }
  log(`land models: ${landModels.size}`);

  // ---- map texture sets: every (texture, palette) pair used by a chunk that resolves in the set ----
  const swaps = readNarc(fs.file(PATHS.fldtanime));
  const swapTable = readFrameSwapTable(must(swaps[0], 'fldtanime table'));
  const swapsByTexture = new Map(swapTable.map((s, i) => [s.texture, { swap: s, index: i, tex0: must(readTex0(must(swaps[i + 1], `fldtanime ${i + 1}`)), 'fldtanime frame set') }]));
  const usedSwaps = new Set<number>();
  const resolved = new Set<number>();
  for (const setId of mapSetIds) {
    const set = must(mapSets[setId], `map_tex_set ${setId}`);
    const pairs = new Map<string, [string, string]>();
    const sliceChunks = opts.slice ? Object.entries(SLICE_AREAS).filter(([a]) => areaData[Number(a)]?.mapTex === setId).flatMap(([, c]) => c) : null;
    for (const [i, model] of landModels) {
      const fits = model.materials.every((m) => !m.texture || (has(set, 'textures', m.texture) && has(set, 'palettes', m.palette)));
      if (sliceChunks?.includes(i) && !fits) {
        const missing = model.materials.filter((m) => m.texture && !(has(set, 'textures', m.texture) && has(set, 'palettes', m.palette)));
        throw new Error(`land_data ${i}: ${missing.map((m) => `${m.texture}/${m.palette}`).join(', ')} missing from map_tex_set ${setId}`);
      }
      if (sliceChunks && !sliceChunks.includes(i)) continue;
      if (fits) resolved.add(i);
      // Pairs the set holds, also for chunks that only partly resolve in it: the DS binds each name it
      // finds and leaves the others unbound (drawn untextured), and the renderer does the same.
      for (const m of model.materials) if (m.texture && m.palette && has(set, 'textures', m.texture) && has(set, 'palettes', m.palette)) pairs.set(pairKey(m.texture, m.palette), [m.texture, m.palette]);
    }
    for (const [key, [tex, pal]] of pairs) {
      const t = set.textures.find((x) => x.name === tex)!;
      const p = set.palettes.find((x) => x.name === pal)!;
      assets.set(`textures/map/${setId}/${key}.png`, encodePng(t.width, t.height, decodeTexture(set, t, p)));
      const s = swapsByTexture.get(tex);
      if (!s) continue;
      usedSwaps.add(s.index);
      for (const f of s.swap.frames) {
        const ft = s.tex0.textures[f.textureIndex];
        if (!ft) throw new Error(`fldtanime ${s.index}: frame texture ${f.textureIndex} missing`);
        // The game copies the base texture's byte size from the frame data, whatever the frame's own size.
        if (ft.width !== t.width || ft.height !== t.height || ft.format !== t.format) warn(`fldtanime frame differs in size/format from the map texture (decoded as the game does)`);
        const path = `textures/map/${setId}/${pairKey(`${tex}~${f.textureIndex}`, pal)}.png`;
        if (!assets.has(path)) assets.set(path, encodePng(t.width, t.height, decodeTexture(set, t, p, { reader: s.tex0.reader, data: ft.data })));
      }
    }
  }
  const unresolved = [...landModels.keys()].filter((i) => !resolved.has(i));
  if (unresolved.length) warn(`land chunks whose names resolve in no map texture set: ${unresolved.length}`);
  for (const index of [...usedSwaps].sort((a, b) => a - b)) {
    const { swap } = [...swapsByTexture.values()].find((s) => s.index === index)!;
    textureAnimations.push({
      id: `platinum:TEXANIM_MAP_${index}`,
      kind: 'frames',
      texture: swap.texture,
      frames: swap.frames.map((f) => ({ texture: `${swap.texture}~${f.textureIndex}`, ticks: f.ticks })),
    });
  }

  // ---- build models + prop texture sets ----
  const propTex = new Map(propSetIds.map((s) => [s, readTex0(must(propSets[s], `areabm_texset ${s}`))]));
  const buildFormats = formatLookup([...propTex.values()]);
  const animeList = readNarc(fs.file(PATHS.bmAnimeList));
  const anime = readNarc(fs.file(PATHS.bmAnime));
  const matShp = readMatShp(fs.file(PATHS.buildMatShp));
  const buildModels = new Map<number, { model: G3dModel; embedded: Tex0 | null; patterns: PatternFrames[] }>();
  for (const i of buildIds) {
    const bytes = must(buildFiles[i], `build_model ${i}`);
    const [model, ...rest] = readModels(bytes);
    if (!model || rest.length) throw new Error(`build_model ${i}: expected one model`);
    const { texture: animations, patterns, joints, door, elevator } = buildAnimations(i, doorModels.has(i) || PC_MODELS.has(i), must(animeList[i], `bm_anime_list ${i}`), anime, model.materials, warn);
    // Door pattern clips are texture animations, not glTF clips.
    const clips = door ? DOOR_USES.flatMap((use) => ('joint' in door[use] ? [{ clip: use, animation: door[use].joint }] : [])) : joints;
    const pairs = matShp[i] ?? [];
    if (pairs.length && (animations.length || clips.length)) throw new Error(`build_model ${i}: has a material/shape list and animations`);
    const res = modelToGltf(pairs.length ? drawnByMatShp(model, pairs) : model, { textureFormat: buildFormats, animations: clips });
    if (res.vertexCount !== model.numVertex) throw new Error(`build_model ${i}: decoded ${res.vertexCount} vertices, header says ${model.numVertex}`);
    res.warnings.forEach(warn);
    buildModels.set(i, { model, embedded: readTex0(bytes), patterns });
    assets.set(`models/build/${i}.gltf`, enc.encode(JSON.stringify(res.gltf)));
    const record: Model = { id: `platinum:MODEL_BUILD_${i}`, gltf: `platinum:models/build/${i}.gltf` };
    if (door) {
      const clip = (use: (typeof DOOR_USES)[number]) => {
        const c = door[use];
        if ('joint' in c) return { clip: use, ticks: c.joint.frames };
        textureAnimations.push(c.pattern);
        return { clip: c.pattern.id, ticks: c.ticks };
      };
      propAnimations.set(i, PC_MODELS.has(i) ? { 'pc-on': clip('open'), 'pc-off': clip('close') } : { open: clip('open'), close: clip('close') });
    } else if (elevator.length) {
      textureAnimations.push(...elevator);
      propAnimations.set(i, Object.fromEntries(elevator.map((a, k) => [ELEVATOR_USES[k], { clip: a.id, ticks: a.frames }])));
    } else if (joints.length) propAnimations.set(i, Object.fromEntries(joints.map((j) => [j.clip, { clip: j.clip, ticks: j.animation.frames, ...(j.clip === 'bridge' || j.clip === 'opening' || j.clip === 'tram' || j.clip.startsWith('shake-') ? {} : { loop: true }) }])));
    if (animations.length) {
      // The healing machine's ball and screen: their one-shot patterns (healing_machine_animation/pokecenter.c).
      if (HEAL_ONE_SHOTS.has(i)) {
        const pattern = animations[0]!;
        if (animations.length !== 1 || pattern.kind !== 'frames') throw new Error(`healing machine model ${i}: expected one texture pattern`);
        propAnimations.set(i, { flash: { clip: pattern.id, ticks: pattern.frames.reduce((n, f) => n + f.ticks, 0) } });
      } else record.animations = animations.map((a) => a.id);
      textureAnimations.push(...animations);
    }
    models.push(record);
  }
  for (const [setId, set] of propTex) {
    const pairs = new Map<string, { source: Tex0; tex: string; pal: string }>();
    for (const id of must(areaBuild[setId], `area_build ${setId}`)) {
      const { model, embedded, patterns } = must(buildModels.get(id), `build model ${id}`);
      const sourceOf = (tex: string, pal: string) => {
        const source = set && has(set, 'textures', tex) && has(set, 'palettes', pal) ? set : embedded && has(embedded, 'textures', tex) && has(embedded, 'palettes', pal) ? embedded : null;
        if (!source) throw new Error(`build_model ${id}: ${tex}/${pal} is in neither areabm_texset ${setId} nor its embedded TEX0`);
        if (source !== set) warn('prop texture taken from the model’s embedded TEX0 (missing from the area prop set)');
        return source;
      };
      for (const m of model.materials) {
        if (!m.texture || !m.palette) continue;
        pairs.set(pairKey(m.texture, m.palette), { source: sourceOf(m.texture, m.palette), tex: m.texture, pal: m.palette });
      }
      // Pattern frames are stored under the base pair's palette name, decoded with their own pair.
      for (const p of patterns) p.frames.forEach((f, k) => pairs.set(pairKey(`${p.base}~${p.prefix}${k}`, p.basePalette), { source: sourceOf(f.texture, f.palette), tex: f.texture, pal: f.palette }));
    }
    for (const [key, { source, tex, pal }] of pairs) {
      const t = source.textures.find((x) => x.name === tex)!;
      assets.set(`textures/build/${setId}/${key}.png`, encodePng(t.width, t.height, decodeTexture(source, t, source.palettes.find((x) => x.name === pal)!)));
    }
  }
  log(`build models: ${buildModels.size}, prop sets: ${propTex.size}`);
  // Each texture set lists the pairs it holds (`index.json`): the renderer leaves only unlisted names unbound.
  const setPairs = new Map<string, string[]>();
  for (const path of assets.keys()) {
    const m = /^(textures\/(?:map|build)\/\d+)\/(.+)\.png$/.exec(path);
    if (m) setPairs.set(m[1]!, [...(setPairs.get(m[1]!) ?? []), m[2]!]);
  }
  for (const [dir, pairs] of setPairs) assets.set(`${dir}/index.json`, enc.encode(JSON.stringify(pairs.sort())));

  // ---- overworld characters ----
  const mm = readNarc(fs.file(PATHS.mmodel));
  const walk = readFrameSequence(must(mm[MMODEL.genericWalk], 'generic_walk.bin'));
  const walkRun = readFrameSequence(must(mm[MMODEL.walkAndRun], 'walk_and_run.bin'));
  const frameTables = frameTablesByMmodel(opts.objectGfx, warn);
  for (let i = 0; i < MMODEL.sets; i++) {
    const tex0 = must(readTex0(must(mm[i], `mmodel ${i}`)), `mmodel ${i} TEX0`);
    const n = tex0.textures.length;
    const walkSet = (n === 16 || n === 32) && tex0.textures.every((t) => t.width === 32 && t.height === 32);
    const staticSet = !walkSet && isStaticSet(tex0);
    // The surf sets are static-shaped but drawn per direction from their frame table (see `isStaticSet`).
    const surfSet = staticSet && frameTables.get(i)?.frameSeq === SURF_FRAME_SEQ;
    const table = walkSet || (staticSet && !surfSet) ? undefined : frameTables.get(i);
    const giratina = table?.billboardModel === 11;
    const berryTree = table !== undefined && BERRY_TREE_MODELS.has(table.billboardModel);
    if (!walkSet && !staticSet && !(table && (isFrameSet(tex0) || giratina || berryTree))) {
      warn('mmodel set not converted (not a walk, static or square frame-table set)');
      continue;
    }
    const atlas = giratina ? giratinaAtlas(tex0) : berryTree ? berryTreeAtlas(tex0) : buildSpriteAtlas(tex0);
    assets.set(`sprites/${i}.png`, encodePng(atlas.width, atlas.frameSize, atlas.rgba));
    let animations: BillboardSprite['animations'];
    if (walkSet) animations = billboardAnimations(n === 32 ? walkRun : walk, atlas, n === 32);
    else if (table) animations = frameTableAnimations(readFrameSequence(must(mm[MMODEL.frameSeqs + table.frameSeq], `frame sequence ${table.frameSeq}`)), table.frameSeq, atlas, table.anims);
    else animations = staticAnimations(atlas.frameCount);
    // The plant's sway loops while it stands (decomp berry_tree frame sequence, animation 0 looped).
    if (berryTree) for (const dir of ['up', 'down', 'left', 'right']) animations[`stand-${dir}`] = animations[`walk-${dir}`] = animations['pose-berry-tree-0']!;
    if (giratina) for (const dir of ['up', 'down', 'left', 'right']) {
      animations[`stand-${dir}`] = animations[`walk-${dir}`] = animations['pose-giratina-origin-0']!;
    }
    sprites.push({ id: `platinum:SPRITE_${i}`, sourceIndex: i, atlas: `platinum:sprites/${i}.png`, frameSize: atlas.frameSize, frameCount: atlas.frameCount, animations });
  }
  log(`sprites: ${sprites.length}`);

  // ---- 3D model objects (signposts, mailboxes …) and the trainer '!' from fldeff ----
  const fldeff = readNarc(fs.file(PATHS.fldeff));
  for (const o of opts.objectGfx?.modelObjects ?? []) {
    const bytes = must(fldeff[o.fldeff], `fldeff ${o.fldeff}`);
    const [model, ...rest] = readModels(bytes);
    if (!model || rest.length) throw new Error(`fldeff ${o.fldeff}: expected one model`);
    const res = modelToGltf(model, { embed: must(readTex0(bytes), `fldeff ${o.fldeff} TEX0`) });
    res.warnings.forEach(warn);
    const gltf = res.gltf as { scene: number; scenes: { nodes: number[] }[]; nodes: object[] };
    // The DS draws the model at the object position plus this offset: bake it in as a root node.
    if (o.offset.some((v) => v !== 0)) {
      const scene = gltf.scenes[gltf.scene]!;
      scene.nodes = [gltf.nodes.push({ name: 'offset', translation: o.offset, children: scene.nodes }) - 1];
    }
    const dir = `models/fldeff/${o.fldeff}`;
    for (const [file, png] of res.images) assets.set(`${dir}/${file}`, png);
    assets.set(`${dir}/model.gltf`, enc.encode(JSON.stringify(gltf)));
    const id = `platinum:MODEL_FLDEFF_${o.fldeff}` as Id;
    if (!models.some((m) => m.id === id)) models.push({ id, gltf: `platinum:${dir}/model.gltf` });
    modelObjects.set(o.gfx, id);
  }
  const converted = new Set(sprites.map((s) => s.sourceIndex));
  // ---- shaped billboard models (the Galactic HQ doors, Celestic Town's ruin wall and its shards, the grunt groups) ----
  // The DS draws these gfx with their own BMD0 and the gfx's own texture set, at the object position plus 6 units
  // south like any billboard (ov5_021EDEB4). The doors and the wall have fixed nodes; the grunt groups' wide quads
  // (gset1, gset2) sit on a full-billboard node (SBC BB), which the renderer turns to face the camera.
  for (const entry of opts.objectGfx?.anims ?? []) {
    if (SQUARE_BILLBOARD_MODELS.has(entry.billboardModel) || BERRY_TREE_MODELS.has(entry.billboardModel)) continue;
    const member = must(opts.objectGfx!.billboardModels.get(entry.billboardModel), `billboard model ${entry.billboardModel}`);
    const textures = opts.objectGfx!.mmodelOf.get(entry.gfx);
    if (textures === undefined || converted.has(textures)) continue;
    const [model, ...rest] = readModels(must(mm[member], `mmodel ${member}`));
    if (!model || rest.length) throw new Error(`mmodel ${member}: expected one model`);
    // The renderer turns a billboard node's own meshes; a node under one would need the DS's matrix stack rules.
    if (model.nodes.some((n) => n.parent !== null && model.nodes[n.parent]!.billboard !== 'none')) throw new Error(`mmodel ${member}: a node under a billboard node`);
    const res = modelToGltf(model, { embed: must(readTex0(must(mm[textures], `mmodel ${textures}`)), `mmodel ${textures} TEX0`) });
    res.warnings.forEach(warn);
    const gltf = res.gltf as { scene: number; scenes: { nodes: number[] }[]; nodes: object[] };
    const scene = gltf.scenes[gltf.scene]!;
    scene.nodes = [gltf.nodes.push({ name: 'offset', translation: [0, 0, BILLBOARD_ANCHOR_Z], children: scene.nodes }) - 1];
    const dir = `models/mmodel/${member}-${textures}`;
    for (const [file, png] of res.images) assets.set(`${dir}/${file}`, png);
    assets.set(`${dir}/model.gltf`, enc.encode(JSON.stringify(gltf)));
    const id = `platinum:MODEL_MMODEL_${member}_${textures}` as Id;
    if (!models.some((m) => m.id === id)) models.push({ id, gltf: `platinum:${dir}/model.gltf` });
    modelObjects.set(entry.gfx, id);
  }
  const effects = importFieldEffects(fldeff, assets, warn);
  const obstacles = importObstacleEffects(readNarc(fs.file(PATHS.hidenEffect)), assets, warn);
  models.push(...effects.models, ...obstacles.models);
  sprites.push(...effects.sprites);
  textureAnimations.push(...effects.textureAnimations, ...obstacles.textureAnimations);
  const exAtlas = buildSpriteAtlas(must(readTex0(must(fldeff[FLDEFF_EXCLAMATION], 'fldeff exclamation')), 'fldeff exclamation TEX0'));
  assets.set('sprites/exclamation.png', encodePng(exAtlas.width, exAtlas.frameSize, exAtlas.rgba));
  const exclamation: BillboardSprite = {
    id: 'platinum:SPRITE_EXCLAMATION',
    atlas: 'platinum:sprites/exclamation.png',
    frameSize: exAtlas.frameSize,
    frameCount: exAtlas.frameCount,
    animations: staticAnimations(exAtlas.frameCount),
  };

  return {
    records: { models, sprites, textureAnimations, fieldEffects: [...effects.fieldEffects, ...obstacles.fieldEffects] },
    propAnimations,
    modelObjects,
    exclamation,
    assets,
    warnings: [...warnings].map(([w, n]) => `${w} ×${n}`),
  };
}

/**
 * build_model_matshp.dat: `u16 modelCount, u16 pairCount, {u16 count, u16 first}[modelCount],
 * {u16 material, u16 shape}[pairCount]` — per build model, the material/shape pairs to draw.
 */
export function readMatShp(bytes: Uint8Array): [number, number][][] {
  const r = new Reader(bytes);
  const models = r.u16(0);
  const pairs = r.u16(2);
  if (4 + models * 4 + pairs * 4 !== bytes.length) throw new Error(`build_model_matshp: ${bytes.length} bytes for ${models} models and ${pairs} pairs`);
  const pairAt = (k: number): [number, number] => [r.u16(4 + models * 4 + k * 4), r.u16(6 + models * 4 + k * 4)];
  return Array.from({ length: models }, (_, i) => {
    const count = r.u16(4 + i * 4);
    const first = r.u16(6 + i * 4);
    if (count && first + count > pairs) throw new Error(`build_model_matshp: model ${i} lists pairs past the table`);
    return Array.from({ length: count }, (_, k) => pairAt(first + k));
  });
}

/**
 * A build model as the field draws one with a material/shape list (decomp map_prop.c
 * MapPropManager_RenderUsing1Mat1Shp): each pair with NNS_G3dDraw1Mat1Shp under the prop's base
 * matrix only, so node transforms are not applied. Static Twinleaf houses rely on it: their own door
 * shape sits under a node that moves it into the doorway, and drawn untransformed it stays inside
 * the house, leaving the doorway to the door prop.
 */
export function drawnByMatShp(model: G3dModel, pairs: readonly [number, number][]): G3dModel {
  const draws = pairs.map(([material, shape]) => {
    if (!model.materials[material] || !model.shapes[shape]) throw new Error(`build_model ${model.name}: material/shape list names ${material}/${shape}, out of range`);
    return { node: 0, material, shape };
  });
  const root = { name: model.name, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], identity: true, parent: null, billboard: 'none' as const };
  return { ...model, nodes: [root], draws };
}

/**
 * decomp BILLBOARD_FRAME_SEQ_SURF. The surf gfx draw animation[facing] at frame 0 every frame
 * (ov5_021EC3F0): one still frame per direction, idle or moving.
 */
const SURF_FRAME_SEQ = FRAME_SEQ_NAMES.indexOf('surf');

/** Ticks per frame of a static set's loop (the decomp's Starly sequence: 4 frames, 4 ticks each). */
const STATIC_FRAME_TICKS = 4;

/**
 * A static set (briefcase, Poké Ball, Starly, …): 1–4 square frames of one size and one palette,
 * named `<base>.<n>` (a single frame may have no suffix), converted by a minimal rule (contracts
 * `BillboardSprite`): see `staticAnimations`. The surf sets have the same shape but one frame per
 * direction: they take their frame table (`SURF_FRAME_SEQ`). Holding a Poké Ball still uses the rule.
 */
export function isStaticSet(tex0: Tex0): boolean {
  const [first] = tex0.textures;
  return (
    first !== undefined &&
    tex0.textures.length <= 4 &&
    tex0.palettes.length === 1 &&
    tex0.textures.every((t) => t.width === first.width && t.height === first.height && t.width === t.height && (tex0.textures.length === 1 || /\.\d+$/.test(t.name)))
  );
}

/** Static set animations: every `stand-<dir>` shows frame 0; every `walk-<dir>` loops all frames, STATIC_FRAME_TICKS each. */
export function staticAnimations(frameCount: number): BillboardSprite['animations'] {
  const out: BillboardSprite['animations'] = {};
  const loop = Array.from({ length: frameCount }, (_, frame) => ({ frame, ticks: STATIC_FRAME_TICKS }));
  for (const dir of ['up', 'down', 'left', 'right']) {
    out[`stand-${dir}`] = [{ frame: 0, ticks: 1 }];
    out[`walk-${dir}`] = loop.map((f) => ({ ...f }));
  }
  return out;
}

/**
 * A BTP0 pattern on one material: frame k draws (`texture`, `palette`); stored as
 * `<base>~<prefix><k>__<basePalette>` (prefix '' for loops, `open-`/`close-` for door clips).
 */
export interface PatternFrames {
  base: string;
  basePalette: string;
  prefix: string;
  frames: { texture: string; palette: string; ticks: number }[];
}

const DOOR_USES = ['open', 'close'] as const;
/**
 * The elevator lights (decomp prop_models.naix `elevator_lights_nsbmd`): their bm_anime entries are one-shot
 * BTA0 scrolls played by FieldTask_PlayElevatorAnimation, index = ELEVATOR_DIR_UP (0) / ELEVATOR_DIR_DOWN (1).
 */
const ELEVATOR_LIGHTS_MODEL = 498;
const ELEVATOR_USES = ['elevator-up', 'elevator-down'] as const;
/**
 * The healing machine's one-shot patterns (decomp prop_models.naix pokecenter_healing_machine_tv,
 * pokecenter_healing_machine_mini_pokeball): one BTP0 each, imported as the prop's `flash` clip.
 */
const HEAL_ONE_SHOTS = new Set([124, 517]);
/**
 * The PCs (decomp pc_animation.c pcMapProps, map_prop_models.order: desk_drawer_laptop, …_facing_right,
 * pokecenter_pc, …_facing_left): bm_anime entries 0 and 1 are the boot-up and shut-down clips, converted as door
 * clips and kept as `pc-on` / `pc-off`.
 */
const PC_MODELS = new Set([112, 115, 119, 248]);
/**
 * canalave_bridge_left / _right (map_prop_models.order): their one deferred BCA0 is the one-shot the boat's
 * departure plays (boat_cutscene.c FieldSystem_LoadCanalaveBridgeAnimation), imported as the `bridge` clip.
 */
const BRIDGE_MODELS = new Set([31, 32]);
/** map_prop_models.order: great_marsh_train. */
const GREAT_MARSH_TRAM_MODEL = 475;
/** map_prop_models.order: honey_tree. Its three on-demand clips are the shakes (HoneyTree DoTreeShakingAnimation: animation 0–2). */
export const HONEY_TREE_MODEL = 26;

/** A door clip: a BCA0 joint animation, or a BTP0 pattern played once (`ticks` = the pattern's frame count). */
type DoorClip = { joint: JointAnimation } | { pattern: Extract<TextureAnimation, { kind: 'frames' }>; ticks: number };

/**
 * Animations of a build model (bm_anime_list: u8 has, u8 flags, u8 slope, u8 pad, s32 ids[4]; decomp
 * map_prop_animation.c). Flags bit 0 = loaded on demand, bit 1 = added to the model on demand: with
 * neither (and not a bike slope) every listed animation loops from map load (BTA0 scrolls, BTP0
 * patterns, BCA0 joint loops). Doors (the ROM's door models) carry their open and close clips as
 * entries 0 and 1 (DoorAnimation_PlayOpenAnimation/PlayCloseAnimation): BCA0 joint animations, or BTP0
 * texture patterns (the elevator door). Everything else is scripted (gym puzzles, lifts, bike slopes)
 * and not converted.
 */
function buildAnimations(
  model: number,
  isDoor: boolean,
  list: Uint8Array,
  anime: Uint8Array[],
  materials: G3dModel['materials'],
  warn: (w: string) => void,
): {
  texture: TextureAnimation[];
  patterns: PatternFrames[];
  joints: { clip: string; animation: JointAnimation }[];
  door: { open: DoorClip; close: DoorClip } | null;
  elevator: Extract<TextureAnimation, { kind: 'scroll' }>[];
} {
  const r = new Reader(list);
  const loops = (r.u8(1) & 3) === 0 && r.u8(2) === 0;
  const out: TextureAnimation[] = [];
  const patterns: PatternFrames[] = [];
  const joints: { clip: string; animation: JointAnimation }[] = [];
  const doorClips: DoorClip[] = [];
  const elevator: Extract<TextureAnimation, { kind: 'scroll' }>[] = [];
  const idOf = (material: string): Id => `platinum:TEXANIM_BUILD_${model}_${material.replace(/[^A-Za-z0-9_.-]/g, '_')}`;
  const oneJoint = (file: Uint8Array, id: number) => {
    const [anim, ...more] = readJointAnimations(file);
    if (!anim || more.length) throw new Error(`bm_anime ${id}: expected one joint animation`);
    return anim;
  };
  /** One material's pattern keys as frames with their own (texture, palette) and length. */
  const patternOf = (a: PatternAnimation, m: PatternAnimation['materials'][number]) => {
    const mat = materials.find((x) => x.name === m.material);
    if (!mat?.texture || !mat.palette) throw new Error(`build_model ${model}: pattern material ${m.material} has no textured material`);
    const frames = m.keys.map((key, i) => ({ texture: key.texture, palette: key.palette, ticks: (m.keys[i + 1]?.frame ?? a.frames) - key.frame }));
    return { base: mat.texture, basePalette: mat.palette, frames };
  };
  for (let k = 0; k < 4; k++) {
    const id = r.i32(4 + k * 4);
    if (id < 0) break;
    const file = must(anime[id], `bm_anime ${id}`);
    const magic = String.fromCharCode(...file.subarray(0, 4));
    if (isDoor && magic === 'BCA0') {
      doorClips.push({ joint: oneJoint(file, id) });
      continue;
    }
    if (isDoor && magic === 'BTP0' && doorClips.length < 2) {
      const [a, ...more] = readPatternAnimations(file);
      if (!a || more.length || a.materials.length !== 1) throw new Error(`bm_anime ${id}: a door pattern needs one animation on one material`);
      const use = DOOR_USES[doorClips.length]!;
      const p = patternOf(a, a.materials[0]!);
      patterns.push({ ...p, prefix: `${use}-` });
      const frames = p.frames.map((f, i) => ({ texture: `${p.base}~${use}-${i}`, ticks: f.ticks }));
      doorClips.push({ pattern: { id: `${idOf(a.materials[0]!.material)}_${use}`, kind: 'frames', texture: p.base, frames }, ticks: a.frames });
      continue;
    }
    if (model === ELEVATOR_LIGHTS_MODEL && magic === 'BTA0' && elevator.length < ELEVATOR_USES.length) {
      const use = ELEVATOR_USES[elevator.length]!;
      const [a, ...more] = readSrtAnimations(file);
      const m = a?.materials[0];
      if (!a || !m || more.length || a.materials.length !== 1) throw new Error(`bm_anime ${id}: the elevator lights need one SRT animation on one material`);
      if (!a.name.endsWith(use.slice('elevator'.length).replace('-', '_'))) throw new Error(`bm_anime ${id}: elevator animation ${a.name} is not the ${use} one`);
      if (m.scaleS !== 1 || m.scaleT !== 1 || m.rotation[0] !== 0 || m.rotation[1] !== 1) throw new Error(`bm_anime ${id}: the elevator lights scale or rotate`);
      elevator.push({ id: `${idOf(m.material)}_${use.slice('elevator-'.length)}`, kind: 'scroll', material: m.material, frames: a.frames, translateS: m.translateS, translateT: m.translateT });
      continue;
    }
    if (BRIDGE_MODELS.has(model) && magic === 'BCA0') {
      joints.push({ clip: 'bridge', animation: oneJoint(file, id) });
      continue;
    }
    if (model === 496 && magic === 'BCA0') {
      joints.push({ clip: 'opening', animation: oneJoint(file, id) });
      continue;
    }
    // honey_tree: its on-demand clips are the shakes while a Pokémon waits (MapPropAnimationManager_AddAnimationToRenderObj, looped).
    if (model === HONEY_TREE_MODEL && magic === 'BCA0') {
      joints.push({ clip: `shake-${joints.length}`, animation: oneJoint(file, id) });
      continue;
    }
    // great_marsh_train: its on-demand clip runs while the tram moves (great_marsh_tram.c MoveTram); the world plays it.
    if (model === GREAT_MARSH_TRAM_MODEL && magic === 'BCA0') {
      joints.push({ clip: 'tram', animation: oneJoint(file, id) });
      continue;
    }
    if (!loops && model !== 496 && !HEAL_ONE_SHOTS.has(model)) {
      warn(`prop animation not converted (scripted/one-shot ${magic})`);
      continue;
    }
    if (magic === 'BCA0') {
      joints.push({ clip: joints.length ? `loop-${joints.length + 1}` : 'loop', animation: oneJoint(file, id) });
    } else if (magic === 'BTA0') {
      for (const a of readSrtAnimations(file)) {
        for (const m of a.materials) {
          if (m.scaleS !== 1 || m.scaleT !== 1 || m.rotation[0] !== 0 || m.rotation[1] !== 1) warn('SRT scale/rotation ignored');
          out.push({ id: idOf(m.material), kind: 'scroll', material: m.material, frames: a.frames, translateS: m.translateS, translateT: m.translateT });
        }
      }
    } else if (magic === 'BTP0') {
      for (const a of readPatternAnimations(file)) {
        for (const m of a.materials) {
          const p = patternOf(a, m);
          patterns.push({ ...p, prefix: '' });
          out.push({ id: idOf(m.material), kind: 'frames', texture: p.base, frames: p.frames.map((f, i) => ({ texture: `${p.base}~${i}`, ticks: f.ticks })) });
        }
      }
    } else throw new Error(`bm_anime ${id}: ${magic} is not a prop animation`);
  }
  if (isDoor && doorClips.length < 2) warn('door model without open/close animations (drawn closed)');
  const [open, close] = doorClips;
  if (model === ELEVATOR_LIGHTS_MODEL && elevator.length !== ELEVATOR_USES.length) throw new Error(`build_model ${model}: the elevator lights have ${elevator.length} of 2 animations`);
  return { texture: out, patterns, joints, door: open && close ? { open, close } : null, elevator };
}

/** Frame-table entries keyed by mmodel set, for gfx with square billboard models; one table per set. */
function frameTablesByMmodel(gfx: ImportAssetsOptions['objectGfx'], warn: (w: string) => void): Map<number, ObjectGfxAnims> {
  const out = new Map<number, ObjectGfxAnims>();
  for (const entry of gfx?.anims ?? []) {
    const mmodel = gfx!.mmodelOf.get(entry.gfx);
    if (mmodel === undefined || !(SQUARE_BILLBOARD_MODELS.has(entry.billboardModel) || BERRY_TREE_MODELS.has(entry.billboardModel))) continue;
    const have = out.get(mmodel);
    if (!have) out.set(mmodel, entry);
    else if (have.frameSeq !== entry.frameSeq || JSON.stringify(have.anims) !== JSON.stringify(entry.anims)) warn('mmodel set used with two different frame tables (first kept)');
  }
  return out;
}

/**
 * decomp `BillboardModel`s that are one square quad: generic 32×32 (0, 9 = the same file), 16×16 (1),
 * 64×64 (5), the Distortion World player (15), plus Origin Giratina (11), padded by giratinaAtlas.
 */
const SQUARE_BILLBOARD_MODELS = new Set([0, 1, 5, 9, 11, 15]);
/** The DS draws a billboard at the object position plus 6 units south (decomp ov5_021EDEB4). */
const BILLBOARD_ANCHOR_Z = 6;
/** decomp BILLBOARD_MODEL_BERRY_SPROUT (3) and BILLBOARD_MODEL_BERRY_TREE (4), padded by berryTreeAtlas. */
const BERRY_TREE_MODELS = new Set([3, 4]);

/** A frame-table set: frames named `<base>.<n>`, square, one size, one palette. */
function isFrameSet(tex0: Tex0): boolean {
  const [first] = tex0.textures;
  return first !== undefined && tex0.palettes.length === 1 && tex0.textures.every((t) => t.width === first.width && t.height === first.height && t.width === t.height && /\.\d+$/.test(t.name));
}

function has(set: Tex0, kind: 'textures' | 'palettes', name: string | null): boolean {
  return name !== null && set[kind].some((x) => x.name === name);
}

function must<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`asset import: missing ${what}`);
  return v;
}
