/**
 * Pokémon pictures (decomp pokemon.c BuildPokemonSpriteTemplate, LoadPokemonSpriteYOffset,
 * pokemon_icon.c): battle front/back pictures per form, gender and palette, the ground offsets, the
 * frame tables (pl_poke_data) and the party/box icons. One `pokemonSprites` record per species.
 *
 * Pack paths: `pokemon/<species>[-<form>].png` and `-shiny.png` (160 px wide, a row of two 80×80
 * frames per face: front, back, then front-female, back-female where they exist), `-icon.png` (32×64).
 */
import type { PokemonSpriteAnim, PokemonSpriteForm, PokemonSprites } from '@opensinnoh/contracts';
import { asId, type Id } from '@opensinnoh/core';
import { readNarc, Reader, type NitroFs } from '@opensinnoh/nds';
import { charactersOf, readNclr, readNcgrData, rgb555 } from './nitro2d.ts';
import { IndexedPng } from './png.ts';
import { MON_HEIGHT, MON_WIDTH, readMonPicture } from './pokegra.ts';

const NARCS = {
  pokegra: { path: '/poketool/pokegra/pl_pokegra.narc', count: 2964 },
  otherpoke: { path: '/poketool/pokegra/pl_otherpoke.narc', count: 253 },
  height: { path: '/poketool/pokegra/height.narc', count: 1976 },
  heightO: { path: '/poketool/pokegra/height_o.narc', count: 156 },
  pokeData: { path: '/poketool/poke_edit/pl_poke_data.narc', count: 1 },
  icons: { path: '/poketool/icongra/pl_poke_icon.narc', count: 547 },
} as const;

/** decomp FACE_BACK / FACE_FRONT. */
const BACK = 0;
const FRONT = 2;
const NATIONAL_DEX_COUNT = 493;
export const SPECIES_EGG = 494;
const UNOWN_SPECIES = 201;
/** sizeof(SpeciesSpriteData): two faces of (cry delay, animation, start delay, 10 × {s8 frame, u8 ticks, s8 dx, s8 dy}), then s8 yOffset, s8 shadow x, u8 shadow size. */
const SPRITE_DATA_SIZE = 89;
/** pl_poke_icon: member 0 the palettes, 7 + icon index the characters (pokemon_icon.c IconTilesIndex). */
const ICON_PALETTES = 0;
const ICON_TILES = 7;
const ICON_COUNT = 540;

/**
 * Species whose pictures all come from pl_otherpoke (BuildPokemonSpriteTemplate): the character and
 * palette members for (face, form, shiny), the height_o member (LoadPokemonSpriteYOffset; it differs
 * from the character member after the eggs), the form names (constants/forms.h) and, for forms other
 * than 0, the icon (PokeIconSpriteIndex: ICON_* = icon index; Unown B is 497 + form).
 */
