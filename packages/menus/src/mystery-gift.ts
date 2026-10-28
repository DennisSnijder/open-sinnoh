/**
 * Mystery Gift (decomp main_menu/mystery_gift_app.c and wonder_cards_app.c) from the title's main menu. "Welcome to
 * Mystery Gift!" over RECEIVE GIFT, CHECK CARD (with a Wonder Card saved) and EXIT. RECEIVE GIFT asks for a gift code
 * on the naming keyboard: our addition in place of the DS's wireless, Wi-Fi and friend reception. Then the DS's own
 * steps: "Searching for a gift…", the Wonder Card with "Receive this gift?", "Receiving your gift…", and "The gift has
 * been received! Please pick up your gift from the deliveryman in any Poké Mart.", after which the DS returns to the
 * title. Refusals are the DS's messages: no gift for the code (NoGiftsToBeFound), already received
 * (AlreadyReceivedCantGetAnotherOne), no free card slot (OutOfRoomForWonderCards), the deliveryman's slots full
 * (DeliveryManOverloaded). CHECK CARD shows the saved cards (left and right), INFO turns a card over (the date
 * received, whether the gift still waits at a Poké Mart), TRASH throws it away (a gift not picked up goes with it).
 * Sounds (mystery_gift_app.c, wonder_cards_app.c, main_menu_util.c MainMenuUtil_ListMenuCursorCB): SE_CONFIRM on a
 * list's cursor move, choice and cancel, and when "no gift" shows; SEQ_SE_DP_UG_020 when the gift is received;
 * SEQ_SE_DP_CARD2 on another card and on turning a card over; SEQ_SE_DP_SAVE once a trashed card is saved away.
 */
import { forLanguage, type Button, type Id } from '@opensinnoh/core';
import { MYSTERY_GIFT_TEXT, MYSTERY_GIFTS, type AppHost, type GameState, type MysteryGiftId, type MysteryGiftView, type Registries, type StubLog } from '@opensinnoh/contracts';
import { cardGiftPending, gameLanguage, giftForCode, giftReceivable, GIFT_CODE_LENGTH, mysteryGiftOf, receiveGift, trashCard } from '@opensinnoh/services';
import { menuSe } from './context.ts';
import { Dialog } from './dialog.ts';
import { namingScreen } from './naming.ts';
import { moveCursor, tapIndex, type Screen, type Step } from './stack.ts';
import { MenuText } from './strings.ts';

type Input = { button: Button } | { tap: string };

/** Sequence numbers (SDAT): SE_CONFIRM, SEQ_SE_DP_CARD2, SEQ_SE_DP_SAVE, SEQ_SE_DP_UG_020. */
const SE_CONFIRM = 1500;
const SE_CARD = 1536;
const SE_SAVE = 1563;
const SE_RECEIVED = 1572;

const M = (name: string) => `MysteryGiftMenu_Text_${name}`;
const TEXT = {
  welcome: M('Welcome'),
  searching: M('SearchingForGift'),
  receiveThis: M('ReceiveThisGift'),
  receiving: M('ReceivingGiftDontTurnOff'),
  received: M('GiftReceivedPickUpInPokeMart'),
  receiveGift: M('ReceiveGift'),
  checkCard: M('CheckCard'),
  exit: M('Exit_MysteryGift'),
  yes: M('Yes_MysteryGift'),
  no: M('No_MysteryGift'),
  overloaded: M('DeliveryManOverloaded'),
  already: M('AlreadyReceivedCantGetAnotherOne'),
  none: M('NoGiftsToBeFound'),
  noCardRoom: M('OutOfRoomForWonderCards'),
  wonderCard: M('WonderCard'),
  pickUp: M('PleasePickUpInPokeMart'),
  receivedBefore: M('AlreadyReceivedBefore'),
  dateReceived: M('DateReceived'),
  info: M('Info'),
  trash: M('Trash'),
  exitCards: M('Exit_WonderCards'),
  dateTemplate: M('DateTemplate'),
  throwAway: M('ThrowCardAway'),
  notPickedUp: M('HaventReceivedGiftYet'),
  discarding: M('DiscardingDontTurnOff'),
} as const;
export const MYSTERY_GIFT_MESSAGES = Object.values(TEXT);

/** How long the waits show, in 30 Hz ticks (the DS's search and save take about this long). */
export const SEARCH_TICKS = 60;
export const RECEIVE_TICKS = 90;
export const DISCARD_TICKS = 30;

