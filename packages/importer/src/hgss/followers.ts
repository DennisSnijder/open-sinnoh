/**
 * The optional HeartGold/SoulSilver follower add-on (docs/research/hgss-import.md §3; docs/decisions.md):
 * from the player's own HGSS ROM, every species' follower set as a separate `hgss-followers` pack for a
 * Platinum game. The follower art and parameters are read, and HGSS's follower talk (follower-talk.ts); HGSS's maps and scripts are not.
 *
 * Inputs, all checked: the whole-ROM SHA-1 (nds `HGSS_ROMS`), three lookup tables in the decompressed ARM9
 * (by offset and SHA-1, measured on HeartGold US 1.0), the mmodel archive's 566 follower sets and their
 * frame sequence, and the 566 follower parameters. No table rows are written here.
 *
 * - Set index of a species: `sModelIndexLUT[species]`; a species with a female set (`sFemaleFlagLUT`) has
 *   it next; otherwise its forms 1…`sFormMaxLUT` follow (HGSS FollowMon_GetSpriteID). Every set is used once.
 * - A set is 8 textures (4 directions × 2 frames) in two palettes: 0 normal, 1 shiny.
 * - Its frames: the follow-mon sequence (mmodel member 292) is one loop per direction, the four directions
 *   (north, south, west, east) in equal windows of its span; within a window the two frames alternate.
 * - Size: a nonzero "too tall" byte (parameter byte 1) of the species' base set makes every set of it
 *   `large`; HGSS checks the base species entry for permission.
 * - Species identity: both games number species 1–493 by the National Pokédex, so HGSS species n is
 *   the Platinum species of that dex number (`speciesOf`); forms keep their Gen 4 values (Rotom 1–5 …).
 */
import type { BillboardSprite, FollowerSprite } from '@opensinnoh/contracts';
import { asId, type Id, type PackData, type RegistryRecord } from '@opensinnoh/core';
import { decodeTexture, encodePng, readTex0, type Tex0 } from '@opensinnoh/g3d';
import { HGSS_ROMS, NitroFs, readNarc, sha1Hex, type HashedRom, type HgssRom } from '@opensinnoh/nds';
import namesFile from '../../data/names.json' with { type: 'json' };
import { importFollowerTalk } from './follower-talk.ts';
import { importHgssPlayer } from './player.ts';

export class HgssImportError extends Error {}

/** Bump when the add-on's output changes (records, assets, layout): cached add-on imports are then redone. */
export const HGSS_FOLLOWERS_VERSION = 'hgss-followers-4';
export const HGSS_FOLLOWERS_PACK = 'hgss-followers';

const SPECIES = 493;
const SETS = 566;
/** mmodel: the follower sets and their frame sequence (BILLBOARD_SEQUENCE_FOLLOW_MON). */
const MMODEL = { path: '/a/0/8/1', first: 297, sequence: 292 };
const PARAMS = '/a/1/4/1';

/** Decompressed ARM9 tables by edition (offset, u16 count, SHA-1 of the region). SoulSilver is not measured. */
const TABLES: Record<HgssRom['edition'], { modelIndex: [number, number, string]; formMax: [number, number, string]; female: [number, number, string] } | null> = {
  heartgold: {
    modelIndex: [0xff088, SPECIES + 1, 'b0fff4bae3bcd841615513edf4a3e0771fb9b5f4'],
    formMax: [0xfe8d4, SPECIES, 'fb9b318f5706c838c4e551ac7e5351ff1127de03'],
    female: [0xfecae, SPECIES, '0cf18f786e0a80a472f5b5c81644261a026c75df'],
  },
  soulsilver: null,
};

const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;

/** One follower set before naming: species (dex number), form, female, and its set index. */
export interface HgssSet {
  species: number;
  form: number;
  female: boolean;
  set: number;
}

/** HGSS FollowMon_GetSpriteID's sets, from the three tables; every set index 0…565 exactly once. */
export function followerSets(modelIndex: readonly number[], formMax: readonly number[], female: readonly number[]): HgssSet[] {
  const out: HgssSet[] = [];
  for (let s = 1; s <= SPECIES; s++) {
    const base = modelIndex[s]!;
    if (female[s - 1]) out.push({ species: s, form: 0, female: false, set: base }, { species: s, form: 0, female: true, set: base + 1 });
    else for (let f = 0; f <= formMax[s - 1]!; f++) out.push({ species: s, form: f, female: false, set: base + f });
  }
  const seen = new Set(out.map((x) => x.set));
  if (out.length !== SETS || seen.size !== SETS || Math.min(...seen) !== 0 || Math.max(...seen) !== SETS - 1) {
    throw new HgssImportError(`follower tables give ${out.length} sets (${seen.size} distinct), expected each of 0–${SETS - 1} once`);
  }
  return out;
}

