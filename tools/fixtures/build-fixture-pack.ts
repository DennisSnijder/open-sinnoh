/**
 * Generates packs/fixture: original content only (geometry, textures and sprites made here from code).
 * Run: pnpm tsx tools/fixtures/build-fixture-pack.ts
 *
 * World: four zones.
 *  - fixture:ROOM — interior (orthographic camera), one chunk, a table prop, a helper NPC, a TV sign,
 *    and a door warp to the town.
 *  - fixture:TOWN — outdoor (perspective camera), 2×1 chunks, a house prop with a door warp back to
 *    the room (the door is its own prop with BCA-converted open/close clips), a guide NPC, and a
 *    coord trigger that runs a small starter scene.
 *  - fixture:ROUTE_W / fixture:ROUTE_E — one 2×1 matrix with a zone per cell (a seamless connection,
 *    different areas): grass, cave floor and ledges in the west; trainers with sight (single, a double
 *    pair, two singles) and wander / look-around / back-and-forth NPCs in the east.
 *  Room furniture tiles (PC, TV-less wall, bookshelf, trash can, town map) run their tile-behaviour scripts.
 *  - fixture:TERRAIN — one chunk of terrain (layout at `terrainTiles`): water with a bridge and a
 *    waterfall, puddle, shallow water, sand, snow, mud, ice, spin tiles, a bike slope, a ramp, a bike
 *    bridge, a rock-climb wall, a directional wall and a Strength boulder; surf encounters.
 *  - fixture:GROTTO — a cave (no bike) to warp into.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_RECORDS, SEALS } from '@opensinnoh/contracts';
import { encodePng } from './png.ts';
import { box, writeGltf, type FixturePrimitive } from './gltf.ts';
import { fixtureTitleModel } from './title.ts';
import { fixtureChooseStarterImages, fixtureChooseStarterModels, fixtureStarterPictures, fixtureStarterSprites } from './choose-starter.ts';
import { buildFixtureFont } from './font.ts';
import { DOOR_FRAMES, doorGltf } from './door.ts';
import { fixtureBoxArt, fixtureCard, fixtureRibbonSheet, menuTexts, ribbonRecords, ribbonTexts } from './menus.ts';
import * as mon from './pokemon.ts';
import { battleTexts, fixtureAiScript } from './battle.ts';
import { fixtureSound } from './sound.ts';

const OUT = join(import.meta.dirname, '../../packs/fixture');
const T = 16; // world units per tile
const HALF = 256; // half a chunk
/** LIGHT_SUNNY at night: a dim blue key light and lower emission. */
const FIXTURE_NIGHT = {
  lights: [{ color: [0.35, 0.38, 0.6] as [number, number, number], direction: [0.6, -0.8, 0] as [number, number, number] }, { color: [0.15, 0.2, 0.35] as [number, number, number], direction: [-0.6, 0.8, 0] as [number, number, number] }, null, null],
  diffuse: [0.6, 0.6, 0.6] as [number, number, number],
  ambient: [0.3, 0.32, 0.35] as [number, number, number],
  specular: [0.1, 0.1, 0.1] as [number, number, number],
  emission: [0.1, 0.1, 0.16] as [number, number, number],
};

mkdirSync(join(OUT, 'models'), { recursive: true });
mkdirSync(join(OUT, 'textures'), { recursive: true });
mkdirSync(join(OUT, 'sprites'), { recursive: true });
mkdirSync(join(OUT, 'fonts'), { recursive: true });

// ---------- textures (procedural, 16×16) ----------
function texture(name: string, size: number, px: (x: number, y: number) => [number, number, number, number]) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) rgba.set(px(x, y), (y * size + x) * 4);
  writeFileSync(join(OUT, 'textures', `${name}.png`), encodePng(size, size, rgba));
  return `../textures/${name}.png`;
}
const hash = (x: number, y: number) => ((x * 73856093) ^ (y * 19349663)) & 7;
const grass = texture('grass', 16, (x, y) => (hash(x, y) === 0 ? [72, 160, 72, 255] : [96, 184, 88, 255]));
const path = texture('path', 16, (x, y) => (hash(x, y) < 2 ? [200, 176, 120, 255] : [216, 192, 136, 255]));
const floor = texture('floor', 16, (x, y) => ((x + y * 3) % 16 < 1 || y % 8 === 0 ? [150, 110, 70, 255] : [190, 140, 90, 255]));
const wall = texture('wall', 16, (_x, y) => (y < 2 ? [120, 120, 150, 255] : [232, 224, 200, 255]));
const roof = texture('roof', 16, (x, y) => ((x + y) % 4 === 0 ? [150, 50, 50, 255] : [190, 70, 60, 255]));
const wood = texture('wood', 16, (_x, y) => (y % 5 === 0 ? [110, 70, 40, 255] : [150, 100, 60, 255]));
const tree = texture('tree', 16, (x, y) => (hash(x, y) < 3 ? [30, 100, 50, 255] : [40, 130, 60, 255]));

// ---------- tiles ----------
const BLOCKED = 0x8000;
const tileCenter = (t: number) => t * T - HALF + T / 2;
function grid(fill: (x: number, z: number) => number): number[] {
  const out: number[] = [];
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) out.push(fill(x, z));
  return out;
}

// ROOM chunk: open floor x 11..20, z 12..19; exit mat (warp) at (15,19); TV at (12,12) is blocked.
const roomOpen = (x: number, z: number) => x >= 11 && x <= 20 && z >= 12 && z <= 19;
const tableTiles = (x: number, z: number) => x >= 12 && x <= 13 && z >= 14 && z <= 15;
// Behaviour bytes (decomp TileBehavior values; names in the tileBehaviors registry below).
const B = {
  NONE: 0x00,
  TALL_GRASS: 0x02,
  CAVE_FLOOR: 0x08,
  WATER_RIVER: 0x10,
  JUMP_EAST: 0x38,
  JUMP_WEST: 0x39,
  JUMP_NORTH: 0x3a,
  JUMP_SOUTH: 0x3b,
  WARP_STAIRS_EAST: 0x5e,
  WARP_STAIRS_WEST: 0x5f,
  DOOR: 0x69,
  PC: 0x83,
  TOWN_MAP: 0x85,
  TV: 0x86,
  BOOKSHELF_1: 0xe1,
  TRASH_CAN: 0xe4,
  // Terrain (fixture:TERRAIN)
  WATERFALL: 0x13,
  WATER_SEA: 0x15,
  PUDDLE: 0x16,
  SHALLOW_WATER: 0x17,
  ICE: 0x20,
  SAND: 0x21,
  BLOCK_EASTWARD: 0x30,
  UNKNOWN_x3C: 0x3c,
  SLIDE_EASTWARD: 0x40,
  ROCK_CLIMB_N_S: 0x4b,
  BRIDGE_START: 0x70,
  BRIDGE_OVER_WATER: 0x73,
  BIKE_BRIDGE_N_S: 0x76,
  SNOW_DEEP: 0xa1,
  SNOW_DEEPER: 0xa2,
  SNOW_DEEPEST: 0xa3,
  MUD: 0xa4,
  MUD_DEEP: 0xa5,
  MUD_WITH_GRASS: 0xa6,
  SNOW_SHALLOW: 0xa8,
  BIKE_RAMP_EASTWARD: 0xd7,
  BIKE_SLOPE_BOTTOM: 0xda,
} as const;
// Room furniture on the north wall (z 11, blocked): town map (15,11), PC (17,11), bookshelf (19,11);
// a trash can on the floor at (20,12).
const roomFurniture: Record<string, number> = { '15,11': B.TOWN_MAP, '17,11': B.PC, '19,11': B.BOOKSHELF_1, '20,12': B.TRASH_CAN };
const roomTiles = grid((x, z) =>
  x === 15 && z === 19 ? B.DOOR : roomFurniture[`${x},${z}`] !== undefined ? BLOCKED | roomFurniture[`${x},${z}`]! : x === 12 && z === 12 ? BLOCKED : roomOpen(x, z) && !tableTiles(x, z) ? 0 : BLOCKED,
);

// TOWN chunks: west and east. Border of trees (blocked); house at west x 8..13, z 8..12 (blocked) with
// door at (10,13) (blocked, as on the DS: pushed into); a path row at z 16; tall grass behaviour 0x02 in east x 20..27, z 4..9.
const townWTiles = grid((x, z) => {
  if (x === 0 || z === 0 || z === 31) return BLOCKED | 0x10;
  if (x >= 8 && x <= 13 && z >= 8 && z <= 12) return BLOCKED;
  if (x === 10 && z === 13) return BLOCKED | B.DOOR;
  return 0;
});
// ROUTE (two zones on one 2×1 matrix, seam at x 32): west = grass x 4..9 z 4..9, cave floor x 4..9
// z 20..25, a south ledge row z 14 (x 12..20, blocked as on the DS), east/west ledges at x 24/26 z 16..18.
// East (zone ROUTE_E, another area): trainers and NPCs (events below). Open across the seam.
const routeWTiles = grid((x, z) => {
  if (x === 0 || z === 0 || z === 31) return BLOCKED;
  if (x >= 4 && x <= 9 && z >= 4 && z <= 9) return B.TALL_GRASS;
  if (x >= 4 && x <= 9 && z >= 20 && z <= 25) return B.CAVE_FLOOR;
  if (z === 14 && x >= 12 && x <= 20) return BLOCKED | B.JUMP_SOUTH;
  if (x === 24 && z >= 16 && z <= 18) return BLOCKED | B.JUMP_EAST;
  if (x === 26 && z >= 16 && z <= 18) return BLOCKED | B.JUMP_WEST;
  return 0;
});
const routeETiles = grid((x, z) => (x === 31 || z === 0 || z === 31 ? BLOCKED : 0));

/**
 * TERRAIN chunk (x, z):
 *  - water x 2..9: top pool z 1..2, the waterfall (5,3) between cliffs (the rest of row 3 blocked), lower
 *    pool z 4..9; a bridge over the lower pool on row 7 (BRIDGE_START at (1,7) and (10,7)); shore x 10.
 *  - puddle (12,2), shallow water (13,2); sand x 12..15 z 4..5; snow row 7: shallow 12..13, deep 14,
 *    deeper 15, deepest 16; mud row 9: mud 12, deep mud 13, mud with grass 14; an inert UNKNOWN_x3C at (16,9).
 *  - ice x 18..22 z 2..4 (wall x 23); spin tiles east at (18,7),(19,7), plain (20,7) with a wall at (20,6).
 *  - Strength boulder (object 0) at (12,13), rock at (15,13); BLOCK_EASTWARD at (12,16).
 *  - rock climb N-S x 20 z 14..16, walls at x 19 and 21 on those rows.
 *  - bike slope (26,10..11) climbed from the south (x 26, z 12..22 open); a ramp east at (24,24) with
 *    (26,24) blocked; a bike bridge N-S x 29 z 20..23 between BRIDGE_START tiles (29,19) and (29,24), its
 *    east side blocked, its west side open ground (the ground under the bridge from beside it).
 *  - a warp to the grotto at (3,28).
 */
const terrainTiles = grid((x, z) => {
  if (x === 0 || x === 31 || z === 0 || z === 31) return BLOCKED;
  if (x >= 2 && x <= 9 && (z === 1 || z === 2)) return B.WATER_SEA;
  if (z === 3 && x >= 1 && x <= 10) return x === 5 ? B.WATERFALL : BLOCKED;
  if (z === 7 && (x === 1 || x === 10)) return B.BRIDGE_START;
  if (z === 7 && x >= 2 && x <= 9) return B.BRIDGE_OVER_WATER;
  if (x >= 2 && x <= 9 && z >= 4 && z <= 9) return B.WATER_SEA;
  const at: Record<string, number> = {
    '12,2': B.PUDDLE,
    '13,2': B.SHALLOW_WATER,
    '12,7': B.SNOW_SHALLOW,
    '13,7': B.SNOW_SHALLOW,
    '14,7': B.SNOW_DEEP,
    '15,7': B.SNOW_DEEPER,
    '16,7': B.SNOW_DEEPEST,
    '12,9': B.MUD,
    '13,9': B.MUD_DEEP,
    '14,9': B.MUD_WITH_GRASS,
    '16,9': B.UNKNOWN_x3C,
    '18,7': B.SLIDE_EASTWARD,
    '19,7': B.SLIDE_EASTWARD,
    '20,6': BLOCKED,
    '15,13': BLOCKED,
    '12,16': B.BLOCK_EASTWARD,
    '26,10': B.BIKE_SLOPE_BOTTOM,
    '26,11': B.BIKE_SLOPE_BOTTOM,
    '24,24': B.BIKE_RAMP_EASTWARD,
    '26,24': BLOCKED,
    '29,19': B.BRIDGE_START,
    '29,24': B.BRIDGE_START,
  };
  if (at[`${x},${z}`] !== undefined) return at[`${x},${z}`]!;
  if (x >= 12 && x <= 15 && (z === 4 || z === 5)) return B.SAND;
  if (x >= 18 && x <= 22 && z >= 2 && z <= 4) return B.ICE;
  if (x === 23 && z >= 2 && z <= 4) return BLOCKED;
  if (x === 20 && z >= 14 && z <= 16) return B.ROCK_CLIMB_N_S;
  if ((x === 19 || x === 21) && z >= 14 && z <= 16) return BLOCKED;
  if (x === 29 && z >= 20 && z <= 23) return B.BIKE_BRIDGE_N_S;
  if (x === 30 && z >= 20 && z <= 23) return BLOCKED;
  return 0;
});
const grottoTiles = grid((x, z) => (x >= 4 && x <= 27 && z >= 4 && z <= 27 ? 0 : BLOCKED));

