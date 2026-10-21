# ROM and map data formats (Platinum US rev0)

Research, 2026-10-14. Target ROM: `Pokemon - Platinum Version (USA).nds`,
SHA1 `ce81046eda7d232513069519cb2085349896dec7` (= decomp `platinum.us/rom_rev0.sha1`).
Decomp: `reference-projects/pokeplatinum`. It has no licence, so we use it **only** for names,
offsets and how the formats work. No code and no assets are copied.
Verification used throwaway local scripts (`rom.py`, `ovl.py`, `zh.py`, `maps.py`,
`ctl.py`, `hdr.py`). They are throwaway, so re-derive them in TS tests.

Tags: **VERIFIED-ON-ROM** (measured on the ROM bytes), **FROM-DECOMP-ONLY** (read in decomp
source, not exercised on ROM), **WRONG-IN-PLAN** (contradicts the original design brief or the task
assumptions).

All integers are little-endian. `fx32` = signed 20.12 fixed point (4096 = 1.0). One map tile =
16 world units = `16*4096` fx32. One land chunk = 32×32 tiles = 512 units.

---

## 1. NDS header, NitroFS, whole-file SHA1. VERIFIED-ON-ROM

| Off | Field | rev0 value |
|---|---|---|
| 0x00 | title | `POKEMON PL` |
| 0x0C | game code | `CPUE` |
| 0x10 | maker | `01` |
| 0x14 | device capacity | 10 (128 MiB) |
| 0x1E | ROM version | 0 |
| 0x20/24/28/2C | arm9 rom off / entry / RAM / size | 0x4000 / 0x02000800 / 0x02000000 / 0x1023F8 |
| 0x30..3C | arm7 rom off / entry / RAM / size | 0x409800 / 0x02380000 / 0x02380000 / 0x277FC |
| 0x40/44 | FNT off / size | 0x431000 / 0x1BB4 |
| 0x48/4C | FAT off / size | 0x432C00 / 0xE70 (462 entries) |
| 0x50/54 | arm9 overlay table off / size | 0x106600 / 0xF40 (122 × 32 B) |
| 0x58/5C | arm7 overlay table | 0 / 0 (none) |
| 0x68 | banner off | 0x433C00 |
| 0x6C | secure area CRC | 0xF8B8 (matches `rom_rev0.ini secure-crc`) |
| 0x80 | total used ROM size | 0x063C303C |
| 0x84 | header size | 0x4000 |
| 0x15C | logo CRC | 0xCF56 |
| 0x15E | header CRC16 (CRC-16/MODBUS, init 0xFFFF, poly 0xA001, over 0x000–0x15D) | 0xCE5E (recomputed, matches) |

- **FAT**: 8 B per file, `u32 start, u32 end` (absolute ROM offsets, end exclusive). File IDs
  0–121 are the overlays and IDs 122–461 are named files (340).
- **FNT**: main table of 8 B per directory (`u32 subtableOff` relative to FNT, `u16 firstFileId`,
  `u16 parentId`; for the root this is the directory count, 89). Subtable entries are
  `u8 len|0x80 flag`, the name, and for directories a `u16 dirId (0xF000+)`. `0x00` ends a subtable.
- **Whole-file SHA1 depends on the tail fill.** The file is 0x08000000 bytes, and every byte from
  `0x80` (0x063C303C) to the end is `0xFF` (`rom_rev0.ini: fill-tail = true, fill-with = 0xFF`).
  Trimmed dumps or dumps padded with zeros give a different SHA1 even though the content is
  identical. SHA1 of `[0, 0x063C303C)` is `f28c0820b94e5b52072aacd04fdd4cc3dcef3b5e`.
  Suggestion: accept the whole-file hash, and otherwise fall back to "the used-size hash matches
  and the rest is 0xFF or absent", reported as "trimmed dump".

## 2. Overlays and arm9. VERIFIED-ON-ROM

