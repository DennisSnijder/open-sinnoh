/**
 * Opening the system's file dialog. Browsers open it only with transient user activation. A key press, click or tap
 * always gives one; a gamepad press gives one only in some browsers (Chromium activates the page when `getGamepads()`
 * sees a press, a draft in w3c/gamepad #230; Gecko has no such path shipped), so a press from the pad may be refused.
 * `showPicker()` says so, where `click()` fails without a word: the caller tells the player instead of doing nothing.
 */

/** What the player sees when the browser refuses (the ROM page has its own, longer one). */
export const FILE_DIALOG_REFUSED = 'This browser opens the file dialog only for a key press, click or tap: press Enter, click or tap this button.';

/** Opens `input`'s dialog; false when the browser refused it (no user activation). */
export function openFileDialog(input: HTMLInputElement): boolean {
  if (typeof input.showPicker !== 'function') {
    input.click();
    return true;
  }
  try {
    input.showPicker();
    return true;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'NotAllowedError') return false;
    throw e;
  }
}
