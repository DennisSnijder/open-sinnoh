import { describe, expect, it } from 'vitest';
import { decodeTexture, findPalette, findTexture, readTex0, rgb555 } from './tex0.ts';
import { pivotRotation, readModels } from './mdl0.ts';
import { modelToGltf, trsOf } from './gltf.ts';
import { basisRotation, readJointAnimations } from './bca.ts';
import { readFrameSwapTable, readSrtAnimations } from './anim.ts';
import { billboardAnimations, buildSpriteAtlas, readFrameSequence } from './sprite.ts';
import { encodePng } from './png.ts';
import {
  gx,
  packDisplayList,
  SBC,
  writeBca0,
  writeBmd0,
  writeBta0,
  writeBtx0,
  writeFrameSequence,
  writeFrameSwapTable,
  type ModelSpec,
  type TextureSpec,
} from './testing/writer.ts';

// ---------- helpers ----------

/** Palette colour i: r = i, g = 31 - i, b = (i * 7) & 31 (distinct for i < 32). */
const pal = (n: number) => Array.from({ length: n }, (_, i) => (i & 31) | ((31 - (i & 31)) << 5) | (((i * 7) & 31) << 10));
const e5 = (v: number) => (v << 3) | (v >> 2);

function pack(indices: number[], bits: 2 | 4 | 8): number[] {
  const per = 8 / bits;
  const out: number[] = [];
  for (let i = 0; i < indices.length; i += per) {
    let b = 0;
    for (let k = 0; k < per; k++) b |= ((indices[i + k] as number) & ((1 << bits) - 1)) << (k * bits);
    out.push(b);
  }
  return out;
}

const ramp = (n: number, mod: number) => Array.from({ length: n }, (_, i) => (i * 3 + (i >> 3)) % mod);

interface GltfJson {
  accessors: { bufferView: number; count: number; componentType: number; type: string; normalized?: boolean }[];
  bufferViews: { byteOffset: number; byteLength: number }[];
  buffers: { uri: string }[];
  meshes: { primitives: { attributes: Record<string, number>; indices: number; material: number }[] }[];
  materials: { name: string; alphaMode?: string; doubleSided?: boolean; extras: { lantern: Record<string, unknown> }; pbrMetallicRoughness: { baseColorTexture?: unknown } }[];
  nodes: { name: string; mesh?: number; matrix?: number[]; children?: number[]; extras?: { lantern: { billboard: string } } }[];
  images?: { uri: string }[];
}

function accessor(g: GltfJson, i: number): number[] {
  const a = g.accessors[i]!;
  const v = g.bufferViews[a.bufferView]!;
  const bin = Uint8Array.from(atob(g.buffers[0]!.uri.split(',')[1]!), (c) => c.charCodeAt(0));
  const slice = bin.slice(v.byteOffset, v.byteOffset + v.byteLength);
  const arr = a.componentType === 5126 ? new Float32Array(slice.buffer) : a.componentType === 5123 ? new Uint16Array(slice.buffer) : a.componentType === 5125 ? new Uint32Array(slice.buffer) : slice;
  return [...arr];
}

const round = (xs: number[], d = 4) => xs.map((x) => Math.round(x * 10 ** d) / 10 ** d);

// ---------- TEX0 ----------

