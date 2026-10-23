/**
 * 0.35.0. Super Contests, offline (decomp src/contest.c, src/scrcmd_contests.c, src/unk_02094EDC.c, overlay017 and
 * overlay022; docs/research/contests.md): the tables read from the player's ROM, the running contest (`GameState.contest`,
 * from `new_contest` to `end_contest`), the winner photos, and the seam the three rounds plug into. Link contests are out
 * of scope: their receptionist answers "no connection".
 *
 * Ids follow the decomp: contest types CONTEST_TYPE_* (cool 0 … tough 4), ranks CONTEST_RANK_* (normal 0 … master 3),
 * competitions CONTEST_COMPETITION_*. A contestant id is the decomp's (0 = the player); its entry number is 3 − id.
 */
import type { Condition, Id, Pokemon } from '@opensinnoh/core';
import type { AppHost, AppMessage, AppYesNo } from './apps.ts';
import type { AudioHost } from './audio.ts';
import type { AnimView } from './battle.ts';
import type { Registries, StubLog } from './runtime.ts';
import type { GameState } from './state.ts';
import type { InputFrame } from './ui.ts';

/** Decomp CONTEST_TYPE_* order. */
export const CONTEST_TYPES = ['cool', 'beauty', 'cute', 'smart', 'tough'] as const;
/** Decomp CONTEST_RANK_* order. */
export const CONTEST_RANKS = ['normal', 'great', 'ultra', 'master'] as const;
/** Decomp CONTEST_NUM_PARTICIPANTS, CONTEST_NUM_JUDGES, the visual themes (sub_02095A74: 12). */
export const CONTEST_ENTRANTS = 4;
export const CONTEST_JUDGES = 3;
export const CONTEST_THEMES = 12;
/** Decomp constants/contests.h CONTEST_MODE_*. */
export const CONTEST_MODE = { official: 0, link: 1, practice: 2 } as const;
/** Decomp constants/contests.h CONTEST_COMPETITION_* (2: the full contest; 3/5/7 practice of one round; 4/6/8 unused single rounds). */
export const CONTEST_COMPETITION = { full: 2, practiceVisual: 3, visual: 4, practiceDance: 5, dance: 6, practiceActing: 7, acting: 8 } as const;

/** The three rounds, in the order a full contest runs them. */
export const CONTEST_ROUNDS = ['visual', 'dance', 'acting'] as const;
export type ContestRoundKind = (typeof CONTEST_ROUNDS)[number];

/**
 * One NPC contestant (contest_data.narc member 0, 48-byte records; decomp UnkStruct_ov6_02248BE8, read by sub_02094F04 and
 * sub_02095380):
 * - `species`, `moves` (four), `nickname` and `trainerName` (TEXT_BANK_CONTEST_OPPONENT_NAMES text ids), `condition`;
 * - `rank` (CONTEST_RANK_*), `types` (the contest types it enters), `practice` (bit unk_20_9: practice contests),
 *   `single` (bit unk_20_8: the unused single-round competitions), `pool` (unk_20_10: 0 always, 1 before the post-game
 *   only, 2 post-game only, 3 the post-game star, one of whom joins every contest then);
 * - `gender` (unk_20_12, the trainer's), `aiLevel` (unk_20_14, 0–3: the dance and acting AI's skill and the camera
 *   flashes' variant), `gfx` (unk_08, the overworld OBJ_EVENT_GFX_* on the stage), `trainerClass` (unk_0A, the
 *   trainer picture in the visual round), `fame` (unk_2E, the applause), `dressUps` (unk_22–2D: a `dressUps` index per
 *   visual theme).
 * Fields 0x00 (u32, 0 everywhere), 0x04 (u32, 0xFFFF everywhere) and 0x2F (u8, 100 everywhere) are not read by the decomp.
 */
