/**
 * Title screen composition (pure, unit-tested): one full-bleed scene. The 3D (background scene and
 * model) fills the view at a DS-like resolution; the model is raised so the wordmark, placed in the
 * lower third by title.css, covers its lower body (landscape) or sits under it, over the portal ring
 * (portrait). The 3D scale is snapped so scale × devicePixelRatio is whole (crisp pixels).
 */
export interface TitleLayout {
  /** CSS px per 3D pixel (the 3D draws at about DS resolution). */
  k3d: number;
  /** Share of the frame height the model's picture is raised, and its FOV factor (the DS frames it for a 4:3 screen of its own). */
  lift: number;
  zoom: number;
  landscape: boolean;
}

const snap = (v: number, dpr: number) => Math.max(1, Math.floor(v * dpr)) / dpr;

export function titleLayout(width: number, height: number, dpr: number): TitleLayout {
  const landscape = width >= height;
  // About 220 3D pixels on the short side: the DS's own resolution, so the model reads as pixel art.
  return { k3d: snap(Math.min(width, height) / 220, dpr), lift: landscape ? 0.14 : 0.12, zoom: landscape ? 1.3 : 1, landscape };
}

/**
 * The wordmark's whole scale over the scene (58 × 11 glyph px at ×1, clear space of 2 glyph px all round): as large
 * as fits the width less the 16-px gutters and about a sixth of the height, from ×2 to ×8.
 */
export function wordmarkScale(width: number, height: number): number {
  return Math.max(2, Math.min(8, Math.floor((width - 32) / 62), Math.floor((height * 0.16) / 15)));
}
