/**
 * The Modern party (modern.ts): the members as a list, the detail of the one under the cursor beside it, the action
 * window in the detail pane (a sheet on phones). The same `PartyView`, modes and taps as party.ts.
 *
 * The game's cursor walks a 2-column grid; this list is one column, so `partyListInput` turns up and down into the
 * presses that reach the next stop. What reaches the game is ordinary presses.
 */
import { genderMark, h, hpBar, icon, statusChip, type StatusName } from '@opensinnoh/ui';
import type { InputFrame, PartySlotView, PartyView } from '@opensinnoh/contracts';
import type { Button } from '@opensinnoh/core';
import { ICON_ANIM, hpColor } from './art.ts';
import type { DrawContext } from './apps.ts';
import { actionsInSheet, actionsPane, actionsSheet, footButton, gameText, item, line, prompts, screen } from './modern.ts';
import { S } from '../strings/index.ts';

const STATUS: Record<Exclude<PartySlotView['status'], 'none'>, StatusName> = { paralysis: 'par', freeze: 'frz', sleep: 'slp', poison: 'psn', toxic: 'psn', burn: 'brn', fainted: 'fnt' };
const BAND = { max: 'high', green: 'high', yellow: 'mid', red: 'low' } as const;

/** The front picture's scale: 80 DS px at 2 CSS px each. */
const FRONT_SCALE = 2;

const hp = (m: PartySlotView) => hpBar(m.hp, m.maxHp, BAND[hpColor(m.hp, m.maxHp)]);
const status = (m: PartySlotView) => (m.status === 'none' || m.egg ? null : statusChip(STATUS[m.status], S.modern.status[m.status === 'toxic' ? 'poison' : m.status]));
const level = (m: PartySlotView) => (m.egg ? null : h('span', 'os-num mm-lv', `${m.levelLabel}${m.level}`));
/** A name with the symbol in it (NIDORAN♂) says it already. */
const gender = (m: PartySlotView) => (m.gender === 'none' || /[♂♀]/.test(m.name) ? null : genderMark(m.gender));

function iconAnim(m: PartySlotView): number {
  if (m.egg) return ICON_ANIM.hpMax;
  if (m.status === 'fainted') return ICON_ANIM.fainted;
  if (m.status !== 'none') return ICON_ANIM.statused;
  return { max: ICON_ANIM.hpMax, green: ICON_ANIM.hpGreen, yellow: ICON_ANIM.hpYellow, red: ICON_ANIM.hpRed }[hpColor(m.hp, m.maxHp)];
}

function row(d: DrawContext, v: PartyView, i: number, m: PartySlotView): HTMLElement {
  const mark = m.heldItem ? h('span', 'mm-held', icon('bag', 16, S.modern.heldItem)) : null;
  const note = v.notes[i];
  const b = item(
    d,
    `slot:${i}`,
    [
      d.art.pokemonIcon(m.species, m.form, iconAnim(m), m.egg),
      h('span', 'mm-st', h('span', 'mm-nl', line('lab', m.name), gender(m), level(m), mark, status(m)), note ? line('mm-note', note) : m.egg ? null : hp(m)),
    ],
    `mm-slot${v.moving === i ? ' is-moving' : ''}`,
    v.cursor === i && !v.menu,
    v.cursor === i,
  );
  b.dataset.species = m.species;
  return b;
}

function picture(d: DrawContext, m: PartySlotView): HTMLElement | null {
  if (d.compact) return null;
  const front = d.art.pokemonFront(m.species, m.form, !!m.shiny, m.gender === 'female', FRONT_SCALE, m.egg);
  return h('span', 'mm-pic', front ?? d.art.pokemonIcon(m.species, m.form, ICON_ANIM.hpMax, m.egg));
}

function detail(d: DrawContext, v: PartyView, m: PartySlotView | null | undefined, inline: boolean): Node[] {
  const prompt = h('p', 'mm-prompt-line', ...gameText(v.prompt));
  const after = inline && v.menu ? actionsPane(d, v.menu) : prompt;
  if (!m) return [after];
  const heldName = m.heldItem ? d.registries.items.get(m.heldItem)?.name : null;
  const held = heldName ? h('span', 'mm-heldname', d.art.itemIcon(m.heldItem!), ...gameText(heldName)) : null;
  const note = v.notes[v.cursor];
  return [
    h(
      'div',
      'mm-hero',
      picture(d, m),
      h(
        'div',
        'mm-id',
        h('div', 'mm-nl', line('lab', m.name), gender(m), level(m)),
        note ? line('mm-note', note) : m.egg ? null : hp(m),
        h('div', 'mm-nl mm-wrap', status(m), held, m.capsule ? h('span', 'mm-heldname', icon('ball'), S.modern.capsule) : null),
      ),
    ),
    after,
  ];
}

export function modernParty(d: DrawContext, v: PartyView): HTMLElement {
  const rows = v.slots.map((m, i) => (m ? row(d, v, i, m) : h('div', 'mm-slot-empty')));
  const list = h('div', 'os-list mm-list mm-party-list', ...rows);
  list.dataset.scrolls = '';
  const sheet = actionsInSheet(d);
  const foot: HTMLElement[] = [];
  if (v.confirm) foot.push(footButton(d, 'confirm', v.confirm, v.cursor === 6 && !v.menu, true, false));
  if (v.cancel) foot.push(footButton(d, 'cancel', v.cancel, v.cursor === (v.confirm ? 7 : 6) && !v.menu));
  const extras = [...(v.menu && sheet ? actionsSheet(d, v.menu) : []), ...prompts(d, v)];
  return screen(`mm-party mm-${v.mode}`, v.title, 'team', 'party', [list], detail(d, v, v.slots[v.cursor], !sheet), foot, extras);
}

/**
 * Up and down on the one-column list while the list has the cursor: the press or presses that move the game's
 * 2-column cursor one stop. Left and right do nothing here; held directions do not repeat (six rows).
 */
export function partyListInput(frame: InputFrame, v: PartyView): InputFrame {
  if (v.menu || v.message || v.yesNo) return frame;
  const members = v.slots.filter(Boolean).length;
  const stops = members + (v.confirm ? 2 : 1);
  const at = v.cursor < 6 ? v.cursor : v.confirm ? members + v.cursor - 6 : members;
  const moves = (b: Button): Button[] => {
    if (b === 'left' || b === 'right') return [];
    if (b === 'down') {
      if (at + 1 >= stops) return [];
      if (at % 2 === 0) return ['right'];
      return at + 2 < stops ? ['down', 'left'] : ['down'];
    }
    if (b === 'up') {
      if (at === 0) return [];
      return at % 2 === 1 ? ['left'] : ['up', 'right'];
    }
    return [b];
  };
  const dpad = (b: Button) => b === 'up' || b === 'down' || b === 'left' || b === 'right';
  return { ...frame, held: frame.held.filter((b) => !dpad(b)), pressed: frame.pressed.flatMap(moves) };
}
