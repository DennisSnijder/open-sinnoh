import type { Page } from '@playwright/test';

/**
 * Waits until the page has drawn the current view and its entering animations (the sheet slide) are done;
 * only looping animations may still run. Screenshots and layout checks run after it.
 */
export async function settle(page: Page): Promise<void> {
  // After the next frames have drawn the view (slow frames on the phone draw it late), its entering animation.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.evaluate(async () => {
    // A redraw in the meantime cancels an animation (its promise rejects) and starts the new screen's: wait for that one too.
    const running = () => document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity && a.playState === 'running');
    for (let i = 0; i < 20 && running().length; i++) {
      await Promise.all(running().map((a) => a.finished.catch(() => undefined)));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });
}
