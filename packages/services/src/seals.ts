/**
 * Seals and Ball Capsules (docs/research/seals.md §2; decomp ball_seal_info.c, capsule_menu): the Seal Case's counts
 * (owned = loose + placed, the 99 cap on owned), the editor's drop-off path, the capsule circle, and the capsules on
 * party Pokémon (SET, REMOVE, SHIFT, CONFIRM, the detach rules, the NPC trainers' capsules). Pure rules over
 * `GameState.sealCase` and core `Pokemon.capsule`; the menus and the VM call them.
 */
import type { BallSeal, Pokemon } from '@opensinnoh/core';
import { CAPSULE_CIRCLE, newGameRecord, SEALS, type GameState, type Registries, type SealCase, type SealTables } from '@opensinnoh/contracts';
import { addToGameRecord } from './score.ts';

/** The packs' seal tables (`NewGame.seals`); fails loudly without them. */
export function sealTables(registries: Registries): SealTables {
  const t = newGameRecord(registries).seals;
  if (!t) throw new Error('seals: the packs have no NewGame.seals');
  return t;
}

function sealIndex(id: number): number {
  if (!Number.isInteger(id) || id < 1 || id > SEALS.count) throw new Error(`seals: ${id} is not a seal id (1–${SEALS.count})`);
  return id - 1;
}

/** Decomp SealCase_CountSealOccurrenceInUse: the slots of the 12 capsules holding seal `id`. */
export function sealsPlaced(c: SealCase, id: number): number {
  sealIndex(id);
  let n = 0;
  for (const cap of c.capsules) for (const s of cap) if (s.seal === id) n++;
  return n;
}

/** Decomp SealCase_CountSealOccurrenceAnywhere: loose + placed. */
export function sealsOwned(c: SealCase, id: number): number {
  return c.counts[sealIndex(id)]! + sealsPlaced(c, id);
}

/** Decomp SealCase_CheckSealCount: whether `giveOrTakeSeal(c, id, q)` would succeed. */
export function canGiveOrTakeSeal(c: SealCase, id: number, q: number): boolean {
  if (q < 0) return c.counts[sealIndex(id)]! + q >= 0;
  return sealsOwned(c, id) + q <= SEALS.max;
}

/**
 * Decomp GiveOrTakeSeal: q < 0 takes loose seals (refused below 0), q > 0 adds them (refused, nothing partial, when
 * owned + q passes 99). True when it changed the case.
 */
export function giveOrTakeSeal(c: SealCase, id: number, q: number): boolean {
  if (!canGiveOrTakeSeal(c, id, q)) return false;
  c.counts[sealIndex(id)]! += q;
  return true;
}

/**
 * Decomp GiveOrTakeSeal2, the editor's drop-off (a seal leaving the capsule being edited back to the case): adds `q`
 * when the placed count + q is at most 99, then clamps the loose count to 99.
 */
export function returnSeal(c: SealCase, id: number, q = 1): boolean {
  const i = sealIndex(id);
  if (sealsPlaced(c, id) + q > SEALS.max) return false;
  c.counts[i] = Math.min(SEALS.max, c.counts[i]! + q);
  return true;
}

/** Decomp SealCase_CountUniqueSeals: the seal ids owned at least once. */
export function uniqueSeals(c: SealCase): number {
  let n = 0;
  for (let id = 1; id <= SEALS.count; id++) if (sealsOwned(c, id)) n++;
  return n;
}

/** Decomp CalcTotalBallSeals (the Bag's "Seals: N"): every seal owned. */
export function totalSeals(c: SealCase): number {
  let n = 0;
  for (let id = 1; id <= SEALS.count; id++) n += sealsOwned(c, id);
  return n;
}

/**
 * Decomp CapsuleGraphics_PopulateSealPage's list: every seal id, in order, with loose seals or on any capsule of `c`
 * (the case as saved; a seal whose loose count is 0 stays while a capsule uses it).
 */
export function sealList(c: SealCase): number[] {
  const out: number[] = [];
  for (let id = 1; id <= SEALS.count; id++) if (c.counts[id - 1]! > 0 || sealsPlaced(c, id) > 0) out.push(id);
  return out;
}

/** Decomp SealAnim_GetDistance: the integer √(dx² + dy²) from the capsule circle's centre. */
export function capsuleDistance(x: number, y: number): number {
  const dx = x - CAPSULE_CIRCLE.x;
  const dy = y - CAPSULE_CIRCLE.y;
  return Math.floor(Math.sqrt(dx * dx + dy * dy));
}

/** A seal centred at (x, y) stays on the capsule when it is at most the radius from the centre. */
export function onCapsule(x: number, y: number): boolean {
  return capsuleDistance(x, y) <= CAPSULE_CIRCLE.r;
}

/** The party slot of the Pokémon holding capsule `index` (0–11; `capsule.id` = index + 1), or -1. */
export function capsuleHolder(party: readonly Pokemon[], index: number): number {
  return party.findIndex((m) => m.capsule?.id === index + 1);
}

