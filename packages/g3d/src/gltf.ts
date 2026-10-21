import { decodeShape, type Material, type Model } from './mdl0.ts';
import { triangulate } from './gx.ts';
import { decodeTexture, findPalette, findTexture, type Tex0, type TexelFormat } from './tex0.ts';
import { encodePng } from './png.ts';
import type { JointAnimation, Vec3 } from './bca.ts';

/** DS material state carried in glTF `materials[].extras.lantern` (see contracts records.ts `Model`). */
export interface OpenSinnohMaterial {
  alpha: number;
  cull: 'back' | 'front' | 'none';
  fog: boolean;
  lit: boolean;
  polygonId: number;
  /** POLYGON_ATTR bit 11: translucent pixels write their depth (else they keep the depth under them). */
  depthUpdate: boolean;
  texture?: string;
  palette?: string;
  /** DIF_AMB / SPE_EMI colours as linear 0..1 RGB (DS rgb555 / 31). */
  diffuse: [number, number, number];
  ambient: [number, number, number];
  specular: [number, number, number];
  emission: [number, number, number];
  /** POLYGON_ATTR light-enable mask (bits 0–3). */
  lights: number;
}

export interface ConvertOptions {
  textureMatrices?: boolean;
  /** Rigid vertices remain in their selected joint's local space, permitting zero-scale rest poses. */
  localJointVertices?: boolean;
  /**
   * Embed textures from this TEX0 (images named `<texture>__<palette>.png`, returned in `images`).
   * Absent = name binding only: materials name texture + palette and the glTF has no images.
   */
  embed?: Tex0;
  /** Format of a texture by name (for alphaMode); used when not embedding. */
  textureFormat?: (name: string) => { format: TexelFormat; color0Transparent: boolean } | undefined;
  /**
   * Joint animations to add as glTF animation clips (clip name → animation). Animated models write
   * every node as TRS (glTF forbids animating a `matrix` node). One DS frame = 1/30 s.
   */
  animations?: { clip: string; animation: JointAnimation }[];
}

export interface ConvertResult {
  gltf: object;
  /** File name → PNG bytes (only when embedding). */
  images: Map<string, Uint8Array>;
  /** Unsupported-but-ignored features, one entry per occurrence kind. */
  warnings: string[];
  /** Decoded vertex count (equals the header's numVertex for well-formed models). */
  vertexCount: number;
}

const c555 = (c: number): [number, number, number] => [(c & 31) / 31, ((c >> 5) & 31) / 31, ((c >> 10) & 31) / 31];

export function openSinnohMaterial(m: Material): OpenSinnohMaterial {
  const a = m.polyAttr;
  const back = (a >> 6) & 1;
  const front = (a >> 7) & 1;
  if (!back && !front) throw new Error(`material ${m.name}: renders neither face`);
  const out: OpenSinnohMaterial = {
    alpha: (a >> 16) & 31,
    // cull = which faces are hidden
    cull: back && front ? 'none' : front ? 'back' : 'front',
    fog: ((a >> 15) & 1) === 1,
    lit: (a & 15) !== 0,
    polygonId: (a >> 24) & 63,
    depthUpdate: ((a >> 11) & 1) === 1,
    diffuse: c555(m.diffAmb),
    ambient: c555(m.diffAmb >>> 16),
    specular: c555(m.specEmi),
    emission: c555(m.specEmi >>> 16),
    lights: a & 15,
  };
  if (m.texture) out.texture = m.texture;
  if (m.palette) out.palette = m.palette;
  return out;
}

const WRAP = (repeat: number, flip: number) => (!repeat ? 33071 : flip ? 33648 : 10497);

