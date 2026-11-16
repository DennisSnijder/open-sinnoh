/**
 * The Modern summary (modern.ts): the Pokémon beside its page. Left, the front picture, name, level, status, types,
 * held item and ball; right, the page (INFO, TRAINER MEMO, SKILLS, CONDITION, BATTLE MOVES, RIBBONS) under a pager.
 * The same `SummaryView`, modes and taps as summary.ts: left and right turn the page, up and down change the Pokémon,
 * A picks a move or ribbon. On a phone the Pokémon is a row over the page.
 */
import { genderMark, h, hpBar, icon } from '@opensinnoh/ui';
import type { SummaryView } from '@opensinnoh/contracts';
import { ICON_ANIM, hpColor } from './art.ts';
import { stop, type DrawContext } from './apps.ts';
import { fields, footButton, gameText, item, line, prompts, screen, tapButton, typeMark } from './modern.ts';
import { FRONT_SCALE, statusMark } from './modern-party.ts';
import { baseText, levelMark } from './strings.ts';
import { S } from '../strings/index.ts';

const BAND = { max: 'high', green: 'high', yellow: 'mid', red: 'low' } as const;
/** CONDITION's axes, clockwise from the top as the DS draws them: the ROM's contest words. */
const CONDITIONS = ['ContestCommon_Text_Cool', 'ContestCommon_Text_Beauty', 'ContestCommon_Text_Cute', 'ContestCommon_Text_Smart', 'ContestCommon_Text_Tough'];
/** RIBBONS: four to a row, as the DS's cursor moves (up and down a row are four). */
const RIBBONS_PER_ROW = 4;
/** The sheen's most sparkles (decomp MAX_SHEEN_SPRITES). */
const SHEEN_MAX = 12;

/**
 * The front picture's whole scale (80 DS px a side): on a phone the height of the name's three lines, on a big screen
 * three times, between them twice.
 */
export function pictureScale(d: DrawContext): number {
  const room = d.size ?? { width: innerWidth, height: innerHeight };
  if (d.compact || room.height < 480) return 1;
  return room.height >= 700 && room.width >= 1000 ? 3 : FRONT_SCALE;
}

function hero(d: DrawContext, v: SummaryView, steps: HTMLElement[]): HTMLElement {
  const m = v.mon;
  const pic = d.art.pokemonFront(m.species, m.form, m.shiny, m.gender === 'female', pictureScale(d), m.egg);
  const ballName = d.registries.items.get(m.ball)?.name;
  const ballArt = d.art.sheet('summary/balls') ? d.art.cells('summary/balls', [m.ball.slice(m.ball.indexOf(':') + 1)], FRONT_SCALE) : null;
  const ball = ballArt ? h('span', 'mm-ball', ballArt) : null;
  if (ball && ballName) {
    ball.setAttribute('role', 'img');
    ball.setAttribute('aria-label', ballName);
  }
  const named = m.gender === 'none' || /[♂♀]/.test(m.name) ? null : genderMark(m.gender);
  return h(
    'div',
    'mm-hero mm-sumhero',
    h('div', 'mm-picrow', h('span', 'mm-pic', pic ?? d.art.pokemonIcon(m.species, m.form, ICON_ANIM.hpMax, m.egg)), steps.length ? h('div', 'mm-monsteps', ...steps) : null),
    h(
      'div',
      'mm-id',
      h('div', 'mm-nl', ball, line('lab', m.name), named),
      h('div', 'mm-nl mm-wrap', m.egg ? null : h('span', 'os-num mm-lv', `${levelMark(d.registries)}${m.level}`), statusMark(d, m.status, m.egg), ...v.info.types.map((t) => typeMark(d, t.id, t.name))),
      fields([m.item], 'mm-helditem'),
    ),
  );
}

/** The page's name with the previous and next page beside it (the tabs of the DS); one page: the name alone. */
function pager(d: DrawContext, v: SummaryView): HTMLElement {
  const at = v.pages.findIndex((p) => p.id === v.page);
  const title = h('h3', 'mm-pagetitle', ...gameText(v.pages[at]!.label));
  title.setAttribute('aria-live', 'polite');
  if (v.mode !== 'view' || v.pages.length < 2) return h('div', 'mm-pager', title);
  const step = (by: 1 | -1) => {
    const to = v.pages[(at + by + v.pages.length) % v.pages.length]!;
    return tapButton(d, `page:${to.id}`, [icon(by < 0 ? 'left' : 'right')], 'os-btn icon mm-pagestep', (by < 0 ? S.ui.previous : S.ui.next)(S.modern.page));
  };
  return h('div', 'mm-pager', step(-1), title, h('span', 'os-num mm-pagecount', `${at + 1}/${v.pages.length}`), step(1));
}

