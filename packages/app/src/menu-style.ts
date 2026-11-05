/**
 * The menu style (Original, Modern): an app setting of this device (localStorage), not a DS option and not in the save.
 * Presentation only: Modern draws the same app views in OpenSinnoh's own style (ui/modern.ts). The default is Original,
 * and replays never read it (ui/index.ts keeps the original drawing there).
 */
export const MENU_STYLE_KEY = 'lantern-nds:menu-style'; // the stored names keep the pre-rename prefix

export const MENU_STYLES = ['original', 'modern'] as const;
export type MenuStyle = (typeof MENU_STYLES)[number];

/** The value for this visit: storage can refuse a write (private mode), and the choice still applies. */
let current: MenuStyle | null = null;

function stored(): string | null {
  try {
    return localStorage.getItem(MENU_STYLE_KEY);
  } catch {
    return null; // Blocked storage.
  }
}

/** The choice; missing, unknown or unreadable is Original. */
export function readMenuStyle(): MenuStyle {
  current ??= stored() === 'modern' ? 'modern' : 'original';
  return current;
}

/** Whether this device has chosen a style (the setup asks only until then). */
export function menuStyleChosen(): boolean {
  return stored() !== null;
}

/** Stores the choice; returns the error message when storage refuses. */
export function storeMenuStyle(style: MenuStyle): string | null {
  current = style;
  try {
    localStorage.setItem(MENU_STYLE_KEY, style);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
