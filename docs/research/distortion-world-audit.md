# Distortion World: importer audit

Date: 2026-10-15. Builds on `distortion-world.md` (DW). Counts and formats only: no ROM values are copied
here. The importer code is `packages/importer/src/distortion/`; `opensinnoh import` prints the inventory below
and `distortion.rom.test.ts` pins it.

## What the importer reads

| Source | Reader | Checked at import |
|---|---|---|
| `tw_arc.narc` member 0 (map info) | `tw-arc.ts` `readMapInfo` | size = 4 + 12 × count; 10 rooms, 11 members |
| `tw_arc.narc` room files | `readRoomFile` | the four section sizes fill the file; each section's count × record size (20/40/24, ghost 12 + 12n + 20m) fills it; support kind 0–3; jump handler 0 (the only `sFloatingPlatformJumpPointHandlers` entry); facings 0–3; jump axis 0–2; inverted and ghost show 0/1; ghost prop kind < 25 and group < 24 (the 24-bit mask); every jump lands on a support of the kind it names, or on land |
| `tw_arc_attr.narc` | `tw-attr.ts` `readAttrGrid` | grid bytes = vertical × horizontal × 2; the flat axis of the support has size 0; the bounds fit the grid |
| `tw_arc_etc.narc` | `tw-etc.ts` `readSky` | 25 members; each parses as the NCGR/NCLR/NSCR/NCER/NANR its slot names |
| overlay 9 (`ov9_02249960.c`) | `overlay9.ts` `readOverlayTables` | one SHA-1-pinned region (`TABLES.distortionWorld`, 0x78B4–0xA36C); every pointer lands inside it; map headers < `MAP_HEADER_COUNT`; event command kinds 0–17 with `END`; the commands without params have a NULL pointer and the others not; conditions 0–8; prop kinds; platform flags ≤ 11; puzzle flags < 17; elevator path indexes in order, `next` and moving-platform paths ≤ 22; directions; booleans 0/1 |
| joined (`index.ts`) | `importDistortionWorld` | the overlay tables name only the 10 rooms, each once; every start-script and object script resolves to a label in the room's script file; every object gfx and movement action has a name |

The tables read from overlay 9: `sDistWorldMapConnectionList`, `sMovingPlatformsMapTemplates`,
`sElevatorPlatformPaths` (22), `sMapEvents`, `sSimplePropsMapTemplates`, `sMapObjectEvents`, and the two
waterfall command lists `sMapEventB4F_Waterfall` / `sMapEventB5F_Waterfall`, which no table points at
(the overlay runs them from code).

Output: the asset `distortion/world.json` (rooms in tw_arc order, the elevator paths, the waterfall
lists, the sky summary), and `ImportReport.distortionWorld` (the inventory and opaque fields).
`IMPORTER_VERSION` is `platinum-46`.

## Inventory (Platinum US rev 0)

| Room | Supports | Jumps | Camera rows | Ghost groups (props, triggers) | Moving platforms | Events (commands) | Simple props | Objects |
|---|---|---|---|---|---|---|---|---|
| 1F | – | 0 | 0 | 1 (18, 0) | 1 | 1 (2) | 1 | 2 |
| B1F | west wall 1 | 4 | 4 | 1 (21, 0) | 2 | 1 (3) | 0 | 1 |
| B2F | floor 4, west wall 1 | 4 | 4 | 1 (18, 0) | 18 | 24 (72) | 0 | 2 |
| B3F | west wall 1 | 4 | 6 | 19 (49, 74) | 4 | 2 (4) | 0 | 1 |
| B4F | east wall 1, ceiling 1 | 4 | 6 | 11 (24, 47) | 3 | 3 (6) | 0 | 1 |
| B5F | – | 0 | 0 | 1 (14, 0) | 3 | 6 (6) | 1 | 6 |
| B6F | – | 0 | 0 | 1 (9, 0) | 2 | 0 | 0 | 20 |
| B7F | – | 0 | 0 | 2 (13, 1) | 1 | 3 (6) | 0 | 5 |
| Giratina room | – | 0 | 2 | 4 (11, 0) | 0 | 5 (12) | 1 | 5 |
| Turnback Cave room | east wall 1 | 4 | 4 | 10 (35, 22) | 0 | 0 | 1 | 2 |

