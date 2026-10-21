/**
 * Field effects (decomp FIELD_EFFECT_RENDERER_*, `/data/mmodel/fldeff.narc`) → `FieldEffect` records.
 *
 * Member indices and timings come from the decomp's renderers (ov5_021F134C.c shadow, ov5_021F1CC8.c
 * footprints and tracks, ov5_021F2A7C.c/ov5_021F2BD0.c puddle and mud splashes, ov5_021F2D20.c tall
 * grass, ov5_021F3284.c shallow-water ripple, ov5_021F348C.c landing dust, ov5_021F37A8.c very tall
 * grass, ov5_021F3A50.c mud grass, ov5_021F3E74.c reveal smoke, ov5_021F3D00.c disguise mounds,
 * surf_mount_renderer.c, ov5_021F2850.c rock-climb mount, ov5_021F61BC.c warp arrow, berry_patch_effects.c soil moisture).
 *
 * - Model effects: the BMD0 with its embedded textures, `models/fldeff/<member>/model.gltf`. A BTP0
 *   pattern on it becomes a `frames` texture animation whose frame images sit next to the model as
 *   `<texture>~<k>__<palette>.png` (listed in that directory's `index.json`).
 * - Billboard effects: a BTX0 texture set and a frame-sequence member (`u32 n; u16 start[n]; u8
 *   texture[n]; u8 palette[n]`) become a sprite atlas `sprites/fldeff/<name>.png`.
 *
 * Positions: the world gives an effect's anchor (`EffectView.cur`); the renderer adds the DS draw
 * offset of each effect. Shadows and reflections are drawn by the renderer from the actors.
 */
import type { BillboardSprite, FieldEffect, Model, PropAnimation, TextureAnimation } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { decodeTexture, encodePng, findPalette, findTexture, modelToGltf, readFrameSequence, readJointAnimations, readModels, readPatternAnimations, readTex0, type Tex0 } from '@opensinnoh/g3d';

const enc = new TextEncoder();

/** Model effects: renderer index, fldeff BMD0 member, optional BTP0 pattern (use name, member). */
const MODEL_EFFECTS: { name: string; renderer: number; member: number; pattern?: { use: string; member: number } }[] = [
  { name: 'SHADOW', renderer: 0x00, member: 17 },
  { name: 'PUDDLE_SPLASH', renderer: 0x11, member: 15, pattern: { use: 'splash', member: 160 } },
  { name: 'MUD_SPLASH', renderer: 0x12, member: 16, pattern: { use: 'mud', member: 161 } },
  ...['UP', 'DOWN', 'LEFT', 'RIGHT'].map((d, i) => ({ name: `FOOTPRINT_SAND_${d}`, renderer: 0x0b, member: 59 + i })),
  ...['VERTICAL', 'HORIZONTAL', 'UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'].map((d, i) => ({ name: `TRACK_SAND_${d}`, renderer: 0x0b, member: 63 + i })),
  ...['UP', 'DOWN', 'LEFT', 'RIGHT'].map((d, i) => ({ name: `FOOTPRINT_SNOW_${d}`, renderer: 0x0b, member: 93 + i })),
  ...['VERTICAL', 'HORIZONTAL', 'UP_LEFT', 'UP_RIGHT', 'DOWN_LEFT', 'DOWN_RIGHT'].map((d, i) => ({ name: `TRACK_SNOW_${d}`, renderer: 0x0b, member: 97 + i })),
  { name: 'WARP_ARROW', renderer: 0x0e, member: 80 },
  { name: 'SURF_BLOB', renderer: 0x0f, member: 81 },
  { name: 'ROCK_CLIMB_MOUNT', renderer: 0x10, member: 82 },
  ...['SNOW', 'SAND', 'ROCK', 'GRASS'].map((d, i) => ({ name: `DISGUISE_MOUND_${d}`, renderer: 0x1a, member: 103 + i })),
  // berry_patch_effects.c sBerryPatchMoistureResourceIDs, by BerryPatches_GetPatchMoisture: very dry, dry, moist.
  ...['VERY_DRY', 'DRY', 'MOIST'].map((d, i) => ({ name: `BERRY_PATCH_SOIL_${d}`, renderer: 0x0c, member: 77 - i })),
  // ov5_021F575C.c ov5_DisplayBuriedSphereSparkle (renderer 9): model 92 with pattern 164, played once at a buried sphere.
  { name: 'BURIED_SPHERE_SPARKLE', renderer: 0x09, member: 92, pattern: { use: 'sparkle', member: 164 } },
];

