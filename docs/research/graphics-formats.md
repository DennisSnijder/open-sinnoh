# Graphics formats: Pokémon Platinum (US) research notes

Status: verified against the real ROM on 2026-10-14.
Scope: what the import-time converter has to read, and what the renderer has to reproduce.

- ROM: `Pokemon - Platinum Version (USA).nds` (rev0, SHA1 `ce81046e…`, matches pret/pokeplatinum `filesys.sha1`)
- Measurement scripts: throwaway local scripts (`romlib.py`, `g3d.py`, `t*.py`). They are not part of the repo. Every number below came from running them on the ROM.
- Decomp (`reference-projects/pokeplatinum`) has **no license**. We used it only to learn how the game uses each file. We copied no code or assets from it.

Conventions: offsets are byte offsets into the named structure. All integers are little-endian. "fx32" is 20.12 signed fixed point, "fx16" is 4.12. Nitro files store their 4CC block magic reversed on disk: an "NCGR" file starts with `RGCN`, and NSBMD starts with `BMD0`.

---

## 1. Survey: what lives where (measured)

### 1.1 Counts of G3D and 2D resources in the ROM

These counts scan every file, plus every member of every NARC, for its magic.

| Magic (on disk) | Meaning | Count | Notes |
|---|---|---|---|
| `BMD0` | NSBMD model | 1,032 as NARC members/files, **+666 inside `land_data`** (not a NARC-member magic, see 1.2) | |
| `BTX0` | NSBTX texture set | 715 | |
| `BCA0` | NSBCA joint (skeletal or transform) anim | 183 | |
| `BTA0` | NSBTA texture SRT anim | 98 | |
| `BTP0` | NSBTP texture pattern anim | 72 | |
| `BMA0` | NSBMA material colour anim | 24 | none in the field slice |
| `BVA0` | NSBVA visibility anim | 3 | cutscenes only |
| `RGCN` | NCGR tiles | 6,898 | |
| `RLCN` | NCLR palette | 4,238 | |
| `RECN` | NCER cells | 461 | |
| `RNAN` | NANR cell anim | 449 | |
| `RCSN` | NSCR screen/tilemap | 519 | |

LZ10-compressed members exist (first byte `0x10`), for example `pl_font.narc` member 4 (`.NCGR.lz`). Detect them by context, not by the first byte alone: font files (NFGR) also start with `0x10` because their header size is `0x10`.

### 1.2 Field (overworld) 3D data

| ROM path | Contents | Count |
|---|---|---|
| `/fielddata/land_data/land_data.narc` | **Map chunks**, one per 32×32-tile matrix cell | 666 members |
| `/fielddata/areadata/area_map_tex/map_tex_set.narc` | NSBTX **map texture sets** (no models) | 74 |
| `/fielddata/build_model/build_model.narc` | NSBMD **building/prop models** | 590 (568 have an embedded TEX0) |
| `/fielddata/areadata/area_build_model/areabm_texset.narc` | NSBTX **prop texture set per area** | 71 |
| `/fielddata/areadata/area_build_model/area_build.narc` | Prop-model ID list per area: `u16 count; u16 ids[count]` | 71 |
| `/fielddata/areadata/area_data.narc` | Area record: prop set, map texture set, lighting set | |
| `/fielddata/mapmatrix/map_matrix.narc` | Matrix: grid of land_data IDs, plus optional header and altitude grids | |
| `/arc/bm_anime.narc` + `/arc/bm_anime_list.narc` | Prop animations (43 BTA0, 32 BCA0, 23 BTP0) and a 20-byte list record per build model | 98 / 590 |
| `/data/fldtanime.narc` | **Map texture-frame animations** (water, flowers, lamps). Member 0 is a table; members 1..52 are BTX0 frame sets | 53 |
| `/data/mmodel/mmodel.narc` | **Overworld characters**: 421 BTX0 + 24 BMD0 + 25 frame-sequence `.bin` | 470 |
| `/data/mmodel/fldeff.narc` | Field effects (grass, shadows, splashes…): 145 BMD0, 15 BTX0, BTP/BCA/BTA | 159 |
| `/data/arealight.narc` | Area lighting sets | |

**land_data member layout.** Confirmed in decomp `src/overlay005/land_data.c` and on all 666 members:

```
0x00 u32 terrainAttributesSize   (always 0x800 = 32*32 u16)
0x04 u32 mapPropsSize            (n * 48)
0x08 u32 mapModelSize            (embedded NSBMD)
0x0C u32 bdhcSize                (collision heights, "BDHC" magic)
0x10 terrain attributes | map props | NSBMD | BDHC     (sizes sum to the file size exactly)
```

Each map-prop record is 48 bytes: `s32 modelID` (index into build_model), `VecFx32 position`, `VecFx32 rotation`, `VecFx32 scale`, `s32 pad[2]`.

**How the game assembles a map.** From decomp `area_data.c` and `land_data.c`:

