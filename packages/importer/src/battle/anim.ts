/**
 * The battle animation import (docs/research/move-animations.md): the move and common animation
 * scripts, the particle system files with their textures, and the VM's position and axis tables.
 * - `wazaeffect/we.arc`: member n is move n's script (0 = `none`; members 468–500 are unused test scripts).
 * - `wazaeffect/we_sub.narc`: the 50 common animations in decomp BATTLE_ANIMATION_* order.
 * - `wazaeffect/effectdata/waza_particle.narc`: the 485 SPA files scripts load by member number.
 * - `wazaeffect/effectdata/ball_particle.narc`: the send-out effect's SPAs (docs/research/seals.md §6.1): members
 *   1–17 and 36 the balls' default bursts, 37–116 the seals; records `archive: 'ball'`, sheets `battle/ball_particles/<n>`.
 * - `particledata/pl_frontier/frontier_particle.narc`: the Battle Frontier scenes' SPAs (decomp frontier_particles.order:
 *   the Hall, the Arcade's two, the Factory, the Castle); records `archive: 'frontier'`, sheets `frontier/particles/<n>`.
 * - overlay 12 rodata: BattleAnimUtil_GetBattlerTypeWorldPosInternal's position table and the generic
 *   emitter callback's EmitterAxisConfigs1–8, each checked by SHA-1.
 * Scripts stay words (records); the battle package's VM runs them. Textures become one `ui2d` sheet per
 * particle file (`battle/particles/<n>`, cell n = texture n) through the shared 2D encoder.
 */
import { placeTables, type Layout } from '../layout.ts';
import { animSpriteKey, scriptUse, type AnimSpriteResource, type BattleAnimation, type BattleAnimData, type ParticleSystem } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import { readNarc, sha1Hex, type NitroFs } from '@opensinnoh/nds';
import type { Sheets } from '../ui2d/sheets.ts';
import { PaletteRam, readNclr, readNcgr, readNscr, renderScreen } from '../ui2d/nitro2d.ts';
import { readSpa, spaTexture, spaTextureParam } from './spa.ts';

const MOVE_ANIMS = '/wazaeffect/we.arc';
const COMMON_ANIMS = '/wazaeffect/we_sub.narc';
const PARTICLES = '/wazaeffect/effectdata/waza_particle.narc';
const BALL_PARTICLES = '/wazaeffect/effectdata/ball_particle.narc';
const FRONTIER_PARTICLES = '/particledata/pl_frontier/frontier_particle.narc';
/** The ball_particle.narc members the send-out effect loads: the default bursts (ballOpenParticles) and the seals. */
export const SEND_OUT_PARTICLES = [...Array.from({ length: 17 }, (_, i) => i + 1), ...Array.from({ length: 81 }, (_, i) => i + 36)];
/** we.arc members that are move scripts: `none` and moves 1–467 (decomp NUM_VALID_MOVES). */
const MOVE_SCRIPTS = 468;
/** Decomp res/battle/scripts/common_anims, in archive order. */
export const COMMON_ANIM_NAMES = [
  'dummy00',
  'sleep',
  'poison',
  'burn',
  'freeze',
  'paralysis',
  'confusion',
  'infatuation',
  'level_up',
  'bag_item_use',
  'held_item_use',
  'shiny',
  'stat_boost',
  'stat_drop',
  'restore_hp',
  'sub_out',
  'sub_in',
  'escape_item',
  'weather_fog',
  'weather_rain',
  'weather_hail',
  'weather_sandstorm',
  'weather_sun',
  'dummy23',
  'dummy24',
  'substitute_in',
  'substitute_out',
  'happy',
  'eating',
  'angry',
  'damage_curse',
  'damage_nightmare',
  'damage_leech_seed',
  'damage_bind',
  'damage_wrap',
  'damage_fire_spin',
  'damage_magma_storm',
  'damage_clamp',
  'damage_whirlpool',
  'damage_sand_tomb',
  'damage_ingrain',
  'dummy41',
  'dummy42',
  'dummy43',
  'dummy44',
  'dummy45',
  'dummy46',
  'dummy47',
  'dummy48',
  'dummy49',
];

