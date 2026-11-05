/**
 * The Modern bag (modern.ts): the pockets as a rail, the pocket's items, the item under the cursor with its description
 * and action window beside them (a sheet on phones). The same `BagView`, modes and taps as bag.ts.
 */
import { h, icon, rail, type IconName } from '@opensinnoh/ui';
import type { BagView } from '@opensinnoh/contracts';
import { stop, type DrawContext } from './apps.ts';
import { actionsInSheet, actionsPane, actionsSheet, footButton, gameText, item, line, prompts, screen } from './modern.ts';

/** The DS's eight pockets, in order; the battle bag's four (HP/PP, status, balls, battle items). */
const FIELD_ICONS: IconName[] = ['bag', 'heart', 'ball', 'disc', 'berry', 'mail', 'spark', 'key'];
const BATTLE_ICONS: IconName[] = ['heart', 'heart', 'ball', 'spark'];

function pockets(d: DrawContext, v: BagView): HTMLElement {
  const icons = v.mode === 'battle' ? BATTLE_ICONS : FIELD_ICONS;
  const r = rail(v.pockets.map((label, i) => ({ label, icon: icons[i]! })), v.pocket, { label: 'Pockets', onPick: (i) => d.tap(`pocket:${i}`) });
  r.querySelectorAll<HTMLElement>('[role="tab"]').forEach((t, i) => (t.dataset.tap = `pocket:${i}`));
  return r;
}

function row(d: DrawContext, v: BagView, i: number): HTMLElement {
  const r = v.rows[i]!;
  const b = item(
    d,
    `row:${i}`,
    [d.art.itemIcon(r.item), line('lab', r.label), r.registered ? h('span', 'mm-reg', icon('star', 16, 'Registered')) : h('span'), r.count ? h('span', 'os-num', r.count) : h('span')],
    'mm-bagrow',
    v.cursor === i && !v.menu,
    v.cursor === i,
  );
  b.dataset.item = r.item;
  return b;
}

function detail(d: DrawContext, v: BagView, inline: boolean): Node[] {
  const r = v.rows[v.cursor];
  const out: Node[] = [];
  if (r) {
    out.push(h('div', 'mm-hero mm-itemhero', d.art.itemIcon(r.item, true), h('div', 'mm-id', line('lab', r.label), r.count ? h('span', 'os-num', r.count) : null)));
    out.push(h('p', 'mm-desc', ...gameText(v.description)));
  } else out.push(h('p', 'mm-prompt-line', ...gameText(v.cancel)));
  if (v.poffins) out.push(h('p', 'mm-prompt-line', ...gameText(`${v.poffins.label} ${v.poffins.value}`)));
  if (inline && v.menu) out.push(actionsPane(d, v.menu));
  return out;
}

/** TOSS: how many. The game's arrows (±1, ±10) and OK. */
function quantity(d: DrawContext, count: string): HTMLElement {
  const step = (id: string, label: string, text: string) => {
    const b = stop(d, id, gameText(text), 'os-btn', false);
    b.setAttribute('aria-label', label);
    return b;
  };
  return h('div', 'mm-qty', step('qty:-10', 'Ten fewer', '-10'), step('qty:-1', 'One fewer', '-1'), stop(d, 'ok', [h('span', 'os-num', count)], 'os-btn primary', true), step('qty:+1', 'One more', '+1'), step('qty:+10', 'Ten more', '+10'));
}

export function modernBag(d: DrawContext, v: BagView): HTMLElement {
  const rows = v.rows.map((_, i) => row(d, v, i));
  const list = h('div', 'os-list mm-list', ...rows);
  if (!rows.length) list.append(h('p', 'mm-empty', 'Nothing in this pocket.'));
  list.dataset.scrolls = '';
  const sheet = actionsInSheet(d);
  const extras = [...(v.menu && sheet ? actionsSheet(d, v.menu) : []), ...prompts(d, v, v.quantity ? quantity(d, v.quantity.count) : undefined)];
  return screen(`mm-bag mm-${v.mode}`, v.title, 'items', 'bag', [pockets(d, v), list], detail(d, v, !sheet), [footButton(d, 'cancel', v.cancel, v.cursor === v.rows.length && !v.menu)], extras);
}
