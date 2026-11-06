/**
 * The bag (decomp applications/bag): pockets, the item list, the description and, per mode:
 * - `field` (start menu): the action window USE / GIVE / TOSS / REGISTER (DESELECT) / CANCEL built as
 *   MakeItemActionsMenu does; USE runs the item's check (the host's canUseItemFunc, its refusal printed
 *   here), then its use: party items and TMs/HMs open the party, Repel starts its steps, the Coin Case
 *   shows the coins, the Bicycle closes the bag and mounts or dismounts on the field; the rest are logged stubs.
 * - `give`: the party's ITEM → GIVE picks an item.
 * The battle bag (`bag-select`) is battle.ts.
 */
import type { Button, Id } from '@opensinnoh/core';
import { itemCount, type BagView, type Item } from '@opensinnoh/contracts';
import { facingSoil, FIELD_USE, fieldUseOf, isHmItem, isRegistered, itemRecord, toggleRegistered, tossItem, totalAccessories, totalBackdrops, totalSeals, useRepel } from '@opensinnoh/services';
import { poffinCaseScreen } from './poffin-case.ts';
import { menuSe, type MenuContext } from './context.ts';
import { Dialog } from './dialog.ts';
import { partyScreen } from './party.ts';
import { moveCursor, stepCount, tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';

type Input = { button: Button } | { tap: string };

/**
 * `pick` (0.29.0): a script's one-pocket bag (decomp FieldSystem_CreateBagContext with one pocket: OpenItemsBag,
 * OpenBerriesBag): A on an item picks it, B or CLOSE BAG picks none.
 */
export type BagMode =
  | { kind: 'field' }
  | { kind: 'give'; pick: (item: Id) => Step }
  | { kind: 'pick'; pocket: string; done: (item: Id | null) => Step }
  /** 0.31.0: the cooking's berry (decomp BAG_MODE_POFFIN_SINGLEPLAYER): A opens CONFIRM / CANCEL, CONFIRM picks the berry. */
  | { kind: 'poffin'; done: (item: Id | null) => Step };

interface Entry {
  label: string;
  run: () => Step;
}

export function bagScreen(ctx: MenuContext, mode: BagMode): Screen {
  const t = ctx.text;
  const dialog = new Dialog(t.t('bagYes'), t.t('bagNo'), (n) => menuSe(ctx, n));
  let cursor = 0;
  let rustle = 0;
  const rowCursor = (next: number) => {
    if (next !== cursor) { menuSe(ctx, 1740 + rustle); rustle = (rustle + 1) % 3; }
    cursor = next;
  };
  let menu: { entries: Entry[]; cursor: number } | null = null;
  let toss: { item: Id; count: number; max: number } | null = null;
  const pocketIds = t.pocketIds;
  const pocketCount = pocketIds.length;
  const onePocket = mode.kind === 'pick' ? mode.pocket : mode.kind === 'poffin' ? 'berries' : null;
  const only = onePocket ? pocketIds.indexOf(onePocket) : -1;
  if (onePocket && only < 0) throw new Error(`bag: no pocket ${onePocket}`);
  let pocket = mode.kind === 'field' ? ctx.memory.bagPocket : Math.max(0, only);
  const setPocket = (p: number) => {
    if (onePocket) return;
    const next = (p + pocketCount) % pocketCount;
    if (next === pocket) return;
    menuSe(ctx, 1738);
    pocket = next;
    if (mode.kind === 'field') ctx.memory.bagPocket = pocket;
    cursor = 0;
    menu = null;
  };
  const item = (id: Id): Item => itemRecord(ctx.registries, id);
  const rows = (): { item: Id; count: number }[] => {
    return ctx.state.bag[pocketIds[pocket]!] ?? [];
  };
  const clampCursor = () => {
    if (cursor > rows().length) cursor = rows().length;
  };
  const say = (key: MenuKey, slots: string[], then: () => Step = () => undefined) => dialog.say(t.pages(key, ...slots), then);
  const cancel = (): Step => {
    menuSe(ctx, 1500);
    return mode.kind === 'pick' || mode.kind === 'poffin' ? mode.done(null) : 'pop';
  };

  // --- field actions (MakeItemActionsMenu) ---
  const actions = (id: Id): Entry[] => {
    const rec = item(id);
    const out: Entry[] = [];
    // MakeItemActionsMenu: the Bicycle reads WALK while cycling (ITEM_ACTION_WALK runs the same USE).
    const walk = rec.fieldUse === FIELD_USE.bicycle && ctx.state.playerState === 'cycle';
    // MakeItemActionsMenu: a berry while facing empty soil reads PLANT (BerryPatch_IsEmpty) and plants it on the field.
    const plant = rec.pocket === 'berries' && facingSoil(ctx.registries, ctx.state)?.patch.stage === 'none';
    if (plant) out.push({ label: t.t('bagPlant'), run: () => ((menu = null), ctx.host.useFieldItem(id), { close: { app: 'start-menu' } }) });
    // MakeItemActionsMenu: the Poffin Case reads OPEN (ITEM_ACTION_OPEN).
    else if (fieldUseOf(ctx.registries, id) === 'poffin-case') out.push({ label: t.t('bagOpen'), run: () => use(id) });
    else if (fieldUseOf(ctx.registries, id) !== null) out.push({ label: t.t(walk ? 'bagWalk' : 'bagUse'), run: () => use(id) });
    if (!rec.preventToss) {
      out.push({ label: t.t('bagGive'), run: () => ((menu = null), { push: partyScreen(ctx, { kind: 'give', item: id }, () => (clampCursor(), 'pop')) }) });
      if (rec.pocket !== 'tmhms') out.push({ label: t.t('bagToss'), run: () => startToss(id) });
    }
    // With the item wheel (OpenSinnoh option) REGISTER adds to the wheel; otherwise the DS's one registered item.
    const wheel = ctx.host.options().itemWheel === 0;
    if (rec.canRegister) out.push({ label: t.t(isRegistered(ctx.state, id, wheel) ? 'bagDeselect' : 'bagRegister'), run: () => void ((menu = null), toggleRegistered(ctx.state, ctx.registries, id, wheel)) });
    return out;
  };
  /** BagContext_FormatErrorMessage: why a field item cannot be used here. */
  const ERROR_TEXT = { dismount: 'bagCannotDismount', partner: 'bagCannotUseWithPartner', fish: 'bagCannotFish', generic: 'bagCantDoThat' } as const;
  // Decomp ItemActionFunc_Use: the item's canUseItemFunc first (its refusal is printed in the bag), then the use.
  const use = (id: Id): Step => {
    menu = null;
    const error = ctx.host.fieldItemCheck(id);
    if (error) return say(ERROR_TEXT[error], error === 'generic' ? [ctx.state.names.player] : []);
    const kind = fieldUseOf(ctx.registries, id);
    switch (kind) {
      case 'field':
        // UseBicycleFromMenu: back to the field (the bag and the start menu close), where the use runs.
        ctx.host.useFieldItem(id);
        return { close: { app: 'start-menu' } };
      case 'coins':
        return say('bagCoinCase', [String(ctx.state.coins)]);
      case 'fashion':
        // BagContext_FormatUsageMessage: the accessories and backdrops held.
        return say('bagFashionCase', [String(totalAccessories(ctx.state.fashionCase)), String(totalBackdrops(ctx.state.fashionCase))]);
      case 'seals':
        // BagContext_FormatUsageMessage (CalcTotalBallSeals): every seal owned.
        return say('bagSealCase', [String(totalSeals(ctx.state.sealCase))]);
      case 'poffin-case':
        // UsePoffinCaseFromMenu: the Poffin Case app over the bag.
        return { push: poffinCaseScreen(ctx, () => (clampCursor(), 'pop')) };
      case 'party':
        return { push: partyScreen(ctx, { kind: 'use', item: id }, () => (clampCursor(), 'pop')) };
      case 'tm': {
        const move = ctx.registries.moves.get(item(id).tm!)!.name;
        const boot = t.pages(isHmItem(ctx.registries, id) ? 'bagBootedHm' : 'bagBootedTm');
        return dialog.confirm([...boot, ...t.pages('bagTmContained', move)], (yes) => (yes ? { push: partyScreen(ctx, { kind: 'teach', item: id }, () => (clampCursor(), 'pop')) } : undefined));
      }
      case 'repel':
        if (!useRepel(ctx.state, ctx.registries, id)) return say('bagRepelLingers', []);
        menuSe(ctx, 1536);
        clampCursor();
        return say('bagUsedRepel', [ctx.state.names.player, item(id).name]);
      case 'stub':
      case null:
        ctx.log.stub(`menus:item-use:${id}`, `using ${id} from the bag is not implemented yet (field use ${item(id).fieldUse})`);
        return;
    }
  };
  const startToss = (id: Id): Step => {
    menu = null;
    const have = itemCount(ctx.state, id);
    if (have === 1) return askToss(id, 1);
    toss = { item: id, count: 1, max: Math.min(999, have) };
    return;
  };
  const askToss = (id: Id, count: number): Step =>
    dialog.confirm(t.pages('bagTossOk', item(id).name, String(count)), (yes) => {
      if (!yes) return;
      tossItem(ctx.state, id, count);
      clampCursor();
      return say('bagThrewAway', [item(id).name, String(count)]);
    });

  const select = (row: number): Step => {
    cursor = row;
    const r = rows()[row];
    if (!r) return cancel();
    menuSe(ctx, 1500);
    switch (mode.kind) {
      case 'field': {
        const entries = actions(r.item);
        menu = { entries: [...entries, { label: t.t('bagCancel'), run: () => void (menu = null) }], cursor: 0 };
        return;
      }
      case 'give':
        return mode.pick(r.item);
      case 'pick':
        return mode.done(r.item);
      case 'poffin': {
        // MakeItemActionsMenu (BAG_MODE_POFFIN_SINGLEPLAYER): CONFIRM, CHECK TAG (the berry tag app: not built), CANCEL.
        const pick = mode.done;
        menu = { entries: [{ label: t.t('bagConfirm'), run: () => ((menu = null), pick(r.item)) }, { label: t.t('bagCancel'), run: () => void (menu = null) }], cursor: 0 };
        return;
      }
    }
  };

  const pocketLabels = (): string[] => (onePocket ? [t.pocket(onePocket)] : pocketIds.map((p) => t.pocket(p)));

  return {
    view(): BagView {
      const keyPocket = pocketIds[pocket] === 'key_items';
      const list = rows().map(({ item: id, count }) => ({ item: id, label: item(id).name, count: keyPocket ? null : `${t.t('bagCountX')}${count}`, registered: isRegistered(ctx.state, id, ctx.host.options().itemWheel === 0) }));
      const selected = list[cursor];
      return {
        app: 'bag',
        mode: mode.kind,
        title: t.t('startBag'),
        pockets: pocketLabels(),
        pocketTypes: onePocket ? [only] : pocketIds.map((_, i) => i),
        pocket: onePocket ? 0 : pocket,
        rows: list,
        cancel: t.t(mode.kind === 'field' || mode.kind === 'pick' || mode.kind === 'poffin' ? 'bagCloseBag' : 'bagCancel'),
        cursor,
        description: selected ? t.text(item(selected.item).description) : t.t('bagCloseDescription'),
        menu: menu ? { entries: menu.entries.map((e) => ({ label: e.label })), cursor: menu.cursor } : null,
        message: dialog.message() ?? (toss ? { text: t.t('bagTossHowMany', item(toss.item).name), waiting: false } : null),
        quantity: toss ? { count: t.t('bagTossCount', String(toss.count).padStart(3, '0')) } : null,
        yesNo: dialog.yesNo(),
        ...(mode.kind === 'poffin' ? { poffins: { label: t.t('bagPoffinCount'), value: t.t('bagPoffinCountNum', String(ctx.state.poffins.length)) } } : {}),
      };
    },
    input(i: Input): Step {
      if (dialog.active) return dialog.input(i);
      if (toss) {
        const q = toss;
        const quantity = (next: number) => { if (q.count !== next) menuSe(ctx, 1592); q.count = next; };
        if ('tap' in i) {
          const m = /^qty:([+-])(1|10)$/.exec(i.tap);
          if (m) quantity(stepCount(q.count, q.max, m[2] === '1' ? (m[1] === '+' ? 'up' : 'down') : m[1] === '+' ? 'right' : 'left'));
          else if (i.tap === 'ok') return ((toss = null), askToss(q.item, q.count));
          else if (i.tap === 'back') toss = null;
          return;
        }
        const b = i.button;
        if (b === 'up' || b === 'down' || b === 'left' || b === 'right') quantity(stepCount(q.count, q.max, b));
        else if (b === 'a') return ((toss = null), askToss(q.item, q.count));
        else if (b === 'b') toss = null;
        return;
      }
      if (menu) {
        const m = menu;
        if ('tap' in i) {
          if (i.tap === 'back') { menuSe(ctx, 1500); menu = null; return; }
          const n = tapIndex(i.tap, 'menu');
          if (n === null || n < 0 || n >= m.entries.length) return;
          m.cursor = n;
          menuSe(ctx, 1500); return m.entries[n]!.run();
        }
        if (i.button === 'up' || i.button === 'down') {
          const next = moveCursor(m.cursor, m.entries.length, 1, i.button);
          if (next !== m.cursor) menuSe(ctx, 1500);
          m.cursor = next;
        }
        else if (i.button === 'a') { menuSe(ctx, 1500); return m.entries[m.cursor]!.run(); }
        else if (i.button === 'b') { menuSe(ctx, 1500); menu = null; }
        return;
      }
      if ('tap' in i) {
        if (i.tap === 'cancel' || i.tap === 'back') return cancel();
        if (i.tap === 'prev' || i.tap === 'next') return void setPocket(pocket + (i.tap === 'prev' ? -1 : 1));
        const p = tapIndex(i.tap, 'pocket');
        if (p !== null && p >= 0 && p < pocketCount && !onePocket) return void setPocket(p);
        const n = tapIndex(i.tap, 'row');
        return n !== null && n >= 0 && n < rows().length ? select(n) : undefined;
      }
      const b = i.button;
      // D-pad left/right and the shoulders switch pockets (decomp DoDPadPocketSwitch).
      if (b === 'left' || b === 'l') setPocket(pocket - 1);
      else if (b === 'right' || b === 'r') setPocket(pocket + 1);
      else if (b === 'up' || b === 'down') rowCursor(moveCursor(cursor, rows().length + 1, 1, b));
      else if (b === 'a') return select(cursor);
      else if (b === 'b') return cancel();
      return;
    },
  };
}
