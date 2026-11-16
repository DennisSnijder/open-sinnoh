/**
 * The Modern PC (modern.ts): the box beside the Pokémon under the cursor. Left, the box's name between its arrows (the
 * header, a cursor stop), the 6 × 5 grid and the party as one column beside it (as the game's cursor walks it); right,
 * the preview (front picture, name, level, types, nature, item, ability, marks), the action window, the markings or
 * compare mode's two sides. The same `StorageView`, modes and taps as storage.ts; the d-pad reaches the game as is.
 */
import { genderMark, h, icon } from '@opensinnoh/ui';
import type { BoxMonView, StorageCompare, StorageView } from '@opensinnoh/contracts';
import { ICON_ANIM } from './art.ts';
import { stop, type DrawContext } from './apps.ts';
import { actionsInSheet, actionsPane, actionsSheet, promptSheet, fields, footButton, gameText, item, line, prompts, screen, tapButton, typeMark } from './modern.ts';
import { FRONT_SCALE } from './modern-party.ts';
import { baseText } from './strings.ts';
import { S } from '../strings/index.ts';

/** The six box marks, in bit order (circle, triangle, square, heart, star, diamond): `box/markings` cell i on, 6 + i off. */
const MARKS = 6;
const markCell = (markings: number, i: number) => ((markings >> i) & 1 ? i : MARKS + i);
/** CONDITION's words for compare mode's contest page (the DS's page names them in its art). */
const CONDITIONS = ['ContestCommon_Text_Cool', 'ContestCommon_Text_Beauty', 'ContestCommon_Text_Cute', 'ContestCommon_Text_Smart', 'ContestCommon_Text_Tough'];

function monIcon(d: DrawContext, m: BoxMonView): HTMLElement {
  return d.art.pokemonIcon(m.species, m.form, ICON_ANIM.hpMax, m.egg);
}

/** A box or party cell: the icon, the held item's mark, the Pokémon in hand over the cursor's cell. */
function cell(d: DrawContext, v: StorageView, id: string, m: BoxMonView | null, cursor: boolean, label: string): HTMLButtonElement {
  const hand = cursor && (v.held || v.heldItem) ? h('span', 'mm-hand', v.held ? monIcon(d, v.held) : d.art.itemIcon(v.heldItem!)) : null;
  const b = stop(d, id, [m ? monIcon(d, m) : h('span'), m?.heldItem ? h('span', 'mm-held', icon('bag', 16, S.modern.heldItem)) : null, hand].filter((n): n is HTMLElement => !!n), `mm-cell${m ? ' filled' : ''}`, cursor);
  b.tabIndex = cursor ? 0 : -1;
  b.setAttribute('aria-label', label);
  if (m) b.dataset.species = m.species;
  return b;
}

function header(d: DrawContext, v: StorageView): HTMLElement {
  const name = stop(d, 'header', [...gameText(v.box.name), h('span', 'os-num mm-boxcount', v.box.count)], 'mm-boxname', v.area === 'header');
  name.tabIndex = v.area === 'header' ? 0 : -1;
  return h('div', 'mm-boxhead', tapButton(d, 'box:-1', [icon('left')], 'os-btn icon mm-boxstep', S.aria.previousBox), name, tapButton(d, 'box:1', [icon('right')], 'os-btn icon mm-boxstep', S.aria.nextBox));
}

function box(d: DrawContext, v: StorageView): HTMLElement {
  const grid = h('div', 'mm-box', ...v.slots.map((m, i) => cell(d, v, `slot:${i}`, m, v.area === 'box' && v.cursor === i, m ? speciesName(d, m) : S.modern.emptySlot(i + 1))));
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', v.box.name);
  const party = v.partyOpen ? h('div', 'mm-boxparty', ...v.party.map((m, i) => cell(d, v, `party:${i}`, m, v.area === 'party' && v.cursor === i, m ? speciesName(d, m) : S.modern.emptySlot(i + 1)))) : null;
  if (party) {
    party.setAttribute('role', 'group');
    party.setAttribute('aria-label', v.partyButton);
  }
  return h('div', `mm-boxarea${party ? ' with-party' : ''}`, grid, party);
}

const speciesName = (d: DrawContext, m: BoxMonView) => d.registries.species.get(m.species)!.name;

/** The six marks as the game draws them (`box/markings`), named for a screen reader; squares without the art. */
function marks(d: DrawContext, markings: number): HTMLElement {
  const names = S.modern.marks;
  const row = h(
    'span',
    'mm-marks',
    ...Array.from({ length: MARKS }, (_, i) => {
      const art = d.art.cells('box/markings', [markCell(markings, i)], FRONT_SCALE);
      return art ?? h('span', `mm-markcss${(markings >> i) & 1 ? ' on' : ''}`);
    }),
  );
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', names.filter((_, i) => (markings >> i) & 1).join(', ') || S.aria.noMarks);
  return row;
}

