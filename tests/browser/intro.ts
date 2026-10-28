/**
 * Driving the title's DS screens before a game (packages/app/src/title): the setup and Rowan's intro, by keys on
 * desktop and by taps on the phone, through the DOM they draw (message box, choice windows, the Poké Ball's button,
 * the avatars, the naming keyboard). Real time: the title runs its own 30 Hz loop.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { strings, type Strings } from '../../packages/app/src/strings/index.ts';

/** Waits until the title has run `n` more ticks (or changed phase, which restarts its frame count). */
export async function ticks(page: Page, n: number): Promise<void> {
  const at = await page.evaluate(() => ({ phase: window.openSinnohTitle?.phase, frame: window.openSinnohTitle?.frame ?? 0 }));
  await page.waitForFunction(({ phase, frame, n }) => !window.openSinnohTitle || window.openSinnohTitle.phase !== phase || window.openSinnohTitle.frame >= frame + n, { ...at, n });
}

/** InputState retains short taps for one frame. Release before waiting so a slow poll cannot repeat the key. */
export async function press(page: Page, code: string): Promise<void> {
  await page.keyboard.press(code);
  await ticks(page, 2);
}

/** The setup's answers stored as given, so the title goes straight to the main menu (specs that test something else). */
export const SETUP_DONE = { 'lantern-nds:setup': '["reports","addon","textSpeed","visualStyle"]', 'lantern-nds:error-reports': 'false' };

export async function skipSetup(page: Page): Promise<void> {
  await page.addInitScript((entries) => {
    for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
  }, SETUP_DONE);
}

export class TitleScreens {
  constructor(
    readonly page: Page,
    readonly touch: boolean,
    /** The app's words: the browser's (English, playwright.config.ts) until a game is stored. */
    readonly words: Strings = strings('en'),
  ) {}

  /** The open DS screen (setup or the intro; the intro's dialog is named in English in every language, new-game-flow.ts). */
  flow(name: 'Setup' | 'New game'): Locator {
    return this.page.getByRole('dialog', { name: name === 'Setup' ? this.words.title.setup : name });
  }

  /** A on the waiting message box or text block (a tap on the phone), else a tick, until `done`. */
  async advance(flow: Locator, done: () => Promise<boolean>, max = 900): Promise<void> {
    for (let i = 0; i < max; i++) {
      if (await done()) return;
      const box = flow.locator('.msg-box.waiting, .intro-block[role="button"]');
      if (await box.isVisible()) {
        const previous = await box.allTextContents();
        // A bounded tap: an unbounded one on a box that goes first waits for it until the test times out.
        if (this.touch) await box.tap({ timeout: 5_000 }).catch(() => undefined);
        else await press(this.page, 'KeyZ');
        // One A per page: the tap's click can land frames later on a loaded machine.
        // A fast render can pass through the gap to the next waiting page between polls.
        await expect.poll(() => box.allTextContents(), { timeout: 15_000 }).not.toEqual(previous);
      } else await ticks(this.page, 2);
    }
    throw new Error('the title screen did not get there');
  }

  /** Advances to the next choice window; returns its entries. */
  async menu(flow: Locator): Promise<string[]> {
    const entries = flow.locator('.intro-menu [data-tap^="menu:"]');
    await this.advance(flow, async () => (await entries.count()) > 0);
    return entries.allInnerTexts().then((t) => t.map((s) => s.trim()));
  }

  /** Picks entry `i` of the open choice window: down `i` times and A, or a tap. */
  async choose(flow: Locator, i: number): Promise<void> {
    const entry = flow.locator(`.intro-menu [data-tap="menu:${i}"]`);
    if (this.touch) await entry.tap();
    else {
      for (let n = await this.cursor(flow); n < i; n++) await press(this.page, 'ArrowDown');
      await expect(entry).toHaveAttribute('aria-current', 'true');
      await press(this.page, 'KeyZ');
    }
    await expect(entry).toHaveCount(0);
  }

  private async cursor(flow: Locator): Promise<number> {
    const id = await flow.locator('.intro-menu [aria-current="true"]').getAttribute('data-tap');
    return Number(id!.slice(5));
  }

  /** Opens the Poké Ball: A on desktop (the keyboard's way in), its button on the phone. */
  async openBall(flow: Locator): Promise<void> {
    const ball = flow.locator('.intro-ball');
    await this.advance(flow, () => ball.isVisible());
    // Its messages first (a tap on the button does not turn their pages), then the button. The button stays through
    // the ball's opening and goes at its flash: taps are bounded, as one started just then would wait for the
    // button until the test timed out (the phone run's 5-minute hang).
    for (let i = 0; i < 60 && (await ball.isVisible()); i++) {
      const box = flow.locator('.msg-box.waiting');
      if (!this.touch) await press(this.page, 'KeyZ');
      else if (await box.isVisible()) await box.tap({ timeout: 5_000 }).catch(() => undefined);
      else await ball.tap({ timeout: 5_000 }).catch(() => undefined);
      await ticks(this.page, 4);
    }
    await expect(ball).toHaveCount(0);
  }

  /** The boy or the girl: right and A on desktop, two taps on the phone. */
  async gender(flow: Locator, gender: 'boy' | 'girl'): Promise<void> {
    const avatars = flow.locator('.intro-avatar');
    await this.advance(flow, async () => (await avatars.count()) === 2);
    const pick = flow.locator(`.intro-avatar[data-tap="${gender}"]`);
    if (this.touch) {
      if ((await pick.getAttribute('aria-pressed')) !== 'true') await pick.tap();
      await expect(pick).toHaveAttribute('aria-pressed', 'true');
      await pick.tap();
    } else {
      if ((await pick.getAttribute('aria-pressed')) !== 'true') await press(this.page, 'ArrowRight');
      await expect(pick).toHaveAttribute('aria-pressed', 'true');
      await press(this.page, 'KeyZ');
    }
    await expect(avatars).toHaveCount(0);
  }

  /** Enters a name on the naming keyboard: typed on desktop, key by key on the phone (`taps`). */
  async name(flow: Locator, text: string, taps: string[]): Promise<void> {
    const naming = flow.locator('[data-screen="naming"]');
    await this.advance(flow, () => naming.isVisible());
    if (this.touch) for (const t of [...taps, 'ok']) await naming.locator(`[data-tap="${t}"]`).click();
    else {
      await this.page.keyboard.type(text);
      if (text) await expect(naming.locator('.naming-cell').first()).toContainText(text[0]!);
      await this.page.keyboard.press('Enter');
    }
    await expect(naming).toHaveCount(0);
  }
}