function info(d: DrawContext, v: SummaryView): Node[] {
  const types = v.info.types.map((t) => typeMark(d, t.id, t.name));
  // The TYPE row has no value: the DS draws its icons there.
  const rows = v.info.fields.map((f) => ({ label: f.label, value: f.value || (types.length ? types : '') }));
  const exp = h('span', 'mm-exp', h('i'));
  (exp.firstChild as HTMLElement).style.width = `${Math.round(v.info.exp * 100)}%`;
  exp.setAttribute('aria-hidden', 'true');
  return [fields(rows), exp, v.info.rename ? tapButton(d, 'rename', gameText(v.info.rename), 'os-btn mm-pagebtn') : null].filter((n): n is HTMLElement => !!n);
}

function skills(d: DrawContext, v: SummaryView): Node[] {
  const s = v.skills;
  const stats = !s.values || s.values.mode === 'stats';
  const hp = stats ? [hpBar(s.hpNow, s.hpMax, BAND[hpColor(s.hpNow, s.hpMax)])] : s.hp.value;
  const nature = (n: 'up' | 'down' | null) => (n ? h('span', `mm-nature ${n}`, icon(n, 16, n === 'up' ? S.modern.natureUp : S.modern.natureDown)) : null);
  const rows = [{ label: s.hp.label, value: hp }, ...s.stats.map((st) => ({ label: [...gameText(st.label), ...[nature(st.nature)].filter((n): n is HTMLElement => !!n)], value: [h('span', 'os-num', st.value)] }))];
  return [
    fields(rows, 'mm-stats'),
    fields([{ label: s.ability.label, value: s.ability.value }]),
    h('p', 'mm-desc', ...gameText(s.abilityDescription)),
    s.values && !v.mon.egg ? tapButton(d, 'values', gameText(s.values.label), 'os-btn mm-pagebtn') : null,
  ].filter((n): n is HTMLElement => !!n);
}

/** The spider graph (cool, beauty, cute, smart, tough from the top, clockwise), growing from `from` as the DS's does. */
function graph(d: DrawContext, v: SummaryView): SVGSVGElement {
  const k = v.condition;
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '-100 -100 200 200');
  svg.setAttribute('class', 'mm-graph');
  const corner = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))].join(',');
  };
  const poly = (points: string, className: string) => {
    const p = document.createElementNS(ns, 'polygon');
    p.setAttribute('points', points);
    p.setAttribute('class', className);
    svg.append(p);
  };
  poly([0, 1, 2, 3, 4].map((i) => corner(i, 70)).join(' '), 'rim');
  poly([0, 1, 2, 3, 4].map((i) => corner(i, 35)).join(' '), 'mid');
  const step = k.graph / 4;
  poly(k.values.map((to, i) => corner(i, 6 + (64 * (k.from[i]! + (to - k.from[i]!) * step)) / 255)).join(' '), 'value');
  const words = CONDITIONS.map((w) => baseText(d.registries, w));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', words.map((w, i) => `${w} ${k.values[i]}`).join(', '));
  return svg;
}

function condition(d: DrawContext, v: SummaryView): Node[] {
  const k = v.condition;
  const words = CONDITIONS.map((w) => baseText(d.registries, w));
  const raised = (i: number) => (k.arrows[i] ? h('span', 'mm-nature up', icon('up', 16, S.modern.raised)) : null);
  const rows = words.map((w, i) => ({ label: [...gameText(w), ...[raised(i)].filter((n): n is HTMLElement => !!n)], value: [h('span', 'os-num', String(k.values[i]))] }));
  const sheen = h('span', 'mm-sheen', ...Array.from({ length: SHEEN_MAX }, (_, i) => h('i', i < k.sheen ? 'on' : '')));
  sheen.setAttribute('role', 'img');
  sheen.setAttribute('aria-label', `${k.sheen}/${SHEEN_MAX}`);
  const out: Node[] = [h('div', 'mm-cond', graph(d, v), fields(rows)), h('div', 'mm-nl', line('lab', k.sheenLabel), sheen)];
  if (k.flavor) out.push(fields([{ label: k.flavor.label, value: k.flavor.text }]));
  if (k.prompt) out.push(stop(d, 'ok', gameText(k.prompt), 'os-btn primary mm-pagebtn', true));
  return out;
}

