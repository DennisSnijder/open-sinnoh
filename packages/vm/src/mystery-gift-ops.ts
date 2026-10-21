/**
 * Mystery Gift's script commands: the Poké Mart deliveryman (decomp scrcmd_mystery_gift.c ScrCmd_MysteryGiftGive and
 * its gift handlers, over the save's gifts: services mystery-gift.ts, contracts `giveMysteryGift`), the message his
 * script prints from a bank (ScrCmd_MessageFromBank), and the Jubilife TV questionnaire that unlocks Mystery Gift
 * (ScrCmd_ChooseCustomMessageWord(s), ScrCmd_CheckIsMysteryGiftPhrase, ScrCmd_UnlockMysteryGift).
 */
import { canReceiveMysteryGift, DEV_EVENTS, giveMysteryGift, MYSTERY_GIFTS, type AppResult } from '@opensinnoh/contracts';
import { easyChatWordText, firstDelivery, mysteryGiftOf, takeFirstDelivery, WORD_NONE } from '@opensinnoh/services';
import { plainMarkup, TEXT_SPEED, toPrintOps } from '@opensinnoh/text';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp generated/mystery_gift_delivery_stages.txt. */
const STAGE = { load: 0, checkAvailable: 1, getType: 2, checkCanReceive: 3, give: 4, received: 5, cantReceive: 6, unloadNotReceived: 7, unloadReceived: 8 } as const;
/** Decomp TEXT_BANK_MYSTERY_GIFT_DELIVERYMAN and its messages (res/text/mystery_gift_deliveryman.json). */
const DELIVERYMAN_BANK = 379;
const DELIVERYMAN = { partyFull: 4, haveTooMany: 5, receivedPokemon: 7, memberCard: 14, oaksLetter: 15, azureFlute: 16, secretKey: 17 } as const;
const RECEIVED_ITEM_TEXT = { darkrai: DELIVERYMAN.memberCard, shaymin: DELIVERYMAN.oaksLetter, arceus: DELIVERYMAN.azureFlute, rotom: DELIVERYMAN.secretKey } as const;
/** Decomp TEXT_BANK_SPECIES_NAME_WITH_ARTICLES (StringTemplate_SetSpeciesNameWithArticle). */
const SPECIES_WITH_ARTICLE_BANK = 413;
/** Decomp TEXT_BANK_MYSTERY_GIFT_PHRASE: MysteryGiftPhrase_EveryoneHappyWiFiConnection, _CustomMessageWords. */
const PHRASE_BANK = 372;
const PHRASE = { answer: 0, words: 1 } as const;

export function mysteryGiftHandlers(r: Runner): Record<string, Handler> {
  const dest = (t: Thread, a: Parameters<Handler>[2][number] | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const gift = () => {
    const g = firstDelivery(r.state);
    if (!g) throw new Error('mystery_gift_give: the deliveryman holds no gift');
    return g;
  };
  const item = (g: keyof typeof RECEIVED_ITEM_TEXT) => r.source('items', DEV_EVENTS[g].item)!;
  /** The chars of a text with its slots, line breaks kept (decomp String_Compare of two expanded strings). */
  const chars = (markup: string, slots: string[]) =>
    toPrintOps(markup, slots)
      .map((op) => (op.kind === 'char' ? op.c : op.kind === 'newline' || op.kind === 'scroll' ? '\n' : ''))
      .join('');
  const chooseWords =
    (count: 1 | 2): Handler =>
    (t, c, a) => {
      const result = r.ref(a[1], 'var');
      const dests = a.slice(2, 2 + count).map((x) => r.ref(x, 'var'));
      for (const d of dests) r.setVar(t, d, WORD_NONE);
      return r.openApp(c, { app: 'easy-chat', words: count }, (res: AppResult) => {
        if (res.app !== 'easy-chat') throw new Error(`choose_custom_message_word: got ${res.app}`);
        r.setVar(t, result, res.words ? 1 : 0);
        res.words?.forEach((w, i) => r.setVar(t, dests[i]!, w));
      });
    };

  return {
    mystery_gift_give: (t, _c, a) => {
      const stage = r.int(a[0]);
      switch (stage) {
        case STAGE.load:
        case STAGE.unloadNotReceived:
        case STAGE.unloadReceived:
          break;
        case STAGE.checkAvailable:
          dest(t, a[1], firstDelivery(r.state) ? 1 : 0);
          break;
        case STAGE.getType:
          dest(t, a[1], MYSTERY_GIFTS[gift()].type);
          break;
        case STAGE.checkCanReceive:
          dest(t, a[1], canReceiveMysteryGift(r.state, r.registries, gift()) ? 1 : 0);
          break;
        case STAGE.give:
          giveMysteryGift(r.state, r.registries, gift());
          takeFirstDelivery(r.state);
          break;
        case STAGE.received:
        case STAGE.cantReceive: {
          const g = gift();
          const received = stage === STAGE.received;
          let message: number;
          if (g === 'regigigas') {
            message = received ? DELIVERYMAN.receivedPokemon : DELIVERYMAN.partyFull;
            if (received) t.slots[1] = r.textOf(r.bankText(SPECIES_WITH_ARTICLE_BANK, MYSTERY_GIFTS[g].species));
          } else {
            message = received ? RECEIVED_ITEM_TEXT[g] : DELIVERYMAN.haveTooMany;
            // PrepReceived*Msg: the item at 1; PrepCannotReceive*Msg: at 0.
            t.slots[received ? 1 : 0] = r.registries.items.get(item(g))!.name;
          }
          if (received) t.slots[0] = plainMarkup(r.state.names.player);
          dest(t, a[1], DELIVERYMAN_BANK);
          dest(t, a[2], message);
          break;
        }
        default:
          throw new Error(`mystery_gift_give: bad stage ${stage}`);
      }
      return 'continue';
    },

    /** Decomp ScrCmd_MessageFromBank: message `id` of bank `bank` (both var or value), printed at the text speed. */
    message_from_bank: (t, c, a) => {
      const p = r.showMessage(t, r.bankText(r.val(t, a[0]), r.val(t, a[1])), r.textSpeed());
      return r.pause(c, () => p.done);
    },
    message_from_bank_instant: (t, _c, a) => (r.showMessage(t, r.bankText(r.val(t, a[0]), r.val(t, a[1])), TEXT_SPEED.instant), 'continue'),

    choose_custom_message_word: chooseWords(1),
    choose_two_custom_message_words: chooseWords(2),

    /** Decomp ScrCmd_CheckIsMysteryGiftPhrase: the four words in the phrase's template equal "EVERYONE HAPPY / WI-FI CONNECTION". */
    check_is_mystery_gift_phrase: (t, _c, a) => {
      const words = a.slice(1, 5).map((x) => {
        const w = r.val(t, x);
        return w === WORD_NONE ? '' : r.textOf(easyChatWordText(r.registries, w));
      });
      const got = chars(r.textOf(r.bankText(PHRASE_BANK, PHRASE.words)), words);
      dest(t, a[0], got === chars(r.textOf(r.bankText(PHRASE_BANK, PHRASE.answer)), []) ? 1 : 0);
      return 'continue';
    },

    /** Decomp ScrCmd_UnlockMysteryGift (SystemData_SetMysteryGiftUnlocked). */
    unlock_mystery_gift: () => ((mysteryGiftOf(r.state).unlocked = true), 'continue'),
  };
}