/** Converts a decoded MDL0 model to glTF 2.0 (JSON with an embedded base64 buffer). */
export function modelToGltf(model: Model, opts: ConvertOptions = {}): ConvertResult {
  const warnings = new Set<string>();
  const images = new Map<string, Uint8Array>();
  const bin: Uint8Array[] = [];
  let binLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const addView = (bytes: Uint8Array, target: number) => {
    const pad = (4 - (binLength % 4)) % 4;
    if (pad) {
      bin.push(new Uint8Array(pad));
      binLength += pad;
    }
    bufferViews.push(target ? { buffer: 0, byteOffset: binLength, byteLength: bytes.length, target } : { buffer: 0, byteOffset: binLength, byteLength: bytes.length });
    bin.push(bytes);
    binLength += bytes.length;
    return bufferViews.length - 1;
  };
  const addAccessor = (acc: object) => accessors.push(acc) - 1;

  const gltfMaterials: object[] = [];
  const textures: object[] = [];
  const gltfImages: object[] = [];
  const samplers: object[] = [];
  const imageIndex = new Map<string, number>();
  const samplerIndex = new Map<string, number>();

  for (const m of model.materials) {
    const opensinnoh = openSinnohMaterial(m);
    if (m.projectionMap) Object.assign(opensinnoh, { projectionMap: true });
    if (m.flag & 1 && !opts.textureMatrices) warnings.add(`texture matrix ignored (material ${m.name})`);
    if ((m.texParam >>> 30) !== 0 && !m.projectionMap && !(opts.textureMatrices && (m.texParam >>> 30) === 1)) warnings.add(`texcoord generation mode ${m.texParam >>> 30} ignored (material ${m.name})`);
    if (((m.polyAttr >> 4) & 3) !== 0) warnings.add(`polygon mode ${(m.polyAttr >> 4) & 3} drawn as modulate (material ${m.name})`);
    const pbr: Record<string, unknown> = { metallicFactor: 0, roughnessFactor: 1, baseColorFactor: [1, 1, 1, opensinnoh.alpha / 31] };
    const mat: Record<string, unknown> = { name: m.name, pbrMetallicRoughness: pbr, extras: { lantern: opensinnoh } };
    if (opensinnoh.cull === 'none') mat.doubleSided = true;
    if (opensinnoh.alpha < 31) mat.alphaMode = 'BLEND';
    if (m.texture) {
      if (!m.palette) throw new Error(`material ${m.name}: texture ${m.texture} without a palette`);
      const info = opts.embed ? findTexture(opts.embed, m.texture) : opts.textureFormat?.(m.texture);
      if (info && (info.format === 'a3i5' || info.format === 'a5i3')) mat.alphaMode = 'BLEND';
      else if (opensinnoh.alpha === 31 && (!info || info.color0Transparent)) {
        mat.alphaMode = 'MASK';
        mat.alphaCutoff = 0.5;
      }
      if (opts.embed) {
        const file = `${m.texture}__${m.palette}.png`;
        let img = imageIndex.get(file);
        if (img === undefined) {
          const tex = findTexture(opts.embed, m.texture);
          const rgba = decodeTexture(opts.embed, tex, tex.format === 'direct' ? null : findPalette(opts.embed, m.palette));
          images.set(file, encodePng(tex.width, tex.height, rgba));
          img = gltfImages.push({ uri: file }) - 1;
          imageIndex.set(file, img);
        }
        const wrapS = WRAP((m.texParam >> 16) & 1, (m.texParam >> 18) & 1);
        const wrapT = WRAP((m.texParam >> 17) & 1, (m.texParam >> 19) & 1);
        const key = `${wrapS},${wrapT}`;
        let s = samplerIndex.get(key);
        if (s === undefined) {
          s = samplers.push({ magFilter: 9728, minFilter: 9728, wrapS, wrapT }) - 1;
          samplerIndex.set(key, s);
        }
        pbr.baseColorTexture = { index: textures.push({ source: img, sampler: s }) - 1 };
      } else {
        // Name binding: the renderer loads <texture>__<palette>.png from the area texture set.
        Object.assign(opensinnoh, { wrapS: WRAP((m.texParam >> 16) & 1, (m.texParam >> 18) & 1), wrapT: WRAP((m.texParam >> 17) & 1, (m.texParam >> 19) & 1) });
      }
    }
    gltfMaterials.push(mat);
  }

  const world = opts.localJointVertices ? [] : worldMatrices(model);
  let vertexCount = 0;
  const primitivesByNode = new Map<number, object[]>();
  const skinned = new Map<number, object[]>();
  for (const draw of model.draws) {
    const material = model.materials[draw.material];
    const shape = model.shapes[draw.shape];
    if (!material || !shape) throw new Error(`model ${model.name}: draw references missing material ${draw.material} or shape ${draw.shape}`);
    const initial: [number, number, number] = material.diffAmb & 0x8000 ? c555(material.diffAmb) : [1, 1, 1];
    const prims = decodeShape(model, shape, initial);
    let verts = prims.flatMap((p) => p.vertices);
    vertexCount += verts.length;
    if (!verts.length) continue;
    // Rigid skinning: vertices after an MTX_RESTORE are in that stack slot's node space. They are moved to
    // the bind pose and bound to that node with weight 1 (glTF skin over all nodes).
    const joints = verts.some((v) => v.matrix !== undefined)
      ? verts.map((v) => {
          if (v.matrix === undefined) return draw.node;
          const node = draw.stack?.[v.matrix];
          if (node === null || node === undefined) throw new Error(`model ${model.name}: shape ${shape.name} restores empty matrix slot ${v.matrix}`);
          return node;
        })
      : null;
    if (joints && !opts.localJointVertices) {
      verts = verts.map((v, i) => {
        const m = world[joints[i]!]!;
        const n = v.normal ? transformDir(m, v.normal) : null;
        return { ...v, position: transformPoint(m, v.position), normal: n ? normalize(n) : null };
      });
    }
    const indices: number[] = [];
    let base = 0;
    for (const p of prims) {
      for (const i of triangulate(p)) indices.push(base + i);
      base += p.vertices.length;
    }
    const n = verts.length;
    const pos = new Float32Array(n * 3);
    const col = new Uint8Array(n * 4);
    const hasNormal = verts.every((v) => v.normal);
    const hasUv = material.texture !== null;
    const nrm = hasNormal ? new Float32Array(n * 3) : null;
    const uv = hasUv ? new Float32Array(n * 2) : null;
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    verts.forEach((v, i) => {
      pos.set(v.position, i * 3);
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k] as number, v.position[k] as number);
        max[k] = Math.max(max[k] as number, v.position[k] as number);
      }
      col.set([Math.round(v.color[0] * 255), Math.round(v.color[1] * 255), Math.round(v.color[2] * 255), 255], i * 4);
      if (nrm) nrm.set(v.normal as [number, number, number], i * 3);
      if (uv) {
        if (material.projectionMap) { uv.set([0, 0], i * 2); return; }
        if (!v.texcoord) throw new Error(`model ${model.name}: textured shape ${shape.name} has a vertex without a texcoord`);
        let u = v.texcoord[0] / material.origWidth, t = v.texcoord[1] / material.origHeight;
        const m = opts.textureMatrices ? material.textureTransform : undefined;
        if (m) {
          const x = u - .5, y = t - .5;
          u = m.scaleS * (m.cos * x - m.sin * y + .5 - m.translateS);
          t = m.scaleT * (m.sin * x + m.cos * y + .5 + m.translateT);
        }
        uv.set([u, t], i * 2);
      }
    });
    const attributes: Record<string, number> = {
      POSITION: addAccessor({ bufferView: addView(new Uint8Array(pos.buffer), 34962), componentType: 5126, count: n, type: 'VEC3', min, max }),
      COLOR_0: addAccessor({ bufferView: addView(col, 34962), componentType: 5121, normalized: true, count: n, type: 'VEC4' }),
    };
    if (nrm) attributes.NORMAL = addAccessor({ bufferView: addView(new Uint8Array(nrm.buffer), 34962), componentType: 5126, count: n, type: 'VEC3' });
    if (uv) attributes.TEXCOORD_0 = addAccessor({ bufferView: addView(new Uint8Array(uv.buffer), 34962), componentType: 5126, count: n, type: 'VEC2' });
    if (joints) {
      const j = new Uint16Array(n * 4);
      const w = new Float32Array(n * 4);
      joints.forEach((node, i) => {
        j[i * 4] = node;
        w[i * 4] = 1;
      });
      attributes.JOINTS_0 = addAccessor({ bufferView: addView(new Uint8Array(j.buffer), 34962), componentType: 5123, count: n, type: 'VEC4' });
      attributes.WEIGHTS_0 = addAccessor({ bufferView: addView(new Uint8Array(w.buffer), 34962), componentType: 5126, count: n, type: 'VEC4' });
    }
    const idx = n > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    const indexAcc = addAccessor({ bufferView: addView(new Uint8Array(idx.buffer), 34963), componentType: n > 65535 ? 5125 : 5123, count: indices.length, type: 'SCALAR' });
    const primitive = { attributes, indices: indexAcc, material: draw.material, mode: 4 };
    if (joints) {
      const list = skinned.get(draw.node) ?? [];
      list.push(primitive); skinned.set(draw.node, list);
    }
    else {
      const list = primitivesByNode.get(draw.node) ?? [];
      list.push(primitive);
      primitivesByNode.set(draw.node, list);
    }
  }

  const meshes: object[] = [];
  const nodes: Record<string, unknown>[] = model.nodes.map((n, i) => {
    const node: Record<string, unknown> = { name: n.name };
    if (opts.animations?.length) Object.assign(node, trsOf(n.matrix));
    else if (!n.identity) node.matrix = n.matrix;
    const prims = primitivesByNode.get(i);
    if (prims) node.mesh = meshes.push({ name: n.name, primitives: prims }) - 1;
    node.extras = { lantern: { visibilityNode: i, ...(n.billboard !== 'none' ? { billboard: n.billboard } : {}) } };
    return node;
  });
  const roots: number[] = [];
  const translations = new Map<number, number>();
  const compensations = new Map<number, number>();
  model.nodes.forEach((n, i) => {
    if (n.parent === null) roots.push(i);
    else {
      const parent = nodes[n.parent] as Record<string, unknown> | undefined;
      if (!parent) throw new Error(`model ${model.name}: node ${n.name} has missing parent ${n.parent}`);
      if (model.scalingRule === 1) {
        const rest = trsOf(n.matrix);
        const parentScale = trsOf(model.nodes[n.parent]!.matrix).scale;
        const inverse = parentScale.map(v => v === 0 ? 0 : 1 / v);
        const cancel = nodes.push({ name: `${n.name}-inverse-parent-scale`, scale: inverse, children: [i] }) - 1;
        const translate = nodes.push({ name: `${n.name}-translation`, translation: rest.translation, children: [cancel] }) - 1;
        translations.set(i, translate);
        compensations.set(i, cancel);
        delete nodes[i]!.matrix;
        Object.assign(nodes[i]!, { translation: [0, 0, 0], rotation: rest.rotation, scale: rest.scale });
        ((parent.children as number[] | undefined) ?? (parent.children = [])).push(translate);
      } else ((parent.children as number[] | undefined) ?? (parent.children = [])).push(i);
    }
  });

  let skins: object[] | undefined;
  if (skinned.size) {
    const inverse = Float32Array.from(opts.localJointVertices ? model.nodes.flatMap(() => [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]) : world.flatMap(invertAffine));
    const inverseBindMatrices = addAccessor({ bufferView: addView(new Uint8Array(inverse.buffer), 0), componentType: 5126, count: model.nodes.length, type: 'MAT4' });
    skins = [{ joints: model.nodes.map((_, i) => i), inverseBindMatrices }];
    for (const [node, primitives] of skinned) {
      const name = skinned.size === 1 ? `${model.name}-skinned` : `${model.name}-skinned-${node}`;
      roots.push(nodes.push({ name, extras: { lantern: { visibilityNode: node } }, mesh: meshes.push({ name, primitives }) - 1, skin: 0 }) - 1);
    }
  }

  const animations = (opts.animations ?? []).map(({ clip, animation }) => {
    const times = Float32Array.from({ length: animation.frames }, (_, i) => i / FRAME_RATE);
    const input = addAccessor({ bufferView: addView(new Uint8Array(times.buffer), 0), componentType: 5126, count: times.length, type: 'SCALAR', min: [0], max: [times[times.length - 1]] });
    const animSamplers: object[] = [];
    const channels: object[] = [];
    for (const track of animation.tracks) {
      const n = model.nodes[track.node];
      if (!n) throw new Error(`model ${model.name}: animation ${animation.name} targets missing node ${track.node}`);
      const rest = trsOf(n.matrix);
      const values: Record<'translation' | 'rotation' | 'scale', number[][]> = {
        translation: track.translation === 'rest' ? Array(animation.frames).fill(rest.translation) : track.translation,
        rotation: track.rotation === 'rest' ? Array(animation.frames).fill(rest.rotation) : track.rotation.map(quaternion),
        scale: track.scale === 'rest' ? Array(animation.frames).fill(rest.scale) : track.scale,
      };
      for (const path of ['translation', 'rotation', 'scale'] as const) {
        const flat = Float32Array.from(values[path].flat());
        const output = addAccessor({ bufferView: addView(new Uint8Array(flat.buffer), 0), componentType: 5126, count: animation.frames, type: path === 'rotation' ? 'VEC4' : 'VEC3' });
        channels.push({ sampler: animSamplers.push({ input, output, interpolation: 'LINEAR' }) - 1, target: { node: path === 'translation' ? (translations.get(track.node) ?? track.node) : track.node, path } });
      }
    }
    for (const [child, cancel] of compensations) {
      const parent = model.nodes[child]!.parent!;
      const track = animation.tracks.find(t => t.node === parent);
      const rest = trsOf(model.nodes[parent]!.matrix).scale;
      const scales = track && track.scale !== 'rest' ? track.scale : Array.from({ length: animation.frames }, () => rest);
      const flat = Float32Array.from(scales.flatMap(v => v.map(x => x === 0 ? 0 : 1 / x)));
      const output = addAccessor({ bufferView: addView(new Uint8Array(flat.buffer), 0), componentType: 5126, count: animation.frames, type: 'VEC3' });
      channels.push({ sampler: animSamplers.push({ input, output, interpolation: 'LINEAR' }) - 1, target: { node: cancel, path: 'scale' } });
    }
    return { name: clip, samplers: animSamplers, channels };
  });

  const data = new Uint8Array(binLength);
  let o = 0;
  for (const b of bin) {
    data.set(b, o);
    o += b.length;
  }
  const gltf: Record<string, unknown> = {
    asset: { version: '2.0', generator: 'lantern-nds g3d' },
    scene: 0,
    scenes: [{ name: model.name, nodes: roots }],
    nodes,
    meshes,
    materials: gltfMaterials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: data.length, uri: `data:application/octet-stream;base64,${base64(data)}` }],
  };
  if (textures.length) Object.assign(gltf, { textures, images: gltfImages, samplers });
  if (animations.length) gltf.animations = animations;
  if (skins) gltf.skins = skins;
  return { gltf, images, warnings: [...warnings], vertexCount };
}

