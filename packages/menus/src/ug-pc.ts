/**
 * The secret base's PC (decomp src/underground/pc.c) and its decoration (base_decoration.c, decoration_menu.c), DS
 * windows over the field:
 * - the PC menu: DECORATE, STORE GOODS, RECEIVE GOODS, CHECK FLAGS, EXIT (USE RADAR only from the gold flag, which a
 *   solo game never reaches: UndergroundPC_InitMenu), the entry's description below;
 * - STORE / RECEIVE: the goods bag or the goods PC, each pick moved (UndergroundPC_TryDepositGood/_TryWithdrawGood; a
 *   good on display stays), its message waiting for A or B;
 * - CHECK FLAGS (UndergroundRecords_ShowCheckFlagsScreen): the base, its flags (none solo), the five most recent;
 * - DECORATE, with goods in the PC and the entrance closed: the PC's login, the fade, and the decoration over the base
 *   seen from (15, 17) (`AppHost.undergroundDecoration`): DECORATE (a good from the PC, held from (16, 13), placed where
 *   it fits: core `canPlace`), PUT AWAY (a good back to the PC, or a boulder once flags allow), MOVE GOODS, CANCEL (the
 *   edit is saved, FLAG_DECORATED_SECRET_BASE is set, the PC menu again). Its messages show 30 ticks once printed.
 * The picked thing blinks (PropBlinkContext: every 4 ticks held, 8 under the cursor). A touch on the floor (`tile:<x>,<z>`)
 * moves the held good or the cursor there and picks it (BaseDecoration_Handle*TouchInput's press and release).
 */
import {
  BASE,
  baseThings,
  canPlace,
  GOOD,
  goodPlaced,
  outOfRoom,
  placedGoodsLimit,
  readUnderground,
  rectOf,
  saveDecoration,
  SOLO_CAPTURED_FLAGS,
  storeGood,
  thingRect,
  underground,
  UNDERGROUND_LIMITS,
  unremovableBoulders,
  withdrawGood,
  type PlacedGood,
  type Rect,
} from '@opensinnoh/core';
import { newGameRecord, type AppMenu, type UndergroundDecorationView, type UndergroundPcView, type UndergroundTables } from '@opensinnoh/contracts';
import { Dialog } from './dialog.ts';
import { menuSe, type MenuContext } from './context.ts';
import { plainText } from './strings.ts';
import type { Screen, Step } from './stack.ts';

/** SE_CONFIRM, SEQ_SE_DP_PC_LOGIN/LOGOFF, SEQ_SE_DP_BOWA, SEQ_SE_DP_WALL_HIT2, SEQ_SE_DP_BOX02, SEQ_SE_DP_F017, SEQ_SE_DP_BUTTON3. */
const SE = { confirm: 1500, login: 1549, logoff: 1550, placed: 1534, cantPlace: 1538, putAway: 1515, boulder: 1600, cursor: 1509 };
/** UNDERGROUND_MENU_MAX_DISPLAY; the decoration's goods list shows up to 7 (DecorationGoodsMenu_InitMenu). */
const VISIBLE = 6;
const GOODS_VISIBLE = 7;
/** The decoration's messages: 30 ticks once printed (DECORATION_STATE_RETURN_AFTER_TEXT and the like). */
const NOTICE_TICKS = 31;
/** StartScreenFade(…, 6, 1). */
const FADE = 6;
/** PropBlinkContext intervals. */
const BLINK = { held: 4, cursor: 8 };
/** MAX_SECRET_BASE_GOODS: the PC, 15 goods, 16 boulders. */
const SLOTS = 1 + UNDERGROUND_LIMITS.placedGoods + UNDERGROUND_LIMITS.boulders;
const PC_ENTRIES = ['Decorate', 'StoreGoods', 'ReceiveGoods', 'CheckFlags', 'Exit'] as const;
const DECOR_ENTRIES = ['Decorate', 'PutAway', 'MoveGoods', 'Cancel'] as const;
/** The five most recent flags (MAX_CAPTURED_FLAG_RECORDS). */
const FLAG_RECORDS = 5;

