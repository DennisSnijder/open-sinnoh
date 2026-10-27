/**
 * The battle's bag and party (drawn by the bag and party views in their
 * `battle` mode): the `bag-select` and `party-select` apps a battle opens through the game. They read the
 * battle's own party and bag from the request (not the state, which the battle does not touch until it
 * ends) and return the pick; the battle validates it again and plays it.
 *
 * Bag (decomp battle_bag.c): the four battle pockets, HP/PP RESTORE, STATUS HEALERS, POKé BALLS, BATTLE
 * ITEMS, filled from the bag by each item's `battlePocket` bits in bag order (BattleBag_Init). A medicine
 * asks "Use on which Pokémon?" and is refused with "It won't have any effect." when it would do nothing
 * (core `medicineEffect`), after which A, B or a tap goes back to the bag (BattlePartyTask_UseItem: no selection,
 * TASK_STATE_EXIT; the bag reopens); a ball with the party and the PC full and a battle item that would do nothing
 * are refused in the bag. Party (decomp battle_party.c): sending in the active Pokémon, a fainted one or an
 * Egg is refused with the DS messages; after a faint the party cannot be cancelled. A one-move PP item
 * (Ether, Leppa Berry) then asks "Restore which move?" over the Pokémon's moves. The DS's SHIFT /
 * SUMMARY / CHECK MOVES submenu is not here: selecting a Pokémon sends it in.
 */
import { maxPp, medicineEffect, type Bag, type Button, type Id } from '@opensinnoh/core';
import { dexOf, type AppRequest, type BagView, type Item, type PartyView } from '@opensinnoh/contracts';
import type { MenuContext } from './context.ts';
import { moveCursor, tapIndex, type Screen, type Step } from './stack.ts';
import { monName, slotView } from './party.ts';
import type { MenuKey } from './strings.ts';

type Input = { button: Button } | { tap: string };
type BagRequest = Extract<AppRequest, { app: 'bag-select' }>;
type PartyRequest = Extract<AppRequest, { app: 'party-select' }>;

/** decomp POCKET_*: the field pocket each battle pocket is drawn as (its icon and the bag picture). */
const POCKET_MEDICINE = 1;
const POCKET_BALLS = 2;
const POCKET_BATTLE_ITEMS = 6;
/** decomp BATTLE_POCKET_INDEX_* order, each with the battlePocket mask bits it collects (BattleBag_Init's sBattlePocketIndexes). */
const POCKETS: { bits: number; label: MenuKey[]; type: number }[] = [
  { bits: 4 | 16, label: ['battleBagHpPp', 'battleBagRestore'], type: POCKET_MEDICINE },
  { bits: 8, label: ['battleBagStatus', 'battleBagHealers'], type: POCKET_MEDICINE },
  { bits: 1, label: ['battleBagBalls'], type: POCKET_BALLS },
  { bits: 2, label: ['battleBagItems'], type: POCKET_BATTLE_ITEMS },
];
const BALLS = 1;
const BATTLE_ITEMS = 2;
/** decomp BATTLE_USE_CATEGORY_ESCAPING. */
const ESCAPE = 3;

const item = (ctx: MenuContext, id: Id): Item => {
  const rec = ctx.registries.items.get(id);
  if (!rec) throw new Error(`battle bag: unknown item ${id}`);
  return rec;
};

/** The items of one battle pocket, in bag order. */
function pocketItems(ctx: MenuContext, bag: Bag, bits: number): { item: Id; count: number }[] {
  return Object.values(bag)
    .flat()
    .filter((s) => s.count > 0 && item(ctx, s.item).battlePocket & bits);
}