const townETiles = grid((x, z) => {
  if (x === 31 || z === 0 || z === 31) return BLOCKED | 0x10;
  if (x >= 20 && x <= 27 && z >= 4 && z <= 9) return B.TALL_GRASS;
  return 0;
});

const flatTerrain = {
  points: [
    [-HALF, -HALF],
    [HALF, HALF],
  ],
  normals: [[0, 1, 0]],
  constants: [0],
  plates: [{ p1: 0, p2: 1, normal: 0, constant: 0 }],
  strips: [{ z: -HALF, count: 1, start: 0 }],
  accessList: [0],
};

// ---------- models ----------
function quad(x0: number, z0: number, x1: number, z1: number, y: number, uvScale: number) {
  return box([x0, y, z0], [x1, y, z1], uvScale, ['py']);
}
function prim(material: number, g: { positions: number[]; uvs: number[] }): FixturePrimitive {
  return { material, ...g };
}
function merge(...gs: { positions: number[]; uvs: number[] }[]) {
  return { positions: gs.flatMap((g) => g.positions), uvs: gs.flatMap((g) => g.uvs) };
}
const tx = (t: number) => t * T - HALF; // tile edge

writeFileSync(
  join(OUT, 'models/room.gltf'),
  writeGltf(
    'room',
    [
      { name: 'floor', texture: floor },
      { name: 'wall', texture: wall },
    ],
    [
      prim(0, quad(tx(11), tx(12), tx(21), tx(20), 0, 10)),
      prim(
        1,
        merge(
          box([tx(11), 0, tx(11)], [tx(21), 48, tx(12)], 4, ['pz']),
          box([tx(10), 0, tx(12)], [tx(11), 48, tx(20)], 4, ['px']),
          box([tx(21), 0, tx(12)], [tx(22), 48, tx(20)], 4, ['nx']),
        ),
      ),
    ],
  ),
);

function townModel(name: string, withPath: boolean, trees: [number, number][]) {
  const prims = [prim(0, quad(-HALF, -HALF, HALF, HALF, 0, 32))];
  if (withPath) prims.push(prim(1, quad(-HALF, tx(16), HALF, tx(17), 0.5, 1)));
  prims.push(prim(2, merge(...trees.map(([x, z]) => box([tx(x) + 2, 0, tx(z) + 2], [tx(x + 1) - 2, 40, tx(z + 1) - 2], 1)))));
  return writeGltf(
    name,
    [
      { name: 'grass', texture: grass },
      { name: 'path', texture: path },
      { name: 'tree', texture: tree },
    ],
    prims,
  );
}
const border = (xs: number[], zs: number[]) => xs.flatMap((x) => zs.map((z) => [x, z] as [number, number]));
writeFileSync(
  join(OUT, 'models/town-west.gltf'),
  townModel('town-west', true, [...border([0], [...Array(32).keys()]), ...border([...Array(32).keys()].slice(1), [0, 31])]),
);
writeFileSync(
  join(OUT, 'models/town-east.gltf'),
  townModel('town-east', true, [...border([31], [...Array(32).keys()]), ...border([...Array(31).keys()], [0, 31])]),
);

writeFileSync(
  join(OUT, 'models/table.gltf'),
  writeGltf('table', [{ name: 'wood', texture: wood }], [prim(0, box([-14, 0, -14], [14, 14, 14], 1))]),
);
// House: walls + roof, origin at the footprint centre (6×5 tiles).
writeFileSync(
  join(OUT, 'models/house.gltf'),
  writeGltf(
    'house',
    [
      { name: 'wall', texture: wall },
      { name: 'roof', texture: roof },
      { name: 'doorway', color: [0.08, 0.06, 0.05, 1] },
    ],
    [
      prim(0, box([-48, 0, -40], [48, 48, 40], 3, ['px', 'nx', 'pz', 'nz'])),
      prim(1, box([-52, 48, -44], [52, 60, 44], 3)),
      // the dark doorway behind the door prop (house-local x −16..0 on the south face)
      prim(2, box([-16, 0, 40], [0, 28, 40.5], 1, ['pz'])),
    ],
  ),
);
writeFileSync(join(OUT, 'models/door.gltf'), doorGltf());

// ---------- title screen (original, tools/fixtures/title.ts) ----------
writeFileSync(join(OUT, 'models/title-lantern.gltf'), fixtureTitleModel());

// ---------- starter-choice scene and the starters' pictures (original, tools/fixtures/choose-starter.ts) ----------
const starterScene = fixtureChooseStarterModels();
for (const [file, gltf] of Object.entries(starterScene.models)) writeFileSync(join(OUT, 'models', file), gltf);
for (const [file, png] of Object.entries(starterScene.textures)) writeFileSync(join(OUT, 'textures', file), png);
mkdirSync(join(OUT, 'ui2d/choose_starter'), { recursive: true });
mkdirSync(join(OUT, 'pokemon'), { recursive: true });
for (const [path, png] of Object.entries({ ...fixtureChooseStarterImages(), ...fixtureStarterPictures() })) writeFileSync(join(OUT, path), png);
const ribbonSheet = fixtureRibbonSheet();
mkdirSync(join(OUT, 'ui2d/summary'), { recursive: true });
writeFileSync(join(OUT, 'ui2d/summary/ribbons.png'), encodePng(ribbonSheet.width, ribbonSheet.height, ribbonSheet.rgba));

// ---------- trainer card placeholders (original, tools/fixtures/menus.ts) ----------
const card = fixtureCard();
mkdirSync(join(OUT, 'ui2d/trainer_case'), { recursive: true });
writeFileSync(join(OUT, 'ui2d/trainer_case/card.png'), card.png);

// ---------- PC box marks and compare pages (original, tools/fixtures/menus.ts) ----------
const boxArt = fixtureBoxArt((s) => `fixture:${s}`);
mkdirSync(join(OUT, 'ui2d/box'), { recursive: true });
for (const [path, png] of Object.entries(boxArt.files)) writeFileSync(join(OUT, path), png);

// ---------- the evolution scene's sparkle (original): an 8×8 diamond, white so the emitter colours it ----------
mkdirSync(join(OUT, 'ui2d/evolution'), { recursive: true });
{
  const rgba = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (Math.abs(x - 3.5) + Math.abs(y - 3.5) <= 4) rgba.set([255, 255, 255, 255], (y * 8 + x) * 4);
  writeFileSync(join(OUT, 'ui2d/evolution/particles.png'), encodePng(8, 8, rgba));
}

// ---------- sprites: 16 frames of 32×32; per direction [stand, step-left, stand, step-right] ----------
const DIRS = ['down', 'up', 'left', 'right'] as const;
function spriteAtlas(name: string, body: [number, number, number], head: [number, number, number]) {
  const W = 32 * 16;
  const rgba = new Uint8Array(W * 32 * 4);
  const put = (x: number, y: number, c: readonly number[]) => rgba.set([...c, 255], (y * W + x) * 4);
  DIRS.forEach((dir, d) => {
    for (let f = 0; f < 4; f++) {
      const ox = (d * 4 + f) * 32;
      const step = f === 1 ? -1 : f === 3 ? 1 : 0;
      for (let y = 6; y < 30; y++)
        for (let x = 9; x < 23; x++) {
          const inHead = y < 16 && (x - 16) ** 2 + (y - 11) ** 2 < 30;
          const inBody = y >= 15 && y < 26 && x >= 11 && x < 21;
          const inLegs = y >= 26 && ((x >= 12 + step && x < 15 + step) || (x >= 17 - step && x < 20 - step));
          if (inHead) put(ox + x, y, head);
          else if (inBody) put(ox + x, y, body);
          else if (inLegs) put(ox + x, y, [40, 40, 60]);
        }
      // eyes show facing
      const eyes: [number, number][] = dir === 'down' ? [[14, 11], [18, 11]] : dir === 'left' ? [[12, 11]] : dir === 'right' ? [[20, 11]] : [];
      for (const [x, y] of eyes) put(ox + x, y, [20, 20, 20]);
    }
  });
  writeFileSync(join(OUT, 'sprites', `${name}.png`), encodePng(W, 32, rgba));
  const animations: Record<string, { frame: number; ticks: number }[]> = {};
  DIRS.forEach((dir, d) => {
    animations[`stand-${dir}`] = [{ frame: d * 4, ticks: 1 }];
    animations[`walk-${dir}`] = [0, 1, 2, 3].map((f) => ({ frame: d * 4 + f, ticks: 2 }));
    animations[`run-${dir}`] = [0, 1, 2, 3].map((f) => ({ frame: d * 4 + f, ticks: 1 }));
  });
  return { atlas: `fixture:sprites/${name}.png`, frameSize: 32, frameCount: 16, animations };
}

// Field effects: one atlas of 4 coloured frames, one animation per effect use (FieldEffect sprite sets).
function effectAtlas() {
  const W = 32 * 4;
  const rgba = new Uint8Array(W * 32 * 4);
  const colours = [
    [80, 140, 230],
    [190, 160, 110],
    [120, 90, 60],
    [235, 240, 250],
  ];
  colours.forEach((c, f) => {
    for (let y = 10; y < 22; y++) for (let x = 8; x < 24; x++) if ((x - 16) ** 2 / 64 + (y - 16) ** 2 / 36 < 1) rgba.set([...c, 200], (y * W + f * 32 + x) * 4);
  });
  writeFileSync(join(OUT, 'sprites', 'effects.png'), encodePng(W, 32, rgba));
  const one = (frame: number) => [{ frame, ticks: 1 }];
  return {
    atlas: 'fixture:sprites/effects.png',
    frameSize: 32,
    frameCount: 4,
    animations: {
      ...Object.fromEntries(DIRS.flatMap((d) => [`stand-${d}`, `walk-${d}`]).map((k) => [k, one(0)])),
      mount: one(0),
      ripple: one(0),
      splash: one(0),
      footprints: one(1),
      'bike-tracks': one(1),
      'snow-shallow': one(3),
      'snow-deep': one(3),
      'snow-shadow': one(3),
      mud: one(2),
      rustle: [
        { frame: 1, ticks: 12 },
        { frame: 3, ticks: 1 },
      ],
    },
  };
}

// ---------- message font (original, tools/fixtures/font.ts) ----------
const { png: fontPng, ...fontMetrics } = buildFixtureFont();
writeFileSync(join(OUT, 'fonts/message.png'), fontPng);

// Item icons (original): a round token in the item's colour with a dark rim, 32×32.
mkdirSync(join(OUT, 'sprites', 'items'), { recursive: true });
for (const { path, colour } of mon.itemIcons) {
  const rgba = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const d = (x - 15.5) ** 2 + (y - 15.5) ** 2;
      if (d > 11 ** 2) continue;
      const c = d > 9.5 ** 2 ? [40, 40, 56] : x < 14 && y < 14 && d < 4 ** 2 + 30 ? colour.map((v) => Math.min(255, v + 60)) : colour;
      rgba.set([...c, 255], (y * 32 + x) * 4);
    }
  writeFileSync(join(OUT, path), encodePng(32, 32, rgba));
}

// ---------- data ----------
const INTERACT: Record<string, { label: string; facing: string }> = {
  PC: { label: 'fixture:Common_PC', facing: 'up' },
  TV: { label: 'fixture:Common_TV', facing: 'up' },
  TOWN_MAP: { label: 'fixture:Common_TownMap', facing: 'any' },
  BOOKSHELF_1: { label: 'fixture:Common_Bookshelf', facing: 'any' },
  TRASH_CAN: { label: 'fixture:Common_TrashCan', facing: 'any' },
};
const id = (s: string) => `fixture:${s}`;
const battle = battleTexts((s) => id(s) as `${string}:${string}`, mon.moves);
/** Field moves the terrain accepts (TileBehavior.fieldMove; decomp FieldMoves_SetUsableMoves). */
const FIELD_MOVE: Record<string, { move: string; label: string }> = {
  WATER_SEA: { move: id('MOVE_SURF'), label: id('FieldMoves_Surf') },
  WATERFALL: { move: id('MOVE_WATERFALL'), label: id('FieldMoves_Waterfall') },
  ROCK_CLIMB_N_S: { move: id('MOVE_ROCK_CLIMB'), label: id('FieldMoves_RockClimb') },
};

