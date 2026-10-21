/**
 * Touch on the game's own surfaces (iPhone Safari): no text-selection loupe, callout or page zoom.
 *
 * style.css and title.css already set `touch-action`, `user-select` and `-webkit-touch-callout` there, but iOS still
 * shows the loupe on a long press and zooms on a fast double tap. So, on the game view (`#game`) and the title and its
 * DS screens (`.title`), outside OpenSinnoh's own screens (`.os-screen`, which keep selection and pinch zoom):
 * - the touch controls and the canvases cancel `touchstart` (they read pointer events, which still come);
 * - a second tap within `DOUBLE_TAP_MS` of the last cancels its `touchend` (no zoom) and clicks its target itself;
 * - a zoomed page (from before, or a gesture that got through) is zoomed back out: a moment of `maximum-scale=1`.
 */

const GAME = '#game, .title';
const OWN = '.os-screen, input, textarea, select';
/** Driven by pointer events alone: nothing needs the browser's default for a touch there. */
const POINTER_ONLY = '.controls, #game > canvas';
/** iOS's double-tap window is about 300 ms. */
const DOUBLE_TAP_MS = 350;
const UNZOOM_MS = 300;

/** The element is on a game surface and not inside one of OpenSinnoh's own screens or a text field. */
function onGame(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && !!target.closest(GAME) && !target.closest(OWN);
}

export function installTouchGuards(): void {
  let lastTap = -Infinity;
  document.addEventListener(
    'touchstart',
    (e) => {
      if (onGame(e.target) && e.target.closest(POINTER_ONLY)) e.preventDefault();
    },
    { passive: false },
  );
  document.addEventListener(
    'touchend',
    (e) => {
      if (!onGame(e.target)) {
        lastTap = -Infinity;
        return;
      }
      const fast = e.timeStamp - lastTap < DOUBLE_TAP_MS;
      lastTap = e.timeStamp;
      if (!fast || e.cancelable === false) return;
      e.preventDefault();
      // Cancelling the touchend also cancels its click: the menus and the intro's text still get the tap.
      if (!e.target.closest(POINTER_ONLY)) e.target.click();
    },
    { passive: false },
  );

  const vv = window.visualViewport;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!vv || !meta) return;
  const content = meta.content;
  let unzooming = false;
  vv.addEventListener('resize', () => {
    if (unzooming || vv.scale <= 1.01) return;
    // What fills the middle of the page decides: the game (zoom out) or one of our screens (pinch zoom is theirs).
    if (!onGame(document.elementFromPoint(innerWidth / 2, innerHeight / 2))) return;
    unzooming = true;
    meta.content = `${content}, maximum-scale=1`;
    setTimeout(() => {
      meta.content = content;
      unzooming = false;
    }, UNZOOM_MS);
  });
}
