/**
 * The Underground's menus (decomp src/underground/menus.c, vendors.c, records.c): the menu X opens on the Underground's
 * field and the vendors' shops. DS windows over the field; their texts are TEXT_BANK_UNDERGROUND_* messages.
 * - The menu: TRAPS, SPHERES, GOODS, TREASURES, the player (the Underground records), GO UP, CLOSE. A sphere is buried in
 *   front of the player (core `burySphere`) or thrown away; a treasure goes into the bag (sMiningItems) or away; a trap
 *   or a good away. Laying a trap and the Digger Drill are not implemented yet: logged, and the menu closes as the DS's does.
 * - A vendor (vendors.c): the goods and traps vendors BUY (their five-item stock, paid with one sphere of the price's
 *   type and at least its size) and SELL (the player's own, for a sphere of half the rolled size); the treasure vendor
 *   only takes treasures. NOT DS: with the Spiritomb option on, a vendor's first talk on a visit counts toward Spiritomb.
 */
import { burySphere, readUnderground, sellPrice, TRAP_DIGGER_DRILL, tryAddGood, tryAddSphere, tryAddTrap, underground, vendorStock, type Id, type UndergroundState, type VendorItem } from '@opensinnoh/core';
import { canGiveItem, giveItem, newGameRecord, type AppMenu, type UndergroundMenuView, type UndergroundTables, type UndergroundVendorView } from '@opensinnoh/contracts';
import { addToGameRecord } from '@opensinnoh/services';
import { Dialog } from './dialog.ts';
import { menuSe, type MenuContext } from './context.ts';
import { plainText } from './strings.ts';
import type { Screen, Step } from './stack.ts';

/** UNDERGROUND_MENU_MAX_DISPLAY. */
const VISIBLE = 6;
/** SE_CONFIRM, SEQ_SE_DP_WIN_OPEN, SEQ_SE_DP_SELECT78, SEQ_SE_PL_SUTYA2, SEQ_SE_DP_PIRORIRO2. */
const SE = { confirm: 1500, open: 1533, select: 1504, bury: 1367, obtained: 1507 };
/** RECORD_SPHERES_BURIED (generated/game_records.txt). */
const RECORD_SPHERES_BURIED = 46;
/** MINING_TREASURE_REVIVE and _MAX_REVIVE: put into the bag's MEDICINE pocket. */
const REVIVES = [29, 30];

type Kind = 'traps' | 'spheres' | 'goods' | 'treasures';
const ENTRIES = ['traps', 'spheres', 'goods', 'treasures', 'trainer', 'up', 'close'] as const;