/**
 * In-game UI labels (packages/app/src/ui/strings.ts): the UI asks for Platinum's message names in the
 * base pack's namespace, so the fixture carries its own original strings under the same names.
 */
const uiTexts = Object.entries({
  // The new-game intro (packages/menus rowan-intro.ts): the fixture's own warden, in original words.
  RowanIntro_Text_HelloThere: 'Hello, traveler!{clear}Welcome to the valley.{clear}',
  RowanIntro_Text_MyNameRowan: 'I keep the lantern of this valley.{clear}Shall I tell you about the road?{clear}',
  RowanIntro_Text_InfoAnythingElse: 'Anything more you want to hear?{clear}',
  RowanIntro_Text_AdventureInfo0: 'The road starts at your door.',
  RowanIntro_Text_AdventureInfo1: 'Talk to everyone you meet.',
  RowanIntro_Text_AdventureInfo2: 'Help others and paths open.',
  RowanIntro_Text_AdventureInfo3: 'Some will want a contest.\nWin it with your companions.',
  RowanIntro_Text_AdventureInfo4: 'Strength is not the goal.',
  RowanIntro_Text_AdventureInfo5: 'The people you meet are.',
  RowanIntro_Text_WidelyInhabited: 'Companions live all over\nthis valley.{clear}',
  RowanIntro_Text_HavePokeBall: 'Here is a capsule.{clear}Press the button in its middle.{indicator 0}',
  RowanIntro_Text_PokeBallUseTouchscreen: 'Not that one!\nThe button on the capsule.{indicator 0}',
  RowanIntro_Text_LiveAlongsidePokemon: 'We walk side by side with them.{clear}',
  RowanIntro_Text_AboutYourself: 'Now, tell me about you.{clear}',
  RowanIntro_Text_GenderDialogue: 'Which one is you?{clear}',
  RowanIntro_Text_ConfirmBoy: 'So this is you?{clear}',
  RowanIntro_Text_ConfirmGirl: 'So this is you?{clear}',
  RowanIntro_Text_NameDialogue: 'And your name?{clear}',
  RowanIntro_Text_ConfirmNameMale: 'You are {var 0}?{clear}',
  RowanIntro_Text_ConfirmNameFemale: 'You are {var 0}?{clear}',
  RowanIntro_Text_SoYoure: 'Welcome, {var 0}!{clear}This is your oldest friend.{clear}',
  RowanIntro_Text_RivalNameDialogue: 'What is their name?{clear}',
  RowanIntro_Text_ConfirmRivalName: '{var 1}, right?{clear}',
  RowanIntro_Text_EndDialogue: 'Off you go, {var 0}.{clear}The valley is waiting.{clear}',
  RowanIntro_Text_ChoiceAdventureInfo: 'THE ROAD',
  RowanIntro_Text_ChoiceNoInfo: 'NO THANKS',
  RowanIntro_Text_ChoiceYes: 'YES',
  RowanIntro_Text_ChoiceNo: 'NO',
  RowanIntro_Text_RivalChoiceNew: 'Another!',
  RowanIntro_Text_RivalChoiceBarry: 'Wren',
  RowanIntro_Text_RivalChoiceNolan: 'Oak',
  RowanIntro_Text_RivalChoiceRoy: 'Sol',
  RowanIntro_Text_RivalChoiceGavin: 'Fen',
  MainMenuOptions_Text_Continue: 'RESUME',
  MainMenuOptions_Text_NewGame: 'NEW JOURNEY',
  MainMenuOptions_Text_MysteryGift: 'SURPRISE',
  MainMenuOptions_Text_Player: 'TRAVELER',
  MainMenuOptions_Text_Time: 'TIME',
  MainMenuOptions_Text_Badges: 'MARKS',
  MainMenuOptions_Text_Pokedex: 'LOG',
  MainMenuOptions_Text_PlayerName: '{var 0}',
  MainMenuOptions_Text_PlayTime: '{var 0}:{var 1}',
  MainMenuOptions_Text_BadgeCount: '{var 0}',
  StartMenu_Text_Pokedex: 'FIELD LOG',
  StartMenu_Text_Pokemon: 'COMPANIONS',
  StartMenu_Text_Bag: 'PACK',
  StartMenu_Text_PlayerTemplate: '{var 0}',
  StartMenu_Text_Save: 'RECORD',
  StartMenu_Text_Options: 'SETTINGS',
  StartMenu_Text_Exit: 'CLOSE',
  StartMenu_Text_Retire: 'QUIT',
  StartMenu_Text_SafariBalls: 'SAFARI NETS',
  StartMenu_Text_BallStock: 'Left: {var 0}',
  Bag_Text_Cancel: 'BACK',
  Bag_Text_CantSellItem: '{var 0}? Sorry,\nI do not take that.',
  Bag_Text_SellHowMany: '{var 0}?\nHow many will you trade in?',
  Bag_Text_ConfirmSellPrice: 'I can give {var 0}c.\nIs that fine?',
  Bag_Text_TurnedOverItems: 'Handed over the {var 0}\nfor {var 1}c.',
  Bag_Text_KeyItemInfo: 'A key item in the pack can be\nset to this button.',
  Bag_Text_CannotDismount: 'You cannot get off\nthe bike here.',
  Bag_Text_CannotUseWithPartner: 'Not while someone\nis with you.',
  Bag_Text_CannotUseNoFishing: 'No fishing\nhere.',
  Bag_Text_Walk: 'ON FOOT',
  Bag_Text_CoinCaseMessage: 'Tokens: {var 0}',
  CommonStrings_Text_CantDoThatRightNow: '{var 0}, this is not\nthe time for that.',
  ...Object.fromEntries(
    Object.entries({
      0: 'Hello!\nWhat can I do for you?',
      1: 'Thanks, see you soon!',
      2: 'Anything else\nfor you today?',
      3: 'You are short on coins.',
      4: '{var 0}? Sure.\nHow many?',
      5: '{var 0}, {var 1} of them.\nThat comes to {var 2}c. Fine?',
      6: 'There you go!{clear}You stowed the {var 0}\nin the {var 1} pouch.',
      7: 'Your pack has no room\nfor that.',
      8: 'BACK',
      9: '{var 0}c',
      10: 'Take a Bonus Orb\nwith that, too.',
      15: 'PURCHASE',
      16: 'TRADE IN',
      17: 'LEAVE',
      18: 'Coins',
      19: '{var 0}c',
      20: 'Carried: {var 0}',
      21: 'x{var 0}',
      22: '{var 0}c',
      23: 'YES',
      24: 'NO',
      27: '{var 0} ({var 3}),\n{var 1} for {var 2}c. Fine?',
      29: 'YES',
      30: 'NO',
      31: 'Earn more points\nand come back.',
      32: '{var 0} pt',
      33: '{var 0}? Right.\nHow many?',
      34: '{var 0} pt',
      35: '{var 0} costs {var 2} pt\nfor {var 1}. Fine?',
      36: '{var 0} ({var 3}) costs\n{var 2} pt for {var 1}. Fine?',
      37: 'Sorry, you are short\non points.',
      38: '{var 0} pt',
      13: 'The {var 0} went into\nthe sticker book.',
      14: 'The sticker book has no room\nfor more of those.',
    }).map(([n, t]) => [`pl_msg_00000543_${String(n).padStart(5, '0')}`, t]),
  ),
  Bag_Text_ItemCountX: 'x',
  PartyMenu_Text_ChooseAPokemon: 'Pick a companion.',
  PartyMenu_Text_CancelButton: 'BACK',
  BattleParty_Text_PokemonLevelLabel: 'Lv',
  BattleParty_Text_ChooseAPokemon: 'Who goes in?',
  BattleParty_Text_UseOnWhichPokemon: 'Give it to whom?',
  BattleParty_Text_CantSwitchWithPokemonAlreadyInBattle: '{var 0} is out\nalready!',
  BattleParty_Text_CantSwitchWithFaintedPokemon: '{var 0} is too\nworn out to go!',
  BattleParty_Text_CantSwitchWithEgg: 'An Egg stays put!',
  BattleParty_Text_CantSwitchWithAlreadySelectedPokemon: '{var 0} is picked\nalready!',
  BattleParty_Text_ItemWontHaveAnyEffect: 'That would do nothing.',
  BattleBag_Text_PocketNameHPPP: 'TONICS',
  BattleBag_Text_PocketNameRestore: '& DRAUGHTS',
  BattleBag_Text_PocketNameStatus: 'CURES',
  BattleBag_Text_PocketNameHealers: '& SALVES',
  BattleBag_Text_PocketNamePokeBalls: 'ORBS',
  BattleBag_Text_PocketNameBattleItems: 'BOUT ITEMS',
  BattleBag_Text_ItemHasNoUse: 'That will not help now!',
  BattleBag_Text_CantUseBallNoRoomLeft: 'The archive is full!',
  BattleBag_Text_CantUseBallTwoPokemon: 'Two stand there: no clear\nthrow!',
  BattleParty_Text_MovePPLabel: 'PP',
  BattleStrings_Text_Fight: 'ACT',
  BattleStrings_Text_Bag: 'PACK',
  BattleStrings_Text_Pokemon: 'TEAM',
  BattleStrings_Text_Run: 'FLEE',
  BattleStrings_Text_Ball: 'TOSS',
  BattleStrings_Text_Bait: 'TREAT',
  BattleStrings_Text_Mud: 'DIRT',
  BattleStrings_Text_Cancel: 'BACK',
  TrainerCard_Text_IDNo: 'ID',
  TrainerCard_Text_Name: 'NAME',
  TrainerCard_Text_Money: 'COINS',
  TrainerCard_Text_Pokedex: 'LOG',
  TrainerCard_Text_Time: 'TIME',
  TrainerCard_Text_TwoDashes: '--',
  TrainerCard_Text_Format_Money: '{var 5}c',
  TrainerCard_Text_Format_HHMMWithColon: '{var 0}:{var 1}',
  CommonStrings_Text_WouldYouLikeToSave: 'Write your journey into the record?',
  CommonStrings_Text_SavingDontTurnOffThePower: 'Writing the record...',
  CommonStrings_Text_PlayerSavedTheGame: '{var 0} wrote the record.',
  pl_msg_00000534_00001: 'TRAVELER',
  pl_msg_00000534_00002: 'MARKS',
  pl_msg_00000534_00003: 'LOG',
  pl_msg_00000534_00004: 'TIME',
  OptionsMenu_Text_ConfirmDialogYes: 'YES',
  OptionsMenu_Text_ConfirmDialogNo: 'NO',
  OptionsMenu_Text_Title: 'SETTINGS',
  OptionsMenu_Text_TextSpeedLabel: 'TEXT PACE',
  OptionsMenu_Text_TextSpeedDescription: 'How quickly messages\nappear.',
  OptionsMenu_Text_TextSpeedSlow: 'CALM',
  OptionsMenu_Text_TextSpeedMid: 'EVEN',
  OptionsMenu_Text_TextSpeedFast: 'BRISK',
  OptionsMenu_Text_BattleSceneLabel: 'EFFECTS',
  OptionsMenu_Text_BattleSceneDescription: 'Show or hide contest\neffects.',
  OptionsMenu_Text_BattleSceneOn: 'SHOW',
  OptionsMenu_Text_BattleSceneOff: 'HIDE',
  OptionsMenu_Text_BattleStyleLabel: 'SWAP RULE',
  OptionsMenu_Text_BattleStyleDescription: 'Ask before swapping\ncompanions, or not.',
  OptionsMenu_Text_BattleStyleShift: 'ASK',
  OptionsMenu_Text_BattleStyleSet: 'KEEP',
  OptionsMenu_Text_SoundModeLabel: 'AUDIO',
  OptionsMenu_Text_SoundModeDescription: 'Pick the audio output.',
  OptionsMenu_Text_SoundModeStereo: 'WIDE',
  OptionsMenu_Text_SoundModeMono: 'CENTRE',
  OptionsMenu_Text_ButtonModeLabel: 'BUTTONS',
  OptionsMenu_Text_ButtonModeDescription: 'Pick a button layout.',
  OptionsMenu_Text_ButtonModeNormal: 'STANDARD',
  OptionsMenu_Text_ButtonModeStartIs_x: 'START=X',
  OptionsMenu_Text_ButtonMode_l_is_a: 'L=A',
  OptionsMenu_Text_MessageBoxStyleLabel: 'BOX',
  OptionsMenu_Text_MessageBoxStyleDescription: 'Pick the message box look.',
  ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`OptionsMenu_Text_MessageBoxStyle_${String(i + 1).padStart(2, '0')}`, `STYLE ${i + 1}`])),
  OptionsMenu_Text_CloseLabel: 'DONE',
  OptionsMenu_Text_CloseDescription: 'Back to the field.',
  pl_msg_pokedex_seen: 'SPOTTED',
  pl_msg_pokedex_obtained: 'LOGGED',
  // The field guide (contracts 0.16.0): original labels under the Platinum Pokédex message names.
  ...Object.fromEntries(
    Object.entries({
      switch: 'SWAP\nGUIDE',
      search: 'FIND\nCOMPANIONS',
      male: 'He',
      female: 'She',
      westsea: 'West shore',
      eastsea: 'East shore',
      plantcloak: 'Leaf coat',
      sandycloak: 'Sand coat',
      trashcloak: 'Rag coat',
      oneform: 'Single look',
      blank: '',
      areaunknown: 'Range not known',
      morning: 'Dawn',
      day: 'Noon',
      night: 'Dusk',
      heightcheck_topscreen: 'Size Up',
      name: 'LETTER',
      type: 'KIND',
      form: 'BUILD',
      order: 'SORT',
      ok: 'GO',
      abc: 'ABC',
      def: 'DEF',
      ghi: 'GHI',
      jkl: 'JKL',
      mno: 'MNO',
      pqr: 'PQR',
      stu: 'STU',
      vwx: 'VWX',
      yz: 'YZ',
      numerical: 'By number',
      alphabetical: 'By letter',
      heaviest: 'Heavy first',
      lightest: 'Light first',
      tallest: 'Tall first',
      smallest: 'Short first',
      alphabetical_description: 'Only names starting\nwith these letters.',
      type_description: 'Only this kind.',
      body_description: 'Only this build.',
      listing_description: 'How to sort the guide.',
      nonefound: 'Nothing matched.',
      lucasheight: '4\'07"',
      dawnheight: '4\'05"',
      noname: '- - -',
      none: '...',
      anotherform: 'Pick another look.',
      info: 'ABOUT',
      area: 'RANGE',
      cry: 'CALL',
      size: 'SIZE',
      forms: 'LOOKS',
      quit: 'CLOSE',
      cancel: 'CLEAR',
      results: 'FOUND',
      normalforme: 'Plain look',
      attackforme: 'Strike look',
      defenseforme: 'Guard look',
      speedforme: 'Swift look',
      landforme: 'Ground look',
      skyforme: 'Sky look',
      alteredforme: 'Bent look',
      originforme: 'First look',
      rotom: 'BASE',
      rotomheat: 'OVEN',
      rotomwash: 'TUB',
      rotomfrost: 'ICEBOX',
      rotomfan: 'FAN',
      rotommow: 'MOWER',
      nonealphabetical: '- - -',
      nonetype: '- -',
    }).map(([k, v]) => [`pl_msg_pokedex_${k}`, v]),
  ),
  ...menuTexts,
  ...ribbonTexts,
  CommonStrings_Text_RepelsEffectWoreOff: 'The spray has faded.',
  CommonStrings_Text_Oh: 'Hm?',
  ...Object.fromEntries(['GEAR', 'TONICS', 'ORBS', 'LESSONS', 'SEEDS', 'LETTERS', 'BATTLE', 'KEEPSAKES'].map((t, i) => [`pl_msg_00000395_0000${i}`, t])),
  ...Object.fromEntries(
    ['CLOCK', 'SUMS', 'NOTES', 'STEPS', 'TEAM', 'BOND', 'SEEKER', 'SEED MAP', 'NURSERY', 'HISTORY', 'TALLY', 'DIAL CLOCK', 'MAP PINS', 'NEARBY', 'COIN', 'MOVE CHART', 'CALENDAR', 'DOTS', 'WHEEL', 'RECORDS', 'TIMER', 'TINT', 'PAIRING', 'STOPWATCH', 'ALARM'].map((t, i) => [
      `pl_msg_00000457_${String(i).padStart(5, '0')}`,
      t,
    ]),
  ),
}).map(([name, text]) => ({ id: `fixture:${name}`, text }));
const sound = fixtureSound();
for (const [path, bytes] of Object.entries(sound.files)) {
  mkdirSync(join(OUT, path, '..'), { recursive: true });
  writeFileSync(join(OUT, path), bytes);
}