export interface ContestOpponent {
  species: Id;
  moves: Id[];
  nickname: Id;
  trainerName: Id;
  condition: Condition;
  rank: number;
  types: number[];
  practice: boolean;
  single: boolean;
  pool: 0 | 1 | 2 | 3;
  gender: 'male' | 'female';
  aiLevel: number;
  gfx: number;
  trainerClass: number;
  fame: number;
  dressUps: number[];
}

/**
 * One judge (member 1, 8-byte records; decomp UnkStruct_020954F0, sub_020954F0): `name` (TEXT_BANK_CONTEST_JUDGE_NAMES),
 * `rank`, `roles` per contest type (0 absent, 1 a side judge, 2 a candidate for the main judge, the middle seat).
 * The u16 at 0x02 (decomp padding_02: 36, 62 or 35 per judge) and the top 4 bits of 0x04 (1 everywhere) are not read.
 */
export interface ContestJudge {
  name: Id;
  rank: number;
  roles: number[];
}

/**
 * An NPC's visual-round outfit (member 2, 84-byte records; decomp UnkStruct_020951B0, sub_020951B0): up to 20 placed
 * accessories (accessory id, x and y on the photo, draw priority), the Pokémon's own priority and the backdrop.
 */
export interface ContestDressUp {
  accessories: ContestPlacedAccessory[];
  monPriority: number;
  backdrop: number;
}
export interface ContestPlacedAccessory {
  accessory: number;
  x: number;
  y: number;
  priority: number;
}

/**
 * 0.35.0. The contest tables (`NewGame.contests`):
 * - `opponents`, `judges`, `dressUps`: contest_data.narc members 0–2;
 * - `themes`: members 3–14, per visual theme (decomp unk_112) each accessory's dress-up points (ov17_02252A70);
 * - `playerGfx`: OBJ_EVENT_GFX_PLAYER_M/F_CONTEST (the player's stage gfx, decomp Contest_Init),
 *   `playerSprite`: their sprites (ChangeIntoContestAttire's redraw).
 */
export interface ContestTables {
  opponents: ContestOpponent[];
  judges: ContestJudge[];
  dressUps: ContestDressUp[];
  themes: number[][];
  playerGfx: { male: number; female: number };
  playerSprite: { male: Id; female: Id };
  /** 0.36.0. The acting round's tables. Absent (packs without them): the acting round fails loudly. */
  acting?: ContestActingTables;
}

/**
 * 0.36.0. The acting round's tables (docs/research/contests.md §7), read from the player's ROM:
 * - `effects` by CONTEST_EFFECT_* (a move's `contest.effect`): arm9 Unk_020F568C (`description`, the move menu's two
 *   lines in TEXT_BANK_CONTEST_EFFECTS; `appeal`, the base points, unk_04; `messages`, the outcome line per variant 0–4
 *   in TEXT_BANK_CONTEST_ACTING_COMPETITION with its argument mode, null where the ROM has 0xFFFF) and overlay 17
 *   Unk_ov17_02253AF8 (`class`: 3 scored in the act, 5 a judge effect at the turn's end, 6 the pity points;
 *   `announce`: unk_05 = 0, its variant 4 is said before the act);
 * - `typeMatch` Unk_ov17_022539C8: the voltage change by [contest type][move's contest type] (+10, 0, −10);
 * - `messages` sActingCompetitionMessages: per ACTING_COMPETITION_MESSAGE_* its TEXT_BANK_CONTEST_TEXT line, argument
 *   mode and whether it prints at once;
 * - `rules` Unk_ov17_02253C30: the NPC AI's 165 rules;
 * - `buttonPalettes` Unk_ov17_022534B8: the move buttons' five BGR555 palettes (16 colours each, in table order).
 */
export interface ContestActingTables {
  effects: ContestEffect[];
  typeMatch: number[][];
  messages: ContestActingMessage[];
  rules: ContestAiRule[];
  buttonPalettes: number[][];
}

export interface ContestEffect {
  description: [Id, Id];
  appeal: number;
  class: number;
  announce: boolean;
  messages: (ContestActingMessage | null)[];
}