/** The Underground's text helpers over the menu context. */
function ugText(ctx: MenuContext) {
  const message = (name: string, ...slots: string[]) => ctx.text.message(`Underground${name}`, ...slots);
  const bankId = (bank: string, i: number): Id => {
    const id = ctx.registries.textBanks.get(ctx.text.id(bank))?.messages[i];
    if (!id) throw new Error(`underground menus: ${bank} has no message ${i}`);
    return id;
  };
  const bank = (b: string, i: number) => plainText(ctx.registries.texts.get(bankId(b, i))!.text);
  const indexOf = (b: string, name: string) => {
    const i = ctx.registries.textBanks.get(ctx.text.id(b))?.messages.indexOf(ctx.text.id(name)) ?? -1;
    if (i < 0) throw new Error(`underground menus: ${b} has no ${name}`);
    return i;
  };
  return {
    message,
    item: (id: number) => bank('TEXT_BANK_UNDERGROUND_ITEMS', id),
    itemWithArticle: (id: number) => bank('TEXT_BANK_UNDERGROUND_ITEM_NAMES_WITH_ARTICLES', id),
    trap: (id: number) => bank('TEXT_BANK_UNDERGROUND_TRAPS', id),
    good: (id: number) => bank('TEXT_BANK_UNDERGROUND_GOODS', id),
    /** UndergroundMenu_Print*Description: the CLOSE row's, or item n's (spheres and treasures share a run). */
    description(kind: Kind, id: number | null): string {
      if (kind === 'traps') return bank('TEXT_BANK_UNDERGROUND_TRAPS', id === null ? indexOf('TEXT_BANK_UNDERGROUND_TRAPS', 'UndergroundTraps_Text_CloseDescription') : indexOf('TEXT_BANK_UNDERGROUND_TRAPS', 'UndergroundTraps_Text_MoveTrapUpDescription') + id - 1);
      if (kind === 'goods') return bank('TEXT_BANK_UNDERGROUND_GOODS', indexOf('TEXT_BANK_UNDERGROUND_GOODS', 'UndergroundGoods_Text_CloseDescription') + (id ?? 0));
      return bank('TEXT_BANK_UNDERGROUND_ITEMS', id === null ? indexOf('TEXT_BANK_UNDERGROUND_ITEMS', 'UndergroundItems_Text_CloseDescription') : indexOf('TEXT_BANK_UNDERGROUND_ITEMS', 'UndergroundItems_Text_PrismSphereDescription') - 1 + id);
    },
    close: (kind: Kind) =>
      kind === 'traps' ? message('Traps_Text_Close') : kind === 'goods' ? message('Goods_Text_Close') : message('Items_Text_Close'),
  };
}

const tables = (ctx: MenuContext): UndergroundTables => {
  const t = newGameRecord(ctx.registries).underground;
  if (!t) throw new Error('underground menus: the packs have no Underground (NewGame.underground)');
  return t;
};

/** One inventory's rows: name, the right column (a sphere's size), the item id. */
function rows(ctx: MenuContext, u: UndergroundState, kind: Kind): { name: string; right: string | null; id: number }[] {
  const t = ugText(ctx);
  switch (kind) {
    case 'spheres':
      return u.spheres.map((s) => ({ name: t.item(s.type), right: String(s.size), id: s.type }));
    case 'treasures':
      return u.treasures.map((id) => ({ name: t.item(id), right: null, id }));
    case 'traps':
      return u.traps.map((id) => ({ name: t.trap(id), right: null, id }));
    case 'goods':
      return u.goods.map((id) => ({ name: t.good(id), right: null, id }));
  }
}

/** A list with the DS list menu's scrolling: the cursor over rows and CLOSE, six shown from `top`. */
class List {
  cursor = 0;
  top = 0;
  constructor(private count: () => number) {}
  /** Up/down within rows + CLOSE. */
  move(d: number): boolean {
    const n = this.count() + 1;
    const next = Math.max(0, Math.min(n - 1, this.cursor + d));
    if (next === this.cursor) return false;
    this.cursor = next;
    this.clamp();
    return true;
  }
  clamp(): void {
    const n = this.count() + 1;
    this.cursor = Math.min(this.cursor, n - 1);
    if (this.cursor < this.top) this.top = this.cursor;
    if (this.cursor >= this.top + VISIBLE) this.top = this.cursor - VISIBLE + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, n - VISIBLE)));
  }
}

