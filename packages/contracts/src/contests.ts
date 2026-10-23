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
  /** 0.35.2. The Dance Competition's tables (overlay 17). */
  dance: ContestDanceTables;
  /** 0.35.1. Per accessory id (100), its picture (imageclip.narc member 1 + id): the visual round's hit tests. */
  accessories: ContestAccessory[];
}

/**
 * 0.35.2. One Dance Competition song (overlay 17 Unk_ov17_02253084, 12-byte rows): the BGM it plays (`sequence`), its
 * tempo (`bpm`), the measures of a dance round (`measures`, unk_04), the lead's steps a measure (`moves`, unk_05), the
 * beats before the first round and between rounds (`leadIn` unk_06, `gap` unk_07) and the grading windows in frames
 * (`windows`, unk_08: a step `d` frames off its half-beat is excellent up to [0] and [1], good up to [2] and [3]).
 */
export interface ContestDanceSong {
  sequence: Id;
  bpm: number;
  measures: number;
  moves: number;
  leadIn: number;
  gap: number;
  windows: [number, number, number, number];
}

/**
 * 0.35.2. The Dance Competition's tables (overlay 17; docs/research/contests.md §6):
 * - `songs`; `choice[rank][type]`: the song and measure variant a contest dances to (Unk_ov17_0225312C);
 * - `variants` (Unk_ov17_02252FC4): `tilemap` (the stage's contest_bg NSCR member), `beats` a measure (each split in
 *   two half-beats) and `tiles`, the timeline's width in 8-px tiles;
 * - the NPC dancers' AI (ov17_0224E930.c): `aiJitter` per AI level (Unk_ov17_02254A80, the timing spread), `aiRepeat`
 *   per rank (Unk_ov17_02254A84, % that a lead repeats its last direction);
 * - `stage` per stage position (0 the lead): x, y and depth (Unk_ov17_022546F4); `grades`: where a dancer's grade pops
 *   up (Unk_ov17_022546CC); `noteRows`: its notes' row on the timeline (Unk_ov17_022549BC);
 * - `tints`: the stage's blend after a lead step (Unk_ov17_022546DC: RGB555 colour and level /16; 0 none, 1–4 by step
 *   code, 5 a miss); `shades`: the dancers' grey by place at the end (Unk_ov17_022549C0);
 * - `buttons`: the touch screen's step buttons (Unk_ov17_02254564: up, down, left, right; DS px).
 */
export interface ContestDanceTables {
  songs: ContestDanceSong[];
  choice: { song: number; variant: number }[][];
  variants: { tilemap: number; beats: number; tiles: number }[];
  aiJitter: number[];
  aiRepeat: number[];
  stage: { x: number; y: number; z: number }[];
  grades: { x: number; y: number }[];
  noteRows: number[];
  tints: { color: number; level: number }[];
  shades: number[];
  buttons: { x: number; y: number; w: number; h: number }[];
}

/**
 * 0.35.1. An accessory's picture (a software sprite's 4bpp bitmap, imageclip.narc member 1 + id): `width` × `height`
 * px (16, 32 or 64 each) and `mask`, its opaque pixels as base64 of a bitmap (row-major, `width` bits a row, the
 * lowest bit first). The decomp's touch picks an accessory by its pixels (ov22_02254E54); the overlap tests use
 * its rectangle.
 */
