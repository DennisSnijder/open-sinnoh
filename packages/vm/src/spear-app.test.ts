import { expect, it } from 'vitest';
import { cameraTranslation } from './spear-app.ts';
it('the native camera helper translates on N−1 calls with truncated signed fx32 steps', () => {
  expect(cameraTranslation(-46, 60)).toBe(-45.2294921875);
  expect(cameraTranslation(70, 60)).toBe(68.82373046875);
  expect(cameraTranslation(-80, 90)).toBe(-79.091796875);
});