export function battleBagScreen(ctx: MenuContext, req: BagRequest): Screen {
  let cursor = 0;
  let message: string | null = null;
  const rows = () => pocketItems(ctx, req.bag, POCKETS[ctx.memory.battlePocket]!.bits);
  const switchPocket = (p: number) => {
    ctx.memory.battlePocket = (p + POCKETS.length) % POCKETS.length;
    cursor = 0;
  };
  const select = (row: number): Step => {
    cursor = row;
    const slot = rows()[row];
    if (!slot) return { close: { app: 'bag-select', item: null, target: null } };
    const rec = item(ctx, slot.item);
    const done: Step = { close: { app: 'bag-select', item: rec.id, target: null } };
    if (rec.battlePocket & BALLS) {
      // Two wild Pokémon stand (a wild double with the partner): no ball (decomp BattleBag_Text_CantUseBallTwoPokemon).
      if (req.twoWild) message = ctx.text.t('battleBagTwoWild');
      else if (req.noRoomForBall) message = ctx.text.t('battleBagNoRoom');
      return req.twoWild || req.noRoomForBall ? undefined : done;
    }
    if (rec.battleUse === ESCAPE) return done;
    if (rec.battlePocket & BATTLE_ITEMS) {
      if (req.noEffect.includes(rec.id)) {
        message = ctx.text.t('battleBagNoUse');
        return;
      }
      return done;
    }
    return { push: battlePartyScreen(ctx, { app: 'party-select', mode: 'battle', party: req.party, active: req.active, forced: false }, rec) };
  };
  return {
    view(): BagView {
      const list = rows().map((s) => ({ item: s.item, label: item(ctx, s.item).name, count: `${ctx.text.t('bagCountX')}${s.count}`, registered: false }));
      const selected = list[cursor];
      return {
        app: 'bag',
        title: ctx.text.t('startBag'),
        pockets: POCKETS.map((p) => p.label.map((k) => ctx.text.t(k)).join(' ')),
        pocketTypes: POCKETS.map((p) => p.type),
        pocket: ctx.memory.battlePocket,
        rows: list,
        cancel: ctx.text.t('bagCancel'),
        cursor,
        description: selected ? ctx.text.text(item(ctx, selected.item).description) : '',
        mode: 'battle',
        message: message === null ? null : { text: message, waiting: false },
        menu: null,
        quantity: null,
        yesNo: null,
      };
    },
    input(i: Input): Step {
      message = null;
      if ('tap' in i) {
        if (i.tap === 'cancel' || i.tap === 'back') return select(rows().length);
        if (i.tap === 'prev' || i.tap === 'next') return void switchPocket(ctx.memory.battlePocket + (i.tap === 'prev' ? -1 : 1));
        const p = tapIndex(i.tap, 'pocket');
        if (p !== null && p >= 0 && p < POCKETS.length) return void switchPocket(p);
        const n = tapIndex(i.tap, 'row');
        return n !== null && n >= 0 && n < rows().length ? select(n) : undefined;
      }
      const b = i.button;
      if (b === 'left' || b === 'l') switchPocket(ctx.memory.battlePocket - 1);
      else if (b === 'right' || b === 'r') switchPocket(ctx.memory.battlePocket + 1);
      else if (b === 'up' || b === 'down') cursor = moveCursor(cursor, rows().length + 1, 1, b);
      else if (b === 'a') return select(cursor);
      else if (b === 'b') return select(rows().length);
      return;
    },
  };
}

/**
 * The battle party: send a Pokémon in (`party-select`), or with `medicine` choose who gets it ("Use on
 * which Pokémon?"; B goes back to the bag).
 */
