/**
 * The gamepad on the page's plain DOM screens: the ROM page (the picker, the import session and its first-run setup,
 * the update toast), the crash screen and the iOS hint. These run before or after the game, so no game input reaches
 * them. While one shows it owns the pad (`controls.padTaken`: the game reads nothing): the d-pad and stick move focus
 * by position, wrapping up and down, repeating while held; DS A presses; DS B dismisses what can be dismissed (each pad's own, controls.ts). The screens
 * themselves stay plain buttons: this module only knows focus and clicks.
 *
 * A press acts in the same task as the `getGamepads()` that saw it, which is what lets Chromium's activation reach
 * the file dialog (file-dialog.ts). A button already down when a screen appears does nothing there, and one still
 * down when the screen goes does nothing in the game (`holdPads`).
 */
import type { Button } from '@opensinnoh/core';
import { controls, currentPad, gamepadButtons } from './input.ts';

/** Held direction: the first repeat, then every (ms). The game's own menus repeat at 8 and 4 ticks of 30 Hz. */
const REPEAT_DELAY = 267;
const REPEAT_EVERY = 133;
/** How far the d-pad scrolls a focused text box (px). */
const SCROLL = 48;

const STOPS = 'button, input[type="file"], summary, [tabindex="0"]';
type Dir = 'up' | 'down' | 'left' | 'right';
const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export interface PadNavDeps {
  /** A on a file input: a click would fail without a word when the browser refuses the dialog. */
  openFile(input: HTMLInputElement): void;
  /** The pad was used on the ROM page; `confirm` names the button that presses. */
  used(confirm: string): void;
}

/** The screen that owns the pad now, topmost first, and the parts it spans. */
function owners(): HTMLElement[] | null {
  const crash = document.querySelector<HTMLElement>('.crash');
  if (crash) return [crash];
  const hint = document.getElementById('ios-hint');
  if (hint && !hint.hidden) return [hint];
  const rom = document.getElementById('rom');
  if (!rom || rom.hidden) return null;
  const update = document.getElementById('update-toast');
  return update ? [rom, update] : [rom];
}

/** What a file input shows as: the label around it. */
const box = (e: HTMLElement) => (e.closest('label') ?? e).getBoundingClientRect();

function stops(screens: readonly HTMLElement[]): HTMLElement[] {
  return screens.flatMap((s) => [...s.querySelectorAll<HTMLElement>(STOPS)]).filter((e) => box(e).width > 0 && !e.closest('[inert], [hidden]') && !e.matches('details:not([open]) :not(summary)') && e.tabIndex >= 0 && !(e as HTMLButtonElement).disabled);
}

/** The stop nearest `from` that way: along the direction first, sideways counting double. */
export function nearest(from: DOMRect, rects: readonly DOMRect[], dir: Dir): number {
  const c = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;
  const [fx, fy] = c(from);
  const along = dir === 'up' || dir === 'down' ? 1 : 0;
  const sign = dir === 'up' || dir === 'left' ? -1 : 1;
  let best = -1;
  let score = Infinity;
  rects.forEach((r, i) => {
    const [x, y] = c(r);
    const main = (along ? y - fy : x - fx) * sign;
    const side = Math.abs(along ? x - fx : y - fy);
    if (main <= 1) return;
    const s = main + 2 * side;
    if (s < score) {
      score = s;
      best = i;
    }
  });
  return best;
}

function focus(e: HTMLElement): void {
  e.focus();
  // Focus by a script after a click shows no ring in some browsers; the pad's cursor must always show (os.css).
  document.documentElement.dataset.padFocus = '';
  (e.closest('label') ?? e).scrollIntoView({ block: 'nearest' });
}

export function startPadNav(deps: PadNavDeps): void {
  let was = new Set<Button>();
  let seeded = false;
  let used = false;
  let dir: Dir | null = null;
  let live = false;
  let nextAt = 0;
  addEventListener('pointerdown', () => delete document.documentElement.dataset.padFocus, true);

  const move = (screens: readonly HTMLElement[], d: Dir) => {
    const all = stops(screens);
    const at = document.activeElement as HTMLElement | null;
    if (!at || !all.includes(at)) {
      if (all[0]) focus(all[0]);
      return;
    }
    // A long text box scrolls before focus leaves it.
    if ((d === 'up' || d === 'down') && at.scrollHeight > at.clientHeight + 1) {
      const room = d === 'up' ? at.scrollTop : at.scrollHeight - at.clientHeight - at.scrollTop;
      if (room > 1) {
        at.scrollTop += d === 'up' ? -SCROLL : SCROLL;
        return;
      }
    }
    const others = all.filter((e) => e !== at);
    const to = nearest(box(at), others.map(box), d);
    if (to >= 0) return focus(others[to]!);
    // Off the end of the column: round to the other end.
    if (d === 'up' || d === 'down') focus(d === 'up' ? all.at(-1)! : all[0]!);
  };

  const press = () => {
    const at = document.activeElement as HTMLElement;
    if (at instanceof HTMLInputElement && at.type === 'file') deps.openFile(at);
    else at.click();
  };

  const loop = () => {
    requestAnimationFrame(loop);
    const screens = owners();
    if (!screens) {
      if (controls.padTaken) {
        controls.padTaken = false;
        controls.holdPads(navigator.getGamepads?.() ?? []);
      }
      seeded = false;
      return;
    }
    controls.padTaken = true;
    const pad = currentPad();
    const now = pad ? gamepadButtons(pad, controls.bindings) : [];
    const held = new Set(now);
    // A screen that has just appeared: what is down now was pressed for the screen before it.
    const fresh = seeded ? now.filter((b) => !was.has(b)) : [];
    was = held;
    seeded = true;
    if (fresh.length && !used) {
      used = true;
      deps.used(controls.confirmLabel);
    }
    // Focus is on no stop (the first press, a redrawn step, a heading, a button gone): it lands on the first one, and
    // the press that brought it there acts on nothing unseen.
    if (used) {
      const all = stops(screens);
      if (all[0] && !all.includes(document.activeElement as HTMLElement)) return focus(all[0]);
    }
    const d = DIRS.find((x) => held.has(x)) ?? null;
    const t = performance.now();
    if (d !== dir) {
      dir = d;
      nextAt = t + REPEAT_DELAY;
      live = !!d && fresh.includes(d);
      if (live) move(screens, d!);
    } else if (d && live && t >= nextAt) {
      nextAt = t + REPEAT_EVERY;
      move(screens, d);
    }
    if (fresh.includes('a')) press();
    if (fresh.includes('b')) document.getElementById('ios-hint-close')?.click();
  };
  requestAnimationFrame(loop);
}