/**
 * Billboard effects: BTX0 member, frame-sequence member, the animation (use, last frame, loop) as the
 * renderer plays it (BillboardAnim {start, end, type}). One-shot animations hold their last frame.
 */
const SPRITE_EFFECTS: { name: string; renderer?: number; textures: number; sequence: number; use: string; end: number; loop?: true }[] = [
  { name: 'TALL_GRASS', renderer: 0x13, textures: 0, sequence: 170, use: 'rustle', end: 12 },
  { name: 'SHALLOW_WATER_RIPPLE', renderer: 0x15, textures: 5, sequence: 174, use: 'ripple', end: 12, loop: true },
  { name: 'LANDING_DUST', renderer: 0x17, textures: 7, sequence: 175, use: 'dust', end: 9 },
  { name: 'VERY_TALL_GRASS', renderer: 0x18, textures: 8, sequence: 176, use: 'rustle', end: 12 },
  { name: 'MUD_GRASS', renderer: 0x19, textures: 9, sequence: 177, use: 'rustle', end: 2 },
  { name: 'REVEAL_SMOKE', renderer: 0x1b, textures: 12, sequence: 180, use: 'smoke', end: 7 },
  // The Poké Radar's patches (ov5_021F2D20.c ov5_021F3154: billboards 5–7 on the tall grass renderer's resources; no
  // renderer of their own, the world places them): soft, hard and shiny shakes, played once (FieldSystem_
  // CreateShakingRadarPatches waits for their end).
  { name: 'RADAR_GRASS_SOFT', textures: 1, sequence: 171, use: 'shake', end: 40 },
  { name: 'RADAR_GRASS_HARD', textures: 2, sequence: 172, use: 'shake', end: 24 },
  { name: 'RADAR_GRASS_SHINY', textures: 3, sequence: 173, use: 'shake', end: 40 },
];

export interface FieldEffectAssets {
  fieldEffects: FieldEffect[];
  models: Model[];
  sprites: BillboardSprite[];
  textureAnimations: TextureAnimation[];
}

