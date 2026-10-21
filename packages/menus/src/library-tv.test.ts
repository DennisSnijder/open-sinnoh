/** The library TV's timing (decomp library_tv.c LibraryTV_Main), one DS frame per tick. */
import { describe, expect, it } from 'vitest';
import type { InputFrame, LibraryTvView } from '@opensinnoh/contracts';
import { libraryTvScreen } from './library-tv.ts';
import { AppStack } from './stack.ts';

const IDLE: InputFrame = { held: [], pressed: ['a'], touch: null };

describe('library TV', () => {
  it('fades in over 6 frames, holds 240, fades out over 6 and closes; the scan lines move one row every 4 frames', () => {
    const app = new AppStack(libraryTvScreen(), { app: 'library-tv' });
    const views: LibraryTvView[] = [app.view() as LibraryTvView];
    let result = null;
    while (!result && views.length < 1000) {
      result = app.step(IDLE);
      views.push(app.view() as LibraryTvView);
    }
    expect(result).toEqual({ app: 'library-tv' });
    // Setup (2 frames) and the fade's start: black; then 6 fade steps, 241 frames of MAIN, 6 fade steps.
    expect(views).toHaveLength(1 + 3 + 6 + 241 + 6);
    expect(views.slice(0, 4).map((v) => v.black)).toEqual([16, 16, 16, 16]);
    expect(views.slice(4, 10).map((v) => v.black)).toEqual([13, 11, 8, 5, 3, 0]);
    expect(views.slice(10, 251).every((v) => v.black === 0)).toBe(true);
    expect(views.slice(251).map((v) => v.black)).toEqual([3, 5, 8, 11, 13, 16]);
    // scanLinePos += 4 a frame from the fade's first: BG1's y offset is scanLinePos >> 4.
    expect(views.slice(3, 13).map((v) => v.scanY)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2]);
    expect(views.at(-1)!.scanY).toBe(((253 * 4) >> 4) & 0xff);
  });
});
