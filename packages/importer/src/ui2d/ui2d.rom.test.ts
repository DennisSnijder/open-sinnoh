/** The 2D art import on the real ROM (OPENSINNOH_NDS_ROM; skipped without it). */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NitroFs } from '@opensinnoh/nds';
import namesFile from '../../data/names.json' with { type: 'json' };
import { romBuildOfHeader } from '../layout.ts';
import { Names, type NamesFile } from '../names.ts';
import { decodeImage } from './png.ts';
import { importUi2d, type Ui2dImport } from './index.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('2D art import (OPENSINNOH_NDS_ROM)', () => {
  let out: Ui2dImport;
  const png = (ref: string) => {
    const bytes = out.assets.get(ref.replace(/^platinum:/, ''));
    if (!bytes) throw new Error(`no asset ${ref}`);
    return decodeImage(bytes);
  };
  const opaque = (img: ReturnType<typeof png>, x: number, y: number, w: number, h: number) => {
    let n = 0;
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (img.rgba[(yy * img.width + xx) * 4 + 3]) n++;
    return n;
  };
  beforeAll(async () => {
    const names = new Names(namesFile as NamesFile);
    const bytes = new Uint8Array(readFileSync(romPath!));
    const fs = new NitroFs(bytes, { paths: romBuildOfHeader(bytes).paths });
    out = await importUi2d(
      fs,
      romBuildOfHeader(bytes),
      names.file.species.map((_, i) => names.species(i)),
      names.file.trainerClasses.map((_, i) => names.trainerClass(i)),
    );
  });

  it('decodes every species and form with the expected dimensions', { timeout: 30_000 }, () => {
    expect(out.pokemonSprites).toHaveLength(494);
    const formCounts = Object.fromEntries(out.pokemonSprites.filter((p) => p.forms.length > 1).map((p) => [p.id, p.forms.length]));
    expect(formCounts).toEqual({
      'platinum:SPECIES_UNOWN': 28, 'platinum:SPECIES_CASTFORM': 4, 'platinum:SPECIES_DEOXYS': 4, 'platinum:SPECIES_BURMY': 3, 'platinum:SPECIES_WORMADAM': 3,
      'platinum:SPECIES_CHERRIM': 2, 'platinum:SPECIES_SHELLOS': 2, 'platinum:SPECIES_GASTRODON': 2, 'platinum:SPECIES_ROTOM': 6, 'platinum:SPECIES_GIRATINA': 2,
      'platinum:SPECIES_SHAYMIN': 2, 'platinum:SPECIES_ARCEUS': 18, 'platinum:SPECIES_EGG': 2,
    });
    let female = 0;
    for (const p of out.pokemonSprites)
      for (const f of p.forms) {
        const rows = 2 + (f.frontFemale ? 1 : 0) + (f.backFemale ? 1 : 0);
        female += f.frontFemale ? 1 : 0;
        for (const ref of [f.atlas, f.shinyAtlas]) {
          const img = png(ref);
          expect([img.width, img.height], `${ref}`).toEqual([160, 80 * rows]);
          // Every face has a picture in its first frame.
          for (let r = 0; r < rows; r++) expect(opaque(img, 0, r * 80, 80, 80), `${ref} row ${r}`).toBeGreaterThan(50);
        }
        const icon = png(f.icon);
        expect([icon.width, icon.height]).toEqual([32, 64]);
        expect(opaque(icon, 0, 0, 32, 32)).toBeGreaterThan(20);
      }
    expect(female).toBeGreaterThan(50);
    const starly = out.pokemonSprites.find((p) => p.id === 'platinum:SPECIES_STARLY')!;
    expect(starly.forms[0]!.frontFemale).toBeDefined();
    expect(starly.front.frames.length).toBeGreaterThan(0);
    expect(out.pokemonSprites.find((p) => p.id === 'platinum:SPECIES_BULBASAUR')).toMatchObject({ front: { cryDelay: 13, animation: 7, startDelay: 10 }, yOffset: 2, shadow: { x: 1, size: 1 } });
    // Female-only species have one picture per face.
    expect(out.pokemonSprites.find((p) => p.id === 'platinum:SPECIES_NIDORAN_F')!.forms[0]!.frontFemale).toBeUndefined();
  });

  it('imports trainer sprites, the backgrounds and the platforms', () => {
    expect(out.trainerSprites).toHaveLength(105);
    expect(out.trainerSprites.filter((t) => t.back).map((t) => t.id)).toHaveLength(10);
    const lucas = out.ui2d.find((s) => s.id === out.trainerSprites[0]!.back)!;
    expect(lucas.cells).toHaveLength(8);
    expect(lucas.animations![1]!.frames.map((f) => f.cell)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
    expect(out.battleBackgrounds).toHaveLength(23);
    for (const b of out.battleBackgrounds)
      for (const ref of [b.day, b.twilight, b.night]) {
        const img = png(ref);
        expect([img.width, img.height]).toEqual([512, 256]);
        expect(opaque(img, 0, 0, 256, 192)).toBe(256 * 192);
      }
    expect(new Set(out.battleBackgrounds.slice(0, 6).flatMap((b) => [b.day, b.twilight, b.night])).size).toBe(18);
    expect(out.battleTerrains).toHaveLength(24);
    const grass = out.battleTerrains.find((t) => t.id === 'platinum:TERRAIN_GRASS')!;
    expect(grass.player).toMatchObject({ x: 64, y: 136, start: [336, 136] });
    const platform = out.ui2d.find((s) => s.id === grass.player.day)!;
    expect(platform.cells[0]).toMatchObject({ w: 256, h: 32, ox: 128, oy: 16 });
  });

  it('imports the battle UI and window frames', () => {
    const ids = new Set(out.ui2d.map((s) => s.id));
    for (const id of ['healthbox/enemy', 'healthbox/player_singles', 'healthbox/parts', 'party_gauge', 'type_icons', 'ball_throws/poke_ball']) expect(ids.has(`platinum:ui2d/battle/${id}`), id).toBe(true);
    const parts = out.ui2d.find((s) => s.id === 'platinum:ui2d/battle/healthbox/parts')!;
    expect(parts.names![2]).toBe('hp_green_fill_0');
    expect(parts.cells).toHaveLength(78);
    // The healthbox numbers: font_special_chars 0–9, white ink with the dark outline, nothing else.
    const digits = out.ui2d.find((s) => s.id === 'platinum:ui2d/battle/healthbox/digits')!;
    expect(digits.names).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
    const img = png(digits.atlas);
    const inks = new Set<string>();
    for (const c of digits.cells) {
      expect(c).toMatchObject({ w: 8, h: 8 });
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const p = ((c.y + y) * img.width + c.x + x) * 4;
          if (img.rgba[p + 3]) inks.add([...img.rgba.subarray(p, p + 3)].join(','));
        }
    }
    expect([...inks].sort()).toEqual(['255,255,255', '41,49,41']);
    // The caught ball's stars: one 32×32 texture per ball from its catch particle file, mostly transparent.
    const stars = out.ui2d.filter((s) => s.id.startsWith('platinum:ui2d/battle/ball_stars/'));
    expect(stars).toHaveLength(17);
    const star = png(out.ui2d.find((s) => s.id === 'platinum:ui2d/battle/ball_stars/poke_ball')!.atlas);
    expect([star.width, star.height]).toEqual([32, 32]);
    let opaque = 0;
    for (let p = 3; p < star.rgba.length; p += 4) if (star.rgba[p]! > 128) opaque++;
    expect(opaque).toBeGreaterThan(100);
    expect(opaque).toBeLessThan(700);
    const frames = out.ui2d.filter((s) => s.nineSlice);
    // 23 window frames (the Underground's too), 7 command / CANCEL / YES-NO buttons, 18 type move buttons and the empty slot, the target
    // screen's 4 battler buttons and their 4 blanks.
    expect(frames).toHaveLength(57);
    for (const s of out.ui2d) {
      const img = png(s.atlas);
      for (const c of s.cells) expect(c.x + c.w <= img.width && c.y + c.h <= img.height, `${s.id}`).toBe(true);
    }
  });

  it('imports the battle touch-screen buttons as nine-slices, the move buttons in their type palettes', () => {
    const button = (name: string) => {
      const s = out.ui2d.find((r) => r.id === `platinum:ui2d/battle/buttons/${name}`);
      if (!s) throw new Error(`no button ${name}`);
      const img = png(s.atlas);
      const c = s.cells[0]!;
      const at = (x: number, y: number) => [...img.rgba.subarray(((c.y + y) * img.width + c.x + x) * 4, ((c.y + y) * img.width + c.x + x) * 4 + 4)];
      return { s, c, at };
    };
    const sizes = Object.fromEntries(['fight', 'bag', 'pokemon', 'run', 'cancel', 'yes', 'no', 'move_normal'].map((n) => [n, [button(n).c.w, button(n).c.h]]));
    // RUN and CANCEL get the bottom edge the screen cuts off (4 rows).
    expect(sizes).toEqual({ fight: [216, 93], bag: [78, 47], pokemon: [78, 47], run: [78, 44], cancel: [238, 44], yes: [248, 61], no: [248, 61], move_normal: [124, 55] });
    // FIGHT's face is red, BAG's orange, POKéMON's green, RUN's blue (the centre of each).
    const face = (n: string) => button(n).at(button(n).c.w >> 1, button(n).c.h >> 1);
    const hex = ([r, g, b]: number[]) => [r, g, b].map((v) => v!.toString(16).padStart(2, '0')).join('');
    expect(['fight', 'bag', 'pokemon', 'run'].map((n) => hex(face(n)))).toEqual(['ef3a3a', 'e69c29', '5ab529', '2994ce']);
    // Every move button: the cream panel in the middle, the frame in the type's colour (Fire red, Water blue, Grass green).
    for (const t of ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel', 'mystery', 'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark']) {
      const b = button(`move_${t}`);
      expect(b.s.nineSlice).toEqual([15, 14, 15, 15]);
      expect(b.at(62, 27), t).toEqual([247, 239, 173, 255]);
    }
    // The empty slot: its own (shifted) tiles in the grey palette, a flat grey face.
    const [er, eg, eb] = button('move_empty').at(62, 27);
    expect(Math.max(er!, eg!, eb!) - Math.min(er!, eg!, eb!), `${[er, eg, eb]}`).toBeLessThan(16);
    const frame = (t: string) => button(`move_${t}`).at(62, 11);
    const [fr, fg, fb] = frame('fire');
    const [wr, wg, wb] = frame('water');
    const [gr, gg, gb] = frame('grass');
    expect(fr! > fg! && fr! > fb! && wb! > wr! && wb! > wg! && gg! > gr! && gg! > gb!, `${frame('fire')} ${frame('water')} ${frame('grass')}`).toBe(true);
    // The target screen: the enemies' buttons (1, 3) taller and warm, the player side's (0, 2) grey; each blank a
    // flat dark grey; the link a solid tile.
    expect([0, 1, 2, 3].map((b) => [button(`target_${b}`).c.w, button(`target_${b}`).c.h])).toEqual([[120, 56], [120, 72], [120, 56], [120, 72]]);
    const mid = (n: string) => button(n).at(60, button(n).c.h >> 1);
    const [r1, g1, b1] = mid('target_1');
    expect(r1! > g1! && r1! > b1!, `${[r1, g1, b1]}`).toBe(true);
    for (const b of [0, 2]) {
      const [r, g, bl] = mid(`target_${b}`);
      expect(Math.max(r!, g!, bl!) - Math.min(r!, g!, bl!), `${[r, g, bl]}`).toBeLessThan(40);
    }
    for (const b of [0, 1, 2, 3]) {
      const [r, g, bl] = mid(`target_${b}_empty`);
      expect(Math.max(r!, g!, bl!) - Math.min(r!, g!, bl!), `${[r, g, bl]}`).toBeLessThan(24);
      expect(r!, `target_${b}_empty`).toBeLessThan(140);
    }
    const link = out.ui2d.find((r) => r.id === 'platinum:ui2d/battle/buttons/target_link')!;
    expect([link.cells[0]!.w, link.cells[0]!.h]).toEqual([8, 8]);
  });

  it('imports item icons (sItemArchiveIDs) and the party icon animations', () => {
    expect(out.itemIcons.size).toBe(468);
    const potion = out.itemIcons.get(17)!;
    const img = png(`platinum:${potion}`);
    expect([img.width, img.height]).toEqual([32, 32]);
    const anims = out.ui2d.find((s) => s.id === 'platinum:ui2d/pokemon/icon_frames')!.animations!;
    // POKEICON_ANIM_*: fainted still, then faster at more HP; statused shakes frame 0.
    expect(anims.map((a) => a.frames.map((f) => `${f.cell}:${f.ticks}`).join(','))).toEqual(['0:1', '0:4,1:4', '0:6,1:6', '0:12,1:12', '0:20,1:20', '0:32,0:2,0:2']);
  });

  it('imports the ribbons (sRibbonDataTable): 80 drawn 32×32 cells and their name/description messages', () => {
    expect(out.ribbons).toHaveLength(80);
    // Names are message i; descriptions follow the 80 names, special ones (Mystery Gift) the fresh save's SPECIAL_DESCRIPTIONS_START.
    expect(out.ribbons.map((r) => r.name)).toEqual(Array.from({ length: 80 }, (_, i) => i));
    expect(out.ribbons[0]!.description).toBe(80);
    expect(out.ribbons.filter((r) => r.description === 146).length).toBe(10);
    const sheet = out.ui2d.find((s) => s.id === 'platinum:ui2d/summary/ribbons')!;
    expect(sheet.cells).toHaveLength(80);
    const img = png(sheet.atlas);
    for (const [i, c] of sheet.cells.entries()) {
      expect([c.w, c.h, c.ox, c.oy], `ribbon ${i}`).toEqual([32, 32, 16, 16]);
      expect(opaque(img, c.x, c.y, c.w, c.h), `ribbon ${i}`).toBeGreaterThan(100);
    }
  });

  it('imports the trainer card per level and side (256×192, opaque) with its text colours, and places the portraits', () => {
    const card = out.ui2d.find((s) => s.id === 'platinum:ui2d/trainer_case/card')!;
    const levels = ['0', '1', '2', '3', '4', '5', 'nodex'];
    expect(card.names).toEqual([...levels.map((l) => `front_${l}`), ...levels.map((l) => `back_${l}`)]);
    const img = png(card.atlas);
    for (const c of card.cells) {
      expect([c.w, c.h]).toEqual([256, 192]);
      // The card fills the screen inside its rounded corners (a few colour-0 pixels show the backdrop).
      expect(opaque(img, c.x + 8, c.y + 8, 240, 176)).toBeGreaterThan(240 * 176 * 0.99);
    }
    // Palette 15 colours 1 and 2: dark grey on every card but the black one (yellow on dark grey).
    expect(card.textColors![0]).toEqual({ fg: '#4a4a4a', shadow: '#a5a5a5' });
    expect(card.textColors![5]).toEqual({ fg: '#ffff73', shadow: '#3a3a3a' });
    // The portraits keep their place on the card (BG_LAYER_SUB_3 at 0, 0): inside the front's photo frame.
    for (const gender of ['male', 'female']) {
      const p = out.ui2d.find((s) => s.id === `platinum:ui2d/trainer_case/portrait_${gender}`)!.cells[0]!;
      expect(-p.ox, gender).toBeGreaterThanOrEqual(176);
      expect(-p.oy, gender).toBe(55);
    }
  });
  it('imports the party menu art: the backdrop, the member panels per kind and state, the HP fill, the OBJ sets', () => {
    const sheet = (path: string) => out.ui2d.find((s) => s.id === `platinum:ui2d/${path}`)!;
    const bg = sheet('party/bg');
    expect([bg.cells[0]!.w, bg.cells[0]!.h]).toEqual([256, 192]);
    expect(opaque(png(bg.atlas), 0, 0, 256, 192)).toBe(256 * 192);
    const panels = sheet('party/panels');
    const states = ['normal', 'fainted', 'selected', 'selected_fainted', 'switch'];
    expect(panels.names).toEqual([...['lead', 'lead_nohp', 'back', 'back_nohp'].flatMap((k) => states.map((st) => `${k}_${st}`)), 'none']);
    const img = png(panels.atlas);
    const pixel = (c: (typeof panels.cells)[number], x: number, y: number) => [...img.rgba.subarray(((c.y + y) * img.width + c.x + x) * 4, ((c.y + y) * img.width + c.x + x) * 4 + 4)];
    for (const c of panels.cells) {
      expect([c.w, c.h]).toEqual([128, 48]);
      // The back panels are full rectangles; the lead one is rounded at the left.
      expect(opaque(img, c.x + 16, c.y + 8, 104, 32)).toBe(104 * 32);
    }
    // Each state has its own colours (UpdateSlotPalette), at the panel's body.
    const body = states.map((st) => pixel(panels.cells[panels.names!.indexOf(`back_${st}`)]!, 40, 30).join());
    expect(new Set(body).size).toBe(5);
    // The HP bar row: the frame on the HP kinds, the empty character 0x17 on the _nohp ones.
    const bar = (name: string) => pixel(panels.cells[panels.names!.indexOf(name)]!, 80, 26).join();
    expect(bar('back_normal')).not.toBe(bar('back_nohp_normal'));
    const fill = sheet('party/hp_fill');
    expect(fill.names).toHaveLength(27);
    const f = png(fill.atlas);
    for (const colour of ['green', 'yellow', 'red']) {
      const c8 = fill.cells[fill.names!.indexOf(`${colour}_8`)]!;
      expect(opaque(f, c8.x, c8.y, 8, 8), colour).toBe(32);
      const c0 = fill.cells[fill.names!.indexOf(`${colour}_0`)]!;
      expect(opaque(f, c0.x, c0.y, 8, 8), colour).toBe(0);
    }
    expect(sheet('party/text').textColors).toHaveLength(3);
    expect(sheet('party/cursor').cells.map((c) => [c.w, c.h])).toEqual([[128, 48], [128, 48], [128, 48], [128, 48]]);
    expect(sheet('party/cancel').cells.slice(0, 2).map((c) => [c.w, c.h, c.ox, c.oy])).toEqual([[56, 32, 32, 16], [56, 32, 32, 16]]);
    expect(sheet('party/ball').cells).toHaveLength(2);
    expect(sheet('party/held').cells).toHaveLength(3);
  });

  it('imports the summary pages (256×192, opaque), the detail panels, the bars, text colours and sprites', () => {
    const sheet = (path: string) => out.ui2d.find((s) => s.id === `platinum:ui2d/${path}`)!;
    const pages = sheet('summary/pages');
    expect(pages.names).toEqual(['info', 'memo', 'skills', 'condition', 'moves', 'ribbons', 'moves_select']);
    const img = png(pages.atlas);
    for (const c of pages.cells) expect(opaque(img, c.x, c.y, c.w, c.h)).toBe(256 * 192);
    const detail = sheet('summary/move_info');
    const d = png(detail.atlas);
    const [move, ribbon] = detail.cells;
    // The move panel over the left of the page from y 40; the ribbon panel along the bottom from y 140.
    expect(opaque(d, move!.x, move!.y + 48, 128, 144)).toBe(128 * 144);
    expect(opaque(d, move!.x + 140, move!.y, 116, 192)).toBe(0);
    expect(opaque(d, ribbon!.x, ribbon!.y + 144, 256, 48)).toBe(256 * 48);
    expect(opaque(d, ribbon!.x, ribbon!.y, 256, 128)).toBe(0);
    const bars = sheet('summary/bars');
    expect(bars.names).toHaveLength(36);
    expect(sheet('summary/text').textColors!.map((c) => c.fg)).toEqual(['#101921', '#ffffff', '#0073ff', '#ef2110']);
    expect(sheet('summary/status').cells).toHaveLength(7);
    expect(sheet('summary/move_cursor').cells.map((c) => [c.w, c.h])).toEqual([[128, 32], [128, 32]]);
    expect(sheet('summary/ribbon_cursor').cells).toHaveLength(1);
    expect(sheet('summary/ribbon_arrow').cells).toHaveLength(2);
    // The caught ball: one drawn cell per ball item, Master Ball to Cherish Ball.
    const balls = sheet('summary/balls');
    expect(balls.names).toHaveLength(16);
    expect(balls.names![0]).toBe('ITEM_MASTER_BALL');
    expect(balls.names![15]).toBe('ITEM_CHERISH_BALL');
    const b = png(balls.atlas);
    for (const c of balls.cells) expect(opaque(b, c.x, c.y, c.w, c.h)).toBeGreaterThan(30);
  });

  it('imports the start menu icons (grey and coloured, three animations an entry) and the cursor', () => {
    const sheet = (path: string) => out.ui2d.find((s) => s.id === `platinum:ui2d/${path}`)!;
    for (const path of ['start_menu/icons', 'start_menu/icons_gray']) {
      const icons = sheet(path);
      // Nine entries (POKéDEX … RETIRE) and the female bag, ×3 (none, swell, wiggle).
      expect(icons.animations, path).toHaveLength(30);
      const img = png(icons.atlas);
      for (let a = 0; a < 30; a += 3) {
        const c = icons.cells[icons.animations![a]!.frames[0]!.cell]!;
        expect(opaque(img, c.x, c.y, c.w, c.h), `${path} ${a}`).toBeGreaterThan(40);
      }
    }
    const cursor = sheet('start_menu/cursor');
    expect(cursor.cells[0]!.w).toBeGreaterThanOrEqual(64);

  });

  it('imports the curved list plates in the four depth palettes, with the caught mark', () => {
    const colours = new Set<string>();
    for (const palette of [0, 7, 8, 9]) {
      const s = out.ui2d.find(s => s.id === `platinum:ui2d/pokedex/list_tags_${palette}`)!;
      const plate = s.cells[s.animations![0]!.frames[0]!.cell]!;
      expect(plate).toMatchObject({ w: 128, h: 32, ox: 64, oy: 16 });
      const img = png(s.atlas);
      expect(opaque(img, plate.x, plate.y, plate.w, plate.h)).toBeGreaterThan(500);
      const ball = s.cells[s.animations![1]!.frames[0]!.cell]!;
      expect(opaque(img, ball.x, ball.y, ball.w, ball.h)).toBeGreaterThan(40);
      colours.add(Buffer.from(img.rgba).toString('base64'));
    }
    expect(colours.size).toBe(4);
  });

  it('imports the cry page: its screen, the meter OBJ set and the waveform colour', () => {
    const sheet = (path: string) => out.ui2d.find((s) => s.id === `platinum:ui2d/${path}`)!;
    expect(sheet('pokedex/cry_screen').cells[0]).toMatchObject({ w: 256, h: 192 });
    // ov21_021E4B30: segments play animation 1, the peak marker 0, each an 8×8 cell.
    const bar = sheet('pokedex/cry_bar');
    for (const a of [0, 1]) expect(bar.cells[bar.animations![a]!.frames[0]!.cell]).toMatchObject({ w: 8, h: 8 });
    expect(sheet('pokedex/cry_wave').cells[0]).toMatchObject({ w: 1, h: 1 });
  });

  it('imports the shop panel: 256×192, the list and description panels opaque, the field corner clear', () => {
    const panel = out.ui2d.find((s) => s.id === 'platinum:ui2d/shop/panel')!;
    const c = panel.cells[0]!;
    expect([c.w, c.h]).toEqual([256, 192]);
    const img = png(panel.atlas);
    // shop_menu.c: the list window at tile (12, 2) 19×14 and the description at (5, 18) 27×6 print on it.
    expect(opaque(img, c.x + 96, c.y + 16, 152, 112)).toBe(152 * 112);
    expect(opaque(img, c.x + 40, c.y + 144, 216, 48)).toBe(216 * 48);
    expect(opaque(img, c.x, c.y + 48, 80, 80)).toBe(0);
  });

  it('imports the bag screen: the BG, both bags with an animation per pocket, the pocket icons and the list marks', () => {
    const sheet = (path: string) => {
      const s = out.ui2d.find((x) => x.id === `platinum:ui2d/${path}`);
      if (!s) throw new Error(`no sheet ${path}`);
      return s;
    };
    const screen = sheet('bag/screen');
    expect(screen.cells.map((c) => [c.w, c.h])).toEqual([[256, 192]]);
    expect(opaque(png(screen.atlas), 0, 0, 256, 192)).toBe(256 * 192);
    for (const gender of ['male', 'female']) {
      const bag = sheet(`bag/bag_${gender}`);
      expect(bag.cells).toHaveLength(8);
      expect(bag.animations!.length).toBeGreaterThanOrEqual(8);
      // One picture per pocket type: the first eight animations show eight different cells.
      expect(new Set(bag.animations!.slice(0, 8).map((a) => a.frames[0]!.cell)).size).toBe(8);
      const img = png(bag.atlas);
      for (const c of bag.cells) expect(opaque(img, c.x, c.y, c.w, c.h), gender).toBeGreaterThan(1000);
    }
    const icons = sheet('bag/pocket_icons');
    expect(icons.cells.map((c) => [c.w, c.h])).toEqual(Array.from({ length: 16 }, () => [10, 10]));
    const iconImg = png(icons.atlas);
    for (const c of icons.cells) expect(opaque(iconImg, c.x, c.y, c.w, c.h)).toBeGreaterThan(20);
    expect(sheet('bag/entry_icons').names).toEqual(['registered', 'hm']);
    expect(sheet('bag/item_highlight').cells[0]).toMatchObject({ w: 152, h: 32, ox: 72, oy: 16 });
    expect(sheet('bag/arrows').animations!.length).toBeGreaterThanOrEqual(2);
    expect(sheet('bag/pocket_highlight').cells).toHaveLength(1);
  });

  it("imports Rowan's intro: the two backdrops, the people cropped with their screen origin, the Poké Ball screen and button", () => {
    const sheet = (path: string) => out.ui2d.find((x) => x.id === `platinum:ui2d/${path}`)!;
    const backdrops = sheet('intro/backdrops');
    expect(backdrops.names).toEqual(['plain', 'adventure']);
    for (const c of backdrops.cells) expect(opaque(png(backdrops.atlas), c.x, c.y, 256, 192)).toBe(256 * 192);
    const people = sheet('intro/people');
    expect(people.names).toEqual(['rowan', 'boy-0', 'boy-1', 'boy-2', 'boy-3', 'girl-0', 'girl-1', 'girl-2', 'girl-3', 'rival', 'boy-shrink-1', 'boy-shrink-2', 'boy-shrink-3', 'boy-shrink-4', 'girl-shrink-1', 'girl-shrink-2', 'girl-shrink-3', 'girl-shrink-4']);
    // Rowan stands in the screen's middle, the shrinking avatar gets smaller frame by frame.
    expect(people.cells[0]).toMatchObject({ w: 64, h: 123, ox: -96, oy: -21 });
    expect(people.cells.slice(10, 14).map((c) => c.h)).toEqual([96, 66, 43, 23]);
    const ball = sheet('intro/ball');
    expect(ball.names).toEqual(['screen', 'button-0', 'button-1', 'button-2']);
    expect(opaque(png(ball.atlas), 0, 0, 256, 192)).toBe(256 * 192);
    // The button is centred on (128, 100), where RowanIntro_WasPokeballOpened checks a touch.
    for (const c of ball.cells.slice(1)) expect([-c.ox + c.w / 2, -c.oy + c.h / 2]).toEqual([128, 97]);
  });

  it('omits the unused Options art from records and assets', () => {
    expect(out.ui2d.filter((x) => x.id.startsWith('platinum:ui2d/options/'))).toEqual([]);
    expect([...out.assets.keys()].filter((path) => path.includes('/options/'))).toEqual([]);
  });

  it('imports the PC screens:the top screen, the party tray, the hand, the buttons and compare mode\'s parts', () => {
    const sheet = (path: string) => out.ui2d.find((x) => x.id === `platinum:ui2d/${path}`)!;
    const screen = sheet('box/screen');
    expect(screen.cells.map((c) => [c.w, c.h])).toEqual([[256, 192]]);
    const tray = sheet('box/tray');
    expect(tray.cells.map((c) => [c.w, c.h])).toEqual([[120, 192]]);
    // The tray is drawn whole (the 15-tile map read row by row): its body is opaque.
    expect(opaque(png(tray.atlas), 8, 8, 104, 176)).toBe(104 * 176);
    // Wallpapers too (21 tiles wide), with the box name's colours.
    const wallpaper = sheet('box/wallpaper_00');
    expect(opaque(png(wallpaper.atlas), 0, 0, 168, 160)).toBe(168 * 160);
    expect(wallpaper.textColors).toHaveLength(1);
    expect(sheet('box/compare_sides').cells).toHaveLength(2);
    expect(sheet('box/preview_marks').cells.map((c) => [c.w, c.h])).toEqual(Array.from({ length: 12 }, () => [8, 8]));
    expect(sheet('box/cursor').animations!.length).toBeGreaterThanOrEqual(10);
    expect(sheet('box/buttons').cells.map((c) => [c.w, c.h])).toEqual([[144, 32], [144, 32], [144, 32]]);
    expect(sheet('box/compare_buttons').names).toEqual(['left_0', 'left_1', 'left_2', 'right_0', 'right_1', 'right_2', 'page_0', 'page_1', 'page_2', 'dot_0', 'dot_1']);
    // The right button is the left one mirrored about the sprite's position (origin at its right edge).
    const right = sheet('box/compare_buttons').cells[3]!;
    expect([right.ox, right.oy]).toEqual([right.w, 56]);
  });
});