interface OtherForms {
  forms: string[];
  char: (face: number, form: number) => number;
  palette: (shiny: number, form: number) => number;
  height?: (face: number, form: number) => number;
  /** Icon index of forms ≥ 1 (form 0 uses the species icon); undefined = all forms share it. */
  icon?: (form: number) => number;
}
const pair = (base: number) => (face: number, form: number) => base + face / 2 + form * 2;
const ARCEUS_TYPES = ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'mystery', 'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark'];
const UNOWN = [...'abcdefghijklmnopqrstuvwxyz', 'exc', 'que'];
/** pl_poke_icon order after species 0–493 (make_pl_poke_icon + meson): egg, Manaphy egg, then the form icons. */
const ICON = { egg: 494, manaphyEgg: 495, deoxysAttack: 496, unownB: 500, burmySandy: 527, wormadamSandy: 529, shellosEast: 531, gastrodonEast: 532, giratinaOrigin: 533, shayminSky: 534, rotomHeat: 535 };
export const OTHER_FORMS: Record<number, OtherForms> = {
  386: { forms: ['normal', 'attack', 'defense', 'speed'], char: pair(0), palette: (s) => 154 + s, icon: (f) => ICON.deoxysAttack + f - 1 },
  201: { forms: UNOWN, char: pair(8), palette: (s) => 156 + s, icon: (f) => ICON.unownB + f - 1 },
  351: { forms: ['normal', 'sunny', 'rainy', 'snowy'], char: (face, form) => 64 + face * 2 + form, palette: (s, f) => 158 + s * 4 + f },
  412: { forms: ['plant', 'sand', 'trash'], char: pair(72), palette: (s, f) => 166 + s + f * 2, icon: (f) => ICON.burmySandy + f - 1 },
  413: { forms: ['plant', 'sand', 'trash'], char: pair(78), palette: (s, f) => 172 + s + f * 2, icon: (f) => ICON.wormadamSandy + f - 1 },
  422: { forms: ['west', 'east'], char: (face, form) => 84 + face + form, palette: (s, f) => 178 + s + f * 2, icon: (f) => ICON.shellosEast + f - 1 },
  423: { forms: ['west', 'east'], char: (face, form) => 88 + face + form, palette: (s, f) => 182 + s + f * 2, icon: (f) => ICON.gastrodonEast + f - 1 },
  421: { forms: ['overcast', 'sunshine'], char: (face, form) => 92 + face + form, palette: (s, f) => 186 + s * 2 + f },
  493: { forms: ARCEUS_TYPES, char: pair(96), palette: (s, f) => 190 + s + f * 2 },
  492: { forms: ['land', 'sky'], char: pair(134), palette: (s, f) => 228 + s + f * 2, height: pair(136), icon: (f) => ICON.shayminSky + f - 1 },
  479: { forms: ['base', 'heat', 'wash', 'frost', 'fan', 'mow'], char: pair(138), palette: (s, f) => 232 + s + f * 2, height: pair(140), icon: (f) => ICON.rotomHeat + f - 1 },
  487: { forms: ['altered', 'origin'], char: pair(150), palette: (s, f) => 244 + s + f * 2, height: pair(152), icon: (f) => ICON.giratinaOrigin + f - 1 },
  // Eggs have one picture for both faces and no shiny palette (SPECIES_EGG: 132 + form, 226 + form).
  [SPECIES_EGG]: { forms: ['base', 'manaphy'], char: (_face, form) => 132 + form, palette: (_s, f) => 226 + f, icon: (f) => (f ? ICON.manaphyEgg : ICON.egg) },
};

export interface PokemonImport {
  records: PokemonSprites[];
  assets: Map<string, Uint8Array>;
}

/** A 16-colour palette as RGBA entries, colour 0 transparent. */
function paletteRgba(colors: Uint16Array): Uint8Array {
  if (colors.length < 16) throw new Error(`pokemon: palette of ${colors.length} colours`);
  const out = new Uint8Array(64);
  for (let i = 1; i < 16; i++) out.set([...rgb555(colors[i]!), 255], i * 4);
  return out;
}

function readAnim(r: Reader, at: number): PokemonSpriteAnim {
  const frames: PokemonSpriteAnim['frames'] = [];
  for (let k = 0; k < 10; k++) {
    const o = at + 3 + k * 4;
    const frame = (r.u8(o) << 24) >> 24;
    if (frame < 0) break;
    if (frame > 1) throw new Error(`pl_poke_data: picture ${frame}`);
    frames.push({ frame, ticks: r.u8(o + 1), dx: (r.u8(o + 2) << 24) >> 24, dy: (r.u8(o + 3) << 24) >> 24 });
  }
  return { frames, animation: r.u8(at + 1), startDelay: r.u8(at + 2), cryDelay: r.u8(at) };
}

