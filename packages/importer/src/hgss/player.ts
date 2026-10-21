/**
 * HGSS playable characters for the follower add-on (docs/decisions.md: "HGSS playable characters, the player's
 * overworld sprite set from the player's own HGSS ROM"): Ethan's and Lyra's walking-and-running sets and their bicycle
 * sets, as billboard sprites (`HGSS_PLAYER_SPRITES`, contracts). The other player looks (Surf, fishing, the HM and
 * healing poses …) stay Platinum's: the world falls back per missing piece.
 *
 * Read from the ROM, all checked: the mmodel textures (MMODEL_HERO 69, HEROINE 70, CYCLEHERO 71, CYCLEHEROINE 72), their
 * frame sequences (gObjectEventGraphicsInfos → gSpriteBillboardInfos → gBillboardSequenceNarcMembers: members 281 and
 * 282) and their animation tables in overlay 1 (`{start, end, type}` until type 2, at the RAM addresses the decomp
 * names, by SHA-1). The tables have Platinum's layout: four walks and four runs; the bicycle's four walks and six poses
 * (wheelie and jump), Platinum's `bike` frame sequence, so `frameTableAnimations` names them as Platinum's.
 */
import { HGSS_PLAYER_SPRITES, type BillboardSprite } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { buildSpriteAtlas, encodePng, readFrameSequence, readTex0 } from '@opensinnoh/g3d';
import { readNarc, Reader, sha1Hex, type NitroFs } from '@opensinnoh/nds';
import type { BillboardAnim } from '../assets/object-gfx.ts';
import { FRAME_SEQ_NAMES, frameTableAnimations } from '../assets/poses.ts';
import { HgssImportError } from './followers.ts';

const MMODEL = '/a/0/8/1';
/** Overlay 1's animation tables: the walk-and-run set's and the bicycle's (RAM address, bytes, SHA-1). */
const TABLES = {
  walk: { ram: 0x0220715c, size: 9 * 12, sha1: '12afbf39d6be3ae87d5ce96de66daad9ee7be66f' },
  cycle: { ram: 0x022071c8, size: 11 * 12, sha1: 'd107459dc873dc289e22cfbfddcbbdf19129e56e' },
};
const SETS = [
  { id: HGSS_PLAYER_SPRITES.walk.male, member: 69, sequence: 281, table: 'walk', walkRun: true },
  { id: HGSS_PLAYER_SPRITES.walk.female, member: 70, sequence: 281, table: 'walk', walkRun: true },
  { id: HGSS_PLAYER_SPRITES.cycle.male, member: 71, sequence: 282, table: 'cycle', walkRun: false },
  { id: HGSS_PLAYER_SPRITES.cycle.female, member: 72, sequence: 282, table: 'cycle', walkRun: false },
] as const;

function anims(bytes: Uint8Array, what: string): BillboardAnim[] {
  const r = new Reader(bytes);
  const out: BillboardAnim[] = [];
  for (let o = 0; ; o += 12) {
    const type = r.u32(o + 8);
    if (type === 2) {
      if (o + 12 !== bytes.length) throw new HgssImportError(`${what}: the table ends before its last entry`);
      return out;
    }
    if (type !== 0 && type !== 1) throw new HgssImportError(`${what}: animation type ${type}`);
    out.push({ start: r.u32(o), end: r.u32(o + 4), loop: type === 0 });
  }
}

export async function importHgssPlayer(fs: NitroFs, ns: string): Promise<{ sprites: BillboardSprite[]; assets: Map<string, Uint8Array> }> {
  const entry = fs.overlays().find((o) => o.id === 1);
  if (!entry) throw new HgssImportError('no overlay 1');
  const ov = fs.overlayCode(1);
  const tables: Record<string, BillboardAnim[]> = {};
  for (const [name, t] of Object.entries(TABLES)) {
    const at = t.ram - entry.ramAddress;
    const bytes = ov.subarray(at, at + t.size);
    const got = await sha1Hex(bytes);
    if (got !== t.sha1) throw new HgssImportError(`overlay 1 ${name} animation table at 0x${t.ram.toString(16)} has SHA1 ${got}, expected ${t.sha1}`);
    tables[name] = anims(bytes, `the ${name} animation table`);
  }
  const mm = readNarc(fs.file(MMODEL));
  const sprites: BillboardSprite[] = [];
  const assets = new Map<string, Uint8Array>();
  for (const s of SETS) {
    const tex0 = readTex0(mm[s.member]!);
    if (!tex0 || tex0.textures.some((t) => t.width !== 32 || t.height !== 32)) throw new HgssImportError(`mmodel ${s.member}: not a 32×32 character set`);
    const atlas = buildSpriteAtlas(tex0);
    const animations = frameTableAnimations(readFrameSequence(mm[s.sequence]!), FRAME_SEQ_NAMES.indexOf(s.walkRun ? 'walk-and-run' : 'bike'), atlas, tables[s.table]!);
    const path = `player/${s.member}.png`;
    assets.set(path, encodePng(atlas.width, atlas.frameSize, atlas.rgba));
    sprites.push({ id: asId(s.id), sourceIndex: s.member, atlas: asId(`${ns}:${path}`), frameSize: atlas.frameSize, frameCount: atlas.frameCount, animations });
  }
  return { sprites, assets };
}
