/**
 * The contest app (contracts `ContestView`; packages/menus contest/ owns the flow): DS windows on one 256×192 board over
 * the faded field, in the ROM's field frame and font. The heading window (rank and type), the round's own view (the
 * placeholder rounds: a message box; the round lanes add theirs here), the results table (each entry's trainer and
 * Pokémon, the points of each announced round, the total and the place) and the message box. Taps: `next`.
 */
import type { ContestPlaceholderRoundView, ContestView } from '@opensinnoh/contracts';
import { framed, messageBox, type DrawContext } from './apps.ts';
import { atTiles, board, boardContext } from './board.ts';
import { el } from './core.ts';
import { contestVisual } from './contest-visual.ts';
import './contest.css';

/** The message box's tiles, as the field's (decomp 2, 19, 27 × 4 in its frame). */
const MESSAGE_TILES = [1, 18, 30, 6] as const;

export function contest(wide: DrawContext, v: ContestView): HTMLElement {
  // The visual round draws its own screens (contest-visual.ts).
  if (v.round && !v.round.placeholder && v.round.round === 'visual') return contestVisual(wide, v.round);
  const d = boardContext(wide);
  const root = board('mart mart-board contest-board');
  root.append(atTiles(framed(d, 'contest-heading', el('div', 'contest-rank', d.text(v.heading.rank)), el('div', 'contest-type', d.text(v.heading.type))), 1, 1, 30, 4));
  if (v.results) {
    const r = v.results;
    const head = el('div', 'contest-row contest-head', el('span', 'contest-who'), ...r.headings.map((h) => el('span', 'contest-cell', d.text(h))));
    const rows = r.rows.map((row) => {
      // One line a row (the board has room for the heading, the column titles and four rows): the entry and trainer; the Pokémon is in the view for the round lanes' screens.
      const who = el('span', 'contest-who', d.text(`${row.entry} ${row.trainer}`));
      const cells = [...row.points, row.total].map((p) => el('span', 'contest-cell', d.text(p === null ? '' : String(p))));
      const line = el('div', `contest-row${row.player ? ' is-player' : ''}`, who, ...cells);
      if (row.place !== null) line.dataset.place = String(row.place + 1);
      if (row.place === 0) line.classList.add('is-winner');
      return line;
    });
    root.append(atTiles(framed(d, 'contest-results', head, ...rows), 1, 5, 30, 13));
  }
  if (v.round?.placeholder) root.append(round(d, v.round));
  if (v.message) root.append(atTiles(messageBox(d, v.message.text, v.message.waiting), ...MESSAGE_TILES));
  return root;
}

/** A round's view. The placeholder rounds are a message box only. */
function round(d: DrawContext, r: ContestPlaceholderRoundView): HTMLElement {
  const box = atTiles(messageBox(d, r.message.text, r.message.waiting), ...MESSAGE_TILES);
  box.dataset.round = r.round;
  box.dataset.placeholder = '';
  return box;
}