export function battlePartyScreen(ctx: MenuContext, req: PartyRequest, medicine?: Item): Screen {
  let cursor = Math.min(req.active, req.party.length - 1);
  let message: string | null = null;
  /** The message is a medicine's refusal: its dismissal goes back to the bag. */
  let toBag = false;
  /** A one-move PP item's move list for the picked Pokémon (decomp battle_party.c "Restore which move?"). */
  let moves: { slot: number; cursor: number } | null = null;
  const cancelable = !req.forced;
  const stops = () => req.party.length + (cancelable ? 1 : 0);
  const cancel = (): Step => (!cancelable ? undefined : medicine ? 'pop' : { close: { app: 'party-select', slot: null } });
  const refuse = (): undefined => {
    message = ctx.text.t('battlePartyNoEffect');
    toBag = true;
  };
  const select = (slot: number): Step => {
    cursor = slot;
    const mon = req.party[slot];
    if (!mon) return cancel();
    const name = monName(ctx, mon);
    if (medicine) {
      const use = medicine.partyUse;
      if (use?.flags.includes('ppRestore') && !mon.isEgg) {
        moves = { slot, cursor: 0 };
        return;
      }
      if (!use || !medicineEffect(dexOf(ctx.registries), mon, use)) return refuse();
      return { close: { app: 'bag-select', item: medicine.id, target: slot } };
    }
    // In a double the player commands alone, the other battler's Pokémon is in battle too and the first command's
    // pick is taken (decomp CheckCanSwitchPokemon: partnerPokemonPartySlot, doubleBattleFirstSelectedPartySlot).
    if (mon.isEgg) message = ctx.text.t('battlePartyEgg');
    else if (slot === req.active || slot === req.inBattle) message = ctx.text.t('battlePartyInBattle', name);
    else if (mon.hp === 0) message = ctx.text.t('battlePartyFainted', name);
    else if (slot === req.selected) message = ctx.text.t('battlePartySelected', name);
    else return { close: { app: 'party-select', slot } };
    return;
  };
  /** The move picked for a one-move PP item: refused when its PP is full. */
  const pickMove = (index: number): Step => {
    const m = moves!;
    if (index >= req.party[m.slot]!.moves.length) {
      moves = null;
      return;
    }
    m.cursor = index;
    if (!medicineEffect(dexOf(ctx.registries), req.party[m.slot]!, medicine!.partyUse!, index)) {
      moves = null;
      return refuse();
    }
    return { close: { app: 'bag-select', item: medicine!.id, target: m.slot, move: index } };
  };
  const moveMenu = (): PartyView['menu'] => {
    if (!moves) return null;
    const mon = req.party[moves.slot]!;
    const dex = dexOf(ctx.registries);
    const entries = mon.moves.map((id, i) => ({ label: ctx.registries.moves.get(id)!.name, right: `${mon.pp[i]}/${maxPp(dex.move(id).pp, mon.ppUps[i] ?? 0)}` }));
    return { entries: [...entries, { label: ctx.text.t('partyContextCancel') }], cursor: moves.cursor };
  };
  return {
    view(): PartyView {
      const prompt = ctx.text.t(moves ? 'partyRestoreWhichMove' : medicine ? 'battlePartyUseOn' : 'battlePartyChoose');
      return {
        app: 'party',
        title: ctx.text.t('startPokemon'),
        mode: 'battle',
        slots: Array.from({ length: 6 }, (_, i) => (req.party[i] ? slotView(ctx, req.party[i]!) : null)),
        prompt,
        cancel: cancelable ? ctx.text.t('partyCancel') : '',
        cursor: cursor === req.party.length ? 6 : cursor,
        moving: null,
        notes: [null, null, null, null, null, null],
        menu: moveMenu(),
        // The DS prints a refusal in its error window (BATTLE_PARTY_MESSAGE_BOX_ERROR, 27 × 4 tiles: two lines), not the
        // one-line prompt, and waits for A, B or a tap (BattlePartyTask_AwaitingInput): a send-in refusal goes back to the
        // pick, a medicine's to the bag.
        message: message === null ? null : { text: message, waiting: false },
        yesNo: null,
      };
    },
    input(i: Input): Step {
      if (message !== null) {
        if (!('tap' in i) && i.button !== 'a' && i.button !== 'b') return;
        message = null;
        return toBag ? 'pop' : undefined;
      }
      if (moves) {
        const m = moves;
        const count = req.party[m.slot]!.moves.length + 1;
        if ('tap' in i) {
          if (i.tap === 'back') return void (moves = null);
          const n = tapIndex(i.tap, 'menu');
          return n !== null && n >= 0 && n < count ? pickMove(n) : undefined;
        }
        if (i.button === 'up' || i.button === 'down') m.cursor = moveCursor(m.cursor, count, 1, i.button);
        else if (i.button === 'a') return pickMove(m.cursor);
        else if (i.button === 'b') moves = null;
        return;
      }
      if ('tap' in i) {
        if (i.tap === 'cancel' || i.tap === 'back') return cancel();
        const n = tapIndex(i.tap, 'slot');
        return n !== null && n >= 0 && n < req.party.length ? select(n) : undefined;
      }
      const b = i.button;
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') cursor = moveCursor(cursor, stops(), 2, b);
      else if (b === 'a') return select(cursor);
      else if (b === 'b') return cancel();
      return;
    },
  };
}
