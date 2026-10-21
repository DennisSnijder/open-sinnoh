/**
 * The Fashion Case (decomp unk_020298BC.c FashionCase_*): accessories by count (up to 9 of the first 61, one of the
 * rest) and contest backdrops in the order received. Pure rules over `GameState.fashionCase`.
 */
import { ACCESSORIES, type FashionCase } from '@opensinnoh/contracts';

const max = (accessory: number) => (accessory < ACCESSORIES.nonUnique ? ACCESSORIES.maxNonUnique : ACCESSORIES.maxUnique);

function check(accessory: number): void {
  if (!Number.isInteger(accessory) || accessory < 0 || accessory >= ACCESSORIES.count) throw new Error(`accessory ${accessory} is not an accessory id`);
}

/** Decomp FashionCase_GetAccessoryCount. */
export function accessoryCount(fc: FashionCase, accessory: number): number {
  check(accessory);
  return fc.accessories[accessory]!;
}

/** Decomp FashionCase_CanFitAccessoryCount. */
export function canFitAccessory(fc: FashionCase, accessory: number, count: number): boolean {
  return accessoryCount(fc, accessory) + count <= max(accessory);
}

/** Decomp FashionCase_AddAccessory: capped at the accessory's maximum. */
export function addAccessory(fc: FashionCase, accessory: number, count: number): void {
  fc.accessories[accessory] = Math.min(max(accessory), accessoryCount(fc, accessory) + count);
}

/** Decomp FashionCase_RemoveAccessory: a unique accessory is removed outright. */
export function removeAccessory(fc: FashionCase, accessory: number, count: number): void {
  fc.accessories[accessory] = accessory < ACCESSORIES.nonUnique ? Math.max(0, accessoryCount(fc, accessory) - count) : 0;
}

/** Decomp FashionCase_GetTotalAccessories and FashionCase_GetTotalBackdrops (the bag's Fashion Case message). */
export const totalAccessories = (fc: FashionCase): number => fc.accessories.reduce((n, c) => n + c, 0);
export const totalBackdrops = (fc: FashionCase): number => fc.backdrops.length;

/** Decomp FashionCase_AddBackdrop: once, after the ones held. */
export function addBackdrop(fc: FashionCase, backdrop: number): void {
  if (!Number.isInteger(backdrop) || backdrop < 0 || backdrop >= ACCESSORIES.backdrops) throw new Error(`backdrop ${backdrop} is not a backdrop id`);
  if (!fc.backdrops.includes(backdrop)) fc.backdrops.push(backdrop);
}

/** Decomp FashionCase_HasBackdrop. */
export const hasBackdrop = (fc: FashionCase, backdrop: number): boolean => fc.backdrops.includes(backdrop);

/** Decomp NUM_MASSAGE_GIRL_ACCESSORIES from ACCESSORY_PRETTY_DEWDROP (34): Pretty Dewdrop … Glitter Powder. */
export const MASSAGE_ACCESSORIES = { first: 34, count: 16 } as const;
