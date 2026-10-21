/**
 * The gym puzzles' tables (decomp src/overlay008/gym_features.c), read from overlay 8 of the player's ROM in
 * one SHA-1-pinned region (platinum.ts `TABLES.gyms`, 0x2E04–0x4DDC), and their field-effect models
 * (`/data/mmodel/fldeff.narc`, members named by the decomp's renderers). Nothing here is a copied table:
 * every value comes from the ROM; the code holds only offsets, sizes and the decomp's #define constants.
 *
 * Overlay 8 layout (offsets into the overlay):
 * - 0x2E04 sVeilstoneTravelDistanceRequiringCameraMovement: s32 × 4 (DIR_NORTH, SOUTH, WEST, EAST).
 * - 0x2E14 sEternaGymClockTimes: {s16 hour, s16 minute} × 5.
 * - 0x2E58 sEternaGymRotationForHour: u16 × 12.
 * - 0x2E70 sTrainerRoom1Doors, 0x2EE4 sTrainerRoom2Doors: {s32 id, s16 x, s16 z}, ending with the exit (8).
 * - 0x2E90 sEternaGymHourHandJumpTiles: {s16 x, s16 z, s32 northSouth} × 5 (x −1: none).
 * - 0x2F74 sTrainerRoomLayouts: {s32 map header, first door, door count, offset x, offset z, size x, size z} × 2.
 * - 0x2FAC sPunchingBagPositions (9), 0x303C sTireStackPositions (11): {s32 x, s32 z}.
 * - 0x30FC sEternaGymFountainCollision: u8 × 21 × 5.
 * - 0x3208 sCanalavePlatformPaths: {s32 model, u8 xA, yA, zA, xB, yB, zB, floorA, floorB, u16 startInPositionB, 2 pad} × 24.
 * - 0x3388 sEternaGymClockCollision: u8 × 169 × 5.
 * - 0x36D5 sCanalaveGymCollisionMaps: u8 × 1024 × 4.
 * - 0x4748, 0x47C0 sTrainerRoom1CluePositions (15 × 8), sTrainerRoom2CluePositions (27 × 20): u8.
 * - 0x49DC sVeilstoneTileBehaviors: u8 × 32 × 32.
 */
import type { EternaGymTables, Facing, FieldEffect, GymTables, HearthomeGymRoom, HearthomeGymTables, Model, PastoriaGymTables, TextureAnimation } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { block, decodeTexture, encodePng, findPalette, findTexture, modelToGltf, readDict, readJointAnimations, readModels, readNitroFile, readPatternAnimations, readSrtAnimations, readTex0, type Tex0 } from '@opensinnoh/g3d';
import { Reader } from '@opensinnoh/nds';

/** The pinned region's overlay offset (its first table). */
export const GYM_REGION = 0x2e04;
const AT = {
  cameraDistance: 0x2e04,
  clockTimes: 0x2e14,
  hourRotations: 0x2e58,
  room1Doors: 0x2e70,
  room2Doors: 0x2ee4,
  jumps: 0x2e90,
  roomLayouts: 0x2f74,
  bags: 0x2fac,
  stacks: 0x303c,
  fountains: 0x30fc,
  clock: 0x3388,
  canalavePaths: 0x3208,
  canalaveCollision: 0x36d5,
  room1Clues: 0x4748,
  room2Clues: 0x47c0,
  track: 0x49dc,
} as const;
/** ETERNA_CLOCK_MAX, the 13×13 clock, ETERNA_GYM_WIDTH; VEILSTONE_NUM_PUNCHING_BAGS / _TIRE_STACKS; MAP_TILES_COUNT_X/Z. */
const CLOCK_STATES = 5;
const CLOCK_TILES = 13 * 13;
const FOUNTAIN_TILES = 21;
const BAGS = 9;
const STACKS = 11;
const MAP_TILES = 32;
const HEARTHOME_ROOMS = 2;
const DOOR_EXIT = 8;
const LAYOUT_SIZE = 28;
/** CANALAVE_GYM_NUM_PLATFORMS, sizeof the path entry; the platform models by axis (map_prop_models.order). */
const CANALAVE_PLATFORMS = 24;
const CANALAVE_PATH_SIZE = 16;
const CANALAVE_AXIS: Record<number, 'x' | 'y' | 'z'> = { 294: 'z', 295: 'x', 296: 'y', 297: 'y' };