const data = {
  ...sound.records,
  cameras: [
    { id: id('CAM_OUTDOOR'), distance: 667, angle: [-59, 0, 0], projection: 'perspective', fovY: 16.2, near: 150, far: 900 },
    { id: id('CAM_INTERIOR'), distance: 1564, angle: [-50, 0, 0], projection: 'orthographic', fovY: 7, near: 150, far: 1735 },
  ],
  models: [
    { id: id('MODEL_ROOM'), gltf: id('models/room.gltf') },
    { id: id('MODEL_TOWN_WEST'), gltf: id('models/town-west.gltf') },
    { id: id('MODEL_TOWN_EAST'), gltf: id('models/town-east.gltf') },
    { id: id('MODEL_TABLE'), gltf: id('models/table.gltf') },
    { id: id('MODEL_HOUSE'), gltf: id('models/house.gltf') },
    { id: id('MODEL_DOOR'), gltf: id('models/door.gltf') },
    { id: id('MODEL_TITLE_LANTERN'), gltf: id('models/title-lantern.gltf') },
    ...Object.keys(starterScene.models).map((file) => ({ id: id(`MODEL_CHOOSE_STARTER_${file.slice('choose-starter-'.length, -'.gltf'.length).replace(/-/g, '_').toUpperCase()}`), gltf: id(`models/${file}`) })),
  ],
  props: [
    { id: id('PROP_TABLE'), model: id('MODEL_TABLE') },
    { id: id('PROP_HOUSE'), model: id('MODEL_HOUSE') },
    { id: id('PROP_DOOR'), model: id('MODEL_DOOR'), animations: { open: { clip: 'open', ticks: DOOR_FRAMES }, close: { clip: 'close', ticks: DOOR_FRAMES } } },
  ],
  areas: [
    // Fixture models embed their textures, so no texture sets.
    { id: id('AREA_INDOOR'), light: id('LIGHT_LAMP') },
    { id: id('AREA_OUTDOOR'), light: id('LIGHT_SUNNY') },
    { id: id('AREA_ROUTE'), light: id('LIGHT_SUNNY') },
  ],
  // Original light templates (fixture materials are unlit today; these exercise the record shape).
  // Wild encounters on the east grass (original species): 12 land slots, no water tables.
  encounters: [
    {
      id: id('ENC_ROUTE'),
      sourceIndex: 1,
      landRate: 30,
      land: Array.from({ length: 12 }, (_, i) => ({ species: id(i < 2 ? 'SPECIES_SKYLET' : 'SPECIES_BURROWBIT'), minLevel: 3 + (i % 3), maxLevel: 3 + (i % 3) })),
      surfRate: 0,
      surf: [],
      oldRod: { rate: 0, slots: [] },
      goodRod: { rate: 0, slots: [] },
      superRod: { rate: 0, slots: [] },
      variants: {},
    },
    {
      id: id('ENC_TOWN'),
      sourceIndex: 0,
      landRate: 20,
      land: Array.from({ length: 12 }, (_, i) => ({ species: id(i % 3 === 2 ? 'SPECIES_BURROWBIT' : 'SPECIES_SKYLET'), minLevel: 2 + (i % 2), maxLevel: 2 + (i % 2) })),
      surfRate: 0,
      surf: [],
      oldRod: { rate: 0, slots: [] },
      goodRod: { rate: 0, slots: [] },
      superRod: { rate: 0, slots: [] },
      variants: {
        day: [{ slot: 2, species: id('SPECIES_SKYLET') }],
        night: [
          { slot: 2, species: id('SPECIES_MOSSLET') },
          { slot: 3, species: id('SPECIES_MOSSLET') },
        ],
      },
    },
    {
      id: id('ENC_TERRAIN'),
      sourceIndex: 2,
      landRate: 0,
      land: [],
      surfRate: 30,
      surf: [
        { species: id('SPECIES_DRIPLING'), minLevel: 10, maxLevel: 20 },
        { species: id('SPECIES_SKYLET'), minLevel: 12, maxLevel: 14 },
        { species: id('SPECIES_DRIPLING'), minLevel: 15, maxLevel: 15 },
        { species: id('SPECIES_SKYLET'), minLevel: 20, maxLevel: 25 },
        { species: id('SPECIES_DRIPLING'), minLevel: 30, maxLevel: 35 },
      ],
      oldRod: { rate: 0, slots: [] },
      goodRod: { rate: 0, slots: [] },
      superRod: { rate: 0, slots: [] },
      variants: {},
    },
  ],
  // The behaviour bytes the fixture tiles use (names as the world expects). Facing a behaviour with
  // `interact` and pressing A runs its script (decomp Field_TileBehaviorToScript).
  tileBehaviors: Object.entries(B).map(([name, sourceIndex]) => ({
    id: id(`TILE_BEHAVIOR_${name}`),
    sourceIndex,
    name,
    ...(INTERACT[name] ? { interact: INTERACT[name] } : {}),
    ...(FIELD_MOVE[name] ? { fieldMove: FIELD_MOVE[name] } : {}),
  })),
  // Field effect renderers the terrain spawns (decomp FIELD_EFFECT_RENDERER_* index as sourceIndex).
  fieldEffects: [
    { id: id('FLDEFF_TRACKS'), sourceIndex: 0x0b, name: '0B', sprite: id('SPRITE_EFFECTS') },
    { id: id('FLDEFF_SURF_MOUNT'), sourceIndex: 0x0f, name: 'SURF_MOUNT', sprite: id('SPRITE_EFFECTS') },
    { id: id('FLDEFF_ROCK_CLIMB_MOUNT'), sourceIndex: 0x10, name: '10', sprite: id('SPRITE_EFFECTS') },
    { id: id('FLDEFF_SPLASH'), sourceIndex: 0x11, name: '11', sprite: id('SPRITE_EFFECTS'), animations: { splash: { clip: 'splash', ticks: 12 } } },
    { id: id('FLDEFF_MUD'), sourceIndex: 0x12, name: '12', sprite: id('SPRITE_EFFECTS'), animations: { mud: { clip: 'mud', ticks: 10 } } },
    { id: id('FLDEFF_RIPPLE'), sourceIndex: 0x15, name: '15', sprite: id('SPRITE_EFFECTS') },
    { id: id('FLDEFF_TALL_GRASS'), sourceIndex: 0x13, name: 'TALL_GRASS', sprite: id('SPRITE_EFFECTS'), animations: { rustle: { clip: 'rustle', ticks: 13 } } },
    { id: id('FLDEFF_VERY_TALL_GRASS'), sourceIndex: 0x18, name: 'VERY_TALL_GRASS', sprite: id('SPRITE_EFFECTS'), animations: { rustle: { clip: 'rustle', ticks: 13 } } },
    { id: id('FLDEFF_MUD_GRASS'), sourceIndex: 0x19, name: 'MUD_GRASS', sprite: id('SPRITE_EFFECTS'), animations: { rustle: { clip: 'rustle', ticks: 3 } } },
    // Destroy-obstacle animations (no renderer index: found by name).
    { id: id('FLDEFF_CUT'), name: 'CUT', sprite: id('SPRITE_EFFECTS'), animations: { cut: { clip: 'cut', ticks: 45 } } },
    { id: id('FLDEFF_ROCK_SMASH'), name: 'ROCK_SMASH', sprite: id('SPRITE_EFFECTS'), animations: { smash: { clip: 'smash', ticks: 45 } } },
  ],
  // Field weathers (contracts 0.8): clear, and a fog and a dark map for tests (no zone uses them).
  weathers: [
    { id: id('OVERWORLD_WEATHER_CLEAR'), sourceIndex: 0, name: 'CLEAR' },
    {
      id: id('OVERWORLD_WEATHER_FOG'),
      sourceIndex: 14,
      name: 'FOG',
      fog: { slope: 5, offset: 0x7c00, color: [0.8, 0.8, 0.85], alpha: 31, densities: Array.from({ length: 32 }, (_, i) => Math.min(127, i * 4)) },
    },
    { id: id('OVERWORLD_WEATHER_DARK_FLASH'), sourceIndex: 16, name: 'DARK_FLASH', darkness: { radius: 32 } },
    { id: id('OVERWORLD_WEATHER_RAINING'), sourceIndex: 2, name: 'RAINING', particles: { kind: 'rain', count: 16 } },
    { id: id('OVERWORLD_WEATHER_SNOWING'), sourceIndex: 5, name: 'SNOWING', particles: { kind: 'snow', count: 16 } },
    // A yearly weather (366 days from Jan 1, Feb 29 = day 59): snow until Feb 28, rain on Feb 29, then clear.
    {
      id: id('OVERWORLD_WEATHER_SNOWPOINT_CITY'),
      sourceIndex: 36,
      name: 'SNOWPOINT_CITY',
      yearly: Array.from({ length: 366 }, (_, day) => id(day < 59 ? 'OVERWORLD_WEATHER_SNOWING' : day === 59 ? 'OVERWORLD_WEATHER_RAINING' : 'OVERWORLD_WEATHER_CLEAR')),
    },
  ],
  lights: [
    {
      id: id('LIGHT_SUNNY'),
      lights: [{ color: [1, 0.95, 0.8], direction: [0.6, -0.8, 0] }, { color: [0.3, 0.4, 0.6], direction: [-0.6, 0.8, 0] }, null, null],
      diffuse: [0.6, 0.6, 0.6],
      ambient: [0.3, 0.32, 0.35],
      specular: [0.1, 0.1, 0.1],
      emission: [0.25, 0.25, 0.25],
      // Night until 6:00 and from 18:00, the template above in between (Platinum switches about 15 a day).
      schedule: [
        { until: 6 * 3600, ...FIXTURE_NIGHT },
        { until: 18 * 3600, lights: [{ color: [1, 0.95, 0.8], direction: [0.6, -0.8, 0] }, { color: [0.3, 0.4, 0.6], direction: [-0.6, 0.8, 0] }, null, null], diffuse: [0.6, 0.6, 0.6], ambient: [0.3, 0.32, 0.35], specular: [0.1, 0.1, 0.1], emission: [0.25, 0.25, 0.25] },
        { until: 24 * 3600, ...FIXTURE_NIGHT },
      ],
    },
    {
      id: id('LIGHT_LAMP'),
      lights: [{ color: [1, 0.85, 0.6], direction: [0, -0.8, -0.6] }, null, null, null],
      diffuse: [0.55, 0.5, 0.45],
      ambient: [0.4, 0.38, 0.35],
      specular: [0, 0, 0],
      emission: [0.3, 0.28, 0.25],
    },
  ],
  chunks: [
    {
      id: id('CHUNK_ROOM'),
      tiles: roomTiles,
      model: id('MODEL_ROOM'),
      props: [{ prop: id('PROP_TABLE'), position: [tx(13), 0, tx(15)], rotation: [0, 0, 0], scale: [1, 1, 1] }],
      terrain: flatTerrain,
    },
    {
      id: id('CHUNK_TOWN_WEST'),
      tiles: townWTiles,
      model: id('MODEL_TOWN_WEST'),
      props: [
        { prop: id('PROP_HOUSE'), position: [tx(11), 0, tileCenter(10)], rotation: [0, 0, 0], scale: [1, 1, 1] },
        // hinge at the west edge of the warp tile (10, 13), on the house's south face
        { prop: id('PROP_DOOR'), position: [tx(10), 0, tx(13) + 1], rotation: [0, 0, 0], scale: [1, 1, 1] },
      ],
      terrain: flatTerrain,
    },
    { id: id('CHUNK_TOWN_EAST'), tiles: townETiles, model: id('MODEL_TOWN_EAST'), props: [], terrain: flatTerrain },
    { id: id('CHUNK_ROUTE_WEST'), tiles: routeWTiles, model: id('MODEL_TOWN_WEST'), props: [], terrain: flatTerrain },
    { id: id('CHUNK_ROUTE_EAST'), tiles: routeETiles, model: id('MODEL_TOWN_EAST'), props: [], terrain: flatTerrain },
    { id: id('CHUNK_TERRAIN'), tiles: terrainTiles, model: id('MODEL_TOWN_WEST'), props: [], terrain: flatTerrain },
    { id: id('CHUNK_GROTTO'), tiles: grottoTiles, model: id('MODEL_ROOM'), props: [], terrain: flatTerrain },
  ],
  matrices: [
    { id: id('MATRIX_ROOM'), width: 1, height: 1, chunks: [id('CHUNK_ROOM')] },
    { id: id('MATRIX_TOWN'), width: 2, height: 1, chunks: [id('CHUNK_TOWN_WEST'), id('CHUNK_TOWN_EAST')] },
    { id: id('MATRIX_ROUTE'), width: 2, height: 1, chunks: [id('CHUNK_ROUTE_WEST'), id('CHUNK_ROUTE_EAST')], zones: [id('ROUTE_W'), id('ROUTE_E')] },
    { id: id('MATRIX_TERRAIN'), width: 1, height: 1, chunks: [id('CHUNK_TERRAIN')] },
    { id: id('MATRIX_GROTTO'), width: 1, height: 1, chunks: [id('CHUNK_GROTTO')] },
  ],
  sprites: [
    { id: id('SPRITE_HERO'), sourceIndex: 1, ...spriteAtlas('hero', [200, 60, 60], [250, 210, 170]) },
    { id: id('SPRITE_HERO_CYCLE'), sourceIndex: 4, ...spriteAtlas('hero-cycle', [60, 60, 200], [250, 210, 170]) },
    { id: id('SPRITE_HERO_SURF'), sourceIndex: 5, ...spriteAtlas('hero-surf', [60, 170, 200], [250, 210, 170]) },
    { id: id('SPRITE_HELPER'), sourceIndex: 2, ...spriteAtlas('helper', [80, 120, 200], [240, 200, 160]) },
    { id: id('SPRITE_GUIDE'), sourceIndex: 3, ...spriteAtlas('guide', [90, 160, 90], [230, 190, 150]) },
    // The Strength boulder's object graphics id is 0x54 on the DS (ov5_021DFF1C).
    { id: id('SPRITE_BOULDER'), sourceIndex: 0x54, ...spriteAtlas('boulder', [130, 120, 110], [150, 140, 130]) },
    { id: id('SPRITE_EFFECTS'), sourceIndex: 0x1000, ...effectAtlas() },
  ],
  movements: [
    { id: id('MV_GUIDE_APPROACH'), steps: [{ op: 'emote_exclamation_mark', count: 1 }, { op: 'walk_normal_west', count: 3 }] },
    { id: id('MV_GUIDE_LEAVE'), steps: [{ op: 'walk_normal_east', count: 3 }, { op: 'face_west', count: 1 }] },
    { id: id('MV_PLAYER_FACE_EAST'), steps: [{ op: 'face_east', count: 1 }] },
  ],
  flags: [
    { id: id('FLAG_TALKED_TO_HELPER'), initial: false, scope: 'saved' },
    { id: id('FLAG_HIDE_GUIDE'), initial: false, scope: 'saved' },
    { id: id('FLAG_NEW_GAME_DONE'), initial: false, scope: 'saved' },
    // Trainer flags: trainer sourceIndex + 0x550 (decomp TRAINER_DEFEATED_FLAGS_START).
    { id: id('FLAG_TRAINER_HIKER'), sourceIndex: 0x552, initial: false, scope: 'saved' },
    { id: id('FLAG_TRAINER_TWINS'), sourceIndex: 0x553, initial: false, scope: 'saved' },
    { id: id('FLAG_TRAINER_CAMPER'), sourceIndex: 0x554, initial: false, scope: 'saved' },
    { id: id('FLAG_TRAINER_PICNICKER'), sourceIndex: 0x555, initial: false, scope: 'saved' },
    { id: id('FLAG_MAP_LOCAL_0'), sourceIndex: 1, initial: false, scope: 'map' },
    // Fixed system flags by number (decomp FLAG_STRENGTH_ACTIVE 2402; Flash 2426 and Defog 2427, which the
    // weather also reads on map change: SystemFlag_CheckFlashActive / CheckDefogActive).
    { id: id('FLAG_STRENGTH_ACTIVE'), sourceIndex: 2402, initial: false, scope: 'saved' },
    { id: id('FLAG_FLASH_ACTIVE'), sourceIndex: 2426, initial: false, scope: 'saved' },
    { id: id('FLAG_DEFOG_ACTIVE'), sourceIndex: 2427, initial: false, scope: 'saved' },
    // The trainer card's star flags (decomp FLAG_GAME_COMPLETED 2404, FLAG_CONTEST_MASTER_COOL … _TOUGH 2408–2412)
    // and Rowan's Pokédex rating (FLAG_FIRST_ARRIVAL_ETERNA_CITY 2490).
    { id: id('FLAG_GAME_COMPLETED'), sourceIndex: 2404, initial: false, scope: 'saved' },
    ...['COOL', 'BEAUTY', 'CUTE', 'SMART', 'TOUGH'].map((c, i) => ({ id: id(`FLAG_CONTEST_MASTER_${c}`), sourceIndex: 2408 + i, initial: false, scope: 'saved' as const })),
    { id: id('FLAG_FIRST_ARRIVAL_ETERNA_CITY'), sourceIndex: 2490, initial: false, scope: 'saved' },
    { id: id('FLAG_ON_CYCLING_ROAD'), sourceIndex: 2452, initial: false, scope: 'saved' },
    { id: id('FLAG_FORCE_BIKING_IN_GATE'), sourceIndex: 2454, initial: false, scope: 'saved' },
  ],
  vars: [
    { id: id('VAR_SCENE'), initial: 0, scope: 'saved' },
    { id: id('VAR_ROOM_INTRO'), initial: 0, scope: 'saved' },
    { id: id('VAR_OBJ_GFX_ID_0'), sourceIndex: 0x4020, initial: 0, scope: 'saved' },
    { id: id('VAR_MAP_LOCAL_0'), sourceIndex: 0x4000, initial: 0, scope: 'map' },
    { id: id('VAR_PLAYER_STARTER'), sourceIndex: 0x4030, initial: 0, scope: 'saved' },
    { id: id('VAR_RESULT'), sourceIndex: 0x800c, initial: 0, scope: 'temp' },
    { id: id('VAR_MSG_PRE'), sourceIndex: 0x8000, initial: 0, scope: 'temp' },
    { id: id('VAR_MSG_POST'), sourceIndex: 0x8001, initial: 0, scope: 'temp' },
    { id: id('VAR_MSG_FEW'), sourceIndex: 0x8002, initial: 0, scope: 'temp' },
    { id: id('VAR_TRAINER_0'), sourceIndex: 0x8004, initial: 0, scope: 'temp' },
    { id: id('VAR_TRAINER_1'), sourceIndex: 0x8005, initial: 0, scope: 'temp' },
    { id: id('VAR_0x8004'), sourceIndex: 0x8004, initial: 0, scope: 'temp' },
    { id: id('VAR_0x8005'), sourceIndex: 0x8005, initial: 0, scope: 'temp' },
    { id: id('VAR_0x8006'), sourceIndex: 0x8006, initial: 0, scope: 'temp' },
  ],
  texts: [
    { id: id('Text_HelperHello'), text: 'Good morning, {var 0}!\nThe guide is waiting outside.' },
    { id: id('Text_HelperAgain'), text: 'Go on, the guide is east of here.' },
    { id: id('Text_TvShow'), text: 'A show about lanterns is on.{clear}It is very calm.' },
    { id: id('Text_GuideStop'), text: 'Wait! You should not walk into\nthe tall grass alone.' },
    { id: id('Text_GuideChoose'), text: 'Take one of these companions.\nWhich one will you pick?' },
    { id: id('Text_GuideConfirm'), text: 'Is this the one you want?' },
    { id: id('Text_GuideDone'), text: 'Take good care of it, {var 0}!' },
    { id: id('Text_GuideIdle'), text: 'The grass is safe with a companion.' },
    { id: id('Text_RoomIntro'), text: 'Morning light fills the room.' },
    ...mon.boxNameTexts,
    { id: id('Text_TownEcho'), text: 'You have walked around town {var 0} times.' },
    { id: id('Text_RivalBefore'), text: 'Let us see whose companion is braver!' },
    { id: id('Text_RivalDefeat'), text: 'Huh. Yours is braver.' },
    { id: id('Text_HikerBefore'), text: 'The hills made me strong. Ready?' },
    { id: id('Text_HikerDefeat'), text: 'Flattened like a pebble!' },
    { id: id('Text_HikerAfter'), text: 'Keep climbing, friend.' },
    { id: id('Text_TwinsBefore'), text: 'Two of us, one of you!' },
    { id: id('Text_TwinsDefeat'), text: 'We lost together.' },
    { id: id('Text_CamperBefore'), text: 'Our campfire is right here!' },
    { id: id('Text_CamperDefeat'), text: 'The fire went out.' },
    { id: id('Text_AceBefore'), text: 'Two companions, one plan.' },
    { id: id('Text_AceDefeat'), text: 'The plan fell apart.' },
    { id: id('Text_AceFirstDamage'), text: 'A scratch! Only a scratch.' },
    { id: id('Text_AceHalfHp'), text: 'Hold steady out there!' },
    { id: id('Text_AceLast'), text: 'My last one. Make it count!' },
    { id: id('Text_AceLastHalfHp'), text: 'Not like this...' },
    { id: id('Text_RouteNpc'), text: 'Nice day for a walk.' },
    { id: id('Text_PairDefeatA'), text: 'Our plan needed a third.' },
    { id: id('Text_PairDefeatB'), text: 'Back to the drawing board.' },
    { id: id('Text_TwinsDefeat1'), text: 'Pip: Oh! We lost!' },
    { id: id('Text_TwinsDefeat2'), text: 'Pim: Together, though.' },
    { id: id('Text_SixDefeatA'), text: 'Six was not enough.' },
    { id: id('Text_SixDefeatB'), text: 'Neither was mine.' },
    { id: id('Text_Pc'), text: 'The computer hums quietly.' },
    { id: id('Text_Tv'), text: 'A quiz show is on.' },
    { id: id('Text_TownMap'), text: 'A map of the region.' },
    { id: id('Text_Bookshelf'), text: 'Books about lanterns.' },
    { id: id('Text_TrashCan'), text: 'Empty. Nothing in here.' },
    ...uiTexts,
    ...mon.itemTexts,
    ...mon.pokemonTexts,
    { id: id('Text_ClerkHello'), text: 'Hello!\nWhat do you need today?' },
    { id: id('Text_HealerAsk'), text: 'Shall I rest your companions?' },
    { id: id('Text_HealerDone'), text: 'All rested. Safe travels!' },
    { id: id('Text_BlackOutRecover'), text: 'You made it home.\nRest up before heading out again.' },
    ...Object.entries({ Hiker: 'Mountaineer', Twins: 'Pair', Picnicker: 'Rambler', Camper: 'Scout', Rival: 'Rival' }).map(([k, v]) => ({ id: id(`Text_Class_${k}`), text: v })),
    { id: id('Text_HealerBye'), text: 'Come back any time.' },
    // The starter scene's bank (pl_msg 360 on Platinum): the VM titles the choice panel with entry 7.
    { id: id('Text_StarterIntro'), text: 'Three companions wait in these lanterns.{clear}' },
    { id: id('Text_StarterAsk0'), text: 'The moss one!\nWill you take it?' },
    { id: id('Text_StarterAsk1'), text: 'The ember one!\nWill you take it?' },
    { id: id('Text_StarterAsk2'), text: 'The drip one!\nWill you take it?' },
    { id: id('Text_StarterBlank'), text: ' ' },
    { id: id('Text_StarterPick'), text: 'Pick one!\nWhich companion will it be?' },
    ...battle.texts,
  ],
  textBanks: [
    {
      id: id('TEXT_BANK_CHOOSE_STARTER'),
      sourceIndex: 360,
      messages: ['Text_StarterIntro', 'Text_StarterAsk0', 'Text_StarterAsk1', 'Text_StarterAsk2', 'Text_StarterBlank', 'Text_StarterBlank', 'Text_StarterBlank', 'Text_StarterPick'].map(id),
    },
    ...battle.textBanks,
  ],
  species: mon.species,
  moves: mon.moves,
  abilities: mon.abilities,
  types: mon.types,
  natures: mon.natures,
  growthRates: mon.growthRates,
  items: mon.items,
  marts: mon.marts,
  // Parties with the DS PID derivation (fixture class numbers: hiker 9, twins 8, picnicker 5, camper 4, rival 63).
  trainers: [
    {
      id: id('TRAINER_HIKER'),
      sourceIndex: 2,
      name: 'Rook',
      class: id('TRAINER_CLASS_HIKER'),
      gender: 'male',
      double: false,
      party: mon.trainerParty(2, 9, false, [{ species: 'SPECIES_BURROWBIT', level: 4 }]),
      items: [],
      ai: 1,
      classPrize: 8,
      className: id('Text_Class_Hiker'),
      messages: { preBattle: id('Text_HikerBefore'), defeat: id('Text_HikerDefeat'), postBattle: id('Text_HikerAfter') },
    },
    {
      id: id('TRAINER_TWINS'),
      sourceIndex: 3,
      name: 'Pip & Pim',
      class: id('TRAINER_CLASS_TWINS'),
      gender: 'female',
      double: true,
      party: mon.trainerParty(3, 8, true, [
        { species: 'SPECIES_SKYLET', level: 3 },
        { species: 'SPECIES_SKYLET', level: 3 },
      ]),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Twins'),
      messages: { preDoubleBattle1: id('Text_TwinsBefore'), preDoubleBattle2: id('Text_TwinsBefore'), defeat: id('Text_TwinsDefeat'), doubleBattleDefeat1: id('Text_TwinsDefeat1'), doubleBattleDefeat2: id('Text_TwinsDefeat2') },
    },
    {
      id: id('TRAINER_PICNICKER'),
      sourceIndex: 5,
      name: 'Fern',
      class: id('TRAINER_CLASS_PICNICKER'),
      gender: 'female',
      double: false,
      party: mon.trainerParty(5, 5, true, [{ species: 'SPECIES_MOSSLET', level: 4 }]),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Picnicker'),
      messages: { preBattle: id('Text_CamperBefore'), defeat: id('Text_CamperDefeat') },
    },
    {
      id: id('TRAINER_CAMPER'),
      sourceIndex: 4,
      name: 'Ash',
      class: id('TRAINER_CLASS_CAMPER'),
      gender: 'male',
      double: false,
      party: mon.trainerParty(4, 4, false, [{ species: 'SPECIES_SKYLET', level: 4 }]),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Camper'),
      messages: { preBattle: id('Text_CamperBefore'), defeat: id('Text_CamperDefeat') },
    },
    {
      id: id('TRAINER_RIVAL_FIRST'),
      sourceIndex: 1,
      name: 'Bo',
      class: id('TRAINER_CLASS_RIVAL'),
      gender: 'male',
      double: false,
      party: mon.trainerParty(1, 63, false, [{ species: 'SPECIES_EMBERKIT', level: 5, ivScale: 30, moves: ['BOP', 'STARE'], item: 'ITEM_TONIC' }]),
      items: [id('ITEM_TONIC')],
      ai: 7,
      classPrize: 8,
      className: id('Text_Class_Rival'),
      messages: { preBattle: id('Text_RivalBefore'), defeat: id('Text_RivalDefeat') },
    },
    {
      // A trainer with two Pokémon and every in-battle line (decomp TRMSG_FIRST_DAMAGE … LAST_BATTLER_HALF_HP); on no map.
      id: id('TRAINER_ACE'),
      sourceIndex: 6,
      name: 'Vale',
      class: id('TRAINER_CLASS_CAMPER'),
      gender: 'male',
      double: false,
      party: mon.trainerParty(6, 4, false, [
        { species: 'SPECIES_SKYLET', level: 4 },
        { species: 'SPECIES_BURROWBIT', level: 4 },
      ]),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Camper'),
      messages: {
        preBattle: id('Text_AceBefore'),
        defeat: id('Text_AceDefeat'),
        firstDamage: id('Text_AceFirstDamage'),
        activeBattlerHalfHp: id('Text_AceHalfHp'),
        lastBattler: id('Text_AceLast'),
        lastBattlerHalfHp: id('Text_AceLastHalfHp'),
      },
    },
    // Doubles (on no map): a pair of enemy trainers with two companions each, and a one-companion AI partner
    // (decomp BATTLE_TYPE_TRAINER_WITH_AI_PARTNER, 75).
    {
      id: id('TRAINER_PAIR_A'),
      sourceIndex: 7,
      name: 'Rue',
      class: id('TRAINER_CLASS_CAMPER'),
      gender: 'male',
      double: false,
      party: mon.trainerParty(7, 4, false, [
        { species: 'SPECIES_SKYLET', level: 4 },
        { species: 'SPECIES_BURROWBIT', level: 5 },
      ]),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Camper'),
      messages: { defeat: id('Text_PairDefeatA') },
    },
    {
      id: id('TRAINER_PAIR_B'),
      sourceIndex: 8,
      name: 'Ivy',
      class: id('TRAINER_CLASS_PICNICKER'),
      gender: 'female',
      double: false,
      party: mon.trainerParty(8, 5, true, [
        { species: 'SPECIES_MOSSLET', level: 4 },
        { species: 'SPECIES_SKYLET', level: 6 },
      ]),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Picnicker'),
      messages: { defeat: id('Text_PairDefeatB') },
    },
    {
      id: id('TRAINER_PARTNER'),
      sourceIndex: 9,
      name: 'Wren',
      class: id('TRAINER_CLASS_HIKER'),
      gender: 'male',
      double: false,
      party: mon.trainerParty(9, 9, false, [{ species: 'SPECIES_DRIPLING', level: 9 }]),
      items: [],
      ai: 7,
      classPrize: 8,
      className: id('Text_Class_Hiker'),
      messages: {},
    },
    // Type 19 (on no map): two trainers with six companions each, for the type 19 roster of 12.
    {
      id: id('TRAINER_SIX_A'),
      sourceIndex: 11,
      name: 'Oak',
      class: id('TRAINER_CLASS_CAMPER'),
      gender: 'male',
      double: false,
      party: mon.trainerParty(11, 4, false, ['SPECIES_SKYLET', 'SPECIES_BURROWBIT', 'SPECIES_MOSSLET', 'SPECIES_SKYLET', 'SPECIES_BURROWBIT', 'SPECIES_EMBERKIT'].map((species) => ({ species, level: 3 }))),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Camper'),
      messages: { defeat: id('Text_SixDefeatA') },
    },
    {
      id: id('TRAINER_SIX_B'),
      sourceIndex: 12,
      name: 'Elm',
      class: id('TRAINER_CLASS_PICNICKER'),
      gender: 'female',
      double: false,
      party: mon.trainerParty(12, 5, true, ['SPECIES_MOSSLET', 'SPECIES_SKYLET', 'SPECIES_DRIPLING', 'SPECIES_MOSSLET', 'SPECIES_SKYLET', 'SPECIES_DRIPLING'].map((species) => ({ species, level: 3 }))),
      items: [],
      ai: 1,
      classPrize: 4,
      className: id('Text_Class_Picnicker'),
      messages: { defeat: id('Text_SixDefeatB') },
    },
  ],
  textureAnimations: [],
  aiScripts: [fixtureAiScript((s) => id(s) as `${string}:${string}`, mon.moves.map((m) => m.effect), mon.items.map((i) => i.holdEffect))],
  ui2d: [
    { id: id('ui2d/choose_starter/cursor'), atlas: id('ui2d/choose_starter/cursor.png'), cells: [{ x: 0, y: 0, w: 32, h: 32, ox: 16, oy: 16 }] },
    { id: id('ui2d/choose_starter/preview_window'), atlas: id('ui2d/choose_starter/preview_window.png'), cells: [{ x: 0, y: 0, w: 128, h: 128, ox: 0, oy: 0 }] },
    { id: id('ui2d/choose_starter/text_colors'), atlas: id('ui2d/choose_starter/text_colors.png'), cells: [{ x: 0, y: 0, w: 16, h: 1, ox: 0, oy: 0 }] },
    {
      id: id('ui2d/trainer_case/card'),
      atlas: id('ui2d/trainer_case/card.png'),
      cells: card.names.map((_, i) => ({ x: i * 256, y: 0, w: 256, h: card.height, ox: 0, oy: 0 })),
      names: card.names,
      textColors: card.textColors,
    },
    ...boxArt.records,
    { id: id('ui2d/summary/ribbons'), atlas: id('ui2d/summary/ribbons.png'), cells: ribbonSheet.cells },
    // Our own sparkle emitters for the evolution scene: a ring that bursts out while the silhouettes swap
    // (emitter 1, about 3 s), a few slow motes (0, 2–12 reuse the ring's settings as single bursts).
    {
      id: id('ui2d/evolution/particles'),
      atlas: id('ui2d/evolution/particles.png'),
      cells: [{ x: 0, y: 0, w: 8, h: 8, ox: 0, oy: 0 }],
      emitters: Array.from({ length: 13 }, (_, i) => ({
        emission: 2,
        drawType: 0,
        aspect: 1,
        dbbScale: 0,
        scaleAnimDir: 0,
        circleAxis: 0,
        axis: [0, 0, 1] as [number, number, number],
        position: [0, 0, 0] as [number, number, number],
        count: i === 1 ? 2 : 1,
        radius: 0.5,
        velPos: 0.1,
        velAxis: 0,
        scale: 0.25,
        color: '#f8f0a0',
        alpha: 31,
        startDelay: 0,
        life: i === 1 ? 60 : 1,
        particleLife: 30,
        interval: 2,
        air: 500,
        texture: 0,
        hideParent: false,
        alphaAnim: { start: 31, mid: 31, end: 0, in: 1, out: 128 },
      })),
    },
    // The Poffin cooking's cue and steam timings (packages/menus poffin-cooking.ts reads their animations), our own: the
    // sparkle as every frame; START 24 frames, the splash 8, the pour 12, DONE 16, each puff 10.
    ...(
      [
        ['interface', [24, 8, 12]],
        ['done', [16]],
        ['puff0', [10, 10, 10]],
        ['puff1', [10, 10, 10]],
        ['puff2', [10, 10]],
      ] as [string, number[]][]
    ).map(([name, lengths]) => ({
      id: id(`ui2d/poffin_cooking/${name}`),
      atlas: id('ui2d/evolution/particles.png'),
      cells: [{ x: 0, y: 0, w: 8, h: 8, ox: 4, oy: 4 }],
      animations: lengths.map((ticks) => ({ mode: 'forward' as const, loopStart: 0, frames: [{ cell: 0, ticks }] })),
    })),
  ],
  pokemonSprites: fixtureStarterSprites(mon.species),
  fonts: [{ id: id('FONT_MESSAGE'), atlas: id('fonts/message.png'), ...fontMetrics }],
  titleScreens: [
    {
      id: id('TITLE_SCREEN'),
      model: {
        model: id('MODEL_TITLE_LANTERN'),
        camera: { position: [-50, 80, 330], target: [0, 50, 0], fovY: 32, near: 1, far: 2000 },
        lights: [{ direction: [0.4, -0.5, -0.77], color: [1, 1, 1] }],
      },
    },
  ],
  newGame: [
    {
      id: id('NEW_GAME'),
      zone: id('ROOM'),
      x: 14,
      z: 16,
      facing: 'up',
      money: 3000,
      label: id('NewGame_Init'),
      names: { player: 'Ari', rival: 'Bo' },
      gender: 'male',
      playerSprite: { male: id('SPRITE_HERO'), female: id('SPRITE_HERO') },
      playerCycleSprite: { male: id('SPRITE_HERO_CYCLE'), female: id('SPRITE_HERO_CYCLE') },
      playerSurfSprite: { male: id('SPRITE_HERO_SURF'), female: id('SPRITE_HERO_SURF') },
      messageFont: id('FONT_MESSAGE'),
      trainerApproach: id('Battles_ApproachingTrainer'),
      pockets: mon.pockets,
      boxNames: mon.boxNameTexts.map((t) => t.id),
      pokeBall: id('ITEM_CAPTURE_ORB'),
      premierBall: id('ITEM_BONUS_ORB'),
      pokedexUnknown: mon.dexUnknown,
      repelWoreOff: id('Common_RepelWoreOff'),
      hatchEgg: id('Common_HatchEgg'),
      ribbons: ribbonRecords.map((r) => ({ name: id(r.name), description: id(r.description) })),
      // Original game record tables: event e scores e + 1; even record ids cap at the high limit.
      gameRecords: { scoreIncrements: Array.from({ length: GAME_RECORDS.scoreEvents }, (_, e) => e + 1), highLimit: Array.from({ length: GAME_RECORDS.count }, (_, i) => i % 2 === 0) },
      // Original sticker tables (contracts SealTables): stickers 1–49 sell for 40, a stand stock per weekday, no NPC shells.
      seals: {
        types: Array.from({ length: SEALS.count + 1 }, (_, i) => ({ sheet: 184 + Math.max(0, i - 1), name: i, particle: 37 + Math.max(0, i - 1), alphabet: i >= 50 && i <= 77, price: i >= 1 && i <= 49 ? 40 : 0, description: i >= 1 && i <= 49 ? i - 1 : 0 })),
        marts: Array.from({ length: 7 }, (_, d) => [1 + d, 8 + d, 15 + d, 22 + d]),
        trainerCapsules: [],
        delays: [0, 4, 8, 12, 12, 10, 10],
        // The send-out bursts: particles 1–17 for the balls, 36 for the rest.
        ballOpen: [...Array.from({ length: 17 }, (_, i) => ({ particle: i + 1, emitters: 1 })), ...Array.from({ length: 3 }, () => ({ particle: 36, emitters: 1 }))],
      },
      // Original objectives (contracts ObjectiveTables): after the intro, the guide (the Eterna arrival flag stands in), a badge.
      objectives: {
        title: id('OpenSinnoh_Objective_Title'),
        explore: id('OpenSinnoh_Objective_Explore'),
        steps: [
          { text: id('OpenSinnoh_Objective_WakeUp'), done: [{ kind: 'var', var: id('VAR_ROOM_INTRO'), atLeast: 1 }] },
          { text: id('OpenSinnoh_Objective_FindGuide'), done: [{ kind: 'flag', flag: id('FLAG_FIRST_ARRIVAL_ETERNA_CITY') }] },
          { text: id('OpenSinnoh_Objective_CoalToken'), done: [{ kind: 'badge', badge: id('BADGE_ID_COAL') }] },
        ],
      },
    },
  ],
  zones: [
    {
      id: id('ROOM'),
      name: 'Room',
      matrix: id('MATRIX_ROOM'),
      area: id('AREA_INDOOR'),
      camera: id('CAM_INTERIOR'),
      mapType: 'indoors',
      weather: id('OVERWORLD_WEATHER_CLEAR'),
      music: { day: id('SEQ_TOWN'), night: id('SEQ_TOWN') },
      flags: { bike: false, running: false, escapeRope: false, fly: false },
      blackOut: { spawn: 1, x: 15, z: 18, label: id('Room_BlackOutRecover') },
      mapScripts: { onFrame: [{ var: id('VAR_ROOM_INTRO'), value: 0, label: id('Room_OnFrame_Intro') }] },
      events: {
        bgs: [{ label: id('Room_TV'), kind: 'interact', x: 12, z: 12, y: 0, facing: 'up' }],
        objects: [
          {
            localId: 0,
            sprite: id('SPRITE_HELPER'),
            movementType: 0,
            trainerType: 0,
            label: id('Room_Helper'),
            facing: 'down',
            data: [0, 0, 0],
            range: { x: 0, z: 0 },
            x: 18,
            z: 14,
            y: 0,
          },
        ],
        warps: [{ x: 15, z: 20, toZone: id('TOWN'), toWarp: 0 }],
        coords: [],
      },
    },
    {
      id: id('TOWN'),
      name: 'Town',
      matrix: id('MATRIX_TOWN'),
      area: id('AREA_OUTDOOR'),
      camera: id('CAM_OUTDOOR'),
      mapType: 'town',
      weather: id('OVERWORLD_WEATHER_CLEAR'),
      music: { day: id('SEQ_TOWN'), night: id('SEQ_TOWN') },
      flags: { bike: true, running: true, escapeRope: false, fly: false },
      encounters: id('ENC_TOWN'),
      mapScripts: { onTransition: id('Town_OnTransition'), onFrame: [] },
      events: {
        bgs: [],
        objects: [
          {
            localId: 0,
            sprite: { var: id('VAR_OBJ_GFX_ID_0') },
            movementType: 0,
            trainerType: 0,
            hideFlag: id('FLAG_HIDE_GUIDE'),
            label: id('Town_Guide'),
            facing: 'left',
            data: [0, 0, 0],
            range: { x: 0, z: 0 },
            x: 32 + 12,
            z: 16,
            y: 0,
          },
        ],
        warps: [{ x: 10, z: 13, toZone: id('ROOM'), toWarp: 0 }],
        coords: [{ label: id('Town_GuideScene'), x: 32 + 6, z: 12, width: 1, length: 8, y: 0, var: id('VAR_SCENE'), value: 0 }],
      },
    },
    {
      id: id('TERRAIN'),
      name: 'Terrain',
      matrix: id('MATRIX_TERRAIN'),
      area: id('AREA_OUTDOOR'),
      camera: id('CAM_OUTDOOR'),
      mapType: 'route',
      weather: id('OVERWORLD_WEATHER_CLEAR'),
      music: { day: id('SEQ_ROUTE'), night: id('SEQ_ROUTE') },
      flags: { bike: true, running: true, escapeRope: false, fly: true },
      encounters: id('ENC_TERRAIN'),
      mapScripts: { onFrame: [] },
      events: {
        bgs: [],
        objects: [
          {
            localId: 0,
            sprite: id('SPRITE_BOULDER'),
            movementType: 0,
            trainerType: 0,
            label: id('FieldMoves_Boulder'),
            facing: 'down',
            data: [0, 0, 0],
            range: { x: 0, z: 0 },
            x: 12,
            z: 13,
            y: 0,
          },
        ],
        warps: [{ x: 3, z: 28, toZone: id('GROTTO'), toWarp: 0 }],
        coords: [],
      },
    },
    {
      id: id('GROTTO'),
      name: 'Grotto',
      matrix: id('MATRIX_GROTTO'),
      area: id('AREA_INDOOR'),
      camera: id('CAM_INTERIOR'),
      mapType: 'cave',
      weather: id('OVERWORLD_WEATHER_CLEAR'),
      music: { day: id('SEQ_ROUTE'), night: id('SEQ_ROUTE') },
      flags: { bike: false, running: true, escapeRope: true, fly: false },
      mapScripts: { onFrame: [] },
      events: { bgs: [], objects: [], warps: [{ x: 16, z: 27, toZone: id('TERRAIN'), toWarp: 0 }], coords: [] },
    },
    {
      // A shop and a healer on the room's chunk (reached by replay warps): the mart and heal flows.
      id: id('SHOP'),
      name: 'Shop',
      matrix: id('MATRIX_ROOM'),
      area: id('AREA_INDOOR'),
      camera: id('CAM_INTERIOR'),
      mapType: 'indoors',
      weather: id('OVERWORLD_WEATHER_CLEAR'),
      music: { day: id('SEQ_TOWN'), night: id('SEQ_TOWN') },
      flags: { bike: false, running: false, escapeRope: false, fly: false },
      mapScripts: { onFrame: [] },
      events: {
        bgs: [],
        objects: [npc(0, 16, 13, 'down', { movementType: 0, label: 'Shop_Clerk' }), npc(1, 19, 13, 'down', { movementType: 0, label: 'Shop_Healer' })],
        warps: [],
        coords: [],
      },
    },
    routeZone('ROUTE_W', 'AREA_OUTDOOR', 'ENC_ROUTE', []),
    routeZone('ROUTE_E', 'AREA_ROUTE', undefined, [
      // Trainers (trainerType 1, sight = data[0]); the twins are one double trainer on two objects.
      npc(0, 42, 10, 'down', { movementType: 15, trainerType: 1, sight: 4, trainer: ['TRAINER_HIKER', 0], label: 'Trainer_Hiker' }),
      npc(1, 50, 10, 'down', { movementType: 15, trainerType: 1, sight: 3, trainer: ['TRAINER_TWINS', 0], label: 'Trainer_Twins' }),
      npc(2, 51, 10, 'down', { movementType: 15, trainerType: 1, sight: 3, trainer: ['TRAINER_TWINS', 1], label: 'Trainer_Twins' }),
      // Two singles that both see (53,20): the camper looks west along z 20, the picnicker north along x 53.
      npc(3, 56, 20, 'left', { movementType: 16, trainerType: 1, sight: 3, trainer: ['TRAINER_CAMPER', 0], label: 'Trainer_Camper' }),
      npc(4, 53, 24, 'up', { movementType: 14, trainerType: 1, sight: 4, trainer: ['TRAINER_PICNICKER', 0], label: 'Trainer_Picnicker' }),
      // Movement types: wander (range 2), look around, walk back and forth (3 tiles south).
      npc(5, 40, 24, 'down', { movementType: 3, range: { x: 2, z: 2 }, label: 'Route_Npc' }),
      npc(6, 36, 24, 'down', { movementType: 2, label: 'Route_Npc' }),
      npc(7, 60, 4, 'down', { movementType: 20, range: { x: 0, z: 3 }, label: 'Route_Npc' }),
    ]),
  ],
};

