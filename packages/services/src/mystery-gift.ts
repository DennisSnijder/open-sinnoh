/**
 * Mystery Gift by gift code (docs/decisions.md "Event legendaries through Mystery Gift with gift codes"): the
 * save's Mystery Gift block (decomp mystery_gift.c: received flags, three Wonder Card slots, eight gift slots for the
 * Poké Mart deliveryman) and the codes. A code is checked locally against the built-in gifts: the source keeps only a
 * salted SHA-256 of each code, so a public listing does not spoil them (anyone running the game could still find
 * them). Codes are case-insensitive. Test codes exist only once `allowTestGiftCodes` ran (replays and browser tests).
 */
import { DELIVERY_SLOTS, WONDER_CARD_SLOTS, type GameState, type MysteryGiftId, type MysteryGiftState } from '@opensinnoh/contracts';

/** The longest code (the naming screen's length for `gift-code`). */
export const GIFT_CODE_LENGTH = 8;

const SALT = 'e01eddf0ddf62557';
/** SHA-256 of `${SALT}:${code}` per gift. */
const CODE_HASHES: Readonly<Record<MysteryGiftId, string>> = {
  darkrai: 'a375d8facf8c0d40ac6c2c42ae980e76ec7c6f60dde081e3722ece7da0db0d5e',
  shaymin: '3dd05741c790066f9fc171136ff3a1d2ffa23bf1576b0d495d6c392eede4da63',
  arceus: '52e0872b1ca3926e8969c2168a17d03f57c6f6e1f8febc9b532af5f15d6bfc53',
  rotom: 'a1fe53cf3ac986e1983b0d7d27231ff9bd20b838120a37cbbaae0b03ffdf2e1e',
  regigigas: '84d14e94c0547045249d91ac257238a8a4fef5743b4bb8b090da2845ff773720',
};

/** The test-only codes (never valid in play unless a test turned them on). */
export const TEST_GIFT_CODES: Readonly<Record<MysteryGiftId, string>> = { darkrai: 'TESTDARK', shaymin: 'TESTSHAY', arceus: 'TESTARCE', rotom: 'TESTROTO', regigigas: 'TESTREGI' };
let testCodes = false;

/** Turns the test codes on (the replay setup line `giftcodes test`, the title's test hook), or off again (unit tests). */
export function allowTestGiftCodes(allow = true): void {
  testCodes = allow;
}

/** The gift a code names, or null. Case and spaces do not matter. */
export function giftForCode(code: string): MysteryGiftId | null {
  const c = code.replace(/\s+/g, '').toUpperCase();
  const gifts = Object.keys(CODE_HASHES) as MysteryGiftId[];
  if (testCodes) {
    const test = gifts.find((g) => TEST_GIFT_CODES[g] === c);
    if (test) return test;
  }
  const hash = sha256Hex(`${SALT}:${c}`);
  return gifts.find((g) => CODE_HASHES[g] === hash) ?? null;
}

/** The save's Mystery Gift block, created empty on first use (decomp MysteryGift_Init). */
export function mysteryGiftOf(state: GameState): MysteryGiftState {
  return (state.mysteryGift ??= { unlocked: false, received: [], cards: Array.from({ length: WONDER_CARD_SLOTS }, () => null), deliveries: Array.from({ length: DELIVERY_SLOTS }, () => null) });
}

/**
 * Whether a gift can be received now (decomp ov97 MysteryGift's checks before "Receive this gift?"): `already` (its
 * received flag, AlreadyReceivedCantGetAnotherOne), `cards` (no free Wonder Card slot, OutOfRoomForWonderCards),
 * `deliveries` (no free gift slot, DeliveryManOverloaded), or `ok`.
 */
export function giftReceivable(state: GameState, gift: MysteryGiftId): 'ok' | 'already' | 'cards' | 'deliveries' {
  const mg = mysteryGiftOf(state);
  if (mg.received.includes(gift)) return 'already';
  if (!mg.cards.includes(null)) return 'cards';
  if (!mg.deliveries.includes(null)) return 'deliveries';
  return 'ok';
}

/**
 * Decomp SaveReceivedGift: the received flag, the Wonder Card (dated `date`, yyyy-mm-dd) in the first free slot and
 * its gift in the first free gift slot (MysteryGift_TrySaveWondercard).
 */
export function receiveGift(state: GameState, gift: MysteryGiftId, date: string): void {
  if (giftReceivable(state, gift) !== 'ok') throw new Error(`receiveGift: ${gift} cannot be received (${giftReceivable(state, gift)})`);
  const mg = mysteryGiftOf(state);
  mg.received.push(gift);
  const card = mg.cards.indexOf(null);
  mg.cards[card] = { gift, received: date };
  mg.deliveries[mg.deliveries.indexOf(null)] = { gift, card };
}

/** Whether a card's gift still waits at the deliveryman (decomp MysteryGift_CheckWcHasPgtSaved). */
export function cardGiftPending(state: GameState, card: number): boolean {
  return mysteryGiftOf(state).deliveries.some((d) => d?.card === card);
}

/**
 * Decomp MysteryGift_FreeWcErasePgt / MysteryGift_FreeWcSlot: trashing a card. A card whose gift was not picked up
 * takes its gift with it and clears its received flag (it can be received again).
 */
export function trashCard(state: GameState, card: number): void {
  const mg = mysteryGiftOf(state);
  const c = mg.cards[card];
  if (!c) throw new Error(`trashCard: no card in slot ${card}`);
  const pending = mg.deliveries.findIndex((d) => d?.card === card);
  if (pending >= 0) {
    mg.deliveries[pending] = null;
    mg.received = mg.received.filter((g) => g !== c.gift);
  }
  mg.cards[card] = null;
}

/** The first gift the deliveryman holds (decomp MysteryGift_TryGetFirstValidPgtSlot), or null. */
export function firstDelivery(state: GameState): MysteryGiftId | null {
  return state.mysteryGift?.deliveries.find((d) => d !== null)?.gift ?? null;
}

/** Decomp FreeCurrentPgt: the deliveryman has handed over his first gift. */
export function takeFirstDelivery(state: GameState): void {
  const mg = mysteryGiftOf(state);
  const i = mg.deliveries.findIndex((d) => d !== null);
  if (i < 0) throw new Error('takeFirstDelivery: the deliveryman holds no gift');
  mg.deliveries[i] = null;
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a string's UTF-8 bytes, as lowercase hex (synchronous: the menus run headless and deterministic). */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const bits = data.length * 8;
  const padded = new Uint8Array((((data.length + 8) >> 6) + 1) << 6);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = w[i - 16]! + s0 + w[i - 7]! + s1;
    }
    const v = [...h];
    for (let i = 0; i < 64; i++) {
      const [a, b, c, d, e, f, g, hh] = v as [number, number, number, number, number, number, number, number];
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      v.splice(0, 8, (t1 + t2) >>> 0, a, b, c, (d + t1) >>> 0, e, f, g);
    }
    for (let i = 0; i < 8; i++) h[i] = h[i]! + v[i]!;
  }
  return [...h].map((x) => x.toString(16).padStart(8, '0')).join('');
}