Totals: 10 supports (4 floor, 3 west wall, 2 east wall, 1 ceiling), 20 jump points, 26 camera rows, 22
elevator paths (2 continue into another), 2 waterfall commands. Command kinds used: move-platform 48,
set-map-object-animation 24 (the four `JUMP_DISTORTION_WORLD_*` actions), set-progress 10, start-script 9,
show-giratina-shadow 5, set-giratina-animation-flag 3, the three boulder tutorials 2 each, and one each of
add-map-object, show/hide Giratina-room platforms, set/clear puzzle flag and play-Giratina-arrival; all 18
kinds but delete-map-object and the two cascades (which only the waterfall lists use). Conditions: events
use none, progress-eq, boulder-puzzle-false/true and giratina-shadow; objects use none, progress-eq/leq/geq,
boulder-puzzle-true, manual-add-only and cyrus-appearance; simple props none and progress-geq. Two B2F
objects are rotated.
Sky: one 256×256 BG of 256 4bpp characters and a 256-colour palette; seven cloud sets of one cell and one
animation each (8–64 characters); one 256-colour cloud palette.

Findings that change the plan:
- **Supports are rare.** Only five rooms have any; 1F, B5F, B6F, B7F and the Giratina room are ordinary
  land plus props. "Current support" must be optional (null = land), not a per-room gravity.
- **Jumps can land on land.** Destination kind 4 (decomp `FLOATING_PLATFORM_KIND_INVALID`) with index
  0xFFFF returns the player to the ordinary map; 8 of the 20 jumps do. The importer names it `land`.
- **Every terrain grid is 32 × 32** (2048-byte members); the bounds use at most 32 tiles per axis. Of the
  12 `tw_arc_attr` members, 0 and 1 are referenced by no support. Bits 8–14 of a cell are never set.
- **Units.** Camera rows are in 1/256 turns (× 0x100 = DS binary angle, decomp
  `DISTORTION_WORLD_CAMERA_PERSISTED_ANGLES_FACTOR`); jump sprite rotations are degrees (±90 on the ROM);
  jump displacements are tiles (map-object Y moves by twice the Y value); bounds and props are whole tiles;
  object Y is fx32 `(tileY << 4) × 4096`; elevator and platform steps are fx32 per frame.
- **Code constants, not data.** The waterfall entry tiles, the Giratina-room teleport tile, the base
  camera (angle, distance, FOV, clips, the non-Giratina FOV adjust), the prop kind → fldeff model and
  animation tables, the cloud templates and the fog values are compiled into overlay 9 code or tables
  this audit did not read. The world and renderer take them from the decomp as rules (DW cites them), or a
  later importer pass pins the tables (`sProp3DModelNARCIndexByKind`, `sPropAnimSetNARCIndexByKind`,
  `sSkyCloudsTemplates`) the same way.

## Opaque fields