1. The map header gives `areaDataArchiveID` and `mapMatrixID`.
2. `area_data[id]` gives `mapTextureArchiveID` (into `map_tex_set`), `mapPropArchivesID` (into both `area_build` and `areabm_texset`), and a lighting set.
3. The land_data NSBMD is **never self-textured**. All 666 have no TEX0. It is bound to the area's map texture set **by name**, through `NNS_G3dBindMdlSet`. On the slice maps every texture and palette name resolved, with 0 missing.
4. Each build model is bound to the area's `areabm_texset` by name, even though 568/590 carry their own TEX0. Cross-check result: 5,404 textures byte-identical, 13 differ, 16 models have no embedded set. **The converter should use the area texset, which is what the game renders.** Use the embedded TEX0 only as a fallback.

### 1.3 v0.1 slice: concrete IDs

| Place | Map header | Area | map_tex_set | Prop set | land_data IDs |
|---|---|---|---|---|---|
| Twinleaf Town | `MAP_HEADER_TWINLEAF_TOWN`, matrix 0 cell (3,27) | 6 | 6 (78 tex / 74 pal, 50.6 KB) | 0 (32 models) | 0 |
| Route 201 | matrix 0 cells (3,26),(4,26) | 6 | 6 | 0 | 5, 6 |
| Verity Lakefront | matrix 0 cells (1..2, 25..26) | 6 | 6 | 0 | 1, 2, 3, 4 |
| Player house 1F / 2F | matrices 128 / 129 | 20 | 20 (45 tex / 44 pal, 8.1 KB) | 16 (73 models) | 186 / 187 |
| Lake Verity | matrix 102 (3×2) | 62 | 61 (62 tex / 58 pal) | 58 (3 models) | 537–542 |

Texture formats in the slice sets:
- set 6: 16c ×63, A3I5 ×8, 4c ×6, A5I3 ×1
- set 20: 4c ×32, 16c ×13
- set 61: 16c ×49, A3I5 ×9, 4c ×3, A5I3 ×1

### 1.4 Texture-format histogram (measured)

| Where | A3I5 (1) | 4-colour (2) | 16-colour (3) | 256-colour (4) | **4×4 (5)** | A5I3 (6) | **Direct (7)** |
|---|---|---|---|---|---|---|---|
| map_tex_set (74 files, 3,130 tex) | 198 | 599 | 2,269 | 24 | **0** | 40 | **0** |
| areabm_texset (71 files, 3,063 tex) | 61 | 885 | 2,037 | 24 | **0** | 56 | **0** |
| build_model embedded TEX0 (1,193 tex) | 25 | 401 | 721 | 15 | **0** | 31 | **0** |
| mmodel (overworld chars, 3,621 tex) | 0 | 9 | 3,612 | 0 | 0 | 0 | 0 |
| fldeff | 11 | 99 | 196 | 0 | 0 | 3 | 0 |
| fldtanime | 49 | 18 | 194 | 5 | 0 | 8 | 0 |
| **Entire ROM (every BMD0/BTX0 TEX0)** | 443 | 2,312 | 9,884 | 82 | **0** | 196 | **0** |

**Platinum uses no 4×4-compressed textures and no direct-colour textures anywhere.** The decoders are still specified in §2.6 for robustness and for later games such as HGSS. Common sizes are 16×16 (41%) and 32×32 (32%); the largest is 128×128. "Colour 0 transparent" (TEXIMAGE_PARAM bit 29) is set on about 29% of map 16c textures and on ~100% of character textures.

### 1.5 Feature usage (measured)

| Feature | land_data (666) | build_model (590) | Notes |
|---|---|---|---|
| Models per file | always 1 | always 1 | the game asserts this for maps |
| Node count | 633 have 1 node; max 25 | 565 have 1 node; max 14 | multi-node is mostly animated props (doors) |
| Skinning / envelopes (SBC `NODEMIX` 0x09) | 0 | 0 | **ROM-wide: 25 uses, all in `/data/demo_climax.narc` (cutscene)** |
| Billboard node (SBC `BB` 0x07) | 0 | 2 | also in all mmodel billboard models (11); `BBY` 0x08: 0 ROM-wide |
| Env/proj map (SBC 0x0C/0x0D) | 0 | 0 | 2 + 2 ROM-wide (lobby/cutscene) |
| Materials | 7,346 | 1,333 | mean 11 per map chunk |
| Texture matrix (mat flag `TEXMTX_USE`, texgen mode 1) | 16 | 21 | none in the slice |
| Translucent (0 < alpha < 31) | 155 | 279 | props: mostly `h_kage*`/`shade*` shadow quads at alpha 9 or 12 |
| Wireframe (alpha 0) | 0 | 0 | |
| Culling | 7,292 back-cull, 54 none | 1,319 back-cull, 14 none | "render back" = bit 6, "render front" = bit 7 |
| Fog enable bit | 6,207 on / 1,139 off | 947 / 386 | |
| Polygon mode | 100% modulate | 100% modulate | no decal, toon or shadow-volume polygons in field data |
| Polygon ID ≠ 0 | 470 | 688 | matters because the field enables **edge marking** (decomp `area_data.c`: `G3X_EdgeMarking(TRUE)` with indoor and outdoor edge-colour tables) |
| Lighting | outdoor: light0 + normals (shape flag 0x5); indoor: lights off + vertex colours (0x6) | mix | `diffAmb` bit 15 ("diffuse as vertex colour") set on every material |
| GX commands in display lists | 0x00, 0x20–0x28, 0x40, 0x41 | same | **no matrix commands in field DLs**. 0x14/0x1B appear only in cutscene models |
| Primitives (land_data) | quad strip 50,196, tri strip 11,036, quads 6,414, tris 1,852 | quad strip 3,449, tri strip 1,176, quad 1,030, tri 348 | |
| Map vertex extent | about ±256 units per chunk (decoded) | | 1 tile = 16 units, chunk = 32 tiles = 512 units; `posScale` 64 (outdoor) or 32 (indoor) |

