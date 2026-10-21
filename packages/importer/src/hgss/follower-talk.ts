/**
 * HGSS's follower talk for the follower add-on (docs/decisions.md: "follower talk, per HGSS's behaviour where
 * it can be reasonably mapped"; docs/research/hgss-import.md §3 "Talk pipeline"). From the player's HGSS ROM:
 *
 * - the global rules (/a/2/2/0 member 0: 70 rules of 20 bytes, HGSS's slots 30–99, scanned in this order); the
 *   map-section members (1…) are Johto's and Kanto's places and are not read;
 * - the interactions those rules name (/a/2/2/1, 52 bytes: five 8-byte steps and a 12-byte trailer), their motions
 *   (/a/2/2/2, ten 8-byte frames), and the messages they print (bank 265 of /a/0/2/7);
 * - the 14 emote bubbles (field effects /a/1/0/3: textures 2–15, two 32×32 frames each, and their frame sequence
 *   0x96, read as EmoteBubbleAnim reads it: the start values as each step's ticks).
 *
 * Everything a global rule or interaction uses is checked to be what the game can evaluate: rules use only HP,
 * status, friendship, mood, type, the tile behaviour (only 2 tall grass, 22 puddle and 23 shallow water, numbered
 * alike in Platinum), hidden items and facing; no flag, map, nature, Pokéathlon, Shiny Leaf, question or gift; a step's
 * sound is a cry (SEQ_SE_END + 1 plain, + 2 the Pokédex cry). Anything else fails the import loudly.
 */
import type { BillboardSprite, FollowerTalk, Facing } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import { decodeTexture, encodePng, readTex0 } from '@opensinnoh/g3d';
import { decodeMessageBank, readNarc, type NitroFs } from '@opensinnoh/nds';
import charmapFile from '../../data/charmap.json' with { type: 'json' };
import { decodeText } from '../formats/text.ts';
import { charTable, type CharmapFile } from '../names.ts';
import { HgssImportError } from './followers.ts';

const RULES = { path: '/a/2/2/0', global: 0, count: 70, size: 20 };
const INTERACTIONS = { path: '/a/2/2/1', size: 52 };
const MOTIONS = { path: '/a/2/2/2', size: 80 };
const MESSAGES = { path: '/a/0/2/7', bank: 265 };
const EMOTES = { path: '/a/1/0/3', texture: 2, sequence: 0x96, count: 14 };
/** HGSS SEQ_SE_END: a step sound above it is the follower's cry (FollowMonMovement_PlaySound). */
const SEQ_SE_END = 2378;
/** The tile behaviours a rule may name: TALL_GRASS, PUDDLE, SHALLOW_WATER (the same numbers in both games). */
const BEHAVIOURS = new Set([2, 22, 23]);
/** Gen 4 DIR_NORTH 0, SOUTH 1, WEST 2, EAST 3. */
const DIRS: Facing[] = ['up', 'down', 'left', 'right'];

