/**
 * Starter scene composition (pure, unit-tested). One full-bleed scene: the 3D floor fills the view and
 * the briefcase sits in a DS-sized view (`ds`, the DS's 256×192 picture at `u` CSS px per DS px); the
 * Pokémon pops up on its disc beside the briefcase (landscape) or above it (portrait), with its name and
 * type under it; the message window and the YES window lie at the bottom of the DS view, as on the DS.
 * Scales are snapped so scale × devicePixelRatio is whole (crisp pixels).
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StarterLayout {
  landscape: boolean;
  /** CSS px per DS pixel (3D, cursor, windows, text). */
  u: number;
  /** The DS view in scene CSS px. */
  ds: Rect;
  /** The disc's resting centre (CSS px) and the preview's CSS px per DS pixel. */
  preview: { x: number; y: number; k: number };
  /** Message window interior (CSS px): 2 lines of 16 DS px. */
  message: Rect;
  /** YES window interior (CSS px): one line. */
  yes: Rect;
}

const snap = (v: number, dpr: number) => Math.max(1, Math.floor(v * dpr)) / dpr;

/** DS px: the disc is 96 wide; the name and type sit under it. */
const PREVIEW = { width: 120, height: 136, discY: 52 };
/** The open lid's rim reaches this far above the DS view (DS px; the DS screen cuts it): room is kept for it. */
const LID = 54;
/**
 * The message window: the DS's interior 184×32 at (32, 152) (decomp TEXT_POS 4, 19, 23×4 tiles), raised
 * 6 px so the lid and the window's bottom frame both fit in 234 DS px (720 px at 3× in landscape).
 */
const MESSAGE = { x: 32, y: 146, width: 184, height: 32 };
/** The window's bottom edge (frame 6 px under the interior). */
const BOTTOM = MESSAGE.y + MESSAGE.height + 6;
/** One-line YES window over the message window's right end (frame 6 px around the interior). */
const YES = { width: 32, height: 16, gap: 10 };

export function starterLayout(width: number, height: number, dpr: number): StarterLayout {
  const landscape = width >= height;
  let u: number;
  let ds: Rect;
  let preview: StarterLayout['preview'];
  if (landscape) {
    // Briefcase and preview side by side: 256 + 120 DS px wide.
    u = snap(Math.min(width / (256 + PREVIEW.width + 24), height / (LID + BOTTOM)), dpr);
    const total = (256 + PREVIEW.width) * u;
    ds = { x: Math.round((width - total) / 2), y: Math.round((height - (LID + BOTTOM) * u) / 2 + LID * u), width: 256 * u, height: 192 * u };
    preview = { x: Math.round(ds.x + ds.width + (PREVIEW.width / 2) * u), y: Math.round(ds.y + 60 * u), k: u };
  } else {
    // Preview above the briefcase; the preview gets a larger scale when the width allows.
    u = snap(Math.min(width / 264, height / (BOTTOM + LID + PREVIEW.height + 16)), dpr);
    const k = snap(Math.min(u * 1.5, width / (PREVIEW.width + 8), (height - (BOTTOM + LID) * u) / PREVIEW.height), dpr);
    const total = PREVIEW.height * k + (LID + BOTTOM) * u;
    const top = Math.round(Math.max(8, (height - total) / 2));
    ds = { x: Math.round((width - 256 * u) / 2), y: top + PREVIEW.height * k + LID * u, width: 256 * u, height: 192 * u };
    preview = { x: Math.round(width / 2), y: top + PREVIEW.discY * k, k };
  }
  const message = { x: ds.x + MESSAGE.x * u, y: ds.y + MESSAGE.y * u, width: MESSAGE.width * u, height: MESSAGE.height * u };
  const yes = { x: message.x + message.width - YES.width * u, y: message.y - (YES.gap + YES.height) * u, width: YES.width * u, height: YES.height * u };
  return { landscape, u, ds, preview, message, yes };
}
