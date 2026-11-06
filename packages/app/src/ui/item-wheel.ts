/**
 * The registered-item wheel (packages/menus item-wheel.ts; the OpenSinnoh option `itemWheel`, not a DS screen): up to
 * four item windows about the field's centre, each toward its d-pad direction (contracts WHEEL_DIRECTIONS), drawn as
 * the game draws its own windows: the ROM's field frame, item icon and font, the DS menus' cursor band.
 */
import { WHEEL_DIRECTIONS, type ItemWheelView } from '@opensinnoh/contracts';
import type { DrawContext } from './apps.ts';
import { framed, stop } from './apps.ts';
import { el } from './core.ts';
import { S } from '../strings/index.ts';

export function itemWheel(d: DrawContext, v: ItemWheelView): HTMLElement {
  const root = el('div', 'item-wheel');
  root.setAttribute('aria-label', S.aria.registeredItems);
  v.items.forEach((it, i) => {
    const slot = stop(d, `item:${i}`, [el('span', 'wheel-icon', d.art.itemIcon(it.item, true)), d.text(it.name)], 'wheel-item', v.cursor === i);
    const win = framed(d, `wheel-slot wheel-${WHEEL_DIRECTIONS[i]}`, slot);
    root.append(win);
  });
  return root;
}
