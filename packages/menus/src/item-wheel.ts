/**
 * The registered-item wheel (OpenSinnoh option `itemWheel`, the classic-remake idea of HGSS's and later games' Y
 * menus; not a DS screen): opened by Y held on the idle field, over `GameState.registeredWheel`. A d-pad direction
 * picks the item placed that way (WHEEL_DIRECTIONS); letting go of Y with an item picked uses it, as does A or a tap
 * on it; B closes. Letting go of Y with nothing picked leaves the wheel open for a tap.
 */
import { WHEEL_DIRECTIONS, type InputFrame, type ItemWheelView } from '@opensinnoh/contracts';
import { menuSe, type MenuContext } from './context.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';

export function itemWheelScreen(ctx: MenuContext): Screen {
  const items = [...(ctx.state.registeredWheel ?? [])];
  if (!items.length) throw new Error('item wheel: no registered items');
  let cursor: number | null = null;
  /** Y is still held from the press that opened the wheel. */
  let yHeld = true;
  const use = (i: number): Step => {
    menuSe(ctx, 1500);
    return { close: { app: 'item-wheel', item: items[i]! } };
  };
  return {
    tick(f: InputFrame): Step {
      if (!yHeld || f.held.includes('y')) return;
      yHeld = false;
      if (cursor !== null) return use(cursor);
      return;
    },
    view: (): ItemWheelView => ({
      app: 'item-wheel',
      items: items.map((item) => ({ item, name: ctx.registries.items.get(item)!.name })),
      cursor,
    }),
    input(i): Step {
      if ('tap' in i) {
        if (i.tap === 'back') return { close: { app: 'item-wheel', item: null } };
        const n = tapIndex(i.tap, 'item');
        return n !== null && n >= 0 && n < items.length ? use(n) : undefined;
      }
      const b = i.button;
      const slot = WHEEL_DIRECTIONS.indexOf(b as (typeof WHEEL_DIRECTIONS)[number]);
      if (slot >= 0 && slot < items.length && slot !== cursor) {
        menuSe(ctx, 1500);
        cursor = slot;
      } else if (b === 'a' && cursor !== null) return use(cursor);
      else if (b === 'b') {
        menuSe(ctx, 1500);
        return { close: { app: 'item-wheel', item: null } };
      }
      return;
    },
  };
}
