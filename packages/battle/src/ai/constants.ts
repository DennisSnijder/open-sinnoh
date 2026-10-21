/** Decomp values the AI handlers use (names from pret/pokeplatinum; values are the ROM's enums and masks). */

export const MOVE = {
  NONE: 0,
  SONIC_BOOM: 49,
  LOW_KICK: 67,
  SEISMIC_TOSS: 69,
  DRAGON_RAGE: 82,
  NIGHT_SHADE: 101,
  PSYWAVE: 149,
  STRUGGLE: 165,
  CURSE: 174,
  PROTECT: 182,
  DETECT: 197,
  ENDURE: 203,
  RETURN: 216,
  FRUSTRATION: 218,
  MAGNITUDE: 222,
  HIDDEN_POWER: 237,
  WEATHER_BALL: 311,
  GYRO_BALL: 360,
  NATURAL_GIFT: 363,
  GRASS_KNOT: 447,
  JUDGMENT: 449,
} as const;

export const ABILITY = {
  NONE: 0,
  VOLT_ABSORB: 10,
  WATER_ABSORB: 11,
  CLOUD_NINE: 13,
  FLASH_FIRE: 18,
  SHADOW_TAG: 23,
  WONDER_GUARD: 25,
  LEVITATE: 26,
  NATURAL_CURE: 30,
  MAGNET_PULL: 42,
  ARENA_TRAP: 71,
  AIR_LOCK: 76,
  KLUTZ: 103,
  MULTITYPE: 121,
} as const;

export const TYPE = {
  NORMAL: 0,
  FIGHTING: 1,
  FLYING: 2,
  POISON: 3,
  GROUND: 4,
  ROCK: 5,
  BUG: 6,
  GHOST: 7,
  STEEL: 8,
  MYSTERY: 9,
  FIRE: 10,
  WATER: 11,
  GRASS: 12,
  ELECTRIC: 13,
  PSYCHIC: 14,
  ICE: 15,
  DRAGON: 16,
  DARK: 17,
} as const;

/** HOLD_EFFECT_ARCEUS_* (Judgment's type), by decomp hold effect name without the prefix. */
export const ARCEUS_PLATE_TYPES: Record<string, number> = {
  ARCEUS_FIRE: TYPE.FIRE,
  ARCEUS_WATER: TYPE.WATER,
  ARCEUS_ELECTRIC: TYPE.ELECTRIC,
  ARCEUS_GRASS: TYPE.GRASS,
  ARCEUS_ICE: TYPE.ICE,
  ARCEUS_FIGHTING: TYPE.FIGHTING,
  ARCEUS_POISON: TYPE.POISON,
  ARCEUS_GROUND: TYPE.GROUND,
  ARCEUS_FLYING: TYPE.FLYING,
  ARCEUS_PSYCHIC: TYPE.PSYCHIC,
  ARCEUS_BUG: TYPE.BUG,
  ARCEUS_ROCK: TYPE.ROCK,
  ARCEUS_GHOST: TYPE.GHOST,
  ARCEUS_DRAGON: TYPE.DRAGON,
  ARCEUS_DARK: TYPE.DARK,
  ARCEUS_STEEL: TYPE.STEEL,
};

export const ITEM_FULL_RESTORE = 23;

export const BATTLE_TYPE = {
  TRAINER: 1 << 0,
  DOUBLES: 1 << 1,
  LINK: 1 << 2,
  TWO_VS_TWO: 1 << 3,
  TAG: 1 << 4,
  SAFARI: 1 << 5,
  AI: 1 << 6,
  FRONTIER: 1 << 7,
  ROAMER: 1 << 8,
  PAL_PARK: 1 << 9,
} as const;
/** BATTLE_TYPE_TRAINER_DOUBLES = TRAINER | DOUBLES (3): one trainer, two out a side. */
export const BATTLE_TYPE_TRAINER_DOUBLES = BATTLE_TYPE.TRAINER | BATTLE_TYPE.DOUBLES;
/** BATTLE_TYPE_TAG_DOUBLES = TRAINER | DOUBLES | TAG (19): two enemy trainers against the player alone. */
export const BATTLE_TYPE_TAG_DOUBLES = BATTLE_TYPE.TRAINER | BATTLE_TYPE.DOUBLES | BATTLE_TYPE.TAG;
/** BATTLE_TYPE_AI_PARTNER = DOUBLES | 2vs2 | AI (74): the player and an AI partner against two wild Pokémon. */
export const BATTLE_TYPE_AI_PARTNER = BATTLE_TYPE.DOUBLES | BATTLE_TYPE.TWO_VS_TWO | BATTLE_TYPE.AI;
/** BATTLE_TYPE_TRAINER_WITH_AI_PARTNER = TRAINER | DOUBLES | 2vs2 | AI. */
export const BATTLE_TYPE_TRAINER_WITH_AI_PARTNER = BATTLE_TYPE.TRAINER | BATTLE_TYPE.DOUBLES | BATTLE_TYPE.TWO_VS_TWO | BATTLE_TYPE.AI;
/** BATTLE_TYPE_NO_AI_ITEMS = LINK | FRONTIER | SAFARI | AI | PAL_PARK. */
export const BATTLE_TYPE_NO_AI_ITEMS = BATTLE_TYPE.LINK | BATTLE_TYPE.FRONTIER | BATTLE_TYPE.SAFARI | BATTLE_TYPE.AI | BATTLE_TYPE.PAL_PARK;