/** Overlay 12 rodata (battle_anim_util.c, generic_emitter_callback.c). */
const TABLES = {
  /** [8 battler types (6 + contest player, enemy)][12 position types × 2 projections] VecFx32. */
  positions: {
    overlay: 12,
    offset: 0x1a640,
    size: 8 * 24 * 12,
    sha1: '96f4facda81df99113442719b639870d8f7d541c',
  },
  /** EmitterAxisConfigs 2, 3, 6, 4, 1, 5, 7, 8 back to back, each [6][6] VecFx32. */
  axes: {
    overlay: 12,
    offset: 0x193cc,
    size: 8 * 36 * 12,
    sha1: '9b4f6412313b30a035c418bdc5152130e5457394',
  },
  /** sBgNarcIndices (battle_anim_system.c): per switched background (58) its pl_batt_bg members NCGR, NCLR, NSCR (player's side), NSCR (mirrored), NSCR (contest). */
  /** sStatChangeNarcMemberTable (script_funcs_stat_change.c): up, down, heal, metal: pl_batt_bg NCGR, NCLR, NSCR, NSCR. */
  statChange: {
    overlay: 12,
    offset: 0x1a5b8,
    size: 4 * 4 * 4,
    sha1: 'bac09b93b56e88ebdff63a1011cc85acbf917fcd',
  },
  backgrounds: {
    overlay: 12,
    offset: 0x18d08,
    size: 58 * 5 * 4,
    sha1: 'b20b7ba18c9c8bfd0e0d6b08acbaf600af9fd256',
  },
} as const;
/** The US layout of these tables (tools/relocate.ts finds them in other builds). */
export { TABLES as ANIM_TABLES };
const BATT_BG = '/battle/graphic/pl_batt_bg.narc';
/** BATTLE_BG_PALETTE_EFFECT: the palette slot a switched background's NCLR is loaded into (its tilemaps name it). */
const EFFECT_PALETTE = 9;
/** BATTLE_BG_PALETTE_MON_SPRITE: the stat change pattern's palette slot. */
const STAT_CHANGE_PALETTE = 8;
/** The rodata order of the axis tables (config numbers). */
const AXIS_ORDER = [2, 3, 6, 4, 1, 5, 7, 8];

export interface AnimImport {
  battleAnimations: BattleAnimation[];
  particleSystems: ParticleSystem[];
  battleAnimData: BattleAnimData[];
}

