/**
 * Screen-reader announcements for what the game draws on its canvas: the field's and the battle's message
 * boxes, the field's YES/NO and scripted menus, and the battle card's cursor. One polite live region; the text
 * is the game's own decoded text (never read from pixels). A message page is announced once it has finished
 * typing, never letter by letter. The DOM menu apps need none of this: their cursor is the browser's focus.
 */
import type { Game } from '@opensinnoh/game';
import { el } from './core.ts';

/** A page that is not waiting for a key (it closes by itself) counts as finished after this long unchanged. */
const STABLE_MS = 1500;
/** Announcements kept in the region (older ones are dropped, so it never grows). */
const KEEP = 4;

const lines = (text: string) => text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** The live region (visually hidden). Each announcement is added as its own paragraph, and the browser reads what is added. */
export function liveRegion(): { el: HTMLElement; say(text: string): void } {
  const region = el('div', 'sr-only');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-relevant', 'additions');
  return {
    el: region,
    say(text) {
      region.append(el('p', '', text));
      while (region.children.length > KEEP) region.firstElementChild!.remove();
    },
  };
}

export class Announcer {
  /** The message box's text now, when it last changed, and the text last announced. */
  private text = '';
  private changedAt = 0;
  private spoken = '';
  /** The lines of the page announced last while the same message stayed open (a scrolling page repeats its last line). */
  private previous: string[] = [];
  private choiceKey = '';

  constructor(private readonly say: (text: string) => void) {}

  /** The message box's decoded text now (null: none is open) and whether the page waits for a key or is complete. Call every frame. */
  message(text: string | null, finished: boolean, now: number): void {
    if (text === null || text === '') {
      this.text = '';
      this.spoken = '';
      this.previous = [];
      return;
    }
    if (text !== this.text) {
      this.text = text;
      this.changedAt = now;
      this.spoken = '';
    }
    if (this.spoken === text || !(finished || now - this.changedAt >= STABLE_MS)) return;
    this.spoken = text;
    const page = lines(text);
    // A page that scrolls keeps its last line: only the new lines are read.
    let skip = 0;
    for (let k = Math.min(this.previous.length, page.length - 1); k > 0; k--) {
      if (this.previous.slice(-k).every((l, i) => l === page[i])) {
        skip = k;
        break;
      }
    }
    this.previous = page;
    this.say(page.slice(skip).join(' '));
  }

  /** The row the cursor is on in a choice (a YES/NO, a menu): announced when it changes; null when none is open. */
  choice(key: string, text: string | null): void {
    if (text === null) {
      this.choiceKey = '';
      return;
    }
    const next = `${key}|${text}`;
    if (next === this.choiceKey) return;
    this.choiceKey = next;
    this.say(text);
  }
}

/** What the game shows now that needs announcing: the message page (decoded text) and the cursor row, if any. */
export function announceFrame(a: Announcer, game: Game, battleCursor: string | null, now: number): void {
  const battle = game.inBattle() ? game.battle?.view() : null;
  if (battle) {
    a.message(battle.message?.text ?? null, battle.message?.done ?? false, now);
    a.choice('battle', battleCursor);
    return;
  }
  const view = game.scripts.view();
  a.message(view.message?.text ?? null, view.message?.waitingForInput ?? false, now);
  if (view.yesNo) a.choice('yesno', view.yesNo.cursor === 0 ? view.yesNo.yes : view.yesNo.no);
  else if (view.menu) a.choice('menu', `${view.menu.entries[view.menu.cursor]}, ${view.menu.cursor + 1} of ${view.menu.entries.length}`);
  else a.choice('', null);
}