export function undergroundMenu(ctx: MenuContext): Screen {
  const t = ugText(ctx);
  const se = (n: number) => menuSe(ctx, n);
  const dialog = new Dialog(ctx.text.t('bagYes'), ctx.text.t('bagNo'), se);
  const u = () => readUnderground(ctx.state);
  let entry = 0;
  let list: { kind: Kind; list: List } | null = null;
  let selected: { kind: Kind; slot: number; id: number; options: { label: string; run: () => Step }[]; cursor: number } | null = null;
  let records = false;
  se(SE.open);

  const openList = (kind: Kind) => {
    list = { kind, list: new List(() => rows(ctx, u(), kind).length) };
  };
  const backToList = (): Step => {
    selected = null;
    list?.list.clamp();
    return;
  };
  const after = (pages: string[]): Step => dialog.say(pages, backToList);

  /** UndergroundMenu_HandleSphereSelectedMenu's BURY (Spheres_TryBurySphere). */
  const bury = (slot: number): Step => {
    const ug = underground(ctx.state);
    const sphere = ug.spheres[slot]!;
    const at = ctx.host.undergroundAhead?.();
    if (!at) throw new Error('underground menu: BURY off the Underground');
    const result = burySphere(ug, sphere, at);
    selected = null;
    switch (result) {
      case 'secret-base':
        return after([t.message('Common_Text_CantBuryInSecretBase')]);
      case 'object':
        return after([t.message('Common_Text_CantBePlacedThere')]);
      case 'wall':
        return after([t.message('Common_Text_CantBuryInWall')]);
      case 'other-sphere':
        return after([t.message('Common_Text_SomethingAlreadyBuried')]);
    }
    ug.spheres.splice(slot, 1);
    se(SE.bury);
    ctx.state.flags[tables(ctx).flags.sphereAcquired] = true;
    addToGameRecord(ctx.state, ctx.registries, RECORD_SPHERES_BURIED, 1);
    return after([t.message('Common_Text_SphereWasBuried', t.item(sphere.type), String(sphere.size))]);
  };

  /** The treasure's PUT IN BAG (Underground_ConvertTreasureToBagItem, Bag_TryAddItem). */
  const putInBag = (slot: number, id: number): Step => {
    const item = tables(ctx).treasureItems[id - 11];
    if (!item) throw new Error(`underground menu: treasure ${id} has no bag item`);
    selected = null;
    se(SE.confirm);
    if (!canGiveItem(ctx.state, ctx.registries, item, 1)) return after([t.message('Common_Text_BagIsFullCouldntPutAway', t.item(id))]);
    giveItem(ctx.state, ctx.registries, item, 1);
    underground(ctx.state).treasures.splice(slot, 1);
    return after([t.message(REVIVES.includes(id) ? 'Common_Text_PlacedInMedicinePocket' : 'Common_Text_PlacedInItemsPocket', t.item(id))]);
  };

  const trash = (kind: Kind, slot: number, id: number): Step => {
    const ug = underground(ctx.state);
    ({ spheres: ug.spheres, treasures: ug.treasures, traps: ug.traps, goods: ug.goods } as Record<Kind, unknown[]>)[kind].splice(slot, 1);
    selected = null;
    se(SE.confirm);
    const name = kind === 'traps' ? t.trap(id) : kind === 'goods' ? t.good(id) : t.item(id);
    return after([t.message('Common_Text_ThrewAwayTheItem', '', '', name)]);
  };

  const select = (kind: Kind, slot: number) => {
    const row = rows(ctx, u(), kind)[slot]!;
    const label = (name: string) => t.message(`Common_Text_${name}`);
    if (kind === 'traps' && row.id === TRAP_DIGGER_DRILL) {
      ctx.log.stub('underground:digger-drill', 'the Digger Drill (a secret base) is not implemented yet');
      return { close: { app: 'ug-menu' as const, goUp: false } };
    }
    const options =
      kind === 'spheres' ? [{ label: label('Bury'), run: () => bury(slot) }, { label: label('Trash'), run: () => trash(kind, slot, row.id) }]
      : kind === 'traps' ? [{ label: label('Bury'), run: (): Step => {
          ctx.log.stub('underground:place-trap', 'laying a trap is not implemented yet');
          return { close: { app: 'ug-menu', goUp: false } };
        } }, { label: label('Trash'), run: () => trash(kind, slot, row.id) }]
      : kind === 'treasures' ? [{ label: label('PutInBag'), run: () => putInBag(slot, row.id) }, { label: label('Trash'), run: () => trash(kind, slot, row.id) }]
      : [{ label: label('Trash'), run: () => trash(kind, slot, row.id) }];
    options.push({ label: label('Cancel'), run: backToList });
    selected = { kind, slot, id: row.id, options, cursor: 0 };
    return;
  };

  const view = (): UndergroundMenuView => {
    const L = list as { kind: Kind; list: List } | null;
    const listView = L
      ? (() => {
          const r = rows(ctx, u(), L.kind);
          const at = L.list.cursor < r.length ? r[L.list.cursor]! : null;
          return {
            title: t.message(`Common_Text_${{ traps: 'Traps', spheres: 'Spheres', goods: 'Goods', treasures: 'Treasures' }[L.kind]}`),
            rows: r.map(({ name, right }) => ({ name, right })),
            close: t.close(L.kind),
            cursor: L.list.cursor,
            top: L.list.top,
            visible: VISIBLE,
            description: t.description(L.kind, at ? at.id : null),
          };
        })()
      : null;
    const menu: AppMenu | null = selected ? { entries: selected.options.map((o) => ({ label: o.label })), cursor: selected.cursor } : null;
    const s = selected as { kind: Kind; id: number } | null;
    const whatToDo = s && !dialog.active ? t.message('Common_Text_WhatWouldYouLikeToDo', '', '', s.kind === 'traps' ? t.trap(s.id) : s.kind === 'goods' ? t.good(s.id) : t.item(s.id)) : null;
    const ug = u();
    return {
      app: 'ug-menu',
      entries: list || records ? null : ENTRIES.map((e) => ({ label: e === 'trainer' ? ctx.state.names.player : t.message(`Common_Text_${{ traps: 'Traps', spheres: 'Spheres', goods: 'Goods', treasures: 'Treasures', up: 'GoUp', close: 'Close' }[e]}`) })),
      cursor: entry,
      list: listView,
      menu,
      records: records
        ? {
            title: ctx.state.names.player,
            rows: [
              { label: t.message('Records_Text_Score'), value: String(ctx.state.records.score) },
              { label: t.message('Records_Text_PeopleMet'), value: '0' },
              { label: t.message('Records_Text_GiftsGiven'), value: '0' },
              { label: t.message('Records_Text_FlagsObtained'), value: '0' },
              { label: t.message('Records_Text_SpheresDug'), value: String(ug.records.spheresDug) },
              { label: t.message('Records_Text_FossilsDug'), value: String(ug.records.fossilsDug) },
              { label: t.message('Records_Text_TrapHits'), value: '0' },
            ],
          }
        : null,
      message: dialog.message() ?? (whatToDo ? { text: whatToDo, waiting: false } : null),
      yesNo: dialog.yesNo(),
    };
  };

  const input = (i: { button: string } | { tap: string }): Step => {
    if (dialog.active) return dialog.input(i as never);
    const b = 'button' in i ? i.button : null;
    const tap = 'tap' in i ? i.tap : null;
    if (records) {
      if (b === 'a' || b === 'b' || tap === 'back' || tap === 'next') {
        records = false;
        se(SE.confirm);
      }
      return;
    }
    if (selected) {
      const s = selected;
      if (b === 'up' || b === 'down') {
        s.cursor = (s.cursor + (b === 'up' ? -1 : 1) + s.options.length) % s.options.length;
        se(SE.confirm);
        return;
      }
      const pick = tap?.startsWith('menu:') ? Number(tap.slice(5)) : b === 'a' ? s.cursor : b === 'b' || tap === 'back' ? s.options.length - 1 : null;
      if (pick === null || !s.options[pick]) return;
      se(SE.confirm);
      return s.options[pick]!.run();
    }
    if (list) {
      const l = list;
      const n = rows(ctx, u(), l.kind).length;
      if (b === 'up' || b === 'down') {
        if (l.list.move(b === 'up' ? -1 : 1)) se(SE.confirm);
        return;
      }
      if (b === 'select') {
        ctx.log.stub('underground:menu-move', 'moving an item within an Underground list (SELECT) is not implemented');
        return;
      }
      const row = tap?.startsWith('row:') ? Number(tap.slice(4)) : tap === 'close' ? n : b === 'a' ? l.list.cursor : null;
      if (b === 'b' || tap === 'back' || row === n) {
        se(SE.confirm);
        list = null;
        return;
      }
      if (row === null || row < 0 || row > n) return;
      l.list.cursor = row;
      se(SE.confirm);
      return select(l.kind, row);
    }
    // The start menu (UndergroundMenu_HandleStartMenu: it loops; B and X close).
    if (b === 'up' || b === 'down') {
      entry = (entry + (b === 'up' ? -1 : 1) + ENTRIES.length) % ENTRIES.length;
      se(SE.select);
      return;
    }
    if (b === 'b' || b === 'x' || tap === 'back') return { close: { app: 'ug-menu', goUp: false } };
    const pick = tap?.startsWith('entry:') ? Number(tap.slice(6)) : b === 'a' ? entry : null;
    if (pick === null || !ENTRIES[pick]) return;
    entry = pick;
    se(SE.select);
    switch (ENTRIES[pick]!) {
      case 'close':
        return { close: { app: 'ug-menu', goUp: false } };
      case 'trainer':
        records = true;
        return;
      case 'up':
        // UndergroundMenu_GoUpCallback (not from a secret base: not implemented yet).
        return dialog.confirm([t.message('Common_Text_WouldYouLikeToReturnToSurface')], (yes) => (yes ? { close: { app: 'ug-menu', goUp: true } } : undefined));
      default:
        openList(ENTRIES[pick] as Kind);
        return;
    }
  };

  return { view, input: (i) => input(i as never) };
}

