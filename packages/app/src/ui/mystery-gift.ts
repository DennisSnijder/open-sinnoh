/**
 * Mystery Gift (`MysteryGiftView`) and the Easy Chat word picker (`EasyChatView`), game-drawn screens: one 256×192
 * board each on the DS blue, with the ROM font, the ROM's standard window frame and the message box frame. Mystery
 * Gift (decomp mystery_gift_app.c): the list window, the message box with YES/NO, and the Wonder Card (its title, the
 * gift's Pokémon icon and text; turned over, the date received and the gift's state) with arrows between cards. Easy Chat (decomp applications/easy_chat, group mode): the prompt and the blanks, the group list, the group's
 * words in two columns with scroll arrows. The Wonder Card's and Easy Chat's own art is not imported: framed windows
 * stand in for it.
 */
import type { EasyChatView, MysteryGiftView } from '@opensinnoh/contracts';
import { framed, messageBox, stop, type DrawContext } from './apps.ts';
import { ICON_ANIM } from './art.ts';
import { at, atTiles, board, boardContext } from './board.ts';
import { el } from './core.ts';
import './mystery-gift.css';
import { S } from '../strings/index.ts';

const MESSAGE = [0, 18, 32, 6] as const;
/** Two 16-px rows inside the ROM frame. */
const YES_NO = [24, 12, 7, 6] as const;

function yesNo(d: DrawContext, v: { yes: string; no: string; cursor: 0 | 1 }): HTMLElement {
  return atTiles(framed(d, 'yes-no', stop(d, 'yes', [d.text(v.yes)], 'choice', v.cursor === 0), stop(d, 'no', [d.text(v.no)], 'choice', v.cursor === 1)), ...YES_NO);
}

function arrow(d: DrawContext, id: string, dir: 'left' | 'right' | 'up' | 'down', label: string): HTMLButtonElement {
  const b = el('button', `mg-arrow ${dir}`);
  b.type = 'button';
  b.dataset.tap = id;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', () => d.tap(id));
  return b;
}

export function mysteryGift(wide: DrawContext, v: MysteryGiftView): HTMLElement {
  const d = boardContext(wide);
  const root = board('mystery-gift-screen');
  root.append(at(el('span', 'mg-bg'), 0, 0, 256, 192));
  if (v.card) {
    const c = v.card;
    const body = c.back
      ? [el('div', 'mg-card-date', d.text(c.back.date)), el('div', 'mg-card-status', d.flow(c.back.status, true))]
      : [el('div', 'mg-card-text', d.flow(c.description, false))];
    // The title in the label's blue beside the gift's icon, then three lines of text (or the back's date and state).
    const card = framed(d, 'mg-card', el('div', 'mg-card-head', el('span', 'mg-card-title', d.text(c.title, 'male')), el('span', 'mg-card-icon', d.art.pokemonIcon(c.species, 0, ICON_ANIM.hpMax, false))), ...body);
    card.setAttribute('aria-label', `${c.label}: ${c.title}`);
    card.dataset.card = c.title;
    root.append(atTiles(card, 1, 1, 30, 11));
    if (c.count > 1 && v.menu) {
      root.append(at(arrow(d, 'card:prev', 'left', 'Previous card'), 0, 40, 8, 16), at(arrow(d, 'card:next', 'right', 'Next card'), 248, 40, 8, 16));
    }
  }
  if (v.menu) {
    const list = el('div', 'mg-list', ...v.menu.entries.map((e, i) => stop(d, `menu:${i}`, [d.text(e.label)], 'mg-entry', i === v.menu!.cursor)));
    // With a card (CHECK CARD) the list sits where the message box goes; no message shows with it.
    const rect: [number, number, number, number] = v.card ? [20, 15, 11, 2 * v.menu.entries.length + 2] : [1, 1, 18, 2 * v.menu.entries.length + 2];
    root.append(atTiles(framed(d, 'mg-menu', list), ...rect));
  }
  if (v.message) root.append(atTiles(messageBox(d, v.message.text, v.message.waiting), ...MESSAGE));
  if (v.yesNo) root.append(yesNo(d, v.yesNo));
  root.toggleAttribute('data-busy', v.busy);
  root.setAttribute('aria-label', v.message?.text ?? S.aria.mysteryGift);
  return root;
}

/** The words' grid (DS px): two columns from x 16 and 132, rows of 16 from y 80, under the group's name. */
const WORDS = { x: [16, 132], y: 80, row: 16, width: 108 };

export function easyChat(wide: DrawContext, v: EasyChatView): HTMLElement {
  const d = boardContext(wide);
  const root = board('easy-chat-screen');
  root.append(at(el('span', 'mg-bg'), 0, 0, 256, 192));
  // The prompt and the blanks.
  const blanks = el('div', 'ec-slots', ...v.slots.map((s, i) => stop(d, `slot:${i}`, [s ? d.text(s) : el('span', 'ec-blank')], 'ec-slot', v.mode === 'slots' && v.cursor === i)));
  root.append(atTiles(framed(d, 'ec-top', el('div', 'ec-prompt', d.text(v.prompt)), blanks), 1, 1, 30, 6));
  if (v.mode === 'groups') {
    const list = el('div', 'ec-groups', ...v.groups.map((g, i) => stop(d, `group:${i}`, [d.text(g)], 'ec-group', v.cursor === i)));
    root.append(atTiles(framed(d, 'ec-group-list', list), 1, 7, 30, 14));
  } else if (v.mode === 'words') {
    const panel = framed(d, 'ec-word-list', el('div', 'ec-group-name', d.text(v.group ?? '', 'male')));
    root.append(atTiles(panel, 1, 7, 30, 16));
    for (let row = 0; row < v.rows; row++)
      for (let col = 0; col < 2; col++) {
        const i = (v.top + row) * 2 + col;
        const w = v.words[i];
        if (w === undefined) continue;
        root.append(at(stop(d, `word:${i}`, [d.text(w)], 'ec-word', v.cursor === i), WORDS.x[col]!, WORDS.y + row * WORDS.row, WORDS.width, WORDS.row));
      }
    const rows = Math.ceil(v.words.length / 2);
    if (v.top > 0) root.append(at(arrow(d, 'up', 'up', 'Scroll up'), 240, 66, 16, 12));
    if (v.top + v.rows < rows) root.append(at(arrow(d, 'down', 'down', 'Scroll down'), 240, 174, 16, 12));
  }
  if (v.message) root.append(atTiles(messageBox(d, v.message.text, v.message.waiting), ...MESSAGE));
  if (v.yesNo) root.append(yesNo(d, v.yesNo));
  root.setAttribute('aria-label', v.message?.text ?? v.prompt);
  return root;
}