export function importFollowerTalk(fs: NitroFs, ns: string): { record: FollowerTalk; sprites: BillboardSprite[]; assets: Map<string, Uint8Array> } {
  const rulesNarc = readNarc(fs.file(RULES.path));
  const g = rulesNarc[RULES.global]!;
  if (g.length !== RULES.count * RULES.size) throw new HgssImportError(`follower talk: the global rules are ${g.length} bytes, expected ${RULES.count * RULES.size}`);
  const rules: FollowerTalk['rules'] = [];
  for (let i = 0; i < RULES.count; i++) {
    const b = g.subarray(i * RULES.size, (i + 1) * RULES.size);
    const v = new DataView(b.buffer, b.byteOffset, RULES.size);
    const w8 = v.getUint16(8, true);
    const w10 = v.getUint16(10, true);
    const unsupported = {
      nature: b[2]! & 7, gender: (b[2]! >> 3) & 3, item: b[3]! & 31, pokeathlon: b[4]! >> 5, encounterTile: b[5]!, speciesAttr: b[6]!, shinyLeaf: b[7]!,
      weather: w8 & 7, nearbyObjects: w10 & 7, time: (w10 >> 3) & 7, map: v.getUint16(12, true), level: (b[16]! >> 1) & 3, rock: (b[16]! >> 3) & 3, flag: v.getUint16(18, true),
    };
    const used = Object.entries(unsupported).filter(([, x]) => x !== 0);
    if (used.length) throw new HgssImportError(`follower talk: global rule ${i} uses ${used.map(([k]) => k).join(', ')}, which the game does not evaluate`);
    const behavior = v.getUint16(14, true);
    if (behavior && !BEHAVIOURS.has(behavior)) throw new HgssImportError(`follower talk: global rule ${i} names tile behaviour ${behavior}, not one numbered alike in Platinum`);
    const interaction = w10 >> 6;
    if (!interaction) continue;
    rules.push({ interaction, chance: b[17]!, hp: b[0]!, status: b[2]! >> 5, friendship: b[1]! >> 4, mood: b[1]! & 15, type: b[4]! & 31, behavior, hiddenItems: b[16]! >> 5, facing: w8 >> 13 });
  }

  const interactionNarc = readNarc(fs.file(INTERACTIONS.path));
  const motionNarc = readNarc(fs.file(MOTIONS.path));
  const interactions: FollowerTalk['interactions'] = [];
  const motionIds = new Set<number>();
  const messageIds = new Set<number>();
  for (const id of [...new Set(rules.map((r) => r.interaction))].sort((a, b) => a - b)) {
    const b = interactionNarc[id - 1];
    if (b?.length !== INTERACTIONS.size) throw new HgssImportError(`follower talk: interaction ${id} is ${b?.length} bytes, expected ${INTERACTIONS.size}`);
    const v = new DataView(b.buffer, b.byteOffset, b.length);
    if (v.getUint32(40, true) || v.getUint16(44, true) || v.getUint16(46, true) || b[50] || b[51]) throw new HgssImportError(`follower talk: interaction ${id} asks a question or gives a gift`);
    const steps: FollowerTalk['interactions'][number]['steps'] = [];
    for (let s = 0; s < 5; s++) {
      const motion = v.getUint16(s * 8, true);
      if (motion === 0xffff) break;
      const message = v.getUint16(s * 8 + 2, true);
      const sound = v.getUint16(s * 8 + 4, true);
      const emote = b[s * 8 + 6]!;
      if (sound !== 0 && sound !== SEQ_SE_END + 1 && sound !== SEQ_SE_END + 2) throw new HgssImportError(`follower talk: interaction ${id} plays sound ${sound}, not a cry`);
      if (emote > EMOTES.count) throw new HgssImportError(`follower talk: interaction ${id} shows emote ${emote}`);
      if (motion) motionIds.add(motion);
      if (message) messageIds.add(message - 1);
      steps.push({ motion, emote, message, cry: sound === 0 ? 0 : sound === SEQ_SE_END + 1 ? 1 : 2, wait: b[s * 8 + 7]! });
    }
    interactions.push({ id, steps, mood: v.getInt8(49) });
  }

  const motions: FollowerTalk['motions'] = [...motionIds].sort((a, b) => a - b).map((id) => {
    const b = motionNarc[id - 1];
    if (b?.length !== MOTIONS.size) throw new HgssImportError(`follower talk: motion ${id} is ${b?.length} bytes, expected ${MOTIONS.size}`);
    const v = new DataView(b.buffer, b.byteOffset, b.length);
    const frames: FollowerTalk['motions'][number]['frames'] = [];
    for (let f = 0; f < 10 && b[f * 8] !== 0xff; f++) {
      const facing = b[f * 8]!;
      if (facing > DIRS.length) throw new HgssImportError(`follower talk: motion ${id} frame ${f} faces ${facing}`);
      frames.push({ facing: facing ? DIRS[facing - 1]! : null, ticks: b[f * 8 + 1]!, dx: v.getInt8(f * 8 + 2), dy: v.getInt8(f * 8 + 3), dz: v.getInt8(f * 8 + 4), sound: b[f * 8 + 5] !== 0 });
    }
    return { id, frames };
  });

  const chars = charTable(charmapFile as CharmapFile);
  const bank = decodeMessageBank(readNarc(fs.file(MESSAGES.path))[MESSAGES.bank]!);
  const messages = [...messageIds].sort((a, b) => a - b).map((id) => {
    const codes = bank[id];
    if (!codes) throw new HgssImportError(`follower talk: bank ${MESSAGES.bank} has no message ${id}`);
    return { id: id + 1, text: decodeText(codes, chars) };
  });

  const eff = readNarc(fs.file(EMOTES.path));
  const seq = eff[EMOTES.sequence]!;
  const sv = new DataView(seq.buffer, seq.byteOffset, seq.length);
  const n = sv.getUint32(0, true);
  if (seq.length < 4 + n * 4) throw new HgssImportError(`emote sequence: ${n} steps in ${seq.length} bytes`);
  const emoteFrames = Array.from({ length: n }, (_, i) => ({ frame: seq[4 + n * 2 + i]!, ticks: sv.getUint16(4 + i * 2, true) }));
  const assets = new Map<string, Uint8Array>();
  const sprites: BillboardSprite[] = [];
  const still = Object.fromEntries(DIRS.flatMap((d) => [`stand-${d}`, `walk-${d}`].map((k) => [k, [{ frame: 0, ticks: 1 }]])));
  for (let k = 0; k < EMOTES.count; k++) {
    // Every bubble runs the same sequence (each of 0x96… is identical: checked).
    if (eff[EMOTES.sequence + k]!.some((x, i) => x !== seq[i])) throw new HgssImportError(`emote ${k}: its sequence differs from the first`);
    const tex0 = readTex0(eff[EMOTES.texture + k]!);
    if (!tex0 || tex0.textures.length !== 2 || tex0.textures.some((t) => t.width !== 32 || t.height !== 32)) throw new HgssImportError(`emote ${k}: not two 32×32 textures`);
    const rgba = new Uint8Array(64 * 32 * 4);
    tex0.textures.forEach((t, slot) => {
      const px = decodeTexture(tex0, t, tex0.palettes[0]!);
      for (let y = 0; y < 32; y++) rgba.set(px.subarray(y * 32 * 4, (y + 1) * 32 * 4), (y * 64 + slot * 32) * 4);
    });
    const path = `talk/emote_${k}.png`;
    assets.set(path, encodePng(64, 32, rgba));
    sprites.push({ id: asId(`${ns}:SPRITE_EMOTE_${k}`), sourceIndex: EMOTES.texture + k, atlas: asId(`${ns}:${path}`), frameSize: 32, frameCount: 2, animations: still });
  }
  if (emoteFrames.some((f) => f.frame > 1)) throw new HgssImportError('emote sequence: a frame past the two textures');
  const record: FollowerTalk = { id: asId(`${ns}:FOLLOWER_TALK`), rules, interactions, motions, messages, emotes: sprites.map((s) => s.id as Id), emoteFrames };
  return { record, sprites, assets };
}
