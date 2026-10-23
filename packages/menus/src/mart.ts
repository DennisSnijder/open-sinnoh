/**
 * The mart (decomp overlay007/shop_menu.c, MART_TYPE_NORMAL; selling is the bag app in sell mode,
 * applications/bag/main.c). BUY / SELL / SEE YA!, the stock list with prices, the quantity window
 * (up/down ±1 wrapping, right/left ±10), the confirmation and the clerk's messages. The rules live in
 * packages/services. Messages appear whole (the DS prints them); a waiting one takes A or B.
 * 0.34.0 `currency: 'bp'`, the Battle Frontier's exchange counters (MART_TYPE_FRONTIER): a YES / NO menu (no selling),
 * prices, the total and the purse in BP (Shop_GetItemBPPrice) and its own messages.
 */
import type { Button, Id } from '@opensinnoh/core';
import { canGiveItem, itemCount, type Item, type Mart, type MartView } from '@opensinnoh/contracts';
import { battlePoints, bpPrice, buy, buyWithBp, canSell, martStock, maxBuy, maxBuyBp, maxSell, sell, sellPrice } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { moveCursor, stepCount, tapIndex, type Screen, type Step } from './stack.ts';

type Input = { button: Button } | { tap: string };

type Phase =
  | { kind: 'menu' }
  | { kind: 'list' }
  /** A message waiting for A/B, page by page; then the next phase. */
  | { kind: 'message'; pages: string[]; page: number; then: () => Phase }
  | { kind: 'qty'; item: Id; count: number; max: number }
  | { kind: 'confirm'; item: Id; count: number; yes: boolean }
  | { kind: 'exit' };

const MENU = ['martBuy', 'martSell', 'martSeeYa'] as const;