Unknown handler, command, condition, kind and direction values fail the import. What stays opaque (the
decomp's dummies; overlay 9 never reads them), with the values on the ROM:

| Field | Values |
|---|---|
| room file header `dummy00` | 0 |
| jump point `dummy04` | 0 |
| simple prop `dummy00` | 0 |
| move-platform params `dummy04` | 0, 1, 2 |

Also not given meaning here: the Giratina shadow `rotAnglesIndex` and `soundKind`, the
set-giratina-animation-flag value and the cascade axis/direction are kept as numbers (the decomp names
their enums; the world maps them when it implements the commands).

## Why two rooms do not render

The browser sweep (`pnpm sweep:browser … --zones DISTORTION_WORLD`, this branch) renders 8 of 10 rooms;
B2F (13 colours, 0.4% lit) and the Giratina room (89 colours, 1.6% lit) are blank. Not an importer bug:
- The sweep places the player at the zone's first warp, coord event or object, else the matrix centre.
  Distortion World zones have no ordinary events (their objects and arrivals live in overlay 9), so nine
  rooms spawn at the matrix centre.
- B2F's land has 4 walkable tiles in the whole room; its walkable surfaces are the 4 floor supports and
  the 18 moving platforms, which are overlay-managed props the renderer does not draw yet. The Giratina
  room has 6 walkable land tiles (the arrival tile among them); its centre is void, and the bridge is the
  ghost groups the arrival event reveals. In both, the camera looks at empty space.

Fixed later in the runtime, not here: draw supports, moving platforms and ghost props, and give the sweep a
Distortion World spawn from these records (the room's arrival or first support) instead of the matrix
centre.

## Contract proposal (refines M5 §8.3, for 0.27)

Records, from what the ROM holds:

```ts
// registry `distortionRooms`, one per room; Zone gains `distortionRoom?: Id`.
interface DistortionRoom {
  id: Id; zone: Id;
  offset: { x: number; altitude: number; z: number };     // tiles; places the room in one world space
  previous: Id | null; next: Id | null;                     // the floor kept loaded above/below
  supports: { kind: 'floor' | 'west-wall' | 'east-wall' | 'ceiling'; box: TileBox; grid: { vertical: number; horizontal: number; cells: number[] } }[];
  jumps: { box: TileBox; facing: Facing; displacement: Vec3; frames: number; spriteRotationDeg: number;
           arc: { axis: 'x' | 'y' | 'z'; inverted: boolean }; finalFacing: Facing; to: { support: number } | 'land' }[];
  cameraRows: { box: TileBox; facing: Facing; angle: [number, number, number]; frames: number }[]; // 1/256 turns, first match wins
  ghosts: { visibleMask: number; props: { group: number; prop: DwPropKind; tile: Vec3 }[]; triggers: { group: number; facing: Facing; show: boolean; box: TileBox }[] };
  movingPlatforms: { tile: Vec3; prop: DwPropKind; elevator: { path: number; direction: 'up' | 'down' } | null; destination: number; flag: number | null }[];
  events: { tile: Vec3; when: DwCondition; commands: DwCommand[] }[];   // DwCommand: the 18 named kinds, typed params
  props: { tile: Vec3; prop: DwPropKind; when: DwCondition }[];
  objects: (ObjectEvent & { when: DwCondition; rotation: number | null })[]; // ObjectEvent y in tiles
}
// TileBox = start + inclusive size; DwCondition = { kind: 'none' | 'progress-eq' | … ; value: number }.
// one record `distortionWorld`: elevatorPaths, cascadeUp/Down, waterfall entries, base camera, prop kinds → models/animations, sky ui2d ids.
```

Changes from §8.3: one `distortionRooms` registry instead of separate support/jump/camera/ghost records
(they are only meaningful per room and index each other); `to: 'land'`; units fixed as above, with angles
kept in source units (the world converts); dummies dropped from records (pinned by the ROM test); handler
dropped (one kind). The opaque `move-platform dummy04` is left out until something reads it.

GameState `distortionWorld` (mirrors the decomp's persisted block, no second progress copy):
`{ support: number | null; hiddenGhostGroups: number /* 24 bits */; cameraAngle: [number, number, number]
/* 1/256 turns */; platformFlags: number /* 11 bits */; puzzleFlags: number /* 17 bits */ }`, plus the
player's tile Y, which `GameState.player.y` already carries. Absent outside the Distortion World; old saves
migrate to absent.

`FieldHost` and `FieldView` stay as §8.3 drafts them: the ten DW ops as services with completion queries;
the view gains the camera pose with roll, the player's support orientation and the visible floors
(current plus `previous`/`next` at their offsets), moving-platform and ghost-prop instances.
