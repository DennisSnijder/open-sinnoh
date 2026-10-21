/**
 * The Canalave Library TV (decomp library_tv/library_tv.c, LibraryTV_Main), one DS frame per tick: two frames of
 * setup (STATE_INIT, STATE_BGM_START: the screen black), then STATE_FADE_START starts a brightness fade in
 * (StartScreenFade 6 steps of 1 frame), STATE_FADE_WAIT waits for it, STATE_MAIN holds LIBRARY_TV_DURATION
 * (90 + 150) frames and starts the fade out, STATE_EXIT waits for it and the app ends. From the fade's first frame
 * on, every frame moves the scan lines (LibraryTV_UpdateScanLines: scanLinePos += 4, BG1's y offset
 * scanLinePos >> 4). No input; the script's ReturnToField waits for it.
 */
import type { LibraryTvView } from '@opensinnoh/contracts';
import type { Screen, Step } from './stack.ts';

/** StartScreenFade(…, 6, 1): 6 steps of one frame, from or to black (master brightness ±16). */
const FADE_STEPS = 6;
const BLACK = 16;
/** LIBRARY_TV_DURATION. */
const DURATION = 90 + 150;

export function libraryTvScreen(): Screen {
  let state: 'init' | 'bgm' | 'fade-start' | 'fade-in' | 'main' | 'fade-out' = 'init';
  let black = BLACK;
  let fade = 0;
  let wait = 0;
  let scanLinePos = 0;
  const scan = () => (scanLinePos += 4);
  /** One step of the running fade; true once it is done. */
  const stepFade = (to: 0 | 16): boolean => {
    fade++;
    const k = to ? fade : FADE_STEPS - fade;
    black = Math.round((BLACK * k) / FADE_STEPS);
    return fade === FADE_STEPS;
  };
  return {
    view: (): LibraryTvView => ({ app: 'library-tv', scanY: (scanLinePos >> 4) & 0xff, black }),
    input: () => undefined,
    tick(): Step {
      switch (state) {
        case 'init':
          state = 'bgm';
          return;
        case 'bgm':
          state = 'fade-start';
          return;
        case 'fade-start':
          fade = 0;
          state = 'fade-in';
          return;
        case 'fade-in':
          scan();
          if (stepFade(0)) [state, wait] = ['main', DURATION];
          return;
        case 'main':
          scan();
          if (wait) wait--;
          else [state, fade] = ['fade-out', 0];
          return;
        case 'fade-out':
          scan();
          return stepFade(BLACK) ? { close: { app: 'library-tv' } } : undefined;
      }
    },
  };
}
