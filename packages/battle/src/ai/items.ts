/** The trainer item AI (decomp trainer_ai.c TrainerAI_ShouldUseItem). */
import { BATTLE_STAT, BATTLE_TYPE_TRAINER_WITH_AI_PARTNER, ITEM_AI_CATEGORY, ITEM_FULL_RESTORE, MON_CONDITION, MOVE_EFFECT, SIDE_CONDITION, VOLATILE_CONDITION } from './constants.ts';
import type { Calc } from './calc.ts';
import { usable } from './script.ts';

/** The item use the battle applies (decomp AIContext usedItem, usedItemType, usedItemCondition). */
export interface AiItemUse {
  /** decomp item number. */
  item: number;
  /** ITEM_AI_CATEGORY_* value (`ITEM_AI_CATEGORY`). */
  category: number;
  /** RECOVER_STATUS: bits 5 sleep, 4 poison, 3 burn, 2 freeze, 1 paralysis, 0 confusion. STAT_BOOSTER: the BATTLE_STAT_*. */
  condition: number;
}

/** Status cures in the decomp's order: the ItemPartyParam flag, what it checks, the condition bit it sets. */
const CURES: [string, (status: number, volatile: number) => boolean, number][] = [
  ['healSleep', (s) => (s & MON_CONDITION.SLEEP) !== 0, 5],
  ['healPoison', (s) => (s & (MON_CONDITION.POISON | MON_CONDITION.TOXIC)) !== 0, 4],
  ['healBurn', (s) => (s & MON_CONDITION.BURN) !== 0, 3],
  ['healFreeze', (s) => (s & MON_CONDITION.FREEZE) !== 0, 2],
  ['healParalysis', (s) => (s & MON_CONDITION.PARALYSIS) !== 0, 1],
  ['healConfusion', (_, v) => (v & VOLATILE_CONDITION.CONFUSION) !== 0, 0],
];
const BOOSTS: [string, number][] = [
  ['attack', BATTLE_STAT.ATTACK],
  ['defense', BATTLE_STAT.DEFENSE],
  ['spAttack', BATTLE_STAT.SP_ATTACK],
  ['spDefense', BATTLE_STAT.SP_DEFENSE],
  ['speed', BATTLE_STAT.SPEED],
  ['accuracy', BATTLE_STAT.ACCURACY],
];

/**
 * TrainerAI_ShouldUseItem, with the DS's loop as it is: once one item applies, every later item the loop
 * still reaches is spent too (and the last one is the item used). Items later in the list are only
 * reached when few enough Pokémon are left (`alive <= count - i + 1`).
 */
export function shouldUseItem(c: Calc, battler: number): AiItemUse | null {
  const v = c.view;
  const half = battler >> 1;
  const mem = v.memory;
  const b = v.battler(battler);
  // An AI partner (the player's slot-2 battler) never uses items.
  if ((v.battleType & BATTLE_TYPE_TRAINER_WITH_AI_PARTNER) === BATTLE_TYPE_TRAINER_WITH_AI_PARTNER && battler === 2) return null;
  if (b.moveEffects & MOVE_EFFECT.EMBARGO) return null;
  const alive = v.party(battler).filter(usable).length;
  let result = false;
  let category = 0;
  let condition = 0;
  let used = 0;
  for (let i = 0; i < 4; i++) {
    if (!(i === 0 || alive <= mem.itemCounts[half]! - i + 1)) continue;
    const item = mem.items[half]![i]!;
    if (!item) continue;
    const data = c.dex.item(item);
    const cure = CURES.find(([flag]) => data.partyFlags.has(flag));
    if (item === ITEM_FULL_RESTORE) {
      if (b.hp < Math.trunc(b.maxHp / 4) && b.hp) {
        category = ITEM_AI_CATEGORY.FULL_RESTORE;
        result = true;
      }
    } else if (data.partyFlags.has('hpRestore')) {
      const restore = data.hpRestored & 0xff;
      if (restore && b.hp && (b.hp < Math.trunc(b.maxHp / 4) || b.maxHp - b.hp > restore)) {
        category = ITEM_AI_CATEGORY.RECOVER_HP;
        result = true;
      }
    } else if (cure) {
      if (cure[1](b.status, b.volatile)) {
        condition |= 1 << cure[2];
        category = ITEM_AI_CATEGORY.RECOVER_STATUS;
        result = true;
      }
    } else if (b.switchInTurn - v.totalTurns >= 0) {
      // Stat items: only on the turn the Pokémon came in.
      const boost = BOOSTS.find(([stat]) => data.stages[stat]);
      if (boost) {
        condition = boost[1];
        category = ITEM_AI_CATEGORY.STAT_BOOSTER;
        result = true;
      } else if (data.partyFlags.has('guardSpec') && !(v.sideConditions(1) & SIDE_CONDITION.MIST)) {
        category = ITEM_AI_CATEGORY.GUARD_SPEC;
        result = true;
      }
    } else {
      category = ITEM_AI_CATEGORY.MAX;
    }
    if (result) {
      used = item;
      mem.items[half]![i] = 0;
    }
  }
  return result ? { item: used, category, condition } : null;
}