export class GymFormatError extends Error {}

/** What the gym tables name by number, resolved by the importer. */
export interface GymNames {
  zone(i: number): Id;
  /** MAP_HEADER_ETERNA_CITY_GYM, _VEILSTONE_CITY_GYM, _HEARTHOME_CITY_GYM_ENTRANCE_ROOM (code constants). */
  eternaZone: Id;
  veilstoneZone: Id;
  hearthomeEntrance: Id;
  clockVar: Id;
  fountainMessage: Id;
  relicBadge: Id;
  hearthomePlayer: { male: Id; female: Id };
  /** The clock hand props when converted (the slice does not convert Eterna Gym's area). */
  hands: EternaGymTables['hands'];
  /** Pastoria Gym's button and water props (code constants, map_prop_models.order). */
  pastoria: PastoriaGymTables;
  /** A build model's prop. */
  prop(model: number): Id;
  /** Canalave Gym: the arm9 start endpoints and the upper floor props. */
  canalaveStarts: boolean[];
  canalaveFloors: [Id, Id, Id];
}

/**
 * Hearthome Gym's light (ov5_021F47B0.c), read from overlay 5 in one SHA-1-pinned region (platinum.ts
 * `TABLES.hearthomeLight`, RAM 0x02200750–0x02200A00 with the overlay at 0x021D0D80):
 * - 0x02200750 Unk_ov5_02200750: u32 × 1, the light's animation member (fldeff).
 * - 0x0220077C Unk_ov5_0220077C: Simple3DRotationAngles {u16 alpha, beta, gamma, 2 bytes padding} × 4 (degrees, by DIR_*).
 * - 0x0220079C Unk_ov5_0220079C: u32 × 9, the fldeff members: the light, then the clue symbols by door id.
 * - 0x022007C0 Unk_ov5_022007C0: VecFx32 [4][6], the beam's scale by direction and length.
 * - 0x022008E0 Unk_ov5_022008E0: VecFx32 [4][6], the beam's offset from its object by direction and length.
 */
export const LIGHT_REGION = { offset: 0x2f9d0, end: 0x2fc80 } as const;
const LIGHT_AT = { anim: 0x2f9d0, rotations: 0x2f9fc, members: 0x2fa1c, scales: 0x2fa40, offsets: 0x2fb60 } as const;
const LIGHT_LENGTHS = 6;
/** sizeof(Simple3DRotationAngles): three u16 and two bytes of padding. */
const ROTATION_SIZE = 8;

export interface HearthomeLight {
  tables: HearthomeGymTables['light'];
  /** fldeff members: the beam model, its texture scroll, the clue symbols by door id. */
  members: { light: number; scroll: number; symbols: number[] };
}

export function readHearthomeLight(region: Uint8Array): HearthomeLight {
  if (region.length !== LIGHT_REGION.end - LIGHT_REGION.offset) throw new GymFormatError(`the light region is ${region.length} bytes`);
  const r = new Reader(region);
  const at = (o: number) => o - LIGHT_REGION.offset;
  const vec = (o: number): [number, number, number] => [r.i32(o) / 4096, r.i32(o + 4) / 4096, r.i32(o + 8) / 4096];
  const byLength = (o: number) => Array.from({ length: 4 }, (_, d) => Array.from({ length: LIGHT_LENGTHS }, (_, n) => vec(at(o) + (d * LIGHT_LENGTHS + n) * 12)));
  const rotations = Array.from({ length: 4 }, (_, d): [number, number, number] => {
    const angles = [0, 1, 2].map((k) => r.u16(at(LIGHT_AT.rotations) + d * ROTATION_SIZE + k * 2));
    if (angles.some((a) => a >= 360)) throw new GymFormatError(`light rotation ${d}: ${angles.join(', ')} is not in degrees`);
    return angles as [number, number, number];
  });
  const members = Array.from({ length: 9 }, (_, i) => r.u32(at(LIGHT_AT.members) + i * 4));
  return { tables: { rotations, scales: byLength(LIGHT_AT.scales), offsets: byLength(LIGHT_AT.offsets) }, members: { light: members[0]!, scroll: r.u32(at(LIGHT_AT.anim)), symbols: members.slice(1) } };
}