/** `moveIds[n]`: the id of move n (from the move records' `sourceIndex`). */
export async function importBattleAnims(fs: NitroFs, layout: Layout, moveIds: Map<number, Id>, sheets: Sheets): Promise<AnimImport> {
  const tables = placeTables(TABLES, layout, 'anim');
  const words = (b: Uint8Array, what: string): number[] => {
    if (b.length % 4) throw new Error(`${what}: ${b.length} bytes is not whole words`);
    const dv = new DataView(b.buffer, b.byteOffset, b.length);
    return Array.from({ length: b.length / 4 }, (_, i) => dv.getInt32(i * 4, true));
  };
  const moves = readNarc(fs.file(MOVE_ANIMS));
  if (moves.length < MOVE_SCRIPTS) throw new Error(`${MOVE_ANIMS}: ${moves.length} members, expected at least ${MOVE_SCRIPTS}`);
  const common = readNarc(fs.file(COMMON_ANIMS));
  if (common.length !== COMMON_ANIM_NAMES.length) throw new Error(`${COMMON_ANIMS}: ${common.length} members, expected ${COMMON_ANIM_NAMES.length}`);
  const battleAnimations: BattleAnimation[] = [
    ...moves.slice(0, MOVE_SCRIPTS).map((m, n): BattleAnimation => {
      const move = moveIds.get(n);
      if (n && !move) throw new Error(`${MOVE_ANIMS}: member ${n} has no move record`);
      return {
        id: asId(`platinum:battle_anim/move/${n}`),
        ...(move ? { move } : {}),
        sourceIndex: n,
        code: words(m, `${MOVE_ANIMS} member ${n}`),
      };
    }),
    ...common.map((m, n): BattleAnimation => ({
      id: asId(`platinum:battle_anim/common/${COMMON_ANIM_NAMES[n]}`),
      common: COMMON_ANIM_NAMES[n]!,
      sourceIndex: n,
      code: words(m, `${COMMON_ANIMS} member ${n}`),
    })),
  ];

  // The shared instruction walk includes every battle branch and subroutine. Compose only the resource
  // combinations scripts actually request, retaining NANR sequences and NCER origins in the shared sheets.
  const resources = new Map<string, AnimSpriteResource>();
  for (const a of battleAnimations) if (a.code.length) {
    for (const friendly of [false, true]) for (const [key, r] of scriptUse(a.code, friendly).spriteResources) resources.set(key, r);
  }
  const archives = ['wechar', 'wepltt', 'wecell', 'wecellanm'].map((name) => readNarc(fs.file(`/wazaeffect/effectclact/${name}.narc`)));
  for (const r of resources.values()) {
    const members = [r.chars, r.palette, r.cells, r.animation].map((n, i) => {
      const bytes = archives[i]![n];
      if (!bytes) throw new Error(`battle OBJ: missing resource ${i}:${n}`);
      return bytes;
    });
    sheets.obj(`battle/objects/${animSpriteKey(r)}`, members, { ncgr: 0, nclr: 1, ncer: 2, nanr: 3, palette: 0 });
  }

  const particleSystem = (path: string, bytes: Uint8Array, n: number, archive?: 'ball' | 'frontier'): ParticleSystem => {
    const name = archive === 'ball' ? 'ball_particles' : archive === 'frontier' ? 'frontier_particles' : 'particles';
    try {
      const spa = readSpa(bytes);
      const textures = sheets.add(
        archive === 'frontier' ? `frontier/particles/${n}` : `battle/${name}/${n}`,
        spa.textures.map((_, t) => ({
          ...spaTexture(spa, t),
          originX: 0,
          originY: 0,
        })),
      );
      return {
        id: asId(`platinum:${name}/${n}`),
        sourceIndex: n,
        ...(archive ? { archive } : {}),
        textures,
        textureParams: spa.textures.map((_, t) => spaTextureParam(spa, t)),
        emitters: spa.emitters,
      };
    } catch (e) {
      throw new Error(`${path} member ${n}: ${(e as Error).message}`, { cause: e });
    }
  };
  const ballNarc = readNarc(fs.file(BALL_PARTICLES));
  const particleSystems = [
    ...readNarc(fs.file(PARTICLES)).map((bytes, n) => particleSystem(PARTICLES, bytes, n)),
    ...SEND_OUT_PARTICLES.map((n) => {
      const bytes = ballNarc[n];
      if (!bytes) throw new Error(`${BALL_PARTICLES}: no member ${n}`);
      return particleSystem(BALL_PARTICLES, bytes, n, 'ball');
    }),
    ...readNarc(fs.file(FRONTIER_PARTICLES)).map((bytes, n) => particleSystem(FRONTIER_PARTICLES, bytes, n, 'frontier')),
  ];

  const table = async (key: keyof typeof TABLES): Promise<Int32Array> => {
    const t = tables[key];
    const bytes = fs.overlay(t.overlay).subarray(t.offset, t.offset + t.size);
    const got = await sha1Hex(bytes);
    if (got !== t.sha1) throw new Error(`ROM table ${key} at ${t.overlay}:0x${t.offset.toString(16)} has SHA1 ${got}, expected ${t.sha1}`);
    return new Int32Array(bytes.slice().buffer);
  };
  const vec = (a: Int32Array, i: number): [number, number, number] => [a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!];
  const pos = await table('positions');
  const positions = Array.from({ length: 8 }, (_, type) => Array.from({ length: 12 }, (_, kind) => [vec(pos, type * 24 + kind * 2), vec(pos, type * 24 + kind * 2 + 1)]));
  const ax = await table('axes');
  const axes = Array.from({ length: 8 }, (_, c) => {
    const at = AXIS_ORDER.indexOf(c + 1);
    return Array.from({ length: 6 }, (_, from) => Array.from({ length: 6 }, (_, to) => vec(ax, at * 36 + from * 6 + to)));
  });
  // The switched backgrounds (BattleBgSwitch_SetBg): 4bpp tiles, one palette into slot 9, a 256 or 512 px wide
  // tilemap; one sheet per distinct member set, cell 0 as drawn for the player's side, cell 1 mirrored and cell 2 the
  // contest's screen (BG_NARC_MEMBER_NSCR3).
  const bgTable = await table('backgrounds');
  const bg = readNarc(fs.file(BATT_BG));
  const bgSheets = new Map<string, Id>();
  const backgrounds = Array.from({ length: 58 }, (_, i) => {
    const [ncgr, nclr, nscr1, nscr2, nscr3] = [0, 1, 2, 3, 4].map((k) => bgTable[i * 5 + k]!);
    const key = `${ncgr}/${nclr}/${nscr1}/${nscr2}/${nscr3}`;
    const known = bgSheets.get(key);
    if (known) return known;
    const member = (m: number) => {
      const b = bg[m!];
      if (!b) throw new Error(`${BATT_BG}: no member ${m} (switched background ${i})`);
      return b;
    };
    const chars = readNcgr(member(ncgr!));
    const ram = new PaletteRam().load(readNclr(member(nclr!)), EFFECT_PALETTE * 32, 32);
    const cells = [nscr1!, nscr2!, nscr3!].map((m) => {
      const screen = readNscr(member(m));
      return { width: screen.width, height: screen.height, rgba: renderScreen(screen, chars, ram), originX: 0, originY: 0 };
    });
    const id = sheets.add(`battle/anim_backgrounds/${bgSheets.size}`, cells);
    bgSheets.set(key, id);
    return id;
  });
  // The stat change patterns: palette slot 8 (BATTLE_BG_PALETTE_MON_SPRITE), tiled under a battler's silhouette.
  const scTable = await table('statChange');
  const statChange = Array.from({ length: 4 }, (_, i) => {
    const [ncgr, nclr, nscr] = [0, 1, 2].map((k) => scTable[i * 4 + k]!);
    const member = (m: number) => {
      const b = bg[m];
      if (!b) throw new Error(`${BATT_BG}: no member ${m} (stat change pattern ${i})`);
      return b;
    };
    const screen = readNscr(member(nscr!));
    const ram = new PaletteRam().load(readNclr(member(nclr!)), STAT_CHANGE_PALETTE * 32, 32);
    return sheets.add(`battle/stat_change/${i}`, [{ width: screen.width, height: screen.height, rgba: renderScreen(screen, readNcgr(member(ncgr!)), ram), originX: 0, originY: 0 }]);
  });
  return {
    battleAnimations,
    particleSystems,
    battleAnimData: [{ id: asId('platinum:battle_anim_data'), positions, axes, backgrounds, statChange }],
  };
}
