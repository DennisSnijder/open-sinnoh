/**
 * The PC boxes (decomp applications/pc_boxes), one mode per Storage System entry (enum BoxMode):
 * - `withdraw`: the box grid; a Pokémon's menu WITHDRAW / SUMMARY / CANCEL.
 * - `deposit`: the party column; STORE / SUMMARY / CANCEL, then "Deposit in which Box?" on the header.
 * - `move`: the grid and the party; MOVE picks a Pokémon up, A puts it down (swapping), B puts it back.
 * - `items`: held items; A takes an item into the hand or gives the one in hand (swapping), B offers to
 *   put it in the Bag.
 * - `compare`: the grid and the party; the compare panel shows the Pokémon under the cursor on its live
 *   side and the one SET ON the other (decomp CompareModeHelper); its menu SET ON LEFT/RIGHT, WITHDRAW or
 *   STORE, MARK, CANCEL.
 * A Pokémon's menu also has MARK (the markings window) and, outside compare mode, RELEASE (decomp
 * BoxAppMan_ReleaseMonAction: the refusals, "Release this Pokémon?" on NO, then released or came back).
 * The header (the box name) switches boxes with left/right (and L/R anywhere); A on it opens the box
 * menu: WALLPAPER (theme, then wallpaper), NAME (the naming screen), CANCEL (compare mode's header menu is
 * JUMP and CANCEL; box jump is not built, so A there does nothing). B asks "Exit from the Box?".
 */
import { isShiny, monGender, PARTY_SIZE, type Button, type Id, type Pokemon } from '@opensinnoh/core';
import { BOX_SIZE, dexOf, type AppMenu, type BoxMonView, type StorageCompare, type StorageCompareSide, type StorageMode, type StorageView } from '@opensinnoh/contracts';
import {
  availableWallpapers,
  BOX_NAME_MAX,
  boxCount,
  deposit,
  giveItemTo,
  monAt,
  moveMon,
  releaseMon,
  releaseRefusal,
  releaseReturns,
  renameBox,
  setMarkings,
  setWallpaper,
  stowItem,
  takeItemFrom,
  withdraw,
  type MonPlace,
  type ReleaseRefusal,
  type StorageRefusal,
} from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { Dialog } from './dialog.ts';
import { namingScreen } from './naming.ts';
import { monName } from './party.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';
import { summaryScreen } from './summary.ts';

type Input = { button: Button } | { tap: string };
const COLUMNS = 6;
const storageText = (n: number) => `pl_msg_00000018_${String(n).padStart(5, '0')}`;
/** Storage system bank messages read by number: the box and Pokémon menus (24–27, 58–77) and the themes and wallpapers (28–57). */
export const STORAGE_MESSAGES = Array.from({ length: 54 }, (_, i) => storageText(24 + i));
/** Decomp box themes: 4 wallpapers each, the last two (FRIENDS) the unlockable ones. */
const THEMES = 6;
const WALLPAPERS_PER_THEME = 4;
const MODE_TITLES: Record<StorageMode, MenuKey> = { deposit: 'pcDeposit', withdraw: 'pcWithdraw', move: 'pcMove', items: 'pcItems', compare: 'pcCompare' };
const REFUSALS: Record<StorageRefusal, MenuKey> = { 'party-full': 'boxPartyFull', 'box-full': 'boxBoxFull', 'last-mon': 'boxLastMon' };
const RELEASE_REFUSALS: Record<ReleaseRefusal, MenuKey> = { egg: 'boxCantReleaseEgg', mail: 'boxRemoveMail', 'last-mon': 'boxLastMon' };
/** The markings window's rows: the six marks, CONFIRM, CANCEL (decomp BOX_MENU_CIRCLE … BOX_MENU_MARK_CANCEL). */
const MARKS = 6;
/** Decomp enum CompareMode, in the compare button's order. */
const COMPARE_PAGES: readonly StorageCompare['page'][] = ['stats', 'contest', 'moves'];
const COMPARE_STATS: MenuKey[] = ['boxNature', 'boxLevel', 'boxHp', 'boxAttack', 'boxDefense', 'boxSpAttack', 'boxSpDefense', 'boxSpeed'];