function preview(d: DrawContext, v: StorageView): Node[] {
  const p = v.preview;
  if (!p) return [h('p', 'mm-empty', ...gameText(v.box.name)), h('p', 'mm-prompt-line', S.modern.nothingHere)];
  const front = d.compact ? null : d.art.pokemonFront(p.mon.species, p.mon.form, p.shiny, p.gender === 'female', FRONT_SCALE, p.mon.egg);
  const named = p.gender === 'none' || /[♂♀]/.test(p.name) ? null : genderMark(p.gender);
  return [
    h(
      'div',
      'mm-hero',
      h('span', 'mm-pic', front ?? monIcon(d, p.mon)),
      h(
        'div',
        'mm-id',
        h('div', 'mm-nl', line('lab', p.name || p.species), named, p.level ? h('span', 'os-num mm-lv', p.level) : null),
        p.name && p.name !== p.species ? line('mm-species', p.species) : null,
        p.types.length ? h('div', 'mm-nl mm-wrap', ...p.types.map((t) => typeMark(d, t, d.registries.types.get(t)?.name ?? ''))) : null,
        marks(d, p.markings),
      ),
    ),
    p.fields.length ? fields(p.fields) : null,
  ].filter((n): n is HTMLElement => !!n);
}

/** The markings window: the six marks (A toggles one), then CONFIRM and CANCEL. */
function markRows(d: DrawContext, m: NonNullable<StorageView['marking']>): HTMLElement[] {
  const rows = Array.from({ length: MARKS }, (_, i) => {
    const art = d.art.cells('box/markings', [markCell(m.markings, i)], FRONT_SCALE) ?? h('span', `mm-markcss${(m.markings >> i) & 1 ? ' on' : ''}`);
    const b = item(d, `mark:${i}`, [art, h('span', 'lab', S.modern.marks[i]!)], 'mm-action mm-markrow', m.cursor === i);
    b.setAttribute('aria-pressed', String(((m.markings >> i) & 1) === 1));
    return b;
  });
  return [...rows, item(d, 'mark:6', [line('lab', m.confirm)], 'mm-action', m.cursor === 6), item(d, 'mark:7', [line('lab', m.cancel)], 'mm-action', m.cursor === 7)];
}

function marking(d: DrawContext, m: NonNullable<StorageView['marking']>): HTMLElement {
  const list = h('div', 'os-list mm-actions mm-prompt', ...markRows(d, m));
  list.setAttribute('role', 'menu');
  list.dataset.scrolls = '';
  return list;
}

/** Compare mode: both sides' names and icons, the page's rows, SET ON LEFT / RIGHT and the next page. */
function compare(d: DrawContext, c: StorageCompare): HTMLElement {
  const labels = c.page === 'contest' ? CONDITIONS.map((w) => baseText(d.registries, w)) : c.labels;
  const value = (side: StorageCompare['sides'][number], r: number) => (c.page === 'contest' ? (side?.contest ? String(side.contest[r]) : '') : (side?.values[r] ?? ''));
  const rows = c.page === 'moves' ? Math.max(...c.sides.map((s) => s?.values.length ?? 0), 0) : labels.length;
  const table = h('table', 'mm-compare');
  const head = h('tr', '', ...c.sides.map((s, i) => h('th', `side-${i}${c.live === i ? ' is-live' : ''}`, s ? h('span', 'mm-nl', monIcon(d, s.mon), line('lab', s.name)) : '-')));
  head.insertBefore(h('th'), head.children[1]!);
  table.append(head);
  for (let r = 0; r < rows; r++) {
    const label = c.page === 'moves' ? (r === 0 ? labels[0] ?? '' : '') : labels[r]!;
    table.append(h('tr', '', h('td', 'os-num', ...gameText(value(c.sides[0], r))), h('th', '', ...gameText(label)), h('td', 'os-num', ...gameText(value(c.sides[1], r)))));
  }
  const set = c.set.map((label, i) => {
    const b = tapButton(d, `compare:${i}`, gameText(label), `os-btn${c.live === i ? ' primary' : ''}`);
    if (c.live !== i) b.setAttribute('aria-disabled', 'true');
    return b;
  });
  return h('div', 'mm-comparebox', table, h('div', 'mm-nl mm-wrap', set[0]!, tapButton(d, 'compare:page', [icon('right')], 'os-btn icon', S.aria.nextComparePage), set[1]!));
}

export function modernStorage(d: DrawContext, v: StorageView): HTMLElement {
  const sheet = actionsInSheet(d);
  const right: Node[] = [];
  // "Deposit in which Box?", "Mark your Pokémon.": the game's lines while it waits for a pick, not a message box.
  const asked = v.message && !v.message.waiting ? h('p', 'mm-prompt-line', ...gameText(v.message.text)) : null;
  if (v.compare) right.push(compare(d, v.compare));
  else right.push(...preview(d, v));
  if (asked) right.push(asked);
  if (v.menu && !sheet) right.push(actionsPane(d, v.menu));
  if (v.marking && !sheet) right.push(marking(d, v.marking));
  const waiting = v.message?.waiting ? v.message : null;
  const extras = [...(v.menu && sheet ? actionsSheet(d, v.menu) : []), ...(v.marking && sheet ? promptSheet(d, markRows(d, v.marking)) : []), ...prompts(d, { message: waiting, yesNo: v.yesNo })];
  return screen(`mm-pc mm-pc-${v.mode}`, v.title, 'team', 'party', [header(d, v), box(d, v)], right, [footButton(d, 'close', v.close, false)], extras);
}