/** A line and its argument mode (decomp ov17_0224290C: which names and numbers fill its slots). */
export interface ContestActingMessage {
  text: Id;
  args: number;
  instant?: boolean;
}

/**
 * One NPC AI rule (decomp UnkStruct_ov17_02253C30): applies at performance `slot` (1–4) when `condition` (an index of
 * Unk_ov17_02253BBC, 1–28) holds; `target` is a CONTEST_EFFECT_*, 240 (the move's type is the contest's) or 241
 * (base appeal ≥ 20); `judges` the judge mode (0 clears the condition's judge marks, 2 and 3 invert them); `weights`
 * by AI level.
 */
export interface ContestAiRule {
  slot: number;
  condition: number;
  target: number;
  judges: number;
  weights: number[];
}

/** One contestant of the running contest (decomp Contest unk_00: contestMons, trainerNames, trainerGenders, unk_FC, monContestFame, contestantObjEventGFX). */
export interface ContestEntrant {
  /** Index into `ContestTables.opponents`; null for the player. */
  opponent: number | null;
  trainerName: string;
  gender: 'male' | 'female';
  /** A copy of the Pokémon at entry (the player's party Pokémon; an NPC's built at level 10 by sub_02095380). */
  mon: Pokemon;
  /** CalcMonContestFame (the player) or the record's fame: how loud the applause is (1–5+). */
  fame: number;
  /** The overworld gfx on the stage (VAR_OBJ_GFX_ID_n). */
  gfx: number;
  aiLevel: number;
}

/**
 * The raw points of each round, per contestant id (decomp Contest unk_118[]): `condition` (unk_00, ov17_0223F374),
 * `dressUp` (unk_02), `dance` (unk_04), `acting` (unk_06). A round not played (practice) stays null.
 */
export interface ContestRawScores {
  condition: number[];
  dressUp: number[] | null;
  dance: number[] | null;
  acting: number[] | null;
}

/**
 * The final scoring (decomp ov17_02251A1C): per round (visual, dance, acting; 0 when not part of the competition) the
 * points normalised against the round's leader (`points`) and the bar lengths in px (`bars`); the totals; the placement
 * per contestant id (0 = first), placed by the bar total with a random tie-break.
 */
export interface ContestResult {
  points: number[][];
  bars: number[][];
  totals: number[];
  placements: number[];
}

/**
 * 0.35.0. The contest running between `new_contest` and `end_contest` (`GameState.contest`; decomp Contest). Saves
 * happen only between scripts, so a save never holds one; it is plain JSON so a mid-contest snapshot round-trips.
 * - `mode` CONTEST_MODE (official or practice), `rank`, `type`, `competition`, `partySlot` (the entered party
 *   Pokémon), `theme` (the visual theme, decomp unk_112), `rng` (the contest LCRNG's state, decomp Contest_SetLCRNGSeed:
 *   seeded from one draw of the game's main stream).
 * - `entrants` by contestant id; `judges`: indexes into `ContestTables.judges`, the main judge in the middle.
 * - `scores` and `result` are written by the contest app (`run_contest_application`); `result` stays null in practice,
 *   whose `placement` is the player's (decomp FieldTask_RunPracticeCompetition).
 */
export interface ContestSession {
  mode: 'official' | 'practice';
  rank: number;
  type: number;
  competition: number;
  partySlot: number;
  theme: number;
  rng: number;
  entrants: ContestEntrant[];
  judges: number[];
  scores: ContestRawScores | null;
  result: ContestResult | null;
  /** The player's placement (0 = first) once the app has run. */
  placement: number | null;
  /** The player's visual-round outfit (the photo's), once the visual round has run. */
  dressUp: ContestDressUp | null;
  /**
   * 0.36.0. The acting round's progress, written by that round while it runs (replays wait on it with `until state`):
   * the turn (0–3) and whether it waits for the player's move and judge. Absent before the round.
   */
  acting?: ContestActingProgress;
}

export interface ContestActingProgress {
  turn: number;
  choosing: boolean;
}