export interface MysteryGiftOptions {
  registries: Registries;
  /** The save's state; receiving and trashing edit its `mysteryGift`. */
  state: GameState;
  /** Today (yyyy-mm-dd): the received date on the card. */
  date(): string;
  /** The sound effects go to `host.sound` (none: silent, as in headless replays). */
  host: Pick<AppHost, 'sound'>;
  log: StubLog;
}

export function mysteryGiftScreen(o: MysteryGiftOptions, done: (received: boolean) => Step): Screen {
  const t = new MenuText(o.registries, MYSTERY_GIFT_MESSAGES);
  const ctx = { registries: o.registries, text: t, host: o.host, log: o.log };
  const se = (n: number) => menuSe(ctx, n);
  const dialog = new Dialog(t.message(TEXT.yes), t.message(TEXT.no), se);
  const mg = () => mysteryGiftOf(o.state);
  const cards = () => mg().cards.flatMap((c, slot) => (c ? [slot] : []));
  const speciesId = (n: number): Id => {
    const s = [...o.registries.species.values()].find((x) => x.sourceIndex === n);
    if (!s) throw new Error(`mystery gift: no species ${n}`);
    return s.id;
  };

  type Mode = { kind: 'menu' } | { kind: 'wait'; text: string; ticks: number; then: () => Step } | { kind: 'offer'; gift: MysteryGiftId } | { kind: 'cards'; index: number; back: boolean };
  let mode: Mode = { kind: 'menu' };
  let cursor = 0;

  const mainEntries = () => [TEXT.receiveGift, ...(cards().length ? [TEXT.checkCard] : []), TEXT.exit];
  const cardEntries = [TEXT.info, TEXT.trash, TEXT.exitCards];
  const toMenu = (): Step => {
    mode = { kind: 'menu' };
    cursor = 0;
    return;
  };
  const wait = (text: string, ticks: number, then: () => Step): Step => {
    mode = { kind: 'wait', text, ticks, then };
    return;
  };

  /** The code the naming screen returned; `resume` searches for it. */
  let pendingCode: string | null = null;
  const search = (code: string): Step =>
    wait(t.message(TEXT.searching), SEARCH_TICKS, () => {
      const gift = giftForCode(code);
      if (!gift) {
        se(SE_CONFIRM);
        return dialog.say(t.messagePages(TEXT.none), toMenu);
      }
      const can = giftReceivable(o.state, gift);
      if (can !== 'ok') return dialog.say(t.messagePages(can === 'already' ? TEXT.already : can === 'cards' ? TEXT.noCardRoom : TEXT.overloaded), toMenu);
      mode = { kind: 'offer', gift };
      return dialog.confirm(t.messagePages(TEXT.receiveThis), (yes) => {
        if (!yes) return toMenu();
        return wait(t.message(TEXT.receiving), RECEIVE_TICKS, () => {
          receiveGift(o.state, gift, o.date());
          se(SE_RECEIVED);
          return dialog.say(t.messagePages(TEXT.received), () => done(true));
        });
      });
    });

  /** A list's cursor move: SE_CONFIRM when it moved. */
  const moveTo = (next: number) => {
    if (next !== cursor) se(SE_CONFIRM);
    cursor = next;
  };

  const choose = (): Step => {
    se(SE_CONFIRM);
    const entry = mainEntries()[cursor]!;
    if (entry === TEXT.exit) return done(false);
    if (entry === TEXT.checkCard) {
      mode = { kind: 'cards', index: 0, back: false };
      cursor = 0;
      return;
    }
    return {
      push: namingScreen(ctx, { app: 'naming', kind: 'gift-code', initial: '', maxLength: GIFT_CODE_LENGTH, gender: o.state.gender, pokemon: null }, (code) => {
        pendingCode = code;
        return 'pop';
      }),
    };
  };

  const cardInput = (m: Extract<Mode, { kind: 'cards' }>, b: Button): Step => {
    const n = cards().length;
    if (b === 'left' || b === 'right') {
      const index = (m.index + (b === 'left' ? n - 1 : 1)) % n;
      if (index !== m.index) se(SE_CARD);
      m.index = index;
      m.back = false;
      return;
    }
    if (b === 'up' || b === 'down') return void moveTo(moveCursor(cursor, cardEntries.length, 1, b));
    if (b !== 'a' && b !== 'b') return;
    se(SE_CONFIRM);
    if (b === 'b') return toMenu();
    const entry = cardEntries[cursor]!;
    if (entry === TEXT.exitCards) return toMenu();
    if (entry === TEXT.info) {
      se(SE_CARD);
      m.back = !m.back;
      return;
    }
    const slot = cards()[m.index]!;
    return dialog.confirm(
      t.messagePages(cardGiftPending(o.state, slot) ? TEXT.notPickedUp : TEXT.throwAway),
      (yes) => {
        if (!yes) return;
        return wait(t.message(TEXT.discarding), DISCARD_TICKS, () => {
          trashCard(o.state, slot);
          se(SE_SAVE);
          if (!cards().length) return toMenu();
          mode = { kind: 'cards', index: Math.min(m.index, cards().length - 1), back: false };
          return;
        });
      },
      1,
    );
  };

  const cardView = (gift: MysteryGiftId, slot: number | null, back: boolean, index: number, count: number): MysteryGiftView['card'] => {
    const def = MYSTERY_GIFTS[gift];
    const words = forLanguage(gameLanguage(o.registries), MYSTERY_GIFT_TEXT)[gift];
    const card = slot === null ? null : mg().cards[slot]!;
    let backSide: { date: string; status: string } | null = null;
    if (back && card && slot !== null) {
      const [y, mo, d] = card.received.split('-').map(Number) as [number, number, number];
      backSide = { date: `${t.message(TEXT.dateReceived)}  ${t.message(TEXT.dateTemplate, String(y), t.month(mo - 1), String(d))}`, status: t.message(cardGiftPending(o.state, slot) ? TEXT.pickUp : TEXT.receivedBefore) };
    }
    return { title: words.title, description: words.description, species: speciesId(def.species), label: t.message(TEXT.wonderCard), back: backSide, index, count };
  };

  return {
    view(): MysteryGiftView {
      const m = mode;
      if (m.kind === 'wait') return { app: 'mystery-gift', menu: null, card: null, message: { text: m.text, waiting: false }, yesNo: null, busy: true };
      if (m.kind === 'offer') return { app: 'mystery-gift', menu: null, card: cardView(m.gift, null, false, 0, 1), message: dialog.message(), yesNo: dialog.yesNo(), busy: false };
      if (m.kind === 'cards') {
        const slots = cards();
        const slot = slots[m.index]!;
        return { app: 'mystery-gift', menu: dialog.active ? null : { entries: cardEntries.map((e) => ({ label: t.message(e) })), cursor }, card: cardView(mg().cards[slot]!.gift, slot, m.back, m.index, slots.length), message: dialog.message(), yesNo: dialog.yesNo(), busy: false };
      }
      return { app: 'mystery-gift', menu: dialog.active ? null : { entries: mainEntries().map((e) => ({ label: t.message(e) })), cursor }, card: null, message: dialog.message() ?? { text: t.message(TEXT.welcome), waiting: false }, yesNo: dialog.yesNo(), busy: false };
    },
    tick(): Step {
      const m = mode;
      if (m.kind !== 'wait') return;
      if (--m.ticks > 0) return;
      mode = { kind: 'menu' };
      return m.then();
    },
    resume(): Step {
      // Back from the code entry: search for its gift, or the menu again (nothing entered).
      const code = pendingCode;
      pendingCode = null;
      return code === null ? toMenu() : search(code);
    },
    input(i: Input): Step {
      if (mode.kind === 'wait') return;
      if (dialog.active) return dialog.input(i);
      const m = mode;
      if ('tap' in i) {
        if (i.tap === 'back') return this.input({ button: 'b' });
        if (m.kind === 'cards' && (i.tap === 'card:prev' || i.tap === 'card:next')) return cardInput(m, i.tap === 'card:prev' ? 'left' : 'right');
        const n = tapIndex(i.tap, 'menu');
        if (n === null) return;
        if (m.kind === 'cards' && n >= 0 && n < cardEntries.length) return (cursor = n), cardInput(m, 'a');
        if (m.kind === 'menu' && n >= 0 && n < mainEntries().length) return (cursor = n), choose();
        return;
      }
      if (m.kind === 'cards') return cardInput(m, i.button);
      if (m.kind !== 'menu') return;
      const b = i.button;
      if (b === 'up' || b === 'down') moveTo(moveCursor(cursor, mainEntries().length, 1, b));
      else if (b === 'a') return choose();
      else if (b === 'b') {
        se(SE_CONFIRM);
        return done(false);
      }
      return;
    },
  };
}
