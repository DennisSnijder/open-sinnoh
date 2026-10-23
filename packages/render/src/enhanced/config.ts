/**
 * Enhanced visuals (opt-in, off by default): effects the DS never drew. The default draws the DS look with no extra
 * cost; the pipeline (pipeline.ts) is a lazy chunk loaded only once a config turns something on. The app sets one
 * from the Options' VISUAL STYLE and ANGLED CAMERA (`visualStyleConfig`); replays and tests never do.
 *
 * Dev and test builds also take a preset (`subtle`, `cinematic`) or a list of switches through `parseEnhanced`:
 * `camera` (angled), `follow` (angled with lag and lookahead), `dof`, `particles`, `bloom`, `grade`, `ao`, `lamps`, `sun`.
 */
import type { Zone } from '@opensinnoh/contracts';

export interface EnhancedConfig {
  /** `angled`: lower pitch, wider FOV. `follow`: the same with a lagging, looking-ahead target. */
  camera: 'off' | 'angled' | 'follow';
  /** Tilt-shift depth of field: the far and near parts of the frame blur, the player's band stays sharp. */
  dof: boolean;
  /** Ambient particles by map type and time of day (pollen and leaves, fireflies, dust). */
  particles: boolean;
  /** Bloom on bright pixels (lit windows, lamps, water glints), stronger at night. */
  bloom: boolean;
  /** Colour grading by the hour: warm mornings and evenings, cool nights, a vignette. */
  grade: boolean;
  /** Ambient occlusion from the depth buffer (contact darkening in corners and under props). */
  ao: boolean;
  /** Night glows on lamp props and lit windows. */
  lamps: boolean;
  /** Golden-hour light shafts, a lens flare, a stronger sunset tint and long character shadows. */
  sun: boolean;
  /** A phone (coarse pointer): the bloom runs at a quarter of the pixels. */
  lowPower: boolean;
}

export const ENHANCED_OFF: EnhancedConfig = { camera: 'off', dof: false, particles: false, bloom: false, grade: false, ao: false, lamps: false, sun: false, lowPower: false };

/** The Options' visual styles past the DS look (the camera is its own switch). */
export const ENHANCED_PRESETS = {
  /** Phone-friendly: no full-resolution blur passes. */
  subtle: { camera: 'off', dof: false, particles: true, bloom: true, grade: true, ao: false, lamps: true, sun: false, lowPower: false },
  cinematic: { camera: 'off', dof: true, particles: true, bloom: true, grade: true, ao: true, lamps: true, sun: true, lowPower: false },
} as const satisfies Record<string, EnhancedConfig>;

export type VisualStyle = 'ds' | keyof typeof ENHANCED_PRESETS;
export const VISUAL_STYLES: readonly VisualStyle[] = ['ds', 'subtle', 'cinematic'];

/** The config for the Options' visual style and angled camera (the follow camera); null is the DS look. */
export function visualStyleConfig(style: VisualStyle, angledCamera: boolean, lowPower: boolean): EnhancedConfig | null {
  const base: EnhancedConfig = style === 'ds' ? { ...ENHANCED_OFF } : { ...ENHANCED_PRESETS[style] };
  const config: EnhancedConfig = { ...base, camera: angledCamera ? 'follow' : 'off', lowPower };
  return enhancedActive(config) ? config : null;
}

const SWITCHES = ['dof', 'particles', 'bloom', 'grade', 'ao', 'lamps', 'sun'] as const;

/** A preset or switch list (see above); null for none or an empty list. Throws on an unknown switch. */
export function parseEnhanced(value: string | null): EnhancedConfig | null {
  if (!value) return null;
  if (value in ENHANCED_PRESETS) return { ...ENHANCED_PRESETS[value as keyof typeof ENHANCED_PRESETS] };
  const out: EnhancedConfig = { ...ENHANCED_OFF };
  for (const s of value.split(',').filter(Boolean)) {
    if (s === 'camera') out.camera = 'angled';
    else if (s === 'follow') out.camera = 'follow';
    else if ((SWITCHES as readonly string[]).includes(s)) out[s as (typeof SWITCHES)[number]] = true;
    else throw new Error(`enhanced visuals: unknown switch "${s}"`);
  }
  return enhancedActive(out) ? out : null;
}

export function enhancedActive(c: EnhancedConfig | null): c is EnhancedConfig {
  return !!c && (c.camera !== 'off' || SWITCHES.some((s) => c[s]));
}

/** Whether a config needs the post chain (an intermediate buffer and full-screen passes). */
export function needsPost(c: EnhancedConfig): boolean {
  return c.dof || c.bloom || c.grade || c.ao || c.sun || c.particles || c.lamps;
}

let current: EnhancedConfig | null = null;

/**
 * The enhanced config every field renderer draws with (module state: a load or reset mounts a new renderer). Null:
 * the DS look.
 */
export function setEnhancedVisuals(config: EnhancedConfig | null): void {
  current = enhancedActive(config) ? { ...config } : null;
}

export function enhancedVisuals(): EnhancedConfig | null {
  return current;
}

/**
 * Where the angled camera may replace the DS camera: outdoor towns, cities and routes without fog. Caves show the void
 * past their rooms and props south of the player cover it; fog's depth table is the DS projection's (until fog reads
 * linear depth); interiors are orthographic anyway.
 */
export function cameraAllowed(zone: Zone, fog: boolean): boolean {
  return (['town', 'city', 'route', 'outdoors'] as Zone['mapType'][]).includes(zone.mapType) && !fog;
}