- Overlay table entry (32 B): `u32 id, ramAddr, ramSize, bssSize, sinitStart, sinitEnd, fileId,
  flags` where `flags = compressedSize(24 bits) | (flagByte << 24)`, and flagByte bit0 means
  compressed. 122 entries, fileId == id (0–121).
- **No overlay is compressed** (all 122 have flags = 0), and **arm9 is not compressed**: the
  module params at arm9+0xBA0 have `compressed_static_end = 0`, SDK version 0x04027531, and the
  magic `0x2106C0DE 0xDEC00621` follows. **WRONG-IN-PLAN / task assumption**: we do not need a
  BLZ (backwards LZ) decoder for rev0 US. Keep a small BLZ routine only as a guard for other dumps
  or revisions (about 40 lines).
- `sbins_*.sha1` are hashes of the decomp's linked binaries:
  - `main.sbin` = the arm9 bytes **plus the 12-byte nitrocode footer** that sits in the ROM right
    after arm9 (`DE C0 06 21 | A0 0B 00 00 | 00 00 00 00`). SHA1 of
    `rom[0x4000 : 0x4000+0x1023F8+12]` matches `6b61f25c…`. Without the footer it does not match.
  - The other 121 lines in `sbins_shared.sha1` plus `gts_application.sbin` in `sbins_rev0.sha1`
    are the raw overlay files. **All 122 overlay files match exactly as stored**, which again
    shows that they are not compressed. rev1 differs only in `gts_application`.
- arm9 is loaded at 0x02000000, so `RAM = 0x02000000 + arm9 file offset` for anything in the
  static arm9 part.

## 3. Message text (pl_msg.narc)

Path `/msgdata/pl_msg.narc`, **724 banks**. The bank index equals the zero-based line in
`generated/text_banks.txt` and is the value stored in `MapHeader.msgArchiveID`. The
encryption is as already confirmed (VERIFIED-ON-ROM). Each message ends with `0xFFFF`
(46,053 of 46,053 do).

Special char codes (charmap `tools/msgenc/charmap.txt` + `include/constants/charcode.h`):

| Code | msgenc text | Engine meaning (render_text.c) | Count on ROM |
|---|---|---|---|
| 0xE000 | `\n` | CHAR_CR: new line | 33,670 |
| 0x25BC | `\r` | CHAR_CONTROL_CLEAR: wait for a key with an arrow, then clear the box (new page) | 13,576 |
| 0x25BD | `\f` | CHAR_CONTROL_SCROLL: wait for a key, then scroll one line | 1,230 |
| 0xF100 | `{TRNAME}` | compressed string: 9-bit packed chars, ending in 0x1FF (trainer names) | 885 msgs |
| 0xFFFE | `{CMD …}` | command (format below) | |
| 0xFFFF | — | end of string | |

**Command encoding** (VERIFIED-ON-ROM): `0xFFFE, cmd, nargs, arg0 … arg(nargs-1)`, all u16.
Measured on ROM (cmd → nargs is always fixed):

| cmd | msgenc name | nargs | Meaning |
|---|---|---|---|
| 0x01xx | `{STRVAR_1 xx, slot, n}` | 2 | string-variable placeholder; arg0 = template slot |
| 0x06xx | `{STRVAR_6 …}` | 2 | string-variable placeholder (also substituted) |
| 0x0200 | `{YESNO}` in charmap; decomp calls it SCREEN_INDICATOR | 1 | draws a touch or look at screen icon |
| 0x0201 | `{PAUSE n}` | 1 | delay n frames |
| 0x0202 | `{WAIT n}` | 1 | engine CALLBACK param |
| 0x0203/0x0204 | `{CURSOR_X/Y n}` | 1 | set pen position |
| 0x0205/0x0206 | `{ALN_CENTER}/{ALN_RIGHT}` | — | alignment (not seen on ROM) |
| 0xFF00 | `{COLOR n}` | 1 | fg = 2n+1, shadow = 2n+2; n ≥ 100 means a colour cache |
| 0xFF01 | `{SIZE n}` | 1 | 100 or 200 % |
| 0xFE06 | — | 1 | MOVE: 0xFE00 = scroll, 0xFE01 = wait then scroll (FROM-DECOMP-ONLY) |