Geometry decoding is verified. Decoding every shape's display list of land_data 0, 5, 186 and 537 gives exactly the header's `numVertex` (3226, 1464, 345, 2292).

---

## 2. NSBMD / NSBTX structure (what an implementer needs)

The canonical hardware reference is **GBATEK** (https://problemkaputt.de/gbatek.htm), sections "DS 3D" (GX commands, polygon attributes, texture formats). The file-container layout below is NitroSystem G3D. It was confirmed by our parser on the ROM.

### 2.1 Common Nitro file header

```
0x00 char[4] magic ("BMD0","BTX0","BCA0","BTA0","BTP0","BMA0","BVA0")
0x04 u16 BOM = 0xFEFF
0x06 u16 version (0x0002 for G3D files here)
0x08 u32 fileSize
0x0C u16 headerSize (0x10)
0x0E u16 numBlocks
0x10 u32 blockOffset[numBlocks]      (from file start)
```

Block kinds: BMD0 holds `MDL0` and optionally `TEX0`. BTX0 holds `TEX0`. BCA0 holds `JNT0`. BTA0 holds `SRT0`. BTP0 holds `PAT0`. BMA0 holds `MAT0`. BVA0 holds `VIS0`. Each block starts with `char[4] magic; u32 blockSize`.

### 2.2 Dictionary ("ResDict"): used everywhere for named lists

```
0x00 u8 revision(0) ; 0x01 u8 numEntry ; 0x02 u16 dictSize ; 0x04 u16 pad ; 0x06 u16 ofsEntry (from dict start)
0x08 Patricia-tree nodes: (numEntry+1) × {u8 refBit, u8 idxLeft, u8 idxRight, u8 idxEntry}
ofsEntry: u16 unitSize ; u16 ofsNames (from entry start) ; then numEntry × unitSize data
ofsEntry+ofsNames: numEntry × char[16] names (NUL-padded)
```

A **reader can ignore the Patricia tree** and walk entries linearly. Entry i's data and name i correspond. A **writer** must emit a tree: either a correct one, or a trivial one for our own fixtures if only our reader consumes them.

### 2.3 MDL0 → model

`MDL0` block: dict at +8, each data entry is a `u32` offset (from the MDL0 block start) to a model.

Model:
```
0x00 u32 size ; 0x04 u32 ofsSbc ; 0x08 u32 ofsMat ; 0x0C u32 ofsShp ; 0x10 u32 ofsEvpMtx   (all from model start)
0x14 ModelInfo (0x2C bytes):
     u8 sbcType, scalingRule (0 std / 1 Maya / 2 SI3D), texMtxMode, numNode, numMat, numShp, firstUnusedMtxStackID, pad
     fx32 posScale, fx32 invPosScale
     u16 numVertex, numPolygon, numTriangle, numQuad
     fx16 boxX, boxY, boxZ, boxW, boxH, boxD ; fx32 boxPosScale, boxInvPosScale
0x40 NodeInfo: dict; data = u32 offset (from NodeInfo start) to NodeData
```

All field models use `scalingRule 0` and `texMtxMode 0`.

**NodeData** (local transform). It is a flag word, then optional fields in this order:
```
u16 flag ; s16 m00
  bit0 TRANS_ZERO  → else 3×fx32 translation
  bit1 ROT_ZERO    → else: bit3 PIVOT_EXIST → u16 A, u16 B (compressed rotation: pivot index = bits4-7,
                     sign bits 8-11; see apicula/GBATEK-adjacent docs)   else 8×fx16 m01..m22 (with m00 above)
  bit2 SCALE_ONE   → else 3×fx32 scale + 3×fx32 inverse scale
```

All map chunks have one node, with flag `0xF807` (identity).

**SBC** (structure byte code) is a render script. Opcode = low 5 bits, option = high 3 bits:

| op | name | length | meaning |
|---|---|---|---|
| 0x00 | NOP | 1 | |
| 0x01 | RET | 1 | end |
| 0x02 | NODE | 3 | nodeID, visible |
| 0x03 | MTX | 2 | restore matrix from stack slot |
| 0x04 | MAT | 2 | bind material (opt 1/2 variants only change caching) |
| 0x05 | SHP | 2 | draw shape |
| 0x06 | NODEDESC | 4, +1 if opt 1 or 2, +2 if opt 3 | nodeID, parentID, flags; opt 1 = store to stack idx, 2 = restore from idx |
| 0x07 | BB | 2 (+1/+2 per opt) | billboard: replace the node's rotation with camera-facing |
| 0x08 | BBY | same | Y-axis billboard |
| 0x09 | NODEMIX | 3 + 3·n | envelope blend: stackIdx, n, n × (srcIdx, nodeID, weight) |
| 0x0A | CALLDL | 9 | u32 rel offset, u32 size |
| 0x0B | POSSCALE | 1 | opt 0 = multiply by posScale, opt 1 = by invPosScale |
| 0x0C / 0x0D | ENVMAP / PRJMAP | 3 | |

A typical map chunk is: `NODEDESC, NODE, POSSCALE, (MAT, SHP)×numMat, POSSCALE(inv), RET`. In the converter, **multiply vertex positions by `posScale`**.

**Materials** (at ofsMat):
```
0x00 u16 ofsDictTexToMatList ; 0x02 u16 ofsDictPlttToMatList   (from mat block start)
0x04 dict: data = u32 offset (from mat block start) to MaterialData
Tex/Pltt-to-material dicts: data = {u16 ofsMatIdxList (from mat block start), u8 numMat, u8 bound}
   → numMat × u8 material indices that use texture/palette <name>
```

MaterialData:
```
0x00 u16 itemTag ; 0x02 u16 size
0x04 u32 diffAmb     (GX DIF_AMB: diffuse rgb555 | bit15 set-vertex-colour | ambient<<16)
0x08 u32 specEmi     (GX SPE_EMI)
0x0C u32 polyAttr    (GX POLYGON_ATTR)  ; 0x10 u32 polyAttrMask
0x14 u32 texImageParam (only repeat/flip/texgen bits; address/format/size come from the bound texture)
0x18 u32 texImageParamMask ; 0x1C u16 texPlttBase ; 0x1E u16 flag
0x20 u16 origWidth, origHeight ; 0x24 fx32 magW, magH
then, if flag&1 (TEXMTX_USE): scaleS,scaleT (fx32, absent if flag&2), rot sin,cos (fx16, absent if flag&4),
     transS,transT (fx32, absent if flag&8); if flag&0x2000: 4×4 fx32 effect matrix
```

**Material names are not texture names.** A map material is named like `conttree_b_lm2` while its texture is `conttree_b`. Resolve them **only via the tex/pltt-to-material dicts**. A palette can serve several materials, and textures and palettes are bound independently: `conttree_b` and `conttree_t` both use palette `conttree`.

POLYGON_ATTR (GBATEK): bits 0–3 light enables, 4–5 mode (0 modulate, 1 decal, 2 toon/highlight, 3 shadow), 6 render back face, 7 render front face, 11 translucent depth update, 12 far-plane intersect, 13 1-dot polygons, 14 depth test equal, 15 fog, 16–20 alpha (0 wireframe, 31 opaque), 24–29 polygon ID.

**Shapes** (at ofsShp): dict, data = u32 offset (from shape block start).
```
0x00 u16 itemTag ; 0x02 u16 size ; 0x04 u32 flag (1 normal, 2 colour, 4 texcoord, 8 restore-mtx)
0x08 u32 ofsDL (from shape start) ; 0x0C u32 sizeDL
```

### 2.4 Display list (GX FIFO "packed" commands)

The stream is a series of packets. Each packet is a u32 holding 4 command bytes (LSB first, `0x00` = NOP padding), followed by all their parameter words in order. Parameter word counts:

| cmd | name | words | decode |
|---|---|---|---|
| 0x10–0x1C | matrix ops (MODE, PUSH 0, POP, STORE, RESTORE, IDENTITY 0, LOAD4x4 16, LOAD4x3 12, MULT4x4 16, MULT4x3 12, MULT3x3 9, SCALE 3, TRANS 3) | | absent in field DLs; needed for multi-node or skinned cutscenes |
| 0x20 | COLOR | 1 | rgb555 → vertex colour |
| 0x21 | NORMAL | 1 | 3 × signed 10-bit (1.0.9 fixed) |
| 0x22 | TEXCOORD | 1 | s = s16 low, t = s16 high, **1.11.4 fixed, in texels**. Divide by texture width/height. DS t points down. |
| 0x23 | VTX_16 | 2 | x, y (s16 each), z (s16): fx16 4.12 |
| 0x24 | VTX_10 | 1 | 3 × signed 10-bit, value << 6 → 4.12 |
| 0x25 / 0x26 / 0x27 | VTX_XY / XZ / YZ | 1 | set two coords; the third is kept from the previous vertex |
| 0x28 | VTX_DIFF | 1 | 3 × signed 10-bit delta (1/4096 units) added to the previous vertex |
| 0x29–0x2B | POLYGON_ATTR, TEXIMAGE_PARAM, PLTT_BASE | 1 | not used inside field DLs (the material sets them) |
| 0x30–0x34 | DIF_AMB, SPE_EMI, LIGHT_VECTOR, LIGHT_COLOR, SHININESS(32) | | |
| 0x40 | BEGIN_VTXS | 1 | 0 tris, 1 quads, 2 tri strip, 3 quad strip |
| 0x41 | END_VTXS | 0 | |
| 0x50, 0x60, 0x70–0x72 | SWAP, VIEWPORT, tests | 1, 1, 3/2/1 | |

Expanding primitives into triangles:
- **Quads (0,1,2,3)** become (0,1,2) and (0,2,3).
- **Quad strip**: each new pair (v2k, v2k+1) forms a quad `v2k-2, v2k-1, v2k+1, v2k`. Note the 3↔2 swap.
- **Triangle strip**: alternate winding on odd triangles.

Set winding and culling from polyAttr bits 6/7. **Confirm the front-face convention against a fixture and a reference render early.** It is the classic source of inside-out maps. COLOR, NORMAL and TEXCOORD are sticky state that applies to the following vertices.

### 2.5 TEX0 block (textures and palettes)

```
0x00 "TEX0" ; 0x04 size
0x08 texInfo:    u32 vramKey ; u16 texDataSize>>3 ; u16 ofsDict ; u16 flag ; u16 pad ; u32 ofsTexData
0x18 tex4x4Info: u32 vramKey ; u16 size>>3 ; u16 ofsDict ; u16 flag ; u16 pad ; u32 ofsTex4x4Data ; u32 ofsTex4x4PlttIdx
0x2C plttInfo:   u32 vramKey ; u16 plttDataSize>>3 ; u16 flag ; u16 ofsDict ; u16 pad ; u32 ofsPlttData
(all offsets from TEX0 block start)
```

- **Texture dict** (unitSize 8): `u32 texImageParam`, `u32 extra`.
  - texImageParam bits: 0–15 = data offset >> 3 (relative to ofsTexData, or to the 4×4 area for format 5), 16/17 repeat S/T, 18/19 flip (mirror) S/T, 20–22 width = 8<<n, 23–25 height = 8<<n, 26–28 format, 29 colour-0-transparent, 30–31 texcoord transform mode.
  - `extra`: bits 0–10 original width, 11–21 original height, bit 31 set.
- **Palette dict** (unitSize 4): `u16 offset>>3` (relative to ofsPlttData), `u16 flag` (1 = 4-colour palette). Measured on set 20: thirty-one 4c palettes, at 16-byte stride. Palette data is BGR555.

### 2.6 Texel formats (GBATEK "DS 3D Texture Formats")

| fmt | name | bits/texel | decode |
|---|---|---|---|
| 1 | A3I5 | 8 | idx = b & 31 (32-colour palette), alpha = (b>>5) → a5 = (a3<<2)\|(a3>>1) |
| 2 | 4-colour | 2 | 4 texels per byte, LSB first |
| 3 | 16-colour | 4 | low nibble first |
| 4 | 256-colour | 8 | |
| 5 | 4×4 compressed | 2 per texel + 16-bit per block | see below; **unused in Platinum** |
| 6 | A5I3 | 8 | idx = b & 7, alpha5 = b>>3 |
| 7 | direct | 16 | rgb555 + bit15 alpha (0 = transparent); **unused in Platinum** |

Colour-0-transparent (bit 29) applies to formats 2, 3 and 4 only. Textures are linear, not tiled, row-major from the top.

**4×4 compressed (format 5)**, for completeness:
- Texel data is one u32 per 4×4 block, blocks row-major. Each row of a block is one byte, with texels at 2 bits LSB first.
- Each block also has a u16 palette-index word, stored in the PlttIdx area at `(blockByteOffset / 2)`.
  - Bits 0–13: palette offset, in units of 4 bytes, added to the material's palette base.
  - Bits 14–15: mode.
- Mode 0: colours 0–2 from the palette, 3 transparent.
- Mode 1: c0, c1, c2 = (c0+c1)/2, 3 transparent.
- Mode 2: four palette colours.
- Mode 3: c0, c1, c2 = (5c0+3c1)/8, c3 = (3c0+5c1)/8.

### 2.7 Animation blocks needed by the slice

All share: block → dict → per-animation header.

- **SRT0 / NSBTA** (header magic `M\0AT`, `u16 numFrames`, …, then a dict keyed by **material name**). Each material entry is 5 × {u32 info, u32 value-or-offset} for scaleS, scaleT, rot, transS, transT.
  - info low 16 bits = frame count. Bit 29 (`0x20000000`) = constant, with the value inline. Bit 28 selects the data width or step. Verify the details against apicula (0BSD) before implementing.
  - Measured: Lake Verity's `l_lake` animates transS and transT only, over 61 frames. Scale is constant 1.0 and rotation is constant.
- **PAT0 / NSBTP** (`M\0PT`):
  - Header: `u16 numFrames, u8 numTex, u8 numPltt, u16 ofsTexNames, u16 ofsPlttNames`, then a dict at +0x0C keyed by material.
  - Each entry holds {u16 numKeys, u16 flags, u16 ofsKeys}. Keys are {u16 frame, u8 texIdx, u8 plttIdx}.
- **JNT0 / NSBCA** (`J\0AC`): `u16 numFrames, u16 numNodes, u32 flags, u32 ofsRot3, u32 ofsRot5`, then per-node track offsets. The slice only needs door open/close.

---

## 3. Overworld characters and 2D formats

### 3.1 Characters are NSBTX frame sets drawn on a billboard model (verified)

- `/data/mmodel/mmodel.narc` members 0–420 are **BTX0 texture sets**, one per character or outfit. Each holds N textures named `<base>.<frame>` plus **one 16-colour palette**.
  - Frames are 16c, 32×32 (3,188), with colour 0 transparent.
  - NPCs have 16 frames (`babyboy1.1..16`, 6,760 bytes). The player has 32 frames (walk + run).
- **Player sprites:** member **90 = Lucas** (`pl_boy01c.1..32`, palette `pl_boy01c`, 13,352 bytes) and member **91 = Dawn** (`pl_girl01c.*`). The decomp names are `player_m.nsbtx` / `player_f.nsbtx`.
  - Bike, surf, fishing, contest, pokeball and similar outfits are separate members (92, 93, 155–167, 363–368, 415–416).
  - D/P-style players are members 417/418.
- Members 421–444 are **BMD0**. Member 421 (`generic_32x32`, model "billboad") is a single 4-vertex quad with SBC `BB` (camera-facing billboard) and material `obj` (polyAttr `0x1F0081`: light0, front faces, opaque). The 16×16 and 64×64 variants are members 422 and 428.
  - The game draws a character by rewriting that material's texture and palette address to the current frame. Decomp: `src/billboard.c`, `UpdateModelTextureAddresses`.
- Members 445–469 are **frame-sequence tables**. Layout: `u32 n; u16 startFrame[n]; u8 textureIdx[n]; u8 plttIdx[n]`.
  - textureIdx is a **dictionary index**, and the dictionary is sorted as strings (`.1, .10, .11 … .2`). So read names and sort numerically rather than trusting dict order.
  - For walk_and_run: 32 entries, each texture held for 4 animation ticks. The animation table has 8 animations × 16 ticks (4 textures each): 4 walk and 4 run, one per facing direction.
  - Map facing-direction order from decomp `object_event_gfx_data.c` (`sWalkRunBillboardAnims`). Store it in our own data tables.
- Engine implication: characters need **no model conversion**. Convert each BTX0 to one atlas (32×N px) plus a palette. Our billboard is a quad in three.js that swaps UVs per frame, with transparency from colour 0.

### 3.2 2D formats (NCGR/NCLR/NCER/NANR/NSCR): confirmed present

- Used for UI, battle, menus, the town map, Pokémon sprites (`pokegra`, 1,812 NCGR), icons, trainer sprites (`trfgra`), and so on. See §1.1 for counts.
- **Message boxes / text windows:** `/graphic/pl_winframe.narc` (50 members: 25 NCGR + 23 NCLR + NCER/NANR). Decomp sources: `res/graphics/windows/message_box_00..19.png`, `standard_field`, `standard_system`. Loaded by `render_window.c`.
- **Map name popups:** `/arc/area_win_gra.narc`, 9 × (NCGR, NCLR).
- **Signposts:** `/graphic/field_board.narc` (51 NCGR).
- Header essentials (verify against GBATEK/NitroPaint docs):
  - **NCGR:** `RGCN` header, then a `RAHC` block: u16 tilesY, u16 tilesX, u32 bpp (3 = 4bpp, 4 = 8bpp), mapping, u32 linear flag, u32 dataSize, u32 dataOffset.
  - **NCLR:** `RLCN` header, then `TTLP`: u32 bpp, ext, u32 size, u32 offset to BGR555. Plus an optional `PMCP` palette-index block.
- Some NCGR are LZ10-compressed (`.NCGR.lz` in decomp). Pokémon battle sprites in `pokegra` are additionally **encrypted** (PRNG XOR) in Gen 4. That is out of scope for v0.1.

### 3.3 Fonts: Game Freak "NFGR", not Nitro NFTR

- Path: `/graphic/pl_font.narc`, 8 members.
  - 0 = system font, 1 = message font, 2 = subscreen font, 3 = unown font. All are NFGR, 33,101 bytes each.
  - 4 = special characters, `.NCGR.lz`.
  - 5 = screen indicators NCGR.
  - 6 = `font.NCLR`.
  - 7 = screen indicators NCLR.
- `/graphic/font.narc` has the same shape and is D/P legacy.
- **No NFTR (`RTFN`) exists in the ROM.**
- NFGR layout, measured:
  - `u32 headerSize (0x10)`, `u32 widthTableOffset (32592)`, `u32 numGlyphs (509)`, `u8 maxW (16; 12 for subscreen)`, `u8 maxH (16)`, `u8 glyphTilesW (2)`, `u8 glyphTilesH (2)`.
  - Then numGlyphs × (2×2 tiles of 8×8 at **2bpp**, 64 bytes per glyph), then a u8 width table.
  - Glyph index = character code − 1 in Game Freak's charmap. That mapping belongs to the text engine.
- Reference: nitrogfx `font.c` (MIT, inside the decomp's `tools/`). It may be read closely, but write our own code.

---

## 4. Reference tools and licences

Checked via the GitHub API on 2026-10-14. **We copy code from none of them.** "Read closely" means we may study the implementation to understand a format and then write our own. "Docs-only" means we only consult README or wiki-level descriptions, or avoid them.

| Tool | What it covers | Licence (SPDX) | URL | Policy |
|---|---|---|---|---|
| **GBATEK** | DS hardware: GX commands, texture formats, polygon attrs | Doc (no code) | https://problemkaputt.de/gbatek.htm | **Canonical hardware reference** |
| apicula | NSBMD/NSBTX/BCA/BTA/BTP → glTF/DAE converter (Rust) | **0BSD** | https://github.com/scurest/apicula | Read closely (best match for our converter) |
| NitroPaint | NCGR/NCLR/NCER/NANR/NSCR/NSBTX editor incl. 4×4 encoder (C) | **BSD-2-Clause** | https://github.com/Garhoogin/NitroPaint | Read closely |
| nitrogfx (in decomp `tools/`) | NCGR/NCLR/NCER/NANR/NSCR, NFGR fonts, LZ | **MIT** (own LICENSE file) | `reference-projects/pokeplatinum/tools/nitrogfx` | Read closely |
| armips | ARM assembler (not graphics) | MIT | https://github.com/Kingcom/armips | n/a |
| dsdecmp | LZ10/LZ11/Huffman/RLE | MIT | https://github.com/Barubary/dsdecmp | Read closely |
| VGMTrans | SDAT/SSEQ/SBNK/SWAR audio | **Zlib** | https://github.com/vgmtrans/vgmtrans | Read closely (audio) |
| loveemu/vgmdocs | format notes incl. SDAT | CC-BY-SA-4.0 (docs) | https://github.com/loveemu/vgmdocs | Docs; attribute if quoted |
| nitrobtx (in decomp `tools/`) | NSBTX dump/create | **GPL-3.0** | `reference-projects/pokeplatinum/tools/nitrobtx` | Docs-only |
| Tinke | generic NDS viewer incl. NSBMD | **GPL-3.0** (archived) | https://github.com/pleonex/tinke | Docs-only |
| ndstool | ROM pack/unpack | **GPL-3.0** | https://github.com/devkitPro/ndstool | Docs-only |
| ndspy | Python NDS library | **GPL-3.0** | https://github.com/RoadrunnerWMC/ndspy | Docs-only (its docs are useful) |
| NDSFactory | ROM unpack/pack | GPL-3.0 | https://github.com/Luca1991/NDSFactory | Docs-only |
| SDATTool | SDAT unpack/build | GPL-3.0 | https://github.com/froggestspirit/SDATTool | Docs-only |
| GotaSequenceLib | SSEQ | GPL-3.0 | https://github.com/Gota7/GotaSequenceLib | Docs-only |
| Kuriimu2 / Kuriimu | generic archive and image tool | GPL-3.0 / none | https://github.com/FanTranslatorsInternational/Kuriimu2 | Docs-only |
| DSPRE (active fork) | Pokémon DS ROM editor: maps, BDHC, NSBMD export | **AGPL-3.0** | https://github.com/DS-Pokemon-Rom-Editor/DSPRE (also archived Mixone-FinallyHere fork) | Docs-only |
| DSPRE (AdAstra-LD original) | same | **none** | https://github.com/AdAstra-LD/DS-Pokemon-Rom-Editor | Docs-only |
| Pokémon DS Map Studio | Gen 4 map editor (NSBMD export, BDHC) | **none** | https://github.com/Trifindo/Pokemon-DS-Map-Studio | Docs-only |
| Every File Explorer | NSBMD/NSBTX viewer (Gericom) | **none** | https://github.com/Gericom/EveryFileExplorer | Docs-only |
| MKDS Course Modifier | NSBMD viewer/editor (Gericom) | closed-source freeware | (no repo) | Docs-only / avoid |
| NitroStudio2 | SDAT editor | **none** | https://github.com/Gota7/NitroStudio2 | Docs-only |
| pret/pokeplatinum, pokeheartgold | decomps | **none** | https://github.com/pret/pokeplatinum | Reference only (behaviour, IDs); never copy |

---

## 5. Converter plan

### 5.1 Must-have for v0.1 (bedroom/house, Twinleaf, Route 201, Lake Verity)

1. **Containers:**
   - NitroFS (FNT/FAT) and NARC (BTAF/BTNF/GMIF).
   - The land_data 4-section splitter.
   - map_matrix, area_data and area_build readers, enough to resolve the IDs in §1.3.
2. **TEX0 decode** for formats 1, 2, 3, 4 and 6:
   - Convert to RGBA8 PNG (or a palette-preserving PNG plus a palette).
   - Honour colour-0 transparency.
   - A3I5/A5I3 output real alpha.
   - The output is keyed by (texture name, palette name), because a texture can be paired with different palettes per material.
3. **MDL0 decode**, restricted to the single-node subset:
   - NODEDESC/NODE/MAT/SHP/POSSCALE/RET.
   - Node TRS for multi-node props (doors).
   - Materials: diffAmb/specEmi, polyAttr (alpha, cull bits 6/7, fog bit, light mask, polygon ID), texImageParam repeat and mirror bits, and texture/palette name binding via the bind dicts.
4. **GX display-list decode:**
   - VTX_16/10/XY/XZ/YZ/DIFF, NORMAL, COLOR, TEXCOORD, BEGIN/END for all four primitive types.
   - Triangulate. Apply posScale. Convert texcoords from texels to UV using the bound texture size, and flip V.
5. **Map assembly:**
   - Chunk models placed on the matrix grid at 512 units per cell, with altitude.
   - Props from land_data's 48-byte records, using build_model geometry and the **areabm_texset** textures.
6. **Characters:** mmodel BTX0 → atlas + palette. Frame-sequence tables → our own animation JSON. Render as a three.js billboard (no NSBMD conversion needed).
7. **Texture animations**, with all three systems present in the slice:
   - **fldtanime** frame swaps on map textures by name. Area set 6 contains `sea`, `asasea`, `hamabe`, `asahamabe`, `searock`, `rhana` (flowers) and `lakep.1`. Table entry = `char name[16]` + 18 × {u8 frameTexIdx, u8 durationTicks}, with `0xFF` as the end marker.
   - **BTA (SRT0)** scrolling on prop materials: Lake Verity props 311/74 → `l_lake`; Twinleaf prop 3; house props 114/158.
   - **BTP (PAT0)**: props 12, 13 (Twinleaf), 82, 112, 115 (house).
   - **BCA door animations**: props 26, 66–70, 246, 298, 128. These can be deferred to "doors snap open" for v0.1.
8. **Renderer parity notes** (for the engine):
   - Outdoor uses light0 + normals. Indoor is unlit with vertex colours.
   - Fog is per material.
   - Translucent prop shadows (`h_kage`/`shade`, alpha 9–12).
   - **Edge marking** (outline by polygon ID) is enabled in the field. That is a post-process if we want parity; it is optional.

### 5.2 Later

- Texture-matrix materials (37 ROM-wide in field data).
- BMA/BVA.
- Multi-node skeletal BCA beyond doors.
- NODEMIX skinning (cutscenes only).
- ENV/PRJ map.
- 4×4 and direct formats (needed for HGSS or other games, not Platinum).
- Field effects (`fldeff`).
- 2D UI formats (NCGR/NCLR/NCER/NANR/NSCR) and the NFGR font for the text box.
- BDHC collision is covered elsewhere but sits in the same land_data blob.

### 5.3 Risks

- **Winding and culling convention** of quad strips and tri strips (§2.4). Mitigate with a fixture plus one visual golden test.
- **Name binding:** material ≠ texture name. Several materials share a palette. A missing name should be a hard converter error (it is 0 on the slice).
- **Per-material palettes:** the same texture can appear with different palettes. Key the outputs by the pair.
- **Texcoord precision:** texcoords are 1.11.4 in texels, and their scale depends on the bound texture, which is not in the model file.
- **posScale:** forgetting it shrinks maps by 32–64×.
- **Alpha and sorting:** DS translucency (alpha 1–30, depth-update bit) differs from three.js transparent sorting. Prop shadows will z-fight without polygon offset.
- **fldtanime and VRAM semantics:** the game overwrites texel data for the first texture with a given name in VRAM. Model it as an animated texture keyed by name, not by material.
- **Edge marking and fog look:** this is a visual-fidelity gap, not a correctness issue.
- **Licensing:** the decomp has no licence, and DSPRE/PDSMS have AGPL or no licence. Implement from GBATEK plus our own ROM measurements. Consult apicula and NitroPaint (permissive) for confirmation.

---

## 6. Original byte fixtures for unit tests

**Rule:** no ROM bytes in the repo. Build a tiny **TypeScript fixture writer** (`tools/fixtures/` or test helpers) that emits Nitro structures from declarative JSON. The converter's parsers are tested against it. The same writer doubles as the reference for the format, so keep it small.

Minimal fixture set:

1. **NARC** with 3 members of different sizes, including an empty one, plus the FNT stub.
2. **NitroFS mini-image** (header + FNT + FAT) containing a nested directory and that NARC. The image must be a valid ROM-shaped blob; it is not a playable ROM.
3. **BTX0, all formats.** One 8×8 texture per format 1–7 (including 4×4 with all four modes and direct), with deterministic gradient texels and palettes:
   - a 4-colour palette (flag 1);
   - the colour-0-transparent bit on 2/3/4;
   - repeat/flip bits;
   - one 16×8 non-square texture.
   - Golden output: the expected RGBA arrays, computed by hand or by the writer.
4. **BMD0 "quad zoo".** One node and one material. Shapes:
   - (a) a quad via VTX_16;
   - (b) a quad strip of 3 quads via VTX_XY/XZ/YZ;
   - (c) a tri strip via VTX_10 + VTX_DIFF;
   - (d) a tri list with sticky NORMAL/COLOR/TEXCOORD.
   - posScale ≠ 1; NOP padding inside packets.
   - Golden: the triangle list with positions, UVs, colours and winding.
5. **BMD0 external-binding.** Two materials whose names differ from the texture names, a shared palette, no TEX0. Paired with a BTX0 that resolves the names. Includes one deliberate missing name, for the error path.
6. **BMD0 billboard and multi-node.** An SBC with NODEDESC parent links, a BB node, and node TRS variants (TRANS_ZERO off, full 3×3 rotation, pivot-compressed rotation, scale).
7. **land_data blob.** Header + 0x800 attributes + 2 prop records + fixture 4 + a BDHC stub.
8. **Animations:**
   - SRT0 with constant and animated tracks;
   - PAT0 with 3 keys over 2 textures;
   - minimal JNT0 (1 node, translation track).
9. **Character set:** a BTX0 with textures `x.1`..`x.12` (to exercise numeric versus string sort), plus a frame-sequence `.bin`.
10. **fldtanime table** with 2 entries and the `0xFF` terminator.
11. **2D:** NCGR at 4bpp and 8bpp (tiled), NCLR, and one LZ10 stream (compressed by our writer, including a back-reference).
12. **NFGR font:** 3 glyphs at 2bpp with a width table.

Keep each fixture under 1 KB. Commit the writer and the JSON specs, plus the generated `.bin` files so failures are easy to diff. Add a ROM-gated integration test that is skipped when `OPENSINNOH_ROM` is unset. It re-runs the §1 measurements (counts, the 0×4x4 result, slice name resolution, `numVertex` equality) so drift is caught without shipping ROM data.
