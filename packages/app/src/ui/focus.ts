/** Browser focus follows menu redraws without changing the headless game's input model. */
const CONTROLS = 'button:not(:disabled):not([tabindex="-1"]), input, select, textarea, [tabindex="0"]';

const controls = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(CONTROLS)].filter(e => e.getClientRects().length && !e.closest('[inert]'));

/** Brings the cursor row into view: a list region scrolls itself only (scrollIntoView would also scroll the sheet's clipping ancestors). */
export function scrollToCursor(root: HTMLElement): void {
  const cursor = root.querySelector<HTMLElement>('.is-cursor');
  const list = cursor?.closest<HTMLElement>('[data-scrolls]');
  if (cursor && list) {
    const pad = parseFloat(getComputedStyle(list).scrollPaddingTop) || 0;
    const l = list.getBoundingClientRect();
    const c = cursor.getBoundingClientRect();
    if (c.top < l.top + pad) list.scrollTop -= l.top + pad - c.top;
    else if (c.bottom > l.bottom - pad) list.scrollTop += c.bottom - (l.bottom - pad);
  } else cursor?.scrollIntoView({ block: 'nearest' });
}

/** Covered menu rows cannot receive browser focus while a question, action menu or message waits. */
export function isolatePrompt(root: HTMLElement): void {
  const prompt = root.querySelector<HTMLElement>('.yes-no, .app-menu, .party-menu, .msg-box.waiting, .os-layer');
  if (prompt) for (const e of root.querySelectorAll<HTMLElement>(CONTROLS)) if (!prompt.contains(e)) e.inert = true;
}

export function focusKey(e: Element | null): string | null {
  if (!(e instanceof HTMLElement)) return null;
  return e.dataset.focus ?? e.dataset.tap ?? null;
}

export function focusTarget(root: HTMLElement): HTMLElement {
  const cursor = [...root.querySelectorAll<HTMLElement>('.is-cursor')].filter(e => e.getClientRects().length && !e.closest('[inert]')).at(-1);
  const stops = controls(root);
  return stops.find(e => e === cursor || cursor?.contains(e)) ?? stops[0] ?? root;
}

export function restoreMenuFocus(root: HTMLElement, key: string | null, followCursor = false): void {
  const same = key === null ? undefined : controls(root).find(e => focusKey(e) === key);
  (same && (!followCursor || same.closest('.is-cursor')) ? same : focusTarget(root)).focus({ preventScroll: true });
}

/** Tab stays in the modal; tabs/radios use their native composite navigation pattern. */
export function menuKey(event: KeyboardEvent, root: HTMLElement): void {
  const stops = controls(root);
  if (event.key === 'Tab') {
    event.preventDefault();
    const i = stops.indexOf(document.activeElement as HTMLElement);
    stops[(i + (event.shiftKey ? stops.length - 1 : 1)) % stops.length]?.focus();
    return;
  }
  const focused = document.activeElement as HTMLElement;
  const role = focused.getAttribute('role');
  if ((role !== 'tab' && role !== 'radio') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const siblings = [...focused.parentElement!.querySelectorAll<HTMLButtonElement>(`[role="${role}"]:not(:disabled)`)];
  const i = siblings.indexOf(focused as HTMLButtonElement);
  const at = event.key === 'Home' ? 0 : event.key === 'End' ? siblings.length - 1 : (i + (event.key === 'ArrowLeft' ? siblings.length - 1 : 1)) % siblings.length;
  siblings[at]!.focus();
  siblings[at]!.click();
}