Counts on ROM: STRVAR_1 8,377 · COLOR 4,044 · STRVAR_6 131 · CURSOR_X 86 · SIZE 39 · PAUSE 39 ·
WAIT 34 · 0x0200 32. STRVAR_3/4/34 exist in the charmap but are not used in the US ROM.

**How player and rival names get in** (FROM-DECOMP-ONLY, flow in `string_template.c`,
`scrcmd_strings.c`): a script command such as `BufferPlayerName slot` / `BufferRivalName slot`
fills `StringTemplate.args[slot]`. Before printing, `StringTemplate_Format` replaces each
`0xFFFE` command whose type high byte is 0x01, 0x05 or 0x06 with `args[arg0]` and copies every
other command through unchanged for the renderer. The low byte of 0x01xx (for example 0x0103) is
a formatting hint that Format ignores. Example from the ROM (bank 558, msg 5):
`FFFE 0103 0002 0000 0000` = "insert slot 0". Text is variable-width and the slot holds the
name, so line wrapping is fixed in the text and not computed.

## 4. Zone headers (MapHeader). VERIFIED-ON-ROM

- Source of names and values: `include/data/map_headers.h` (`sMapHeaders[]`), the struct in
  `include/map_header.h`, ID order in `generated/map_headers.txt` (zero-based line = zone ID).
- **Location: arm9 file offset `0xE601C` (RAM `0x020E601C`), 593 records × 24 B = 0x3798 B**,
  ending at 0xE97B4. All 593 records match the decomp's values in the first 10 bytes (area,
  objs, matrix, scripts, init scripts, msg). SHA1 of the table:
  `4a54ec61a43d4cfb684f5c6e9a93ca0866929f04`.
- Robust locating: hard-code the offset keyed by ROM SHA1 and check it with the table SHA1. As a
  fallback, scan arm9 for a 593×24 run where every record passes range checks
  (area < 75, matrix < 289, scripts and init < 1124, msg < 724, events < 534, encounters < 183
  or 0xFFFF, camera < 17). Note: the record-0 bytes occur twice (records 0 and 1 are almost
  equal), so never search for one record alone.

Record layout (24 B):

| Off | Type | Field | Notes |
|---|---|---|---|
| 0 | u8 | areaDataArchiveID | → area_data.narc |
| 1 | u8 | preloadedMapObjectsArchiveID | → area_move_model/move_model_list.narc |
| 2 | u16 | mapMatrixID | → map_matrix.narc (22 → 23 only on Pearl) |
| 4 | u16 | scriptsArchiveID | → scr_seq.narc |
| 6 | u16 | initScriptsArchiveID | → scr_seq.narc (same archive) |
| 8 | u16 | msgArchiveID | → pl_msg.narc bank |
| 10 | u16 | dayMusicID | SDAT sequence ID |
| 12 | u16 | nightMusicID | |
| 14 | u16 | wildEncountersArchiveID | → pl_enc_data.narc, 0xFFFF = none |
| 16 | u16 | eventsArchiveID | → zone_event.narc |
| 18 | u8 | mapLabelTextID | location_names bank entry |
| 19 | u8 | mapLabelWindowID | popup style |
| 20 | u8 | weather | |
| 21 | u8 | cameraType | index into the camera table (§7) |
| 22 | u16 | bits 0–6 mapType, 7–11 battleBG, 12 bike, 13 running, 14 escapeRope, 15 fly | |

## 5. Map system

### 5.1 Map matrix: `/fielddata/mapmatrix/map_matrix.narc` (289 members). VERIFIED-ON-ROM

```
u8 width, u8 height, u8 hasHeaderIDs, u8 hasAltitudes, u8 nameLen, char name[nameLen]
[u16 zoneID[w*h]]   if hasHeaderIDs (otherwise every cell = the zone that loaded it)
[u8  altitude[w*h]] if hasAltitudes
u16 landDataID[w*h] (0xFFFF = empty)
```
Row-major (`x + y*w`), max 30×30, name ≤ 16. Matrix 0 = the Sinnoh overworld, 30×30, name `map`,
with both sections, 4,508 B, 468 non-empty cells. Interiors are 1×1 with neither section.
Chunk render origin: `x = (mx*32+16)*16`, `z = (mz*32+16)*16`, `y = altitude*8` (world units),
so a chunk's local coordinates are centred on the chunk.

