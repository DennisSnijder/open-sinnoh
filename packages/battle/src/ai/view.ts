/**
 * What the trainer AI reads from the battle: the narrow seam the battle core implements.
 *
 * Everything is in the DS's terms, because the ROM bytecode compares against DS values:
 * - Battlers are the DS ids: 0 the player, 1 the enemy, 2 and 3 their partners (singles use 0 and 1).
 *   Side = battler & 1. A slot with nobody in it reads as `EMPTY_BATTLER` (the DS's zeroed BattleMon).
 * - Moves, species, abilities, items and types are decomp numbers (the records' `sourceIndex`).
 * - Masks are the decomp ones: `MON_CONDITION_*` (status), `VOLATILE_CONDITION_*`, `MOVE_EFFECT_*`,
 *   `SIDE_CONDITION_*`, `FIELD_CONDITION_*`, `BATTLE_TYPE_*`, `MOVE_STATUS_*`.
 *
 * The engine methods are the battle core's own routines (decomp battle_lib.c); their integer results
 * must be the DS's, since scripts compare them with exact values (an effectiveness of 80, …).
 */
export interface AiBattleView {
  /** decomp `BATTLE_TYPE_*` mask. */
  readonly battleType: number;
  /** battleCtx->totalTurns. */
  readonly totalTurns: number;
  /** battleCtx->fieldConditionsMask (`FIELD_CONDITION_*`; weather included). */
  readonly fieldConditions: number;
  /** The AI's own memory, kept in the battle state (see `memory.ts`). */
  readonly memory: AiMemory;

  battler(battler: number): AiBattler;
  /** sideConditionsMask[side] (`SIDE_CONDITION_*`). */
  sideConditions(side: number): number;
  /** sideConditions[side].spikesLayers / toxicSpikesLayers. */
  spikesLayers(side: number): number;
  toxicSpikesLayers(side: number): number;
  /** BattleSystem_GetParty(battler): the party that battler sends out from, in party order. */
  party(battler: number): AiPartyMon[];
  /** selectedPartySlot[battler]: the party slot the battler is. */
  selectedPartySlot(battler: number): number;
  /** movePrevByBattler[battler]: the last move it used (0 = none). */
  previousMove(battler: number): number;
  /** moveHit[battler] / moveHitBattler[battler]: the last move that hit it and who used it (move 0 = none, battler 0xFF = none). */
  lastHitBy(battler: number): { move: number; battler: number };
  /** moveProtect[battler]: the protecting move it used last (Protect, Detect, Endure), else 0. */
  protectMove(battler: number): number;
  /** recycleItem[battler]. */
  recycleItem(battler: number): number;
  /** battlersSwitchingMask has the battler (it fainted or is being replaced). */
  switching(battler: number): boolean;

  /** BattleSystem_CheckInvalidMoves(…, CHECK_INVALID_ALL): bit i = move slot i cannot be chosen. */
  invalidMoves(battler: number): number;
  /** battleCtx->monSpeedValues[battler]: the speed the last speed comparison worked out (Gyro Ball). */
  speedValue(battler: number): number;
  /** BattleSystem_CompareBattlerSpeed(b1, b2, ignoreQuickClaw = TRUE): 0 b1 first, 1 b2 first, 2 tie. */
  compareSpeed(battler1: number, battler2: number): number;
  /**
   * BattleSystem_ApplyTypeChart: STAB, the type chart and the effectiveness abilities and items applied to
   * `damage`, with the `MOVE_STATUS_*` flags it raises. `type` 0 = the move's own type. `ignoreTypeChecks`
   * is SYSCTL_IGNORE_TYPE_CHECKS (set for fixed-damage moves).
   */
  applyTypeChart(move: number, type: number, attacker: number, defender: number, damage: number, ignoreTypeChecks: boolean): { damage: number; flags: number };
  /** BattleSystem_CalcEffectiveness: the `MOVE_STATUS_*` flags of a move against types and an ability (no battler needed). */
  calcEffectiveness(move: number, type: number, attackerAbility: number, defenderAbility: number, defenderHoldEffect: number, defenderType1: number, defenderType2: number): number;
  /**
   * BattleSystem_CalcMoveDamage with criticalMul 1 and the defender side's and the field's conditions:
   * the damage before the type chart and the random roll. `power`/`type` 0 = the move's own.
   */
  calcMoveDamage(move: number, attacker: number, defender: number, power: number, type: number): number;
  /** BattleSystem_TypeMatchupMultiplier: 40 = neutral, ×2 per weakness, ÷2 per resistance, 0 immune. */
  typeMatchup(attackingType: number, defendingType1: number, defendingType2: number): number;
}