/**
 * 0.35.0. A contest winner photo (`GameState.contestPhotos`, one per contest type; decomp ImageClips contest photos,
 * struct_02029C88): the winning Pokémon, its trainer, the rank and the outfit. The lobby's frames show them
 * (scr_cmd_0a8, the visual round's lane).
 */
export interface ContestPhoto {
  mon: { species: Id; form: number; pid: number; otId: number; nickname: string | null };
  trainerName: string;
  rank: number;
  dressUp: ContestDressUp;
}

/**
 * The seam the rounds plug into. A round is a headless model the contest app steps once per tick (30 Hz) with the
 * player's input, until it returns its outcome. Its context gives it the running contest (read only), the game's
 * records and state (the Fashion Case), the host (sound) and the contest LCRNG (`rng`: decomp Contest_GetRNGNext, a u16;
 * every draw moves the session's `rng`, so rounds draw in a fixed order for replays).
 */
export interface ContestRoundContext {
  readonly session: Readonly<ContestSession>;
  readonly registries: Registries;
  readonly state: Readonly<GameState>;
  readonly host: AppHost;
  readonly log: StubLog;
  rng(): number;
}

/**
 * What a round returns, per contestant id: `visual` the dress-up points (decomp unk_02; the condition points are the
 * session's) and the player's outfit; `dance` unk_04; `acting` unk_06.
 */
export type ContestRoundOutcome =
  | { kind: 'visual'; dressUp: number[]; outfit: ContestDressUp }
  | { kind: 'dance'; points: number[] }
  | { kind: 'acting'; points: number[] };

export interface ContestRound {
  readonly kind: ContestRoundKind;
  /** True for the placeholder rounds (no gameplay, scored from condition): logged and counted, never silent. */
  readonly placeholder: boolean;
  /** One tick. Returns the outcome once the round is over (then it is not stepped again). */
  step(input: InputFrame): ContestRoundOutcome | null;
  view(): ContestRoundView;
}

export type CreateContestRound = (kind: ContestRoundKind, ctx: ContestRoundContext) => ContestRound;

/**
 * A round's view (inside `ContestView`). The placeholder: the round's name and its message box. The round lanes add
 * their own members to this union. Taps: `next`.
 */
export type ContestRoundView = ContestPlaceholderRoundView | ContestActingRoundView;
export interface ContestPlaceholderRoundView {
  round: ContestRoundKind;
  placeholder: true;
  message: AppMessage;
}

/**
 * 0.36.0. The acting round (decomp overlay017 ActingCompetition_*: ov17_0223B140.c and its presentation commands,
 * ov17_02243C28.c, ov17_022413D8.c, ov17_0223F7E4.c): the stage as the DS main screen draws it, in DS px, and the
 * touch screen's move and judge menus while the player chooses.
 * - `fade` 0–1: the screen fade from black (the round's start and end).
 * - `audience` 0/1: the audience's frame (0 its usual, contest_bg 2; 1 the cheering one, member 0: the applause
 *   alternates them), `glow` 0–16: the audience palettes' blend toward 0x237E as the applause after a voltage rise
 *   (decomp ov17_022431E8).
 * - `judges` by seat (left to right): name, the main judge, `pips` the voltage meter's five pips (lit or not), `blink`
 *   the frames since a full meter began to blink (null: not), `dy`/`dx` the hop or shake, `reaction` the bubble's
 *   animation (contest_obj 12–14) or null.
 * - `panels` in performance order (rows top to bottom): who, `hearts` the points shown (10 per heart, 6 a row, up to
 *   four rows of colour), `gather` 0–1 the hearts flying into the panel at the turn's end, `flash` 0–10 its white blend,
 *   `slot` the next turn's forced place (contest_obj 21–23) or null; `panelAlpha` 0–1: the panels fade out while a
 *   Pokémon performs.
 * - `performer`: the acting Pokémon's back picture, centred at (x, y) DS px, mirrored when `flip`; `anim` its move's
 *   animation (the battle animation VM in contest mode), drawn as the battle scene draws one.
 * - `stars`: what flies at DS px (`star`: from a judge to its meter, contest_obj 27–29; `pip`: a full meter's pip to
 *   the performer's panel).
 * - `message`: the stage's message window (the printed text so far).
 * - `choice`: the move and judge menus (taps `move:<0-3>`, `judge:<0-2>`, `back`).
 */