### 5.2 Land data: `/fielddata/land_data/land_data.narc` (666 chunks). VERIFIED-ON-ROM

```
0x00 u32 attrSize   (always 0x800)
0x04 u32 propsSize  (n*48)
0x08 u32 modelSize
0x0C u32 bdhcSize
0x10 attrs[attrSize] | props[propsSize] | NSBMD[modelSize] | BDHC[bdhcSize]
```
For all 666 chunks, `16 + sum == member length`.
- **Terrain attributes**: `u16[32*32]`, row-major (`x + z*32`). Bit 15 = collision (blocked),
  bits 0–7 = tile behaviour. Bits 8–14 are 0 in all 681,984 tiles on the ROM. There are no Gen 3
  style "movement permissions" or elevation levels; height comes from BDHC.
- **Props** (buildings and objects), 48 B each: `i32 modelID` (→ build_model.narc),
  `fx32 pos[3]` (relative to the chunk centre), `fx32 rot[3]`, `fx32 scale[3]`, `i32 pad[2]`.
  On the ROM all 3,476 props have rot = 0 and scale = 1.0 (the decomp renders them with an
  identity rotation anyway). Quirk: chunk 506 has propsSize % 48 = 2, so use floor division. At
  most 32 props are loaded per chunk.
- **Model**: NSBMD (`BMD0`) with **only an MDL0 block** in all 666 chunks. Textures come from the
  area's map_tex_set NSBTX, bound by name at load time.
- **BDHC** (terrain height): `"BDHC"`, then `u16 points, normals, constants, plates, strips,
  accessList` (16 B header), then the arrays in this order: points `{fx32 x,z}` (8 B), normals
  `VecFx32` (12 B), constants `fx32` (4 B), plates `{u16 p1, p2, normalIdx, constIdx}` (8 B),
  strips `{fx32 scanlineZ, u16 count, u16 start}` (8 B), accessList `u16`. The size formula holds
  on every slice chunk. Lookup: binary-search the strip by local z, then for each plate in the
  access list test the p1/p2 bounding box and compute `y = -(n.x*x + n.z*z + d) / n.y`. Pick the
  candidate closest to the current height. Coordinates are chunk-local (centre origin); flat
  chunks have 2 points (±256).

### 5.3 Area data and textures. VERIFIED-ON-ROM

| ROM path | Count | Format |
|---|---|---|
| `/fielddata/areadata/area_data.narc` | 75 × 8 B | `u16 propSetID, u16 mapTexSetID, u16 unused, u16 lightID` (light 0 or 3 = outdoor lighting) |
| `/fielddata/areadata/area_build_model/area_build.narc` | 71 | `u16 count, u16 buildModelID[count]` (which props to preload) |
| `/fielddata/areadata/area_build_model/areabm_texset.narc` | 71 | NSBTX for the area's props (same index as area_build) |
| `/fielddata/areadata/area_map_tex/map_tex_set.narc` | 74 | NSBTX for the land chunk models |
| `/fielddata/build_model/build_model.narc` | 590 | NSBMD props: 568 MDL0+TEX0, 22 MDL0 only. Textures are re-bound to the areabm texset; ID 0 = dummy box |
| `/fielddata/build_model/build_model_matshp.dat` | 1 | material/shape table used for some prop draws (not parsed yet) |
| `/data/arealight.narc` | — | lighting sets (lightID) |
| `/arc/bm_anime.narc`, `/arc/bm_anime_list.narc` | — | prop animations (doors etc.) |

The decomp's JSON keys `lightingSet`/`dummy` are in a different order from the binary: offset 4
is the unused value and offset 6 is the light ID (area 20 = `16, 20, 3, 1`).