describe('TEX0 texel formats', () => {
  const idx8x8 = (mod: number) => ramp(64, mod);
  const textures: TextureSpec[] = [
    { name: 'a3i5', format: 'a3i5', width: 8, height: 8, texels: idx8x8(256) },
    { name: 'c4', format: '4c', width: 8, height: 8, texels: pack(idx8x8(4), 2), color0Transparent: true },
    { name: 'c16', format: '16c', width: 8, height: 8, texels: pack(idx8x8(16), 4), color0Transparent: true, repeatS: true, flipT: true },
    { name: 'c256', format: '256c', width: 8, height: 8, texels: idx8x8(256), color0Transparent: true },
    { name: 'a5i3', format: 'a5i3', width: 8, height: 8, texels: idx8x8(256) },
    { name: 'direct', format: 'direct', width: 8, height: 8, texels: idx8x8(0xffff).flatMap((v, i) => [(v * 977) & 0xff, (((v * 977) >> 8) & 0x7f) | (i & 1 ? 0x80 : 0)]) },
    { name: 'wide16c', format: '16c', width: 16, height: 8, texels: pack(ramp(128, 16), 4) },
  ];
  const palettes = [
    { name: 'p4', colors: pal(4) },
    { name: 'p256', colors: pal(256) },
  ];
  const tex0 = readTex0(writeBtx0(textures, palettes))!;

  /** Independent reference: what each format means (GBATEK "DS 3D Texture Formats"). */
  function expected(t: TextureSpec, colors: number[]): number[] {
    const out: number[] = [];
    const n = t.width * t.height;
    for (let i = 0; i < n; i++) {
      const raw = t.texels;
      let idx = 0;
      let a = 255;
      switch (t.format) {
        case 'a3i5': {
          const b = raw[i] as number;
          idx = b & 31;
          const a3 = b >> 5;
          a = e5((a3 << 2) | (a3 >> 1));
          break;
        }
        case 'a5i3': {
          const b = raw[i] as number;
          idx = b & 7;
          a = e5(b >> 3);
          break;
        }
        case '4c':
          idx = ((raw[i >> 2] as number) >> ((i % 4) * 2)) & 3;
          break;
        case '16c':
          idx = ((raw[i >> 1] as number) >> ((i % 2) * 4)) & 15;
          break;
        case '256c':
          idx = raw[i] as number;
          break;
        case 'direct': {
          const c = (raw[i * 2] as number) | ((raw[i * 2 + 1] as number) << 8);
          out.push(...rgb555(c), c & 0x8000 ? 255 : 0);
          continue;
        }
      }
      if (t.color0Transparent && idx === 0) a = 0;
      out.push(...rgb555(colors[idx] as number), a);
    }
    return out;
  }

  for (const t of textures) {
    it(`decodes ${t.name} (${t.format} ${t.width}×${t.height})`, () => {
      const info = findTexture(tex0, t.name);
      expect([info.format, info.width, info.height, info.color0Transparent]).toEqual([t.format, t.width, t.height, !!t.color0Transparent]);
      const p = t.format === '4c' ? 'p4' : 'p256';
      const rgba = decodeTexture(tex0, info, t.format === 'direct' ? null : findPalette(tex0, p));
      expect([...rgba]).toEqual(expected(t, t.format === '4c' ? pal(4) : pal(256)));
    });
  }

  it('spot-checks alpha expansion and colour 0', () => {
    // a3i5 byte 0x25: index 5, a3 = 1 → a5 = 4 → a8 = 33. a5i3 byte 0xFA: index 2, a5 = 31 → 255.
    const t = readTex0(writeBtx0([{ name: 'a', format: 'a3i5', width: 8, height: 8, texels: [0x25, ...Array(63).fill(0)] }, { name: 'b', format: 'a5i3', width: 8, height: 8, texels: [0xfa, ...Array(63).fill(0)] }], [{ name: 'p', colors: pal(32) }]))!;
    const a = decodeTexture(t, findTexture(t, 'a'), findPalette(t, 'p'));
    const b = decodeTexture(t, findTexture(t, 'b'), findPalette(t, 'p'));
    expect([...a.subarray(0, 4)]).toEqual([e5(5), e5(26), e5(3), 33]);
    expect([...b.subarray(0, 4)]).toEqual([e5(2), e5(29), e5(14), 255]);
    expect(a[7]).toBe(0); // second texel: byte 0 → alpha 0 (a3 = 0), not colour-0 transparency
  });

  it('reads repeat and flip bits', () => {
    const c16 = findTexture(tex0, 'c16');
    expect([c16.repeatS, c16.repeatT, c16.flipS, c16.flipT]).toEqual([true, false, false, true]);
  });

  it('rejects 4x4-compressed textures with a clear error', () => {
    const info = { ...findTexture(tex0, 'c16'), format: '4x4' as const };
    expect(() => decodeTexture(tex0, info, findPalette(tex0, 'p256'))).toThrow(/4x4-compressed texels, which are not implemented/);
  });

  it('encodes PNG', () => {
    const png = encodePng(2, 1, new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128]));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });
});

// ---------- MDL0 / GX ----------