/**
 * The follow-mon sequence: `u32 count`, `u16 start[count]`, `u8 texture[count]`, `u8 palette[count]` (palette
 * 0 throughout; the shiny sequence swaps it). Returns per direction its frames with lengths in ticks.
 */
export function followerAnimations(bytes: Uint8Array): Record<(typeof DIRECTIONS)[number], { frame: number; ticks: number }[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = v.getUint32(0, true);
  if (count < 4 || bytes.length < 4 + count * 4) throw new HgssImportError(`follow-mon sequence: ${count} frames in ${bytes.length} bytes`);
  const start = Array.from({ length: count }, (_, i) => v.getUint16(4 + i * 2, true));
  const texture = Array.from({ length: count }, (_, i) => bytes[4 + count * 2 + i]!);
  const palette = Array.from({ length: count }, (_, i) => bytes[4 + count * 3 + i]!);
  if (start[0] !== 0 || start.some((s, i) => i && s <= start[i - 1]!)) throw new HgssImportError('follow-mon sequence: start frames are not increasing from 0');
  if (palette.some((p) => p !== 0) || texture.some((t) => t > 7)) throw new HgssImportError('follow-mon sequence: palette or texture out of range');
  // The span: the last frame lasts as long as the first; four equal direction windows, each starting a frame.
  const span = start[count - 1]! + start[1]!;
  const window = span / 4;
  const out = {} as Record<(typeof DIRECTIONS)[number], { frame: number; ticks: number }[]>;
  DIRECTIONS.forEach((dir, d) => {
    const from = d * window;
    if (!start.includes(from)) throw new HgssImportError(`follow-mon sequence: no frame starts the ${dir} window at ${from}`);
    out[dir] = [];
    for (let i = 0; i < count; i++) {
      const end = i + 1 < count ? start[i + 1]! : span;
      if (start[i]! >= from && end <= from + window) out[dir].push({ frame: texture[i]!, ticks: end - start[i]! });
    }
    if (out[dir].reduce((n, f) => n + f.ticks, 0) !== window) throw new HgssImportError(`follow-mon sequence: the ${dir} window is not whole frames`);
  });
  return out;
}

/** An atlas of a set's 8 textures in dictionary order (the sequence's texture indexes), in one palette. */
function atlas(tex0: Tex0, palette: number): { png: Uint8Array; size: number } {
  const size = tex0.textures[0]!.width;
  const width = size * tex0.textures.length;
  const rgba = new Uint8Array(width * size * 4);
  tex0.textures.forEach((t, slot) => {
    const px = decodeTexture(tex0, t, tex0.palettes[palette]!);
    for (let y = 0; y < size; y++) rgba.set(px.subarray(y * size * 4, (y + 1) * size * 4), (y * width + slot * size) * 4);
  });
  return { png: encodePng(width, size, rgba), size };
}

/**
 * The species translator for a Platinum base: National Pokédex number → `platinum:SPECIES_*` (Platinum's
 * species ids are their dex numbers for 1–493; the names file gives the decomp name). Nothing else maps.
 */
export function platinumSpeciesOf(dex: number): Id {
  const name = dex >= 1 && dex <= SPECIES ? (namesFile as { species: (string | null)[] }).species[dex] : null;
  if (!name?.startsWith('SPECIES_')) throw new HgssImportError(`no Platinum species for National Pokédex number ${dex}`);
  return asId(`platinum:${name}`);
}

export interface HgssFollowersResult {
  pack: PackData;
  assets: Map<string, Uint8Array>;
  rom: HgssRom;
}

/**
 * Imports the follower add-on. `speciesOf(n)` is the species translator: the Platinum species id of
 * National Pokédex number n (1–493). Throws for any ROM but the pinned editions, and on any table, set or
 * sequence that is not what was measured.
 */
