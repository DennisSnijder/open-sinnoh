/**
 * DS rows keep their DS size on every screen; a row alone on its line in a window
 * taps across the window's whole width, its frame included. An invisible `::after` (ui.css) carries the extension,
 * so nothing drawn moves. Rows sharing a line with another stop (a grid, a pair of choices) keep theirs.
 */
export function widenRowHits(root: HTMLElement): void {
  for (const win of [...(root.matches('.window') ? [root] : []), ...root.querySelectorAll<HTMLElement>('.window')]) {
    const rows = [...win.querySelectorAll<HTMLElement>('[data-nav]')].filter((e) => e.offsetWidth && e.closest('.window') === win);
    const rects = rows.map((e) => e.getBoundingClientRect());
    const w = win.getBoundingClientRect();
    rows.forEach((row, i) => {
      const r = rects[i]!;
      const alone = rects.every((o, j) => j === i || o.bottom <= r.top + 0.5 || o.top >= r.bottom - 0.5);
      const k = r.width / row.offsetWidth;
      // The window's border box (its frame is the border), within the padding box of any box that
      // clips or scrolls on the way (a wider tap area there would scroll sideways).
      let left = w.left;
      let right = w.right;
      for (let e = row.parentElement; e && win.contains(e); e = e.parentElement) {
        if (getComputedStyle(e).overflowX === 'visible') continue;
        const b = e.getBoundingClientRect();
        const ke = b.width / e.offsetWidth;
        left = Math.max(left, b.left + e.clientLeft * ke);
        right = Math.min(right, b.left + (e.clientLeft + e.clientWidth) * ke);
      }
      row.style.setProperty('--hit-l', alone ? `${Math.max(0, (r.left - left) / k)}px` : '0px');
      row.style.setProperty('--hit-r', alone ? `${Math.max(0, (right - r.right) / k)}px` : '0px');
    });
  }
}