interface Entry {
  label: string;
  run: () => Step;
}

export function storageScreen(ctx: MenuContext, mode: StorageMode): Screen {
  const t = ctx.text;
  const s = ctx.state;
  const dialog = new Dialog(t.message(storageText(78)), t.message(storageText(79)), (n) => menuSe(ctx, n));
  // Decomp BoxAppMan_InitCursor: deposit starts in the party, compare on the box header.
  let area: StorageView['area'] = mode === 'deposit' ? 'party' : mode === 'compare' ? 'header' : 'box';
  let cursor = 0;
  let menu: { entries: Entry[]; cursor: number } | null = null;
  /** Move mode: where the Pokémon in hand came from. */
  let held: MonPlace | null = null;
  /** Items mode: the item in hand. */
  let heldItem: Id | null = null;
  /** Deposit: the party slot waiting for a box ("Deposit in which Box?"). */
  let depositing: number | null = null;
  /** The markings window: the Pokémon and the marks being edited. */
  let marking: { place: MonPlace; markings: number; cursor: number } | null = null;
  /** Compare mode: the live side, the Pokémon SET ON each side, the page. */
  let live: 0 | 1 = 0;
  const compared: [Pokemon | null, Pokemon | null] = [null, null];
  let comparePage = 0;
  const partyOpen = mode !== 'withdraw';
  /** Party column stops: the members, plus the empty slot after them while a Pokémon is in hand. */
  const partyStops = () => Math.max(1, Math.min(PARTY_SIZE, s.party.length + (held ? 1 : 0)));

  const box = () => s.currentBox;
  const placeOf = (a: StorageView['area'], i: number): MonPlace | null => (a === 'box' ? { area: 'box', box: box(), slot: i } : a === 'party' ? { area: 'party', slot: i } : null);
  const here = () => placeOf(area, cursor);
  const monHere = () => {
    const p = here();
    return p && !(p.area === 'party' && p.slot >= s.party.length) ? monAt(s, p) : null;
  };
  const view = (m: Pokemon): BoxMonView => ({ species: m.species, form: m.form, egg: m.isEgg, heldItem: m.heldItem });
  const say = (key: MenuKey, slots: string[] = [], then: () => Step = () => undefined) => dialog.say(t.pages(key, ...slots), then);
  const openMenu = (entries: Entry[], cancel: string = t.message(storageText(67))): Step => {
    menu = { entries: [...entries, { label: cancel, run: () => void (menu = null) }], cursor: 0 };
    return;
  };
  const switchBox = (d: number) => {
    const n = s.boxes.length;
    s.currentBox = (box() + d + n) % n;
  };
  const refused = (r: StorageRefusal | null, then: () => Step = () => undefined): Step => (r ? say(REFUSALS[r], [], then) : then());

  // --- the Pokémon menu ---
  const summary = (place: MonPlace): Step => {
    menu = null;
    const list = place.area === 'party' ? () => s.party : () => s.boxes[box()]!.slots.filter((m): m is Pokemon => m !== null);
    const slot = place.area === 'party' ? place.slot : list().indexOf(monAt(s, place)!);
    return { push: summaryScreen(ctx, { party: list, slot, mode: { kind: 'view' } }) };
  };
  const withdrawEntry = (place: MonPlace): Entry => ({ label: t.message(storageText(62)), run: () => ((menu = null), refused(withdraw(s, box(), place.slot))) });
  const storeEntry = (place: MonPlace): Entry => ({
    label: t.message(storageText(63)),
    run: () => {
      menu = null;
      depositing = place.slot;
      area = 'header';
      cursor = 0;
      return;
    },
  });
  const markEntry = (place: MonPlace): Entry => ({
    label: t.message(storageText(65)),
    run: () => {
      menu = null;
      marking = { place, markings: monAt(s, place)!.markings, cursor: 0 };
      return;
    },
  });
  /** Decomp box_menu.c BoxMenu_FillTopLevelMenuItems (move mode lists MOVE, SUMMARY, MARK, RELEASE: ITEM and WITHDRAW/STORE are not built there). */
  const monMenu = (place: MonPlace): Step => {
    const entries: Entry[] = [];
    if (mode === 'compare') {
      entries.push({ label: t.message(storageText(76 + live)), run: () => ((menu = null), setCompared()) });
      entries.push(place.area === 'box' ? withdrawEntry(place) : storeEntry(place), markEntry(place));
      return openMenu(entries);
    }
    if (mode === 'withdraw') entries.push(withdrawEntry(place));
    if (mode === 'deposit') entries.push(storeEntry(place));
    if (mode === 'move') entries.push({ label: t.message(storageText(58)), run: () => ((menu = null), void (menuSe(ctx, 1515), held = place)) });
    entries.push({ label: t.message(storageText(61)), run: () => summary(place) }, markEntry(place), { label: t.message(storageText(66)), run: () => release(place) });
    return openMenu(entries);
  };

  // --- RELEASE (decomp BoxAppMan_ReleaseMonAction) ---
  const release = (place: MonPlace): Step => {
    menu = null;
    const r = releaseRefusal(s, ctx.registries, place);
    if (r) return say(RELEASE_REFUSALS[r]);
    return dialog.confirm(
      t.pages('boxReleaseMon'),
      (yes) => {
        if (!yes) return;
        const name = monName(ctx, monAt(s, place)!);
        if (releaseReturns(s, place)) return say('boxMonReturned', [name], () => say('boxMonWorried'));
        releaseMon(s, place);
        if (place.area === 'party') cursor = Math.max(0, Math.min(cursor, s.party.length - 1));
        return say('boxMonReleased', [name], () => say('boxGoodbye', [name]));
      },
      1,
    );
  };

  // --- MARK (decomp BoxAppMan_MarkAction): A toggles a mark, CONFIRM sets them, CANCEL or B drops them ---
  const markRow = (row: number): Step => {
    const m = marking!;
    m.cursor = row;
    if (row < MARKS) m.markings ^= 1 << row;
    else {
      if (row === MARKS) setMarkings(s, m.place, m.markings);
      marking = null;
    }
    return;
  };

  // --- compare mode ---
  /** SET ON LEFT / RIGHT (decomp BOX_MENU_SET_ON_*): the live side keeps the cursor's Pokémon, the other side goes live. */
  const setCompared = (): Step => {
    const mon = monHere();
    if (!mon) return;
    compared[live] = mon;
    live = live === 0 ? 1 : 0;
    return;
  };

  // --- move mode: putting down ---
  const putDown = (to: MonPlace): Step => {
    const from = held!;
    held = null;
    if (from.area === to.area && from.slot === to.slot && (from.area === 'party' || (to.area === 'box' && from.box === to.box))) return;
    const result = moveMon(s, ctx.registries, from, to);
    menuSe(ctx, result ? 1523 : 1514);
    return refused(result);
  };

  // --- items mode ---
  const itemAction = (place: MonPlace): Step => {
    const mon = monAt(s, place);
    if (!mon) return;
    if (mon.isEgg) return say('boxEggNoItem');
    if (heldItem) {
      heldItem = giveItemTo(s, ctx.registries, place, heldItem);
      return;
    }
    if (!mon.heldItem) return say('boxNoItem');
    heldItem = takeItemFrom(s, ctx.registries, place);
    return;
  };
  const putAway = (): Step =>
    dialog.confirm(t.pages('boxPutAway', ctx.registries.items.get(heldItem!)!.name), (yes) => {
      if (!yes) return;
      const item = heldItem!;
      if (!stowItem(s, ctx.registries, item)) return say('boxBagFull');
      heldItem = null;
      return say('boxPlacedInBag', [ctx.registries.items.get(item)!.name]);
    });

  // --- the box menu ---
  const boxMenu = (): Step =>
    openMenu(
      [
        { label: t.message(storageText(25)), run: themeMenu },
        {
          label: t.message(storageText(26)),
          run: () => {
            menu = null;
            const b = box();
            return {
              push: namingScreen(ctx, { app: 'naming', kind: 'box', initial: s.boxes[b]!.name, maxLength: BOX_NAME_MAX, gender: s.gender, pokemon: null }, (name) => {
                if (name !== null) renameBox(s, b, name);
                return 'pop';
              }, () => ctx.host.options().autoLowercase === 0),
            };
          },
        },
      ],
      t.message(storageText(27)),
    );
  const themeMenu = (): Step => {
    const open = availableWallpapers(s);
    const themes = Array.from({ length: THEMES }, (_, i) => i).filter((th) => open.includes(th * WALLPAPERS_PER_THEME));
    return openMenu(
      themes.map((th) => ({
        label: t.message(storageText(28 + th)),
        run: () =>
          openMenu(
            Array.from({ length: WALLPAPERS_PER_THEME }, (_, k) => th * WALLPAPERS_PER_THEME + k)
              .filter((w) => open.includes(w))
              .map((w) => ({ label: t.message(storageText(34 + w)), run: () => void ((menu = null), setWallpaper(s, box(), w)) })),
          ),
      })),
    );
  };

  // --- A on the cursor ---
  const activate = (): Step => {
    if (area === 'header') {
      if (depositing !== null) {
        const slot = depositing;
        depositing = null;
        area = 'party';
        cursor = Math.min(slot, s.party.length - 1);
        const r = deposit(s, ctx.registries, slot, box());
        cursor = Math.max(0, Math.min(cursor, s.party.length - 1));
        return refused(r);
      }
      if (mode === 'compare') return;
      return boxMenu();
    }
    const place = here()!;
    const mon = monHere();
    if (mode === 'move' && held) return putDown(place);
    if (mode === 'items') return itemAction(place);
    if (!mon) return;
    return monMenu(place);
  };
  const back = (): Step => {
    if (depositing !== null) {
      depositing = null;
      area = 'party';
      return;
    }
    if (held) { menuSe(ctx, 1523); held = null; return; }
    if (heldItem) return putAway();
    return dialog.confirm(t.pages('boxConfirmExit'), (yes) => (yes ? { close: { app: 'storage' } } : undefined));
  };

  // --- cursor movement over the header, the 6 × 5 grid and the party column ---
  const move = (b: Button) => {
    if (area === 'header') {
      if (b === 'left' || b === 'right') switchBox(b === 'left' ? -1 : 1);
      else if (b === 'down' && depositing === null && mode !== 'deposit') {
        area = 'box';
        cursor = 0;
      }
      return;
    }
    if (area === 'party') {
      if (b === 'up') cursor = cursor === 0 ? (mode === 'deposit' ? 0 : cursor) : cursor - 1;
      else if (b === 'down') cursor = Math.min(partyStops() - 1, cursor + 1);
      else if (b === 'left' && mode !== 'deposit') {
        area = 'box';
        cursor = Math.min(BOX_SIZE - 1, cursor * COLUMNS + COLUMNS - 1);
      }
      return;
    }
    const col = cursor % COLUMNS;
    if (b === 'up') {
      if (cursor < COLUMNS) area = 'header';
      else cursor -= COLUMNS;
    } else if (b === 'down') cursor = Math.min(BOX_SIZE - 1, cursor + COLUMNS);
    else if (b === 'left') cursor = col > 0 ? cursor - 1 : cursor;
    else if (b === 'right') {
      if (col < COLUMNS - 1) cursor++;
      else if (partyOpen) {
        area = 'party';
        cursor = Math.min(partyStops() - 1, Math.floor(cursor / COLUMNS));
      }
    }
  };

  const previewOf = (m: Pokemon): StorageView['preview'] => {
    const sp = ctx.registries.species.get(m.species)!;
    const natureName = (dexOf(ctx.registries).nature(m.pid) as unknown as { name: string }).name;
    return {
      mon: view(m),
      shiny: isShiny(m.otId, m.pid),
      // Decomp PC preview setup: an Egg's nickname is the heading, and the name line is empty.
      name: m.isEgg ? '' : monName(ctx, m),
      species: m.isEgg ? monName(ctx, m) : sp.name,
      level: m.isEgg ? '' : `${t.t('boxLevel')}${m.level}`,
      gender: m.isEgg ? 'none' : monGender(dexOf(ctx.registries), m),
      fields: m.isEgg
        ? []
        : [
            { label: t.t('boxNature'), value: natureName },
            { label: t.t('sumItem'), value: m.heldItem ? ctx.registries.items.get(m.heldItem)!.name : t.t('boxNoItemLabel') },
            { label: t.t('sumAbility'), value: m.ability ? ctx.registries.abilities.get(m.ability)!.name : t.t('sumNone') },
          ],
      // The preview's type1 and type2 (box_app_manager.c), the second only when it differs.
      types: m.isEgg ? [] : [...new Set(dexOf(ctx.registries).form(m.species, m.form).types)],
      markings: m.markings,
    };
  };

  /** Decomp BoxApp_LoadBoxMonIntoComparison and the compare windows (ov19_021DEC04.c): an Egg shows "???" per row. */
  const compareSide = (m: Pokemon, page: StorageCompare['page']): StorageCompareSide => {
    const unknown = (n: number) => Array.from({ length: n }, () => t.t('boxQuestionMarks'));
    let values: string[] = [];
    if (page === 'stats') {
      const nature = (dexOf(ctx.registries).nature(m.pid) as unknown as { name: string }).name;
      const st = m.stats;
      values = m.isEgg ? unknown(COMPARE_STATS.length) : [nature, String(m.level), ...[st.hp, st.attack, st.defense, st.spAttack, st.spDefense, st.speed].map(String)];
    } else if (page === 'moves') values = m.isEgg ? unknown(4) : m.moves.map((id) => ctx.registries.moves.get(id)!.name);
    // Contest conditions are not in the Pokémon model: nothing raises them yet (no Poffins), so every one is 0, as on a DS Pokémon that never ate one.
    return { mon: view(m), name: monName(ctx, m), values, contest: m.isEgg ? null : [0, 0, 0, 0, 0] };
  };
  const compareView = (): StorageCompare => {
    const page = COMPARE_PAGES[comparePage]!;
    const under = monHere();
    // Decomp ov19_021DF3AC: the live side shows the Pokémon under the cursor (none over an empty slot), the other the one SET there.
    const side = (i: 0 | 1) => {
      const m = i === live ? under : compared[i];
      return m ? compareSide(m, page) : null;
    };
    return {
      page,
      live,
      labels: page === 'stats' ? COMPARE_STATS.map((k) => t.t(k)) : page === 'moves' ? [t.t('boxMove')] : [],
      sides: [side(0), side(1)],
      set: [t.message(storageText(76)), t.message(storageText(77))],
    };
  };

  return {
    view(): StorageView {
      const b = s.boxes[box()]!;
      const inHand = held ? monAt(s, held) : null;
      const under = monHere();
      const menuView: AppMenu | null = menu ? { entries: menu.entries.map((e) => ({ label: e.label })), cursor: menu.cursor } : null;
      let message = dialog.message();
      if (!message && depositing !== null) message = { text: t.t('boxPickDepositBox'), waiting: false };
      if (!message && marking) message = { text: t.t('boxMarkMon'), waiting: false };
      return {
        app: 'storage',
        mode,
        title: t.t(MODE_TITLES[mode]),
        box: { index: box(), name: b.name, wallpaper: b.wallpaper, count: `${boxCount(s, box())}/${BOX_SIZE}` },
        slots: b.slots.map((m) => (m ? view(m) : null)),
        party: Array.from({ length: PARTY_SIZE }, (_, i) => (s.party[i] ? view(s.party[i]!) : null)),
        partyOpen,
        area,
        cursor,
        held: inHand ? { ...view(inHand), name: monName(ctx, inHand) } : null,
        heldItem,
        preview: inHand ? previewOf(inHand) : under ? previewOf(under) : null,
        menu: menuView,
        marking: marking ? { markings: marking.markings, cursor: marking.cursor, confirm: t.message(storageText(68)), cancel: t.message(storageText(69)) } : null,
        compare: mode === 'compare' ? compareView() : null,
        message,
        yesNo: dialog.yesNo(),
        partyButton: t.t('startPokemon'),
        close: t.t('pcSeeYa'),
      };
    },
    input(i: Input): Step {
      if (dialog.active) return dialog.input(i);
      if (marking) {
        const m = marking;
        if ('tap' in i) {
          if (i.tap === 'back') return void (marking = null);
          const n = tapIndex(i.tap, 'mark');
          if (n === null || n < 0 || n > MARKS + 1) return;
          return markRow(n);
        }
        // Decomp BoxMenu_GetMenuNavigation: up/down wrap (8 rows), A picks the row, B cancels.
        if (i.button === 'up' || i.button === 'down') m.cursor = (m.cursor + (i.button === 'up' ? -1 : 1) + MARKS + 2) % (MARKS + 2);
        else if (i.button === 'a') return markRow(m.cursor);
        else if (i.button === 'b') marking = null;
        return;
      }
      if (menu) {
        const m = menu;
        if ('tap' in i) {
          if (i.tap === 'back') { menuSe(ctx, 1500); menu = null; return; }
          const n = tapIndex(i.tap, 'menu');
          if (n === null || n < 0 || n >= m.entries.length) return;
          m.cursor = n;
          menuSe(ctx, 1500);
          return m.entries[n]!.run();
        }
        if (i.button === 'up' || i.button === 'down') { menuSe(ctx, 1500); m.cursor = (m.cursor + (i.button === 'up' ? -1 : 1) + m.entries.length) % m.entries.length; }
        else if (i.button === 'a') { menuSe(ctx, 1500); return m.entries[m.cursor]!.run(); }
        else if (i.button === 'b') { menuSe(ctx, 1500); menu = null; }
        return;
      }
      if ('tap' in i) {
        if (i.tap === 'back' || i.tap === 'close') return back();
        if (i.tap === 'header') {
          area = 'header';
          cursor = 0;
          return activate();
        }
        const d = tapIndex(i.tap, 'box');
        if (d === -1 || d === 1) return void switchBox(d);
        if (mode === 'compare') {
          // Decomp BoxAppMan_RegisterBoxTouchActionOrTryTouchCompareButton: only the live side's button sets, over a Pokémon.
          if (i.tap === 'compare:page') return void (comparePage = (comparePage + 1) % COMPARE_PAGES.length);
          if (tapIndex(i.tap, 'compare') === live) return setCompared();
        }
        const n = tapIndex(i.tap, 'slot');
        if (n !== null && n >= 0 && n < BOX_SIZE && mode !== 'deposit' && depositing === null) {
          area = 'box';
          cursor = n;
          return activate();
        }
        const p = tapIndex(i.tap, 'party');
        if (p !== null && p >= 0 && p < PARTY_SIZE && partyOpen && depositing === null) {
          area = 'party';
          cursor = p;
          return activate();
        }
        return;
      }
      const b = i.button;
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') move(b);
      else if (b === 'l' || b === 'r') switchBox(b === 'l' ? -1 : 1);
      else if (b === 'a') return activate();
      else if (b === 'b') return back();
      return;
    },
  };
}