export function importFieldEffects(fldeff: Uint8Array[], assets: Map<string, Uint8Array>, warn: (w: string) => void): FieldEffectAssets {
  const out: FieldEffectAssets = { fieldEffects: [], models: [], sprites: [], textureAnimations: [] };
  const member = (i: number) => {
    const m = fldeff[i];
    if (!m) throw new Error(`fldeff: no member ${i}`);
    return m;
  };
  for (const e of MODEL_EFFECTS) {
    const bytes = member(e.member);
    const [model, ...rest] = readModels(bytes);
    if (!model || rest.length) throw new Error(`fldeff ${e.member}: expected one model`);
    const tex0 = readTex0(bytes);
    if (!tex0) throw new Error(`fldeff ${e.member}: no embedded TEX0`);
    const res = modelToGltf(model, { embed: tex0 });
    res.warnings.forEach(warn);
    const dir = `models/fldeff/${e.member}`;
    for (const [file, png] of res.images) assets.set(`${dir}/${file}`, png);
    assets.set(`${dir}/model.gltf`, enc.encode(JSON.stringify(res.gltf)));
    const modelId = `platinum:MODEL_FLDEFF_${e.member}` as Id;
    const record: Model = { id: modelId, gltf: `platinum:${dir}/model.gltf` };
    const animations: Record<string, PropAnimation> = {};
    if (e.pattern) {
      const listed: string[] = [];
      for (const a of readPatternAnimations(member(e.pattern.member))) {
        for (const m of a.materials) {
          const mat = model.materials.find((x) => x.name === m.material);
          if (!mat?.texture || !mat.palette) throw new Error(`fldeff ${e.pattern.member}: pattern material ${m.material} has no textured material in fldeff ${e.member}`);
          const id = `platinum:TEXANIM_FLDEFF_${e.member}_${m.material.replace(/[^A-Za-z0-9_.-]/g, '_')}` as Id;
          const frames = m.keys.map((key, k) => {
            const name = `${mat.texture}~${k}`;
            assets.set(`${dir}/${name}__${mat.palette}.png`, pair(tex0, key.texture, key.palette));
            listed.push(`${name}__${mat.palette}`);
            return { texture: name, ticks: (m.keys[k + 1]?.frame ?? a.frames) - key.frame };
          });
          out.textureAnimations.push({ id, kind: 'frames', texture: mat.texture, frames });
          (record.animations ??= []).push(id);
          animations[e.pattern.use] = { clip: id, ticks: a.frames };
        }
      }
      assets.set(`${dir}/index.json`, enc.encode(JSON.stringify(listed.sort())));
    }
    out.models.push(record);
    out.fieldEffects.push({ id: `platinum:FIELD_EFFECT_${e.name}` as Id, sourceIndex: e.renderer, name: e.name, model: modelId, ...(Object.keys(animations).length ? { animations } : {}) });
  }
  for (const e of SPRITE_EFFECTS) {
    const tex0 = readTex0(member(e.textures));
    if (!tex0) throw new Error(`fldeff ${e.textures}: not a texture set`);
    const seq = readFrameSequence(member(e.sequence));
    const used = seq.startFrame.map((start, i) => ({ start, texture: seq.textureIndex[i]!, palette: seq.paletteIndex[i]! })).filter((f) => f.start <= e.end);
    const frames = used.map((f) => {
      const t = tex0.textures[f.texture];
      const p = tex0.palettes[f.palette];
      if (!t || !p) throw new Error(`fldeff ${e.sequence}: frame names texture ${f.texture}/palette ${f.palette} beyond fldeff ${e.textures}`);
      if (t.width !== t.height || t.width !== tex0.textures[0]!.width) throw new Error(`fldeff ${e.textures}: ${t.name} is not square at the set's size`);
      return decodeTexture(tex0, t, p);
    });
    const size = tex0.textures[0]!.width;
    const width = size * frames.length;
    const rgba = new Uint8Array(width * size * 4);
    frames.forEach((px, slot) => {
      for (let y = 0; y < size; y++) rgba.set(px.subarray(y * size * 4, (y + 1) * size * 4), (y * width + slot * size) * 4);
    });
    const path = `sprites/fldeff/${e.name.toLowerCase()}.png`;
    assets.set(path, encodePng(width, size, rgba));
    // Frame i shows from its start to the next start; the last one lasts to the animation's end (≥ 1 tick).
    const anim = used.map((f, i) => ({ frame: i, ticks: Math.max(1, (used[i + 1]?.start ?? e.end) - f.start) }));
    const ticks = anim.reduce((n, f) => n + f.ticks, 0);
    const spriteId = `platinum:SPRITE_FLDEFF_${e.name}` as Id;
    const animations: BillboardSprite['animations'] = { [e.use]: anim };
    for (const d of ['up', 'down', 'left', 'right']) {
      animations[`stand-${d}`] = [{ frame: 0, ticks: 1 }];
      animations[`walk-${d}`] = anim;
    }
    out.sprites.push({ id: spriteId, atlas: `platinum:${path}`, frameSize: size, frameCount: frames.length, animations });
    out.fieldEffects.push({ id: `platinum:FIELD_EFFECT_${e.name}` as Id, ...(e.renderer !== undefined ? { sourceIndex: e.renderer } : {}), name: e.name, sprite: spriteId, animations: { [e.use]: { clip: e.use, ticks, ...(e.loop ? { loop: true } : {}) } } });
  }
  return out;
}