/** Quad zoo: one shape per primitive type, every vertex command, posScale 2, NOP padding. */
const zoo: ModelSpec = {
  name: 'zoo',
  posScale: 2,
  numVertex: 4 + 8 + 5 + 3,
  materials: [{ name: 'flat', polyAttr: 0x1f00c0 }],
  shapes: [
    {
      // (a) quad via VTX_16, ground plane, listed so that its face points up (+y)
      name: 'quad',
      dl: packDisplayList([gx.begin(1), gx.color(31, 0, 0), gx.vtx16(0, 0, 0), gx.vtx16(0, 0, 1), gx.nop(), gx.vtx16(1, 0, 1), gx.vtx16(1, 0, 0), gx.end()]),
    },
    {
      // (b) quad strip of 3 quads via XY/XZ/YZ (third coordinate kept from the previous vertex)
      name: 'qstrip',
      dl: packDisplayList([
        gx.begin(3),
        gx.xy(0, 0),
        gx.yz(0, 1),
        gx.xz(1, 0),
        gx.yz(0, 1),
        gx.xz(2, 0),
        gx.yz(0, 1),
        gx.vtx16(3, 0, 0),
        gx.yz(0, 1),
        gx.end(),
      ]),
    },
    {
      // (c) triangle strip via VTX_10 + VTX_DIFF
      name: 'tstrip',
      dl: packDisplayList([gx.begin(2), gx.vtx10(0, 1, 0), gx.vtx10(0, 1, 0.5), gx.diff(0.0625, 0, -0.0625), gx.diff(0, 0, 0.0625), gx.diff(0.0625, 0, -0.0625), gx.end()]),
    },
    {
      // (d) triangle list with sticky NORMAL / COLOR / TEXCOORD
      name: 'tris',
      dl: packDisplayList([gx.begin(0), gx.normal(0, 0.5, -0.25), gx.color(0, 31, 0), gx.texcoord(0, 0), gx.vtx16(0, 2, 0), gx.texcoord(0, 8), gx.vtx16(0, 2, 1), gx.color(0, 0, 31), gx.texcoord(8, 8), gx.vtx16(1, 2, 1), gx.end()]),
    },
  ],
  sbc: [SBC.NODEDESC, 0, 0, 0, SBC.NODE, 0, 1, SBC.POSSCALE, SBC.MAT, 0, SBC.SHP, 0, SBC.SHP, 1, SBC.SHP, 2, SBC.SHP, 3, SBC.POSSCALE | 0x20, SBC.RET],
};