/** A battler in the field (decomp BattleMon). */
export interface AiBattler {
  species: number;
  level: number;
  /** decomp gender: 0 male, 1 female, 2 none. */
  gender: number;
  /** battleMon.ability (the AI applies Gastro Acid, Gravity and Ingrain itself, as Battler_Ability does). */
  ability: number;
  /** BattleMon_Get TYPE_1/TYPE_2 (Multitype applied). */
  types: [number, number];
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
  spAttack: number;
  spDefense: number;
  /** statBoosts by BATTLE_STAT_* (HP, Atk, Def, Spe, SpA, SpD, Acc, Eva): 0–12, 6 = unchanged. */
  statStages: number[];
  /** Four move ids (0 = empty) and their current PP. */
  moves: number[];
  pp: number[];
  heldItem: number;
  friendship: number;
  /** In 0.1 kg (for Low Kick and Grass Knot). */
  weight: number;
  /** HP, Atk, Def, Spe, SpA, SpD. */
  ivs: number[];
  /** `MON_CONDITION_*`. */
  status: number;
  /** `VOLATILE_CONDITION_*`. */
  volatile: number;
  /** `MOVE_EFFECT_*`. */
  moveEffects: number;
  /** moveEffectsData counters. `switchInTurn` is fakeOutTurnNumber: the totalTurns value when it came in. */
  disabledMove: number;
  disabledTurns: number;
  encoredMove: number;
  encoredTurns: number;
  tauntedTurns: number;
  embargoTurns: number;
  magnetRiseTurns: number;
  perishSongTurns: number;
  stockpileCount: number;
  lastResortCount: number;
  protectSuccessTurns: number;
  switchInTurn: number;
  flashFire: boolean;
}

/** A party member (decomp Pokemon), as the AI reads it from the party. */
export interface AiPartyMon {
  /** 0 = none. */
  species: number;
  isEgg: boolean;
  hp: number;
  maxHp: number;
  /** `MON_CONDITION_*`. */
  status: number;
  moves: number[];
  pp: number[];
  maxPp: number[];
  heldItem: number;
  ability: number;
  types: [number, number];
  /** HP, Atk, Def, Spe, SpA, SpD. */
  ivs: number[];
}

/** The battle's random stream (BattleSystem_RandNext). The AI only takes `next() % n` of it. */
export interface AiRng {
  next(): number;
}

/**
 * What the AI remembers across turns (decomp AIContext fields outside the per-decision reset, and
 * battleCtx->aiSwitchedPartySlot). Plain JSON; the battle core keeps it with its state and calls the hooks
 * in `memory.ts` when the DS would write it.
 */
export interface AiMemory {
  /** battlerMoves: moves seen from each battler (recorded by the AI, cleared on switch-in). */
  knownMoves: number[][];
  /** battlerAbilities / battlerHeldItems: what each battler revealed (0 = unknown). */
  knownAbilities: number[];
  knownHeldItems: number[];
  /** trainerItems / trainerItemCounts by battler >> 1; a used item becomes 0. */
  items: number[][];
  itemCounts: number[];
  /** aiSwitchedPartySlot: the party slot each battler chose to switch to this turn; 6 = none (post-KO logic). */
  switchedSlot: number[];
}

/** The DS's zeroed BattleMon, for a slot nobody stands in. */
export const EMPTY_BATTLER: AiBattler = Object.freeze({
  species: 0,
  level: 0,
  gender: 0,
  ability: 0,
  types: [0, 0] as [number, number],
  hp: 0,
  maxHp: 0,
  attack: 0,
  defense: 0,
  speed: 0,
  spAttack: 0,
  spDefense: 0,
  statStages: [0, 0, 0, 0, 0, 0, 0, 0],
  moves: [0, 0, 0, 0],
  pp: [0, 0, 0, 0],
  heldItem: 0,
  friendship: 0,
  weight: 0,
  ivs: [0, 0, 0, 0, 0, 0],
  status: 0,
  volatile: 0,
  moveEffects: 0,
  disabledMove: 0,
  disabledTurns: 0,
  encoredMove: 0,
  encoredTurns: 0,
  tauntedTurns: 0,
  embargoTurns: 0,
  magnetRiseTurns: 0,
  perishSongTurns: 0,
  stockpileCount: 0,
  lastResortCount: 0,
  protectSuccessTurns: 0,
  switchInTurn: 0,
  flashFire: false,
});