/**
 * The destroy-obstacle animations (decomp ov6_02248050.c, `/graphic/hiden_effect.narc`): Cut
 * (ov6_0224825C: model 3, animations 0–2) and Rock Smash (ov6_02248340: model 8, animations 4–7), 45
 * frames, played once. Converted: the BCA0 joint animation (a glTF clip named after the use) and the
 * Rock Smash dust BTP0 pattern (the model's own `frames` texture animation, played on the same tick).
 * Not converted: the BMA0 material animations (1, 5) and the BTA0 texture SRTs (2, 7), which rotate.
 */
const OBSTACLE_EFFECTS: { name: string; model: number; joint: number; use: string; pattern?: number }[] = [
  { name: 'CUT', model: 3, joint: 0, use: 'cut' },
  { name: 'ROCK_SMASH', model: 8, joint: 4, use: 'smash', pattern: 6 },
];

export function importObstacleEffects(hiden: Uint8Array[], assets: Map<string, Uint8Array>, warn: (w: string) => void): FieldEffectAssets {
  const out: FieldEffectAssets = { fieldEffects: [], models: [], sprites: [], textureAnimations: [] };
  const member = (i: number) => {
    const m = hiden[i];
    if (!m) throw new Error(`hiden_effect: no member ${i}`);
    return m;
  };
  for (const e of OBSTACLE_EFFECTS) {
    const bytes = member(e.model);
    const [model, ...rest] = readModels(bytes);
    if (!model || rest.length) throw new Error(`hiden_effect ${e.model}: expected one model`);
    const tex0 = readTex0(bytes);
    if (!tex0) throw new Error(`hiden_effect ${e.model}: no embedded TEX0`);
    const [joint, ...more] = readJointAnimations(member(e.joint));
    if (!joint || more.length) throw new Error(`hiden_effect ${e.joint}: expected one joint animation`);
    const res = modelToGltf(model, { embed: tex0, animations: [{ clip: e.use, animation: joint }] });
    res.warnings.forEach(warn);
    warn('hiden_effect material (BMA0) and rotating texture SRT (BTA0) animations not converted');
    const dir = `models/hiden_effect/${e.model}`;
    for (const [file, png] of res.images) assets.set(`${dir}/${file}`, png);
    assets.set(`${dir}/model.gltf`, enc.encode(JSON.stringify(res.gltf)));
    const modelId = `platinum:MODEL_HIDEN_EFFECT_${e.model}` as Id;
    const record: Model = { id: modelId, gltf: `platinum:${dir}/model.gltf` };
    if (e.pattern !== undefined) {
      const listed: string[] = [];
      for (const a of readPatternAnimations(member(e.pattern))) {
        if (a.frames !== joint.frames) throw new Error(`hiden_effect ${e.pattern}: ${a.frames} frames, the joint animation has ${joint.frames}`);
        for (const m of a.materials) {
          const mat = model.materials.find((x) => x.name === m.material);
          if (!mat?.texture || !mat.palette) throw new Error(`hiden_effect ${e.pattern}: pattern material ${m.material} has no textured material in model ${e.model}`);
          const frames = m.keys.map((key, k) => {
            const name = `${mat.texture}~${k}`;
            assets.set(`${dir}/${name}__${mat.palette}.png`, pair(tex0, key.texture, key.palette));
            listed.push(`${name}__${mat.palette}`);
            return { texture: name, ticks: (m.keys[k + 1]?.frame ?? a.frames) - key.frame };
          });
          const id = `platinum:TEXANIM_HIDEN_EFFECT_${e.model}_${m.material.replace(/[^A-Za-z0-9_.-]/g, '_')}` as Id;
          out.textureAnimations.push({ id, kind: 'frames', texture: mat.texture, frames });
          (record.animations ??= []).push(id);
        }
      }
      assets.set(`${dir}/index.json`, enc.encode(JSON.stringify(listed.sort())));
    }
    out.models.push(record);
    out.fieldEffects.push({ id: `platinum:FIELD_EFFECT_${e.name}` as Id, name: e.name, model: modelId, animations: { [e.use]: { clip: e.use, ticks: joint.frames } } });
  }
  return out;
}

function pair(tex0: Tex0, texture: string, palette: string): Uint8Array {
  const t = findTexture(tex0, texture);
  return encodePng(t.width, t.height, decodeTexture(tex0, t, findPalette(tex0, palette)));
}