function npc(
  localId: number,
  x: number,
  z: number,
  facing: string,
  o: { movementType: number; trainerType?: number; sight?: number; trainer?: [string, number]; label: string; range?: { x: number; z: number } },
) {
  return {
    localId,
    sprite: id(o.trainerType ? 'SPRITE_GUIDE' : 'SPRITE_HELPER'),
    movementType: o.movementType,
    trainerType: o.trainerType ?? 0,
    ...(o.trainer ? { trainer: { id: id(o.trainer[0]), battler: o.trainer[1] } } : {}),
    label: id(o.label),
    facing,
    data: [o.sight ?? 0, 0, 0],
    range: o.range ?? { x: 0, z: 0 },
    x,
    z,
    y: 0,
  };
}

function routeZone(name: string, area: string, encounters: string | undefined, objects: ReturnType<typeof npc>[]) {
  return {
    id: id(name),
    name: 'Route',
    matrix: id('MATRIX_ROUTE'),
    area: id(area),
    camera: id('CAM_OUTDOOR'),
    mapType: 'route',
    weather: id('OVERWORLD_WEATHER_CLEAR'),
    music: { day: id('SEQ_ROUTE'), night: id('SEQ_ROUTE') },
    flags: { bike: true, running: true, escapeRope: false, fly: false },
    ...(encounters ? { encounters: id(encounters) } : {}),
    mapScripts: { onFrame: [] },
    events: { bgs: [], objects, warps: [], coords: [] },
  };
}