const copySeals = (seals: readonly BallSeal[]): BallSeal[] => seals.map((s) => ({ ...s }));

/**
 * Decomp PartyMenu_SetBallCapsule and the field task's attach (capsule_menu/main.c): a Pokémon without a capsule gets
 * capsule `index` (its id and a copy); one with a capsule is refused ("Two capsules can't be set.").
 */
export function setCapsule(state: GameState, slot: number, index: number): 'set' | 'two' {
  const mon = state.party[slot];
  if (!mon) throw new Error(`seals: no Pokémon in party slot ${slot}`);
  if (mon.isEgg) throw new Error('seals: an Egg cannot hold a capsule');
  if (mon.capsule) return 'two';
  if (capsuleHolder(state.party, index) >= 0) throw new Error(`seals: capsule ${index} is already on a Pokémon`);
  if (!state.sealCase.capsules[index]!.length) throw new Error(`seals: capsule ${index} has no seals to set`);
  mon.capsule = { id: index + 1, seals: copySeals(state.sealCase.capsules[index]!) };
  return 'set';
}

/** Decomp CapsuleManager_AssignCapsuleMon (REMOVE, or a capsule edited down to no seals): its holder lets it go. */
export function removeCapsule(party: Pokemon[], index: number): void {
  const slot = capsuleHolder(party, index);
  if (slot >= 0) delete party[slot]!.capsule;
}

/** Decomp CapsuleGraphics_SwapCapsules (SHIFT): the two capsules trade places; each holder's id follows its capsule. */
export function shiftCapsules(state: GameState, a: number, b: number): void {
  const caps = state.sealCase.capsules;
  const [ha, hb] = [capsuleHolder(state.party, a), capsuleHolder(state.party, b)];
  [caps[a], caps[b]] = [caps[b]!, caps[a]!];
  if (ha >= 0) state.party[ha]!.capsule!.id = b + 1;
  if (hb >= 0) state.party[hb]!.capsule!.id = a + 1;
}

/**
 * The editor's CONFIRM (manager.c CAPSULE_FADE_IN_WAIT state, SealPlacement_UpdateSeals, CapsuleGraphics_AssignCapsules):
 * capsule `index` becomes `seals` (front first); a holder keeps a fresh copy, or lets the capsule go when it is empty.
 */
export function saveCapsule(state: GameState, index: number, seals: readonly BallSeal[]): void {
  if (seals.length > SEALS.perCapsule) throw new Error(`seals: ${seals.length} seals on one capsule`);
  for (const s of seals) sealIndex(s.seal);
  state.sealCase.capsules[index] = copySeals(seals);
  const slot = capsuleHolder(state.party, index);
  if (slot < 0) return;
  if (!seals.length) delete state.party[slot]!.capsule;
  else state.party[slot]!.capsule!.seals = copySeals(seals);
}

/** Decomp Pokemon_ClearBallCapsuleData (the Day-Care STORE and NPC trade's YES): the capsule comes off. */
export function detachCapsule(mon: Pokemon): void {
  delete mon.capsule;
}

/** Decomp RECORD_MONEY_SPENT (generated/game_records.txt). */
export const RECORD_MONEY_SPENT = 35;
/** Decomp Shop_ShowQuantitySelection: at most 99 at once. */
const MAX_SEAL_PURCHASE = 99;

/** A seal's shop price (decomp CapsuleMenu_GetSealPrice); a seal without one is not sold. */
export function sealPrice(registries: Registries, id: number): number {
  const price = sealTables(registries).types[sealIndex(id) + 1]!.price;
  if (!price) throw new Error(`seals: seal ${id} has no price`);
  return price;
}

/** How many the money buys (decomp Shop_SelectBuyMenu's count cap), at most 99. */
export function maxBuySeals(state: GameState, registries: Registries, id: number): number {
  return Math.min(MAX_SEAL_PURCHASE, Math.floor(state.money / sealPrice(registries, id)));
}

/**
 * The seal mart's purchase (decomp Shop_ShowPurchaseMessage → Shop_ConfirmItemPurchase, MART_TYPE_SEAL): refused when
 * the money does not cover it or the Seal Case would pass 99 of the seal (SealCase_CheckSealCount); else the seals go
 * into the case, the money is taken and RECORD_MONEY_SPENT grows.
 */
export function buySeals(state: GameState, registries: Registries, id: number, count: number): { ok: true } | { ok: false; reason: 'money' | 'room' } {
  if (!Number.isInteger(count) || count < 1 || count > MAX_SEAL_PURCHASE) throw new Error(`seals: buy count ${count}`);
  const total = sealPrice(registries, id) * count;
  if (total > state.money) return { ok: false, reason: 'money' };
  if (!giveOrTakeSeal(state.sealCase, id, count)) return { ok: false, reason: 'room' };
  state.money -= total;
  addToGameRecord(state, registries, RECORD_MONEY_SPENT, total);
  return { ok: true };
}
