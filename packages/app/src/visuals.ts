/**
 * The visual style (DS, Subtle, Cinematic) and the angled camera: app settings of this device (localStorage), not DS
 * options and not in the save. Presentation only: the renderer's enhanced visuals (packages/render/src/enhanced). The
 * default is the DS look; replays never read these (game-view.ts keeps the DS look there).
 */
export const VISUAL_STYLE_KEY = 'lantern-nds:visual-style'; // the stored names keep the pre-rename prefix
export const ANGLED_CAMERA_KEY = 'lantern-nds:angled-camera';

export const VISUAL_STYLES = ['ds', 'subtle', 'cinematic'] as const;
export type VisualStyle = (typeof VISUAL_STYLES)[number];

export interface Visuals {
  style: VisualStyle;
  angledCamera: boolean;
}

export const DEFAULT_VISUALS: Readonly<Visuals> = { style: 'ds', angledCamera: false };

/** The stored choice; missing, unknown or unreadable is the DS look. */
export function readVisuals(): Visuals {
  try {
    const style = localStorage.getItem(VISUAL_STYLE_KEY);
    return { style: (VISUAL_STYLES as readonly string[]).includes(style ?? '') ? (style as VisualStyle) : 'ds', angledCamera: localStorage.getItem(ANGLED_CAMERA_KEY) === 'on' };
  } catch {
    return { ...DEFAULT_VISUALS }; // Blocked storage.
  }
}

/** Whether this device has chosen a style (the setup asks only until then). */
export function visualStyleChosen(): boolean {
  try {
    return localStorage.getItem(VISUAL_STYLE_KEY) !== null;
  } catch {
    return false;
  }
}

/** Stores the choice; returns the error message when storage refuses (private mode). */
export function storeVisuals(v: Visuals): string | null {
  try {
    localStorage.setItem(VISUAL_STYLE_KEY, v.style);
    localStorage.setItem(ANGLED_CAMERA_KEY, v.angledCamera ? 'on' : 'off');
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