export function martScreen(ctx: MenuContext, request: { mart: Id; countVar: Id | null; greeting: string | null; currency?: 'bp' }): Screen {
  const mart: Mart | undefined = ctx.registries.marts.get(request.mart);
  if (!mart) throw new Error(`mart: unknown mart ${request.mart}`);
  const t = ctx.text;
  // The stock is fixed when the mart opens (decomp ScrCmd_PokeMartCommon filters by the badge count then).
  const stock = martStock(mart, ctx.state.badges.length);
  for (const id of stock) if (!ctx.registries.items.has(id)) throw new Error(`mart ${mart.id}: unknown item ${id}`);
  let mode: 'menu' | 'buy' | 'sell' | 'exit' = 'menu';
  let phase: Phase = { kind: 'menu' };
  let menuCursor = 0;
  let menuMessage: string | null = request.greeting;
  let cursor = 0;
  let pocket = 0;
  const pockets = t.pocketIds;
  const bp = request.currency === 'bp';
  /** Decomp itemPurchaseCount and the bag's soldAmount (a new count each SELL visit): +1 per single item (to 255), 2 for more. */
  let bought = 0;
  let sold = 0;
  const tally = (n: number, count: number) => (count > 1 ? 2 : Math.min(255, n + 1));
  /** The menu: BUY / SELL / SEE YA!, or the exchange counter's YES / NO (decomp Shop_InitOptionsMenu). */
  const menuKeys = bp ? (['bpMenuYes', 'bpMenuNo'] as const) : MENU;
  const exitIndex = menuKeys.length - 1;
  const price = (id: Id) => (bp ? bpPrice(ctx.registries, id) : item(id).price);

  const item = (id: Id): Item => ctx.registries.items.get(id)!;
  const money = (n: number) => t.t('martMoneyValue', String(n));
  const rows = (): { item: Id; count: number }[] =>
    mode === 'sell' ? (ctx.state.bag[pockets[pocket]!] ?? []).map((s) => ({ item: s.item, count: s.count })) : stock.map((id) => ({ item: id, count: 0 }));
  const message = (pages: string[], then: () => Phase): Phase => ({ kind: 'message', pages, page: 0, then });
  const toList = (): Phase => ({ kind: 'list' });
  const toMenu = (): Phase => {
    mode = 'menu';
    menuMessage = t.t('martAnythingElse');
    return { kind: 'menu' };
  };
  const itemName = (id: Id, count: number) => (count > 1 ? t.text(item(id).plural) : item(id).name);

  // --- buying (Shop_SelectBuyMenu … Shop_FinishPurchase) ---
  const pickToBuy = (id: Id): Phase => {
    const max = bp ? maxBuyBp(ctx.state, ctx.registries, id) : maxBuy(ctx.state, ctx.registries, id);
    if (max === 0) return message([t.t(bp ? 'bpNotEnough' : 'martNoMoney')], toList);
    return { kind: 'qty', item: id, count: 1, max };
  };
  const confirmText = (id: Id, count: number): string => {
    const total = String(price(id) * count);
    if (mode === 'sell') return t.t('bagConfirmSell', String(sellPrice(ctx.registries, id) * count));
    const tm = item(id).tm;
    if (tm) return t.t(bp ? 'bpConfirmTm' : 'martConfirmTm', item(id).name, String(count), total, ctx.registries.moves.get(tm)!.name);
    return t.t(bp ? 'bpConfirm' : 'martConfirm', item(id).name, String(count), total);
  };
  const buyNow = (id: Id, count: number): Phase => {
    if (bp) {
      const r = buyWithBp(ctx.state, ctx.registries, id, count);
      if (!r.ok) return message([t.t(r.reason === 'money' ? 'bpNotEnough' : 'martNoRoom')], toList);
      menuSe(ctx, 1604);
      return message(t.pages('martThanks', itemName(id, count), t.pocket(item(id).pocket)), toList);
    }
    const r = buy(ctx.state, ctx.registries, id, count, request.countVar);
    if (!r.ok) return message([t.t(r.reason === 'money' ? 'martNoMoney' : 'martNoRoom')], toList);
    bought = tally(bought, count);
    const thanks = t.pages('martThanks', itemName(id, count), t.pocket(item(id).pocket));
    menuSe(ctx, 1604);
    return message(thanks, () => (r.premierBall ? message([t.t('martPremier')], toList) : toList()));
  };

  // --- selling (bag/main.c sell mode) ---
  const pickToSell = (id: Id): Phase => {
    if (!canSell(ctx.registries, id)) return message([t.t('bagCantSell', item(id).name)], toList);
    if (itemCount(ctx.state, id) === 1) return { kind: 'confirm', item: id, count: 1, yes: true };
    return { kind: 'qty', item: id, count: 1, max: maxSell(ctx.state, id) };
  };
  const sellNow = (id: Id, count: number): Phase => {
    const total = sellPrice(ctx.registries, id) * count;
    const name = itemName(id, count);
    menuSe(ctx, 1604);
    sell(ctx.state, ctx.registries, id, count);
    sold = tally(sold, count);
    const left = rows().length;
    if (cursor > left) cursor = left;
    return message([t.t('bagSold', name, String(total))], toList);
  };

  const pickRow = (row: number): Phase => {
    menuSe(ctx, 1500);
    cursor = row;
    const r = rows()[row];
    if (!r) return toMenu();
    return mode === 'sell' ? pickToSell(r.item) : pickToBuy(r.item);
  };
  const pickMenu = (i: number): Phase => {
    menuSe(ctx, 1500);
    menuCursor = i;
    if (i < exitIndex) {
      mode = i === 0 ? 'buy' : 'sell';
      if (mode === 'sell') sold = 0;
      cursor = 0;
      menuMessage = null;
      return toList();
    }
    mode = 'exit';
    return { kind: 'exit' };
  };
  const answer = (p: Extract<Phase, { kind: 'confirm' }>, yes: boolean): Phase => {
    menuSe(ctx, 1500);
    if (!yes) return toList();
    return mode === 'sell' ? sellNow(p.item, p.count) : buyNow(p.item, p.count);
  };

  const press = (b: Button): Phase | 'close' => {
    const p = phase;
    switch (p.kind) {
      case 'menu':
        if (b === 'up' || b === 'down') menuCursor = moveCursor(menuCursor, menuKeys.length, 1, b);
        else if (b === 'a') return pickMenu(menuCursor);
        else if (b === 'b') return pickMenu(exitIndex);
        return p;
      case 'list': {
        const n = rows().length;
        if (mode === 'sell' && (b === 'left' || b === 'right' || b === 'l' || b === 'r')) {
          pocket = (pocket + (b === 'left' || b === 'l' ? -1 : 1) + pockets.length) % pockets.length;
          cursor = 0;
        } else if (b === 'up' || b === 'down') cursor = moveCursor(cursor, n + 1, 1, b);
        else if (b === 'a') return pickRow(cursor);
        else if (b === 'b') return toMenu();
        return p;
      }
      case 'message':
        if (b !== 'a' && b !== 'b') return p;
        menuSe(ctx, 1500);
        if (p.page + 1 < p.pages.length) return { ...p, page: p.page + 1 };
        return p.then();
      case 'qty':
        if (b === 'up' || b === 'down' || b === 'left' || b === 'right') return { ...p, count: stepCount(p.count, p.max, b) };
        if (b === 'a') {
          menuSe(ctx, 1500);
          if (mode === 'buy' && !canFitBuy(p.item, p.count)) return message([t.t('martNoRoom')], toList);
          return { kind: 'confirm', item: p.item, count: p.count, yes: true };
        }
        if (b === 'b') return toList();
        return p;
      case 'confirm':
        if (b === 'up' || b === 'down') return { ...p, yes: !p.yes };
        if (b === 'a') return answer(p, p.yes);
        if (b === 'b') return toList();
        return p;
      case 'exit':
        return b === 'a' || b === 'b' ? 'close' : p;
    }
  };
  // Decomp Shop_ShowPurchaseMessage checks the bag before asking.
  const canFitBuy = (id: Id, count: number) => canGiveItem(ctx.state, ctx.registries, id, count);

  const tap = (id: string): Phase | 'close' => {
    const p = phase;
    if (p.kind === 'message') return id === 'next' || id === 'back' ? press('a') : p;
    if (p.kind === 'exit') return id === 'next' || id === 'back' ? 'close' : p;
    if (p.kind === 'menu') {
      if (id === 'back') return pickMenu(exitIndex);
      const n = tapIndex(id, 'menu');
      return n !== null && n >= 0 && n < menuKeys.length ? pickMenu(n) : p;
    }
    if (p.kind === 'list') {
      if (id === 'cancel' || id === 'back') return toMenu();
      const k = tapIndex(id, 'pocket');
      if (mode === 'sell' && k !== null && k >= 0 && k < pockets.length) {
        pocket = k;
        cursor = 0;
        return p;
      }
      const n = tapIndex(id, 'row');
      return n !== null && n >= 0 && n < rows().length ? pickRow(n) : p;
    }
    if (p.kind === 'qty') {
      const m = /^qty:([+-])(1|10)$/.exec(id);
      if (m) return { ...p, count: stepCount(p.count, p.max, m[2] === '1' ? (m[1] === '+' ? 'up' : 'down') : m[1] === '+' ? 'right' : 'left') };
      if (id === 'ok') return press('a');
      if (id === 'back') return toList();
      return p;
    }
    if (id === 'yes' || id === 'no') return answer(p, id === 'yes');
    if (id === 'back') return toList();
    return p;
  };

  const run = (next: Phase | 'close'): Step => {
    if (next === 'close') return { close: { app: 'mart', ...(bp ? {} : { bought, sold }) } };
    phase = next;
    return;
  };

  return {
    view(): MartView {
      const p = phase;
      const list = rows().map((r) => ({
        item: r.item,
        label: item(r.item).name,
        right: mode === 'sell' ? (pockets[pocket] === 'key_items' ? '' : `${t.t('bagCountX')}${r.count}`) : t.t(bp ? 'bpPrice' : 'martPrice', String(price(r.item))),
      }));
      const focused = p.kind === 'qty' || p.kind === 'confirm' ? p.item : (list[cursor]?.item ?? null);
      let msg: MartView['message'] = null;
      if (p.kind === 'menu' && menuMessage) msg = { text: menuMessage, waiting: false };
      else if (p.kind === 'message') msg = { text: p.pages[p.page]!, waiting: true };
      else if (p.kind === 'qty') msg = { text: mode === 'sell' ? t.t('bagSellHowMany', item(p.item).name) : t.t(bp ? 'bpHowMany' : 'martHowMany', item(p.item).name), waiting: false };
      else if (p.kind === 'confirm') msg = { text: confirmText(p.item, p.count), waiting: false };
      else if (p.kind === 'exit') msg = { text: t.t(bp ? 'bpComeAgain' : 'martComeAgain'), waiting: true };
      const unit = p.kind === 'qty' ? (mode === 'sell' ? sellPrice(ctx.registries, p.item) : price(p.item)) : 0;
      return {
        app: 'mart',
        mode,
        menu: menuKeys.map((k) => t.t(k)),
        menuCursor,
        money: bp ? { label: '', value: t.t('bpValue', String(battlePoints(ctx.state))) } : { label: t.t('martMoney'), value: money(ctx.state.money) },
        ...(bp ? { currency: 'bp' as const } : {}),
        message: msg,
        rows: mode === 'buy' || mode === 'sell' ? list : [],
        cancel: t.t('martCancel'),
        cursor,
        pockets: mode === 'sell' ? pockets.map((q) => t.pocket(q)) : [],
        pocket,
        item: focused && (mode === 'buy' || mode === 'sell') ? { id: focused, name: item(focused).name, description: t.text(item(focused).description) } : null,
        quantity:
          p.kind === 'qty'
            ? { count: t.t('martCount', String(p.count).padStart(2, '0')), total: t.t(bp ? 'bpTotal' : 'martTotal', String(unit * p.count)), inBag: t.t('martInBag', String(itemCount(ctx.state, p.item))) }
            : null,
        yesNo: p.kind === 'confirm' ? { yes: t.t('martYes'), no: t.t('martNo'), cursor: p.yes ? 0 : 1 } : null,
      };
    },
    input(i: Input): Step {
      const before = phase;
      const oldCursor = cursor;
      const oldMenu = menuCursor;
      const oldPocket = pocket;
      const next = 'tap' in i ? tap(i.tap) : press(i.button);
      if (before.kind === 'qty' && next !== 'close' && next.kind === 'qty' && before.count !== next.count) menuSe(ctx, 1592);
      else if (before.kind === 'list' && next !== 'close' && next.kind === 'list' && oldCursor !== cursor) menuSe(ctx, 1592);
      else if (before.kind === 'menu' && next !== 'close' && next.kind === 'menu' && oldMenu !== menuCursor) menuSe(ctx, 1500);
      else if (oldPocket !== pocket) menuSe(ctx, 1738);
      else if (before.kind === 'confirm' && next !== 'close' && next.kind === 'confirm' && before.yes !== next.yes) menuSe(ctx, 1500);
      return run(next);
    },
  };
}