export async function importHgssFollowers(
  romBytes: Uint8Array | HashedRom,
  speciesOf: (dex: number) => Id,
  onProgress: (stage: string, done: number, total: number) => void = () => {},
): Promise<HgssFollowersResult> {
  onProgress('verify', 0, 1);
  const sha1 = romBytes instanceof Uint8Array ? await sha1Hex(romBytes) : romBytes.sha1;
  const rom = HGSS_ROMS[sha1];
  if (!rom) {
    const known = Object.entries(HGSS_ROMS).map(([h, r]) => `${r.name} (SHA1 ${h})`);
    throw new HgssImportError(`Unsupported ROM: SHA1 ${sha1}. The follower add-on needs an untrimmed dump of ${known.join(' or ')}.`);
  }
  const fs = new NitroFs(romBytes);
  if (fs.header.gameCode !== rom.gameCode || fs.header.version !== rom.revision) throw new HgssImportError(`${rom.name}: header says ${fs.header.gameCode} revision ${fs.header.version}`);
  const tables = TABLES[rom.edition];
  if (!tables) throw new HgssImportError(`${rom.name}: its follower tables are not measured yet (only HeartGold's are)`);
  const arm9 = fs.arm9Code();
  const table = async ([offset, count, hash]: [number, number, string], name: string) => {
    const bytes = arm9.subarray(offset, offset + count * 2);
    const got = await sha1Hex(bytes);
    if (got !== hash) throw new HgssImportError(`${rom.name}: ARM9 table ${name} at 0x${offset.toString(16)} has SHA1 ${got}, expected ${hash}`);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: count }, (_, i) => v.getUint16(i * 2, true));
  };
  const sets = followerSets(await table(tables.modelIndex, 'sModelIndexLUT'), await table(tables.formMax, 'sFormMaxLUT'), await table(tables.female, 'sFemaleFlagLUT'));
  const mm = readNarc(fs.file(MMODEL.path));
  if (mm.length !== MMODEL.first + SETS) throw new HgssImportError(`mmodel has ${mm.length} members, expected ${MMODEL.first + SETS}`);
  const params = readNarc(fs.file(PARAMS));
  if (params.length !== SETS || params.some((p) => p.length !== 4)) throw new HgssImportError(`follower parameters: ${params.length} members, expected ${SETS} of 4 bytes`);
  const frames = followerAnimations(mm[MMODEL.sequence]!);
  const animations: BillboardSprite['animations'] = {};
  for (const dir of DIRECTIONS) animations[`stand-${dir}`] = animations[`walk-${dir}`] = frames[dir];

  const ns = HGSS_FOLLOWERS_PACK;
  const assets = new Map<string, Uint8Array>();
  const sprites: BillboardSprite[] = [];
  for (let s = 0; s < SETS; s++) {
    onProgress('followers', s, SETS);
    const tex0 = readTex0(mm[MMODEL.first + s]!);
    if (!tex0) throw new HgssImportError(`mmodel ${MMODEL.first + s}: no TEX0`);
    const size = tex0.textures[0]!.width;
    if (tex0.textures.length !== 8 || tex0.palettes.length !== 2 || (size !== 32 && size !== 64) || tex0.textures.some((t) => t.width !== size || t.height !== size)) {
      throw new HgssImportError(`follower set ${s}: ${tex0.textures.length} textures, ${tex0.palettes.length} palettes, ${size} px`);
    }
    const tall = params[s]![1] !== 0;
    if (tall !== (size === 64)) throw new HgssImportError(`follower set ${s}: ${size} px but too-tall ${params[s]![1]}`);
    for (const [palette, suffix] of [[0, ''], [1, '_SHINY']] as const) {
      const a = atlas(tex0, palette);
      const path = `followers/${s}${suffix.toLowerCase()}.png`;
      assets.set(path, a.png);
      sprites.push({ id: asId(`${ns}:SPRITE_FOLLOWER_${s}${suffix}`), sourceIndex: MMODEL.first + s, atlas: asId(`${ns}:${path}`), frameSize: size, frameCount: 8, animations });
    }
  }
  onProgress('followers', SETS, SETS);
  const baseSet = new Map(sets.filter((x) => x.form === 0 && !x.female).map((x) => [x.species, x.set]));
  const followers: FollowerSprite[] = sets.map((x) => {
    const species = speciesOf(x.species);
    const name = species.slice(species.indexOf(':') + 1).replace(/^SPECIES_/, '');
    return {
      id: asId(`${ns}:FOLLOWER_${name}${x.form ? `_FORM_${x.form}` : ''}${x.female ? '_FEMALE' : ''}`),
      species,
      form: x.form,
      ...(x.female ? { gender: 'female' as const } : {}),
      sprite: asId(`${ns}:SPRITE_FOLLOWER_${x.set}`),
      shiny: asId(`${ns}:SPRITE_FOLLOWER_${x.set}_SHINY`),
      size: params[baseSet.get(x.species)!]![1] !== 0 ? 'large' : 'small',
      animation: 'loop',
    };
  });
  // HGSS's follower talk (follower-talk.ts): its rules, interactions, messages and emote bubbles.
  const talk = importFollowerTalk(fs, ns);
  for (const [path, png] of talk.assets) assets.set(path, png);
  sprites.push(...talk.sprites);
  // The HGSS player sprites (player.ts): DeviceOptions.character.
  const player = await importHgssPlayer(fs, ns);
  for (const [path, png] of player.assets) assets.set(path, png);
  sprites.push(...player.sprites);
  const pack: PackData = {
    manifest: { id: ns, name: `Following Pokémon from ${rom.name} (imported from your ROM)`, version: '1.0.0', engine: '^0.1.0', dependencies: { platinum: '*' }, loadAfter: [], cosmetic: true },
    registries: { sprites: sprites as unknown as RegistryRecord[], followers: followers as unknown as RegistryRecord[], followerTalk: [talk.record] as unknown as RegistryRecord[] },
    scripts: { labels: {} },
    patches: [],
    remove: [],
    provenance: 'rom-derived',
  };
  return { pack, assets, rom };
}
