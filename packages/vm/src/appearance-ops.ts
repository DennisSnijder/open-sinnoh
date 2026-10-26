/**
 * The trainer appearance commands (decomp scrcmd.c ScrCmd_LoadTrainerAppearances, ScrCmd_GetTrainerInfoTrainerClass,
 * ScrCmd_CalculateTrainerInfoAppearance, ScrCmd_SetTrainerInfoAppearance; scrcmd_strings.c
 * ScrCmd_BufferTrainerClassFromAppearance) over appearance.c: the Union Room look the player picks at Oreburgh's
 * Pokémon Center. It is kept in `GameState.appearance`; only the Union Room and Wi-Fi draw it.
 */
import type { GameState } from '@opensinnoh/contracts';
import { M1B_BANKS } from './m1b-ops.ts';
import type { Handler, Runner } from './runner.ts';

/**
 * Decomp sTrainerAppearances (enum TrainerAppearance order, APPEARANCES_COUNT male then female): the appearance index
 * and its trainer class (class1; class2 is the same class for every entry). Classes are TRAINER_CLASS_* numbers.
 */
const APPEARANCES: readonly { index: number; trainerClass: number }[] = [
  // SCHOOL_KID_M, BUG_CATCHER, ACE_TRAINER_M, ROUGHNECK, RUIN_MANIAC, BLACK_BELT, RICH_BOY, PSYCHIC_M
  { index: 3, trainerClass: 60 }, { index: 5, trainerClass: 6 }, { index: 11, trainerClass: 24 }, { index: 31, trainerClass: 57 },
  { index: 50, trainerClass: 48 }, { index: 51, trainerClass: 14 }, { index: 62, trainerClass: 32 }, { index: 70, trainerClass: 49 },
  // LASS, BATTLE_GIRL, BEAUTY, ACE_TRAINER_F, IDOL, SOCIALITE, COWGIRL, LADY
  { index: 6, trainerClass: 3 }, { index: 7, trainerClass: 10 }, { index: 13, trainerClass: 36 }, { index: 14, trainerClass: 25 },
  { index: 35, trainerClass: 85 }, { index: 37, trainerClass: 35 }, { index: 42, trainerClass: 18 }, { index: 63, trainerClass: 33 },
];
/** Decomp APPEARANCES_COUNT, VARIANTS_COUNT. */
const APPEARANCES_COUNT = 8;
const VARIANTS_COUNT = 4;
/** Decomp sAppearanceShuffleTable: the four appearances offered, by trainer id % APPEARANCES_COUNT. */
const SHUFFLE = [
  [0, 1, 2, 3], [1, 6, 7, 0], [2, 3, 4, 5], [3, 0, 5, 6], [4, 1, 2, 7], [5, 2, 7, 0], [6, 3, 4, 1], [7, 4, 5, 6],
] as const;

const genderOf = (s: GameState) => (s.gender === 'male' ? 0 : 1);

/** Decomp Appearance_CalculateFromTrainerInfo: the appearance index of a variant (0–3) for this trainer id and gender. */
export function calculateAppearance(s: GameState, variant: number): number {
  const i = SHUFFLE[(s.trainerId >>> 0) % APPEARANCES_COUNT]![variant];
  if (i === undefined) throw new Error(`trainer appearance variant ${variant} (0–${VARIANTS_COUNT - 1})`);
  return APPEARANCES[i + APPEARANCES_COUNT * genderOf(s)]!.index;
}

/** Decomp InitializeNewSave: the appearance a new game starts with (variant 0). */
export function newGameAppearance(s: GameState): number {
  return calculateAppearance(s, 0);
}

/** Decomp Appearance_GetData(APPEARANCE_DATA_TRAINER_CLASS_1): an index not among the gender's falls back to entry 0, as GetAppearanceIndex does. */
export function appearanceTrainerClass(s: GameState, appearance: number): number {
  const g = genderOf(s);
  const i = APPEARANCES.slice(g * APPEARANCES_COUNT, (g + 1) * APPEARANCES_COUNT).findIndex((a) => a.index === appearance);
  return APPEARANCES[i < 0 ? 0 : i + g * APPEARANCES_COUNT]!.trainerClass;
}

export function appearanceHandlers(r: Runner): Record<string, Handler> {
  const className = (bank: number, trainerClass: number) => r.textOf(r.bankText(bank, trainerClass));
  return {
    // Appearance_LoadVariants: slots 0–3 are the trainer classes of the four appearances offered.
    load_trainer_appearances: (t) => {
      for (let v = 0; v < VARIANTS_COUNT; v++) t.slots[v] = className(M1B_BANKS.trainerClassNames, appearanceTrainerClass(r.state, calculateAppearance(r.state, v)));
      return 'continue';
    },
    get_trainer_info_trainer_class: (t, _c, a) => {
      r.setVar(t, r.ref(a[1], 'var'), appearanceTrainerClass(r.state, calculateAppearance(r.state, r.val(t, a[0]))));
      return 'continue';
    },
    calculate_trainer_info_appearance: (t, _c, a) => (r.setVar(t, r.ref(a[1], 'var'), calculateAppearance(r.state, r.val(t, a[0]))), 'continue'),
    // TrainerInfo_SetAppearance: a u8.
    set_trainer_info_appearance: (t, _c, a) => ((r.state.appearance = r.val(t, a[0]) & 0xff), 'continue'),
    // StringTemplate_SetTrainerClassNameWithArticle of the saved appearance's class.
    buffer_trainer_class_from_appearance: (t, _c, a) => {
      const cls = appearanceTrainerClass(r.state, r.state.appearance ?? newGameAppearance(r.state));
      t.slots[r.int(a[0])] = className(M1B_BANKS.trainerClassNamesWithArticles, cls);
      return 'continue';
    },
  };
}