type Thing = { good: number; x: number; z: number; pcSlot: number | null };

/** A list with the DS list menu's scrolling: the cursor over rows and CLOSE, `visible` shown from `top`. */
class List {
  cursor = 0;
  top = 0;
  constructor(
    private readonly count: () => number,
    readonly visible: number,
  ) {}
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
    if (this.cursor >= this.top + this.visible) this.top = this.cursor - this.visible + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, n - this.visible)));
  }
}

export function undergroundPcScreen(ctx: MenuContext): Screen {
  const tables: UndergroundTables | undefined = newGameRecord(ctx.registries).underground;
  if (!tables) throw new Error('underground PC: the packs have no Underground (NewGame.underground)');
  const goods = tables.goods;
  const se = (n: number) => menuSe(ctx, n);
  const dialog = new Dialog(ctx.text.t('bagYes'), ctx.text.t('bagNo'), se);
  const msg = (name: string, ...slots: string[]) => ctx.text.message(`Underground${name}`, ...slots);
  const bankIndex = (bank: string, name: string) => {
    const i = ctx.registries.textBanks.get(ctx.text.id(bank))?.messages.indexOf(ctx.text.id(name)) ?? -1;
    if (i < 0) throw new Error(`underground PC: ${bank} has no ${name}`);
    return i;
  };
  const bankText = (bank: string, i: number) => {
    const id = ctx.registries.textBanks.get(ctx.text.id(bank))?.messages[i];
    if (!id) throw new Error(`underground PC: ${bank} has no message ${i}`);
    return plainText(ctx.registries.texts.get(id)!.text);
  };
  const goodName = (g: number) => bankText('TEXT_BANK_UNDERGROUND_GOODS', g);
  const goodDescription = (g: number | null) => bankText('TEXT_BANK_UNDERGROUND_GOODS', bankIndex('TEXT_BANK_UNDERGROUND_GOODS', 'UndergroundGoods_Text_CloseDescription') + (g ?? 0));
  const u = () => readUnderground(ctx.state);
  const base = () => {
    const b = u().base;
    if (!b) throw new Error('underground PC: the player has no base');
    return b;
  };

  type Mode =
    | { kind: 'menu' }
    | { kind: 'store'; list: List }
    | { kind: 'withdraw'; list: List }
    | { kind: 'flags' }
    | { kind: 'fade'; to: 'decorate' | 'pc'; t: number; out: boolean }
    | { kind: 'decor' }
    | { kind: 'goods'; list: List }
    | { kind: 'place'; held: Thing; pcSlot: number }
    | { kind: 'pick'; move: boolean }
    | { kind: 'move'; held: Thing; index: number; from: Thing };
  let mode: Mode = { kind: 'menu' };
  let cursor = 0;
  let decorCursor = 0;
  let decorated = false;
  let notice: { text: string; t: number; then: () => void } | null = null;
  // The decoration's edit (BaseGoodSlot[]) and its counts (BaseDecoration_LoadBaseGoods).
  let slots: (Thing | null)[] = [];
  let placedCount = 0;
  let boulderCount = 0;
  const maxPlaced = placedGoodsLimit(SOLO_CAPTURED_FLAGS);
  const unremovable = unremovableBoulders(SOLO_CAPTURED_FLAGS);
  let pickAt: { x: number; z: number } = { x: BASE.start.x, z: BASE.start.z };
  let blink: { index: number | 'held'; t: number; hidden: boolean } | null = null;

  const loadEdit = () => {
    const b = base();
    slots = Array.from({ length: SLOTS }, () => null);
    placedCount = 0;
    boulderCount = 0;
    for (const t of baseThings(b, GOOD.pc)) {
      const placed = t.index >= 1 && t.index <= UNDERGROUND_LIMITS.placedGoods ? b.goods[t.index - 1]! : null;
      slots[t.index] = { good: t.good, x: t.x, z: t.z, pcSlot: placed ? placed.slot : null };
      if (t.good === GOOD.bigBoulder) boulderCount++;
      else if (t.index !== 0) placedCount++;
    }
  };
  const saveEdit = () => {
    const placed: (PlacedGood | null)[] = slots.slice(1, 1 + UNDERGROUND_LIMITS.placedGoods).map((t) => (t ? { good: t.good, x: t.x, z: t.z, slot: t.pcSlot! } : null));
    const boulders = slots.slice(1 + UNDERGROUND_LIMITS.placedGoods).map((t) => (t ? { x: t.x, z: t.z } : null));
    saveDecoration(underground(ctx.state).base!, placed, boulders);
  };
  const rect = (t: Thing): Rect => thingRect({ index: 0, ...t }, goods);
  const slotAt = (x: number, z: number) => slots.findIndex((t) => t !== null && x >= rect(t).minX && x <= rect(t).maxX && z >= rect(t).minZ && z <= rect(t).maxZ);
  const pcPlaced = (pcSlot: number) => (mode.kind === 'menu' || mode.kind === 'store' || mode.kind === 'withdraw' ? goodPlaced(u(), pcSlot) : slots.some((t) => t?.pcSlot === pcSlot));

  /** The decoration's field view, pushed to the field every tick it changes. */
  const decorationView = (): UndergroundDecorationView => {
    const m = mode;
    const held = m.kind === 'place' || m.kind === 'move' ? m.held : null;
    return {
      things: slots.flatMap((t, index) => (t ? [{ index, good: t.good, x: t.x, z: t.z, hidden: blink?.index === index && blink.hidden }] : [])),
      held: held ? { good: held.good, x: held.x, z: held.z, hidden: blink?.index === 'held' && blink.hidden } : null,
      cursor: m.kind === 'pick' && !notice ? { ...pickAt } : null,
    };
  };
  const inDecoration = () => mode.kind === 'decor' || mode.kind === 'goods' || mode.kind === 'place' || mode.kind === 'pick' || mode.kind === 'move' || (mode.kind === 'fade' && (mode.to === 'decorate' ? !mode.out : mode.out));

  const say = (text: string, then: () => void = () => {}): Step => {
    notice = { text, t: 0, then };
    return;
  };

  const toMenu = (): Step => {
    mode = { kind: 'menu' };
    return;
  };
  const startDecorating = (): Step => {
    se(SE.login);
    mode = { kind: 'fade', to: 'decorate', t: 0, out: true };
    return;
  };
  const stopDecorating = (): Step => {
    saveEdit();
    se(SE.logoff);
    mode = { kind: 'fade', to: 'pc', t: 0, out: true };
    return;
  };
  /** The picked thing under the cursor blinks every 8 ticks (PropBlinkContext_Init(…, 8)). */
  const blinkAtCursor = () => {
    const i = slotAt(pickAt.x, pickAt.z);
    blink = i >= 0 ? { index: i, t: 0, hidden: false } : null;
  };

  // ---------------------------------------------------------------- the PC menu

  const pcPick = (entry: (typeof PC_ENTRIES)[number]): Step => {
    switch (entry) {
      case 'Exit':
        se(SE.logoff);
        return { close: { app: 'ug-pc', decorated } };
      case 'Decorate':
        // UndergroundPC_HandleMenu: goods first, then the entrance closed.
        if (u().goodsPc.length === 0) return dialog.say([msg('PC_Text_StoreGoodsBeforeDecorating')], toMenu);
        if (ctx.host.undergroundPlace?.() !== 'closed') return dialog.say([msg('PC_Text_CantDecorateWithEntranceOpen')], toMenu);
        return startDecorating();
      case 'StoreGoods':
        se(SE.confirm);
        mode = { kind: 'store', list: new List(() => u().goods.length, VISIBLE) };
        return;
      case 'ReceiveGoods':
        se(SE.confirm);
        mode = { kind: 'withdraw', list: new List(() => u().goodsPc.length, VISIBLE) };
        return;
      case 'CheckFlags':
        se(SE.confirm);
        mode = { kind: 'flags' };
        return;
    }
  };

  const store = (m: { list: List }, row: number): Step => {
    const good = u().goods[row]!;
    const stored = storeGood(underground(ctx.state), row);
    return dialog.say([stored ? msg('PC_Text_GoodWasStored', '', '', goodName(good)) : msg('PC_Text_PCIsFull')], () => {
      m.list.clamp();
      return;
    });
  };
  const withdraw = (m: { list: List }, row: number): Step => {
    const good = u().goodsPc[row]!;
    const result = withdrawGood(underground(ctx.state), row);
    const text = result === 'withdrawn' ? msg('PC_Text_GoodWasWithdrawn', '', '', goodName(good)) : result === 'placed' ? msg('PC_Text_CantWithdrawDisplayedGood') : msg('PC_Text_BagIsFull');
    return dialog.say([text], () => {
      m.list.clamp();
      return;
    });
  };

  // ---------------------------------------------------------------- the decoration

  const decorPick = (entry: (typeof DECOR_ENTRIES)[number]): Step => {
    se(SE.confirm);
    switch (entry) {
      case 'Decorate':
        if (u().goodsPc.length === 0) return say(msg('BaseDecoration_Text_NoGoodsInPC'));
        if (placedCount + 1 > maxPlaced) return say(msg('BaseDecoration_Text_DisplayLimitReached'));
        mode = { kind: 'goods', list: new List(() => u().goodsPc.length, GOODS_VISIBLE) };
        return;
      case 'PutAway':
      case 'MoveGoods':
        pickAt = { x: BASE.start.x, z: BASE.start.z };
        mode = { kind: 'pick', move: entry === 'MoveGoods' };
        blinkAtCursor();
        return;
      case 'Cancel':
        return stopDecorating();
    }
  };

  const holdFromPc = (pcSlot: number): Step => {
    if (pcPlaced(pcSlot)) return say(msg('BaseDecoration_Text_GoodAlreadyDisplayed'));
    const good = u().goodsPc[pcSlot]!;
    mode = { kind: 'place', held: { good, x: BASE.start.x, z: BASE.start.z, pcSlot }, pcSlot };
    blink = { index: 'held', t: 0, hidden: false };
    return;
  };

  /** A held good moved one tile, or to a touched tile, if it stays in the room. */
  const moveHeld = (held: Thing, x: number, z: number) => {
    const g = goods[held.good]!;
    if (outOfRoom(rectOf(x, z, g.width, g.depth))) return;
    held.x = x;
    held.z = z;
  };

  const others = (except: number | null) => slots.flatMap((t, i) => (t && i !== except ? [rect(t)] : []));

  const place = (m: Extract<Mode, { kind: 'place' }>): Step => {
    if (!canPlace(rect(m.held), others(null))) {
      se(SE.cantPlace);
      return say(msg('BaseDecoration_Text_CantPlaceHere'));
    }
    // BaseDecoration_PlaceGood: the first free slot (one of the goods' while fewer than 15 are out).
    const index = slots.findIndex((t) => t === null);
    if (index < 1 || index > UNDERGROUND_LIMITS.placedGoods) throw new Error(`decoration: no free goods slot (${index})`);
    slots[index] = { ...m.held, pcSlot: m.pcSlot };
    placedCount++;
    se(SE.placed);
    blink = null;
    mode = { kind: 'decor' };
    return say(msg('BaseDecoration_Text_GoodWasPlaced', goodName(m.held.good)));
  };

  const pick = (m: Extract<Mode, { kind: 'pick' }>): Step => {
    const i = slotAt(pickAt.x, pickAt.z);
    if (i < 0) return;
    const t = slots[i]!;
    if (i === 0) return say(msg(m.move ? 'BaseDecoration_Text_CantMovePC' : 'BaseDecoration_Text_CantPutAwayPC'));
    if (m.move) {
      if (t.good === GOOD.bigBoulder) return say(msg('BaseDecoration_Text_CantMoveBigBoulder'));
      slots[i] = null;
      se(SE.putAway);
      mode = { kind: 'move', held: { ...t }, index: i, from: { ...t } };
      blink = { index: 'held', t: 0, hidden: false };
      return;
    }
    if (t.good === GOOD.bigBoulder) {
      if (unremovable === UNDERGROUND_LIMITS.boulders) return say(msg('BaseDecoration_Text_CantRemoveBigBoulder'));
      if (boulderCount - 1 < unremovable) return say(msg('BaseDecoration_Text_CantRemoveMoreBoulders'));
      se(SE.boulder);
      slots[i] = null;
      boulderCount--;
      blink = null;
      const left = boulderCount - unremovable;
      return say(msg('BaseDecoration_Text_BigBoulderRemoved'), () => {
        if (left === 0) {
          mode = { kind: 'decor' };
          return;
        }
        say(msg(left === 1 ? 'BaseDecoration_Text_CanRemove1MoreBoulder' : 'BaseDecoration_Text_CanRemoveXMoreBoulders', String(left).padStart(2, ' ')), () => {
          mode = { kind: 'decor' };
        });
      });
    }
    se(SE.putAway);
    slots[i] = null;
    placedCount--;
    blink = null;
    return say(msg('BaseDecoration_Text_GoodReturnedToPC', goodName(t.good)), blinkAtCursor);
  };

  const dropMoved = (m: Extract<Mode, { kind: 'move' }>): Step => {
    if (!canPlace(rect(m.held), others(null))) {
      se(SE.cantPlace);
      return say(msg('BaseDecoration_Text_CantPlaceHere'));
    }
    slots[m.index] = { ...m.held };
    se(SE.placed);
    pickAt = { x: m.held.x, z: m.held.z };
    blink = null;
    return say('', () => {
      mode = { kind: 'pick', move: true };
      blinkAtCursor();
    });
  };

  // ---------------------------------------------------------------- views

  const listView = (rows: { name: string; placed: boolean }[], list: List, close: string, heading: string, description: string): UndergroundPcView['list'] => ({ rows, close, cursor: list.cursor, top: list.top, visible: list.visible, heading, description });

  const view = (): UndergroundPcView => {
    const m = mode;
    let list: UndergroundPcView['list'] = null;
    if (m.kind === 'store') {
      const g = u().goods;
      list = listView(g.map((x) => ({ name: goodName(x), placed: false })), m.list, msg('Goods_Text_Close'), msg('PC_Text_GoodsOnHand'), goodDescription(m.list.cursor < g.length ? g[m.list.cursor]! : null));
    } else if (m.kind === 'withdraw') {
      const g = u().goodsPc;
      list = listView(g.map((x) => ({ name: goodName(x), placed: false })), m.list, msg('Goods_Text_Close'), msg('PC_Text_GoodsInPC'), goodDescription(m.list.cursor < g.length ? g[m.list.cursor]! : null));
    } else if (m.kind === 'goods') {
      const g = u().goodsPc;
      const heading = `${msg('BaseDecoration_Text_GoodsSet')}\n${msg('BaseDecoration_Text_GoodsSetTemplate', String(placedCount).padStart(2, ' '), String(maxPlaced).padStart(2, ' '))}`;
      const description = m.list.cursor < g.length ? goodDescription(g[m.list.cursor]!) : bankText('TEXT_BANK_UNDERGROUND_GOODS', bankIndex('TEXT_BANK_UNDERGROUND_GOODS', 'UndergroundGoods_Text_ExitDescription'));
      list = listView(g.map((x, i) => ({ name: goodName(x), placed: pcPlaced(i) })), m.list, msg('Goods_Text_Exit'), heading, description);
    }
    const decorMenu: AppMenu | null = m.kind === 'decor' && !notice ? { entries: DECOR_ENTRIES.map((e) => ({ label: msg(`BaseDecoration_Text_${e}`) })), cursor: decorCursor } : null;
    const description =
      m.kind === 'menu' && !dialog.active ? msg(`PC_Text_${PC_ENTRIES[cursor]}Description`)
      : decorMenu ? msg(`BaseDecoration_Text_${DECOR_ENTRIES[decorCursor]}Description`)
      : null;
    const fade = m.kind === 'fade' ? Math.round(((m.out ? m.t : FADE - m.t) / FADE) * 16) : 0;
    return {
      app: 'ug-pc',
      entries: m.kind === 'menu' ? PC_ENTRIES.map((e) => ({ label: msg(`PC_Text_${e}`) })) : null,
      cursor,
      description,
      list: notice || dialog.active ? (m.kind === 'goods' ? list : null) : list,
      flags:
        m.kind === 'flags'
          ? {
              title: msg('PC_Text_PlayersBase', '', ctx.state.names.player),
              rows: [
                { label: msg('PC_Text_FlagsObtained'), value: msg('PC_Text_FlagsObtainedTemplate', '', '', '', '', '', '', String(SOLO_CAPTURED_FLAGS)) },
                { label: msg('PC_Text_MostRecentFlag'), value: '' },
                ...Array.from({ length: FLAG_RECORDS }, () => ({ label: msg('PC_Text_Blank'), value: msg('PC_Text_IDBlank') })),
              ],
            }
          : null,
      decoration: decorMenu ? { menu: decorMenu, heading: msg('BaseDecoration_Text_Decor') } : null,
      placing: m.kind === 'place' || m.kind === 'pick' || m.kind === 'move',
      message: notice?.text ? { text: notice.text, waiting: false } : (dialog.message() ?? (description ? { text: description, waiting: false } : null)),
      yesNo: dialog.yesNo(),
      fade,
    };
  };

  let pushed = '';
  const pushDecoration = () => {
    const v = inDecoration() ? decorationView() : null;
    const key = JSON.stringify(v);
    if (key === pushed) return;
    pushed = key;
    ctx.host.undergroundDecoration?.(v);
  };

  const tick = (): Step => {
    const m = mode;
    if (blink) {
      blink.t++;
      if (blink.t >= (blink.index === 'held' ? BLINK.held : BLINK.cursor)) {
        blink.t = 0;
        blink.hidden = !blink.hidden;
      }
    }
    if (notice) {
      notice.t++;
      if (notice.t >= NOTICE_TICKS) {
        const then = notice.then;
        notice = null;
        then();
      }
    }
    if (m.kind === 'fade') {
      m.t++;
      if (m.t >= FADE) {
        if (m.out) {
          m.out = false;
          m.t = 0;
          if (m.to === 'decorate') {
            loadEdit();
            decorated = true;
          }
        } else if (m.to === 'decorate') mode = { kind: 'decor' };
        else {
          // DECORATE_STATE_END: SecretBases_LoadCurrentPlayerBase, FLAG_DECORATED_SECRET_BASE, the PC menu.
          ctx.state.flags[tables.base.flags.decorated] = true;
          mode = { kind: 'menu' };
        }
      }
    }
    pushDecoration();
    return;
  };

  const input = (i: { button: string } | { tap: string }): Step => {
    const step = handle(i);
    pushDecoration();
    return step;
  };

  const handle = (i: { button: string } | { tap: string }): Step => {
    if (notice || mode.kind === 'fade') return;
    if (dialog.active) return dialog.input(i as never);
    const b = 'button' in i ? i.button : null;
    const tap = 'tap' in i ? i.tap : null;
    const tile = tap?.match(/^tile:(\d+),(\d+)$/);
    const m = mode;
    const listInput = (l: List, count: number, pickRow: (row: number) => Step, back: () => Step): Step => {
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
      se(SE.confirm);
      return pickRow(row);
    };
    const dpad = (): [number, number] | null => (b === 'up' ? [0, -1] : b === 'down' ? [0, 1] : b === 'left' ? [-1, 0] : b === 'right' ? [1, 0] : null);
    switch (m.kind) {
      case 'menu': {
        if (b === 'up' || b === 'down') {
          const next = Math.max(0, Math.min(PC_ENTRIES.length - 1, cursor + (b === 'up' ? -1 : 1)));
          if (next !== cursor) se(SE.confirm);
          cursor = next;
          return;
        }
        if (b === 'b' || tap === 'back') return pcPick('Exit');
        const pickEntry = tap?.startsWith('entry:') ? Number(tap.slice(6)) : b === 'a' ? cursor : null;
        if (pickEntry === null || !PC_ENTRIES[pickEntry]) return;
        cursor = pickEntry;
        return pcPick(PC_ENTRIES[pickEntry]!);
      }
      case 'store':
        return listInput(m.list, u().goods.length, (row) => store(m, row), toMenu);
      case 'withdraw':
        return listInput(m.list, u().goodsPc.length, (row) => withdraw(m, row), toMenu);
      case 'flags':
        if (b === 'a' || b === 'b' || tap === 'back' || tap === 'next') {
          se(SE.confirm);
          return toMenu();
        }
        return;
      case 'decor': {
        if (b === 'up' || b === 'down') {
          decorCursor = (decorCursor + (b === 'up' ? -1 : 1) + DECOR_ENTRIES.length) % DECOR_ENTRIES.length;
          se(SE.confirm);
          return;
        }
        if (b === 'b' || tap === 'back') return decorPick('Cancel');
        const e = tap?.startsWith('menu:') ? Number(tap.slice(5)) : b === 'a' ? decorCursor : null;
        if (e === null || !DECOR_ENTRIES[e]) return;
        decorCursor = e;
        return decorPick(DECOR_ENTRIES[e]!);
      }
      case 'goods':
        return listInput(m.list, u().goodsPc.length, holdFromPc, () => {
          mode = { kind: 'decor' };
          return;
        });
      case 'place':
      case 'move': {
        const d = dpad();
        if (d) {
          moveHeld(m.held, m.held.x + d[0], m.held.z + d[1]);
          return;
        }
        if (tile) {
          moveHeld(m.held, Number(tile[1]) % BASE.width, Number(tile[2]) % BASE.depth);
          return m.kind === 'place' ? place(m) : dropMoved(m);
        }
        if (b === 'a') return m.kind === 'place' ? place(m) : dropMoved(m);
        if (b === 'b' || tap === 'back') {
          blink = null;
          if (m.kind === 'place') {
            mode = { kind: 'goods', list: new List(() => u().goodsPc.length, GOODS_VISIBLE) };
            return;
          }
          slots[m.index] = m.from;
          mode = { kind: 'pick', move: true };
          blinkAtCursor();
          return;
        }
        return;
      }
      case 'pick': {
        const d = dpad();
        if (d) {
          const x = pickAt.x + d[0];
          const z = pickAt.z + d[1];
          se(SE.cursor);
          if (outOfRoom(rectOf(x, z, 1, 1))) return;
          pickAt = { x, z };
          blinkAtCursor();
          return;
        }
        if (tile) {
          const x = Number(tile[1]) % BASE.width;
          const z = Number(tile[2]) % BASE.depth;
          if (!outOfRoom(rectOf(x, z, 1, 1))) {
            pickAt = { x, z };
            blinkAtCursor();
          }
          return pick(m);
        }
        if (b === 'a') return pick(m);
        if (b === 'b' || tap === 'back') {
          blink = null;
          mode = { kind: 'decor' };
          return;
        }
        return;
      }
    }
  };

  return { view, input: (i) => input(i as never), tick };
}