/** Reads the tables from the pinned region (`region` starts at overlay offset GYM_REGION). */
export function readGymTables(region: Uint8Array, n: GymNames, effects: GymEffects | null, light: HearthomeGymTables['light']): GymTables {
  const r = new Reader(region);
  const at = (o: number) => o - GYM_REGION;
  const bits = (o: number, count: number, where: string) =>
    Array.from({ length: count }, (_, i) => {
      const v = r.u8(at(o) + i);
      if (v > 1) throw new GymFormatError(`${where}: ${v} at ${i} is not 0 or 1`);
      return v;
    });
  const tiles = (o: number, count: number) => Array.from({ length: count }, (_, i) => ({ x: r.i32(at(o) + i * 8), z: r.i32(at(o) + i * 8 + 4) }));
  const dirs: Facing[] = ['up', 'down', 'left', 'right'];
  const cameraDistance = Object.fromEntries(dirs.map((d, i) => [d, r.i32(at(AT.cameraDistance) + i * 4)])) as Record<Facing, number>;
  const times = Array.from({ length: CLOCK_STATES }, (_, i) => {
    const hour = r.i16(at(AT.clockTimes) + i * 4);
    const minute = r.i16(at(AT.clockTimes) + i * 4 + 2);
    if (hour < 0 || hour > 11 || minute < 0 || minute > 59) throw new GymFormatError(`sEternaGymClockTimes ${i}: ${hour}:${minute}`);
    return { hour, minute };
  });
  const jumps = Array.from({ length: CLOCK_STATES }, (_, i) => {
    const o = at(AT.jumps) + i * 8;
    const x = r.i16(o);
    const z = r.i16(o + 2);
    const ns = r.i32(o + 4);
    if (x === -1 && z === -1) return null;
    if (ns !== 0 && ns !== 1) throw new GymFormatError(`sEternaGymHourHandJumpTiles ${i}: axis ${ns}`);
    return { x, z, northSouth: ns === 1 };
  });
  const track = Array.from({ length: MAP_TILES * MAP_TILES }, (_, i) => {
    const v = r.u8(at(AT.track) + i);
    if (v > 5) throw new GymFormatError(`sVeilstoneTileBehaviors ${i}: ${v}`);
    return v;
  });
  const doors = (o: number) => {
    const out: HearthomeGymRoom['doors'] = [];
    for (let i = 0; ; i++) {
      const id = r.i32(at(o) + i * 8);
      if (id === DOOR_EXIT) return out;
      if (id < 0 || id > 7 || i > 7) throw new GymFormatError(`sTrainerRoomDoors at 0x${o.toString(16)}: door ${id}`);
      out.push({ door: id, x: r.i16(at(o) + i * 8 + 4), z: r.i16(at(o) + i * 8 + 6) });
    }
  };
  const rooms = Array.from({ length: HEARTHOME_ROOMS }, (_, i): HearthomeGymRoom => {
    const o = at(AT.roomLayouts) + i * LAYOUT_SIZE;
    const [header, firstDoor, doorCount, offsetX, offsetZ, width, depth] = Array.from({ length: 7 }, (_, k) => r.i32(o + k * 4)) as [number, number, number, number, number, number, number];
    const roomDoors = doors(i === 0 ? AT.room1Doors : AT.room2Doors);
    if (roomDoors.length !== doorCount) throw new GymFormatError(`room ${i}: ${roomDoors.length} doors listed, ${doorCount} in its layout`);
    return { zone: n.zone(header), firstDoor, doorCount, offsetX, offsetZ, width, depth, clueMask: bits(i === 0 ? AT.room1Clues : AT.room2Clues, width * depth, `clue mask ${i}`), doors: roomDoors };
  });
  return {
    eterna: {
      zone: n.eternaZone,
      clockVar: n.clockVar,
      message: n.fountainMessage,
      times,
      jumps,
      clock: Array.from({ length: CLOCK_STATES }, (_, i) => bits(AT.clock + i * CLOCK_TILES, CLOCK_TILES, `clock mask ${i}`)),
      fountains: Array.from({ length: CLOCK_STATES }, (_, i) => bits(AT.fountains + i * FOUNTAIN_TILES, FOUNTAIN_TILES, `fountain mask ${i}`)),
      hourRotations: Array.from({ length: 12 }, (_, i) => r.u16(at(AT.hourRotations) + i * 2)),
      hands: n.hands,
      fountain: effects?.fountain ?? null,
    },
    veilstone: { zone: n.veilstoneZone, bags: tiles(AT.bags, BAGS), stacks: tiles(AT.stacks, STACKS), track, cameraDistance, effects: effects?.veilstone ?? null },
    hearthome: { rooms, entrance: n.hearthomeEntrance, relicBadge: n.relicBadge, playerSprite: n.hearthomePlayer, effects: effects ? { symbols: effects.symbols, light: effects.light } : null, light },
    pastoria: n.pastoria,
    canalave: {
      platforms: Array.from({ length: CANALAVE_PLATFORMS }, (_, i) => {
        const o = at(AT.canalavePaths) + i * CANALAVE_PATH_SIZE;
        const model = r.i32(o);
        const axis = CANALAVE_AXIS[model];
        if (!axis) throw new GymFormatError(`sCanalavePlatformPaths ${i}: model ${model}`);
        const pos = (k: number): [number, number, number] => [r.u8(o + 4 + k), r.u8(o + 5 + k), r.u8(o + 6 + k)];
        const floorA = r.u8(o + 10);
        const floorB = r.u8(o + 11);
        if (floorA > 3 || floorB > 3) throw new GymFormatError(`sCanalavePlatformPaths ${i}: floors ${floorA}, ${floorB}`);
        return { prop: n.prop(model), axis, a: pos(0), b: pos(3), floorA, floorB };
      }),
      startInB: n.canalaveStarts,
      collision: Array.from({ length: 4 }, (_, i) => bits(AT.canalaveCollision + i * MAP_TILES * MAP_TILES, MAP_TILES * MAP_TILES, `Canalave collision ${i}`)),
      floors: n.canalaveFloors,
    },
  };
}

