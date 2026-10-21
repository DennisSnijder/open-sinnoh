import * as THREE from 'three';
import { disposeTree } from './assets.ts';
import type { Weather } from '@opensinnoh/contracts';

/**
 * The DS 3D engine's per-pixel passes after rasterising (GBATEK "DS 3D Rear-Plane", "Edge Marking",
 * "Fog"), done as a full-screen pass over a two-target render: colour, and per pixel the polygon ID of its
 * last opaque polygon and its fog flag (`fieldOutputs`), plus depth. The fog flag is the second target's
 * alpha: an opaque polygon writes its own; a translucent one keeps it, except a light (`fogClearing`), which
 * clears it like a DS translucent polygon without fog (GBATEK "DS 3D Fog": the flag is ANDed).
 *
 * - Edge marking: a pixel whose polygon ID differs from a neighbour's, and which is in front of that
 *   neighbour, takes the edge colour `edgeColors[id >> 3]` (Platinum field: area_data.c tables). The
 *   neighbour distance is one DS pixel at the current scale, so the line is one DS pixel wide on the
 *   near polygon. The field also has anti-aliasing on (Easy3D_SetupEngine: G3X_AntiAlias(TRUE)), which
 *   draws edge-marked pixels translucent (GBATEK "Anti-Aliasing": "alpha=16 or so"; melonDS sets their
 *   coverage to 0x10): the edge colour is blended 17/32 over the pixel below it, the far polygon
 *   (`edgePixel`). Against the rear plane (alpha 0) it is not blended.
 * - Fog: on pixels whose polygon has the fog flag, the 15-bit depth (the DS's Z-buffer depth: window
 *   depth × 0x7FFF, which matches because the camera uses the DS projection) indexes the 32-entry
 *   density table from `offset` in steps of 0x400 >> slope, interpolated linearly; colour = mix(pixel,
 *   fog colour, density / 128), with 127 counted as 128.
 */

/** Fog density 0..128 at a 15-bit depth (the shader's formula; exported for tests). */
export function fogDensity(depth: number, fog: NonNullable<Weather['fog']>): number {
  const step = 0x400 >> fog.slope;
  const t = (depth - fog.offset) / step;
  const d = fog.densities;
  let v: number;
  if (t <= 0) v = d[0]!;
  else if (t >= 31) v = d[31]!;
  else {
    const i = Math.floor(t);
    v = d[i]! + (d[i + 1]! - d[i]!) * (t - i);
  }
  return v >= 127 ? 128 : v;
}

/** Coverage the DS anti-aliasing gives an edge-marked pixel, +1 as the blend uses it (melonDS: 0x10 + 1, of 32). */
export const EDGE_COVERAGE = 17;

/**
 * An edge-marked pixel's colour (0..1 RGB, after fog): the edge colour blended over the pixel below at
 * `EDGE_COVERAGE`/32, or the edge colour alone against the rear plane (null: alpha 0, not blended).
 * The shader's formula; exported for tests.
 */
export function edgePixel(edge: readonly number[], below: readonly number[] | null): [number, number, number] {
  const c = (i: number) => (below ? (edge[i]! * EDGE_COVERAGE + below[i]! * (32 - EDGE_COVERAGE)) / 32 : edge[i]!);
  return [c(0), c(1), c(2)];
}

/** A DS RGB555 component (0..31) as the screen shows it, 0..1 (the 5→8-bit expansion textures use: c<<3 | c>>2). */
export const rgb5 = (c: number) => ((c << 3) | (c >> 2)) / 255;

/** Per-material outputs the composite reads: polygon ID (0–63) and the fog flag. */
export interface FieldOutput {
  polygonId: number;
  fog: boolean;
  /**
   * Which pixels of a texture with per-texel alpha (DS a3i5/a5i3) the material draws (`dsPixelAlpha`):
   * `opaque` its alpha-31 texels, `blend` the others. Absent: the material's own alpha test.
   */
  texels?: 'opaque' | 'blend';
}

/**
 * DS pixel alpha (GBATEK "DS 3D Texture Blending", "DS 3D Alpha Blending"): texel and polygon alpha (5 bits) combine
 * as ((texel + 1) × (polygon + 1) − 1) / 32. Alpha 0 is not drawn; alpha 31 is an opaque pixel; alpha 1..30 blends
 * as (new × (alpha + 1) + old × (31 − alpha)) / 32, so the blend factor is (alpha + 1) / 32. `opaque` keeps the
 * alpha-31 pixels, `blend` the alpha 1..30 ones. Exported for tests.
 */
export function dsPixelAlpha(texel: number, polygon: number): number {
  return Math.floor(((texel + 1) * (polygon + 1) - 1) / 32);
}