// Battles_ApproachingTrainer is a placeholder until the VM has the trainer ops: then it follows
// the decomp flow (get_approaching_trainer_id, start_approaching_trainer_task, wait, battle, set_trainer_flag).
const scripts = `# fixture scripts (original). Ops are decomp command names in snake_case.
fixture:NewGame_Init::
  set_flag flag(fixture:FLAG_NEW_GAME_DONE)
  end

fixture:Common_RepelWoreOff::
  lock_all
  message text(fixture:CommonStrings_Text_RepelsEffectWoreOff)
  wait_button
  close_message
  release_all
  end

fixture:Common_HatchEgg::
  lock_all
  message text(fixture:CommonStrings_Text_Oh)
  wait_ab_press
  close_message
  hatch_egg
  release_all
  end

fixture:Room_OnFrame_Intro::
  lock_all
  set_var_from_value var(fixture:VAR_ROOM_INTRO), 1
  message text(fixture:Text_RoomIntro)
  wait_button
  close_message
  release_all
  end

fixture:Room_Helper::
  lock_all
  face_player
  check_flag flag(fixture:FLAG_TALKED_TO_HELPER)
  go_to_if "eq", label(fixture:Room_Helper_Again)
  set_flag flag(fixture:FLAG_TALKED_TO_HELPER)
  buffer_player_name 0
  message text(fixture:Text_HelperHello)
  wait_button
  close_message
  release_all
  end

fixture:Room_Helper_Again::
  message text(fixture:Text_HelperAgain)
  wait_button
  close_message
  release_all
  end

fixture:Shop_Clerk::
  lock_all
  face_player
  message text(fixture:Text_ClerkHello)
  close_message_without_erasing
  poke_mart_common 1
  release_all
  end

fixture:Shop_Healer::
  lock_all
  face_player
  message text(fixture:Text_HealerAsk)
  show_yes_no_menu var(fixture:VAR_RESULT)
  compare_var_to_value var(fixture:VAR_RESULT), 0
  go_to_if "ne", label(fixture:Shop_Healer_No)
  count_party_non_eggs var(fixture:VAR_0x8006)
  play_pokecenter_healing_animation var(fixture:VAR_0x8006)
  heal_party
  message text(fixture:Text_HealerDone)
  wait_button
  close_message
  release_all
  end

fixture:Room_BlackOutRecover::
  lock_all
  heal_party
  message text(fixture:Text_BlackOutRecover)
  wait_button
  close_message
  release_all
  end

fixture:Shop_Healer_No::
  message text(fixture:Text_HealerBye)
  wait_button
  close_message
  release_all
  end

fixture:Room_TV::
  lock_all
  message text(fixture:Text_TvShow)
  wait_button
  close_message
  release_all
  end

fixture:Town_OnTransition::
  set_var_from_value var(fixture:VAR_OBJ_GFX_ID_0), 3
  add_var var(fixture:VAR_MAP_LOCAL_0), 1
  end

fixture:Town_GuideScene::
  lock_all
  apply_movement 0, movement(fixture:MV_GUIDE_APPROACH)
  apply_movement 255, movement(fixture:MV_PLAYER_FACE_EAST)
  wait_movement
  message text(fixture:Text_GuideStop)
  wait_button
  message text(fixture:Text_GuideChoose)
  wait_button
  close_message
  go_to label(fixture:Town_GuideScene_Choose)

fixture:Town_GuideScene_Choose::
  start_choose_starter_scene
  message text(fixture:Text_GuideConfirm)
  show_yes_no_menu var(fixture:VAR_RESULT)
  close_message
  compare_var_to_value var(fixture:VAR_RESULT), 1
  go_to_if "eq", label(fixture:Town_GuideScene_Choose)
  save_chosen_starter
  get_player_starter_species var(fixture:VAR_RESULT)
  give_pokemon var(fixture:VAR_RESULT), 5, 0, var(fixture:VAR_RESULT)
  buffer_player_name 0
  message text(fixture:Text_GuideDone)
  wait_button
  close_message
  apply_movement 0, movement(fixture:MV_GUIDE_LEAVE)
  wait_movement
  set_var_from_value var(fixture:VAR_SCENE), 1
  release_all
  end

fixture:Trainer_Hiker::
  go_to label(fixture:Battles_Trainer)

fixture:Trainer_Twins::
  go_to label(fixture:Battles_Trainer)

fixture:Trainer_Camper::
  go_to label(fixture:Battles_Trainer)

fixture:Trainer_Picnicker::
  go_to label(fixture:Battles_Trainer)

# Talking to a trainer (an original script on the decomp's trainer commands).
fixture:Battles_Trainer::
  lock_all
  face_player
  get_trainer_id var(fixture:VAR_TRAINER_0)
  check_trainer_flag var(fixture:VAR_TRAINER_0)
  go_to_if "eq", label(fixture:Battles_PostBattle)
  check_is_trainer_double_battle var(fixture:VAR_RESULT)
  compare_var_to_value var(fixture:VAR_RESULT), 1
  go_to_if "ne", label(fixture:Battles_Encounter)
  check_has_two_alive_mons var(fixture:VAR_RESULT)
  compare_var_to_value var(fixture:VAR_RESULT), 0
  go_to_if "eq", label(fixture:Battles_NotEnough)
  go_to label(fixture:Battles_Encounter)

fixture:Battles_Encounter::
  play_trainer_encounter_bgm var(fixture:VAR_TRAINER_0)
  open_message
  get_trainer_message_types var(fixture:VAR_MSG_PRE), var(fixture:VAR_MSG_POST), var(fixture:VAR_MSG_FEW)
  print_trainer_dialogue var(fixture:VAR_TRAINER_0), var(fixture:VAR_MSG_PRE)
  close_message
  set_move_code_for_facing_direction
  start_trainer_battle var(fixture:VAR_TRAINER_0), 0
  check_won_battle var(fixture:VAR_RESULT)
  set_trainer_flag var(fixture:VAR_TRAINER_0)
  release_all
  end

fixture:Battles_PostBattle::
  open_message
  get_trainer_message_types var(fixture:VAR_MSG_PRE), var(fixture:VAR_MSG_POST), var(fixture:VAR_MSG_FEW)
  print_trainer_dialogue var(fixture:VAR_TRAINER_0), var(fixture:VAR_MSG_POST)
  wait_button
  close_message
  release_all
  end

fixture:Battles_NotEnough::
  open_message
  get_trainer_message_types var(fixture:VAR_MSG_PRE), var(fixture:VAR_MSG_POST), var(fixture:VAR_MSG_FEW)
  print_trainer_dialogue var(fixture:VAR_TRAINER_0), var(fixture:VAR_MSG_FEW)
  wait_ab_press
  close_message
  release_all
  end

# A trainer spotted the player (the world starts this after the sighting).
fixture:Battles_ApproachingTrainer::
  lock_all
  get_approaching_trainer_type var(fixture:VAR_RESULT)
  compare_var_to_value var(fixture:VAR_RESULT), 1
  go_to_if "eq", label(fixture:Battles_ApproachDouble)
  compare_var_to_value var(fixture:VAR_RESULT), 2
  go_to_if "eq", label(fixture:Battles_ApproachTwo)
  get_approaching_trainer_id 0, var(fixture:VAR_TRAINER_0)
  play_trainer_encounter_bgm var(fixture:VAR_TRAINER_0)
  start_approaching_trainer_task 0
  call label(fixture:Battles_WaitApproach0)
  open_message
  print_trainer_dialogue var(fixture:VAR_TRAINER_0), 0
  close_message
  start_trainer_battle var(fixture:VAR_TRAINER_0), 0
  check_won_battle var(fixture:VAR_RESULT)
  set_trainer_flag var(fixture:VAR_TRAINER_0)
  release_all
  end

fixture:Battles_ApproachDouble::
  get_approaching_trainer_id 0, var(fixture:VAR_TRAINER_0)
  play_trainer_encounter_bgm var(fixture:VAR_TRAINER_0)
  start_approaching_trainer_task 0
  start_approaching_trainer_task 1
  call label(fixture:Battles_WaitApproach0)
  call label(fixture:Battles_WaitApproach1)
  open_message
  print_trainer_dialogue var(fixture:VAR_TRAINER_0), 3
  close_message
  start_trainer_battle var(fixture:VAR_TRAINER_0), 0
  check_won_battle var(fixture:VAR_RESULT)
  set_trainer_flag var(fixture:VAR_TRAINER_0)
  release_all
  end

fixture:Battles_ApproachTwo::
  get_approaching_trainer_id 0, var(fixture:VAR_TRAINER_0)
  play_trainer_encounter_bgm var(fixture:VAR_TRAINER_0)
  start_approaching_trainer_task 0
  call label(fixture:Battles_WaitApproach0)
  open_message
  print_trainer_dialogue var(fixture:VAR_TRAINER_0), 0
  close_message
  start_approaching_trainer_task 1
  call label(fixture:Battles_WaitApproach1)
  get_approaching_trainer_id 1, var(fixture:VAR_TRAINER_1)
  open_message
  print_trainer_dialogue var(fixture:VAR_TRAINER_1), 0
  close_message
  start_trainer_battle var(fixture:VAR_TRAINER_0), var(fixture:VAR_TRAINER_1)
  check_won_battle var(fixture:VAR_RESULT)
  set_trainer_flag var(fixture:VAR_TRAINER_0)
  set_trainer_flag var(fixture:VAR_TRAINER_1)
  release_all
  end

fixture:Battles_WaitApproach0::
  check_is_approaching_trainer_task_done 0, var(fixture:VAR_RESULT)
  compare_var_to_value var(fixture:VAR_RESULT), 0
  go_to_if "eq", label(fixture:Battles_WaitApproach0)
  return

fixture:Battles_WaitApproach1::
  check_is_approaching_trainer_task_done 1, var(fixture:VAR_RESULT)
  compare_var_to_value var(fixture:VAR_RESULT), 0
  go_to_if "eq", label(fixture:Battles_WaitApproach1)
  return

fixture:Route_Npc::
  lock_all
  face_player
  message text(fixture:Text_RouteNpc)
  wait_button
  close_message
  release_all
  end

fixture:Common_PC::
  lock_all
  message text(fixture:Text_Pc)
  wait_button
  close_message
  release_all
  end

fixture:Common_TV::
  lock_all
  message text(fixture:Text_Tv)
  wait_button
  close_message
  release_all
  end

fixture:Common_TownMap::
  lock_all
  message text(fixture:Text_TownMap)
  wait_button
  close_message
  release_all
  end

fixture:Common_Bookshelf::
  lock_all
  message text(fixture:Text_Bookshelf)
  wait_button
  close_message
  release_all
  end

fixture:Common_TrashCan::
  lock_all
  message text(fixture:Text_TrashCan)
  wait_button
  close_message
  release_all
  end

# Field moves (original stand-ins for the decomp FIELD_MOVES scripts; the world starts them).
fixture:FieldMoves_Surf::
  end

fixture:FieldMoves_Waterfall::
  end

fixture:FieldMoves_RockClimb::
  end

fixture:FieldMoves_Boulder::
  set_flag flag(fixture:FLAG_STRENGTH_ACTIVE)
  end

fixture:Town_Guide::
  lock_all
  face_player
  message text(fixture:Text_GuideIdle)
  wait_button
  close_message
  release_all
  end
`;

const manifest = { id: 'fixture', name: 'Fixture pack (original content)', version: '0.1.0', engine: '^0.1.0', dependencies: {}, loadAfter: [] };
writeFileSync(join(OUT, 'pack.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(OUT, 'data.json'), JSON.stringify(data, null, 1) + '\n');
writeFileSync(join(OUT, 'scripts.ir'), scripts);
console.log('fixture pack written to', OUT);