## 6. Events: `/fielddata/eventdata/zone_event.narc` (534). VERIFIED-ON-ROM

Four sections, each `u32 count` + records. The member length equals the sum of the sections on
every slice zone.

| Section | Size | Layout |
|---|---|---|
| bg | 20 | `u16 script, u16 type, i32 x, i32 z, i32 y, u16 facingDir, u16 pad` |
| object | 32 | `u16 localID, gfxID, moveType, trainerType, hiddenFlag, script; s16 dir; u16 data[3]; s16 rangeX, rangeZ; u16 x, z; fx32 y` |
| warp | 12 | `u16 x, z, destZoneID, destWarpID; u8 pad[4]` |
| coord | 16 | `u16 script, x, z, width, length, y, value, var` (trigger when var == value) |

x and z are global tile coordinates within the zone's matrix. Example: player 2F warp 0 = (8,4) → zone 414, warp 1.

Scripts (`/fielddata/script/scr_seq.narc`, 1,124): header of `u32 relOffset` (relative to the
end of the field), ended by `u16 0xFD13` (Twinleaf has 9 entries, Route 201 has 16). I have not
checked how script numbers map to entries; the script VM settles that. Init-script files use a different,
smaller format.

## 7. Camera. FROM-DECOMP + VERIFIED-ON-ROM

Table `sCameraTypes` in `src/overlay005/field_camera.c` = **overlay 5 file offset 0x27D64
(RAM 0x021F8AE4), 17 × 24 B**, SHA1 `e036030921ad887264cd6d53d869324663a5d9aa`.
Record: `fx32 distance; u16 angleX, angleY, angleZ, pad; u8 projection (0 persp, 1 ortho); u8
pad; u16 fovY; fx32 near; fx32 far`. Angles are binary angles (65536 = 360°). **fovY is the half
angle**: perspective uses sin and cos of it, and ortho uses `top = tan(fovY)*distance`. Aspect
ratio is the 4:3 default.

| Type | Used by (slice) | distance | pitch | proj | fovY (half) | near/far |
|---|---|---|---|---|---|---|
| 0 DEFAULT | Twinleaf, Route 201, Lakefront | 666.922 | −59.05° | persp | 8.091° (≈16.18° full) | 150/900 |
| 2 ZOOMED_IN | Lake Verity | 515.456 | −54.66° | persp | 10.459° | 150/900 |
| 4 INTERIOR_ORTHOGRAPHIC | both houses | 1563.538 | −50.09° | **ortho** | 3.521° | 150/1735 |

**WRONG-IN-PLAN**: "fixed perspective camera". Interiors use an **orthographic** projection.
The camera also follows the target with a 6-frame history delay on Y.

## 8. Other data (paths and record sizes). VERIFIED-ON-ROM

| Data | Path | Members × size |
|---|---|---|
| Wild encounters | `/fielddata/encountdata/pl_enc_data.narc` | 183 × 424 B (`WildEncounters`). `d_`/`p_enc_data` are DP leftovers |
| Species personal | `/poketool/personal/pl_personal.narc` | 508 × 44 B (`personal.narc` = DP, do not use) |
| Evolutions | `/poketool/personal/evo.narc` | 508 × 44 B |
| Level-up learnsets | `/poketool/personal/wotbl.narc` | 508, variable (`u16` list, 0xFFFF end) |
| Trainers | `/poketool/trainer/trdata.narc` | 928 × 20 B |
| Trainer parties | `/poketool/trainer/trpoke.narc` | 928, variable (8/16/24… B per mon by type) |
| Trainer text | `/poketool/trmsg/trtbl.narc`, `trtblofs.narc` | — |
| Map object list | `/fielddata/mm_list/move_model_list.narc` | — |

## 9. v0.1 slice: IDs. VERIFIED-ON-ROM (all chunks parse, magics and sizes check)

