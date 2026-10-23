/**
 * The seal mart (decomp overlay007/shop_menu.c, MART_TYPE_SEAL; ScrCmd_PokeMartSeal): the Sunyshore Market seal merchant.
 * The mart's screen with BUY / SEE YA! only (Shop_InitContextMenu), the seal names (bank 12 by the seal table's
 * `name`), the descriptions (bank 542 by `description`), no item icon (tilemap_no_item), the table's prices, "In Bag"
 * counting the seals owned, the quantity window (at most 99 and what the money buys), the Seal Case's 99 refusal
 * (bank 543 #14, Shop_ShowPurchaseMessage), and "You placed the … in the Seal Case." (#13, plural for more than one).
 * Rules: services `buySeals`. Rows name a seal as `seal:<id>` (contracts `MartView.seals`).
 */
import type { Button, Id } from '@opensinnoh/core';
import type { MartView } from '@opensinnoh/contracts';
import { buySeals, canGiveOrTakeSeal, maxBuySeals, sealPrice, sealsOwned, sealTables } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { moveCursor, stepCount, tapIndex, type Screen, type Step } from './stack.ts';

type Input = { button: Button } | { tap: string };

type Phase =
  | { kind: 'menu' }
  | { kind: 'list' }
  | { kind: 'message'; pages: string[]; page: number; then: () => Phase }
  | { kind: 'qty'; seal: number; count: number; max: number }
  | { kind: 'confirm'; seal: number; count: number; yes: boolean }
  | { kind: 'exit' };

const MENU = ['martBuy', 'martSeeYa'] as const;
const pad = (n: number) => String(n).padStart(5, '0');
/** TEXT_BANK_BALL_SEAL_NAMES (12), _PLURAL (13), TEXT_BANK_UNK_0542 (the shop's descriptions). */
export const sealNameText = (nameIndex: number, plural = false) => `pl_msg_000000${plural ? 13 : 12}_${pad(nameIndex)}`;
const descriptionText = (n: number) => `pl_msg_00000542_${pad(n)}`;
const sealId = (seal: number): Id => `seal:${seal}`;