/** `speciesIds[i]` = the id of species i (names.json order: SPECIES_NONE … SPECIES_ARCEUS, SPECIES_EGG, SPECIES_BAD_EGG). */
export async function importPokemon(fs: NitroFs, speciesIds: Id[], iconPalettes: Uint8Array): Promise<PokemonImport> {
  const narc = (k: keyof typeof NARCS) => {
    const m = readNarc(fs.file(NARCS[k].path));
    if (m.length !== NARCS[k].count) throw new Error(`${NARCS[k].path}: ${m.length} members, expected ${NARCS[k].count}`);
    return m;
  };
  const pokegra = narc('pokegra');
  const other = narc('otherpoke');
  const height = narc('height');
  const heightO = narc('heightO');
  const data = narc('pokeData')[0]!;
  const icons = narc('icons');
  if (data.length !== (NATIONAL_DEX_COUNT + 1) * SPRITE_DATA_SIZE) throw new Error(`pl_poke_data: ${data.length} bytes, expected ${(NATIONAL_DEX_COUNT + 1) * SPRITE_DATA_SIZE}`);
  if (iconPalettes.length !== ICON_COUNT) throw new Error(`icon palette table: ${iconPalettes.length} entries, expected ${ICON_COUNT}`);
  const iconColors = readNclr(icons[ICON_PALETTES]!).colors;
  const dataReader = new Reader(data);
  const assets = new Map<string, Uint8Array>();
  const records: PokemonSprites[] = [];

  const heightOf = (members: Uint8Array[], i: number): number => {
    const m = members[i];
    if (!m || m.length !== 1) throw new Error(`height member ${i}: ${m?.length ?? 'missing'} bytes`);
    return m[0]!;
  };
  const icon = (index: number, paletteIndex: number): Uint8Array => {
    const c = readNcgrData(icons[ICON_TILES + index]!);
    const tiles = charactersOf(c.data, c.bitDepth).tiles;
    if (tiles.length !== 32) throw new Error(`icon ${index}: ${tiles.length} characters, expected 32 (32×64)`);
    const pal = iconPalettes[paletteIndex]!;
    if (pal > 2) throw new Error(`icon ${index}: palette ${pal}`);
    const indexes = new Uint8Array(32 * 64);
    tiles.forEach((t, k) => {
      for (let p = 0; p < 64; p++) indexes[((k >> 2) * 8 + (p >> 3)) * 32 + (k & 3) * 8 + (p & 7)] = t[p]!;
    });
    return new IndexedPng({ width: 32, height: 64, indexes, palette: paletteRgba(iconColors.subarray(pal * 16, pal * 16 + 16)) }).encode();
  };

  for (let species = 1; species <= SPECIES_EGG; species++) {
    const id = speciesIds[species];
    if (!id) throw new Error(`pokemon: no species id for ${species}`);
    const base = id.replace(/^platinum:SPECIES_/, '').toLowerCase();
    const o = OTHER_FORMS[species];
    const formCount = o ? o.forms.length : 1;
    const forms: PokemonSpriteForm[] = [];
    for (let form = 0; form < formCount; form++) {
      // Pictures as (member, height) per face; female only where the file exists.
      type Pic = { member: Uint8Array; yOffset: number };
      type Faces = { front: Pic; back: Pic; frontFemale?: Pic; backFemale?: Pic };
      let faces: Faces;
      if (o)
        faces = {
          front: { member: other[o.char(FRONT, form)]!, yOffset: heightOf(heightO, (o.height ?? o.char)(FRONT, form)) },
          back: { member: other[o.char(BACK, form)]!, yOffset: heightOf(heightO, (o.height ?? o.char)(BACK, form)) },
        };
      else {
        // Members: female then male per face. Species without a female picture leave it empty; female-only
        // species (Nidoran♀, Chansey …) leave the male one empty, and their female picture is the only one.
        const pic = (face: number, male: number): Pic | undefined =>
          pokegra[species * 6 + face + male]!.length ? { member: pokegra[species * 6 + face + male]!, yOffset: heightOf(height, species * 4 + face + male) } : undefined;
        const [fm, ff, bm, bf] = [pic(FRONT, 1), pic(FRONT, 0), pic(BACK, 1), pic(BACK, 0)];
        if (!(fm ?? ff) || !(bm ?? bf)) throw new Error(`pokemon ${species}: no front or back picture`);
        faces = { front: (fm ?? ff)!, back: (bm ?? bf)! };
        if (fm && ff) faces.frontFemale = ff;
        if (bm && bf) faces.backFemale = bf;
      }
      const order = (['front', 'back', 'frontFemale', 'backFemale'] as const).filter((k) => faces[k]);
      const indexes = new Uint8Array(MON_WIDTH * MON_HEIGHT * order.length);
      order.forEach((k, row) => indexes.set(readMonPicture(faces[k]!.member), row * MON_WIDTH * MON_HEIGHT));
      const palMember = (shiny: number) => (o ? other[o.palette(shiny, form)]! : pokegra[species * 6 + 4 + shiny]!);
      const png = new IndexedPng({ width: MON_WIDTH, height: MON_HEIGHT * order.length, indexes, palette: paletteRgba(readNclr(palMember(0)).colors) });
      const name = o ? `${base}-${o.forms[form]}` : base;
      assets.set(`pokemon/${name}.png`, png.encode());
      // The egg has no shiny palette: its shiny atlas is the same picture.
      assets.set(`pokemon/${name}-shiny.png`, species === SPECIES_EGG ? png.encode() : png.encode(paletteRgba(readNclr(palMember(1)).colors)));
      const iconIndex = form && o?.icon ? o.icon(form) : species === SPECIES_EGG ? ICON.egg : species;
      // PokeIconPaletteIndex takes Unown's palette from ICON_UNOWN_A + form − 1, one entry before its picture.
      assets.set(`pokemon/${name}-icon.png`, icon(iconIndex, species === UNOWN_SPECIES && form ? iconIndex - 1 : iconIndex));
      const face = (k: (typeof order)[number]) => ({
        y: order.indexOf(k) * MON_HEIGHT,
        yOffset: faces[k]!.yOffset,
        ...(k === 'front' || k === 'frontFemale' ? { opaque: opaqueRuns(indexes.subarray(order.indexOf(k) * MON_WIDTH * MON_HEIGHT)) } : {}),
      });
      forms.push({
        ...(o ? { name: o.forms[form]! } : {}),
        atlas: asId(`platinum:pokemon/${name}.png`),
        shinyAtlas: asId(`platinum:pokemon/${name}-shiny.png`),
        front: face('front'),
        back: face('back'),
        ...(faces.frontFemale ? { frontFemale: face('frontFemale') } : {}),
        ...(faces.backFemale ? { backFemale: face('backFemale') } : {}),
        icon: asId(`platinum:pokemon/${name}-icon.png`),
      });
    }
    // pl_poke_data covers species 0–493; the egg has no entry (no animation, no shadow).
    const at = species * SPRITE_DATA_SIZE;
    const hasData = species <= NATIONAL_DEX_COUNT;
    const still: PokemonSpriteAnim = { frames: [], animation: 0, startDelay: 0, cryDelay: 0 };
    records.push({
      id,
      sourceIndex: species,
      forms,
      front: hasData ? readAnim(dataReader, at) : still,
      back: hasData ? readAnim(dataReader, at + 43) : still,
      yOffset: hasData ? (dataReader.u8(at + 86) << 24) >> 24 : 0,
      shadow: hasData ? { x: (dataReader.u8(at + 87) << 24) >> 24, size: dataReader.u8(at + 88) } : { x: 0, size: 0 },
    });
  }
  return { records, assets };
}

/**
 * The first frame's opaque pixels (contracts `PokemonFace.opaque`): per row of 80, the run count and each run's first
 * x and end x, as base64.
 */
function opaqueRuns(picture: Uint8Array): string {
  const bytes: number[] = [];
  for (let y = 0; y < MON_HEIGHT; y++) {
    const runs: number[] = [];
    for (let x = 0; x < MON_WIDTH / 2; x++) {
      if (!picture[y * MON_WIDTH + x]) continue;
      if (runs.length && runs[runs.length - 1] === x) runs[runs.length - 1] = x + 1;
      else runs.push(x, x + 1);
    }
    bytes.push(runs.length / 2, ...runs);
  }
  return btoa(String.fromCharCode(...bytes));
}