// ---------------------------------------------------------------- field-effect models

export interface GymEffects {
  fountain: { loop: Id; drain: Id };
  veilstone: { bag: Record<string, Id>; stack: Id; toppled: Id };
  symbols: Id[];
  /** The Hearthome light beam's model (its scroll is a texture animation on its material). */
  light: Id;
  /** The snowball's model (the object, its pattern held on the first frame) and its break (`break` clip). */
  snowball: { model: Id; break: Id };
  records: { fieldEffects: FieldEffect[]; models: Model[]; textureAnimations: TextureAnimation[] };
}

/** fldeff members (ov5_021F4018.c, veilstone_gym_object_renderer.c, ov5_021F47B0.c). */
const FLDEFF = {
  fountain: 111,
  fountainLoop: 166,
  fountainDrain: 167,
  toppled: 112,
  stack: 114,
  bag: 113,
  /** sVeilstoneGymObjectAnimationsIDs 0–7: still N, S, W, E; moving N, S, W, E. */
  bagClips: [182, 183, 184, 185, 186, 187, 188, 189],
  /** sTireStackAnimIndices: a joint clip, a material clip, a texture SRT clip and a pattern. */
  topple: { joint: 190, material: 195, srt: 196, pattern: 168 },
  /** The snowball (ov5_021F23D0.c): its model and the pattern its break plays. */
  snowball: 78,
  snowballBreak: 165,
};
const DIR_LETTERS = ['n', 's', 'w', 'e'];
const enc = new TextEncoder();

/** The frame count of a G3D animation file's first animation (NNSG3dResAnmHeader, then u16 numFrame). */
export function animationFrames(bytes: Uint8Array): number {
  const magic = new Reader(bytes).ascii(0, 4);
  const f = readNitroFile(bytes, magic);
  const b = block(f, [...f.blocks.keys()][0]!);
  const [first] = readDict(f.reader, b + 8);
  if (!first) throw new GymFormatError(`${magic}: no animation`);
  return f.reader.u16(b + f.reader.u32(first.data) + 4);
}

