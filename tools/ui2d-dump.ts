/**
 * Dev check for the 2D art import: runs the ui2d import on a ROM and writes every PNG, the records,
 * and a few composed previews (a battle scene laid out at the DS positions) to a gitignored folder.
 *
 *   pnpm ui2d-dump <rom.nds> [outDir]     (default outDir: rom-out/ui2d)
 *
 * The output is ROM-derived: the folder must be gitignored, anything else is refused.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Ui2dSheet } from '@opensinnoh/contracts';
import { NitroFs } from '@opensinnoh/nds';
import namesFile from '../packages/importer/data/names.json' with { type: 'json' };
import { blankImage, blit, crop, decodeImage, encodeImage, importUi2d, Names, romBuildOfHeader, type Image, type NamesFile } from '../packages/importer/src/index.ts';

const [romPath = process.env.OPENSINNOH_NDS_ROM, outArg = 'rom-out/ui2d'] = process.argv.slice(2);
if (!romPath) {
  console.error('usage: pnpm ui2d-dump <rom.nds> [outDir]  (or set OPENSINNOH_NDS_ROM)');
  process.exit(2);
}
const outDir = resolve(outArg);
try {
  execFileSync('git', ['check-ignore', '-q', join(outDir, 'x.png')], { stdio: 'ignore' });
} catch {
  console.error(`refusing to write ROM-derived files to ${outDir}: git check-ignore says it is not ignored`);
  process.exit(1);
}

const romBytes = new Uint8Array(readFileSync(romPath));
const fs = new NitroFs(romBytes, { paths: romBuildOfHeader(romBytes).paths });
const names = new Names(namesFile as NamesFile);
const t0 = Date.now();
const out = await importUi2d(
  fs,
  romBuildOfHeader(romBytes),
  names.file.species.map((_, i) => names.species(i)),
  names.file.trainerClasses.map((_, i) => names.trainerClass(i)),
);
const ms = Date.now() - t0;
const write = (path: string, data: string | Uint8Array) => {
  const full = join(outDir, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
};
let bytes = 0;
for (const [path, png] of out.assets) {
  write(path, png);
  bytes += png.length;
}
const records = { ...out, assets: undefined };
write('records.json', JSON.stringify(records, null, 1));

const asset = (ref: string) => decodeImage(out.assets.get(ref.replace(/^platinum:/, ''))!);
const sheet = (id: string) => out.ui2d.find((s) => s.id === id)!;
/** Draws cell `n` of a sheet with its origin at (x, y). */
const drawCell = (dst: Image, s: Ui2dSheet, n: number, x: number, y: number) => {
  const c = s.cells[n]!;
  blit(dst, crop(asset(s.atlas), c.x, c.y, c.w, c.h), x - c.ox, y - c.oy, true);
};
/** The DS battle scene at rest: background, platforms, both battlers, healthboxes and textbox. */
function scene(bg: string, terrain: string, time: 'day' | 'twilight' | 'night', enemy: string, player: string, playerTrainer?: string): Image {
  const img = crop(asset(out.battleBackgrounds.find((b) => b.id === bg)![time]), 0, 0, 256, 192);
  const t = out.battleTerrains.find((x) => x.id === terrain)!;
  drawCell(img, sheet(t.enemy[time]), 0, t.enemy.x, t.enemy.y);
  drawCell(img, sheet(t.player[time]), 0, t.player.x, t.player.y);
  const mon = (species: string, face: 'front' | 'back', cx: number, cy: number) => {
    const form = out.pokemonSprites.find((p) => p.id === species)!.forms[0]!;
    blit(img, crop(asset(form.atlas), 0, form[face].y, 80, 80), cx - 40, cy + form[face].yOffset - 40, true);
  };
  mon(enemy, 'front', 192, 50);
  if (playerTrainer) drawCell(img, sheet(out.trainerSprites.find((x) => x.id === playerTrainer)!.back!), 0, 64, 112);
  else mon(player, 'back', 64, 112);
  drawCell(img, sheet('platinum:ui2d/battle/healthbox/enemy'), 0, 58, 36);
  drawCell(img, sheet('platinum:ui2d/battle/healthbox/player_singles'), 0, 192, 116);
  // Textbox: window (2, 19) 27×4 tiles in message box frame 0, a 9-slice around it.
  const frame = sheet('platinum:ui2d/windows/message_box_00');
  const src = asset(frame.atlas);
  const [l, tp, r, b] = frame.nineSlice!;
  const box = { x: 2 * 8 - l, y: 19 * 8 - tp, w: 27 * 8 + l + r, h: 4 * 8 + tp + b };
  for (let y = 0; y < box.h; y++)
    for (let x = 0; x < box.w; x++) {
      const sx = x < l ? x : x >= box.w - r ? src.width - (box.w - x) : l + ((x - l) % (src.width - l - r));
      const sy = y < tp ? y : y >= box.h - b ? src.height - (box.h - y) : tp + ((y - tp) % (src.height - tp - b));
      const p = (sy * src.width + sx) * 4;
      if (src.rgba[p + 3]) img.rgba.set(src.rgba.subarray(p, p + 4), ((box.y + y) * 256 + box.x + x) * 4);
    }
  return img;
}
const scale = (img: Image, k: number): Image => {
  const o = blankImage(img.width * k, img.height * k);
  for (let y = 0; y < o.height; y++)
    for (let x = 0; x < o.width; x++) o.rgba.set(img.rgba.subarray(((Math.floor(y / k) * img.width + Math.floor(x / k)) * 4), (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4 + 4), (y * o.width + x) * 4);
  return o;
};
write('preview/route201-starly.png', encodeImage(scale(scene('platinum:BACKGROUND_PLAIN', 'platinum:TERRAIN_GRASS', 'day', 'platinum:SPECIES_STARLY', 'platinum:SPECIES_PIPLUP'), 2)));
write('preview/route201-bidoof-night.png', encodeImage(scale(scene('platinum:BACKGROUND_PLAIN', 'platinum:TERRAIN_GRASS', 'night', 'platinum:SPECIES_BIDOOF', 'platinum:SPECIES_CHIMCHAR'), 2)));
write('preview/route201-kricketot-throw.png', encodeImage(scale(scene('platinum:BACKGROUND_PLAIN', 'platinum:TERRAIN_GRASS', 'twilight', 'platinum:SPECIES_KRICKETOT', '', 'platinum:TRAINER_CLASS_PLAYER_MALE'), 2)));
write('preview/cave-geodude.png', encodeImage(scale(scene('platinum:BACKGROUND_CAVE_1', 'platinum:TERRAIN_CAVE', 'day', 'platinum:SPECIES_GEODUDE', 'platinum:SPECIES_TURTWIG'), 2)));

console.log(`ui2d import ${ms} ms: ${out.ui2d.length} sheets, ${out.pokemonSprites.length} species, ${out.trainerSprites.length} trainer classes, ${out.battleBackgrounds.length} backgrounds, ${out.battleTerrains.length} terrains`);
console.log(`${out.assets.size} PNGs, ${(bytes / 1e6).toFixed(2)} MB → ${outDir}`);