function moves(d: DrawContext, v: SummaryView): Node[] {
  const m = v.moves;
  const pp = baseText(d.registries, 'PokemonSummary_Text_LabelPp');
  const rows: HTMLElement[] = m.rows.map((r, i) => {
    const b = item(d, `move:${i}`, [line('lab', r.name), typeMark(d, r.type, d.registries.types.get(r.type)?.name ?? ''), h('span', 'os-num mm-pp', `${pp} ${r.pp}`)], `mm-move${r.isNew ? ' is-new' : ''}${m.swapping === i ? ' is-moving' : ''}`, m.cursor === i);
    b.dataset.move = r.move;
    return b;
  });
  // Empty slots (decomp PrintMoveNameAndPP with MOVE_NONE): the name and "--", nothing to pick.
  for (let i = m.rows.length; i < 4; i++) rows.push(h('div', 'mm-move mm-move-empty', h('span'), line('lab', m.empty.name), h('span'), h('span', 'os-num mm-pp', m.empty.pp)));
  const list = h('div', 'os-list mm-moves', ...rows);
  const out: Node[] = [list];
  const dt = m.detail;
  if (dt) {
    out.push(
      h('div', 'mm-movedetail', h('div', 'mm-nl', typeMark(d, dt.category, dt.categoryName), line('lab', dt.categoryName)), fields([dt.power, dt.accuracy]), h('p', 'mm-desc', ...gameText(dt.description))),
    );
  }
  return out;
}

function ribbons(d: DrawContext, v: SummaryView): Node[] {
  const r = v.ribbons;
  const scale = d.compact ? 1 : 2;
  const grid = h(
    'div',
    'mm-ribbons',
    ...r.list.map((x, i) => {
      const art = d.art.cells('summary/ribbons', [x.ribbon], scale);
      const b = stop(d, `ribbon:${i}`, art ? [art] : gameText(x.name.slice(0, 2)), 'mm-ribbon', r.cursor === i);
      b.setAttribute('aria-label', x.name);
      b.title = x.name;
      return b;
    }),
  );
  grid.style.setProperty('--per-row', String(RIBBONS_PER_ROW));
  const out: Node[] = [fields([r.count])];
  if (r.list.length) out.push(grid);
  if (r.detail) out.push(h('div', 'mm-movedetail', h('div', 'mm-nl', line('lab', r.detail.name), h('span', 'os-num', r.detail.index)), h('p', 'mm-desc', ...gameText(r.detail.description))));
  return out;
}

function page(d: DrawContext, v: SummaryView): Node[] {
  switch (v.page) {
    case 'info':
      return info(d, v);
    case 'memo':
      return v.memo.map((p) => h('p', 'mm-desc', ...gameText(p)));
    case 'skills':
      return skills(d, v);
    case 'condition':
      return condition(d, v);
    case 'moves':
      return moves(d, v);
    case 'ribbons':
      return ribbons(d, v);
  }
}

/**
 * What of the view this drawing shows: all but the sheen's frame count, which ticks every frame on CONDITION. Redrawn
 * on it, the page's buttons would be replaced under a finger between press and release.
 */
export const summaryDrawn = (v: SummaryView): SummaryView => ({ ...v, condition: { ...v.condition, sheenFrame: 0 } });

export function modernSummary(d: DrawContext, v: SummaryView): HTMLElement {
  const choosing = v.moves.cursor !== null || v.ribbons.cursor !== null;
  // The DS's hint is the A button's word (INFO, SWITCH, CANCEL) but for the forget-a-move question, which is a sentence.
  const hint = v.mode === 'teach' ? v.moves.hint : '';
  // With nothing picked, the page holds the cursor: the d-pad and A go to the game from it.
  const body = h('div', `mm-page${!choosing && !v.condition.prompt ? ' is-cursor' : ''}`, ...page(d, v));
  body.tabIndex = 0;
  body.dataset.scrolls = '';
  body.dataset.page = v.page;
  body.setAttribute('role', 'region');
  body.setAttribute('aria-label', v.pages.find((p) => p.id === v.page)!.label);
  const right = [pager(d, v), hint ? h('p', 'mm-prompt-line', ...gameText(hint)) : null, body].filter((n): n is HTMLElement => !!n);
  const steps = (v.mode === 'view' || v.mode === 'feed') && !choosing ? [tapButton(d, 'prev', [icon('up')], 'os-btn icon', S.aria.previousMon), tapButton(d, 'next', [icon('down')], 'os-btn icon', S.aria.nextMon)] : [];
  return screen(`mm-sum mm-sum-${v.mode}`, v.mon.name, 'team', 'party', [hero(d, v, steps)], right, [footButton(d, 'back', S.ui.back, false)], prompts(d, { message: v.message, yesNo: null }));
}