export interface ContestActingRoundView {
  round: 'acting';
  placeholder: false;
  turn: number;
  fade: number;
  audience: number;
  glow: number;
  judges: { name: string; main: boolean; pips: boolean[]; blink: number | null; dx: number; dy: number; reaction: number | null }[];
  panels: { contestant: number; mon: string; trainer: string; player: boolean; hearts: number; gather: number; flash: number; slot: number | null }[];
  panelAlpha: number;
  performer: { contestant: number; species: Id; form: number; shiny: boolean; female: boolean; x: number; y: number; flip: boolean } | null;
  anim: AnimView | null;
  stars: { kind: 'star' | 'pip'; x: number; y: number }[];
  message: string | null;
  choice: ContestActingChoiceView | null;
}

/**
 * The touch screen while the player chooses (decomp ov17_0223F7E4.c): `stage` move or judge; `cursor` the key
 * cursor (null until a key is pressed: the DS shows it on the first key); `moves` by slot (null: no move), each with
 * its contest type, base hearts and the effect's two lines, `disabled` when it was used last turn; the judges by
 * seat; `back` the judge menu's EXIT line.
 */
export interface ContestActingChoiceView {
  stage: 'move' | 'judge';
  cursor: number | null;
  moves: ({ name: string; type: number; hearts: number; description: [string, string]; disabled: boolean } | null)[];
  judges: { name: string; main: boolean }[];
  back: string;
}

/**
 * 0.36.0. A move's animation as the acting round plays it (decomp ov17_022444BC: BattleAnimSystem_StartMove with the
 * contest flag): the performer is battler 0 (its back picture at the contestant's place, 216,112), the next
 * contestant's Pokémon the hidden battler 1 (80,42). `effectChance` is the script's effect chance (decomp unk_07: a
 * two-turn move's second pass, a Ghost's Curse, Brick Break).
 */
export interface ContestMoveAnimationRequest {
  move: Id;
  attacker: { species: Id; form: number };
  defender: { species: Id; form: number };
  effectChance: number;
  seed: number;
}

/** A running contest move animation: one `tick` per frame until `done`. */
export interface ContestMoveAnimation {
  tick(): void;
  readonly done: boolean;
  view(): AnimView;
}

/**
 * Makes a move animation (packages/battle). Null when the move has no script or the script needs what the contest
 * mode of the animation VM does not run (logged and counted by the factory): the act goes on without one.
 */
export type CreateContestMoveAnimation = (request: ContestMoveAnimationRequest, deps: { registries: Registries; log: StubLog; sound?: AudioHost }) => ContestMoveAnimation | null;

/**
 * 0.35.0. The contest app (`run_contest_application`): the rounds of the competition one after the other, then the
 * results (official contests). `results`: the four entrants in entry order with their points per round and in total,
 * and the placements once announced. Taps: `next` (the message box).
 */
export interface ContestView {
  app: 'contest';
  /** The heading: rank and type ("NORMAL RANK", "COOL CONTEST"). */
  heading: { rank: string; type: string };
  round: ContestRoundView | null;
  results: ContestResultsView | null;
  message: AppMessage | null;
  yesNo: AppYesNo | null;
}
export interface ContestResultsView {
  /** The round headings (VISUAL, DANCE, ACTING) and the total's. */
  headings: string[];
  /** Entry order (No. 1 … No. 4). */
  /** `points` per round (normalised, decomp unk_39A), null until announced; `total` and `place` null until the winner is. */
  rows: { entry: number; trainer: string; mon: string; points: (number | null)[]; total: number | null; place: number | null; player: boolean }[];
}