export const MON_CONDITION = {
  SLEEP: 0b111,
  POISON: 1 << 3,
  BURN: 1 << 4,
  FREEZE: 1 << 5,
  PARALYSIS: 1 << 6,
  TOXIC: 1 << 7,
} as const;

export const VOLATILE_CONDITION = {
  CONFUSION: 0b111,
  BIND: (1 << 13) | (1 << 14) | (1 << 15),
  MEAN_LOOK: 1 << 26,
} as const;
/** VOLATILE_CONDITION_TRAPPED = BIND | MEAN_LOOK. */
export const VOLATILE_CONDITION_TRAPPED = VOLATILE_CONDITION.BIND | VOLATILE_CONDITION.MEAN_LOOK;

export const MOVE_EFFECT = {
  PERISH_SONG: 1 << 5,
  INGRAIN: 1 << 10,
  ABILITY_SUPPRESSED: 1 << 21,
  EMBARGO: 1 << 26,
} as const;

export const SIDE_CONDITION = {
  SPIKES: 1 << 2,
  MIST: 1 << 6,
  TOXIC_SPIKES: 1 << 10,
} as const;

export const FIELD_CONDITION = {
  RAINING: 0b11,
  SANDSTORM: 0b11 << 2,
  SUNNY: 0b11 << 4,
  HAILING: 0b11 << 6,
  GRAVITY: 0b111 << 12,
  DEEP_FOG: 1 << 15,
} as const;
/** FIELD_CONDITION_WEATHER = RAINING | SANDSTORM | SUNNY | HAILING | DEEP_FOG. */
export const FIELD_CONDITION_WEATHER = FIELD_CONDITION.RAINING | FIELD_CONDITION.SANDSTORM | FIELD_CONDITION.SUNNY | FIELD_CONDITION.HAILING | FIELD_CONDITION.DEEP_FOG;

export const MOVE_STATUS = {
  SUPER_EFFECTIVE: 1 << 1,
  NOT_VERY_EFFECTIVE: 1 << 2,
  INEFFECTIVE: 1 << 3,
  LEVITATED: 1 << 11,
  WONDER_GUARD: 1 << 18,
  MAGNET_RISE: 1 << 20,
} as const;
/** MOVE_STATUS_IMMUNE = INEFFECTIVE | WONDER_GUARD | LEVITATED | MAGNET_RISE. */
export const MOVE_STATUS_IMMUNE = MOVE_STATUS.INEFFECTIVE | MOVE_STATUS.WONDER_GUARD | MOVE_STATUS.LEVITATED | MOVE_STATUS.MAGNET_RISE;

/** TYPE_MULTI_*_DAMAGE: the type chart applied to 40 (BASE). */
export const TYPE_MULTI = {
  IMMUNE: 0,
  QUARTER: 10,
  HALF: 20,
  BASE: 40,
  STAB: 60,
  DOUBLE: 80,
  QUADRUPLE: 160,
} as const;

/** AI_BATTLER_* operands. */
export const AI_BATTLER = { DEFENDER: 0, ATTACKER: 1, DEFENDER_PARTNER: 2, ATTACKER_PARTNER: 3 } as const;

/** LOAD_* operands of LoadTypeFrom (generated/ai_load_type_targets.txt order). */
export const LOAD_TYPE = {
  DEFENDER_TYPE_1: 0,
  ATTACKER_TYPE_1: 1,
  DEFENDER_TYPE_2: 2,
  ATTACKER_TYPE_2: 3,
  MOVE_TYPE: 4,
  DEFENDER_PARTNER_TYPE_1: 5,
  ATTACKER_PARTNER_TYPE_1: 6,
  DEFENDER_PARTNER_TYPE_2: 7,
  ATTACKER_PARTNER_TYPE_2: 8,
} as const;

/** AI_WEATHER_* (generated/ai_weather_types.txt order). */
export const AI_WEATHER = { CLEAR: 0, SUNNY: 1, RAINING: 2, SANDSTORM: 3, HAILING: 4, DEEP_FOG: 5 } as const;

/** FlagMoveDamageScore results. */
export const AI_NO_COMPARISON_MADE = 0;
export const AI_NOT_HIGHEST_DAMAGE = 1;
export const AI_MOVE_IS_HIGHEST_DAMAGE = 2;
/** CheckBattlerAbility results. */
export const AI_NOT_HAVE = 0;
export const AI_HAVE = 1;
export const AI_UNKNOWN = 2;

export const CHECK_DISABLE = 0;
export const CHECK_ENCORE = 1;
export const CHECK_HIGHER_THAN_TARGET = 0;
export const CHECK_LOWER_THAN_TARGET = 1;
export const CHECK_EQUAL_TO_TARGET = 2;

/** BATTLE_STAT_* indexes of `AiBattler.statStages`; 6 is unchanged. */
export const BATTLE_STAT = { HP: 0, ATTACK: 1, DEFENSE: 2, SPEED: 3, SP_ATTACK: 4, SP_DEFENSE: 5, ACCURACY: 6, EVASION: 7 } as const;
export const DEFAULT_STAT_STAGE = 6;

/** ITEM_AI_CATEGORY_* (generated/item_ai_categories.txt order). */
export const ITEM_AI_CATEGORY = { FULL_RESTORE: 0, RECOVER_HP: 1, RECOVER_STATUS: 2, STAT_BOOSTER: 3, GUARD_SPEC: 4, MAX: 5 } as const;

/** Party slot 6: no slot chosen (aiSwitchedPartySlot) / no Pokémon found (post-KO switch-in). */
export const NO_SLOT = 6;
export const BATTLER_NONE = 0xff;
export const MAX_STACK = 8;
