/**
 * The fit checks of fit.rom.spec.ts, shared with the specs that open an app on their own way (frontier.rom.spec.ts):
 * the open app's screen inside the viewport and the field view, centred in the room, whole device pixels, clear of
 * the controls and HUD buttons, nothing clipped or scrolled out, every pixel label inside its window.
 */
import type { Page } from '@playwright/test';

/** The open app's fit problems (empty when it fits), measured in the page. */
export function screenProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const screen = document.querySelector<HTMLElement>('.ui-host [data-screen]');
    if (!screen) return out;
    const name = screen.dataset.screen!;
    const layer = document.querySelector<HTMLElement>('.ui-layer')!.getBoundingClientRect();
    const room = screen.parentElement!.getBoundingClientRect();
    const r = screen.getBoundingClientRect();
    const f = (n: number) => Math.round(n);
    const inside = (a: DOMRect, b: DOMRect, slack = 1) => a.left >= b.left - slack && a.top >= b.top - slack && a.right <= b.right + slack && a.bottom <= b.bottom + slack;
    if (!inside(r, new DOMRect(0, 0, innerWidth, innerHeight))) out.push(`${name}: screen ${f(r.left)},${f(r.top)}–${f(r.right)},${f(r.bottom)} leaves the ${innerWidth}×${innerHeight} viewport`);
    if (!inside(r, layer)) out.push(`${name}: screen leaves the field view`);
    // On desktop-sized views a generic sheet fits at the layout's dot: it is never drawn smaller to fit.
    const layerDot = parseFloat(document.querySelector<HTMLElement>('.ui-layer')!.style.getPropertyValue('--dot'));
    const drawnDot = parseFloat(screen.parentElement!.style.getPropertyValue('--dot'));
    if (innerWidth >= 1000 && innerHeight >= 700 && !screen.matches('.board, .ds-screen') && drawnDot < layerDot) out.push(`${name}: drawn at a dot of ${drawnDot} px, under the layout's ${layerDot} px`);
    // Whole device pixels: the frame's dot and unit, and the screen's own unit (a board may set its own).
    const whole = (v: number) => Number.isFinite(v) && Math.abs(v * devicePixelRatio - Math.round(v * devicePixelRatio)) < 1e-6 && v > 0;
    const frameStyle = screen.parentElement!.style;
    for (const [what, v] of [['dot', parseFloat(frameStyle.getPropertyValue('--dot'))], ['unit', parseFloat(frameStyle.getPropertyValue('--unit'))], ['screen unit', parseFloat(getComputedStyle(screen).getPropertyValue('--unit'))]] as const) {
      if (!whole(v)) out.push(`${name}: ${what} ${v} px is not whole device pixels at dpr ${devicePixelRatio}`);
    }
    // On-screen controls and HUD buttons stay clear (and usable) over every screen.
    const overlaps = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    for (const b of document.querySelectorAll<HTMLElement>('.controls button, .hud-button')) {
      const br = b.getBoundingClientRect();
      if (!br.width || getComputedStyle(b).visibility === 'hidden' || b.closest('[hidden]')) continue;
      if (overlaps(r, br)) out.push(`${name}: covers the ${b.dataset.button ?? b.getAttribute('aria-label')} button`);
    }
    // Sheets and scenes are centred in the room (their frame).
    const kind = screen.parentElement!.className;
    const dx = Math.abs(r.left - room.left - (room.right - r.right));
    const dy = Math.abs(r.top - room.top - (room.bottom - r.bottom));
    // Windows (the start menu, save) sit at the DS's right edge; the mart's DS screen is bottom-centred, except a
    // screen of its own (`.mart-screen`: the buy list, the Ball Capsule editor) on phones, which shows full screen
    // over an opaque backdrop.
    const layerData = document.querySelector<HTMLElement>('.ui-layer')!.dataset;
    const phone = layerData.mode === 'compact' || layerData.controls === 'side';
    const ownScreen = phone && screen.matches('.mart-screen');
    if (ownScreen && !document.querySelector('.ui-host .ui-scrim.opaque')) out.push(`${name}: no opaque backdrop behind the full-screen DS screen`);
    if (!kind.includes('ui-window') && dx > 2) out.push(`${name}: off centre sideways by ${f(dx / 2)} px`);
    if ((ownScreen || !kind.includes('ui-mart')) && !kind.includes('ui-window') && dy > 2) out.push(`${name}: off centre vertically by ${f(dy / 2)} px`);
    for (const e of [screen, ...screen.querySelectorAll<HTMLElement>('*')]) {
      if ((e.offsetParent === null && e !== screen) || e.classList.contains('sr-only')) continue;
      const s = getComputedStyle(e);
      const clips = s.overflowX !== 'visible' || s.overflowY !== 'visible';
      if (!clips) continue;
      const label = `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`;
      if (e.scrollWidth > e.clientWidth + 1) out.push(`${name}: ${label} scrolls sideways (${e.scrollWidth} > ${e.clientWidth})`);
      if (e.scrollHeight > e.clientHeight + 1 && !e.hasAttribute('data-scrolls')) out.push(`${name}: ${label} is cut (${e.scrollHeight} > ${e.clientHeight})`);
    }
    // Text inside its window: each pixel label within its nearest window or panel.
    for (const c of screen.querySelectorAll<HTMLCanvasElement>('.px > canvas')) {
      const box = c.parentElement!.closest<HTMLElement>('.window, .msg-box, [data-screen], [data-scrolls]')!;
      const lr = c.getBoundingClientRect();
      if (!lr.width) continue;
      const scroller = box.hasAttribute('data-scrolls');
      const br = box.getBoundingClientRect();
      const ok = scroller ? lr.left >= br.left - 1 && lr.right <= br.right + 1 : inside(lr, br);
      if (!ok) out.push(`${name}: text "${c.parentElement!.textContent}" runs out of ${box.className.split(' ')[0]} (${f(lr.left)},${f(lr.top)}–${f(lr.right)},${f(lr.bottom)} in ${f(br.left)},${f(br.top)}–${f(br.right)},${f(br.bottom)})`);
    }
    return out;
  });
}