const TEXEL_ALPHA = {
  opaque: `
  if (diffuseColor.a < opacity * (254.5 / 255.0)) discard;`,
  blend: `
  float dsPolygonAlpha = floor(opacity * 31.0 + 0.5);
  float dsTexelAlpha = opacity > 0.0 ? floor(diffuseColor.a / opacity * 31.0 + 0.5) : 0.0;
  float dsAlpha = floor(((dsTexelAlpha + 1.0) * (dsPolygonAlpha + 1.0) - 1.0) / 32.0);
  if (dsAlpha < 0.5 || dsAlpha > 30.5) discard;
  diffuseColor.a = (dsAlpha + 1.0) / 32.0;`,
};

/**
 * Makes a scene material also write its polygon ID (red) and fog flag (alpha) to the second render target.
 * Translucent materials write alpha 0 there, so with blending the pixel keeps the ID and fog flag of
 * the opaque polygon under it (the DS keeps them for translucent pixels too).
 */
export function fieldOutputs<M extends THREE.Material>(material: M, out: FieldOutput): M {
  // Kept in userData so a clone (which drops onBeforeCompile) can be given the same outputs.
  material.userData.fieldOutput = out;
  const before = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uFieldId = { value: new THREE.Vector4(out.polygonId / 63, 0, 0, material.transparent || !out.fog ? 0 : 1) };
    if (out.texels) {
      if (!shader.fragmentShader.includes('#include <alphatest_fragment>')) throw new Error(`render: material ${material.name} has no alpha test to draw texel alpha in`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>${TEXEL_ALPHA[out.texels]}`);
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'layout(location = 1) out highp vec4 pc_fragField;\nuniform vec4 uFieldId;\nvoid main() {')
      .replace(/}\s*$/, '\tpc_fragField = uFieldId;\n}\n');
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${key()}|field${out.texels ? `|${out.texels}` : ''}`;
  return material;
}

/**
 * A translucent material without fog that clears the fog flag of the pixels it draws (a texel the alpha test
 * keeps): colour blends by the texel's alpha; on the second target its alpha 0 keeps the polygon ID and the
 * alpha factor ZERO clears the flag. Hearthome Gym's light beams: the floor under them is drawn unfogged.
 */
export function fogClearing<M extends THREE.Material>(material: M): M {
  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.ZeroFactor;
  return material;
}

/**
 * The DS's polygon ID rule for translucent pixels (GBATEK "DS 3D Polygon Attributes", polygon ID): a translucent
 * pixel is not drawn over a translucent pixel of the same polygon ID, so overlapping translucent polygons of one ID
 * blend once. The stencil holds ID + 1 of the last translucent pixel drawn (0: none, cleared each frame; opaque
 * pixels are all drawn before translucent ones).
 */
export function translucentId<M extends THREE.Material>(material: M, polygonId: number): M {
  material.stencilWrite = true;
  material.stencilRef = polygonId + 1;
  material.stencilFunc = THREE.NotEqualStencilFunc;
  material.stencilFuncMask = 0xff;
  material.stencilWriteMask = 0xff;
  material.stencilFail = THREE.KeepStencilOp;
  material.stencilZFail = THREE.KeepStencilOp;
  material.stencilZPass = THREE.ReplaceStencilOp;
  return material;
}

const VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAGMENT = /* glsl */ `
precision highp float;
in vec2 vUv;
layout(location = 0) out highp vec4 outColor;
uniform sampler2D tColor;
uniform sampler2D tField;
uniform sampler2D tDepth;
uniform vec2 uStep;
uniform bool uEdges;
uniform bool uShowIds;
uniform vec3 uEdgeColors[8];
uniform bool uFog;
uniform float uFogOffset;
uniform float uFogStep;
uniform float uDensity[32];
uniform vec3 uFogColor;
uniform bool uRearTransparent;
uniform float uFogAlpha;

int fieldId(vec4 field) { return int(field.r * 63.0 + 0.5); }

float fogAmount(vec4 field, float depth) {
  if (!uFog || field.a < 0.5) return 0.0;
  float t = (depth * 32767.0 - uFogOffset) / uFogStep;
  float d;
  if (t <= 0.0) d = uDensity[0];
  else if (t >= 31.0) d = uDensity[31];
  else {
    int i = int(floor(t));
    d = mix(uDensity[i], uDensity[i + 1], t - float(i));
  }
  if (d >= 127.0) d = 128.0;
  return d / 128.0;
}

vec3 fogged(vec3 color, vec4 field, float depth) {
  return mix(color, uFogColor, fogAmount(field, depth));
}

void main() {
  vec4 field = texture(tField, vUv);
  float depth = texture(tDepth, vUv).r;
  int id = fieldId(field);
  if (uShowIds) {
    outColor = vec4(field.r, 0.0, 0.0, 1.0);
    return;
  }
  // A layer under the 3D one (the Distortion World's sky) shows through the rear plane, and through the far
  // field where the fog blends alpha too (GX_FOGBLEND_COLOR_ALPHA).
  if (uRearTransparent && depth >= 1.0) discard;
  outColor = vec4(fogged(texture(tColor, vUv).rgb, field, depth), mix(1.0, uFogAlpha / 31.0, fogAmount(field, depth)));
  if (!uEdges) return;
  vec2 offsets[4] = vec2[4](vec2(uStep.x, 0.0), vec2(-uStep.x, 0.0), vec2(0.0, uStep.y), vec2(0.0, -uStep.y));
  for (int i = 0; i < 4; i++) {
    vec2 n = vUv + offsets[i];
    vec4 nField = texture(tField, n);
    float nDepth = texture(tDepth, n).r;
    if (fieldId(nField) == id || nDepth <= depth) continue;
    // Fog runs on both layers before the anti-aliasing blend (melonDS ScanlineFinalPass).
    vec3 edge = fogged(uEdgeColors[id / 8], field, depth);
    // The pixel below the edge is the far polygon, as drawn next to it; the rear plane (cleared depth) is alpha 0.
    if (nDepth >= 1.0) outColor.rgb = edge;
    else outColor.rgb = (edge * ${EDGE_COVERAGE}.0 + fogged(texture(tColor, n).rgb, nField, nDepth) * ${32 - EDGE_COVERAGE}.0) / 32.0;
    break;
  }
}`;

/** Platinum COLOR_DARK_GRAY / COLOR_BLACK (constants/colors.h: RGB(4, 4, 4) = 0x1084 / 0). */
const DARK_GRAY = new THREE.Color(rgb5(4), rgb5(4), rgb5(4));
const BLACK = new THREE.Color(0, 0, 0);
/** area_data.c sOutdoorsEdgeMarkings / sIndoorsEdgeMarkings (indoors: ID 0–7 black). */
export const EDGE_COLORS = { outdoors: Array.from({ length: 8 }, () => DARK_GRAY), indoors: [BLACK, ...Array.from({ length: 7 }, () => DARK_GRAY)] };

export class Composite {
  readonly target: THREE.WebGLRenderTarget;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    // Stencil: the polygon ID of the last translucent pixel (`translucentId`).
    const depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedInt248Type);
    depthTexture.format = THREE.DepthStencilFormat;
    this.target = new THREE.WebGLRenderTarget(1, 1, { count: 2, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: true, depthTexture });
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.target.textures[0] },
        tField: { value: this.target.textures[1] },
        tDepth: { value: this.target.depthTexture },
        uStep: { value: new THREE.Vector2() },
        uEdges: { value: true },
        uShowIds: { value: false },
        uEdgeColors: { value: EDGE_COLORS.outdoors },
        uFog: { value: false },
        uFogOffset: { value: 0 },
        uFogStep: { value: 1 },
        uDensity: { value: new Array<number>(32).fill(0) },
        uFogColor: { value: new THREE.Color() },
        uRearTransparent: { value: false },
        uFogAlpha: { value: 31 },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  setSize(width: number, height: number, dsPixel: number): void {
    this.target.setSize(width, height);
    const k = Math.max(1, Math.round(dsPixel));
    (this.material.uniforms.uStep!.value as THREE.Vector2).set(k / width, k / height);
  }

  /**
   * Fog of the drawn weather (null = off) and the area's edge table. `debug` (test switches): `edges`
   * false leaves edge marking out; `ids` draws the polygon ID buffer instead (red = ID / 63).
   */
  configure(fog: Weather['fog'] | null, indoors: boolean, debug: { edges: boolean; ids: boolean } = { edges: true, ids: false }, under = false): void {
    const u = this.material.uniforms;
    // `under`: a layer is drawn under the field (the Distortion World's sky): the rear plane is clear and the
    // fog's alpha (GX_FOGBLEND_COLOR_ALPHA) fades the far field into it.
    u.uRearTransparent!.value = under;
    u.uFogAlpha!.value = under && fog ? fog.alpha : 31;
    this.material.transparent = under;
    u.uEdges!.value = debug.edges;
    u.uShowIds!.value = debug.ids;
    u.uEdgeColors!.value = indoors ? EDGE_COLORS.indoors : EDGE_COLORS.outdoors;
    u.uFog!.value = !!fog;
    if (!fog) return;
    u.uFogOffset!.value = fog.offset;
    u.uFogStep!.value = 0x400 >> fog.slope;
    u.uDensity!.value = fog.densities;
    (u.uFogColor!.value as THREE.Color).setRGB(...fog.color);
  }

  /**
   * Clears the field target: colour black, and the rear plane's polygon ID 63 with no fog (the
   * field's G3X_SetClearColor(black, 0, max depth, 63, FALSE)), so polygons get edges against it.
   */
  clear(renderer: THREE.WebGLRenderer): void {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    const gl = renderer.getContext() as WebGL2RenderingContext;
    gl.clearBufferfv(gl.COLOR, 1, [1, 0, 0, 0]);
  }

  /** Draws the composited field to the current render target (the screen). */
  draw(renderer: THREE.WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target.dispose();
    disposeTree(this.scene);
  }
}