| Zone | ID | area | matrix → land chunk(s) [cell] | scripts / init | msg bank | events | enc | cam | mapType |
|---|---|---|---|---|---|---|---|---|---|
| Twinleaf Town | 411 | 6 | 0 → **0** [3,27] | 1052 / 982 | 554 | 390 (1 bg, 8 obj, 4 warp, 2 coord) | 176 | 0 | town |
| Rival house 1F | 412 | 20 | 126 → 184 | 1053 / 983 | 555 | 391 | — | 4 | indoors |
| Rival house 2F | 413 | 20 | 127 → 185 | 1054 / 984 | 556 | 392 | — | 4 | indoors |
| Player house 1F | 414 | 20 | 128 → 186 | 1055 / 985 | 557 | 393 | — | 4 | indoors |
| Player house 2F (bedroom) | 415 | 20 | 129 → 187 | 1056 / 986 | 558 | 394 (5 bg, 1 obj, 1 warp, 4 coord) | — | 4 | indoors |
| Route 201 | 342 | 6 | 0 → 5 [3,26], 6 [4,26] | 427 / 909 | 466 | 328 (13 obj, 6 coord) | 140 | 0 | outdoors |
| Verity Lakefront | 334 | 6 | 0 → 1 [1,25], 3 [2,25], 2 [1,26], 4 [2,26] | 414 / 901 | 399 | 320 | — | 0 | outdoors |
| Lake Verity, early visit (decomp: `LAKE_VERITY_LOW_WATER`) | 311 | 62 | 101 (3×2) → 531–536 | 351 / 848 | 291 | 299 | 134 | 2 | cave |
| Lake Verity, later (Galactic) | 312 | 62 | 102 (3×2) → 537–542 | 352 / 849 | 292 | 300 | 135 | 2 | cave |

Altitude is 0 for all slice cells of matrix 0. Chunks 1–3, 533 and 536 are filler (almost all
tiles blocked, no props). Area 6 = prop set 0 (32 models), texture set 6. Area 20 = prop set 16
(73 models), texture set 20. Area 62 = prop set 58, texture set 61.

**WRONG-IN-PLAN (the first slice's item 4, for the script VM):** in Platinum the starter choice is a coord
event on **Route 201** (`Route201_CoordEvent_ChooseStarterScene`, zone 342): the assistant brings
the briefcase and the first battle is the **rival battle** (`Route201_StartFirstBattle*`). There
is no wild-Pokémon attack (that is Diamond/Pearl). The early Lake Verity zone (311) holds the
Cyrus scene. The Lakefront warps go to 311 or 312 depending on story state.

## 10. Importer plan (slice order)

| # | Decoder | Size | Notes |
|---|---|---|---|
| 1 | Header + SHA1 (with the trimmed-dump fallback) + CRC16 | S | §1 |
| 2 | NitroFS FNT/FAT → path map | S | done in a prototype |
| 3 | Overlay table + raw overlay read (BLZ guard only) | S | §2 |
| 4 | NARC | S | done in a prototype |
| 5 | Zone header table (arm9 0xE601C, checked by SHA1) | S | §4 |
| 6 | Map matrix | S | §5.1 |
| 7 | Land chunk split + terrain attributes + props | S | §5.2 |
| 8 | BDHC → plates/strips JSON + height query | M | §5.2, port the algorithm from the description, not the code |
| 9 | Area data / area_build lists | S | §5.3 |
| 10 | NSBMD (MDL0) + NSBTX (TEX0, all formats incl. 4×4) → engine model | **L** | Land models are MDL0 only, so textures come from the area NSBTX |
| 11 | Events (4 sections) | S | §6 |
| 12 | Messages + control codes → tokens; STRVAR expansion at runtime | S–M | §3, plus the 0xF100 9-bit unpacking |
| 13 | scr_seq header + bytecode → IR | M–L | §6 |
| 14 | Camera table (ovl5 0x27D64, checked by SHA1) | S | §7 |
| 15 | Font (`/graphic/font.narc` or similar), sprites for the slice NPCs (mm_list + NCGR/NCLR) | M | not covered here |
| — | Encounters/personal/trainers | S each | v0.1 only needs the starter species and the rival party |
