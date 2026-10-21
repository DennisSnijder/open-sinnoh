import { BATTLE_TYPE, BATTLE_TYPE_NO_AI_ITEMS, NO_SLOT } from './constants.ts';
import type { AiMemory } from './view.ts';

/**
 * A fresh memory at battle start (decomp BattleControllerPlayer_InitAI): in trainer battles each enemy
 * battler's trainer items (decomp item numbers, empty ones skipped) go to items[battler >> 1].
 * `trainerItems[b]` are battler b's trainer's items; only enemies (odd battlers) use them.
 */
export function createAiMemory(battleType: number, trainerItems: readonly (readonly number[])[]): AiMemory {
  const memory: AiMemory = {
    knownMoves: [0, 1, 2, 3].map(() => [0, 0, 0, 0]),
    knownAbilities: [0, 0, 0, 0],
    knownHeldItems: [0, 0, 0, 0],
    items: [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
    itemCounts: [0, 0],
    switchedSlot: [NO_SLOT, NO_SLOT, NO_SLOT, NO_SLOT],
  };
  if (battleType & BATTLE_TYPE.TRAINER && !(battleType & BATTLE_TYPE_NO_AI_ITEMS)) {
    for (let battler = 1; battler < 4; battler += 2) {
      for (const item of trainerItems[battler] ?? []) {
        if (!item) continue;
        const half = battler >> 1;
        memory.items[half]![memory.itemCounts[half]!] = item;
        memory.itemCounts[half]!++;
      }
    }
  }
  return memory;
}

/** A battler switched in (decomp BattleAI_ClearKnown*: switch-in and Baton Pass). */
export function aiForgetBattler(memory: AiMemory, battler: number): void {
  memory.knownMoves[battler] = [0, 0, 0, 0];
  memory.knownAbilities[battler] = 0;
  memory.knownHeldItems[battler] = 0;
}

/** The battle announced a battler's ability (decomp BattleAI_SetAbility). */
export function aiRevealAbility(memory: AiMemory, battler: number, ability: number): void {
  memory.knownAbilities[battler] = ability;
}

/** The battle announced a battler's held item (decomp BattleAI_SetHeldItem; BattleMon_CopyToParty sets 0 once it holds nothing). */
export function aiRevealHeldItem(memory: AiMemory, battler: number, item: number): void {
  memory.knownHeldItems[battler] = item;
}

/**
 * No switch chosen (decomp BattleContext_Init, which the DS runs after every action and at the end of the
 * turn): call it at the same points, so the command phase starts with none and replacing a fainted
 * Pokémon uses the post-KO choice.
 */
export function aiResetSwitches(memory: AiMemory): void {
  memory.switchedSlot = [NO_SLOT, NO_SLOT, NO_SLOT, NO_SLOT];
}