export function sealMartScreen(ctx: MenuContext, request: { seals: number; greeting: string | null }): Screen {
  const t = ctx.text;
  const tables = sealTables(ctx.registries);
  const stock = tables.marts[request.seals];
  if (!stock) throw new Error(`seal mart: no stock ${request.seals}`);
  for (const id of stock) sealPrice(ctx.registries, id);
  const type = (seal: number) => tables.types[seal]!;
  const name = (seal: number, count = 1) => t.message(sealNameText(type(seal).name, count > 1));
  let mode: MartView['mode'] = 'menu';
  let phase: Phase = { kind: 'menu' };
  let menuCursor = 0;
  let menuMessage: string | null = request.greeting;
  let cursor = 0;
  const message = (pages: string[], then: () => Phase): Phase => ({ kind: 'message', pages, page: 0, then });
  const toList = (): Phase => ({ kind: 'list' });
  const toMenu = (): Phase => {
    mode = 'menu';
    menuMessage = t.t('martAnythingElse');
    return { kind: 'menu' };
  };

  const pickRow = (row: number): Phase => {
    menuSe(ctx, 1500);
    cursor = row;
    const seal = stock[row];
    if (seal === undefined) return toMenu();
    const max = maxBuySeals(ctx.state, ctx.registries, seal);
    if (max === 0) return message([t.t('martNoMoney')], toList);
    return { kind: 'qty', seal, count: 1, max };
  };
  const pickMenu = (i: number): Phase => {
    menuSe(ctx, 1500);
    menuCursor = i;
    if (i === 0) {
      mode = 'buy';
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
    const r = buySeals(ctx.state, ctx.registries, p.seal, p.count);
    if (!r.ok) return message([t.t(r.reason === 'money' ? 'martNoMoney' : 'martSealFull')], toList);
    menuSe(ctx, 1604);
    return message(t.pages('martSealPlaced', name(p.seal, p.count)), toList);
  };

  const press = (b: Button): Phase | 'close' => {
    const p = phase;
    switch (p.kind) {
      case 'menu':
        if (b === 'up' || b === 'down') menuCursor = moveCursor(menuCursor, MENU.length, 1, b);
        else if (b === 'a') return pickMenu(menuCursor);
        else if (b === 'b') return pickMenu(MENU.length - 1);
        return p;
      case 'list':
        if (b === 'up' || b === 'down') cursor = moveCursor(cursor, stock.length + 1, 1, b);
        else if (b === 'a') return pickRow(cursor);
        else if (b === 'b') return toMenu();
        return p;
      case 'message':
        if (b !== 'a' && b !== 'b') return p;
        menuSe(ctx, 1500);
        if (p.page + 1 < p.pages.length) return { ...p, page: p.page + 1 };
        return p.then();
      case 'qty':
        if (b === 'up' || b === 'down' || b === 'left' || b === 'right') return { ...p, count: stepCount(p.count, p.max, b) };
        if (b === 'a') {
          menuSe(ctx, 1500);
          // Decomp Shop_ShowPurchaseMessage: SealCase_CheckSealCount before asking.
          if (!canGiveOrTakeSeal(ctx.state.sealCase, p.seal, p.count)) return message([t.t('martSealFull')], toList);
          return { kind: 'confirm', seal: p.seal, count: p.count, yes: true };
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

  const tap = (id: string): Phase | 'close' => {
    const p = phase;
    if (p.kind === 'message') return id === 'next' || id === 'back' ? press('a') : p;
    if (p.kind === 'exit') return id === 'next' || id === 'back' ? 'close' : p;
    if (p.kind === 'menu') {
      if (id === 'back') return pickMenu(MENU.length - 1);
      const n = tapIndex(id, 'menu');
      return n !== null && n >= 0 && n < MENU.length ? pickMenu(n) : p;
    }
    if (p.kind === 'list') {
      if (id === 'cancel' || id === 'back') return toMenu();
      const n = tapIndex(id, 'row');
      return n !== null && n >= 0 && n < stock.length ? pickRow(n) : p;
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

  return {
    view(): MartView {
      const p = phase;
      const focused = p.kind === 'qty' || p.kind === 'confirm' ? p.seal : (stock[cursor] ?? null);
      let msg: MartView['message'] = null;
      if (p.kind === 'menu' && menuMessage) msg = { text: menuMessage, waiting: false };
      else if (p.kind === 'message') msg = { text: p.pages[p.page]!, waiting: true };
      else if (p.kind === 'qty') msg = { text: t.t('martHowMany', name(p.seal)), waiting: false };
      else if (p.kind === 'confirm') msg = { text: t.t('martConfirm', name(p.seal), String(p.count), String(sealPrice(ctx.registries, p.seal) * p.count)), waiting: false };
      else if (p.kind === 'exit') msg = { text: t.t('martComeAgain'), waiting: true };
      return {
        app: 'mart',
        mode,
        menu: MENU.map((k) => t.t(k)),
        menuCursor,
        money: { label: t.t('martMoney'), value: t.t('martMoneyValue', String(ctx.state.money)) },
        seals: true,
        message: msg,
        rows: mode === 'buy' ? stock.map((s) => ({ item: sealId(s), label: name(s), right: t.t('martPrice', String(sealPrice(ctx.registries, s))) })) : [],
        cancel: t.t('martCancel'),
        cursor,
        pockets: [],
        pocket: 0,
        item: focused !== null && mode === 'buy' ? { id: sealId(focused), name: name(focused), description: t.message(descriptionText(type(focused).description)) } : null,
        quantity:
          p.kind === 'qty'
            ? {
                count: t.t('martCount', String(p.count).padStart(2, '0')),
                total: t.t('martTotal', String(sealPrice(ctx.registries, p.seal) * p.count)),
                inBag: t.t('martInBag', String(sealsOwned(ctx.state.sealCase, p.seal))),
              }
            : null,
        yesNo: p.kind === 'confirm' ? { yes: t.t('martYes'), no: t.t('martNo'), cursor: p.yes ? 0 : 1 } : null,
      };
    },
    input(i: Input): Step {
      const before = phase;
      const oldCursor = cursor;
      const oldMenu = menuCursor;
      const next = 'tap' in i ? tap(i.tap) : press(i.button);
      if (next === 'close') return { close: { app: 'mart' } };
      if (before.kind === 'qty' && next.kind === 'qty' && before.count !== next.count) menuSe(ctx, 1592);
      else if (before.kind === 'list' && next.kind === 'list' && oldCursor !== cursor) menuSe(ctx, 1592);
      else if (before.kind === 'menu' && next.kind === 'menu' && oldMenu !== menuCursor) menuSe(ctx, 1500);
      else if (before.kind === 'confirm' && next.kind === 'confirm' && before.yes !== next.yes) menuSe(ctx, 1500);
      phase = next;
      return;
    },
  };
}
