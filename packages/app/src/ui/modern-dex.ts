/**
 * The Modern Pokédex (modern.ts). The list: every row of the view (number, name, the caught mark), the cursor's row
 * kept in the middle as the DS's wheel keeps it, and the species under it beside the list (tap the picture, or the row
 * again, to open it). An entry: the Pokémon on the left (picture, category, types, height, weight, footprint), its page
 * on the right under a pager; AREA, CRY and SIZE are the DS's own screens (dex.ts `dexPageBoard`) in the window. The
 * search: a row per filter, ◀ value ▶. The same `PokedexView`, taps and keys as dex.ts.
 */
import { h, icon } from '@opensinnoh/ui';
import type { PokedexEntryView, PokedexListView, PokedexSearchView, PokedexView } from '@opensinnoh/contracts';
import { ICON_ANIM } from './art.ts';
import { stop, type DrawContext } from './apps.ts';
import { dexPageBoard } from './dex.ts';
import { fields, footButton, gameText, item, line, screen, tapButton, typeMark } from './modern.ts';
import { FRONT_SCALE } from './modern-party.ts';
import { pictureScale } from './modern-summary.ts';
import { animCell } from './sprites.ts';
import { S } from '../strings/index.ts';

/** The caught mark (`pokedex/body_shapes` animation 1, a ball) at a whole scale; null without the art. */
function caughtMark(d: DrawContext, scale = FRONT_SCALE): HTMLElement | null {
  const cell = animCell(d, 'pokedex/body_shapes', 1);
  if (cell === null) return null;
  const mark = h('span', 'mm-caught', d.art.cells('pokedex/body_shapes', [cell], scale)!);
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

/** A species' front picture, or the DS's unseen picture for an unseen row. */
function picture(d: DrawContext, species: PokedexListView['rows'][number]['species'], form: number, female: boolean, scale: number): HTMLElement {
  if (!species) return h('span', 'mm-pic', d.art.cells('pokedex/unseen_icon', [0], scale) ?? h('span'));
  return h('span', 'mm-pic', d.art.pokemonFront(species, form, false, female, scale, false) ?? d.art.pokemonIcon(species, form, ICON_ANIM.hpMax, false));
}

function list(d: DrawContext, v: PokedexListView): HTMLElement {
  const rows = v.rows.map((r, i) => {
    const b = item(d, `row:${i}`, [h('span', 'os-num mm-dexno', r.number), line(`lab${r.species ? '' : ' off'}`, r.name), r.caught ? (caughtMark(d, 1) ?? h('span')) : h('span')], 'mm-dexrow', i === v.cursor);
    if (r.species) b.dataset.species = r.species;
    return b;
  });
  const l = h('div', 'os-list mm-list mm-dexlist', ...rows);
  // The DS's wheel keeps the cursor's row in the middle (focus.ts scrollToCursor).
  l.dataset.scrolls = 'center';
  l.setAttribute('aria-label', v.title);
  return l;
}

function listDetail(d: DrawContext, v: PokedexListView): Node[] {
  const r = v.rows[v.cursor];
  if (!r) return [];
  const pic = picture(d, r.species, r.form, false, pictureScale(d));
  const open = r.species ? tapButton(d, 'open', [pic], 'mm-dexopen', r.name) : pic;
  return [h('div', 'mm-hero mm-sumhero', h('div', 'mm-picrow', open), h('div', 'mm-id', h('div', 'mm-nl', line('lab', r.name), r.caught ? caughtMark(d) : null), h('span', 'os-num mm-lv', r.number)))];
}

function drawList(d: DrawContext, v: PokedexListView): HTMLElement {
  const counts = v.counts.map((c) => h('span', 'os-num mm-count', ...gameText(`${c.label} ${c.value}`)));
  const one = (s: string) => s.replace(/\s*\n\s*/g, ' ');
  const actions = [v.searchLabel ? tapButton(d, 'search', [icon('search'), ...gameText(one(v.searchLabel))]) : null, v.switchLabel ? tapButton(d, 'switch', [icon('sort'), ...gameText(one(v.switchLabel))]) : null].filter((n): n is HTMLButtonElement => !!n);
  const root = screen(`mm-dex mm-dex-list${v.national ? ' national' : ''}`, v.title, 'world', 'dex', [list(d, v)], listDetail(d, v), [...actions, footButton(d, 'quit', v.quitLabel, false)], [], counts);
  return root;
}

/** The pager over an entry's pages: the enabled ones, in order (the DS's tabs). */
function pager(d: DrawContext, v: PokedexEntryView): HTMLElement {
  const at = v.pages.findIndex((p) => p.id === v.page);
  const enabled = v.pages.map((p, i) => (p.enabled ? i : -1)).filter((i) => i >= 0);
  const title = h('h3', 'mm-pagetitle', ...gameText(v.pages[at]!.label));
  title.setAttribute('aria-live', 'polite');
  if (enabled.length < 2) return h('div', 'mm-pager', title);
  const k = enabled.indexOf(at);
  const step = (by: 1 | -1) => tapButton(d, `page:${enabled[(k + by + enabled.length) % enabled.length]}`, [icon(by < 0 ? 'left' : 'right')], 'os-btn icon mm-pagestep', (by < 0 ? S.ui.previous : S.ui.next)(S.modern.page));
  return h('div', 'mm-pager', step(-1), title, h('span', 'os-num mm-pagecount', `${k + 1}/${enabled.length}`), step(1));
}

/** The DS screen's whole scale for a page in the window: twice where the room has it. */
const boardUnit = (d: DrawContext) => {
  const room = d.size ?? { width: innerWidth, height: innerHeight };
  return !d.compact && room.width >= 1000 && room.height >= 640 ? 2 : 1;
};

function entryPage(d: DrawContext, v: PokedexEntryView): Node[] {
  if (v.page === 'info') return v.description ? [h('p', 'mm-desc', ...gameText(v.description))] : [];
  if (v.page === 'forms') {
    const f = v.forms!;
    const rows = f.list.map((o, i) => item(d, `form:${i}`, [line('lab', o.label)], 'mm-action', i === f.cursor));
    return [h('p', 'mm-prompt-line', ...gameText(f.prompt)), h('div', 'os-list mm-forms', ...rows)];
  }
  return [h('div', 'mm-dexboard', dexPageBoard(d, v, boardUnit(d)))];
}

function drawEntry(d: DrawContext, v: PokedexEntryView): HTMLElement {
  const sel = v.forms?.list[v.forms.cursor];
  const steps = [tapButton(d, 'prev', [icon('up')], 'os-btn icon', S.aria.previous), tapButton(d, 'next', [icon('down')], 'os-btn icon', S.aria.next)];
  // The footprint (16 × 16), at the pictures' scale.
  const print = v.footprint ? h('span', 'mm-foot') : null;
  if (print && v.footprint) {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    c.setAttribute('aria-hidden', 'true');
    void d.art.image(v.footprint).then((img) => c.getContext('2d')!.drawImage(img, 0, 0));
    print.append(c);
  }
  const hero = h(
    'div',
    'mm-hero mm-sumhero',
    h('div', 'mm-picrow', picture(d, v.species, sel?.form ?? v.form, sel?.female ?? v.female, pictureScale(d)), h('div', 'mm-monsteps', ...steps)),
    h(
      'div',
      'mm-id',
      h('div', 'mm-nl', line('lab', v.name), v.caught ? caughtMark(d) : null, h('span', 'os-num mm-lv', v.number)),
      line('mm-species', v.category),
      v.types.length ? h('div', 'mm-nl mm-wrap', ...v.types.map((t) => typeMark(d, t, d.registries.types.get(t)?.name ?? ''))) : null,
      h('div', 'mm-nl', fields([v.height, v.weight]), print),
    ),
  );
  const body = h('div', 'mm-page is-cursor', ...entryPage(d, v));
  body.tabIndex = 0;
  body.dataset.scrolls = '';
  body.dataset.page = v.page;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', v.pages.find((p) => p.id === v.page)!.label);
  if (v.page === 'forms') body.classList.remove('is-cursor');
  return screen(`mm-dex mm-sum mm-dex-entry`, `${v.number} ${v.name}`, 'world', 'dex', [hero], [pager(d, v), body], [footButton(d, 'back', S.ui.back, false)], []);
}

function drawSearch(d: DrawContext, v: PokedexSearchView): HTMLElement {
  const rows = v.rows.map((r, i) => {
    const n = r.options.length;
    const k = r.value;
    const type = (r.id === 'type1' || r.id === 'type2') && k > 0 ? v.types[k] : null;
    const shapeCell = r.id === 'shape' && k > 0 ? d.art.sheet('pokedex/shapes')?.names?.indexOf(`shape_${v.shapes[k]}`) : undefined;
    const shape = shapeCell !== undefined && shapeCell >= 0 ? d.art.cells('pokedex/shapes', [shapeCell], FRONT_SCALE) : null;
    const value = type ? typeMark(d, type, d.registries.types.get(type)?.name ?? r.options[k]!) : shape ? h('span', 'mm-shape', shape) : line('lab', r.options[k]!);
    if (shape) {
      value.setAttribute('role', 'img');
      value.setAttribute('aria-label', S.aria.bodyShape(v.shapes[k]! + 1));
    }
    const arrow = (by: -1 | 1) => tapButton(d, `${r.id}:${(k + by + n) % n}`, [icon(by < 0 ? 'left' : 'right')], 'os-btn icon mm-pagestep', by < 0 ? S.aria.previousOption : S.aria.nextOption);
    const row = h('div', `os-item mm-searchrow${i === v.cursor ? ' is-cursor' : ''}`, h('span', 'cur', icon('cursor')), line('lab', r.label), h('span', 'mm-searchvalue', arrow(-1), h('span', 'mm-searchchoice', value), arrow(1)));
    row.dataset.row = r.id;
    // The cursor's row holds the focus, so Space is the game's A (it steps to the next row).
    if (i === v.cursor) row.tabIndex = 0;
    return row;
  });
  const ok = stop(d, 'ok', gameText(v.ok), 'os-btn primary big', v.cursor === v.rows.length);
  const list = h('div', 'os-list mm-search', ...rows);
  return screen('mm-dex mm-dex-search', v.title, 'world', 'search', [list], [h('p', 'mm-desc', ...gameText(v.message ?? v.description))], [ok, footButton(d, 'back', S.ui.back, false)], []);
}

/** What of the list view this drawing shows: all but the wheel's position between rows (it moves every frame). */
export const dexDrawn = (v: PokedexView): PokedexView => (v.screen === 'list' ? { ...v, scrollPosition: 0 } : v);

export function modernDex(d: DrawContext, v: PokedexView): HTMLElement {
  if (v.screen === 'list') return drawList(d, v);
  return v.screen === 'entry' ? drawEntry(d, v) : drawSearch(d, v);
}