/** Rest-pose model-space matrix of every node (column-major 4×4). */
function worldMatrices(model: Model): number[][] {
  const out: (number[] | undefined)[] = [];
  const at = (i: number): number[] => {
    const done = out[i];
    if (done) return done;
    const n = model.nodes[i]!;
    let local = n.matrix;
    if (model.scalingRule === 1 && n.parent !== null) {
      const scale = trsOf(model.nodes[n.parent]!.matrix).scale;
      local = [...local];
      for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) local[c * 4 + r]! /= scale[r]!;
    }
    const m = n.parent === null ? local : mul4(at(n.parent), local);
    out[i] = m;
    return m;
  };
  return model.nodes.map((_, i) => at(i));
}

function mul4(a: number[], b: number[]): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

const transformPoint = (m: number[], p: readonly number[]): [number, number, number] => [0, 1, 2].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]! + m[12 + r]!) as [number, number, number];
const transformDir = (m: number[], p: readonly number[]): [number, number, number] => [0, 1, 2].map((r) => m[r]! * p[0]! + m[4 + r]! * p[1]! + m[8 + r]! * p[2]!) as [number, number, number];
const normalize = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(...v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Inverse of an affine column-major 4×4 (3×3 inverse by cofactors, then the translation). */
function invertAffine(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = [m[0]!, m[4]!, m[8]!, m[1]!, m[5]!, m[9]!, m[2]!, m[6]!, m[10]!];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('g3d: singular node matrix');
  // Row-major inverse rows.
  const inv = [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det, (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det, (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det];
  const t = [m[12]!, m[13]!, m[14]!];
  const it = [0, 1, 2].map((r) => -(inv[r * 3]! * t[0]! + inv[r * 3 + 1]! * t[1]! + inv[r * 3 + 2]! * t[2]!));
  return [inv[0]!, inv[3]!, inv[6]!, 0, inv[1]!, inv[4]!, inv[7]!, 0, inv[2]!, inv[5]!, inv[8]!, 0, it[0]!, it[1]!, it[2]!, 1];
}

/** DS animation frames per second (one frame per 30 Hz field tick). */
const FRAME_RATE = 30;

/** Column-major 4×4 → glTF TRS (a negative determinant flips the x scale). */
export function trsOf(m: number[]): { translation: Vec3; rotation: number[]; scale: Vec3 } {
  const col = (c: number): Vec3 => [m[c * 4]!, m[c * 4 + 1]!, m[c * 4 + 2]!];
  const cols = [col(0), col(1), col(2)];
  const scale = cols.map((c) => Math.hypot(...c)) as Vec3;
  const [a, b, c] = cols as [Vec3, Vec3, Vec3];
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  if (det < 0) scale[0] = -scale[0];
  const rot = cols.flatMap((v, k) => v.map((x, row) => scale[k] === 0 ? (row === k ? 1 : 0) : x / scale[k]!));
  return { translation: [m[12]!, m[13]!, m[14]!], rotation: quaternion(rot), scale };
}

/** Column-major 3×3 rotation → unit quaternion [x, y, z, w]. */
export function quaternion(r: number[]): number[] {
  const at = (row: number, c: number) => r[c * 3 + row]!;
  const [m00, m11, m22] = [at(0, 0), at(1, 1), at(2, 2)];
  const tr = m00 + m11 + m22;
  let q: number[];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(at(2, 1) - at(1, 2)) / s, (at(0, 2) - at(2, 0)) / s, (at(1, 0) - at(0, 1)) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (at(0, 1) + at(1, 0)) / s, (at(0, 2) + at(2, 0)) / s, (at(2, 1) - at(1, 2)) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(at(0, 1) + at(1, 0)) / s, s / 4, (at(1, 2) + at(2, 1)) / s, (at(0, 2) - at(2, 0)) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(at(0, 2) + at(2, 0)) / s, (at(1, 2) + at(2, 1)) / s, s / 4, (at(1, 0) - at(0, 1)) / s];
  }
  const len = Math.hypot(...q);
  return q.map((x) => x / len);
}

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
