/**
 * DS per-vertex lighting (GBATEK "DS 3D Polygon Light Parameters"), evaluated once when a chunk is built.
 * Lit polygons get their vertex colour from the lights; the texture then modulates it, all in display
 * values (the DS has no gamma), so the renderer draws with no colour-space conversion.
 *
 *   colour = emission + Σ_i light_i × (specular × shininess_i + diffuse × max(0, −L_i·N) + ambient)
 *   shininess_i = max(0, −H_i·N)², H_i = (L_i + (0, 0, −1)) / 2   (view space, H not normalised)
 *
 * The field camera only translates, so view-space lights are fixed in the world for a camera preset.
 */

export type Rgb = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

/**
 * One area light template (contracts `Light`, read from the zone's area): up to 4 lights (null = off) and
 * the global material colours (0..1). Platinum makes outdoor land models and billboards use these, not their own.
 */
export interface LightTemplate {
  lights: readonly ({ color: Rgb; direction: Vec3 } | null)[];
  diffuse: Rgb;
  ambient: Rgb;
  specular: Rgb;
  emission: Rgb;
}

/** Vertex colour for a view-space normal under the lights enabled in `mask` (POLYGON_ATTR bits 0–3). */
export function dsVertexLight(n: Vec3, mask: number, t: LightTemplate, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  let r = t.emission[0];
  let g = t.emission[1];
  let b = t.emission[2];
  for (let i = 0; i < t.lights.length; i++) {
    const light = t.lights[i];
    if (!light || !(mask & (1 << i))) continue;
    const [lx, ly, lz] = light.direction;
    const diffuse = Math.max(0, -(lx * n[0] + ly * n[1] + lz * n[2]));
    const half = Math.max(0, -((lx * n[0] + ly * n[1] + (lz - 1) * n[2]) / 2));
    const shine = half * half;
    const k = light.color;
    r += k[0] * (t.specular[0] * shine + t.diffuse[0] * diffuse + t.ambient[0]);
    g += k[1] * (t.specular[1] * shine + t.diffuse[1] * diffuse + t.ambient[1]);
    b += k[2] * (t.specular[2] * shine + t.diffuse[2] * diffuse + t.ambient[2]);
  }
  out[0] = Math.min(1, r);
  out[1] = Math.min(1, g);
  out[2] = Math.min(1, b);
  return out;
}

/**
 * Colour of an overworld billboard under an area light template. Map objects (the player, NPCs, item
 * balls) and the billboard field effects (tall grass, ripples, dust, smoke, reflections) are drawn with
 * models that use the global material colours (AreaLight_UseGlobalModelAttributes in ov5_021EDDDC and
 * ov5_021DF7F8), so they take the template's diffuse, ambient, specular and emission. Their quad
 * enables light 0 only and has one normal, (0, 0, 511/512), which the full billboard turns to face the
 * camera. The texture then modulates this colour. Billboards whose model enables no light (the '!'
 * over a trainer, fldeff sisen_ef) stay at full brightness.
 */
export const BILLBOARD_NORMAL: Vec3 = [0, 0, 511 / 512];
export function billboardLight(t: LightTemplate): [number, number, number] {
  return dsVertexLight(BILLBOARD_NORMAL, 0b0001, t);
}

/**
 * The area light's template at `seconds` since midnight (decomp AreaLightManager: the first template whose
 * end is later, else the first) and its index in the schedule (-1: no schedule, the one template).
 */
export function lightAt(light: LightTemplate & { schedule?: readonly (LightTemplate & { until: number })[] }, seconds: number): { template: LightTemplate; index: number } {
  if (!light.schedule) return { template: light, index: -1 };
  const index = Math.max(0, light.schedule.findIndex((t) => t.until > seconds));
  return { template: light.schedule[index]!, index };
}

/**
 * Object shadow alpha (of 31) and x/z scale per time of day, in decomp TIMEOFDAY order (ov5_021F134C.c
 * Unk_ov5_02200284, Unk_ov5_022002E4). The shadow eases toward its period's look: alpha 1/8 and scale
 * 1/256 per tick.
 */
export const SHADOW_BY_PERIOD = {
  morning: { alpha: 14, x: 1, z: 1 },
  day: { alpha: 18, x: 1.25, z: 1.25 },
  twilight: { alpha: 18, x: 1.25, z: 1 },
  night: { alpha: 8, x: 1.125, z: 1 },
  lateNight: { alpha: 4, x: 0.875, z: 0.875 },
} as const;
export const SHADOW_ALPHA_STEP = 1 / 8;
export const SHADOW_SCALE_STEP = 1 / 256;