describe('MDL0 quad zoo → glTF', () => {
  const [model] = readModels(writeBmd0([zoo]));
  const { gltf, vertexCount } = modelToGltf(model!);
  const g = gltf as GltfJson;
  const prims = g.meshes[0]!.primitives;

  it('decodes header and every vertex', () => {
    expect(model!.posScale).toBe(2);
    expect(vertexCount).toBe(model!.numVertex);
    expect(prims).toHaveLength(4);
  });

  it('quad: positions × posScale, sticky colour, two CCW triangles', () => {
    const p = prims[0]!;
    expect(accessor(g, p.attributes.POSITION!)).toEqual([0, 0, 0, 0, 0, 2, 2, 0, 2, 2, 0, 0]);
    expect(accessor(g, p.indices)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(accessor(g, p.attributes.COLOR_0!)).toEqual(Array(4).fill([255, 0, 0, 255]).flat());
  });

  it('quad strip: partial vertex commands and the 3↔2 swap', () => {
    const p = prims[1]!;
    expect(accessor(g, p.attributes.POSITION!)).toEqual([0, 0, 0, 0, 0, 2, 2, 0, 0, 2, 0, 2, 4, 0, 0, 4, 0, 2, 6, 0, 0, 6, 0, 2]);
    expect(accessor(g, p.indices)).toEqual([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 4, 5, 7, 4, 7, 6]);
  });

  it('triangle strip: VTX_10, VTX_DIFF and alternating winding', () => {
    const p = prims[2]!;
    expect(round(accessor(g, p.attributes.POSITION!))).toEqual(round([0, 2, 0, 0, 2, 1, 0.125, 2, 0.875, 0.125, 2, 1, 0.25, 2, 0.875]));
    expect(accessor(g, p.indices)).toEqual([0, 1, 2, 2, 1, 3, 2, 3, 4]);
  });

  it('triangle list: sticky normal/colour/texcoord, UVs in texture units', () => {
    const p = prims[3]!;
    expect(accessor(g, p.attributes.NORMAL!)).toEqual([0, 0.5, -0.25, 0, 0.5, -0.25, 0, 0.5, -0.25]);
    expect(accessor(g, p.attributes.COLOR_0!)).toEqual([0, 255, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    expect(p.attributes.TEXCOORD_0).toBeUndefined(); // material has no texture
  });

  it('winding: every face normal computed from the index order points up (+y), as on the ROM', () => {
    for (const p of [prims[0]!, prims[1]!, prims[2]!, prims[3]!]) {
      const pos = accessor(g, p.attributes.POSITION!);
      const idx = accessor(g, p.indices);
      for (let i = 0; i < idx.length; i += 3) {
        const [a, b, c] = [idx[i]!, idx[i + 1]!, idx[i + 2]!].map((k) => pos.slice(k * 3, k * 3 + 3)) as [number[], number[], number[]];
        const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
        const v = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
        const ny = u[2]! * v[0]! - u[0]! * v[2]!;
        expect(ny).toBeGreaterThan(0);
      }
    }
  });

  it('material state goes to extras.lantern', () => {
    // 0x1f00c0: both faces, alpha 31, no lights, fog off
    expect(g.materials[0]!.extras.lantern).toMatchObject({ alpha: 31, cull: 'none', fog: false, lit: false, polygonId: 0 });
    expect(g.materials[0]!.doubleSided).toBe(true);
  });
});

describe('MDL0 external texture binding', () => {
  const quadUv = packDisplayList([gx.begin(1), gx.texcoord(0, 0), gx.vtx16(0, 0, 0), gx.texcoord(0, 16), gx.vtx16(0, 0, 1), gx.texcoord(32, 16), gx.vtx16(1, 0, 1), gx.texcoord(32, 0), gx.vtx16(1, 0, 0), gx.end()]);
  const spec: ModelSpec = {
    name: 'bound',
    numVertex: 8,
    materials: [
      { name: 'stone_lm1', texture: 'stone', palette: 'shared', width: 32, height: 16, polyAttr: 0x3a1f8081, texParam: 0x50000 },
      { name: 'grass_lm1', texture: 'grass', palette: 'shared', width: 32, height: 16, polyAttr: 0x0c0840 },
    ],
    shapes: [
      { name: 's0', dl: quadUv },
      { name: 's1', dl: quadUv },
    ],
  };
  const [model] = readModels(writeBmd0([spec]));

  it('names texture and palette per material and emits no images', () => {
    expect(model!.materials.map((m) => [m.name, m.texture, m.palette])).toEqual([
      ['stone_lm1', 'stone', 'shared'],
      ['grass_lm1', 'grass', 'shared'],
    ]);
    const g = modelToGltf(model!).gltf as GltfJson;
    expect(g.images).toBeUndefined();
    expect(g.materials[0]!.extras.lantern).toMatchObject({ texture: 'stone', palette: 'shared', alpha: 31, cull: 'back', fog: true, lit: true, polygonId: 58, depthUpdate: false, wrapS: 33648, wrapT: 33071 });
    expect(g.materials[1]!.extras.lantern).toMatchObject({ alpha: 12, cull: 'front', lit: false, depthUpdate: true });
    expect(g.materials[1]!.alphaMode).toBe('BLEND');
    expect(accessor(g, g.meshes[0]!.primitives[0]!.attributes.TEXCOORD_0!)).toEqual([0, 0, 0, 1, 1, 1, 1, 0]);
  });

  const stone = { name: 'stone', format: '16c' as const, width: 32, height: 16, texels: Array(256).fill(0x21) };
  it('embeds images from a texture set, keyed <texture>__<palette>', () => {
    const set = readTex0(writeBtx0([stone, { ...stone, name: 'grass', format: '4c', texels: Array(128).fill(0xe4) }], [{ name: 'shared', colors: pal(16) }]))!;
    const res = modelToGltf(model!, { embed: set });
    expect([...res.images.keys()]).toEqual(['stone__shared.png', 'grass__shared.png']);
    expect((res.gltf as GltfJson).images).toEqual([{ uri: 'stone__shared.png' }, { uri: 'grass__shared.png' }]);
  });

  it('fails loudly when a bound name is missing from the set', () => {
    const set = readTex0(writeBtx0([stone], [{ name: 'shared', colors: pal(16) }]))!;
    expect(() => modelToGltf(model!, { embed: set })).toThrow(/no texture "grass"/);
  });
});

describe('MDL0 nodes', () => {
  const fx = (v: number) => ({ u32: Math.round(v * 4096) >>> 0 });
  const h = (v: number) => ({ u16: Math.round(v * 4096) & 0xffff });
  const dl = packDisplayList([gx.begin(0), gx.vtx16(0, 0, 0), gx.vtx16(0, 0, 1), gx.vtx16(1, 0, 0), gx.end()]);
  const spec: ModelSpec = {
    name: 'nodes',
    numVertex: 6,
    nodes: [
      { name: 'root' },
      // translation (1,2,3), full 3×3 rotation (90° about y), scale (2,2,2)
      { name: 'trs', flag: 0x0000, m00: 0, data: [fx(1), fx(2), fx(3), h(0), h(-1), h(0), h(1), h(0), h(1), h(0), h(0), fx(2), fx(2), fx(2), fx(0.5), fx(0.5), fx(0.5)] },
      // pivot rotation: pivot 0 (x axis), a = cos 90° = 0, b = sin 90° = 1; translation zero, scale one
      { name: 'pivot', flag: 0x0001 | 0x0004 | 0x0008, data: [h(0), h(1)] },
    ],
    materials: [{ name: 'm' }],
    shapes: [{ name: 's', dl }],
    sbc: [SBC.NODEDESC, 0, 0, 0, SBC.NODEDESC | 0x20, 1, 0, 0, 0, SBC.MAT, 0, SBC.SHP, 0, SBC.NODEDESC, 2, 1, 0, SBC.BB, 2, SBC.MTX, 0, SBC.SHP, 0, SBC.RET],
  };
  const [model] = readModels(writeBmd0([spec]));
  const g = modelToGltf(model!).gltf as GltfJson;

  it('builds the hierarchy from NODEDESC and draws under the current node', () => {
    expect(g.nodes.map((n) => [n.name, n.children ?? [], n.mesh])).toEqual([
      ['root', [1], undefined],
      ['trs', [2], 0],
      ['pivot', [], undefined],
    ]);
    // MTX 0 restores node 1 (stored by NODEDESC opt 1), so both draws land on node 1
    expect(g.meshes[0]!.primitives).toHaveLength(2);
    expect(g.nodes[2]!.extras?.lantern.billboard).toBe('full');
  });

  it('composes T·R·S into a column-major matrix', () => {
    expect(round(g.nodes[1]!.matrix!)).toEqual([0, 0, -2, 0, 0, 2, 0, 0, 2, 0, 0, 0, 1, 2, 3, 1].map((v) => v + 0));
  });

  it('expands pivot-compressed rotations', () => {
    expect(round(g.nodes[2]!.matrix!)).toEqual([1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1]);
  });
});

describe('rigidly skinned shapes (MTX_RESTORE in the display list)', () => {
  const fx = (v: number) => ({ u32: Math.round(v * 4096) >>> 0 });
  // MTX_RESTORE slot 0, a vertex; MTX_RESTORE slot 1 and MTX_SCALE ×2, two vertices.
  const dl = packDisplayList([[0x14, 0], gx.begin(0), gx.vtx16(0, 0, 0), [0x14, 1], [0x1b, 2 * 4096, 2 * 4096, 2 * 4096], gx.vtx16(1, 0, 0), gx.vtx16(0, 0, 1), gx.end()]);
  const spec: ModelSpec = {
    name: 'skin',
    posScale: 4,
    numVertex: 3,
    nodes: [{ name: 'root' }, { name: 'arm', flag: 0x0002 | 0x0004, data: [fx(10), fx(0), fx(0)] }],
    materials: [{ name: 'm' }],
    shapes: [{ name: 's', dl }],
    // NODEDESC opt 1 stores each node's matrix in a stack slot; the draw sits under the root.
    sbc: [SBC.NODEDESC | 0x20, 0, 0, 0, 0, SBC.NODEDESC | 0x20, 1, 0, 0, 1, SBC.MTX, 0, SBC.MAT, 0, SBC.SHP, 0, SBC.RET],
  };
  const [model] = readModels(writeBmd0([spec]));
  const g = modelToGltf(model!).gltf as GltfJson & { skins: { joints: number[]; inverseBindMatrices: number }[] };

  it('binds each vertex to the restored node, in bind-pose model space', () => {
    expect(model!.draws[0]!.stack!.slice(0, 3)).toEqual([0, 1, null]);
    const skinned = g.nodes.findIndex((n) => n.name === 'skin-skinned');
    expect(skinned).toBeGreaterThan(0);
    const prim = g.meshes[g.nodes[skinned]!.mesh!]!.primitives[0]!;
    // Restoring drops posScale (4); MTX_SCALE re-applies 2. The arm node adds its translation.
    expect(round(accessor(g, prim.attributes.POSITION!))).toEqual([0, 0, 0, 12, 0, 0, 10, 0, 2]);
    expect(accessor(g, prim.attributes.JOINTS_0!)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    expect(g.skins[0]!.joints).toEqual([0, 1]);
    expect(round(accessor(g, g.skins[0]!.inverseBindMatrices)).slice(16).map((x) => x + 0)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -10, 0, 0, 1]);
  });
});

describe('JNT0 basis-table rotations (rot5)', () => {
  /** Packs two unit rows (the sixth value split over the low bits) like the ROM's rot5 table. */
  const pack5 = (v: number[]): number[] => {
    const q = v.map((x) => Math.round(x * 4096));
    const six = q[5]! & 0x1fff;
    const low = [(six >> 9) & 7, (six >> 6) & 7, (six >> 3) & 7, six & 7, (six >> 12) & 1];
    return q.slice(0, 5).map((x, i) => (((x & 0x1fff) << 3) | low[i]!) & 0xffff);
  };

  it('unpacks two rows and completes the third by their cross product', () => {
    // fx 1.12 in 13 bits holds −1 but not +1.
    expect(round(basisRotation(pack5([0.6, 0, -0.8, 0, -1, 0])), 3).map((x) => x + 0)).toEqual([0.6, 0, -0.8, 0, -1, 0, -0.8, 0, -0.6]);
    // A negative sixth value takes its sign from u16 4.
    expect(round(basisRotation(pack5([-1, 0, 0, 0, 0.6, -0.8])), 3).map((x) => x + 0)).toEqual([-1, 0, 0, 0, 0.6, -0.8, 0, -0.8, -0.6]);
  });

  it('rejects rows that are not unit length', () => {
    expect(() => basisRotation([0, 0, 0, 0, 0])).toThrow(/unit length/);
  });
});

// ---------- animations and characters ----------

describe('JNT0 joint animation (door open/close)', () => {
  const s = Math.SQRT1_2;
  // A hinged door: node 0 swings about y (pivot 4 = the y entry is ±1) over 3 frames, slides in x
  // (fx32) and stretches in y (fx16 scale pairs); node 1 keeps its rest translation.
  const file = writeBca0('door_op', 3, [
    {
      translation: [{ fx32: [0, 1, 2] }, 0, -0.5],
      rotation: [
        { pivot: 4, neg: 2, a: 1, b: 0 },
        { pivot: 4, neg: 2, a: s, b: s },
        { pivot: 4, neg: 2, a: 0, b: 1 },
      ],
      scale: [1, { fx16: [1, 1.5, 2] }, 1],
    },
    { translation: 'rest', rotation: [{ pivot: 0, neg: 0, a: 1, b: 0 }], scale: 'rest' },
  ]);
  const dl = packDisplayList([gx.begin(0), gx.vtx16(0, 0, 0), gx.vtx16(0, 0, 1), gx.vtx16(1, 0, 0), gx.end()]);
  const fx = (v: number) => ({ u32: Math.round(v * 4096) >>> 0 });
  const model = readModels(
    writeBmd0([
      {
        name: 'door',
        numVertex: 3,
        nodes: [{ name: 'hinge' }, { name: 'leaf', flag: 0x0006, data: [fx(4), fx(0), fx(0)] }],
        materials: [{ name: 'm' }],
        shapes: [{ name: 's', dl }],
        sbc: [SBC.NODEDESC, 0, 0, 0, SBC.NODEDESC, 1, 0, 0, SBC.MAT, 0, SBC.SHP, 0, SBC.RET],
      },
    ]),
  )[0]!;

  it('reads per-frame translation, pivot rotations and scale; rest and identity tracks', () => {
    const [a] = readJointAnimations(file);
    expect(a!.name).toBe('door_op');
    expect(a!.frames).toBe(3);
    const [t0, t1] = a!.tracks;
    expect(t0!.translation).toEqual([
      [0, 0, -0.5],
      [1, 0, -0.5],
      [2, 0, -0.5],
    ]);
    expect((t0!.scale as number[][]).map((v) => v[1])).toEqual([1, 1.5, 2]);
    // pivot 4, neg bit 1: rows/cols 0 and 2 hold a, b, -b, a (column-major), the y entry is 1
    expect(round((t0!.rotation as number[][])[2]!)).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    expect(t1).toMatchObject({ node: 1, translation: 'rest', scale: 'rest' });
    expect((t1!.rotation as number[][]).every((m) => m.join() === '1,0,0,0,1,0,0,0,1')).toBe(true);
  });

  it('becomes a glTF clip on TRS nodes, one DS frame per 1/30 s', () => {
    const g = modelToGltf(model, { animations: [{ clip: 'open', animation: readJointAnimations(file)[0]! }] }).gltf as GltfJson & {
      animations: { name: string; samplers: { input: number; output: number; interpolation: string }[]; channels: { sampler: number; target: { node: number; path: string } }[] }[];
      nodes: { translation?: number[]; rotation?: number[]; scale?: number[] }[];
    };
    expect(g.nodes[1]).toMatchObject({ translation: [4, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
    expect(g.nodes[1]!.matrix).toBeUndefined();
    const [clip] = g.animations;
    expect(clip!.name).toBe('open');
    expect(clip!.channels.map((c) => `${c.target.node}.${c.target.path}`)).toEqual(['0.translation', '0.rotation', '0.scale', '1.translation', '1.rotation', '1.scale']);
    const out = (path: string, node = 0) => accessor(g, clip!.samplers[clip!.channels.find((c) => c.target.node === node && c.target.path === path)!.sampler]!.output);
    expect(round(accessor(g, clip!.samplers[0]!.input))).toEqual(round([0, 1 / 30, 2 / 30]));
    expect(round(out('translation'))).toEqual([0, 0, -0.5, 1, 0, -0.5, 2, 0, -0.5]);
    // -90° about y (col0 = (cos, 0, -sin)) at the last frame; the rest-translation track repeats the node value
    expect(round(out('rotation').slice(8), 3)).toEqual(round([0, -Math.SQRT1_2, 0, Math.SQRT1_2], 3));
    expect(out('translation', 1)).toEqual([4, 0, 0, 4, 0, 0, 4, 0, 0]);
  });

  it('expands an off-diagonal pivot (2) into a proper rotation: 90° doors on the ROM use it', () => {
    // pivot 2 = DS row 0, column 2; a = cos 90°, b = sin 90°, neg bit 1 negates c
    const m = pivotRotation(2, 2, 0, 1);
    expect(m.map((x) => x + 0)).toEqual([0, 0, 1, 0, 1, 0, -1, 0, 0]);
    const [c0, c1, c2] = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)] as [number[], number[], number[]];
    const det = c0[0]! * (c1[1]! * c2[2]! - c1[2]! * c2[1]!) - c1[0]! * (c0[1]! * c2[2]! - c0[2]! * c2[1]!) + c2[0]! * (c0[1]! * c1[2]! - c0[2]! * c1[1]!);
    expect(det).toBe(1);
  });

  it('decomposes rest matrices into TRS', () => {
    const trs = trsOf([0, 0, -2, 0, 0, 2, 0, 0, 2, 0, 0, 0, 1, 2, 3, 1]);
    expect(trs.translation).toEqual([1, 2, 3]);
    expect(round(trs.scale)).toEqual([2, 2, 2]);
    expect(round(trs.rotation)).toEqual(round([0, Math.SQRT1_2, 0, Math.SQRT1_2]));
  });
});

describe('SRT0 texture scroll', () => {
  it('reads constant, fx16 and fx32 tracks', () => {
    const file = writeBta0('anim', 4, [
      { material: 'water', tracks: [{ const: 4096 }, { const: 4096 }, { const: 0x10000000 }, { fx16: [0, -0.25, -0.5, -0.75] }, { fx32: [0, 0.125, 0.25, 0.375] }] },
      { material: 'still', tracks: [{ const: 4096 }, { const: 8192 }, { const: 0x10000000 }, { const: 0 }, { const: 2048 }] },
    ]);
    const [a] = readSrtAnimations(file);
    expect(a!.frames).toBe(4);
    expect(a!.materials).toEqual([
      { material: 'water', scaleS: 1, scaleT: 1, rotation: [0, 1], translateS: [0, -0.25, -0.5, -0.75], translateT: [0, 0.125, 0.25, 0.375] },
      { material: 'still', scaleS: 1, scaleT: 2, rotation: [0, 1], translateS: 0, translateT: 0.5 },
    ]);
  });

  it('rejects stepped tracks', () => {
    const file = writeBta0('anim', 4, [{ material: 'w', tracks: [{ const: 4096 }, { const: 4096 }, { const: 0x10000000 }, { fx16: [0, 0] }, { const: 0 }] }], (k) => (k === 3 ? 0x50000004 : undefined));
    expect(() => readSrtAnimations(file)).toThrow(/stepped track/);
  });
});

describe('fldtanime frame swaps', () => {
  it('reads entries until the 0xFF terminator; ticks = duration + 1', () => {
    const table = writeFrameSwapTable([
      { texture: 'sea', frames: [{ index: 0, duration: 9 }, { index: 1, duration: 9 }] },
      { texture: 'lamp.1', frames: [{ index: 2, duration: 0 }, { index: 0, duration: 4 }, { index: 1, duration: 2 }] },
    ]);
    expect(readFrameSwapTable(table)).toEqual([
      { texture: 'sea', frames: [{ textureIndex: 0, ticks: 10 }, { textureIndex: 1, ticks: 10 }] },
      { texture: 'lamp.1', frames: [{ textureIndex: 2, ticks: 1 }, { textureIndex: 0, ticks: 5 }, { textureIndex: 1, ticks: 3 }] },
    ]);
  });
});

describe('billboard sprite sets', () => {
  // x.1..x.12 (8×8): the dict is sorted as strings (x.1, x.10, x.11, x.12, x.2, …); frame n is a solid index n.
  const names = Array.from({ length: 12 }, (_, i) => `x.${i + 1}`).sort();
  const set = readTex0(writeBtx0(names.map((name) => ({ name, format: '16c' as const, width: 8, height: 8, texels: Array(32).fill(Number(name.slice(2)) * 17 & 0xff) })), [{ name: 'x', colors: pal(16) }]))!;
  const atlas = buildSpriteAtlas(set);

  it('orders atlas frames by numeric suffix', () => {
    expect([atlas.frameSize, atlas.frameCount, atlas.width]).toEqual([8, 12, 96]);
    expect(atlas.frameOfTexture).toEqual(names.map((n) => Number(n.slice(2)) - 1));
    // frame k (0-based) is colour (k+1) & 15
    for (let k = 0; k < 12; k++) expect([...atlas.rgba.subarray(k * 8 * 4, k * 8 * 4 + 3)]).toEqual(rgb555(pal(16)[(k + 1) & 15]!));
  });

  it('maps a frame-sequence table to stand/walk animations per direction', () => {
    // 4 directions × 16 anim frames; each direction shows 3 textures (dict index order)
    const entries = [];
    for (let d = 0; d < 4; d++) {
      entries.push({ start: d * 16, texture: names.indexOf(`x.${d * 3 + 1}`) });
      entries.push({ start: d * 16 + 4, texture: names.indexOf(`x.${d * 3 + 2}`) });
      entries.push({ start: d * 16 + 8, texture: names.indexOf(`x.${d * 3 + 1}`) });
      entries.push({ start: d * 16 + 12, texture: names.indexOf(`x.${d * 3 + 3}`) });
    }
    const anims = billboardAnimations(readFrameSequence(writeFrameSequence(entries)), atlas, false);
    expect(Object.keys(anims).sort()).toEqual(['stand-down', 'stand-left', 'stand-right', 'stand-up', 'walk-down', 'walk-left', 'walk-right', 'walk-up']);
    expect(anims['stand-up']).toEqual([{ frame: 0, ticks: 1 }]);
    expect(anims['walk-down']).toEqual([
      { frame: 3, ticks: 4 },
      { frame: 4, ticks: 4 },
      { frame: 3, ticks: 4 },
      { frame: 5, ticks: 4 },
    ]);
    expect(anims['stand-right']).toEqual([{ frame: 9, ticks: 1 }]);
  });
});