export interface ContestAccessory {
  width: number;
  height: number;
  mask: string;
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
export type ContestRoundView =
  | ContestPlaceholderRoundView
  | ContestVisualRoundView
  | ContestDanceRoundView;
export interface ContestPlaceholderRoundView {
  round: ContestRoundKind;
  placeholder: true;
  message: AppMessage;
}

/**
 * 0.35.2. The Dance Competition (decomp overlay017 ov17_0223DAD0.c; packages/menus contest/dance.ts): the stage (the
 * top screen) and the step buttons (the touch screen's content), in DS px.
 * - `variant`: the stage and timeline (`ContestDanceTables.variants`); `dancers` in draw order (the back row first),
 *   each at its centre with its scale (256 = 1), turn (degrees) and `shade` (its colour toward the DS's grey 0x254a,
 *   0–16: 16 while another dances, by place at the end);
 * - `timeline`: `fill` px of the beat bar filled, `flash` (the half that lights up, 0–10), the step notes (`code` 1–4,
 *   `anim` 0 the player's, 1 a rival's, 2 the step the player must copy; `frame` ticks since it appeared), the beat
 *   ball and the progress cursor;
 * - `grades`: EXCELLENT/GOOD/MISS over a dancer (`frame` ticks in); `hearts` flying from a dancer; `tint`: the stage's
 *   blend toward a step's colour (RGB555, 0–16); `flash`/`fade`: white/black over the stage, 0–16;
 * - `buttons` while the touch screen shows them: `dim` while they take no step, the pressed one (`step` 0/1 of the
 *   press animation, null at rest; `label` px the label is pushed down), the labels (UP/JUMP, FRONT, LEFT, RIGHT);
 * - `arrow`: over the player's dancer; `banner`: the round's instruction; `message`: the MC.
 * Taps: `step:<0–3>` (up, down, left, right), `next`.
 */
export interface ContestDanceRoundView {
  round: 'dance';
  placeholder: false;
  variant: number;
  dancers: ContestDancerView[];
  timeline: {
    fill: number;
    flash: { half: 0 | 1; level: number } | null;
    notes: { x: number; y: number; code: number; anim: 0 | 1 | 2; frame: number }[];
    ball: { x: number; y: number; frame: number } | null;
    cursor: number | null;
  };
  grades: { x: number; y: number; grade: 0 | 1 | 2; text: string; frame: number }[];
  hearts: { x: number; y: number; anim: 0 | 1 }[];
  tint: { color: number; level: number } | null;
  flash: number;
  fade: number;
  buttons: { dim: boolean; press: { dir: number; step: 0 | 1 | null; label: number } | null; labels: string[] } | null;
  arrow: { x: number; y: number } | null;
  banner: string | null;
  message: AppMessage | null;
}
export interface ContestDancerView {
  id: number;
  species: Id;
  form: number;
  shiny: boolean;
  female: boolean;
  x: number;
  y: number;
  scale: number;
  angle: number;
  /** Its shadow's y (the stage floor under it, ov17_0224ABFC). */
  ground: number;
  shade: number;
  player: boolean;
}

/**
 * 0.35.1. A contest photo as drawn (decomp ov22_0225AF8C): the Pokémon's front sprite (first frame) centred at
 * (`mon.x`, `mon.y`) and the accessories at their pictures' top-left, all in DS px of the screen that shows it,
 * back to front with the Pokémon drawn after the first `monAt`; the backdrop (null: none drawn) is the 112 × 128
 * picture at (`backdropX`, `backdropY`).
 */
export interface ContestPicture {
  mon: { species: Id; form: number; female: boolean; shiny: boolean; x: number; y: number };
  accessories: { accessory: number; x: number; y: number }[];
  monAt: number;
  backdrop: number | null;
  backdropX: number;
  backdropY: number;
}

/**
 * 0.35.1. The visual round (decomp overlay022 VisualCompetition_*, the dress-up; overlay017 VisualCompetitionScoring_*,
 * the judging): `phase` `intro` (the top screen's clock with the host's messages), `dress` (the touch screen's
 * Fashion Case and stage), `scoring` (each entrant's photo and hearts). `fade` darkens the screen (0 clear … 16
 * black). Taps: `next` (the message box); in `dress` the stylus `dress:<x>,<y>` while it is down and `dress-up`, and
 * the buttons `case-next`, `case-prev`, `tab-accessories`, `tab-backdrops`, `done`.
 */
export interface ContestVisualRoundView {
  round: 'visual';
  placeholder: false;
  phase: 'intro' | 'dress' | 'scoring';
  fade: number;
  message: AppMessage | null;
  /** The intro's top screen: the clock's seconds, the rank's limit of accessories (its dots) and the theme window's line. */
  intro: { seconds: number; limit: number; theme: string } | null;
  dress: ContestDressView | null;
  scoring: ContestVisualScoringView | null;
}

/**
 * 0.35.1. The dress-up screen (overlay022): the top screen folded into a line (`theme`, `status`: the held accessory's
 * name or "There is no more space.", the clock and the accessories placed of the limit); the Fashion Case's page
 * (`tab`, `page`, `pageBg` 0/1: the page's paper) with its `items` and the stage (`backdrop`, the Pokémon, `stage` items)
 * back to front, the item in hand last; the buttons (`pressed`: the one held down); the keyboard's hand (`cursor`).
 */
export interface ContestDressView {
  theme: string;
  status: string | null;
  seconds: number;
  /** The last ten seconds: the digits' alternate palette, and `pulse` (1 → 2.5 → 1 over 16 frames after a change). */
  hurry: boolean;
  pulse: number;
  placed: number;
  limit: number;
  tab: 'accessories' | 'backdrops';
  page: number;
  pageBg: 0 | 1;
  pressed: 'case-next' | 'case-prev' | 'done' | null;
  backdrop: number;
  mon: ContestPicture['mon'];
  items: { kind: 'accessory' | 'backdrop'; id: number; x: number; y: number; held: boolean }[];
  /** The Pokémon draws after the first `monAt` items. */
  monAt: number;
  cursor: { x: number; y: number; grabbing: boolean } | null;
}

/**
 * 0.35.1. The judging (ov17_0223CB1C): the stage, the curtain while no photo is up, the entrant's `picture`, and the
 * hearts rising (`kind` condition or dress-up; centre in DS px).
 */
export interface ContestVisualScoringView {
  curtain: boolean;
  picture: ContestPicture | null;
  hearts: { x: number; y: number; kind: 'condition' | 'dressUp' }[];
}

/**
 * 0.35.1. The lobby's photo frames (scr_cmd_0a8; decomp ov22_0225B660): the winner photo of contest type `type` in
 * its frame with its backdrop, and the banner's two lines (the contest and rank; the trainer and Pokémon). A or B
 * (or `back`, `next`) closes it.
 */
export interface ContestPhotoView {
  app: 'contest-photo';
  type: number;
  picture: ContestPicture;
  lines: [string, string];
}

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
