/** Minimal glTF 2.0 writer for original fixture models: one mesh, triangle primitives per material. */
export interface FixtureMaterial {
  name: string;
  /** Texture file name next to the .gltf, or a flat colour. */
  texture?: string;
  color?: [number, number, number, number];
  lantern?: Record<string, unknown>;
}

export interface FixturePrimitive {
  material: number;
  positions: number[];
  uvs: number[];
  colors?: number[];
}

export function writeGltf(name: string, materials: FixtureMaterial[], prims: FixturePrimitive[]): string {
  const chunks: Buffer[] = [];
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const addAccessor = (data: number[], type: 'VEC2' | 'VEC3' | 'VEC4', comps: number, minmax: boolean) => {
    const buf = Buffer.from(new Float32Array(data).buffer);
    chunks.push(buf);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target: 34962 });
    offset += buf.length;
    const acc: Record<string, unknown> = { bufferView: bufferViews.length - 1, componentType: 5126, count: data.length / comps, type };
    if (minmax) {
      const min = Array(comps).fill(Infinity);
      const max = Array(comps).fill(-Infinity);
      data.forEach((v, i) => {
        min[i % comps] = Math.min(min[i % comps], v);
        max[i % comps] = Math.max(max[i % comps], v);
      });
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const primitives = prims.map((p) => {
    const attributes: Record<string, number> = {
      POSITION: addAccessor(p.positions, 'VEC3', 3, true),
      TEXCOORD_0: addAccessor(p.uvs, 'VEC2', 2, false),
    };
    if (p.colors) attributes.COLOR_0 = addAccessor(p.colors, 'VEC4', 4, false);
    return { attributes, material: p.material, mode: 4 };
  });
  const images: object[] = [];
  const textures: object[] = [];
  const gltfMaterials = materials.map((m) => {
    const pbr: Record<string, unknown> = { metallicFactor: 0, roughnessFactor: 1 };
    if (m.texture) {
      images.push({ uri: m.texture });
      textures.push({ source: images.length - 1, sampler: 0 });
      pbr.baseColorTexture = { index: textures.length - 1 };
    }
    if (m.color) pbr.baseColorFactor = m.color;
    return { name: m.name, pbrMetallicRoughness: pbr, extras: { lantern: { alpha: 31, cull: 'back', fog: false, lit: false, polygonId: 0, ...m.lantern } } };
  });
  const data = Buffer.concat(chunks);
  const gltf = {
    asset: { version: '2.0', generator: 'lantern-nds fixture writer' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{ name, primitives }],
    materials: gltfMaterials,
    ...(textures.length ? { textures, images, samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }] } : {}),
    accessors,
    bufferViews,
    buffers: [{ byteLength: data.length, uri: `data:application/octet-stream;base64,${data.toString('base64')}` }],
  };
  return JSON.stringify(gltf, null, 1) + '\n';
}

/** Axis-aligned box faces (outward, CCW from outside) as triangles. */
export function box(min: [number, number, number], max: [number, number, number], uvScale = 1, faces = ['px', 'nx', 'py', 'ny', 'pz', 'nz']) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const quads: Record<string, number[][]> = {
    py: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    ny: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    pz: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    nz: [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    px: [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]],
    nx: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
  };
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const f of faces) {
    const q = quads[f] as number[][];
    const quv = [[0, uvScale], [uvScale, uvScale], [uvScale, 0], [0, 0]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      positions.push(...(q[i] as number[]));
      uvs.push(...(quv[i] as number[]));
    }
  }
  return { positions, uvs };
}
