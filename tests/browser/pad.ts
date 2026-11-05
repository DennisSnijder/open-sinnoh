/**
 * A gamepad a spec can press: `navigator.getGamepads` overridden before the page loads. Playwright's `evaluate` runs
 * with a user gesture, so a press here has the activation a browser that lets pad presses through would give;
 * `refuseFileDialog` stands for a browser that does not (file-dialog.ts).
 */
import type { Page } from '@playwright/test';

/** Standard-mapping buttons, positional like the DS (controls.ts). */
export const PAD = { b: 0, a: 1, y: 2, x: 3, l: 4, r: 5, lt: 6, fast: 7, select: 8, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;

interface FakePad {
  id: string;
  index: number;
  connected: boolean;
  mapping: string;
  buttons: { pressed: boolean; touched: boolean; value: number }[];
  axes: number[];
}
type Pads = { __pads: (FakePad | null)[] };

/** Installs `count` pads (before `page.goto`). None shows until a spec presses one, as a browser hides an untouched pad. */
export async function installPads(page: Page, o: { mapping?: string; id?: string; count?: number } = {}): Promise<void> {
  await page.addInitScript(({ mapping, id, count }) => {
    const w = window as unknown as Pads;
    w.__pads = Array.from({ length: count }, (_, index) => ({ id, index, connected: true, mapping, buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })), axes: [0, 0, 0, 0] }));
    navigator.getGamepads = () => w.__pads as unknown as Gamepad[];
  }, { mapping: o.mapping ?? 'standard', id: o.id ?? 'Test pad', count: o.count ?? 1 });
}

export const hold = (page: Page, button: number, down: boolean, pad = 0): Promise<void> =>
  page.evaluate(({ b, d, p }) => {
    const x = (window as unknown as Pads).__pads[p]!.buttons[b]!;
    x.pressed = d;
    x.value = d ? 1 : 0;
  }, { b: button, d: down, p: pad });

export const stick = (page: Page, x: number, y: number, pad = 0): Promise<void> =>
  page.evaluate(({ x, y, p }) => void ((window as unknown as Pads).__pads[p]!.axes = [x, y, 0, 0]), { x, y, p: pad });

/** A browser that refuses the file dialog for a pad press: `showPicker` throws as it does without user activation. */
export async function refuseFileDialog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    HTMLInputElement.prototype.showPicker = () => {
      throw new DOMException('no user activation', 'NotAllowedError');
    };
  });
}

/**
 * Waits `ms` with the page's frames running. The headless browser all but stops animation frames on an idle page while
 * no evaluate is in flight (a `waitForTimeout` gave 5 frames in 1.2 s), and the pad is polled on them.
 */
export const run = (page: Page, ms: number): Promise<void> =>
  page.evaluate((ms) => new Promise<void>((done) => {
    const end = performance.now() + ms;
    let frames = 0;
    const f = () => {
      if (++frames >= 3 && performance.now() >= end) done();
      else requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }), ms);

/** One press: down long enough for a poll and a 30 Hz tick, then up as long. */
export async function press(page: Page, button: number, pad = 0): Promise<void> {
  await hold(page, button, true, pad);
  await run(page, 100);
  await hold(page, button, false, pad);
  await run(page, 100);
}
