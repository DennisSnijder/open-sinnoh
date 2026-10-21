/**
 * Field zoom: the player picks the field's scale (CSS px per DS px), or Auto (the DS view just fits, the
 * default). An app setting of this device (localStorage), not a DS option and not in the save. Zoom only
 * changes how much of the field is visible around the DS view: the camera's target, its DS framing and
 * everything the game decides stay the same. Menus, the battle and the boxes keep their own scales.
 *
 * Fixed scales are whole numbers from `minZoom` (the view at most `VIEW_LIMIT` DS views wide and high: a
 * taller view reaches the DS camera's far plane at its top edge, a wider one past the objects the world
 * shows around the player; docs/decisions.md "Field zoom") to `maxZoom` (the largest that still shows
 * the whole 256×192 DS view). A stored scale
 * outside that range for the current window is clamped when applied, and kept.
 */
export type Zoom = 'auto' | number;

export const ZOOM_KEY = 'lantern-nds:zoom'; // pre-rename name, kept: players' stored data uses it
/** The largest view, in DS views per axis (896×480 DS px). */
export const VIEW_LIMIT = { width: 3.5, height: 2.5 } as const;
const DS_WIDTH = 256;
const DS_HEIGHT = 192;

/** Auto: the DS view just fits (wide screens keep its height, narrow ones its width). */
export function autoScale(width: number, height: number): number {
  return Math.min(width / DS_WIDTH, height / DS_HEIGHT);
}

/** The largest whole scale that still shows the whole DS view (at least 1). */
export function maxZoom(width: number, height: number): number {
  return Math.max(1, Math.floor(autoScale(width, height)));
}

/** The smallest whole scale whose view stays within `VIEW_LIMIT` (never above `maxZoom`). */
export function minZoom(width: number, height: number): number {
  const fit = Math.max(1, Math.ceil(Math.max(width / (DS_WIDTH * VIEW_LIMIT.width), height / (DS_HEIGHT * VIEW_LIMIT.height))));
  return Math.min(fit, maxZoom(width, height));
}

/** The field's scale for a zoom setting in a `width × height` CSS px view. */
export function fieldScale(zoom: Zoom, width: number, height: number): number {
  if (zoom === 'auto') return autoScale(width, height);
  return Math.min(maxZoom(width, height), Math.max(minZoom(width, height), zoom));
}

/** One step in (+1) or out (−1) from what is shown now; Auto steps from its fitted scale. */
export function stepZoom(zoom: Zoom, dir: 1 | -1, width: number, height: number): number {
  const now = fieldScale(zoom, width, height);
  const next = dir > 0 ? Math.floor(now) + 1 : Math.ceil(now) - 1;
  return Math.min(maxZoom(width, height), Math.max(minZoom(width, height), next));
}

/** The choices for the window: Auto, then every whole scale from `minZoom` to `maxZoom`. */
export function zoomChoices(width: number, height: number): Zoom[] {
  const out: Zoom[] = ['auto'];
  for (let s = minZoom(width, height); s <= maxZoom(width, height); s++) out.push(s);
  return out;
}

export const zoomLabel = (zoom: Zoom): string => (zoom === 'auto' ? 'Auto' : `${zoom}x`);

/** A stored zoom, validated (device data): missing or unreadable is Auto. */
export function parseZoom(raw: string | null): Zoom {
  try {
    const v = JSON.parse(raw ?? '"auto"') as unknown;
    if (v === 'auto' || (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 64)) return v as Zoom;
  } catch {
    // Not JSON: Auto.
  }
  return 'auto';
}

export function readZoom(): Zoom {
  try {
    return parseZoom(localStorage.getItem(ZOOM_KEY));
  } catch {
    return 'auto'; // Blocked storage.
  }
}

/** Stores the zoom; returns the error message when storage refuses (private mode). */
export function storeZoom(zoom: Zoom): string | null {
  try {
    localStorage.setItem(ZOOM_KEY, JSON.stringify(zoom));
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Wheel deltas to zoom steps: a mouse notch (about 100 px, or 3 lines) is one step; a trackpad pinch
 * sends many small deltas, summed until they make one. Negative wheel deltas (wheel up, pinch out) zoom in.
 */
export class WheelSteps {
  private sum = 0;
  constructor(private readonly perStep = 50) {}
  add(deltaY: number, deltaMode: number): -1 | 0 | 1 {
    this.sum += deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
    if (Math.abs(this.sum) < this.perStep) return 0;
    const dir = this.sum < 0 ? 1 : -1;
    this.sum = 0;
    return dir;
  }
}