/** UndergroundVendors_ShopMenuTask. */
export function undergroundVendor(ctx: MenuContext, vendor: number): Screen {
  const t = ugText(ctx);
  const tb = tables(ctx);
  const v = tb.vendors[vendor];
  if (!v) throw new Error(`underground vendor: no vendor ${vendor}`);
  const se = (n: number) => menuSe(ctx, n);
  const dialog = new Dialog(ctx.text.t('bagYes'), ctx.text.t('bagNo'), se);
  const npc = (name: string, ...slots: string[]) => ctx.text.message(`UndergroundNPCs_Text_${name}`, ...slots);
  const u = () => readUnderground(ctx.state);
  const kind = v.kind;
  const stock: VendorItem[] = kind === 'treasures' ? [] : vendorStock(u(), kind, vendor, kind === 'traps' ? tb.trapPrices : tb.goods.map((g) => g.price), tb.goods.map((g) => g.natDex), ctx.state.pokedex.national);
  const ownKind: Kind = kind === 'goods' ? 'goods' : kind === 'traps' ? 'traps' : 'treasures';
  const nameOf = (id: number) => (kind === 'traps' ? t.trap(id) : kind === 'goods' ? t.good(id) : t.item(id));
  const priceOf = (id: number) => (kind === 'traps' ? tb.trapPrices[id]! : kind === 'goods' ? tb.goods[id]!.price : tb.treasurePrices[id]!);

  // NOT DS: the Spiritomb option counts this vendor's first talk on the visit.
  if (ctx.host.spiritombVendors?.()) {
    const ug = underground(ctx.state);
    if (!ug.vendorTalks.includes(vendor)) {
      ug.vendorTalks.push(vendor);
      const id = tb.vars.spiritomb;
      ctx.state.vars[id] = Math.min(0xffff, (ctx.state.vars[id] ?? ctx.registries.vars.get(id)?.initial ?? 0) + 1);
    }
  }

  type Mode = { kind: 'options'; cursor: number } | { kind: 'buy'; list: List } | { kind: 'pay'; item: number; list: List } | { kind: 'sell'; list: List } | { kind: 'talk' };
  let mode: Mode = { kind: 'talk' };
  const options = kind === 'treasures' ? [npc('GiveTreasures'), npc('Cancel')] : kind === 'traps' ? [npc('GetTrap'), npc('GiveTrap'), npc('Exit_Trap')] : [npc('GetGoods'), npc('GiveGoods'), npc('Exit_Goods')];
  const toOptions = (): Step => {
    mode = { kind: 'options', cursor: 0 };
    return;
  };
  const anythingElse = (): Step => dialog.say([npc('DoYouNeedAnythingElse')], toOptions);
  const leave = (): Step => dialog.say([npc('BeSeeingYouThen')], () => ({ close: { app: 'ug-vendor' } }));
  se(SE.confirm);
  dialog.say([kind === 'treasures' ? npc('IllTradeSpheresForTreasures') : npc('IllTradeYouSomething')], toOptions);

  /** UndergroundVendors_TryBuyItem. */
  const pay = (item: number, sphereSlot: number): Step => {
    const ug = underground(ctx.state);
    const line = stock[item]!;
    const sphere = ug.spheres[sphereSlot]!;
    if (line.sphere !== sphere.type) return dialog.say([npc('WrongKindOfSphere')], anythingElse);
    if (line.size > sphere.size) return dialog.say([npc('SphereTooSmall')], anythingElse);
    const added = kind === 'traps' ? tryAddTrap(ug, line.item) : tryAddGood(ug, line.item);
    if (!added) return dialog.say([npc('YouDontHaveRoom')], anythingElse);
    ug.spheres.splice(sphereSlot, 1);
    return dialog.say([npc('LetsDoThisTrade')], () => {
      se(SE.obtained);
      return dialog.say([npc('ItemWasObtained', '', '', nameOf(line.item))], anythingElse);
    });
  };

  /** UndergroundVendors_TrySellItem after the YES. */
  const sell = (slot: number, offer: { sphere: number; size: number }): Step => {
    const ug = underground(ctx.state);
    if (!tryAddSphere(ug, offer.sphere, Math.min(offer.size, 99))) return dialog.say([npc('YouDontHaveRoom')], anythingElse);
    ({ goods: ug.goods, traps: ug.traps, treasures: ug.treasures } as Record<string, number[]>)[ownKind]!.splice(slot, 1);
    return dialog.say([npc('AllRightLetsTrade')], () => {
      se(SE.obtained);
      return dialog.say([npc('YouObtainedSphere', '', '', t.item(offer.sphere), '', '', '', String(offer.size))], anythingElse);
    });
  };

  const own = () => rows(ctx, u(), ownKind);
  const offerOf = (slot: number) => {
    const id = own()[slot]!.id;
    return sellPrice(u(), kind, vendor, id, priceOf(id));
  };

  const view = (): UndergroundVendorView => {
    const m = mode;
    let list: UndergroundVendorView['list'] = null;
    let price: UndergroundVendorView['price'] = null;
    if (m.kind === 'buy') {
      const at = stock[m.list.cursor];
      list = { rows: stock.map((s) => ({ name: nameOf(s.item), right: null })), close: npc('Cancel'), cursor: m.list.cursor, top: m.list.top, visible: VISIBLE, description: at ? t.description(ownKind, at.item) : t.description(ownKind, null), heading: null };
      price = { label: npc('RequiredSphere'), value: at ? `${t.item(at.sphere)} ${String(at.size).padStart(2, ' ')}` : null };
    } else if (m.kind === 'pay') {
      const r = rows(ctx, u(), 'spheres');
      list = { rows: r.map(({ name, right }) => ({ name, right })), close: t.close('spheres'), cursor: m.list.cursor, top: m.list.top, visible: VISIBLE, description: m.list.cursor < r.length ? t.description('spheres', r[m.list.cursor]!.id) : t.description('spheres', null), heading: npc('SpheresOnHand') };
    } else if (m.kind === 'sell') {
      const r = own();
      const offer = m.list.cursor < r.length ? offerOf(m.list.cursor) : null;
      list = { rows: r.map(({ name, right }) => ({ name, right })), close: t.close(ownKind), cursor: m.list.cursor, top: m.list.top, visible: VISIBLE, description: m.list.cursor < r.length ? t.description(ownKind, r[m.list.cursor]!.id) : t.description(ownKind, null), heading: npc(kind === 'traps' ? 'TrapsOnHand' : kind === 'goods' ? 'GoodsOnHand' : 'TreasuresOnHand') };
      price = { label: npc('OfferedSphere'), value: m.list.cursor < r.length ? (offer ? `${t.item(offer.sphere)} ${String(offer.size).padStart(2, ' ')}` : npc('NotForSale')) : null };
    }
    return {
      app: 'ug-vendor',
      options: m.kind === 'options' && !dialog.active ? { entries: options.map((label) => ({ label })), cursor: m.cursor } : null,
      list: dialog.active && m.kind !== 'pay' ? null : list,
      price: dialog.active ? null : price,
      message: dialog.message(),
      yesNo: dialog.yesNo(),
    };
  };

  const listInput = (l: List, count: number, b: string | null, tap: string | null, pick: (row: number) => Step, back: () => Step): Step => {
    if (b === 'up' || b === 'down') {
      if (l.move(b === 'up' ? -1 : 1)) se(SE.confirm);
      return;
    }
    const row = tap?.startsWith('row:') ? Number(tap.slice(4)) : tap === 'close' ? count : b === 'a' ? l.cursor : null;
    if (b === 'b' || tap === 'back' || row === count) {
      se(SE.confirm);
      return back();
    }
    if (row === null || row < 0 || row > count) return;
    l.cursor = row;
    return pick(row);
  };

  const input = (i: { button: string } | { tap: string }): Step => {
    if (dialog.active) return dialog.input(i as never);
    const b = 'button' in i ? i.button : null;
    const tap = 'tap' in i ? i.tap : null;
    const m = mode;
    switch (m.kind) {
      case 'talk':
        return;
      case 'options': {
        if (b === 'up' || b === 'down') {
          m.cursor = (m.cursor + (b === 'up' ? -1 : 1) + options.length) % options.length;
          se(SE.confirm);
          return;
        }
        const pick = tap?.startsWith('menu:') ? Number(tap.slice(5)) : b === 'a' ? m.cursor : b === 'b' || tap === 'back' ? options.length - 1 : null;
        if (pick === null || !options[pick]) return;
        se(SE.confirm);
        if (pick === options.length - 1) return leave();
        if (kind !== 'treasures' && pick === 0) {
          mode = { kind: 'buy', list: new List(() => stock.length) };
          return;
        }
        mode = { kind: 'sell', list: new List(() => own().length) };
        return;
      }
      case 'buy':
        return listInput(m.list, stock.length, b, tap, (row) => {
          se(SE.confirm);
          return dialog.say([npc('PickSpherePrompt', '', '', nameOf(stock[row]!.item))], () => {
            mode = { kind: 'pay', item: row, list: new List(() => u().spheres.length) };
            return;
          });
        }, toOptions);
      case 'pay':
        return listInput(m.list, u().spheres.length, b, tap, (row) => {
          mode = { kind: 'talk' };
          return pay(m.item, row);
        }, () => {
          mode = { kind: 'buy', list: new List(() => stock.length) };
          return;
        });
      case 'sell':
        return listInput(m.list, own().length, b, tap, (row) => {
          const offer = offerOf(row);
          // SHOP_MENU_STATE_SELL_MENU: an item not for sale takes no press.
          if (!offer) return;
          const name = nameOf(own()[row]!.id);
          mode = { kind: 'talk' };
          return dialog.confirm([npc('ConfirmTradePrompt', '', '', name, '', t.item(offer.sphere))], (yes) => (yes ? sell(row, offer) : leave()));
        }, toOptions);
    }
  };

  return { view, input: (i) => input(i as never) };
}
