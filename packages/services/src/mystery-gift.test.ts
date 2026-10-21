import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GameState } from '@opensinnoh/contracts';
import { allowTestGiftCodes, cardGiftPending, firstDelivery, giftForCode, giftReceivable, mysteryGiftOf, receiveGift, sha256Hex, takeFirstDelivery, TEST_GIFT_CODES, trashCard } from './mystery-gift.ts';

const state = () => ({}) as GameState;

describe('Mystery Gift', () => {
  // The switch is module state and this suite shares its module with other files (`isolate: false`): each test
  // starts with the test codes off, as in play, and leaves them off.
  beforeEach(() => allowTestGiftCodes(false));
  afterEach(() => allowTestGiftCodes(false));

  it('hashes as SHA-256 does', () => {
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'é☃'.repeat(40)]) expect(sha256Hex(s)).toBe(createHash('sha256').update(s).digest('hex'));
  });

  it('takes the test codes only once a test turns them on, in any case', () => {
    expect(giftForCode(TEST_GIFT_CODES.darkrai)).toBeNull();
    allowTestGiftCodes();
    expect(giftForCode('testdark')).toBe('darkrai');
    expect(giftForCode(' TestRegi ')).toBe('regigigas');
    expect(giftForCode('QQQQQQQQ')).toBeNull();
  });

  it('receives a gift once, keeps its card and hands it to the deliveryman', () => {
    const s = state();
    expect(giftReceivable(s, 'rotom')).toBe('ok');
    receiveGift(s, 'rotom', '2009-03-22');
    expect(mysteryGiftOf(s)).toMatchObject({ received: ['rotom'], cards: [{ gift: 'rotom', received: '2009-03-22' }, null, null], deliveries: [{ gift: 'rotom', card: 0 }, null, null, null, null, null, null, null] });
    expect(giftReceivable(s, 'rotom')).toBe('already');
    expect(() => receiveGift(s, 'rotom', '2009-03-22')).toThrow();
    expect(firstDelivery(s)).toBe('rotom');
    takeFirstDelivery(s);
    expect(firstDelivery(s)).toBeNull();
    expect(cardGiftPending(s, 0)).toBe(false);
    // Trashing a card whose gift was picked up keeps the gift received.
    trashCard(s, 0);
    expect(giftReceivable(s, 'rotom')).toBe('already');
  });

  it('has three card slots; trashing a card with its gift waiting lets it be received again', () => {
    const s = state();
    receiveGift(s, 'darkrai', '2009-03-22');
    receiveGift(s, 'shaymin', '2009-03-22');
    receiveGift(s, 'arceus', '2009-03-22');
    expect(giftReceivable(s, 'rotom')).toBe('cards');
    expect(cardGiftPending(s, 1)).toBe(true);
    trashCard(s, 1);
    expect(mysteryGiftOf(s).received).toEqual(['darkrai', 'arceus']);
    expect(mysteryGiftOf(s).deliveries.filter(Boolean)).toEqual([{ gift: 'darkrai', card: 0 }, { gift: 'arceus', card: 2 }]);
    expect(giftReceivable(s, 'shaymin')).toBe('ok');
  });
});
