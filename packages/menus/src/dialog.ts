/**
 * The message box and YES/NO window the menu apps share (decomp Window_DrawMessageBox… with a printer that
 * waits for A/B, and Menu_MakeYesNoChoice). Messages appear whole (the DS prints them); a waiting one
 * takes A or B (or a tap on the box, `next`), page by page, then runs its continuation. A question shows
 * its text with YES/NO; B answers no.
 */
import type { Button } from '@opensinnoh/core';
import type { AppMessage, AppYesNo } from '@opensinnoh/contracts';
import type { Step } from './stack.ts';

type Input = { button: Button } | { tap: string };

export class Dialog {
  private msg: { pages: string[]; page: number; then: () => Step; quiet: boolean } | null = null;
  private ask: { text: string; cursor: 0 | 1; then: (yes: boolean) => Step } | null = null;

  constructor(
    private readonly yes: string,
    private readonly no: string,
    private readonly sound: (source: number) => void,
  ) {}

  /** Shows pages that wait for A/B, then runs `then`; `quiet`: the presses play no sound (the party's item messages). */
  say(pages: string[], then: () => Step = () => undefined, quiet = false): Step {
    if (!pages.length) throw new Error('dialog: a message without pages');
    this.ask = null;
    this.msg = { pages, page: 0, then, quiet };
    return;
  }

  /** Shows `pages` (all but the last wait) and then the last one with YES/NO, the cursor on `cursor` (0 YES, 1 NO). */
  confirm(pages: string[], then: (yes: boolean) => Step, cursor: 0 | 1 = 0): Step {
    const last = pages.at(-1);
    if (last === undefined) throw new Error('dialog: a question without text');
    const question = (): Step => {
      this.ask = { text: last, cursor, then };
      return;
    };
    if (pages.length > 1) return this.say(pages.slice(0, -1), question);
    return question();
  }

  get active(): boolean {
    return this.msg !== null || this.ask !== null;
  }

  message(): AppMessage | null {
    if (this.msg) return { text: this.msg.pages[this.msg.page]!, waiting: true };
    if (this.ask) return { text: this.ask.text, waiting: false };
    return null;
  }

  yesNo(): AppYesNo | null {
    return this.ask ? { yes: this.yes, no: this.no, cursor: this.ask.cursor } : null;
  }

  /** Takes the input while a message or question is up. */
  input(i: Input): Step {
    if (this.msg) {
      const advance = 'tap' in i ? i.tap === 'next' || i.tap === 'back' : i.button === 'a' || i.button === 'b';
      if (!advance) return;
      const m = this.msg;
      if (!m.quiet) this.sound(1500);
      if (m.page + 1 < m.pages.length) {
        m.page++;
        return;
      }
      this.msg = null;
      return m.then();
    }
    const q = this.ask;
    if (!q) throw new Error('dialog: input without a message');
    let answer: boolean | null = null;
    if ('tap' in i) {
      if (i.tap === 'yes') answer = true;
      else if (i.tap === 'no' || i.tap === 'back') answer = false;
    } else if (i.button === 'up' || i.button === 'down') {
      q.cursor = q.cursor === 0 ? 1 : 0;
      this.sound(1500);
    }
    else if (i.button === 'a') answer = q.cursor === 0;
    else if (i.button === 'b') answer = false;
    if (answer === null) return;
    this.sound('tap' in i && (i.tap === 'yes' || i.tap === 'no') ? 1508 : 1500);
    this.ask = null;
    return q.then(answer);
  }
}
