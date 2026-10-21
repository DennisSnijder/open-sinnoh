/**
 * The touch panel (DS bottom screen): drawing a PanelView and mapping pointer positions to
 * logical 256×192 panel coordinates.
 */
import { PANEL_HEIGHT, PANEL_WIDTH, hitChoice as hitChoiceIndex, choiceRects, type PanelView } from '@opensinnoh/contracts';
const TITLE_HEIGHT = 28;
const MARGIN = 8;

export { choiceRects };

/** Index of the option under a panel-coordinate point, or -1. */
export function hitChoice(view: PanelView, point: { x: number; y: number }): number {
  return view.kind === 'choice' ? hitChoiceIndex(view.options.length, point) : -1;
}

/** Client (CSS px) position → integer panel coordinates, or null when outside the panel. */
export function toPanelPoint(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }): { x: number; y: number } | null {
  const x = Math.floor(((clientX - box.left) / box.width) * PANEL_WIDTH);
  const y = Math.floor(((clientY - box.top) / box.height) * PANEL_HEIGHT);
  if (x < 0 || y < 0 || x >= PANEL_WIDTH || y >= PANEL_HEIGHT) return null;
  return { x, y };
}

/** Where the overlay's 256×192 DS frame is drawn: its top-left corner in device px, and device px per DS px. */
export interface DsFrame {
  x: number;
  y: number;
  scale: number;
}

/** The field's frame (`drawScriptOverlay`'s own): centred horizontally at the bottom of the canvas. */
export function bottomFrame(canvas: { width: number; height: number }, scale: number): DsFrame {
  return { x: Math.floor((canvas.width / scale - PANEL_WIDTH) / 2) * scale, y: Math.floor(canvas.height / scale - PANEL_HEIGHT) * scale, scale };
}

/**
 * Client position on the overlay canvas → DS top-screen coordinates in the frame the script windows are drawn in
 * (`bottomFrame` on the field, the scene's frame in a frontier scene), or null outside it.
 * Scripted menus are boxes in that frame, so a touch on one reaches the VM in the coordinates it drew.
 */
export function toOverlayPoint(clientX: number, clientY: number, box: { left: number; top: number; width: number; height: number }, canvas: { width: number; height: number }, frame: DsFrame): { x: number; y: number } | null {
  const x = Math.floor(((((clientX - box.left) / box.width) * canvas.width) - frame.x) / frame.scale);
  const y = Math.floor(((((clientY - box.top) / box.height) * canvas.height) - frame.y) / frame.scale);
  if (x < 0 || y < 0 || x >= PANEL_WIDTH || y >= PANEL_HEIGHT) return null;
  return { x, y };
}

const INK = '#f4ecd8';
const PAPER = '#1d2433';
const ACCENT = '#f2a93b';

/** Draws the panel. The context is pre-scaled so drawing uses logical panel coordinates. */
export function drawPanel(ctx: CanvasRenderingContext2D, view: PanelView, touch: { x: number; y: number } | null): void {
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
  ctx.textBaseline = 'middle';
  if (view.kind === 'idle') {
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.arc(PANEL_WIDTH / 2, 76, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(view.title, PANEL_WIDTH / 2, 120, PANEL_WIDTH - 2 * MARGIN);
    return;
  }
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(view.title, MARGIN, TITLE_HEIGHT / 2, PANEL_WIDTH - 2 * MARGIN);
  const touched = touch ? hitChoice(view, touch) : -1;
  ctx.font = '600 15px system-ui, sans-serif';
  choiceRects(view.options.length).forEach((r, i) => {
    const active = i === view.cursor || i === touched;
    ctx.fillStyle = active ? ACCENT : '#2e3850';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.width, r.height, 6);
    ctx.fill();
    ctx.fillStyle = active ? PAPER : INK;
    ctx.fillText(view.options[i]!.label, r.x + 12, r.y + r.height / 2, r.width - 24);
  });
}