export function importGymEffects(fldeff: Uint8Array[], light: HearthomeLight['members'], assets: Map<string, Uint8Array>, warn: (w: string) => void): GymEffects {
  const out: GymEffects['records'] = { fieldEffects: [], models: [], textureAnimations: [] };
  const member = (i: number) => {
    const m = fldeff[i];
    if (!m) throw new GymFormatError(`fldeff: no member ${i}`);
    return m;
  };
  /** A model with its embedded textures, its joint clips and its BTP0 patterns (as `frames` texture animations). */
  const convert = (index: number, clips: { clip: string; member: number }[], patterns: number[]) => {
    const bytes = member(index);
    const [model, ...rest] = readModels(bytes);
    if (!model || rest.length) throw new GymFormatError(`fldeff ${index}: expected one model`);
    const tex0 = readTex0(bytes);
    if (!tex0) throw new GymFormatError(`fldeff ${index}: no embedded TEX0`);
    const animations = clips.map((c) => {
      const [animation, ...more] = readJointAnimations(member(c.member));
      if (!animation || more.length) throw new GymFormatError(`fldeff ${c.member}: expected one joint animation`);
      return { clip: c.clip, animation };
    });
    const res = modelToGltf(model, { embed: tex0, animations });
    res.warnings.forEach(warn);
    const dir = `models/fldeff/${index}`;
    for (const [file, png] of res.images) assets.set(`${dir}/${file}`, png);
    assets.set(`${dir}/model.gltf`, enc.encode(JSON.stringify(res.gltf)));
    const id = `platinum:MODEL_FLDEFF_${index}` as Id;
    const record: Model = { id, gltf: `platinum:${dir}/model.gltf` };
    const patternIds: { member: number; id: Id; frames: number }[] = [];
    const listed: string[] = [];
    for (const p of patterns) {
      for (const a of readPatternAnimations(member(p))) {
        for (const m of a.materials) {
          const mat = model.materials.find((x) => x.name === m.material);
          if (!mat?.texture || !mat.palette) throw new GymFormatError(`fldeff ${p}: pattern material ${m.material} has no textured material in fldeff ${index}`);
          const pid = `platinum:TEXANIM_FLDEFF_${index}_${p}_${m.material.replace(/[^A-Za-z0-9_.-]/g, '_')}` as Id;
          const frames = m.keys.map((key, k) => {
            const name = `${mat.texture}~${p}~${k}`;
            assets.set(`${dir}/${name}__${mat.palette}.png`, pair(tex0, key.texture, key.palette));
            listed.push(`${name}__${mat.palette}`);
            return { texture: name, ticks: (m.keys[k + 1]?.frame ?? a.frames) - key.frame };
          });
          out.textureAnimations.push({ id: pid, kind: 'frames', texture: mat.texture, frames });
          patternIds.push({ member: p, id: pid, frames: a.frames });
        }
      }
    }
    if (listed.length) assets.set(`${dir}/index.json`, enc.encode(JSON.stringify(listed.sort())));
    out.models.push(record);
    return { record, animations, patternIds };
  };
  const effect = (name: string, model: Id, animations?: FieldEffect['animations']) => {
    const id = `platinum:FIELD_EFFECT_${name}` as Id;
    out.fieldEffects.push({ id, name, model, ...(animations ? { animations } : {}) });
    return id;
  };

  // The fountain: one model, its loop and drain patterns as two effects (a pattern is picked per effect).
  const fountain = convert(FLDEFF.fountain, [], [FLDEFF.fountainLoop, FLDEFF.fountainDrain]);
  // Owned by the model, so the patterns never apply by texture name elsewhere.
  fountain.record.animations = fountain.patternIds.map((p) => p.id);
  const patternOf = (m: number) => {
    const p = fountain.patternIds.find((x) => x.member === m);
    if (!p) throw new GymFormatError(`fldeff ${m}: no pattern on the fountain`);
    return p;
  };
  const loop = patternOf(FLDEFF.fountainLoop);
  const drain = patternOf(FLDEFF.fountainDrain);
  const fountainEffects = {
    loop: effect('ETERNA_GYM_FOUNTAIN', fountain.record.id, { loop: { clip: loop.id, ticks: loop.frames, loop: true } }),
    drain: effect('ETERNA_GYM_FOUNTAIN_DRAIN', fountain.record.id, { drain: { clip: drain.id, ticks: drain.frames } }),
  };

  // The punching bag: one model with its eight clips; one effect per clip.
  const bagClips = FLDEFF.bagClips.map((m, i) => ({ clip: `${i < 4 ? 'still' : 'move'}-${DIR_LETTERS[i % 4]}`, member: m }));
  const bag = convert(FLDEFF.bag, bagClips, []);
  const bagEffects = Object.fromEntries(
    bag.animations.map((a) => [a.clip, effect(`VEILSTONE_GYM_BAG_${a.clip.toUpperCase().replace('-', '_')}`, bag.record.id, { [a.clip]: { clip: a.clip, ticks: a.animation.frames } })]),
  );
  const stack = convert(FLDEFF.stack, [], []);
  // The toppled stack plays four clips together and is removed when all have ended: its joint clip and its
  // pattern are drawn; the material (BMA0) and texture SRT (BTA0) clips only time it.
  const t = FLDEFF.topple;
  const toppled = convert(FLDEFF.toppled, [{ clip: 'topple', member: t.joint }], [t.pattern]);
  toppled.record.animations = toppled.patternIds.map((p) => p.id);
  const toppleTicks = Math.max(...[t.joint, t.material, t.srt, t.pattern].map((m) => animationFrames(member(m))));
  warn('Veilstone Gym toppled stack: material (BMA0 195) and texture SRT (BTA0 196) clips are timed, not drawn');

  const symbols = light.symbols.map((m, door) => effect(`HEARTHOME_GYM_CLUE_${door}`, convert(m, [], []).record.id));
  // The light beam (ov5_021F47B0.c): one model, its BTA0 a texture scroll on its one material, advanced one
  // frame a tick from the beam's creation (Simple3D_UpdateAnim … FX32_ONE). Its fog is off (NNS_G3dMdlSetMdlFogEnableFlagAll).
  const beam = convert(light.light, [], []);
  const [scroll, ...more] = readSrtAnimations(member(light.scroll));
  const m = scroll?.materials[0];
  if (!scroll || !m || more.length || scroll.materials.length !== 1) throw new GymFormatError(`fldeff ${light.scroll}: the light needs one SRT animation on one material`);
  if (m.scaleS !== 1 || m.scaleT !== 1 || m.rotation[0] !== 0 || m.rotation[1] !== 1) throw new GymFormatError(`fldeff ${light.scroll}: the light's SRT scales or rotates`);
  out.textureAnimations.push({ id: `platinum:TEXANIM_FLDEFF_${light.light}_${light.scroll}` as Id, kind: 'scroll', material: m.material, frames: scroll.frames, translateS: m.translateS, translateT: m.translateT });
  // The snowball: the object is the model at the pattern's first frame (the renderer holds it); a break plays the
  // pattern once from the impact. Two records over one glTF: the object's model owns no animation, the break's
  // owns the pattern (so it never applies to the standing balls).
  const ball = convert(FLDEFF.snowball, [], [FLDEFF.snowballBreak]);
  const shatter = ball.patternIds[0];
  if (!shatter || ball.patternIds.length !== 1) throw new GymFormatError(`fldeff ${FLDEFF.snowballBreak}: the snowball break needs one pattern`);
  const breakModel: Model = { id: `platinum:MODEL_FLDEFF_${FLDEFF.snowball}_BREAK` as Id, gltf: ball.record.gltf, animations: [shatter.id] };
  out.models.push(breakModel);
  const snowball = { model: ball.record.id, break: effect('SNOWPOINT_GYM_SNOWBALL_BREAK', breakModel.id, { break: { clip: shatter.id, ticks: shatter.frames } }) };
  return {
    snowball,
    fountain: fountainEffects,
    veilstone: { bag: bagEffects, stack: effect('VEILSTONE_GYM_TIRE_STACK', stack.record.id), toppled: effect('VEILSTONE_GYM_TIRE_STACK_TOPPLED', toppled.record.id, { topple: { clip: 'topple', ticks: toppleTicks } }) },
    symbols,
    light: beam.record.id,
    records: out,
  };
}

function pair(tex0: Tex0, texture: string, palette: string): Uint8Array {
  const t = findTexture(tex0, texture);
  return encodePng(t.width, t.height, decodeTexture(tex0, t, findPalette(tex0, palette)));
}
