/**
 * The battle controller (wild and trainer singles, the first battle, the catching
 * tutorial). The sim is the "server" that resolves a turn; this is the DS battle controller around it
 * (decomp battle_controller_player.c): intro, command selection, the turn's messages and animations in the
 * decomp's order, exp and level-up, the result. Everything runs on the 30 Hz tick as one generator (`main`),
 * so a battle is a pure function of setup, seed and choices.
 *
 * The opposing side: a wild Pokémon (a random usable move), or a trainer's party driven by the ported trainer
 * AI (`createTrainerAi` over `createAiView`): switch, item, move, and the post-KO send-out.
 *
 * Battlers are the DS ids (0 the player, 1 the first enemy, 2 and 3 their
 * partners), each with its owner's party (a `Team` per battler). The `ai-partner` topology against two trainers
 * (decomp BATTLE_TYPE_TRAINER_WITH_AI_PARTNER, 75) runs on the sim's native `multi` format: p1 the player, p2 and
 * p4 the enemy trainers, p3 the AI partner, so every owner keeps its own reserve. The partner's and the enemies'
 * commands come from the same ported trainer AI, each with its own trainer's mask. The player loses when the
 * player's own party is out, whatever the partner has left (decomp BattleControllerPlayer_CheckBattleOver).
 *
 * The other topologies (docs/research/double-battles.md §6.3). A wild double with an AI partner (decomp
 * BATTLE_TYPE_AI_PARTNER, 74) runs on `multi` too: p2 and p4 each own one wild Pokémon. Trainer doubles (one
 * trainer, 3) and two trainers against the player alone (19) run on the sim's `doubles` format: battlers 0 and 2
 * are p1's two positions (the player's party, both commanded by the player), 1 and 3 p2's. In 19 the enemy sim
 * side holds both trainers' rosters; an owner map keeps them apart (replacements from the battler's own trainer,
 * an owner with no reserve leaves its slot empty, Roar drags from the owner, Beat Up, Assist and Heal Bell scan
 * the owner's party: the proof, sim/trainer-pair.proof.test.ts). The player's commands in a double: the
 * first battler, then the second, CANCEL going back unless the first used an item (the decomp's item id > 16
 * gate); items act when chosen (decomp BattleSystem_UseBagItem at menu time), balls when the turn runs.
 *
 * The bag (balls, medicine, battle items), catching, switching by choice and the
 * replacement after a faint ("Use next Pokémon?"); their parts are the "bag, party and catching" section
 * below. The bag and party sheets are menu apps the game hosts (`app()` / `appDone`).
 *
 * Not yet (logged when hit or refused): the protocol lines with no message mapped.
 */
import { type Battle as SimBattle, PRNG, toID } from '@pkmn/sim';
import {
  addExp,
  bagCount,
  medicineEffect,
  PARTY_SIZE,
  removeItem,
  type Bag,
  type Button,
  calcStats,
  createPokemon,
  createRandomPokemon,
  ENGLISH,
  shinyPid,
  createTrainerPokemon,
  expGain,
  expShares,
  gainEvs,
  isShiny,
  maxPp,
  monGender,
  Prng,
  randomIvs,
  rollWildHeldItem,
  setMoveSlot,
  type Dex,
  type Id,
  type Pokemon,
  type StatusCondition,
} from '@opensinnoh/core';
import {
  dexOf,
  isWildKind,
  MONEY_MAX,
  newGameRecord,
  trainerCapsule,
  type Battle,
  type BattleChoice,
  type BattleDeps,
  type BattleOwner,
  type BattleTopology,
  type BattleMoveView,
  type BattleOutcome,
  type BattlePrompt,
  type BattleResult,
  type BattlerView,
  type BattleSetup,
  type BattleView,
  type CreateBattle,
  type AppRequest,
  type AppResult,
  type BattleAnimation,
  type InputFrame,
  type Item,
  type Move,
  type ParticleSystem,
  type Trainer,
} from '@opensinnoh/contracts';
import { canEscape, EXP_PIXELS, gaugeFrame, gaugeTemp, HP_PIXELS, levelUpFriendship, moneyPenalty, prizeMoney } from './formulas.ts';
import { ballModifier, CAUGHT, catchShakes, SAFARI_STAGE_MAX, SAFARI_STAGE_START, safariScaled } from './catch.ts';
import { BattleText, plainText, type PartyString, type Who, type WhoPair } from './messages.ts';
import { ESCAPE_MOVE, Lcrng, PASS_MOVE, simData, simOwners, simSet, type SimData, type SimGameType } from './sim/dex.ts';
import { BATTLE_TYPE, BATTLE_TYPE_AI_PARTNER, BATTLE_TYPE_TAG_DOUBLES, BATTLE_TYPE_TRAINER_DOUBLES, BATTLE_TYPE_TRAINER_WITH_AI_PARTNER, ITEM_AI_CATEGORY, NO_SLOT } from './ai/constants.ts';
import { createTrainerAi, type AiAction, type TrainerAi } from './ai/choose.ts';
import { aiForgetBattler, aiResetSwitches, aiRevealAbility, aiRevealHeldItem, createAiMemory } from './ai/memory.ts';
import type { AiMemory } from './ai/view.ts';
import { createAiView } from './controller/ai-view.ts';
import { TARGET_CANCEL, targetCursor } from './controller/target-screen.ts';
import { AnimVm, animSupport, commonAnimation, moveAnimation, type AnimSound } from './anim/index.ts';
import { SendOutEffect } from './anim/send-out.ts';
import { SplRandom } from './anim/spl.ts';
import { TextPrinter, toPrintOps } from '@opensinnoh/text';

/**
 * Ticks a printed message stays before the next (A, B, X, Y or a tap ends it: `waitButtonAB`). Shortened: the
 * battle scripts wait WaitButtonABTime 30 after most messages, 15 or 60 after some, and not at all after
 * "X used Y!"; per-message waits are not ported.
 */
const MESSAGE_HOLD = 20;
/**
 * The wild encounter cut-in (decomp EncounterEffect_Grass_*), one DS frame per tick (its tasks are main-loop
 * SysTasks): two master-brightness flashes (EncounterEffect_FlashTask: a 4-call LinearInterpolationTaskS32
 * 0 → 16, an init frame, 16 → 0, twice, between an init and a finish frame: 22 frames), then the 13-frame
 * screen slice (`close` 0 → 1), then a tick of black; the app draws them (colour and band size by level).
 * 36 ticks in all, as before (the black was padding).
 */
const TRANSITION_FLASH = [0, 0, 0, 5, 10, 16, 16, 16, 11, 6, 0, 0, 0, 5, 10, 16, 16, 16, 11, 6, 0, 0].map((v) => v / 16);
const TRANSITION_SLICE = 13;
const TRANSITION_BLACK = 1;
const FADE_IN = 8;
const SLIDE_IN = 24;
const HEALTHBOX_SLIDE = 160;
const HEALTHBOX_STEP = 48;
const FADE_OUT = 12;
/** The player's throw (trainer back sprite animation 1): the send-out happens here, the slide-out starts here. */
const THROW_SEND_OUT = 28;
const THROW_SLIDE_FROM = 24;
const THROW_SLIDE_STEP = 8;
/** The enemy trainer leaves to the right after its first send-out and slides back for the defeat lines (DS px per tick). */
const TRAINER_SLIDE_STEP = 8;
const TRAINER_OFF = 128;
/** subscript_trainer_message's WaitButtonABTime 60: one battle-script step per frame, one frame per tick. */
const TRAINER_MESSAGE_WAIT = 60;
/** Where the trainer stops for its line: gBattlerEncounterX[enemy][1] = 224, beside its Pokémon at 192. */
const TRAINER_MESSAGE_DX = 32;
/** Decomp BATTLE_STATUS_FIRST_BATTLE (battle status mask; not a battle type, so the AI never sees it). */
const BATTLE_TYPE_CATCH_TUTORIAL = 1 << 10;
/** Decomp FieldBattleDTO_InitFrontierTrainer: AI_FLAG_BASIC | AI_FLAG_EVAL_ATTACK | AI_FLAG_EXPERT. */
const FRONTIER_AI = 0b111;
/** Decomp BATTLE_TYPE_ROAMER: a roaming Pokémon (contracts `WildSpec.roamer`). */
const BATTLE_TYPE_ROAMER = 1 << 8;
/** Decomp SEQ_SE_DP_PINPON: the announcer's chime ("You're out of Safari Balls!"). */
const SE_PINPON = 1521;
/** Decomp SE_CONFIRM: a press that ends a message's {clear}/{scroll} wait (TextPrinter_Continue). */
const SE_CONFIRM = 1500;
/** The sound of a wild Pokémon running off (subscript_enemy_escape's PlaySound 1791). */
const SE_ESCAPE = 1791;
/**
 * The ball opening at a send-out (decomp SEQ_SE_DP_SLOT01_sseq_1: the second sequence on SEQ_SE_DP_SLOT01.sseq, which
 * in the US ROM's SDAT is 1798 SEQ_SE_DP_BOWA2; 1744 SEQ_SE_DP_SLOT01 is the first).
 */
const SE_BALL_OPEN = 1798;
/** The catching tutorial's wait before the ball (decomp GetCatchTutorialLowHPInput: 60 frames). */
const TUTORIAL_WAIT = 30;

const STATUS_FROM_SIM: Record<string, StatusCondition> = { '': 'none', psn: 'poison', tox: 'toxic', brn: 'burn', par: 'paralysis', slp: 'sleep', frz: 'freeze' };
const STATUS_TO_SIM: Record<StatusCondition, string> = { none: '', poison: 'psn', toxic: 'tox', burn: 'brn', paralysis: 'par', sleep: 'slp', freeze: 'frz' };
const SIM_STATS = { atk: 'attack', def: 'defense', spa: 'spAttack', spd: 'spDefense', spe: 'speed' } as const;
const STATUS_MESSAGES: Record<string, string> = {
  par: 'PokemonIsParalyzedItMayBeUnableToMove',
  psn: 'PokemonWasPoisoned',
  tox: 'PokemonWasBadlyPoisoned',
  brn: 'PokemonWasBurned',
  slp: 'PokemonFellAsleep',
  frz: 'PokemonWasFrozenSolid',
};
const CANT_MESSAGES: Record<string, string> = { par: 'PokemonIsParalyzedItCantMove', slp: 'PokemonIsFastAsleep', frz: 'PokemonIsFrozenSolid' };
/** Protocol lines with nothing to show (`-anim`: a move's animation the sim names, e.g. Solar Beam's in sun; no message on the DS). */
const QUIET = new Set(['', 't:', 'gametype', 'player', 'teamsize', 'gen', 'tier', 'start', 'turn', 'upkeep', 'debug', '-anim']);

/** Item.battlePocket bits (decomp BATTLE_POCKET_MASK_*). */
const POCKET_BALLS = 1;
const POCKET_BATTLE_ITEMS = 2;
/** decomp BATTLE_USE_CATEGORY_ESCAPING (Poké Doll, Fluffy Tail). */
const BATTLE_USE_ESCAPE = 3;
/** Battle items' stat stages (ItemPartyParam) → sim boost ids and the stat names' bank keys. */
const ITEM_STAGES = { attack: 'atk', defense: 'def', spAttack: 'spa', spDefense: 'spd', speed: 'spe', accuracy: 'accuracy' } as const;
/** decomp MAX_STAT_STAGE above the neutral 6: +6. */
const MAX_BOOST = 6;
/** BattleParty_Text_* by core `MedicineMessage`. */
const MEDICINE_TEXT: Record<string, PartyString> = {
  revived: 'ItemRevivedPokemon',
  restored: 'ItemRestoredHealth',
  pp: 'ItemRestoredPP',
  sleep: 'ItemCuredSleep',
  poison: 'ItemCuredPoisoning',
  burn: 'ItemCuredBurn',
  freeze: 'ItemCuredFreeze',
  paralysis: 'ItemCuredParalysis',
  confusion: 'ItemCuredConfusion',
  attract: 'ItemCuredInfatuation',
  multiple: 'ItemCuredMultipleStatuses',
};
/** The broken-free messages by the shakes before it (decomp BattleStrings 863–866). */
const BROKE_FREE = ['OhNoThePokemonBrokeFree', 'AwwItAppearedToBeCaught', 'AarghAlmostHadIt', 'ShootItWasSoCloseToo'];
/**
 * The ball (DS px, ticks): its flight from the player's side to the foe, where it opens, and the spot it
 * drops to (decomp ov12_02235E94.c BallRotation: 32 px down over 10 frames). The rest follows that
 * file's sequences one step per frame; its tasks are SysTasks of the main loop, which runs at 30 Hz, so a
 * frame is a tick:
 * - the bounce (20 frames, Unk_ov12_0223ACF0): the ball's y step each frame and whether it shows its
 *   squashed cell (open animation frame 1);
 * - each shake: 14 frames still, then the rock (Unk_ov12_0223AC38, 6 frames; the third has 5 more still
 *   frames): the ball moves
 *   sideways and turns 2° per px, clockwise to the right, so it rocks on the ground; the second and third
 *   at half the swing; then 12 frames before the next (BattleScript_CatchMonTask);
 * - caught: 12 frames, the ball darkens to 10/16 while three stars fly out (the catch particle emitter,
 *   19-frame particles), "Gotcha!", then it fades out over 16 frames.
 */
const BALL_FROM = { x: 32, y: 112 };
const BALL_AT = { x: 192, y: 48 };
const BALL_REST_Y = 80;
const BALL_FLIGHT = 20;
const BALL_ABSORB = 10;
const BALL_DROP = 10;
/** The bounce: [y step, squashed] per frame (the steps of each bounce sum to 0). */
// prettier-ignore
const BALL_BOUNCE: [number, boolean][] = [
  [-7, true], [-5, false], [-3, false], [-2, false], [2, false], [3, false], [5, false], [7, true],
  [-5, true], [-3, false], [-2, false], [2, false], [3, false], [5, true],
  [-2, false], [-1, false], [1, false], [2, false],
  [-2, true], [2, true],
];
const BALL_SHAKE_WAIT = 14;
/** Each rock: the x step per frame. */
const BALL_SHAKES = [[-2, 0, 2, 2, 0, -2], [-1, 0, 1, 1, 0, -1], [-1, 0, 1, 1, 0, -1, 0, 0, 0, 0, 0]];
const BALL_SHAKE_PAUSE = 12;
const BALL_CAUGHT_WAIT = 12;
const BALL_SHADE = 10 / 16;
/** The stars' 19-frame particles, and a few frames more. */
const BALL_STARS = 22;
const BALL_FADE_OUT = 16;
/** The open animation's frame 1 (the squashed ball at a bounce's touch): its tick. */
const BALL_SQUASH_TICK = 10;

/** The sim's Pokémon, with the fields we write (level, move slots) writable. */
type SimMon = { -readonly [K in keyof SimBattle['p1']['pokemon'][number]]: SimBattle['p1']['pokemon'][number][K] };
type Tick = Generator<void, void, void>;

/** A battler: the DS id (0–3), the Pokémon out and what the scene shows of it. */
interface Side {
  id: number;
  mon: Pokemon;
  view: BattlerView;
  hpTemp: number;
  expTemp: number;
}

/**
 * One battler's party in the battle: the Pokémon, their sim twins (null for eggs), the one out. In a double where
 * one owner has two out (the player in 3 and 19, the trainer in 3) its two battlers' teams share `party` and `sims`
 * and differ in `active`.
 */
interface Team {
  party: Pokemon[];
  sims: (SimMon | null)[];
  active: number;
}

/** What an AI battler does this turn, decided before the turn runs (the DS's command phase); `target` a battler id. */
/** `escape`: a roamer flees (decomp AI_FLAG_ROAMING_POKEMON's Escape, BATTLE_CONTROL_RUN). */
type FoeAction = { kind: 'move'; slot: number; target?: number } | { kind: 'switch'; slot: number } | { kind: 'item'; item: number; category: number } | { kind: 'pass' } | { kind: 'escape' };

const bare = (id: Id) => id.slice(id.indexOf(':') + 1);

/**
 * The sim sides: singles and multi one per DS battler (multi: p1 player, p2 enemy, p3 partner, p4 second enemy);
 * doubles p1 the player's battlers 0 and 2, p2 the enemy's 1 and 3.
 */
const SIM_SIDES = ['p1', 'p2', 'p3', 'p4'] as const;
type SimSide = (typeof SIM_SIDES)[number];
const OWNERS: BattleOwner[] = ['player', 'enemy', 'partner', 'enemy2'];
/** The sim format of each topology. */
const GAME_TYPE: Record<BattleTopology, SimGameType> = { single: 'singles', double: 'doubles', 'trainer-pair': 'doubles', 'ai-partner': 'multi' };
/** The sim's move targets that take a chosen position (sim `targetTypeChoices`). */
const CHOSEN_TARGETS = new Set(['normal', 'any', 'adjacentAlly', 'adjacentAllyOrSelf', 'adjacentFoe']);
/**
 * The DS target screen's first cursor position (decomp BattleSystem_Cursor_Battler with no saved cursor): the
 * enemy's second slot (top left), its first, the player's first, the player's second.
 */
const TARGET_CURSOR_ORDER = [3, 1, 0, 2];

export const createBattle: CreateBattle = (setup, deps) => new BattleController(setup, deps);

class BattleController implements Battle {
  private readonly dex: Dex;
  private readonly text: BattleText;
  private readonly sim: SimBattle;
  private readonly data: SimData;
  private readonly rng: Lcrng;
  /**
   * decomp battleCtx->speedRand: one draw per battler at the start and before each turn's moves (Quick Claw's
   * roll as the AI reads it). Its own stream, so the battle's other draws stay where they were.
   */
  private readonly speedRng: Lcrng;
  private speedRand: number[] = [];
  /** decomp battleCtx->powerMul as the last move left it (the AI's damage reads it). */
  private powerMul = 10;
  /** Battlers whose Pokémon took a move's damage this turn (Revenge and Avalanche double then). */
  private readonly hitThisTurn = new Set<number>();
  /** decomp battleMons[THEM].timesDamaged and trainerMessageFlags (cleared when the foe's Pokémon comes in). */
  private foeTimesDamaged = 0;
  private readonly foeMessageFlags = new Set<string>();
  /** decomp SYSCTL_FIRST_DAMAGE_MSG_SHOWN (once a battle). */
  private firstDamageShown = false;
  /** An ability whose stat change the next -boost/-unboost line is (Intimidate, Speed Boost: one message). */
  private abilityStat: { user: Side; ability: string } | null = null;
  /** The weather now (the sim's id), for its end message. */
  private weather: string | null = null;
  private initialFieldLog: string[] = [];
  private readonly expAlive = new WeakMap<SimMon, Set<number>>();
  /** The player's side: the player's party, or the counterpart's starter in the catching tutorial. */
  private readonly own: Team;
  private readonly foe: Team;
  /** Every battler's team by DS id: the player's and the foe's; with an AI partner also the partner's (2) and the second enemy's (3). */
  private readonly teams: Team[];
  /** The (first) enemy trainer; null in wild battles. */
  private readonly trainer: Trainer | null;
  /** Each battler's trainer by DS id (null for the player and wild Pokémon). */
  private readonly trainers: (Trainer | null)[];
  private readonly topology: BattleTopology;
  /** The sim format: one battler a side (singles), one sim side per battler (multi), two a sim side (doubles). */
  private readonly format: SimGameType;
  /** Each battler's owner (the view's `owner`). */
  private readonly owners: BattleOwner[];
  /** The battler the player commands now (0, or 2 in a double the player commands alone). */
  private actor = 0;
  /** Party slots picked to come in by the player's earlier command this turn (decomp: the second menu skips them). */
  private readonly reserved = new Set<number>();
  /** The wild Pokémon a ball is thrown at (decomp: the first enemy, else the second). */
  private catchSide: Side | null = null;
  /** decomp BATTLE_TYPE_* mask (what the AI sees). */
  private readonly battleType: number;
  /**
   * A Battle Frontier battle (BATTLE_TYPE_FRONTIER, contracts `FrontierBattle`): the frontier trainers by their battle
   * `Trainer`, with their frontier ids (messages) and parties. No experience, prize, bag or blackout; RUN forfeits.
   */
  private readonly frontier: Map<Trainer, { id: number; party: Pokemon[] }> | null;
  /** The player forfeited (decomp PrintForfeitMessage): the battle ends lost without the trainer's lines. */
  private forfeited = false;
  private readonly ai: TrainerAi | null;
  private readonly memory: AiMemory;
  /** Per enemy battler, the player's party slots that faced it since it came in (decomp the exp mask). */
  private readonly participants: Set<number>[];
  private readonly script: Tick;
  private tick = 0;
  /** START toggles the friendly doubles healthboxes together, including later replacements. */
  private hpNumbers = false;
  private turns = 0;
  private runAttempts = 0;
  private money: number;
  /** battleCtx->prizeMoneyMul: 2 once a battler holding an Amulet Coin has been out. */
  private prizeMul = 1;
  private input: InputFrame = { held: [], pressed: [], touch: null };
  private answer: BattleChoice | null = null;
  /** The Pokédex entry after a new catch is open (`app()`), until `appDone`. */
  private dexEntryOpen = false;
  /** The caught Pokémon being named (the naming screen's answer: undefined while it is open). */
  private naming: { mon: Pokemon; name: string | null | undefined } | null = null;
  private outcome: BattleOutcome | null = null;
  private result: BattleResult | null = null;
  private logPos = 0;
  /**
   * HP a level-up added (decomp: curHP += the new max HP − the old) to a Pokémon whose later lines in the batch being
   * played were written by the sim before it (the sim runs the whole turn first): added to the HP those lines show.
   */
  private levelHp = new Map<SimMon, number>();
  // View state.
  private transition: BattleView['transition'] = { field: true, flash: 0, close: 0 };
  private platforms = { enemyDx: 0, playerDx: 0 };
  private playerTrainer: BattleView['trainer'];
  private enemyTrainer: BattleView['enemyTrainer'] = null;
  /** The second enemy trainer's front sprite (two enemy trainers) and the AI partner's back sprite (a 2vs2). */
  private enemyTrainer2: NonNullable<BattleView['enemyTrainer2']> | null = null;
  private partnerTrainer: NonNullable<BattleView['partnerTrainer']> | null = null;
  /** The battlers by DS id (singles: the player's and the foe's). */
  private readonly battlers: Side[];
  private message: BattleView['message'] = null;
  private prompt: BattlePrompt | null = null;
  /** Move selection belongs to the Pokémon, so switching and doubles keep independent cursors. */
  private readonly moveCursor = new Map<Pokemon, number>();
  private fade = 0;
  /** The open bag or party sheet was cancelled (back to the commands). */
  private cancelled = false;
  private readonly bag: Bag;
  private caught: BattleResult['caught'] = null;
  /** Decomp BattleSystem ballsThrown (the TV's Catch That Pokémon Show). */
  private ballsThrown = 0;
  /** The victory music has started (decomp expJinglePlayed). */
  private victoryPlayed = false;
  /** The trainer's Pokémon sent out so far (BattleResult.seen). */
  private readonly seen: Id[] = [];
  /** Party slots that levelled up (decomp leveledUpMonsMask). */
  private readonly levelled = new Set<number>();
  /** decomp battleCtx->hpTemp: the foe's HP when the player's Pokémon came in (the recall message). */
  private foeHpAtSwitch = 0;
  private ball: BattleView['ball'] = null;
  /** The battle animation playing, and how many have played (each seeds its particles). */
  private anim: AnimVm | null = null;
  private animCount = 0;
  /** The send-out effects by battler (a capsule's seals or the ball's burst), on their own particle stream. */
  private readonly sendOuts = new Map<number, SendOutEffect>();
  private sendOutRng: SplRandom | null = null;
  /** Battlers whose two-turn move charged (decomp: the attack turn's animation runs with effect chance 1). */
  private readonly charged = new Set<Side>();
  /** A multi-hit move: its animation plays again before each later hit (decomp LoopMultiHit). */
  private hitAnims: { move: Id; user: Side; target: Side; played: boolean } | null = null;
  /**
   * A Safari battle (BATTLE_TYPE_SAFARI): the balls left, the catch stage and escape count (decomp
   * safariCatchStage, safariEscapeCount) and the player's Safari healthbox. Null in other battles.
   */
  private readonly safari: { balls: number; stage: number; escape: number; healthbox: { visible: boolean; dx: number } } | null;

  constructor(
    private readonly setup: BattleSetup,
    private readonly deps: BattleDeps,
  ) {
    const reg = deps.registries;
    this.dex = dexOf(reg);
    this.text = new BattleText(reg);
    this.data = simData(reg, deps.log);
    this.money = deps.money;
    this.bag = deps.bag;
    const prng = new Prng(deps.seed);
    const rng = { next: () => prng.next(), below: (n: number) => prng.below(n) };
    const ball = newGameRecord(reg).pokeBall;

    // A frontier battle's trainers are its own (FieldBattleDTO_InitFrontierTrainer): a battle `Trainer` per frontier
    // trainer, the facility's AI flags (the tower's AI_FLAG_BASIC | EVAL_ATTACK | EXPERT), no items, its party as built by
    // the facility.
    const frontier = setup.frontier;
    if (frontier && (setup.kind !== 'trainer' || setup.trainers.length || setup.wild.length || setup.partner)) {
      throw new Error('battle: a frontier battle is a trainer battle with only its frontier trainers');
    }
    const frontierTrainers = new Map<Id, Trainer>();
    this.frontier = frontier ? new Map() : null;
    const frontierTrainer = (ft: NonNullable<BattleSetup['frontier']>['trainers'][number], key: string): Id => {
      const t: Trainer = { id: `frontier:${key}:${ft.id}` as Id, name: ft.name, class: ft.class, className: ft.className, gender: 'none', double: false, party: [], items: [], ai: frontier!.ai ?? FRONTIER_AI, classPrize: 0, messages: {} };
      frontierTrainers.set(t.id, t);
      this.frontier!.set(t, { id: ft.id, party: ft.party });
      return t.id;
    };
    const trainerIds = frontier ? frontier.trainers.map((ft, i) => frontierTrainer(ft, String(i))) : setup.trainers;
    // Multi with an AI partner (BATTLE_TYPE_FRONTIER_WITH_AI_PARTNER): the partner in battler 2.
    const partnerId = frontier?.partner ? frontierTrainer(frontier.partner, 'partner') : setup.partner;
    const trainerRecord = (id: Id): Trainer => {
      const t = frontierTrainers.get(id) ?? reg.trainers.get(id);
      if (!t) throw new Error(`battle: unknown trainer ${id}`);
      return t;
    };
    const party = (t: Trainer): Team => {
      const own = this.frontier?.get(t);
      if (own) return { party: own.party, sims: [], active: 0 };
      // Decomp trainer_data.c → Pokemon_SetBallSeal: a member with cbSeal n ≥ 1 carries trainer capsule n − 1.
      const capsuled = (m: Trainer['party'][number], mon: Pokemon): Pokemon => {
        if (!m.ballSeal) return mon;
        const seals = newGameRecord(reg).seals;
        if (!seals) throw new Error(`battle: ${t.id} has ball capsules but the packs have no NewGame.seals`);
        return { ...mon, capsule: trainerCapsule(seals, m.ballSeal) };
      };
      return { party: t.party.map((m) => capsuled(m, createTrainerPokemon(this.dex, m, this.trainerName(t), ball))), sims: [], active: 0 };
    };
    const wildMon = (spec: BattleSetup['wild'][number]): Pokemon => {
      const mon = spec.roamer ? this.roamerMon(spec, ball) : createRandomPokemon(this.dex, rng, {
        // A Poké Radar shiny patch (CreateWildMonShinyWithGenderOrNature): a PID shiny with the player's OT id.
        ...(spec.shiny ? { pid: shinyPid(deps.player.trainerId, rng) } : {}),
        species: spec.species,
        form: spec.form ?? 0,
        level: spec.level,
        trainer: { otId: deps.player.trainerId, otName: deps.player.name, otGender: deps.player.gender },
        ball,
        met: { zone: deps.met.zone, level: spec.level, date: deps.met.date },
        heldItem: rollWildHeldItem(this.dex.form(spec.species, spec.form ?? 0), rng),
      });
      if (spec.fateful) mon.fatefulEncounter = true;
      return mon;
    };
    const wildTeam = (spec: BattleSetup['wild'][number]): Team => ({ party: [wildMon(spec)], sims: [], active: 0 });
    /** The second battler of an owner with two out: the same party (and sims), its own active slot. */
    const second = (t: Team): Team => ({ party: t.party, sims: [], active: -1 });
    this.topology = setup.topology ?? 'single';
    this.format = GAME_TYPE[this.topology];
    this.owners = OWNERS.slice();
    const reject = (what: string): never => {
      throw new Error(`battle: ${what}, not ${JSON.stringify({ kind: setup.kind, trainers: trainerIds, wild: setup.wild.length, partner: partnerId })}`);
    };
    let enemy2: Team | null = null;
    let partner: Team | null = null;
    if (this.topology === 'ai-partner' && setup.kind === 'trainer') {
      // Decomp Encounter_NewVsTrainer: two distinct enemy trainers and a partner (type 75).
      if (trainerIds.length !== 2 || trainerIds[0] === trainerIds[1] || setup.wild.length || !partnerId) reject('an ai-partner trainer battle takes two distinct enemy trainers and a partner');
      const [first, other] = trainerIds.map(trainerRecord) as [Trainer, Trainer];
      const ally = trainerRecord(partnerId!);
      this.trainer = first;
      this.trainers = [null, first, ally, other];
      this.foe = party(first);
      partner = party(ally);
      enemy2 = party(other);
      this.battleType = BATTLE_TYPE_TRAINER_WITH_AI_PARTNER;
    } else if (this.topology === 'ai-partner' && setup.kind === 'wild') {
      // Decomp WildEncounters_TryWildEncounter with a partner: the partner trainer in battler 2, two wild Pokémon
      // in battlers 1 and 3 (type 74).
      if (setup.wild.length !== 2 || trainerIds.length || !partnerId) reject('a wild ai-partner battle takes two wild Pokémon and a partner');
      const ally = trainerRecord(partnerId!);
      this.trainer = null;
      this.trainers = [null, null, ally, null];
      this.foe = wildTeam(setup.wild[0]!);
      partner = party(ally);
      enemy2 = wildTeam(setup.wild[1]!);
      this.battleType = BATTLE_TYPE_AI_PARTNER;
    } else if (this.topology === 'double') {
      // One trainer with two out (type 3): its two battlers share its party (decomp BattleSystem_GetParty by side).
      if (setup.kind !== 'trainer' || trainerIds.length !== 1 || setup.wild.length || partnerId) reject('a trainer double takes one trainer');
      const trainer = trainerRecord(trainerIds[0]!);
      this.trainer = trainer;
      this.trainers = [null, trainer, null, trainer];
      this.foe = party(trainer);
      enemy2 = second(this.foe);
      this.owners[2] = 'player';
      this.owners[3] = 'enemy';
      this.battleType = BATTLE_TYPE_TRAINER_DOUBLES;
    } else if (this.topology === 'trainer-pair') {
      // Two enemy trainers against the player alone (type 19): each enemy battler from its own trainer's party.
      if (setup.kind !== 'trainer' || trainerIds.length !== 2 || trainerIds[0] === trainerIds[1] || setup.wild.length || partnerId) reject('a trainer pair takes two distinct enemy trainers and no partner');
      const [first, other] = trainerIds.map(trainerRecord) as [Trainer, Trainer];
      this.trainer = first;
      this.trainers = [null, first, null, other];
      this.foe = party(first);
      enemy2 = party(other);
      this.owners[2] = 'player';
      this.battleType = BATTLE_TYPE_TAG_DOUBLES;
    } else if (this.topology !== 'single') {
      throw new Error(`battle: an ${this.topology} ${setup.kind} battle does not exist`);
    } else if (setup.kind === 'trainer' || setup.kind === 'first') {
      if (trainerIds.length !== 1 || setup.wild.length || partnerId) throw new Error(`battle: a single ${setup.kind} battle takes one trainer, not ${JSON.stringify(trainerIds)}`);
      const trainer = trainerRecord(trainerIds[0]!);
      if (trainer.double) throw new Error(`battle: ${trainer.id} is a double battle trainer (topology double)`);
      this.trainer = trainer;
      this.trainers = [null, trainer];
      this.foe = party(trainer);
      this.battleType = BATTLE_TYPE.TRAINER;
    } else {
      if (setup.wild.length !== 1 || trainerIds.length || partnerId) throw new Error(`battle: a single ${setup.kind} battle takes one wild Pokémon`);
      this.trainer = null;
      this.trainers = [null, null];
      this.foe = wildTeam(setup.wild[0]!);
      this.battleType = setup.kind === 'tutorial' ? BATTLE_TYPE_CATCH_TUTORIAL : setup.kind === 'safari' ? BATTLE_TYPE.SAFARI : setup.wild[0]!.roamer ? BATTLE_TYPE_ROAMER : 0;
    }
    if (setup.kind === 'safari') {
      const balls = setup.safariBalls;
      if (balls === undefined || !Number.isInteger(balls) || balls < 1) throw new Error(`battle: a Safari battle needs its Safari Balls, not ${String(balls)}`);
      if (setup.wild[0]!.roamer) throw new Error('battle: a Safari battle against a roamer does not exist');
      this.safari = { balls, stage: SAFARI_STAGE_START, escape: SAFARI_STAGE_START, healthbox: { visible: false, dx: 0 } };
    } else {
      if (setup.safariBalls !== undefined) throw new Error(`battle: only a Safari battle takes Safari Balls (${setup.kind})`);
      this.safari = null;
    }

    if (setup.kind === 'tutorial') {
      // Decomp FieldBattleDTO_NewCatchingTutorial: the counterpart's starter, level 5, random IVs, never shiny.
      const cp = setup.counterpart;
      if (!cp) throw new Error('battle: the catching tutorial needs its counterpart');
      const mon = createPokemon(this.dex, { species: cp.species, form: 0, level: 5, pid: prng.next(), ivs: randomIvs(rng), otId: 0, otName: cp.name, otGender: cp.gender, ball, heldItem: null });
      if (isShiny(mon.otId, mon.pid)) mon.pid ^= 0x10000000;
      this.own = { party: [mon], sims: [], active: 0 };
    } else this.own = { party: frontier ? frontier.party : deps.party, sims: [], active: 0 };
    if (frontier) this.battleType |= BATTLE_TYPE.FRONTIER;
    // Battler 2: the AI partner, or in the doubles format the player's second Pokémon out.
    if (this.format === 'doubles') partner = second(this.own);
    this.teams = partner && enemy2 ? [this.own, this.foe, partner, enemy2] : [this.own, this.foe];

    const simPrng = new PRNG('sodium,00000000000000000000000000000000');
    (simPrng as unknown as { rng: Lcrng }).rng = new Lcrng(prng.next());
    this.rng = new Lcrng(prng.next());
    this.speedRng = new Lcrng(prng.next());
    this.drawSpeedRand();

    // The leads: each battler's first Pokémon that can fight (the second battler of a shared party the next one).
    this.teams.forEach((team, b) => {
      const taken = this.teams.slice(0, b).filter((t) => t.party === team.party).map((t) => t.active);
      team.active = team.party.findIndex((m, i) => !m.isEgg && m.hp > 0 && !taken.includes(i));
      if (team.active >= 0) return;
      if (b === 0) throw new Error('battle: the party has no Pokémon that can fight');
      if (b === 2 && this.format === 'doubles') throw new Error('battle: a double battle needs two Pokémon that can fight (decomp: the sight check and CheckHasTwoAliveMons)');
      throw new Error(`battle: the ${this.owners[b]} has no Pokémon that can fight`);
    });
    // strictChoices: a choice the sim refuses throws (it would wait for a valid one forever otherwise).
    this.sim = this.data.createBattle(setup.kind, this.format, { prng: simPrng, strictChoices: true }, {
      weather: setup.weather,
      rules: {
        // Snapshot native HP before later moves/residuals, including KOs without HP log lines (Self-Destruct).
        // Run after the other faint callbacks, which may themselves KO a participant (e.g. Destiny Bond).
        onFaintPriority: -100,
        onFaint: (fainted: SimMon) => {
          if (fainted.side.n & 1) this.expAlive.set(fainted, new Set(this.own.sims.flatMap((sm, i) => sm && sm.hp > 0 ? [i] : [])));
        },
      },
    });
    if (this.format === 'doubles') {
      this.addSide('p1', [this.teams[0]!, this.teams[2]!]);
      this.addSide('p2', [this.teams[1]!, this.teams[3]!]);
      if (this.topology === 'trainer-pair') this.ownerAdapter();
    } else this.teams.forEach((team, b) => this.addSide(SIM_SIDES[b]!, [team]));
    // The sim's start (inside the last setPlayer) counts every team member as left; one that entered the battle
    // fainted is not, or the side never runs out and a lost battle asks the fainted Pokémon for a command.
    for (const side of this.sim.sides) side.pokemonLeft = (side.pokemon as SimMon[]).filter((m) => !m.fainted).length;
    if (this.format === 'multi') this.storyResult();
    if (this.battleType === BATTLE_TYPE_ROAMER) this.roamerEscape();
    // The sim ran the battle's start inside setPlayer: both send-outs, then the switch-in effects (Intimidate,
    // Pressure, weather abilities, a berry eaten at once). The intro draws the send-outs; the effects play
    // after "Go! X!" like any other lines (decomp: the switch-in effects run once both battlers are out).
    const log = this.sim.log;
    let last = log.length - 1;
    while (last >= 0 && !log[last]!.startsWith('|switch|')) last--;
    this.initialFieldLog = log.slice(0, last + 1).filter((l) => l.startsWith('|-weather|') || l.startsWith('|-fieldstart|'));
    this.logPos = last + 1;

    this.ai = this.trainers.some((t) => t) ? createTrainerAi(reg) : null;
    this.memory = createAiMemory(this.battleType, this.trainers.map((t) => (t ? t.items.map((i) => reg.items.get(i)?.sourceIndex ?? 0) : [])));

    const ns = newGameRecord(reg).id.slice(0, newGameRecord(reg).id.indexOf(':'));
    const gender = setup.kind === 'tutorial' ? setup.counterpart!.gender : deps.player.gender;
    const playerClass = `${ns}:TRAINER_CLASS_PLAYER_${gender === 'male' ? 'MALE' : 'FEMALE'}` as Id;
    this.playerTrainer = reg.trainerSprites.has(playerClass) ? { class: playerClass, dx: 0, throwTick: null } : null;
    this.battlers = this.teams.map((team, b) => this.side(team.party[team.active]!, b));
    this.participants = this.teams.map((_, b) => new Set(b & 1 ? this.playerOut() : []));
    this.script = this.main();
  }

  /**
   * Type 19's owner map on the one enemy sim side (sim/trainer-pair.proof.test.ts): each member's trainer (battler
   * 1's or 3's) for the owner-aware moves (`simOwners`); a fainted battler whose trainer has no reserve is not
   * flagged for a replacement although the other trainer has some (the slot stays empty; decomp: the replacement
   * scans the battler's own party); Roar and Whirlwind drag a member of the dragged-out battler's trainer.
   */
  private ownerAdapter(): void {
    const side = this.sim.p2;
    for (const b of [1, 3]) for (const m of this.teams[b]!.sims) if (m) simOwners.set(m, b);
    const reserve = (owner: number) => (side.pokemon as SimMon[]).filter((p, i) => i >= side.active.length && !p.fainted && simOwners.get(p) === owner);
    const sim = this.sim as unknown as { checkFainted(): void; sample<T>(a: T[]): T; runEvent(e: string, p: unknown): unknown };
    const checkFainted = sim.checkFainted.bind(this.sim);
    sim.checkFainted = () => {
      checkFainted();
      for (const p of side.active as SimMon[]) if (p?.fainted && !reserve(simOwners.get(p)!).length) p.switchFlag = false;
    };
    const actions = this.sim.actions as unknown as { dragIn(s: unknown, pos: number): boolean; switchIn(p: SimMon, pos: number, effect: null, dragged: boolean): boolean };
    const dragIn = actions.dragIn.bind(actions);
    actions.dragIn = (s, pos) => {
      if (s !== side) return dragIn(s, pos);
      const out = side.active[pos] as SimMon | undefined;
      if (!out) throw new Error('battle: nothing to drag out');
      const pool = reserve(simOwners.get(out)!);
      if (!pool.length || !out.hp) return false;
      if (!sim.runEvent('DragOut', out)) return false;
      return actions.switchIn(sim.sample(pool), pos, null, true);
    };
  }

  /** The player's party slots out now and standing (a new foe's exp participants; decomp sideGetExpMask). */
  private playerOut(): number[] {
    return this.playerBattlers()
      .map((b) => this.teams[b]!.active)
      .filter((i) => !this.own.sims[i] || this.own.sims[i]!.hp > 0);
  }

  /** The battlers the player's own party stands in: 0, and 2 in the doubles format (types 3 and 19). */
  private playerBattlers(): number[] {
    return this.format === 'doubles' ? [0, 2] : [0];
  }

  /** The player commands this battler (its party is the player's). */
  private isPlayer(b: number): boolean {
    return b === 0 || (b === 2 && this.format === 'doubles');
  }

  /** The player's first battler and the first enemy (singles: the two battlers). */
  private get player(): Side {
    return this.battlers[0]!;
  }

  /** The battler the player commands now (`actor`) and its team. */
  private get acting(): Side {
    return this.battlers[this.actor]!;
  }

  private get enemy(): Side {
    return this.battlers[1]!;
  }

  /** Two battlers a side (every topology but `single`). */
  private get doubles(): boolean {
    return this.topology !== 'single';
  }

  /**
   * Decomp BattleControllerPlayer_CheckBattleOver for an AI partner (74, 75): the battle is lost once the player's own
   * party is out, even with the partner still standing, and won once both enemy parties are out; both at once is a
   * draw (BATTLE_RESULT_WIN | LOSE). The sim's own check (the combined allied parties) never decides it. A wild
   * double (74) is won the same way: both wild Pokémon fainted.
   */
  private storyResult(): void {
    const out = (side: number) => (this.sim.sides[side]!.pokemon as SimMon[]).every((m) => m.fainted);
    const sim = this.sim as unknown as { checkWin(): boolean | undefined; win(side?: unknown): boolean };
    sim.checkWin = () => {
      const lost = out(0);
      const won = out(1) && out(3);
      if (!lost && !won) return false;
      sim.win(lost && won ? undefined : won ? this.sim.sides[0] : this.sim.sides[1]);
      return true;
    };
  }

  // ---------- public ----------

  step(input: InputFrame): void {
    if (this.result) throw new Error('battle: step after the battle ended');
    this.input = input;
    if (this.prompt) this.navigate(input);
    this.script.next();
    for (const [battler, fx] of this.sendOuts) {
      fx.tick();
      if (!fx.active) this.sendOuts.delete(battler);
    }
    this.touchedBefore = input.touch !== null;
    this.tick++;
  }

  choose(choice: BattleChoice): void {
    const p = this.prompt;
    if (!p || this.answer) throw new Error(`battle: no prompt waits for ${JSON.stringify(choice)}`);
    const actor = this.actor;
    // A Safari battle's command card: Ball, Bait, Mud (`safari`) or Run; nothing else (BATTLE_TYPE_NO_MOVES).
    if (this.safari && p.kind === 'command') {
      if (choice.kind !== 'safari' && choice.kind !== 'run') throw new Error(`battle: the Safari command card takes safari ball|bait|mud or run, not ${JSON.stringify(choice)}`);
      if (choice.kind === 'safari' && !['ball', 'bait', 'mud'].includes(choice.action)) throw new Error(`battle: no Safari action ${String(choice.action)}`);
      this.answer = choice;
      return;
    }
    if (choice.kind === 'safari') throw new Error('battle: Safari Ball, Bait and Mud exist only in a Safari battle');
    // The target screen's CANCEL: back to the moves, the cursor on the move.
    if (p.kind === 'target' && choice.kind === 'cancel') {
      this.prompt = { kind: 'fight', cursor: p.slot, moves: this.moveViews(this.acting.mon, this.acting), actor: p.actor };
      return;
    }
    if (p.kind === 'learn-ask' || p.kind === 'forfeit' || choice.kind === 'answer') {
      if ((p.kind !== 'learn-ask' && p.kind !== 'forfeit') || choice.kind !== 'answer') throw new Error(`battle: the yes/no question takes answer yes|no, not ${JSON.stringify(choice)} at ${p.kind}`);
      this.answer = choice;
      return;
    }
    if (choice.kind === 'fight') {
      if (p.kind !== 'command') throw new Error('battle: Fight opens only from the command prompt');
      this.prompt = { kind: 'fight', cursor: this.moveCursor.get(this.acting.mon) ?? 0, moves: this.moveViews(this.acting.mon, this.acting), actor: p.actor };
      return;
    }
    if (choice.kind === 'cancel') {
      if (p.kind !== 'command' || !p.canRewind) throw new Error('battle: nothing to go back to (CANCEL is the second battler’s, before the first used an item)');
      this.answer = choice;
      return;
    }
    if ('battler' in choice && choice.battler !== undefined && choice.battler !== actor) throw new Error(`battle: battler ${choice.battler} does not act now (battler ${actor} does)`);
    if (p.kind === 'learn') {
      if (choice.kind === 'keep' || (choice.kind === 'forget' && Number.isInteger(choice.slot) && choice.slot >= 0 && choice.slot < p.moves.length)) {
        this.answer = choice;
        return;
      }
      throw new Error(`battle: the move-learn prompt takes forget <slot> or keep, not ${JSON.stringify(choice)}`);
    }
    if (p.kind === 'nickname') {
      if (choice.kind !== 'nickname') throw new Error(`battle: the nickname question takes nickname yes|no, not ${JSON.stringify(choice)}`);
      this.answer = choice;
      return;
    }
    if (p.kind === 'naming') throw new Error('battle: the naming screen answers through appDone');
    if (p.kind === 'shift') {
      if (choice.kind === 'switch') this.checkSwitch(choice.slot);
      else if (choice.kind !== 'party' && choice.kind !== 'keep') throw new Error(`battle: "Will you switch?" takes switch <slot>, party or keep, not ${JSON.stringify(choice)}`);
      this.answer = choice;
      return;
    }
    if (p.kind === 'next') {
      if (choice.kind === 'switch') this.checkSwitch(choice.slot);
      else if (choice.kind !== 'run' && choice.kind !== 'party') throw new Error(`battle: "Use next Pokémon?" takes switch <slot>, party or run, not ${JSON.stringify(choice)}`);
      this.answer = choice;
      return;
    }
    if (p.kind === 'party' || p.kind === 'bag') {
      if (p.kind === 'party' && choice.kind !== 'switch') throw new Error(`battle: the party takes switch <slot>, not ${JSON.stringify(choice)}`);
      if (p.kind === 'bag' && choice.kind !== 'item') throw new Error(`battle: the bag takes item <item>, not ${JSON.stringify(choice)}`);
    }
    if (p.kind === 'command' && ((choice.kind === 'run' && !p.enabled[3]) || (choice.kind === 'bag' && !p.enabled[1]) || (choice.kind === 'party' && !p.enabled[2]))) {
      throw new Error(`battle: ${choice.kind} is not available in this battle`);
    }
    if (choice.kind === 'run' || choice.kind === 'bag' || choice.kind === 'party') {
      this.answer = choice;
      return;
    }
    if (choice.kind === 'item') {
      this.checkItem(choice.item, choice.target ?? null, choice.move);
      this.answer = choice;
      return;
    }
    if (choice.kind === 'switch') {
      this.checkSwitch(choice.slot);
      this.answer = choice;
      return;
    }
    if (choice.kind !== 'move') throw new Error(`battle: the command prompt takes a move, run, item, switch, bag or party, not ${JSON.stringify(choice)}`);
    const moves = this.moveViews(this.acting.mon, this.acting);
    const m = moves[choice.slot];
    if (!Number.isInteger(choice.slot) || !m) throw new Error(`battle: ${this.acting.view.name} has no move in slot ${choice.slot + 1}`);
    // With no PP left in any move, FIGHT uses Struggle (decomp: "X has no moves left!").
    if (m.pp === 0 && moves.some((x) => x.pp > 0)) throw new Error(`battle: ${m.name} has no PP left`);
    if (this.moveDisabled(choice.slot)) throw new Error(`battle: ${m.name} can't be used now (disabled, encored, taunted, tormented, sealed or choice-locked)`);
    // A move picked from the move list in a double: the DS target screen next (its cursor on the first battler in
    // the 3, 1, 0, 2 order). A move answered with its target, or from the command prompt (replays), goes at once.
    if (p.kind === 'fight' && choice.target === undefined && m.aim?.targets.length) {
      this.moveCursor.set(this.acting.mon, choice.slot);
      this.prompt = { kind: 'target', cursor: m.aim.targets[0]!, slot: choice.slot, move: m, actor };
      return;
    }
    if (choice.target !== undefined) {
      if (!this.doubles) throw new Error('battle: a single battle takes no move target');
      const selectable = this.targets(this.acting, this.activeSim(this.teams[this.actor]!).moveSlots[choice.slot]);
      if (selectable && !selectable.includes(choice.target)) throw new Error(`battle: ${m.name} can't aim at battler ${choice.target} (it may aim at ${selectable.join(', ')})`);
    }
    this.moveCursor.set(this.acting.mon, choice.slot);
    this.answer = choice;
  }

  /**
   * The battlers a move may aim at, in the DS target screen's cursor order, or null when it takes no chosen
   * target (spread, self, random: the sim picks). From the sim's move target, which the DS ranges map to
   * (decomp RANGE_SINGLE_TARGET any other battler, _ME_FIRST a foe, RANGE_ALLY the ally, RANGE_USER_OR_ALLY either);
   * only battlers standing in the field count. The target type is the move slot's, which the sim validates the
   * choice against (a move copied by Mimic has none: the sim picks).
   */
  private targets(user: Side, slot: { target?: string } | undefined): number[] | null {
    const target = slot?.target;
    if (!this.doubles || !target || !CHOSEN_TARGETS.has(target)) return null;
    const here = (b: number) => b === user.id || (b < this.battlers.length && this.activeSim(this.teams[b]!).hp > 0);
    const ok = (b: number) => {
      const foe = (b & 1) !== (user.id & 1);
      if (target === 'adjacentFoe') return foe;
      if (target === 'adjacentAlly') return b === (user.id ^ 2);
      if (target === 'adjacentAllyOrSelf') return !foe;
      return b !== user.id;
    };
    return TARGET_CURSOR_ORDER.filter((b) => here(b) && ok(b));
  }

  /**
   * What the DS target screen offers for a move (BattleMoveView.aim; decomp GetTargetSelectLayout with the presence
   * check): a chosen-target move its selectable battlers (`targets`); a spread move the battlers it hits together,
   * a self, random or special-target move the user alone (decomp RANGE_USER, _RANDOM_OPPONENT, _SINGLE_TARGET_SPECIAL:
   * the user-shaped confirmation), as a group. Null outside doubles or without a target type (a Mimic copy).
   */
  private aim(user: Side, slot: { target?: string } | undefined): NonNullable<BattleMoveView['aim']> | null {
    const target = slot?.target;
    if (!this.doubles || !target) return null;
    const chosen = this.targets(user, slot);
    if (chosen) return { targets: chosen, group: false };
    const here = (b: number) => b === user.id || (b < this.battlers.length && this.activeSim(this.teams[b]!).hp > 0);
    const foe = (b: number) => (b & 1) !== (user.id & 1);
    const hit: Record<string, (b: number) => boolean> = {
      allAdjacentFoes: foe,
      foeSide: foe,
      allAdjacent: (b) => b !== user.id,
      allySide: (b) => !foe(b),
      allyTeam: (b) => !foe(b),
      allies: (b) => !foe(b),
      all: () => true,
    };
    const ok = hit[target] ?? ((b: number) => b === user.id);
    return { targets: TARGET_CURSOR_ORDER.filter((b) => here(b) && ok(b)), group: true };
  }

  /** The sim's target location of battler `target` for battler `user`: + the other half's position, - its own half's (multi: p3 and p4 are position 2). */
  private simTarget(user: number, target: number): number {
    const position = (target >> 1) + 1;
    return (target & 1) === (user & 1) ? -position : position;
  }

  /** A move choice for the sim: `move <n>`, and in doubles the target location when the move takes one (its first selectable battler by default). */
  private moveChoice(user: Side, simSlot: number, target: number | undefined): string {
    const sim = this.activeSim(this.teams[user.id]!);
    // Curse's executable target changes with live typing; the static move slot still says normal.
    const slot = sim.getMoves()[simSlot - 1];
    const selectable = slot && !this.locked(user.id) && !this.struggling(sim) ? this.targets(user, slot) : null;
    if (!selectable) return `move ${simSlot}`;
    const aim = target !== undefined && selectable.includes(target) ? target : (selectable[0] ?? user.id ^ 2);
    if (target !== undefined && aim !== target) this.deps.log.stub('battle:ai-target', 'the trainer AI aimed at a battler its move cannot reach; the DS target screen default goes instead');
    return `move ${simSlot} ${this.simTarget(user.id, aim)}`;
  }

  view(): BattleView {
    return {
      kind: this.setup.kind,
      topology: this.topology,
      background: this.setup.background,
      terrain: this.setup.terrain,
      time: this.setup.time,
      tick: this.tick,
      transition: this.transition && { ...this.transition },
      platforms: { ...this.platforms },
      trainer: this.playerTrainer && { ...this.playerTrainer },
      enemyTrainer: this.enemyTrainer && { ...this.enemyTrainer },
      ...(this.doubles ? { enemyTrainer2: this.enemyTrainer2 && { ...this.enemyTrainer2 }, partnerTrainer: this.partnerTrainer && { ...this.partnerTrainer } } : {}),
      battlers: this.battlers.map(({ view: v }) => ({
        ...v,
        healthbox: { ...v.healthbox, ...(this.doubles && v.side === 'player' ? { numbers: this.hpNumbers } : {}) },
        ...(v.exp ? { exp: { ...v.exp } } : {}),
        ...(v.look ? { look: { ...v.look } } : {}),
      })),
      message: this.message && { ...this.message },
      prompt: this.prompt && structuredClone(this.prompt),
      fade: this.fade,
      ball: this.ball && { ...this.ball },
      ...(this.safari ? { safari: { balls: this.safari.balls, healthbox: { ...this.safari.healthbox } } } : {}),
      anim: this.anim ? this.anim.view() : null,
      ...(this.sendOuts.size ? { sendOut: [...this.sendOuts.values()].flatMap((fx) => fx.particles) } : {}),
    };
  }

  done(): BattleResult | null {
    return this.result;
  }

  app(): AppRequest | null {
    const p = this.prompt;
    if (p?.kind === 'naming' && this.naming) {
      const m = this.naming.mon;
      return { app: 'naming', kind: 'pokemon', initial: this.deps.registries.species.get(m.species)!.name, maxLength: 10, gender: this.deps.player.gender, pokemon: { species: m.species, form: m.form, gender: monGender(this.dex, m) } };
    }
    if (p?.kind === 'pokedex') {
      const m = this.teams[this.catchSide!.id]!.party[0]!;
      return { app: 'pokedex-entry', species: m.species, form: m.form };
    }
    // A sheet answered directly (`choose`: replays, the card) is closed: its answer waits for the next step.
    if ((p?.kind !== 'bag' && p?.kind !== 'party') || this.answer || this.cancelled) return null;
    // The sheets show the battle's own party: HP, status and PP as the sim has them now.
    this.own.sims.forEach((sm, i) => sm && this.pullSim(this.own, i));
    const party = structuredClone(this.party);
    const active = this.teams[this.actor]!.active;
    if (p.kind === 'party') {
      // A double the player commands alone: the other battler's Pokémon is in battle, and the first command's pick
      // already chosen (decomp partnerPokemonPartySlot, doubleBattleFirstSelectedPartySlot).
      const other = this.playerBattlers().find((b) => b !== this.actor);
      const selected = [...this.reserved][0];
      return {
        app: 'party-select',
        mode: 'battle',
        party,
        active,
        forced: p.forced,
        ...(other !== undefined && this.teams[other]!.active >= 0 ? { inBattle: this.teams[other]!.active } : {}),
        ...(selected !== undefined ? { selected } : {}),
      };
    }
    const noEffect = Object.values(this.bag)
      .flat()
      .map((s) => this.item(s.item))
      .filter((rec) => rec.battlePocket & POCKET_BATTLE_ITEMS && !(rec.battlePocket & POCKET_BALLS) && rec.battleUse !== BATTLE_USE_ESCAPE && !this.battleItemWorks(rec))
      .map((rec) => rec.id);
    return { app: 'bag-select', mode: 'battle', party, active, bag: structuredClone(this.bag), noRoomForBall: this.noRoomForBall(), noEffect, ...(this.twoWild() ? { twoWild: true } : {}) };
  }

  appDone(result: AppResult): void {
    const p = this.prompt;
    if (result.app === 'pokedex-entry' && p?.kind === 'pokedex') {
      this.dexEntryOpen = false;
      return;
    }
    if (result.app === 'naming' && p?.kind === 'naming' && this.naming) {
      this.naming.name = result.name;
      return;
    }
    if (result.app === 'bag-select' && p?.kind === 'bag') {
      if (result.item === null) this.cancelled = true;
      else if (this.twoWild() && this.item(result.item).battlePocket & POCKET_BALLS) {
        // The bag refuses a ball with two wild Pokémon out (decomp BattleBag_Text_CantUseBallTwoPokemon); a bag that
        // does not know `twoWild` yet returns it: back to the commands.
        this.deps.log.stub('battle:bag-two-wild', 'the bag returned a ball with two wild Pokémon out (its refusal is the bag’s): back to the commands');
        this.cancelled = true;
      } else this.choose({ kind: 'item', item: result.item, ...(result.target === null ? {} : { target: result.target }), ...(result.move === undefined ? {} : { move: result.move }) });
    } else if (result.app === 'party-select' && p?.kind === 'party') {
      if (result.slot !== null && this.doubles && this.inBattle(result.slot)) {
        // The party sheet knows one slot in battle (`active`); in a double the other battler's is refused here too.
        this.deps.log.stub('battle:party-in-battle', 'the party returned a Pokémon already in battle (the other battler): picked again');
        if (!p.forced) this.cancelled = true;
      } else if (result.slot !== null) this.choose({ kind: 'switch', slot: result.slot });
      else if (p.forced) throw new Error('battle: the party after a faint cannot be cancelled');
      else this.cancelled = true;
    } else throw new Error(`battle: ${result.app} result while the prompt is ${p?.kind ?? 'none'}`);
  }

  // ---------- the timeline ----------

  private *main(): Tick {
    yield* this.intro();
    for (;;) {
      this.turns++;
      aiResetSwitches(this.memory);
      yield* this.trainerMessage();
      if (this.setup.kind === 'tutorial') yield* this.tutorialTurn();
      else if (this.safari) yield* this.safariTurn();
      else if (this.format === 'doubles') yield* this.doublesTurn();
      else {
        // A Pokémon locked into its move (Uproar, Outrage, Bide, a recharge or a charged second turn) gets no
        // command: the DS skips its selection and the move goes on.
        const choice = this.locked(0) ? ({ kind: 'move', slot: 0 } as const) : yield* this.command();
        yield* this.turn(choice);
      }
      if (this.outcome) break;
    }
    yield* this.end();
    yield* this.exit();
  }

  /** The enemy battlers (1, and 3 in doubles). */
  private foes(): Side[] {
    return this.battlers.filter((b) => b.id & 1);
  }

  /** Two enemy trainers (decomp TAG or 2vs2 against trainers: types 19 and 75). */
  private get twoTrainers(): boolean {
    return this.trainer !== null && (this.topology === 'trainer-pair' || this.topology === 'ai-partner');
  }

  private *intro(): Tick {
    // The encounter cut-in over the field (see TRANSITION_FLASH).
    for (const flash of TRANSITION_FLASH) {
      this.transition = { field: true, flash, close: 0 };
      yield;
    }
    for (let t = 1; t <= TRANSITION_SLICE + TRANSITION_BLACK; t++) {
      this.transition = { field: true, flash: 0, close: Math.min(1, t / TRANSITION_SLICE) };
      yield;
    }
    // The scene fades in while both sides slide into place: the wild Pokémon, or the trainer.
    this.transition = null;
    this.fade = 1;
    const sprites = this.deps.registries.trainerSprites;
    const trainerClass = this.trainer && sprites.has(this.trainer.class) ? this.trainer.class : null;
    // Doubles (decomp battle_script.c trainer emission): the second enemy trainer of a pair, and the AI partner
    // beside the player (its back picture, when the ROM has one for its class).
    const second = this.twoTrainers ? this.trainers[3]! : null;
    const secondClass = second && sprites.has(second.class) ? second.class : null;
    const partner = this.format === 'multi' ? this.trainers[2]! : null;
    if (partner && sprites.get(partner.class)?.back) this.partnerTrainer = { class: partner.class, dx: 0, throwTick: null };
    const foes = this.foes();
    if (!this.trainer) for (const f of foes) f.view.visible = true;
    if (this.setup.giratina) yield* this.giratinaEntrance();
    else for (let t = 0; t <= SLIDE_IN; t++) {
      const k = 1 - t / SLIDE_IN;
      this.platforms = { enemyDx: Math.round(-272 * k), playerDx: Math.round(272 * k) };
      if (this.trainer) this.enemyTrainer = trainerClass ? { class: trainerClass, dx: this.platforms.enemyDx } : null;
      else for (const f of foes) f.view.dx = this.platforms.enemyDx;
      if (secondClass) this.enemyTrainer2 = { class: secondClass, dx: this.platforms.enemyDx };
      if (this.playerTrainer) this.playerTrainer.dx = this.platforms.playerDx;
      if (this.partnerTrainer) this.partnerTrainer.dx = this.platforms.playerDx;
      this.fade = Math.max(0, 1 - t / FADE_IN);
      yield;
    }
    // Task_SetEncounter / Task_SetGiratinaEncounter: a shiny wild Pokémon sparkles once it is in place.
    if (!this.trainer) yield* this.shinySparkle(foes);
    if (this.twoTrainers) {
      // Decomp LoadEncounterMessage / LoadLeadMonMessage for two enemy trainers (TAG or 2vs2): "You are challenged
      // by {Tr1} and {Tr2}!", then both leads with one message.
      const [first, second] = [this.trainers[1]!, this.trainers[3]!];
      yield* this.say(this.text.get('YouAreChallengedByTr1AndTr2', [...this.trainerVars(first), ...this.trainerVars(second)]));
      yield* this.foeSendOut(foes, true);
    } else if (this.trainer) {
      // Decomp: "You are challenged by …!", then the trainer leaves to the right as it sends out its lead (a
      // double trainer: both, "{Tr} sent out X and Y!").
      yield* this.say(this.text.get('YouAreChallengedByTr', this.trainerVars()));
      yield* this.foeSendOut(foes, true);
    } else if (this.safari) {
      // Decomp subscript_start_encounter's Safari branch: "A wild X appeared!", the Safari healthbox slides in (no
      // send-out: the trainer stays), a short wait.
      yield* this.slideHealthboxes(foes, -1);
      this.startMessage(this.text.get('AWildPokemonAppeared', [this.enemy.view.name]));
      while (!this.printer!.done) {
        this.printStep();
        yield;
      }
      const box = this.safari.healthbox;
      box.visible = true;
      box.dx = HEALTHBOX_SLIDE;
      while (box.dx !== 0) {
        box.dx = Math.max(0, box.dx - HEALTHBOX_STEP);
        yield;
      }
      yield* this.waitButtonAB(7);
      this.foeHpAtSwitch = this.enemy.mon.hp;
      return;
    } else {
      yield* this.slideHealthboxes(foes, -1);
      // Two wild Pokémon (74): "A wild X and Y appeared!".
      yield* this.say(foes.length === 2 ? this.text.get('AWildPokemonAndPokemonAppeared', [foes[0]!.view.name, foes[1]!.view.name]) : this.text.get('AWildPokemonAppeared', [this.enemy.view.name]));
    }
    this.foeHpAtSwitch = this.enemy.mon.hp;
    if (this.format === 'multi') {
      // 2vs2: "{class} {partner} sent out X! Go! Y!" (the partner's lead, then the player's).
      const partner = this.battlers[2]!;
      yield* this.sendOut([partner, this.player], true, this.text.get('TrSentOutPokemon1GoPokemon2', [...this.trainerVars(this.trainers[2]!), partner.view.name, this.player.view.name]));
    } else if (this.format === 'doubles') {
      // The player's two leads: "Go! X and Y!".
      const [a, b] = [this.player, this.battlers[2]!];
      yield* this.sendOut([a, b], true, this.text.get('GoPokemon1AndPokemon2', [a.view.name, b.view.name]));
    } else yield* this.sendOut([this.player], true, this.text.get('GoPokemon', [this.player.view.name]));
    yield* this.play();
  }

  /** Task_SetGiratinaEncounter: hold 28 frames, enter vertically from 136 px above, then clear the half-black palette. */
  private *giratinaEntrance(): Tick {
    const foe = this.enemy.view;
    foe.dx = 0;
    foe.dy = -136;
    foe.introShade = 0.5;
    for (let t = 0; t < 62; t++) {
      const travel = Math.max(0, t - 27);
      this.platforms = { enemyDx: Math.min(0, -272 + travel * 8), playerDx: Math.max(0, 272 - t * 8) };
      if (this.playerTrainer) this.playerTrainer.dx = this.platforms.playerDx;
      foe.dy = Math.min(0, -136 + travel * 4);
      this.fade = Math.max(0, 1 - t / FADE_IN);
      yield;
    }
    for (let shade = 7; shade >= 0; shade--) {
      foe.introShade = shade / 16;
      yield;
    }
    delete foe.introShade;
  }

  /**
   * "{class} {name} sent out X!" (one trainer's two: "… sent out X and Y!"; two trainers: both in one message): the
   * trainer slides off (first send-out), the foes appear, their healthboxes slide in.
   */
  private *foeSendOut(sides: Side[], first: boolean): Tick {
    const vars = (s: Side) => [...this.trainerVars(this.trainers[s.id]!), s.view.name];
    let message: string;
    if (sides.length === 1) message = this.text.get('TrSentOutPokemon', vars(sides[0]!));
    else if (this.trainers[sides[0]!.id] === this.trainers[sides[1]!.id]) message = this.text.get('TrSentOutPokemon1AndPokemon2', [...vars(sides[0]!), sides[1]!.view.name]);
    else message = this.text.get('Tr1SentOutPokemon1Tr2SentOutPokemon2', [...vars(sides[0]!), ...vars(sides[1]!)]);
    this.startMessage(message);
    // Two enemy trainers leave together, each from its own spot.
    const leaving = first ? [this.enemyTrainer, this.enemyTrainer2].filter((t) => t !== null) : [];
    while (leaving.some((t) => t.dx < TRAINER_OFF)) {
      for (const t of leaving) t.dx = Math.min(TRAINER_OFF, t.dx + TRAINER_SLIDE_STEP);
      this.printStep();
      yield;
    }
    this.enemyTrainer = null;
    this.enemyTrainer2 = null;
    for (const s of sides) this.revealFoe(s);
    yield* this.appear(sides);
    yield* this.slideHealthboxes(sides, -1);
    yield* this.finishMessage();
  }

  /** The send-out flash: the battlers grow in, white. */
  private *appear(sides: Side[]): Tick {
    for (const side of sides) {
      side.view.visible = true;
      side.view.dx = 0;
      side.view.dy = 0;
      side.view.clip = 0;
      side.view.flash = true;
    }
    this.openBalls(sides);
    for (let t = 1; t <= 8; t++) {
      for (const side of sides) side.view.scale = t / 8;
      this.printStep();
      yield;
    }
    for (const side of sides) side.view.flash = false;
    while (this.sealsPlaying(sides)) {
      this.printStep();
      yield;
    }
    yield* this.shinySparkle(sides);
  }

  /**
   * The shiny sparkle (decomp Task_SetEncounter, Task_ShowEncounter, Task_ShowPokemon): once a shiny Pokémon is in
   * place, and after its capsule's seals, common animation 11 (`shiny`: particle file 27 and SEQ_SE_DP_REAPOKE) plays
   * on it. BattleDisplay_PlayMoveAnimation does not ask BattleSystem_AreAnimationsOn: it plays with the battle scene off.
   * Two sparkles at once (doubles) play one after the other here, the message printing on.
   */
  private *shinySparkle(sides: Side[]): Tick {
    for (const side of sides) {
      if (!isShiny(side.mon.otId, side.mon.pid)) continue;
      yield* this.playAnim(commonAnimation(this.deps.registries, 'shiny'), 'shiny', side, side, 0, undefined, () => this.printStep());
    }
  }

  /**
   * The frame the ball opens (decomp Task_ShowEncounter, Task_ShowPokemon): the ball-open sound and the send-out
   * effect (ov12_022363B4): a capsule's seals, else the ball's default burst. Packs without the seal tables have
   * neither effect (a capsule then cannot have reached the battle: the trainer build and the party need them).
   */
  private openBalls(sides: Side[]): void {
    const reg = this.deps.registries;
    const tables = newGameRecord(reg).seals;
    const data = [...reg.battleAnimData.values()][0];
    for (const side of sides) {
      this.deps.sound?.se?.(SE_BALL_OPEN);
      if (!tables || !data) {
        if (side.mon.capsule) throw new Error('battle: a Pokémon with a ball capsule, but the packs have no seal tables or battle animation data');
        continue;
      }
      const source = side.mon.capsule ? { capsule: side.mon.capsule } : { ball: this.deps.registries.items.get(side.mon.ball)?.sourceIndex ?? 0 };
      this.sendOutRng ??= new SplRandom((this.deps.seed ^ 0x5eed0b11) >>> 0);
      // BattleAnimUtil_GetBattlerType: solo player 0 and enemy 1 in singles, battler + 2 in doubles.
      const type = this.doubles ? side.id + 2 : side.id;
      this.sendOuts.set(side.id, new SendOutEffect(tables, data.positions, type, source, (member) => this.ballParticles(member), this.sendOutRng));
    }
  }

  /** A `ball_particle.narc` system record. */
  private ballParticles(member: number): ParticleSystem {
    for (const p of this.deps.registries.particleSystems.values()) if (p.archive === 'ball' && p.sourceIndex === member) return p;
    throw new Error(`battle: no ball_particle system ${member} in the packs`);
  }

  /** The Pokémon's cry and animation wait while its capsule's seals play (decomp: every seal system finished). */
  private sealsPlaying(sides: Side[]): boolean {
    return sides.some((s) => {
      const fx = this.sendOuts.get(s.id);
      return fx !== undefined && fx.holds && fx.active;
    });
  }

  /** "Go! X!" (or a send-out line): the throw (when the trainer is on screen), the send-out flash, the healthboxes. */
  private *sendOut(sides: Side[], throwing: boolean, message: string): Tick {
    this.startMessage(message);
    // The trainers on screen throw: the player alone (one throw sends out both of a double), or in a 2vs2 the AI
    // partner beside the player, each its own ball (decomp: the paired release is skipped for 2vs2).
    const throwers = [this.playerTrainer, this.partnerTrainer].filter((t) => t !== null);
    if (throwing && throwers.length) {
      for (let t = 0; t < THROW_SEND_OUT; t++) {
        for (const trainer of throwers) {
          trainer.throwTick = t;
          if (t >= THROW_SLIDE_FROM) trainer.dx -= THROW_SLIDE_STEP;
        }
        this.printStep();
        yield;
      }
    }
    const slideOff = () => {
      for (const trainer of throwers) {
        if (trainer.dx <= -160) continue;
        trainer.dx -= THROW_SLIDE_STEP;
        trainer.throwTick = (trainer.throwTick ?? 0) + 1;
      }
    };
    for (const side of sides) {
      side.view.visible = true;
      side.view.flash = true;
    }
    this.openBalls(sides);
    for (let t = 1; t <= 8; t++) {
      for (const side of sides) side.view.scale = t / 8;
      slideOff();
      this.printStep();
      yield;
    }
    for (const side of sides) side.view.flash = false;
    while (throwers.some((t) => t.dx > -160) || this.sealsPlaying(sides)) {
      slideOff();
      this.printStep();
      yield;
    }
    yield* this.shinySparkle(sides);
    this.playerTrainer = null;
    this.partnerTrainer = null;
    for (const side of sides) this.onSwitchIn(side.id);
    yield* this.slideHealthboxes(sides, 1);
    yield* this.finishMessage();
  }

  private *slideHealthboxes(sides: Side[], from: -1 | 1): Tick {
    for (const side of sides) side.view.healthbox = { visible: true, dx: from * HEALTHBOX_SLIDE };
    while (sides.some((side) => side.view.healthbox.dx !== 0)) {
      for (const side of sides) {
        const dx = side.view.healthbox.dx;
        side.view.healthbox.dx = from < 0 ? Math.min(0, dx + HEALTHBOX_STEP) : Math.max(0, dx - HEALTHBOX_STEP);
      }
      yield;
    }
  }

  /** Shows the prompt with its message and waits for `choose` (or the cursor's A). */
  private *ask(prompt: BattlePrompt, message: string): Generator<void, BattleChoice, void> {
    if (prompt.kind === 'command') {
      this.startMessage(message);
      while (!this.printer!.done) {
        this.printStep();
        yield;
      }
    } else yield* this.say(message);
    this.answer = null;
    this.prompt = prompt;
    while (!this.answer) yield;
    const answer = this.answer;
    this.answer = null;
    this.prompt = null;
    return answer;
  }

  /** The command card may go back to the first battler's (CANCEL; see `doublesTurn`). */
  private canRewind = false;

  /**
   * The command card for the acting battler; BAG and POKéMON open their sheet, whose pick is the turn's choice
   * (cancel: back to the card). Run in a trainer battle is refused at once and the card comes back (decomp: no turn
   * passes). In a double the player commands alone, CANCEL may go back to the first battler (`cancel`).
   */
  private *command(canRewind = false): Generator<void, BattleChoice, void> {
    this.canRewind = canRewind;
    for (;;) {
      const choice = yield* this.ask(this.commandPrompt(), this.text.get('WhatWillPokemonDo', [this.acting.view.name]));
      if (choice.kind === 'run' && this.frontier) {
        // Decomp COMMAND_SELECTION_RUN_SELECT_INIT with BATTLE_TYPE_FRONTIER: "Would you like to forfeit the match and
        // quit now?" (YES ends the battle, NO back to the commands).
        const answer = yield* this.ask({ kind: 'forfeit', cursor: 0 }, this.text.get('WouldYouLikeToForfeitTheMatchAndQuitNowYesNo'));
        if (answer.kind === 'answer' && answer.yes) return choice;
        continue;
      }
      if (choice.kind === 'run' && this.trainer) {
        yield* this.say(this.text.get('NoTheresNoRunningFromATrainerBattle'));
        continue;
      }
      if (choice.kind !== 'bag' && choice.kind !== 'party') return choice;
      const picked = yield* this.sheet(choice.kind === 'bag' ? { kind: 'bag' } : { kind: 'party', forced: false });
      if (picked) return picked;
    }
  }

  /** Decomp Battler_CanEscape for the active Pokémon (against battler 1, `battler ^ 1`); counts the attempt. */
  private escapes(): boolean {
    const lead = this.player;
    const escaped = canEscape({
      speed: lead.mon.stats.speed,
      foeSpeed: this.enemy.mon.stats.speed,
      attempts: this.runAttempts,
      smokeBall: this.dex.holdEffect(lead.mon.heldItem).holdEffect === 'FLEE',
      runAway: lead.mon.ability !== null && bare(lead.mon.ability) === 'ABILITY_RUN_AWAY',
      rand16: () => this.rng.next16(),
    });
    this.runAttempts++;
    return escaped;
  }

  /** The player's one command (singles, and battler 0 beside an AI partner) and the turn it starts. */
  private *turn(choice: BattleChoice): Tick {
    const own = (a: FoeAction, foes = this.aiActions()) => {
      foes[0] = a;
      return foes;
    };
    if (choice.kind === 'run' && this.frontier) {
      yield* this.forfeit();
      return;
    }
    if (choice.kind === 'run') {
      if (this.escapes()) {
        yield* this.say(this.text.get('GotAwaySafely'));
        this.outcome = 'fled';
        return;
      }
      yield* this.say(this.text.get('CantEscape'));
      // With an AI partner (2vs2) the failed escape ends the player's action only; the partner keeps its own.
      yield* this.simTurn(own({ kind: 'pass' }));
    } else if (choice.kind === 'move') yield* this.simTurn(own({ kind: 'move', slot: choice.slot, ...(choice.target === undefined ? {} : { target: choice.target }) }));
    else if (choice.kind === 'item') {
      // The foe decides first (the command phase), then items act before moves.
      const foes = this.aiActions();
      yield* this.useItem(choice.item, choice.target ?? null, choice.move);
      if (this.outcome) return;
      yield* this.simTurn(own({ kind: 'pass' }, foes));
    } else if (choice.kind === 'switch') yield* this.simTurn(own({ kind: 'switch', slot: choice.slot }));
    else throw new Error(`battle: ${choice.kind} at the command prompt`);
  }

  /**
   * A turn of a double the player commands alone (types 3 and 19; decomp BattleControllerPlayer_CommandSelectionInput):
   * the first battler's command, then the second's. CANCEL goes back to the first unless the first used an item
   * with an id above 16 (decomp BattleSystem_IsSlot2WaitingForPartner: the ROM's ids 1–16 are the balls): such an item
   * acts as it is chosen, so the second command sees its effect (decomp BattleSystem_UseBagItem in the party menu);
   * one at or below 16 (a ball, here knocked away by the trainer) when the turn runs. A switch reserves its Pokémon
   * for the second command. Then the AI battlers decide and the turn runs.
   */
  private *doublesTurn(): Tick {
    const actors = this.playerBattlers().filter((b) => this.activeSim(this.teams[b]!).hp > 0);
    const chosen: (BattleChoice | null)[] = [null, null, null, null];
    this.reserved.clear();
    let committed = false;
    for (let i = 0; i < actors.length; ) {
      const b = actors[i]!;
      this.actor = b;
      if (this.locked(b)) {
        chosen[b] = { kind: 'move', slot: 0 };
        i++;
        continue;
      }
      const before = i > 0 ? actors[i - 1]! : null;
      const choice = yield* this.command(before !== null && !committed && !this.locked(before));
      if (choice.kind === 'cancel') {
        i--;
        const undone = chosen[actors[i]!];
        if (undone?.kind === 'switch') this.reserved.delete(undone.slot);
        chosen[actors[i]!] = null;
        continue;
      }
      if (choice.kind === 'run') {
        // Decomp COMMAND_SELECTION_RUN_SELECT: a forfeit ends the turn for both battlers.
        this.canRewind = false;
        this.actor = 0;
        this.reserved.clear();
        yield* this.forfeit();
        return;
      }
      if (choice.kind === 'switch') this.reserved.add(choice.slot);
      if (choice.kind === 'item' && this.commits(choice.item)) {
        yield* this.useItem(choice.item, choice.target ?? null, choice.move);
        committed = true;
      }
      chosen[b] = choice;
      i++;
    }
    this.canRewind = false;
    const actions = this.aiActions();
    for (const b of actors) {
      if (this.outcome) break;
      const c = chosen[b]!;
      this.actor = b;
      if (c.kind === 'item') {
        if (!this.commits(c.item)) yield* this.useItem(c.item, c.target ?? null, c.move);
        actions[b] = { kind: 'pass' };
      } else if (c.kind === 'move') actions[b] = { kind: 'move', slot: c.slot, ...(c.target === undefined ? {} : { target: c.target }) };
      else if (c.kind === 'switch') actions[b] = { kind: 'switch', slot: c.slot };
      else throw new Error(`battle: ${c.kind} at the command prompt`);
    }
    this.actor = 0;
    this.reserved.clear();
    if (this.outcome) return;
    yield* this.simTurn(actions);
  }

  /** The decomp's commit gate on the first command's item: an id above 16 (`Item.sourceIndex`; the ROM's balls are 1–16). */
  private commits(item: Id): boolean {
    return (this.item(item).sourceIndex ?? 0) > 16;
  }

  /**
   * The catching tutorial (decomp: the counterpart's touches are scripted, GetCatchTutorialInput): the first
   * turn it fights with its first move; from then on (CatchingTutorialLowHP is set once a move is picked)
   * it says its HP line, waits, and throws a Poké Ball, which always catches (BATTLE_TYPE_CATCH_TUTORIAL is
   * in ALWAYS_CATCH). Its moves always hit and never crit. The AI's CATCH_TUTORIAL "escape at 20% HP" routine
   * is not used by the DS for this: the ball comes on the second turn whatever the HP.
   */
  private *tutorialTurn(): Tick {
    if (this.turns === 1) {
      yield* this.say(this.text.get('WhatWillPokemonDo', [this.player.view.name]));
      const actions = this.aiActions();
      actions[0] = { kind: 'move', slot: 0 };
      yield* this.simTurn(actions);
      return;
    }
    const gender = this.setup.counterpart!.gender === 'male' ? 0 : 1;
    yield* this.say(this.text.get(gender ? 'OKTheGotIsHPDownTimeItsReadyForAPokeBall' : 'AllRightIGotItsHPDownTimeToThrowAPokeBall'));
    for (let t = 0; t < TUTORIAL_WAIT; t++) yield;
    const ball = this.deps.registries.items.get(newGameRecord(this.deps.registries).pokeBall)!;
    yield* this.say(this.text.get('PlayerUsedOneItem', [this.setup.counterpart!.name, ball.name]));
    // The capture sequence of any ball (decomp BattleScript_CatchMonTask): ALWAYS_CATCH, so three shakes and caught.
    this.catchSide = this.enemy;
    yield* this.ballThrow(ball, () => CAUGHT);
    this.enemy.view.healthbox.visible = false;
    this.victory();
    yield* this.say(this.text.get('GotchaPokemonWasCaught', [this.enemy.view.name]));
    yield* this.ballFadeOut();
    this.ball = null;
    this.outcome = 'caught';
  }

  /**
   * A Safari battle's turn (decomp BATTLE_TYPE_SAFARI): the wild Pokémon decides first whether it will flee
   * (Task_SafariPokemonSetCommandSelection: rand % 255 ≤ its flee rate scaled by the escape count), the player picks
   * Ball, Bait, Mud or Run and always acts first (CalcTurnOrder), then the wild Pokémon flees or watches.
   */
  private *safariTurn(): Tick {
    const s = this.safari!;
    const foe = this.enemy;
    const rate = safariScaled(this.dex.form(foe.mon.species, foe.mon.form).safariFleeRate, s.escape);
    const flees = this.rng.next16() % 255 <= rate;
    const choice = yield* this.ask(this.commandPrompt(), this.text.get('WhatWillPlayerThrow', [this.deps.player.name]));
    if (choice.kind === 'run') {
      // Battler_CanEscape: BATTLE_TYPE_NO_EXPERIENCE always gets away (no ability or held item counts in Safari).
      yield* this.say(this.text.get('GotAwaySafely'));
      this.outcome = 'fled';
      return;
    }
    if (choice.kind !== 'safari') throw new Error(`battle: ${choice.kind} at the Safari command prompt`);
    if (choice.action === 'ball') yield* this.safariBall();
    else yield* this.safariThrow(choice.action);
    if (this.outcome) return;
    if (flees) {
      // subscript_enemy_escape.
      this.deps.sound?.se?.(SE_ESCAPE);
      yield* this.say(this.text.get('TheWildPokemonFled', [foe.view.name]));
      this.outcome = 'enemy-fled';
    } else yield* this.say(this.text.get('PokemonIsWatchingCarefully', [foe.view.name]));
  }

  /** The pack's Safari Ball (decomp ITEM_SAFARI_BALL: the ball the Safari command throws). */
  private safariBallItem(): Item {
    const ns = newGameRecord(this.deps.registries).id.split(':')[0]!;
    return this.item(`${ns}:ITEM_SAFARI_BALL` as Id);
  }

  /**
   * BattleControllerPlayer_SafariBallCommand and subscript_throw_safari_ball: one ball less, "{player} used one Safari
   * Ball!", the capture with the catch rate scaled by the catch stage; out of balls without a catch, the announcer
   * ends the game (BATTLE_RESULT_PLAYER_FLED).
   */
  private *safariBall(): Tick {
    const s = this.safari!;
    const rec = this.safariBallItem();
    s.balls--;
    this.catchSide = this.enemy;
    yield* this.say(this.text.get('PlayerUsedOneItem', [this.deps.player.name, rec.name]));
    this.ballsThrown++;
    const shakes = yield* this.ballThrow(rec, () => this.catchShakes(rec));
    if (shakes === CAUGHT) {
      yield* this.caughtMon(rec);
      return;
    }
    yield* this.say(this.text.get(BROKE_FREE[shakes]!));
    if (s.balls > 0) return;
    this.deps.sound?.se?.(SE_PINPON);
    yield* this.say(this.text.get('YoureOutOfSafariBallsGameOver'));
    this.outcome = 'fled';
  }

  /**
   * BattleControllerPlayer_SafariBaitCommand / SafariRockCommand and their subscripts: the draw (rand % 10), the
   * stages, the throw, the wild Pokémon's reaction animations and message. Bait raises the catch stage, and the escape
   * count unless the draw is 0 ("busy eating"); Mud lowers the escape count, and the catch stage unless the draw is
   * 0 ("beside itself with anger").
   */
  private *safariThrow(what: 'bait' | 'mud'): Tick {
    const s = this.safari!;
    const foe = this.enemy;
    const temp = this.rng.next16() % 10;
    if (what === 'bait') {
      if (s.stage < SAFARI_STAGE_MAX) s.stage++;
      if (temp !== 0 && s.escape < SAFARI_STAGE_MAX) s.escape++;
    } else {
      if (s.escape) s.escape--;
      if (temp !== 0 && s.stage) s.stage--;
    }
    const player = this.deps.player.name;
    yield* this.say(this.text.get(what === 'bait' ? 'PlayerThrewSomeBaitAtThePokemon' : 'PlayerThrewMudAtThePokemon', [player, foe.view.name]));
    // ThrowPokeball BTLSCR_THROW_SAFARI_BAIT / _ROCK: the trainer throws, the bait or mud flies to the Pokémon.
    const item = this.safariBallItem().id;
    for (let t = 1; t <= BALL_FLIGHT; t++) {
      const k = t / BALL_FLIGHT;
      if (this.playerTrainer) this.playerTrainer.throwTick = t - 1;
      this.ball = { item, x: Math.round(BALL_FROM.x + (BALL_AT.x - BALL_FROM.x) * k), y: Math.round(BALL_FROM.y + (BALL_AT.y - BALL_FROM.y) * k - Math.sin(Math.PI * k) * 40), anim: 0, tick: t, tilt: 0, shade: 0, alpha: 1, stars: null, throw: what };
      yield;
    }
    this.ball = null;
    if (this.playerTrainer) this.playerTrainer.throwTick = null;
    for (const anim of what === 'bait' ? ['happy', 'eating'] : ['angry']) yield* this.animate(commonAnimation(this.deps.registries, anim), anim, foe, foe);
    const message = what === 'bait' ? (temp === 0 ? 'PokemonIsBusyEating' : 'PokemonIsEating') : temp === 0 ? 'PokemonIsBesideItselfWithAnger' : 'PokemonIsAngry';
    yield* this.say(this.text.get(message, [foe.view.name]));
  }

  /**
   * The AI battlers' commands by battler id (null for the player's and for an empty slot), in the DS's order:
   * battler 1, then the partner 2, then 3 (decomp: command selection walks the battlers in numeric order).
   */
  private aiActions(): (FoeAction | null)[] {
    return this.battlers.map((b) => (this.isPlayer(b.id) || this.activeSim(this.teams[b.id]!).hp === 0 ? null : this.foeAction(b.id)));
  }

  /** An AI battler's command (decomp: the trainer AI, or the wild Pokémon, picks during command selection). */
  private foeAction(battler: number): FoeAction {
    const sim = this.activeSim(this.teams[battler]!);
    // Locked into its move: no AI (decomp: the command phase skips a battler that cannot choose).
    if (this.locked(battler)) return { kind: 'move', slot: 0 };
    const trainer = this.trainers[battler];
    if (this.battleType === BATTLE_TYPE_ROAMER && !this.roamerTrapped()) return { kind: 'escape' };
    if (!trainer) {
      // Decomp wild AI: a uniformly random usable move; in a double its target a random opponent standing
      // (Task_TrainerShowMoveSelectMenu: BattleSystem_Defender with the random flag).
      const request = this.sim[this.simSideOf(battler)]!.activeRequest as { active?: { moves: { disabled?: boolean | string; pp?: number }[] }[] } | null;
      const moves = request?.active?.[this.simPos(battler)]?.moves ?? [];
      const usable = moves.map((m, i) => ({ m, i })).filter(({ m }) => !m.disabled && (m.pp ?? 1) > 0);
      const slot = usable.length ? usable[this.rng.next16() % usable.length]!.i : 0;
      if (!this.doubles) return { kind: 'move', slot };
      const target = sim.moveSlots[slot]?.target;
      if (!target || !CHOSEN_TARGETS.has(target)) return { kind: 'move', slot };
      return { kind: 'move', slot, target: this.randomOpponent(battler) };
    }
    if (!sim.moveSlots.length) throw new Error(`battle: battler ${battler} has no moves`);
    const view = this.aiView();
    const ai = { battler, ai: trainer.ai };
    // The first battle skips the command AI (decomp Task_TrainerShowMoveSelectMenu: TrainerAI_Main alone).
    const decision = this.setup.kind === 'first' ? this.ai!.chooseMove(view, ai, this.aiRng) : this.ai!.chooseAction(view, ai, this.aiRng);
    return this.toFoeAction(decision.action, battler);
  }

  /** Decomp BattleSystem_RandomOpponent: one draw between the opponents' second and first battler, the other if it is down. */
  private randomOpponent(battler: number): number {
    const opponents = [(battler ^ 1) | 2, (battler ^ 1) & 1];
    const r = this.rng.next16() & 1;
    const standing = (b: number) => this.activeSim(this.teams[b]!).hp > 0;
    return standing(opponents[r]!) ? opponents[r]! : opponents[r ^ 1]!;
  }

  private toFoeAction(a: AiAction, battler: number): FoeAction {
    switch (a.kind) {
      case 'move': {
        // The AI scores a move it cannot use at 0 but may still pick it on a tie (decomp TrainerAI_Init); the sim
        // refuses it, so the first move it takes goes instead (logged: the DS's own handling is not ported).
        const moves = this.activeSim(this.teams[battler]!).moveSlots;
        if (!moves[a.slot]?.disabled) return { kind: 'move', slot: a.slot, target: a.target };
        const usable = moves.findIndex((m) => !m.disabled && m.pp > 0);
        this.deps.log.stub('battle:ai-unusable-move', 'the trainer AI picked a move the battle refuses; its first usable move goes instead');
        return { kind: 'move', slot: Math.max(0, usable), target: a.target };
      }
      case 'switch':
        return { kind: 'switch', slot: a.slot };
      case 'item':
        return { kind: 'item', item: a.item, category: a.category };
      case 'escape':
      case 'safari':
        throw new Error(`battle: the trainer AI chose ${a.kind} in a trainer battle`);
    }
  }

  /** The AI's draws come from the battle's stream (BattleSystem_RandNext), as 16-bit values. */
  private readonly aiRng = { next: () => this.rng.next16() };

  private aiView() {
    return createAiView(this.deps.registries, {
      battleType: this.battleType,
      totalTurns: this.turns - 1,
      memory: this.memory,
      rng: this.aiRng,
      sim: this.sim,
      sides: this.teams,
      battlerOf: (p) => this.battlerOfSim(p as SimMon),
      packMove: (id) => this.data.packMove(id),
      packItem: (id) => this.data.packItem(id),
      speedRand: this.speedRand,
      powerMul: this.powerMul,
    });
  }

  /**
   * One turn: items first (decomp turn order: run, items and switches, then moves), then the sim's turn with every
   * battler's move slot and target, switch, or the hidden pass move (a turn spent outside the sim), one choice per
   * sim side (doubles: its two positions' joined).
   */
  private *simTurn(actions: (FoeAction | null)[]): Tick {
    for (const [b, a] of actions.entries()) if (a?.kind === 'item') yield* this.foeItem(this.battlers[b]!, a.item, a.category);
    const passed: SimMon[] = [];
    const bySide = new Map<SimSide, string[]>();
    for (const [b, a] of actions.entries()) {
      if (!a) continue;
      const sim = this.activeSim(this.teams[b]!);
      let choice: string;
      if (a.kind === 'move') choice = this.struggling(sim) || this.locked(b) ? 'move 1' : this.moveChoice(this.battlers[b]!, a.slot + 1, a.target);
      else if (a.kind === 'switch') choice = `switch ${this.simIndex(b, a.slot)}`;
      else {
        this.addPass(sim, a.kind === 'escape');
        choice = `move ${sim.moveSlots.length}`;
      }
      passed.push(sim);
      const side = this.simSideOf(b);
      bySide.set(side, [...(bySide.get(side) ?? []), choice]);
    }
    for (const [side, choices] of bySide) this.sim.choose(side, choices.join(', '));
    for (const p of passed) this.removePass(p);
    // decomp PRE_MOVE_ACTION_STATE_SPEED_RNG.
    this.drawSpeedRand();
    this.hitThisTurn.clear();
    yield* this.play();
  }

  /** The sim's 1-based team position of battler `b`'s party slot (the sim reorders its team on switches). */
  private simIndex(b: number, slot: number): number {
    const sim = this.teams[b]!.sims[slot];
    const at = (this.sim[this.simSideOf(b)]!.pokemon as SimMon[]).indexOf(sim!);
    if (!sim || at < 0) throw new Error(`battle: battler ${b}'s party slot ${slot} is not in the battle`);
    return at + 1;
  }

  /** No move has PP: the sim offers Struggle alone, as its move 1. */
  private struggling(sim: SimMon): boolean {
    return sim.moveSlots.every((m) => m.id === PASS_MOVE || m.pp === 0);
  }

  /** The sim refuses the acting battler's move in `slot` this turn (Disable, Encore, Taunt, Torment, Imprison, a Choice item). */
  private moveDisabled(slot: number): boolean {
    const sim = this.activeSim(this.teams[this.actor]!);
    if (this.locked(this.actor) || this.struggling(sim)) return false;
    // The move slot's own flag: the request hides some (Imprison by a foe whose move is not revealed: 'hidden').
    return !!sim.moveSlots[slot]?.disabled;
  }

  /** The battler's Pokémon must use one move (the sim's request offers only it, as move 1), while it knows more. */
  private locked(b: number): boolean {
    const request = this.sim[this.simSideOf(b)]!.activeRequest as { active?: ({ moves: { id: string }[] } | null)[] } | null;
    const offered = request?.active?.[this.simPos(b)]?.moves;
    const team = this.teams[b]!;
    const known = this.activeSim(team).moveSlots.filter((m) => m.id !== PASS_MOVE);
    return !!offered && offered.length === 1 && known.length > 1 && !this.struggling(this.activeSim(team));
  }

  /** The sim side of battler `b`: one per battler, or in doubles p1 for 0 and 2, p2 for 1 and 3. */
  private simSideOf(b: number): SimSide {
    return this.format === 'doubles' ? (b & 1 ? 'p2' : 'p1') : SIM_SIDES[b]!;
  }

  /** Battler `b`'s active position on its sim side (doubles: 0 or 1). */
  private simPos(b: number): number {
    return this.format === 'doubles' ? b >> 1 : 0;
  }

  /** The battler a sim Pokémon in the field stands for. */
  private battlerOfSim(p: SimMon): number {
    return this.format === 'doubles' ? p.side.n + 2 * p.position : p.side.n;
  }


  private drawSpeedRand(): void {
    this.speedRand = [0, 1, 2, 3].map(() => this.speedRng.next16());
  }

  /** The last move used and its side, for Pursuit's switch check. */
  private lastMove: { move: string; side: string; name: string } | null = null;

  /**
   * decomp BattleContext_SetupLoop resets powerMul to 10 for every move; BtlCmd_CalcRevengePowerMul sets 20
   * when the user took the target's damage first this turn.
   */
  private updatePowerMul(user: string, simMove: string): void {
    const side = user.slice(0, 2);
    const move = this.data.packMove(simMove);
    this.lastMove = { move: toID(simMove), side, name: move.name };
    this.powerMul = bare(move.effect) === 'BATTLE_EFFECT_DOUBLE_POWER_IF_HIT' && this.hitThisTurn.has(this.battlerOf(user)) ? 20 : 10;
  }

  /** The pass move (no action), or a roamer's escape (`roamerEscape`), as one more move slot for this turn. */
  private addPass(sim: SimMon, escape = false): void {
    const pass = { move: escape ? 'OpenSinnoh Escape' : 'OpenSinnoh Pass', id: escape ? ESCAPE_MOVE : PASS_MOVE, pp: 1, maxpp: 1, target: 'self', disabled: false, disabledSource: '', used: false };
    sim.baseMoveSlots.push(pass as never);
    sim.moveSlots.push(pass as never);
  }

  private removePass(sim: SimMon): void {
    sim.baseMoveSlots = sim.baseMoveSlots.filter((m) => m.id !== PASS_MOVE && m.id !== ESCAPE_MOVE);
    sim.moveSlots = sim.moveSlots.filter((m) => m.id !== PASS_MOVE && m.id !== ESCAPE_MOVE);
  }

  /** A roamer with its saved PID, IVs, HP and status, holding nothing (decomp AddRoamerToEnemyParty). */
  private roamerMon(spec: BattleSetup['wild'][number], ball: Id): Pokemon {
    const r = spec.roamer!;
    const player = this.deps.player;
    const mon = createPokemon(this.dex, { species: spec.species, form: spec.form ?? 0, level: spec.level, pid: r.pid, ivs: r.ivs, otId: player.trainerId, otName: player.name, otGender: player.gender, ball, met: { zone: this.deps.met.zone, level: spec.level, date: this.deps.met.date }, heldItem: null });
    mon.hp = r.hp;
    mon.status = r.status;
    return mon;
  }

  /**
   * Decomp RoamingPokemon_Main (the trainer AI script under AI_FLAG_ROAMING_POKEMON): the roamer stays when it is
   * bound or under Mean Look, when the player's Pokémon has Shadow Tag, or Arena Trap unless the roamer levitates.
   */
  private roamerTrapped(): boolean {
    const roamer = this.activeSim(this.foe);
    const foe = this.activeSim(this.own);
    if (roamer.volatiles['partiallytrapped'] || roamer.volatiles['trapped']) return true;
    if (foe.ability === 'shadowtag') return true;
    return roamer.ability !== 'levitate' && foe.ability === 'arenatrap';
  }

  /**
   * A roamer's escape (decomp BattleControllerPlayer_FleeCommand for the enemy): it acts after the player's command
   * whatever its speed (CalcTurnOrder: Run is no Fight), as the lowest-priority move slot, but runs here, not as a
   * move, so sleep or paralysis do not stop it. Bound or under Mean Look by then it cannot escape
   * (subscript_enemy_escape_failed) and the turn goes on; else it flees (subscript_enemy_escape) and the turn ends
   * at once, without the end-of-turn effects (FIGHT_END).
   */
  private roamerEscape(): void {
    type Action = { choice: string; move?: { id: string }; pokemon?: SimMon };
    const sim = this.sim as unknown as { runAction(a: Action): unknown; add(...parts: unknown[]): void; queue: { clear(): void } };
    const run = sim.runAction.bind(this.sim);
    sim.runAction = (action) => {
      const mon = action.pokemon;
      if (action.choice !== 'move' || action.move?.id !== ESCAPE_MOVE || !mon || mon.fainted || !mon.isActive) return run(action);
      const trapped = !!(mon.volatiles['partiallytrapped'] || mon.volatiles['trapped']);
      sim.add('-opensinnohescape', mon, trapped ? 'failed' : 'fled');
      if (!trapped) sim.queue.clear();
      return undefined;
    };
  }

  /**
   * A trainer item (decomp subscript_use_potion and friends): "{class} {name} used one X!", then its effect
   * on the active Pokémon. The AI already took the item from its list.
   */
  private *foeItem(user: Side, itemNumber: number, category: number): Tick {
    const item = [...this.deps.registries.items.values()].find((i) => i.sourceIndex === itemNumber);
    if (!item) throw new Error(`battle: the trainer AI used item ${itemNumber}, which no pack has`);
    yield* this.say(this.text.get('TrUsedOneItem', [...this.trainerVars(this.trainers[user.id]!), item.name]));
    const sim = this.activeSim(this.teams[user.id]!);
    if (category === ITEM_AI_CATEGORY.FULL_RESTORE) {
      sim.setStatus('');
      user.view.status = 'none';
    }
    if (category === ITEM_AI_CATEGORY.FULL_RESTORE || category === ITEM_AI_CATEGORY.RECOVER_HP) {
      // Decomp BattleSystem_UseBagItem: 255 restores everything; otherwise the item's points, up to the max.
      const restore = item.partyUse?.hp ?? 0;
      const amount = category === ITEM_AI_CATEGORY.FULL_RESTORE || restore === 255 ? sim.maxhp : restore;
      sim.hp = Math.min(sim.maxhp, sim.hp + amount);
      yield* this.gauge(user, sim.hp);
    } else if (category === ITEM_AI_CATEGORY.RECOVER_STATUS) {
      sim.cureStatus(true);
      user.view.status = 'none';
    } else this.deps.log.stub(`battle:trainer-item:${category}`, `trainer item ${item.id}: only HP and status items have an effect yet`);
  }

  /** Plays the sim log written since the last call, in DS order. */
  private *play(): Tick {
    const lines = [...this.initialFieldLog.splice(0), ...this.sim.log.slice(this.logPos)].map((l) => l.split('|'));
    this.logPos = this.sim.log.length;
    this.levelHp.clear();
    /** -crit / effectiveness lines come before the damage in the log; the DS prints them after the hit. */
    let afterHit: string[][] = [];
    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i]!;
      const [, cmd = '', a = '', b = '', c = ''] = parts;
      const from = parts.find((x) => x.startsWith('[from]'))?.slice(7).trim();
      if (cmd === 'split') {
        i++; // the next line is the side's exact copy (debug format: both copies are exact); skip the public one
        continue;
      }
      if (cmd === '-ability' || from?.startsWith('ability: ')) this.showAbility(parts, cmd === '-ability' ? b : from!.slice(9));
      if (QUIET.has(cmd)) continue;
      // Intimidate cuts each foe in turn, each with its own message (decomp subscript_intimidate): it lasts over the
      // run of -unboost lines that follows it.
      if (this.abilityStat?.ability === 'Intimidate' && cmd !== '-unboost') this.abilityStat = null;
      switch (cmd) {
        case 'move': {
          yield* this.flush(afterHit);
          afterHit = [];
          this.abilityStat = null;
          if (b === 'OpenSinnoh Pass') break;
          this.updatePowerMul(a, b);
          const user = this.sideOf(a);
          yield* this.say(this.text.moveUsed(this.data.packMove(b), this.who(user), user.view.name));
          yield* this.moveAnimation(lines, i, user);
          break;
        }
        case '-damage':
        case '-heal': {
          const target = this.sideOf(a);
          if (cmd === '-damage' && !from) {
            this.hitThisTurn.add(this.battlerOf(a));
            // decomp battleMons[].timesDamaged (the trainer's first-damage line).
            if (target === this.enemy) this.foeTimesDamaged++;
            // The later hits of a multi-hit move each play the move's animation first (decomp LoopMultiHit).
            const h = this.hitAnims;
            if (h && h.target === target && h.played) yield* this.animate(moveAnimation(this.deps.registries, h.move), h.move, h.user, h.target);
            if (h && h.target === target) h.played = true;
            yield* this.hit(target);
          }
          yield* this.gauge(target, this.lineHp(target, b));
          if (!from) {
            yield* this.flush(afterHit);
            afterHit = [];
          } else if (!parts.includes('[silent]')) yield* this.sourcedHp(cmd, target, from, parts);
          break;
        }
        case '-crit':
        case '-supereffective':
        case '-resisted':
          afterHit.push([cmd, a]);
          break;
        case '-immune': {
          const target = this.sideOf(a);
          const ability = from?.startsWith('ability: ') ? from.slice(9) : null;
          if (ability === 'Levitate') yield* this.say(this.text.get('PokemonMakesGroundMovesMissByUsingAbility', [target.view.name, this.abilityName(ability)], this.who(target)));
          else if (ability === 'Wonder Guard') yield* this.say(this.text.get('PokemonAvoidedDamageByUsingAbility', [target.view.name, this.abilityName(ability)], this.who(target)));
          else if (ability === 'Soundproof') yield* this.say(this.text.get('PokemonsAbilityBlocksMove', [target.view.name, this.abilityName(ability), this.lastMove!.name], this.who(target)));
          else if (ability === 'Insomnia' || ability === 'Vital Spirit') yield* this.say(this.text.get('PokemonStayedAwakeBecauseOfItsAbility', [target.view.name, this.abilityName(ability)], this.who(target)));
          // Water and Volt Absorb at full HP (decomp subscript_ability_restores_hp): the move did nothing.
          else if (ability === 'Water Absorb' || ability === 'Volt Absorb') yield* this.say(this.text.get('PokemonsAbilityMadeMoveUseless', [target.view.name, this.abilityName(ability), this.lastMove!.name], this.who(target)));
          // Flash Fire already raised (decomp subscript_absorb_and_boost_fire_type_moves, BATTLEMON_FLASH_FIRE set): the move did nothing.
          else if (ability === 'Flash Fire') yield* this.say(this.text.get('PokemonsAbilityMadeMoveIneffective', [target.view.name, this.abilityName(ability), this.lastMove!.name], this.who(target)));
          else if (ability) this.deps.log.stub(`battle:protocol:-immune:${ability}`, 'no message yet');
          else yield* this.say(this.text.get('ItDoesntAffectPokemon', [target.view.name], this.who(target)));
          break;
        }
        case '-miss': {
          const user = this.sideOf(a);
          yield* this.say(this.text.missed(user.view.name, this.who(user)));
          break;
        }
        case '-fail':
          yield* this.say(this.text.get('ButItFailed'));
          break;
        case '-boost':
        case '-unboost': {
          const target = this.sideOf(a);
          const n = Number(c);
          if (this.abilityStat) {
            // decomp subscript_intimidate / Speed Boost: one message names the ability and the stat.
            const { user, ability } = this.abilityStat;
            if (ability !== 'Intimidate') this.abilityStat = null;
            if (cmd === '-unboost') yield* this.say(this.text.get('PokemonsAbilityCutsPokemonsStat', [user.view.name, this.abilityName(ability), target.view.name, this.text.stat(b)], this.pair(user, target)));
            else yield* this.say(this.text.get('PokemonsAbilityRaisedItsStat', [target.view.name, this.abilityName(ability), this.text.stat(b)], this.who(target)));
            break;
          }
          const up = cmd === '-boost';
          const name = n === 0 ? (up ? 'PokemonsStatWontGoHigher' : 'PokemonsStatWontGoLower') : n === 1 ? (up ? 'PokemonsStatRose' : 'PokemonsStatFell') : up ? 'PokemonsStatSharplyRose' : 'PokemonsStatHarshlyFell';
          // The stat change's arrows before its message (decomp subscript_update_stat_stage; none when it cannot change).
          if (n !== 0) yield* this.statusAnimation(up ? 'stat_boost' : 'stat_drop', target);
          yield* this.say(this.text.get(name, [target.view.name, this.text.stat(b)], this.who(target)));
          break;
        }
        case '-status': {
          const target = this.sideOf(a);
          // The condition's animation, then its message (decomp subscript_poison, _burn, _paralyze …).
          const common = ({ psn: 'poison', tox: 'poison', brn: 'burn', par: 'paralysis', slp: 'sleep', frz: 'freeze' } as Record<string, string>)[b];
          if (common) yield* this.statusAnimation(common, target);
          target.view.status = STATUS_FROM_SIM[b] ?? 'none';
          const name = STATUS_MESSAGES[b];
          if (name) yield* this.say(this.text.get(name, [target.view.name], this.who(target)));
          else this.deps.log.stub(`battle:protocol:-status:${b}`, 'no message yet');
          break;
        }
        case '-curestatus': {
          const target = this.sideOf(a);
          target.view.status = 'none';
          yield* this.cureStatus(target, b, from, parts);
          break;
        }
        case '-ability': {
          // Decomp BattleAI_SetAbility: an announced ability is known to the AI.
          aiRevealAbility(this.memory, this.battlerOf(a), this.abilityNumber(this.sideOf(a).mon));
          yield* this.abilityLine(this.sideOf(a), b, c, from, parts);
          break;
        }
        case '-item':
        case '-enditem': {
          // Gen 4 Frisk names no target (a random foe's item: the sim's gen4 mod logs `-item||<item>`): only its line.
          if (cmd === '-item' && from === 'ability: Frisk' && a === '') {
            yield* this.say(this.text.get('PokemonFriskedItsFoeAndFoundOneItem', [this.ofSide(parts).view.name, this.itemName(b)], this.who(this.ofSide(parts))));
            break;
          }
          const target = this.sideOf(a);
          aiRevealHeldItem(this.memory, this.battlerOf(a), cmd === '-item' ? this.itemNumber(target.mon) : 0);
          if (cmd === '-item' && from === 'ability: Frisk') yield* this.say(this.text.get('PokemonFriskedItsFoeAndFoundOneItem', [this.ofSide(parts).view.name, this.itemName(b)], this.who(this.ofSide(parts))));
          else if (cmd === '-item' && from === 'move: Trick') yield* this.say(this.text.get('PokemonObtainedOneItem', [target.view.name, this.itemName(b)], this.who(target)));
          // A berry's own line follows (its heal or cure); a used-up item has no message of its own.
          else if (!(cmd === '-enditem' && (parts.includes('[eat]') || parts.includes('[silent]')))) this.deps.log.stub(`battle:protocol:${cmd}:${b}${from ? `:${from}` : ''}`, 'held item line not shown yet');
          break;
        }
        case 'cant': {
          const target = this.sideOf(a);
          yield* this.cantLine(target, b, c);
          // Then the condition's animation (decomp subscript_fully_paralyzed, _sleeping, _frozen).
          const common = ({ par: 'paralysis', slp: 'sleep', frz: 'freeze' } as Record<string, string>)[b];
          if (common) yield* this.statusAnimation(common, target);
          break;
        }
        case 'faint':
          yield* this.flush(afterHit);
          afterHit = [];
          yield* this.faint(this.sideOf(a));
          break;
        case 'switch':
          // Pursuit on a Pokémon switching out (decomp: powerMul 20 for the hit before the switch).
          if (this.lastMove?.move === 'pursuit' && this.lastMove.side !== a.slice(0, 2)) this.powerMul = 20;
          yield* this.switchIn(a, false);
          break;
        case 'drag':
          // Roar, Whirlwind (decomp subscript_force_target_to_switch_or_flee): the next one comes out, then the line.
          yield* this.switchIn(a, true);
          yield* this.say(this.text.get('PokemonWasDraggedOut', [this.sideOf(a).view.name], this.who(this.sideOf(a))));
          break;
        case 'win':
          // Multi names both allies ("player & partner").
          this.outcome = a === 'player' || a.startsWith('player & ') ? 'won' : 'lost';
          // Decomp: a won trainer battle's result check plays the victory music by class.
          if (this.outcome === 'won' && this.trainer) this.victory();
          break;
        case 'tie':
          this.outcome = 'draw';
          break;
        case '-opensinnohescape': {
          const roamer = this.sideOf(a);
          // Decomp subscript_enemy_escape / subscript_enemy_escape_failed (its "can't escape" is the _Ally line).
          if (b === 'fled') {
            yield* this.say(this.text.get('TheWildPokemonFled', [roamer.view.name]));
            this.outcome = 'fled';
            return;
          }
          yield* this.say(this.text.get('PokemonCantEscape', [roamer.view.name], 'Ally'));
          break;
        }
        default:
          yield* this.effectLine(parts, from);
      }
    }
    yield* this.flush(afterHit);
    if (this.outcome) return;
    // The sim asks for replacements once a battler fainted, each from its own owner's party (multi: one sim side
    // per owner; doubles: a shared party, or type 19's owner map). The AI battlers' come first (decomp: the trainer's
    // AI picks, BattleAI_PostKOSwitchIn): the enemies, then the partner; then the player's, the first battler first.
    const groups: [SimSide, number[]][] =
      this.format === 'doubles'
        ? [['p2', [1, 3]], ['p1', [0, 2]]]
        : [1, 3, 2, 0].filter((b) => b < this.battlers.length).map((b) => [SIM_SIDES[b]!, [b]]);
    for (const [side, bs] of groups) {
      if (this.sim[side]!.requestState !== 'switch') continue;
      const flagged = (b: number) => !!(this.sim[side]!.active[this.simPos(b)] as SimMon | undefined)?.switchFlag;
      const picks: string[] = [];
      if (this.isPlayer(bs[0]!) && this.format !== 'doubles') {
        // The player picks the replacement for a fainted Pokémon ("Use next Pokémon?", the party).
        const slot = yield* this.replacement();
        if (slot === null) return;
        picks.push(`switch ${this.simIndex(0, slot)}`);
      } else if (this.isPlayer(bs[0]!)) {
        // Both of the player's battlers may need one; a slot with no Pokémon left to send stays empty (decomp:
        // the first slot first, the second skips the first's pick).
        this.reserved.clear();
        for (const b of bs) {
          if (!flagged(b) || !this.own.party.some((_, i) => this.canSendOut(i))) {
            picks.push('pass');
            continue;
          }
          this.actor = b;
          let slot: number | null = null;
          while (slot === null) {
            const picked = yield* this.sheet({ kind: 'party', forced: true, actor: b });
            if (picked?.kind === 'switch') slot = picked.slot;
          }
          this.reserved.add(slot);
          picks.push(`switch ${this.simIndex(b, slot)}`);
        }
        this.actor = 0;
        this.reserved.clear();
      } else {
        // The AI's picks; the first one's is kept off the second's (decomp aiSwitchedPartySlot; a shared party in 3).
        const saved = bs.map((b) => this.memory.switchedSlot[b]!);
        // A fainted battler's switch chosen at the command phase is gone by now: the DS clears it after every action
        // (BattleContext_Init), so a commanded switch that ran, or never ran because its battler fainted first,
        // does not stand in for the post-KO choice.
        for (const b of bs) if (flagged(b)) this.memory.switchedSlot[b] = NO_SLOT;
        for (const b of bs) {
          if (!flagged(b)) {
            picks.push('pass');
            continue;
          }
          const team = this.teams[b]!;
          const slot = this.ai!.chooseSwitchIn(this.aiView(), b, this.aiRng);
          const next = team.sims[slot];
          if (!next || next.hp <= 0 || next.isActive) throw new Error(`battle: the trainer AI sent out battler ${b}'s party slot ${slot}, which cannot come in`);
          if (b === 1 && this.sim.p1.requestState !== 'switch') yield* this.shiftOffer(team.party[slot]!);
          this.memory.switchedSlot[b] = slot;
          picks.push(`switch ${this.simIndex(b, slot)}`);
        }
        bs.forEach((b, i) => (this.memory.switchedSlot[b] = saved[i]!));
      }
      this.sim.choose(side, picks.join(', '));
    }
    if (this.sim.log.length > this.logPos) yield* this.play();
  }

  // ---------- protocol lines → the decomp's battle strings ----------

  private stub(parts: string[], why = 'protocol line not shown yet'): void {
    this.deps.log.stub(`battle:protocol:${parts.slice(1).join('|').replace(/p[1-4][ab]?: [^|]*/g, 'P').replace(/\|\d+(\/\d+)?( \w+)?(?=\||$)/g, '')}`, why);
  }

  /**
   * A line names an ability (decomp BattleMessage_AbilityTag): the battler it names, the line's subject or its
   * `[of]`, whichever has it, shows it from now until it leaves (BattlerView.ability).
   */
  private showAbility(parts: string[], simName: string): void {
    const id = toID(simName);
    for (const ident of [parts[2] ?? '', parts.find((x) => x.startsWith('[of] '))?.slice(5) ?? '']) {
      if (!/^p[1-4][ab]?: /.test(ident)) continue;
      const side = this.sideOf(ident);
      if (side.mon.ability && toID(bare(side.mon.ability).replace('ABILITY_', '')) === id) side.view.ability = side.mon.ability;
    }
  }

  /** The battler a `[of] p1a: X` part names. */
  private ofSide(parts: string[]): Side {
    const of = parts.find((x) => x.startsWith('[of] '));
    if (!of) throw new Error(`battle: no [of] in ${parts.join('|')}`);
    return this.sideOf(of.slice(5));
  }

  private pair(first: Side, second: Side): WhoPair {
    return `${this.who(first)}${this.who(second)}`;
  }

  /** A pack record's name by its sim name (protocol lines name abilities, items and moves the sim's way). */
  private recordName(kind: 'abilities' | 'items' | 'types', prefix: string, simName: string): string {
    const id = toID(simName);
    const rec = [...this.deps.registries[kind].values()].find((r) => toID(bare(r.id).replace(prefix, '')) === id);
    if (!rec) throw new Error(`battle: no pack ${kind} record for the sim's ${simName}`);
    return rec.name;
  }

  private abilityName(simName: string): string {
    return this.recordName('abilities', 'ABILITY_', simName.replace(/^ability: /, ''));
  }

  private itemName(simName: string): string {
    return this.recordName('items', 'ITEM_', simName.replace(/^item: /, ''));
  }

  private moveName(simName: string): string {
    return this.data.packMove(simName.replace(/^move: /, '')).name;
  }

  /** The side a `p1: player` / `p2: enemy` side id names: the player's (true; multi: p1 or p3) or the foe's. */
  private ownSide(sideId: string): boolean {
    return (this.battlerOf(sideId) & 1) === 0;
  }

  /** HP lost or gained from something other than a move's hit (decomp: the effect's subscript message). */
  private *sourcedHp(cmd: string, target: Side, from: string, parts: string[]): Tick {
    const say = (name: string, vars: string[], who: Who | WhoPair = this.who(target)) => this.say(this.text.get(name, vars, who));
    const name = target.view.name;
    // Poison and burn: the message, then the condition's animation (decomp subscript_poison_damage, _burn_damage).
    if (from === 'psn' || from === 'tox') {
      yield* say('PokemonIsHurtByPoison', [name]);
      yield* this.statusAnimation('poison', target);
    } else if (from === 'brn') {
      yield* say('PokemonIsHurtByItsBurn', [name]);
      yield* this.statusAnimation('burn', target);
    }
    else if (from === 'confusion') yield* this.say(this.text.get('ItHurtItselfInItsConfusion'));
    else if (from === 'Recoil' || from === 'recoil') yield* say('PokemonIsHitWithRecoil', [name]);
    else if (from === 'drain') yield* say('PokemonHadItsEnergyDrained', [this.ofSide(parts).view.name], this.who(this.ofSide(parts)));
    else if (from === 'Leech Seed') yield* say('PokemonsHealthIsSappedByLeechSeed', [name]);
    else if (from === 'Curse') yield* say('PokemonIsAfflictedByTheCurse', [name]);
    else if (from === 'Sandstorm' || from === 'Hail') yield* say('PokemonIsBuffetedByTheWeather', [this.moveName(from), name]);
    else if (from === 'Spikes') yield* say('PokemonIsHurtByTheSpikes', [name]);
    else if (from === 'Stealth Rock') yield* say('PointedStonesDugIntoPokemon', [name]);
    else if (from === 'Aqua Ring') yield* say('MoveRestoredPokemonsHP', [name, this.moveName('Aqua Ring')]);
    else if (from === 'Ingrain') yield* say('PokemonAbsorbedWithItsRoots', [name]);
    else if (from === 'move: Wish') yield* say('PokemonsWishCameTrue', [parts.find((x) => x.startsWith('[wisher] '))!.slice(9)]);
    else if (from.startsWith('move: ') && cmd === '-damage') yield* say('PokemonIsHurtByMove', [name, this.moveName(from)]); // a binding move's turn
    else if (from.startsWith('item: ')) {
      const item = from.slice(6);
      // decomp: Life Orb's cost has no message (subscript_lose_hp_from_item); Leftovers, Black Sludge and Shell Bell "a little HP".
      if (item === 'Life Orb') return;
      if (cmd === '-damage') yield* say('PokemonIsHurtByItsItem', [name, this.itemName(item)]);
      else if (item === 'Leftovers' || item === 'Black Sludge' || item === 'Shell Bell') yield* say('PokemonRestoredALittleHPUsingItsItem', [name, this.itemName(item)]);
      else yield* say('PokemonRestoredItsHealthUsingItsItem', [name, this.itemName(item)]);
    } else if (from.startsWith('ability: ')) {
      const ability = from.slice(9);
      if (ability === 'Rough Skin') {
        const owner = this.ofSide(parts);
        yield* say('PokemonsAbilityHurtPokemon', [owner.view.name, this.abilityName(ability), name], this.pair(owner, target));
      } else if (ability === 'Liquid Ooze') yield* this.say(this.text.get('ItSuckedUpTheLiquidOoze'));
      else if (ability === 'Aftermath') {
        const owner = this.ofSide(parts);
        yield* say('PokemonWasHurtByPokemonsAbility', [owner.view.name, this.abilityName(ability), name], this.pair(target, owner));
      } else if (cmd === '-heal') yield* say('PokemonRestoredHPUsingItsAbility', [name, this.abilityName(ability)]);
      else if (ability === 'Dry Skin' || ability === 'Solar Power') yield* say('PokemonIsHurtByItsAbility', [name, this.abilityName(ability)]);
      else this.stub(parts);
    } else this.stub(parts);
  }

  /** A status cured: on waking or thawing, or by a held berry (decomp subscript_wake_up, _thaw_out, _held_item_*_restore). */
  private *cureStatus(target: Side, status: string, from: string | undefined, parts: string[]): Tick {
    const name = target.view.name;
    if (from?.startsWith('item: ')) {
      const item = from.slice(6);
      const message = item === 'Lum Berry' ? 'PokemonNormalizedItsStatusUsingItsItem' : ({ par: 'PokemonsItemCuredItsParalysis', psn: 'PokemonsItemCuredItsPoison', tox: 'PokemonsItemCuredItsPoison', brn: 'PokemonsItemCuredItsBurn', frz: 'PokemonsItemDefrostedIt', slp: 'PokemonsItemWokeItUp' } as Record<string, string>)[status];
      if (!message) throw new Error(`battle: ${item} cured an unknown status ${status}`);
      yield* this.say(this.text.get(message, [name, this.itemName(item)], this.who(target)));
    } else if (parts.includes('[msg]') && status === 'slp') yield* this.say(this.text.get('PokemonWokeUp', [name], this.who(target)));
    else if (parts.includes('[msg]') && status === 'frz') yield* this.say(this.text.get('PokemonThawedOut', [name], this.who(target)));
    else if (!parts.includes('[silent]')) this.stub(parts);
  }

  /** An ability announced (decomp: its switch-in or trigger subscript). */
  private *abilityLine(side: Side, ability: string, extra: string, from: string | undefined, parts: string[]): Tick {
    const name = side.view.name;
    if (from === 'ability: Trace') {
      const of = this.ofSide(parts);
      yield* this.say(this.text.get('PokemonTracedPokemonsAbility', [name, of.view.name, this.abilityName(ability)], this.pair(side, of)));
    } else if (from === 'move: Role Play') {
      const of = this.ofSide(parts);
      yield* this.say(this.text.get('PokemonCopiedPokemonsAbility', [name, of.view.name, this.abilityName(ability)], this.pair(side, of)));
    } else if (from === 'move: Worry Seed' || from === 'move: Skill Swap') yield* this.say(this.text.get(from === 'move: Worry Seed' ? 'PokemonAcquiredAbility' : 'PokemonSwappedAbilitiesWithItsTarget', [name, this.abilityName(ability)], this.who(side))); else if ((ability === 'Intimidate' || ability === 'Speed Boost') && extra === 'boost') this.abilityStat = { user: side, ability };
    else if (ability === 'Pressure') yield* this.say(this.text.get('PokemonIsExertingItsAbility', [name, this.abilityName(ability)], this.who(side)));
    else if (ability === 'Mold Breaker') yield* this.say(this.text.get('PokemonWasAbility', [name, this.abilityName(ability)], this.who(side)));
    else if (ability === 'Anticipation') yield* this.say(this.text.get('PokemonsAbilityMadeItShudder', [this.abilityName(ability), name], this.who(side)));
    else this.stub(parts, 'ability announcement not shown yet');
  }

  /** A battler that cannot move this turn (decomp: the check's subscript). */
  private *cantLine(target: Side, reason: string, move: string): Tick {
    const name = target.view.name;
    const say = (message: string, vars: string[]) => this.say(this.text.get(message, vars, this.who(target)));
    const status = CANT_MESSAGES[reason];
    if (status) yield* say(status, [name]);
    else if (reason === 'flinch') yield* say('PokemonFlinched', [name]);
    else if (reason === 'recharge') yield* say('PokemonMustRecharge', [name]);
    else if (reason === 'Attract') yield* say('PokemonIsImmobilizedByLove', [name]);
    else if (reason === 'move: Taunt') yield* say('PokemonCantUseMoveAfterTheTaunt', [name, this.moveName(move)]);
    else if (reason === 'Disable') yield* say('PokemonsMoveIsDisabled', [name, this.moveName(move)]);
    else if (reason === 'move: Imprison') yield* say('PokemonCantUseTheSealedMove', [name, this.moveName(move)]);
    else if (reason === 'Focus Punch') yield* say('PokemonLostItsFocusAndCouldntMove', [name]);
    else this.stub(['', 'cant', 'P', reason]);
  }

  /** The weather's start, upkeep and end lines (decomp effect scripts, subscript_weather_continues, _*_end). */
  private static readonly WEATHER: Record<string, [start: string, upkeep: string, end: string, ability: string]> = {
    RainDance: ['ItStartedToRain', 'RainContinuesToFall', 'TheRainStopped', 'PokemonsAbilityMadeItRain'],
    SunnyDay: ['TheSunlightTurnedHarsh', 'TheSunlightIsStrong', 'TheSunlightFaded', 'PokemonsAbilityIntensifiedTheSunsRays'],
    Sandstorm: ['ASandstormBrewed', 'TheSandstormRages', 'TheSandstormSubsided', 'PokemonsAbilityWhippedUpASandstorm'],
    Hail: ['ItStartedToHail', 'HailContinuesToFall', 'TheHailStopped', 'PokemonsAbilityWhippedUpAHailstorm'],
  };

  /** Side conditions: the player's side's message and the foe's (decomp TAG_NONE_SIDE_CONSCIOUS), start and end. */
  private static readonly SIDE_START: Record<string, [string, string]> = {
    Spikes: ['SpikesWereScatteredAllAroundYourTeamsFeet', 'SpikesWereScatteredAllAroundTheFeetOfTheFoesTeam'],
    'Toxic Spikes': ['PoisonSpikesWereScatteredAllAroundYourTeamsFeet', 'PoisonSpikesWereScatteredAllAroundTheEnemyTeamsFeet'],
    'Stealth Rock': ['PointedStonesFloatInTheAirAroundYourTeam', 'PointedStonesFloatInTheAirAroundYourFoesTeam'],
    Reflect: ['MoveRaisedYourTeamsDefense', 'TheFoesMoveRaisedItsTeamsDefense'],
    'Light Screen': ['MoveRaisedYourTeamsSpecialDefense', 'TheFoesMoveRaisedItsTeamsSpecialDefense'],
    Mist: ['YourTeamBecameShroudedInMist', 'TheFoesTeamBecameShroudedInMist'],
    Safeguard: ['YourTeamBecameCloakedInAMysticalVeil', 'TheFoesTeamBecameCloakedInAMysticalVeil'],
    Tailwind: ['TheTailwindBlewFromBehindYourTeam', 'TheTailwindBlewFromBehindTheFoe'],
    'Lucky Chant': ['TheLuckyChantShieldedYourTeamFromCriticalHits', 'TheLuckyChantShieldedTheFoeFromCriticalHits'],
  };
  private static readonly SIDE_END: Record<string, [string, string]> = {
    // A grounded Poison type absorbs them (decomp subscript_hazards_check).
    'Toxic Spikes': ['ThePoisonSpikesDisappearedFromAroundYourTeamsFeet', 'ThePoisonSpikesDisappearedFromAroundTheEnemyTeamsFeet'],
    Reflect: ['YourTeamsMoveEffectWoreOff', 'TheFoesMoveEffectWoreOff'],
    'Light Screen': ['YourTeamsMoveEffectWoreOff', 'TheFoesMoveEffectWoreOff'],
    Mist: ['YourTeamsMoveEffectWoreOff', 'TheFoesMoveEffectWoreOff'],
    Safeguard: ['YourTeamIsNoLongerProtectedBySafeguard', 'TheFoeIsNoLongerProtectedBySafeguard'],
    Tailwind: ['YourTeamsTailwindPeteredOut', 'TheFoesTailwindPeteredOut'],
    'Lucky Chant': ['YourTeamsLuckyChantWoreOff', 'TheFoesLuckyChantWoreOff'],
  };
  /** The charging turn's line by move (decomp subscript_show_prepared_message). */
  private static readonly PREPARE: Record<string, string> = {
    Bounce: 'PokemonSprangUp', Dig: 'PokemonBurrowedItsWayUnderTheGround', Dive: 'PokemonHidUnderwater', Fly: 'PokemonFlewUpHigh', 'Solar Beam': 'PokemonAbsorbedLight',
    'Skull Bash': 'PokemonTuckedInItsHead', 'Razor Wind': 'PokemonWhippedUpAWhirlwind', 'Sky Attack': 'PokemonBecameCloakedInAHarshLight', 'Shadow Force': 'PokemonVanishedInstantly',
  };

  /** Every other protocol line: the decomp's message for it, or a logged stub. */
  private *effectLine(parts: string[], from: string | undefined): Tick {
    const [, cmd = '', a = '', b = '', c = ''] = parts;
    const silent = parts.includes('[silent]');
    const effect = (x: string) => x.replace(/^(move|ability|item): /, '');
    const plain = (name: string, vars: string[] = []) => this.say(this.text.get(name, vars));
    const sided = (side: Side, name: string, vars: string[]) => this.say(this.text.get(name, vars, this.who(side)));
    const user = () => this.sideOf(this.lastMove?.side ?? 'p2');
    switch (cmd) {
      case '-activate': {
        const t = this.sideOf(a);
        const e = effect(b);
        if (e === 'confusion') yield* sided(t, 'PokemonIsConfused', [t.view.name]);
        else if (e === 'Protect' || e === 'Detect') yield* sided(t, 'PokemonProtectedItself', [t.view.name]);
        else if (e === 'Substitute' && parts.includes('[damage]')) yield* sided(t, 'TheSubstituteTookDamageForPokemon', [t.view.name]);
        else if (e === 'Bind' || e === 'Wrap') {
          const src = this.ofSide(parts);
          yield* this.say(this.text.get(e === 'Bind' ? 'PokemonWasSqueezedByPokemon' : 'PokemonWasWrappedByPokemon', [t.view.name, src.view.name], this.pair(t, src)));
        } else if (e === 'Clamp') {
          const src = this.ofSide(parts);
          yield* this.say(this.text.get('PokemonClampedPokemon', [t.view.name, src.view.name], this.pair(src, t)));
        } else if (e === 'Fire Spin' || e === 'Whirlpool') yield* sided(t, 'PokemonWasTrappedInAVortex', [t.view.name]);
        else if (e === 'Sand Tomb') yield* sided(t, 'PokemonWasTrappedBySandTomb', [t.view.name]);
        else if (e === 'Magma Storm') yield* sided(t, 'PokemonBecameTrappedBySwirlingMagma', [t.view.name]);
        else if (e === 'Attract') {
          const of = this.ofSide(parts);
          yield* this.say(this.text.get('PokemonIsInLoveWithPokemon', [t.view.name, of.view.name], this.pair(t, of)));
        } else if (e === 'Safeguard') yield* sided(t, 'PokemonIsProtectedBySafeguard', [t.view.name]);
        else if (e === 'Mist') yield* sided(t, 'PokemonIsProtectedByMist', [t.view.name]);
        else if (e === 'Bide') yield* sided(t, 'PokemonIsStoringEnergy', [t.view.name]);
        else if (e === 'Lock-On' || e === 'Mind Reader') {
          const of = this.ofSide(parts);
          yield* this.say(this.text.get('PokemonTookAimAtPokemon', [t.view.name, of.view.name], this.pair(t, of)));
        } else if (e === 'Magnitude') yield* plain('MagnitudeX', [c]);
        else if (e === 'Beat Up') yield* sided(t, 'PokemonsBeatUpAttack', [parts.find((x) => x.startsWith('[of] '))!.slice(5)]);
        else if (e === 'Endure') yield* sided(t, 'PokemonEnduredTheHit', [t.view.name]);
        else if (e === 'Feint') yield* sided(t, 'PokemonFellForTheFeint', [t.view.name]);
        else if (e === 'Struggle') yield* plain('PokemonHasNoMovesLeft', [t.view.name]);
        else if (e === 'trapped') yield* sided(t, 'PokemonCanNoLongerEscape', [t.view.name]);
        else if (e === 'Spite') yield* sided(t, 'ItReducedThePPOfPokemonsMoveByX', [t.view.name, this.moveName(c), parts[5] ?? '']);
        else if (e === 'Heal Bell') yield* plain('ABellChimed');
        else this.stub(parts);
        return;
      }
      case '-start': {
        const t = this.sideOf(a);
        const e = effect(b);
        const n = t.view.name;
        if (silent) return;
        if (e === 'confusion') yield* sided(t, parts.includes('[fatigue]') ? 'PokemonBecameConfusedDueToFatigue' : 'PokemonBecameConfused', [n]);
        else if (e === 'Substitute') yield* sided(t, 'PokemonMadeASubstitute', [n]);
        else if (e === 'Focus Energy') yield* sided(t, 'PokemonIsGettingPumped', [n]);
        else if (e === 'Foresight' || e === 'Miracle Eye') yield* this.say(this.text.get('PokemonIdentifiedPokemon', [user().view.name, n], this.pair(user(), t)));
        else if (e === 'Taunt') yield* sided(t, 'PokemonFellForTheTaunt', [n]);
        else if (e === 'Encore') yield* sided(t, 'PokemonReceivedAnEncore', [n]);
        else if (e === 'Disable') yield* sided(t, 'PokemonsMoveWasDisabled', [n, this.moveName(c)]);
        else if (e === 'Leech Seed') yield* sided(t, 'PokemonWasSeeded', [n]);
        else if (e === 'Aqua Ring') yield* sided(t, 'PokemonSurroundedItselfWithAVeilOfWater', [n]);
        else if (e === 'Ingrain') yield* sided(t, 'PokemonPlantedItsRoots', [n]);
        else if (e === 'Future Sight' || e === 'Doom Desire') yield* sided(t, 'PokemonForesawAnAttack', [n]);
        else if (e === 'Curse' && parts.some((x) => x.startsWith('[of] '))) {
          const of = this.ofSide(parts);
          yield* this.say(this.text.get('PokemonCutItsOwnHPAndLaidACurseOnPokemon', [of.view.name, n], this.pair(of, t)));
        } else if (e === 'Yawn') {
          const of = this.ofSide(parts);
          yield* this.say(this.text.get('PokemonMadePokemonDrowsy', [of.view.name, n], this.pair(of, t)));
        } else if (e === 'Attract' && !from) yield* sided(t, 'PokemonFellInLove', [n]);
        else if (e === 'Magnet Rise') yield* sided(t, 'PokemonLevitatedOnElectromagnetism', [n]);
        else if (e === 'Heal Block') yield* sided(t, 'PokemonWasPreventedFromHealing', [n]);
        else if (/^perish\d$/.test(e)) yield* sided(t, 'PokemonsPerishCountFellToX', [n, e.slice(6)]);
        else if (/^stockpile\d$/.test(e)) yield* sided(t, 'PokemonStockpiledX', [n, e.slice(9)]);
        else if (e === 'Uproar') yield* sided(t, parts.includes('[upkeep]') ? 'PokemonIsMakingAnUproar' : 'PokemonCausedAnUproar', [n]);
        else if (e === 'Bide') yield* sided(t, 'PokemonIsStoringEnergy', [n]);
        else if (e === 'Power Trick') yield* sided(t, 'PokemonSwitchedItsAttackAndDefense', [n]);
        else if (e === 'Attract' && from?.startsWith('ability: ')) {
          const owner = this.ofSide(parts);
          yield* this.say(this.text.get('PokemonsAbilityInfatuatedPokemon', [owner.view.name, this.abilityName(from), n], this.pair(owner, t)));
        } else if (e === 'typechange') yield* sided(t, 'PokemonTransformedIntoType', [n, this.recordName('types', 'TYPE_', c)]);
        else if (e === 'Charge') yield* sided(t, 'PokemonBeganChargingPower', [n]);
        else if (e === 'Torment') yield* sided(t, 'PokemonWasSubjectedToTorment', [n]);
        else if (e === 'Imprison') yield* sided(t, 'PokemonSealedTheOpponentsMoves', [n]);
        else if (e === 'Embargo') yield* sided(t, 'PokemonCantUseItemsAnymore', [n]);
        else if (e === 'Mud Sport') yield* plain('ElectricitysPowerWasWeakened');
        else if (e === 'Water Sport') yield* plain('FirePowerWasWeakened');
        // Decomp subscript_slow_start (on entry) and subscript_absorb_and_boost_fire_type_moves (Flash Fire's first absorb).
        else if (e === 'Slow Start') yield* sided(t, 'PokemonCantGetItGoingBecauseOfItsAbility', [n, this.abilityName(e)]);
        else if (e === 'Flash Fire') yield* sided(t, 'PokemonsAbilityRaisedThePowerOfItsFireTypeMoves', [n, this.abilityName(e)]);
        else this.stub(parts);
        return;
      }
      case '-end': {
        const t = this.sideOf(a);
        const e = effect(b);
        const n = t.view.name;
        if (silent) return;
        if (e === 'confusion') yield* sided(t, 'PokemonSnappedOutOfConfusion', [n]);
        else if (e === 'Substitute') yield* sided(t, 'PokemonsSubstituteFaded', [n]);
        else if (e === 'Future Sight' || e === 'Doom Desire') yield* sided(t, 'PokemonTookTheMoveAttack', [n, this.moveName(e)]);
        else if (parts.includes('[partiallytrapped]')) yield* sided(t, 'PokemonWasFreedFromMove', [n, this.moveName(e)]);
        else if (e === 'Disable') yield* sided(t, 'PokemonIsNoLongerDisabled', [n]);
        else if (e === 'Encore') yield* sided(t, 'PokemonsEncoreEnded', [n]);
        else if (e === 'Taunt') yield* sided(t, 'PokemonsTauntWoreOff', [n, this.moveName('Taunt')]);
        else if (e === 'Bide') yield* sided(t, 'PokemonUnleashedEnergy', [n]);
        else if (e === 'Uproar') yield* sided(t, 'PokemonCalmedDown', [n]);
        else if (e === 'Stockpile') yield* sided(t, 'PokemonsStockpiledEffectWoreOff', [n]);
        else if (e === 'Power Trick') yield* sided(t, 'PokemonSwitchedItsAttackAndDefense', [n]);
        else if (e === 'Embargo') yield* sided(t, 'PokemonCanUseItemsAgain', [n]);
        else if (e === 'Heal Block') yield* sided(t, 'PokemonsMoveWoreOff', [n, this.moveName('Heal Block')]);
        // decomp subscript_magnet_rise_end: the foe's line is named differently in the bank.
        else if (e === 'Magnet Rise') yield* this.say(this.text.get(this.who(t) === 'Foe' ? 'TheElectromagnetismOfPokemonsWoreOff_Foe' : `PokemonsElectromagnetismWoreOff_${this.who(t)}`, [n]));
        // Decomp subscript_slow_start_end: the fifth turn's end.
        else if (e === 'Slow Start') yield* sided(t, 'PokemonFinallyGotItsActTogether', [n]);
        else this.stub(parts);
        return;
      }
      case '-singleturn': {
        const t = this.sideOf(a);
        const e = effect(b);
        if (e === 'Protect' || e === 'Detect') yield* sided(t, 'PokemonProtectedItself2', [t.view.name]);
        else if (e === 'Endure') yield* sided(t, 'PokemonBracedItself', [t.view.name]);
        else if (e === 'Follow Me') yield* sided(t, 'PokemonBecameTheCenterOfAttention', [t.view.name]);
        else if (e === 'Magic Coat') yield* sided(t, 'PokemonShroudedItselfWithMagicCoat', [t.view.name]);
        else if (e === 'Helping Hand') {
          // The helped battler, [of] the helper: "{helper} is ready to help {ally}!".
          const helper = this.ofSide(parts);
          yield* this.say(this.text.get('PokemonIsReadyToHelpPokemon', [helper.view.name, t.view.name], this.pair(helper, t)));
        }
        else if (e === 'Focus Punch') yield* sided(t, 'PokemonIsTighteningItsFocus', [t.view.name]);
        // Roost: the DS says nothing for the landing (the heal line follows).
        else if (e !== 'Roost') this.stub(parts);
        return;
      }
      case '-sidestart':
      case '-sideend': {
        const pair = (cmd === '-sidestart' ? BattleController.SIDE_START : BattleController.SIDE_END)[effect(b)];
        if (!pair) {
          this.stub(parts);
          return;
        }
        const message = this.ownSide(a) ? pair[0] : pair[1];
        yield* plain(message, message.includes('MoveEffectWoreOff') || message.includes('MoveRaised') ? [this.moveName(effect(b))] : []);
        return;
      }
      case '-weather': {
        if (a === 'none') {
          const w = this.weather && BattleController.WEATHER[this.weather];
          this.weather = null;
          if (w) yield* plain(w[2]);
          return;
        }
        if (a === 'Fog') {
          this.weather = a;
          if (!parts.includes('[upkeep]')) yield* plain('TheFogIsDeep');
          return;
        }
        const w = BattleController.WEATHER[a];
        if (!w) {
          this.stub(parts);
          return;
        }
        this.weather = a;
        if (parts.includes('[upkeep]')) yield* plain(w[1]);
        else if (from?.startsWith('ability: ')) {
          const of = this.ofSide(parts);
          yield* sided(of, w[3], [of.view.name, this.abilityName(from)]);
        } else yield* plain(w[0]);
        return;
      }
      case '-fieldstart':
      case '-fieldend':
        if (effect(a) === 'Trick Room') yield* plain(cmd === '-fieldstart' ? 'TheDimensionsBecameDistorted' : 'TheTwistedDimensionsReturnedToNormal');
        else if (effect(a) === 'Gravity') yield* plain(cmd === '-fieldstart' ? 'GravityIntensified' : 'GravityReturnedToNormal');
        else this.stub(parts);
        return;
      case '-message':
        if (a === 'opensinnoh-defog') {
          const user = this.sideOf(b);
          yield* sided(user, 'PokemonBlewAwayTheDeepFogWithMove', [user.view.name, this.moveName(c)]);
        } else this.stub(parts);
        return;
      case '-fieldactivate':
        if (effect(a) === 'Perish Song') yield* plain('AllPokemonHearingTheSongWillFaintInThreeTurns');
        else if (effect(a) === 'Pay Day') yield* plain('CoinsScatteredEverywhere');
        else this.stub(parts);
        return;
      case '-copyboost': {
        // Psych Up: the user copies the target's stages.
        const t = this.sideOf(a);
        const of = this.sideOf(b);
        yield* this.say(this.text.get('PokemonCopiedPokemonsStatChanges', [t.view.name, of.view.name], this.pair(t, of)));
        return;
      }
      case '-setboost':
        if (from === 'move: Belly Drum') yield* sided(this.sideOf(a), 'PokemonCutItsOwnHPAndMaximizedItsAttack', [this.sideOf(a).view.name]);
        else this.stub(parts);
        return;
      case '-transform': {
        // Decomp subscript_transform_into_target: BtlCmd_Transform copies the target's species, form and shininess (its
        // look, when it is itself transformed) and its gender, which the sprite keeps until the battler leaves.
        const t = this.sideOf(a);
        const of = this.sideOf(b);
        const look = of.view.look ?? { species: of.view.species, form: of.view.form, shiny: of.view.shiny, gender: of.view.gender };
        t.view.look = { ...look, gender: of.view.gender };
        const species = this.deps.registries.species.get(look.species)!.name;
        yield* this.say(this.text.get('PokemonTransformedIntoPokemon', [t.view.name, species], `${this.who(t)}Ally`));
        return;
      }
      case '-endability':
        yield* sided(this.sideOf(a), 'PokemonsAbilityWasSuppressed', [this.sideOf(a).view.name]);
        return;
      case '-swapboost': {
        const t = this.sideOf(a);
        const message = from === 'move: Power Swap' ? 'PokemonSwitchedAllAttackChangesWithItsTarget' : from === 'move: Guard Swap' ? 'PokemonSwitchedAllDefenseChangesWithItsTarget' : from === 'move: Heart Swap' ? 'PokemonSwitchedStatChangesWithTheTarget' : null;
        if (message) yield* sided(t, message, [t.view.name]);
        else this.stub(parts);
        return;
      }
      case '-hitcount':
        yield* plain('HitXTimes', [b]);
        return;
      case '-nothing':
        yield* plain('ButNothingHappened');
        return;
      case '-notarget':
        yield* plain('ButThereWasNoTarget');
        return;
      case '-ohko':
        yield* plain('ItsAOneHitKO');
        return;
      case '-clearallboost':
        yield* plain('AllStatChangesWereEliminated');
        return;
      case '-cureteam':
        if (from === 'move: Aromatherapy') yield* plain('ASoothingAromaWaftedThroughTheArea');
        else if (from === 'move: Heal Bell') yield* plain('ABellChimed');
        else this.stub(parts);
        this.sideOf(a).view.status = 'none';
        return;
      case '-sethp': {
        yield* this.gauge(this.sideOf(a), this.lineHp(this.sideOf(a), b));
        if (!silent) yield* plain('TheBattlersSharedTheirPain');
        return;
      }
      case '-prepare': {
        const t = this.sideOf(a);
        const message = BattleController.PREPARE[b];
        if (message) yield* sided(t, message, [t.view.name]);
        else this.stub(parts);
        return;
      }
      case '-singlemove':
        // Rage's flag has no message (decomp subscript_set_rage_flag); Grudge's has.
        if (effect(b) === 'Grudge') yield* sided(this.sideOf(a), 'PokemonWantsTheFoeToBearAGrudge', [this.sideOf(a).view.name]);
        else if (effect(b) !== 'Rage') this.stub(parts);
        return;
      // The recharge turn's own line ("must recharge") comes with `cant`; hints are the sim's notes.
      case '-mustrecharge':
      case '-hint':
        return;
      default:
        this.stub(parts);
    }
  }

  private *flush(lines: string[][]): Tick {
    for (const [cmd] of lines) {
      if (cmd === '-crit') yield* this.say(this.text.get('ACriticalHit'));
      else if (cmd === '-supereffective') yield* this.say(this.text.get('ItsSuperEffective'));
      else yield* this.say(this.text.get('ItsNotVeryEffective'));
    }
  }

  /**
   * A move's animation after its "X used Y!" (decomp subscript_attack_message_and_animation): not when it
   * missed, failed or was blocked, nor on a hidden charge line. A two-turn move animates its charge turn
   * (effect chance 0) and its attack turn (1, decomp subscript_charge_move_cleanup). A multi-hit move plays
   * it again before each later hit (`hitAnims`).
   */
  private *moveAnimation(lines: string[][], at: number, user: Side): Tick {
    const line = lines[at]!;
    const move = this.data.packMove(line[3] ?? '').id;
    const targetIdent = line[4] ?? '';
    const rest: string[][] = [];
    for (let k = at + 1; k < lines.length && lines[k]![1] !== 'move'; k++) rest.push(lines[k]!);
    const prepares = rest.some((l) => l[1] === '-prepare');
    if (line.includes('[still]') && !prepares) return;
    if (line.some((x) => x.startsWith('[miss]') || x === '[notarget]')) return;
    const blocked = (l: string[]) => l[1] === '-miss' || l[1] === '-fail' || l[1] === '-immune' || l[1] === '-notarget' || (l[1] === '-activate' && /Protect|Detect/.test(l[3] ?? ''));
    if (rest.some(blocked)) return;
    // The defender: the move's (first) target; a spread move's animation reaches the defender's partner itself
    // (decomp: one animation, BATTLER_ROLE_DEFENDER_PARTNER). A move at the user's ally is friendly fire.
    const target = targetIdent ? this.sideOf(targetIdent) : this.opposite(user);
    const effectChance = !prepares && this.charged.delete(user) ? 1 : 0;
    if (prepares) this.charged.add(user);
    const hits = rest.filter((l) => l[1] === '-damage' && !l.some((x) => x.startsWith('[from]'))).length;
    this.hitAnims = hits > 1 ? { move, user, target, played: false } : null;
    // Magnitude's power is rolled per use (the sim reports the magnitude: 4–10).
    const magnitude = rest.find((l) => l[1] === '-activate' && l[3] === 'move: Magnitude');
    const power = magnitude ? [10, 30, 50, 70, 90, 110, 150][Number(magnitude[4]) - 4] : undefined;
    yield* this.animate(moveAnimation(this.deps.registries, move), move, user, target, effectChance, power);
  }

  /** A common animation on one battler (decomp PlayBattleAnimation: the battler is the animation's attacker). */
  private *statusAnimation(name: string, side: Side): Tick {
    if (!side.view.visible) return;
    const other = this.opposite(side);
    yield* this.animate(commonAnimation(this.deps.registries, name), name, side, other);
  }

  /**
   * Plays a battle animation on the animation VM, one tick per DS frame, and waits for its end: the battle
   * takes the animation's real time. The Options "battle scene" off skips them (decomp
   * BattleSystem_AreAnimationsOn). A script the VM cannot fully run plays the generic hit instead (logged).
   */
  private *animate(record: BattleAnimation | null, label: string, user: Side, target: Side, effectChance = 0, power?: number): Tick {
    if (this.deps.options?.scene === false) return;
    yield* this.playAnim(record, label, user, target, effectChance, power);
  }

  /** Runs a battle animation whatever the battle scene option (`animate` asks it); `each` runs every tick beside it. */
  private *playAnim(record: BattleAnimation | null, label: string, user: Side, target: Side, effectChance = 0, power?: number, each?: () => void): Tick {
    if (!record) {
      this.deps.log.stub(`anim:${label}`, 'no animation script in the packs: the generic hit plays');
      return;
    }
    // Friendly fire (decomp JumpIfFriendlyFire: the attacker and the defender on one side) takes the script's other arm.
    const friendlyFire = (user.id & 1) === (target.id & 1);
    const missing = animSupport(record, this.deps.registries, friendlyFire);
    if (missing.length) {
      this.deps.log.stub(`anim:${label}`, `the animation needs ${missing.join(', ')}: the generic hit plays`);
      return;
    }
    // Every battler by its DS id; in doubles an empty slot (nobody out, a battler that fainted) is none.
    const battler = (s: Side) => {
      if (this.doubles && !s.view.visible && s !== user && s !== target) return null;
      // A transformed battler's picture is its target's (BattlerView.look).
      const look = s.view.look ?? s.mon;
      const sprites = this.deps.registries.pokemonSprites.get(look.species);
      const form = sprites?.forms[look.form] ?? sprites?.forms[0];
      const face = s.id & 1 ? form?.front : form?.back;
      return { species: look.species, form: look.form, height: face?.yOffset ?? 0, visible: s.view.visible };
    };
    const weather = ({ raindance: 'rain', sandstorm: 'sandstorm', sunnyday: 'sun', hail: 'hail' } as const)[this.sim.field.weather as 'raindance'] ?? null;
    const vm = new AnimVm(record.code, {
      registries: this.deps.registries,
      attacker: user.id,
      defender: target.id,
      battlers: this.battlers.map(battler),
      doubles: this.doubles,
      effectChance,
      ...(power !== undefined ? { power } : {}),
      weather,
      seed: (this.deps.seed + Math.imul(++this.animCount, 0x9e3779b1)) >>> 0,
      log: this.deps.log,
      ...(this.animSound ? { sound: this.animSound } : {}),
    });
    this.anim = vm;
    while (!vm.done) {
      vm.tick();
      each?.();
      yield;
    }
    this.anim = null;
  }

  /** The game's sound for animations (BattleDeps.sound), when it has the animation calls. */
  private get animSound(): AnimSound | null {
    const s = this.deps.sound;
    if (!s?.se || !s.stopSe || !s.sePlaying || !s.cry || !s.cryPlaying || !s.stopCries) return null;
    return { se: s.se, stopSe: s.stopSe, sePlaying: s.sePlaying, cry: s.cry, cryPlaying: s.cryPlaying, stopCries: s.stopCries };
  }

  /** The DS's generic hit: the target blinks and shakes (the move animations play separately). */
  private *hit(target: Side): Tick {
    for (let t = 0; t < 12; t++) {
      target.view.visible = t % 4 >= 2;
      target.view.dx = t % 4 < 2 ? (t % 2 ? 2 : -2) : 0;
      yield;
    }
    target.view.visible = true;
    target.view.dx = 0;
  }

  private *gauge(side: Side, to: number): Tick {
    const max = side.view.maxHp;
    const from = side.view.hp;
    while (side.view.hp !== to || side.hpTemp !== gaugeTemp(max, to, HP_PIXELS)) {
      const r = gaugeFrame(max, from, to, HP_PIXELS, side.hpTemp);
      side.hpTemp = r.temp;
      side.view.hp = r.shown;
      yield;
    }
  }

  private *faint(side: Side): Tick {
    for (let k = 8; k <= 80; k += 8) {
      side.view.dy = k;
      side.view.clip = k;
      yield;
    }
    side.view.visible = false;
    side.view.healthbox.visible = false;
    yield* this.say(this.text.get('PokemonFainted', [side.view.name], this.who(side)));
    // Decomp: exp per defeated foe, from that foe's participants (the player's party only, never the partner's).
    if (side.id & 1) yield* this.grantExp(side);
  }

  /** The player's Pokémon `index` came in: it takes part against every foe out now (decomp the exp masks). */
  private joinFoes(index: number): void {
    for (const [b, set] of this.participants.entries()) if (b & 1) set.add(index);
  }

  /** Foe `side` came in: its exp participants start over with the player's Pokémon out (sideGetExpMask). */
  private newFoe(side: Side): void {
    const set = this.participants[side.id]!;
    set.clear();
    for (const i of this.playerOut()) set.add(i);
  }

  /** A switch-in; `dragged`: forced out by Roar or Whirlwind (no recall or withdraw line, the new one just appears). */
  private *switchIn(ident: string, dragged: boolean): Tick {
    const b = this.battlerOf(ident);
    const own = this.isPlayer(b);
    const ours = (b & 1) === 0;
    const team = this.teams[b]!;
    const sim = this.sim[this.simSideOf(b)]!.active[this.simPos(b)] as SimMon;
    const index = team.sims.indexOf(sim);
    if (index < 0) throw new Error('battle: switched in an unknown Pokémon');
    const side = this.battlers[b]!;
    if (dragged) {
      side.view.visible = false;
      side.view.healthbox.visible = false;
      team.active = index;
      Object.assign(side, this.side(team.party[index]!, b));
      if (own) this.joinFoes(index);
      else if (!ours) {
        this.newFoe(side);
        this.revealFoe(side);
        this.foeTimesDamaged = 0;
        this.foeMessageFlags.clear();
      }
      yield* this.appear([side]);
      yield* this.slideHealthboxes([side], ours ? 1 : -1);
      if (ours) this.onSwitchIn(b);
      return;
    }
    if (ours && side.view.visible) yield* this.recall(side);
    if (!ours && side.view.visible) {
      // The AI switched by choice: "{class} {name} withdrew X!" before the next one comes.
      yield* this.say(this.text.get('TrWithdrewPokemon', [...this.trainerVars(this.trainers[b]!), side.view.name]));
      side.view.visible = false;
      side.view.healthbox.visible = false;
    }
    team.active = index;
    Object.assign(side, this.side(team.party[index]!, b));
    if (ours) {
      if (own) this.joinFoes(index);
      yield* this.sendOut([side], false, this.sendOutMessage(side));
      this.foeHpAtSwitch = this.enemy.view.hp;
    } else {
      // Decomp: the exp participants start over with the new foe (sideGetExpMask), keeping the one out.
      this.newFoe(side);
      // decomp BattleSystem_InitBattleMon clears timesDamaged and trainerMessageFlags.
      this.foeTimesDamaged = 0;
      this.foeMessageFlags.clear();
      yield* this.foeSendOut([side], false);
    }
  }

  /** A battler came in: the AI forgets what it knew (decomp BattleAI_ClearKnown*), Amulet Coin doubles the prize. */
  private onSwitchIn(battler: number): void {
    aiForgetBattler(this.memory, battler);
    const team = this.teams[battler]!;
    const mon = team.party[team.active]!;
    if (this.dex.holdEffect(mon.heldItem).holdEffect === 'MONEY_UP') this.prizeMul = 2;
  }

  private revealFoe(side: Side): void {
    this.onSwitchIn(side.id);
    const species = side.mon.species;
    if (!this.seen.includes(species)) this.seen.push(species);
  }

  /** The victory music, once (the game picks it: BattleDeps.sound). */
  private victory(): void {
    if (this.victoryPlayed) return;
    this.victoryPlayed = true;
    this.deps.sound?.victory();
  }

  /**
   * Decomp BtlCmd_CalcExpGain / the get-exp task: the foe's exp split between the Pokémon that fought it
   * and Exp. Share holders, the boosts (Lucky Egg, trainer battle, outsider), EVs, then level-ups with their
   * moves, one Pokémon at a time.
   */
  private *grantExp(defeated: Side): Tick {
    // BATTLE_TYPE_NO_EXPERIENCE includes the tutorial's type and BATTLE_TYPE_FRONTIER.
    if (this.setup.kind === 'tutorial' || this.frontier) return;
    const party = this.own.party;
    const foe = defeated.mon;
    const foeData = this.dex.form(foe.species, foe.form);
    // Progression is played after simulation; eligibility was captured at the native faint event.
    // Applying level-up stats before subsequent moves still needs a sim pause/resume boundary (E3).
    const alive = this.expAlive.get(this.activeSim(this.teams[defeated.id]!));
    if (!alive) throw new Error('battle: foe faint has no EXP eligibility snapshot');
    this.own.sims.forEach((s, i) => s && this.pullSim(this.own, i));
    // A frontier battle's enemy party comes back too (the Arcade's SWAP_MONS keeps its Pokémon's held items from it).
    if (this.frontier) this.foe.sims.forEach((s, i) => s && this.pullSim(this.foe, i));
    const fought = [...this.participants[defeated.id]!].filter((i) => alive.has(i));
    const holders = party.map((_, i) => i).filter((i) => alive.has(i) && this.dex.holdEffect(party[i]!.heldItem).holdEffect === 'EXP_SHARE');
    if (!fought.length) return;
    // Decomp SEQ_GET_EXP_START: the wild victory music once the foe has fainted (exp follows a faint); with two
    // wild Pokémon, once both have.
    if (!this.trainer && this.foes().every((f) => this.activeSim(this.teams[f.id]!).hp === 0)) this.victory();
    const { gained, shared } = expShares(foeData.baseExp, foe.level, fought.length, holders.length);
    for (let i = 0; i < party.length; i++) {
      const mon = party[i]!;
      if (!fought.includes(i) && !holders.includes(i)) continue;
      if (mon.level >= 100) continue;
      const player = this.deps.player;
      const outsider = mon.otId !== player.trainerId || mon.otName !== player.name || mon.otGender !== player.gender;
      const base = (fought.includes(i) ? gained : 0) + (holders.includes(i) ? shared : 0);
      const exp = expGain(base, { luckyEgg: this.dex.holdEffect(mon.heldItem).holdEffect === 'EXP_UP', trainerBattle: (this.battleType & BATTLE_TYPE.TRAINER) !== 0, outsider: outsider ? (mon.language ?? ENGLISH) === (player.language ?? this.dex.language) ? 'same-language' : 'other-language' : false });
      gainEvs(this.dex, mon, foeData.evYield);
      const name = this.nameOf(mon);
      yield* this.say(this.text.get(outsider ? 'PokemonGainedABoostedExpPoints' : 'PokemonGainedExpPoints', [name, String(exp)]));
      const before = { level: mon.level, maxHp: mon.stats.hp };
      const levels = addExp(this.dex, mon, exp);
      if (levels.length) this.levelled.add(i);
      // The sim ran the whole turn: the HP pulled is the turn's end. The rest of the turn's lines show HP without the
      // level-up's gain, so it is added to them (lineHp).
      const sim = this.own.sims[i]!;
      if (mon.hp && mon.stats.hp !== before.maxHp) this.levelHp.set(sim, (this.levelHp.get(sim) ?? 0) + mon.stats.hp - before.maxHp);
      // The gauges of the battler showing it (doubles: either of the player's).
      const onScreen = this.playerBattlers().map((b) => this.battlers[b]!).find((x) => this.teams[x.id]!.active === i) ?? null;
      const table = this.dex.expTable(this.dex.form(mon.species, mon.form).growthRate);
      let level = before.level;
      for (const up of [...levels, null]) {
        if (onScreen) yield* this.expGauge(onScreen, level, up ? table[up.level]! : mon.exp, table);
        if (!up) break;
        level = up.level;
        mon.friendship = levelUpFriendship(mon.friendship, bare(mon.ball) === 'ITEM_LUXURY_BALL', this.dex.holdEffect(mon.heldItem).holdEffect === 'FRIENDSHIP_UP');
        if (onScreen) {
          // Decomp: curHP += the new max HP − the old, from the HP shown now (the sim's is the end of the turn's).
          const stats = calcStats(this.dex.form(mon.species, mon.form).baseStats, level, mon.ivs, mon.evs, this.dex.nature(mon.pid));
          onScreen.view.level = level;
          const hp = onScreen.view.hp ? onScreen.view.hp + stats.hp - onScreen.view.maxHp : 0;
          onScreen.view.maxHp = stats.hp;
          onScreen.view.hp = hp;
          onScreen.hpTemp = gaugeTemp(stats.hp, hp, HP_PIXELS);
          onScreen.view.exp = { into: 0, span: (table[level + 1] ?? table[level]!) - table[level]! };
          onScreen.expTemp = 0;
        }
        yield* this.say(this.text.get('PokemonGrewToLevel', [name, String(level)]));
        for (const learned of up.moves) {
          const move = this.move(learned.move);
          if (learned.result === 'learned') yield* this.say(this.text.get('PokemonLearnedMove', [name, move.name]));
          else if (learned.result === 'full') yield* this.learnPrompt(i, move);
        }
      }
      this.pushSim(this.own, i, false);
    }
  }

  private *expGauge(shown: Side, level: number, toExp: number, table: number[]): Tick {
    const base = table[level]!;
    const span = (table[level + 1] ?? base) - base;
    if (!span) return;
    const view = shown.view;
    const to = Math.min(span, toExp - base);
    const from = view.exp!.into;
    while (view.exp!.into !== to) {
      const r = gaugeFrame(span, from, to, EXP_PIXELS, shown.expTemp);
      shown.expTemp = r.temp;
      view.exp = { into: r.shown, span };
      yield;
    }
  }

  /**
   * A level-up move with four known (decomp battle_script.c SEQ_GET_EXP_WANTS_TO_LEARN_MOVE_PRINT …): "X wants to
   * learn the move Y.", "But X can't learn more than four moves.", "Make it forget another move?" YES: "Which move
   * should be forgotten?" and the forget screen; a pick: "1, 2, and… … Poof!", "X forgot how to use Z.", "And…",
   * "X learned Y!". NO, or cancelling the forget screen: "Well, then…" and "Should this Pokémon give up on learning
   * this new move?" YES: "X did not learn Y."; NO: it starts over.
   */
  private *learnPrompt(index: number, move: Move): Tick {
    const mon = this.own.party[index]!;
    const name = this.nameOf(mon);
    for (;;) {
      yield* this.say(this.text.get('PokemonWantsToLearnMove', [name, move.name]));
      yield* this.say(this.text.get('ButPokemonCantLearnMoreThanFourMoves2', [name]));
      const forget = yield* this.ask({ kind: 'learn-ask', cursor: 0, ask: 'forget' }, this.text.get('MakeItForgetAnotherMoveYesNo'));
      if (forget.kind === 'answer' && forget.yes) {
        const pick = yield* this.ask({ kind: 'learn', cursor: 0, move: this.moveView(move, move.pp, move.pp), moves: this.moveViews(mon) }, this.text.get('WhichMoveShouldBeForgotten2'));
        if (pick.kind === 'forget') {
          const old = this.move(mon.moves[pick.slot]!);
          yield* this.say(this.text.get('BattleOneTwoAndPoof'));
          yield* this.say(this.text.get('BattlePokemonForgotHowToUseMove', [name, old.name]));
          yield* this.say(this.text.get('BattleAndDotDotDot'));
          setMoveSlot(this.dex, mon, pick.slot, move.id);
          yield* this.say(this.text.get('BattlePokemonLearnedMove', [name, move.name]));
          return;
        }
      }
      yield* this.say(this.text.get('WellThen'));
      const giveUp = yield* this.ask({ kind: 'learn-ask', cursor: 0, ask: 'give-up' }, this.text.get('ShouldPokemonGiveUpOnLearningMove', [name, move.name]));
      if (giveUp.kind === 'answer' && giveUp.yes) {
        yield* this.say(this.text.get('PokemonDidNotLearnMove2', [name, move.name]));
        return;
      }
    }
  }

  /**
   * The end-of-battle subscripts (decomp subscript_battle_won / subscript_battle_lost): a trainer win shows
   * the trainer again with its defeat line and pays the prize; a loss pays the penalty and blacks out. Two enemy
   * trainers: "Player beat {Tr1} and {Tr2}!", each slides in for its own defeat line, and the prize is both
   * trainers' (decomp BtlCmd_PayPrizeMoney for TAG and TRAINER_WITH_AI_PARTNER).
   */
  private *end(): Tick {
    const player = this.deps.player.name;
    if (this.frontier) {
      yield* this.frontierEnd();
      return;
    }
    if (this.outcome === 'won' && this.trainer) {
      const beaten = this.twoTrainers ? [this.trainers[1]!, this.trainers[3]!] : [this.trainer];
      yield* this.say(this.twoTrainers ? this.text.get('PlayerBeatTr1AndTr2', [...this.trainerVars(beaten[0]), ...this.trainerVars(beaten[1])]) : this.text.get('PlayerDefeatedTr', this.trainerVars()));
      let prize = 0;
      for (const [i, trainer] of beaten.entries()) {
        // The first slides off before the second slides in, each at its own battler's spot (enemyTrainer2).
        if (i > 0 && this.enemyTrainer) {
          while (this.enemyTrainer.dx < TRAINER_OFF) {
            this.enemyTrainer.dx += TRAINER_SLIDE_STEP;
            yield;
          }
        }
        const trainerClass = this.deps.registries.trainerSprites.has(trainer.class) ? trainer.class : null;
        this.enemyTrainer = null;
        if (trainerClass) {
          const slid = { class: trainerClass, dx: TRAINER_OFF };
          if (i === 0) this.enemyTrainer = slid;
          else this.enemyTrainer2 = slid;
          while (slid.dx > 0) {
            slid.dx = Math.max(0, slid.dx - TRAINER_SLIDE_STEP);
            yield;
          }
        }
        // A double trainer (3) has two defeat lines, its two members' (decomp TRMSG_DOUBLE_BATTLE_DEFEAT_1, _2).
        const lines = this.topology === 'double' ? ['doubleBattleDefeat1', 'doubleBattleDefeat2'] : ['defeat'];
        for (const key of lines) {
          const defeat = trainer.messages[key];
          if (defeat) yield* this.say(this.text.markup(this.deps.registries.texts.get(defeat)?.text ?? '', [player]));
          else this.deps.log.stub(`battle:trainer-defeat-text:${trainer.id}`, `the trainer has no ${key} message`);
        }
        // Decomp BattleScript_CalcPrizeMoney: a double trainer pays twice; two trainers each their own.
        prize += prizeMoney(trainer.party.map((m) => m.level), trainer.classPrize, this.prizeMul) * (this.topology === 'double' ? 2 : 1);
      }
      this.money = Math.min(MONEY_MAX, this.money + prize);
      yield* this.say(this.text.get('PlayerGotMoneyForWinning', [player, String(prize)]));
    } else if (this.outcome === 'lost') {
      yield* this.say(this.text.get('PlayerIsOutOfUsablePokemon', [player]));
      const penalty = moneyPenalty(this.own.party.map((m) => m.level), this.deps.badges, this.money);
      this.money -= penalty;
      if (penalty) yield* this.say(this.text.get(this.trainer ? 'PlayerPaidOutMoneyToTheWinner' : 'PlayerDroppedMoneyInPanic', [player, String(penalty)]));
      yield* this.say(this.text.get('BlackedOutDotDotDot'));
      yield* this.say(this.text.get('PlayerBlackedOut', [player]));
    }
  }

  /** Decomp PrintForfeitMessage: "{player} forfeited the match." and the battle ends lost. */
  private *forfeit(): Tick {
    yield* this.say(this.text.get('PlayerForfeitedTheMatch', [this.deps.player.name]));
    this.forfeited = true;
    this.outcome = 'lost';
  }

  /**
   * The frontier's end (subscript_battle_won / _lost with BATTLE_TYPE_FRONTIER): a win shows "Player defeated {Tr}!"
   * (two trainers: both) and each trainer's defeat line (FRONTIER_TRAINER_MESSAGES 3t + 2), no prize; a loss recalls
   * the foes, slides the trainer in for its win line (3t + 1), no money and no blackout; a forfeit has said its line.
   */
  private *frontierEnd(): Tick {
    if (this.forfeited || (this.outcome !== 'won' && this.outcome !== 'lost')) return;
    const beaten = this.twoTrainers ? [this.trainers[1]!, this.trainers[3]!] : [this.trainer!];
    const won = this.outcome === 'won';
    if (won) yield* this.say(this.twoTrainers ? this.text.get('PlayerBeatTr1AndTr2', [...this.trainerVars(beaten[0]), ...this.trainerVars(beaten[1])]) : this.text.get('PlayerDefeatedTr', this.trainerVars()));
    else for (const f of this.foes()) f.view.visible = false;
    for (const [i, trainer] of beaten.entries()) {
      if (i > 0 && this.enemyTrainer) {
        while (this.enemyTrainer.dx < TRAINER_OFF) {
          this.enemyTrainer.dx += TRAINER_SLIDE_STEP;
          yield;
        }
      }
      const trainerClass = this.deps.registries.trainerSprites.has(trainer.class) ? trainer.class : null;
      this.enemyTrainer = null;
      if (trainerClass) {
        const slid = { class: trainerClass, dx: TRAINER_OFF };
        if (i === 0) this.enemyTrainer = slid;
        else this.enemyTrainer2 = slid;
        while (slid.dx > 0) {
          slid.dx = Math.max(0, slid.dx - TRAINER_SLIDE_STEP);
          yield;
        }
      }
      yield* this.say(this.frontierMessage(trainer, won ? 2 : 1));
    }
  }

  /** A frontier trainer's line (TEXT_BANK_FRONTIER_TRAINER_MESSAGES 3t + kind: 1 its win, 2 its defeat). */
  private frontierMessage(trainer: Trainer, kind: 1 | 2): string {
    const f = this.frontier!.get(trainer);
    if (!f) throw new Error(`battle: ${trainer.id} is not a frontier trainer`);
    const tables = newGameRecord(this.deps.registries).frontier;
    const bank = tables && this.deps.registries.textBanks.get(tables.trainerMessages);
    const id = bank?.messages[f.id * 3 + kind];
    const text = id && this.deps.registries.texts.get(id);
    if (!text) throw new Error(`battle: no frontier message ${f.id * 3 + kind}`);
    return this.text.markup(text.text, [this.deps.player.name]);
  }

  private *exit(): Tick {
    for (let t = 1; t <= FADE_OUT; t++) {
      this.fade = t / FADE_OUT;
      yield;
    }
    this.own.sims.forEach((s, i) => s && this.pullSim(this.own, i));
    // The tutorial's party is the counterpart's: the player's comes back untouched.
    const party = this.setup.kind === 'tutorial' ? this.deps.party : this.own.party;
    const levelled = this.setup.kind === 'tutorial' ? [] : [...this.levelled].sort((a, b) => a - b);
    // A roamer's HP and status go back to the field (decomp RoamerAfterBattle_UpdateRoamers reads the enemy party).
    const roamer = this.battleType === BATTLE_TYPE_ROAMER ? this.roamerAfter() : {};
    this.result = { outcome: this.outcome!, turns: this.turns, ballsThrown: this.ballsThrown, party, money: this.money, bag: this.bag, caught: this.caught, seen: this.seen, levelled, ...roamer, ...(this.safari ? { safariBalls: this.safari.balls } : {}), ...(this.frontier ? { enemyParty: this.foe.party } : {}) };
    for (;;) yield;
  }

  // ---------- bag, party and catching ----------

  /** Waits on the bag or party sheet (the game hosts it): the pick, or null when it was cancelled. */
  private *sheet(prompt: Extract<BattlePrompt, { kind: 'bag' | 'party' }>): Generator<void, BattleChoice | null, void> {
    this.answer = null;
    this.cancelled = false;
    this.prompt = prompt;
    while (!this.answer && !this.cancelled) yield;
    const answer = this.answer;
    this.answer = null;
    this.cancelled = false;
    this.prompt = null;
    return answer;
  }

  /**
   * Decomp subscript_replace_fainted: in a wild battle "Use next Pokémon?" (NO tries to run: away, or "Can't
   * escape!" and the party), then the party, which cannot be cancelled. Null when the player got away.
   */
  private *replacement(): Generator<void, number | null, void> {
    if (isWildKind(this.setup.kind)) {
      const answer = yield* this.ask({ kind: 'next', cursor: 0 }, this.text.get('UseNextPokemonYesNo'));
      if (answer.kind === 'switch') return answer.slot;
      if (answer.kind === 'run') {
        if (this.escapes()) {
          yield* this.say(this.text.get('GotAwaySafely'));
          this.outcome = 'fled';
          return null;
        }
        yield* this.say(this.text.get('CantEscape'));
      }
    }
    for (;;) {
      const picked = yield* this.sheet({ kind: 'party', forced: true });
      if (picked?.kind === 'switch') return picked.slot;
    }
  }

  /**
   * Decomp subscript_replace_fainted in SHIFT style (BattleControllerPlayer_ReplaceFainted): the trainer's next
   * Pokémon is announced and the player may switch first (YES: the party, which can be cancelled), before the
   * foe's send-out. Not in SET style, nor in doubles (they force SET), nor when the player has no other Pokémon
   * that can fight (BattleSystem_AnyReplacementMons).
   */
  private *shiftOffer(next: Pokemon): Tick {
    if ((this.deps.options?.style ?? 'shift') !== 'shift' || this.doubles) return;
    if (!this.own.party.some((_, i) => this.canSendOut(i))) return;
    const answer = yield* this.ask({ kind: 'shift', cursor: 0 }, this.text.get('WillYouSwitchYourPokemon', [...this.trainerVars(), this.nameOf(next), this.deps.player.name]));
    const pick = answer.kind === 'party' ? yield* this.sheet({ kind: 'party', forced: false }) : answer;
    // The sim has no shift: the player's Pokémon is switched in directly, its lines played with the foe's send-out.
    if (pick?.kind === 'switch') this.sim.actions.switchIn(this.simMon(pick.slot) as never, 0);
  }

  /**
   * Decomp BattleSystem_CheckTrainerMessage, before each turn's commands in trainer singles (after the intro and
   * at every turn's end): the first line that applies and that the trainer has, each once (the first damage once
   * a battle; the others once per Pokémon sent out), then subscript_trainer_message: the trainer slides in, says
   * it (A/B or 60 frames), slides out. Never in doubles (the routine returns at once for them).
   */
  private *trainerMessage(): Tick {
    const t = this.trainer;
    if (!t || this.doubles) return;
    const foe = this.activeSim(this.foe);
    const alive = this.foe.sims.filter((x) => x && x.hp > 0).length;
    const half = foe.hp <= Math.floor(foe.maxhp / 2);
    const flags = this.foeMessageFlags;
    let key: string | null = null;
    if (this.foeTimesDamaged === 1 && !this.firstDamageShown && t.messages.firstDamage) {
      this.firstDamageShown = true;
      key = 'firstDamage';
    } else if (!flags.has('half') && half && t.messages.activeBattlerHalfHp) key = 'activeBattlerHalfHp';
    else if (!flags.has('last') && alive === 1 && t.messages.lastBattler) key = 'lastBattler';
    else if (!flags.has('lastHalf') && alive === 1 && half && t.messages.lastBattlerHalfHp) key = 'lastBattlerHalfHp';
    if (!key) return;
    flags.add({ activeBattlerHalfHp: 'half', lastBattler: 'last', lastBattlerHalfHp: 'lastHalf' }[key] ?? key);
    const text = this.deps.registries.texts.get(t.messages[key]!);
    if (!text) throw new Error(`battle: missing trainer text ${t.messages[key]}`);
    const trainerClass = this.deps.registries.trainerSprites.has(t.class) ? t.class : null;
    if (trainerClass) {
      this.enemyTrainer = { class: trainerClass, dx: TRAINER_OFF };
      while (this.enemyTrainer.dx > TRAINER_MESSAGE_DX) {
        this.enemyTrainer.dx = Math.max(TRAINER_MESSAGE_DX, this.enemyTrainer.dx - TRAINER_SLIDE_STEP);
        yield;
      }
    }
    this.startMessage(this.text.markup(text.text, [this.deps.player.name]));
    while (!this.printer!.done) {
      this.printStep();
      yield;
    }
    yield* this.waitButtonAB(TRAINER_MESSAGE_WAIT);
    if (this.enemyTrainer) {
      while (this.enemyTrainer.dx < TRAINER_OFF) {
        this.enemyTrainer.dx += TRAINER_SLIDE_STEP;
        yield;
      }
      this.enemyTrainer = null;
    }
  }

  /**
   * Decomp LoadRecallMessage: in singles by the share of the foe's HP lost since this Pokémon came in, in doubles
   * always "come back"; then it returns to its ball.
   */
  private *recall(side: Side): Tick {
    const hpTemp = this.foeHpAtSwitch;
    const percent = hpTemp ? Math.floor(((hpTemp - this.enemy.view.hp) * 100) / hpTemp) : 0;
    const name = this.doubles ? 'PokemonComeBack' : percent === 0 ? 'PokemonSwitchOutComeBack' : percent < 25 ? 'PokemonComeBack' : percent < 50 ? 'PokemonGoodComeBack' : percent < 75 ? 'PokemonOKComeBack' : 'PokemonEnoughGetBack';
    this.startMessage(this.text.get(name, [side.view.name]));
    const view = side.view;
    view.flash = true;
    for (let t = 7; t >= 0; t--) {
      view.scale = t / 8;
      this.printStep();
      yield;
    }
    view.visible = false;
    view.flash = false;
    view.scale = 1;
    view.healthbox.visible = false;
    yield* this.finishMessage();
  }

  /** Decomp LoadSendOutMessage: in singles by the foe's HP ×1000 (a fainted foe counts as full), in doubles always "Go!". */
  private sendOutMessage(side: Side): string {
    const foe = this.enemy.view;
    const permille = foe.hp === 0 ? 1000 : Math.floor((foe.hp * 1000) / foe.maxHp);
    const name = this.doubles ? 'GoPokemon' : permille < 100 ? 'YourFoesWeakGetEmPokemon' : permille < 325 ? 'JustALittleMoreHangInTherePokemon' : permille < 550 ? 'GoForItPokemon' : permille < 775 ? 'YoureInChargePokemon' : 'GoPokemon';
    return this.text.get(name, [side.view.name]);
  }

  /** Decomp battle_party.c's refusals: a Pokémon that is in battle, fainted or an Egg cannot go in. */
  private checkSwitch(slot: number): void {
    const mon = Number.isInteger(slot) ? this.party[slot] : undefined;
    if (!mon) throw new Error(`battle: no Pokémon in party slot ${slot + 1}`);
    if (mon.isEgg) throw new Error('battle: an Egg can’t battle');
    if (this.inBattle(slot)) throw new Error(`battle: ${this.nameOf(mon)} is already in battle`);
    // Doubles: the first battler's pick this turn (decomp: passed to the second's party menu).
    if (this.reserved.has(slot)) throw new Error(`battle: ${this.nameOf(mon)} is already coming in`);
    if (this.simMon(slot).hp === 0) throw new Error(`battle: ${this.nameOf(mon)} has no energy left to battle`);
  }

  private item(id: Id): Item {
    const rec = this.deps.registries.items.get(id);
    if (!rec) throw new Error(`battle: unknown item ${id}`);
    return rec;
  }

  /** Decomp battle_bag.c TryUseItem's refusals: the party and every box full means no ball. */
  private noRoomForBall(): boolean {
    return this.party.length >= PARTY_SIZE && this.deps.pc.free === null;
  }

  /** The bag's and the battle party's refusals (decomp TryUseItem, Pokemon_CheckItemEffects, BattleSystem_UseBagItem). */
  private checkItem(id: Id, target: number | null, move: number | undefined): void {
    const rec = this.item(id);
    if (bagCount(this.bag, id) < 1) throw new Error(`battle: no ${rec.name} in the bag`);
    if (!rec.battlePocket) throw new Error(`battle: ${rec.name} can't be used in battle`);
    if (rec.battlePocket & POCKET_BALLS) {
      if (this.noRoomForBall()) throw new Error('battle: there is no room left in the PC');
      if (this.twoWild()) throw new Error('battle: a ball cannot be used while two wild Pokémon stand (decomp BattleBag_Text_CantUseBallTwoPokemon)');
      return;
    }
    if (rec.battleUse === BATTLE_USE_ESCAPE) return;
    if (rec.battlePocket & POCKET_BATTLE_ITEMS) {
      if (!this.battleItemWorks(rec)) throw new Error(`battle: ${rec.name} won't do any good`);
      return;
    }
    const mon = target === null ? undefined : this.party[target];
    if (!mon) throw new Error(`battle: ${rec.name} needs a party Pokémon (item <item> <slot>)`);
    if (!rec.partyUse) throw new Error(`battle: ${rec.name} has no use on a Pokémon`);
    const one = rec.partyUse.flags.includes('ppRestore');
    if (one && (move === undefined || !Number.isInteger(move) || !mon.moves[move])) throw new Error(`battle: ${rec.name} restores one move's PP: which move of ${this.nameOf(mon)} (item <item> <slot> <move>)?`);
    if (!one && move !== undefined) throw new Error(`battle: ${rec.name} takes no move`);
    if (this.own.sims[target!]) this.pullSim(this.own, target!);
    if (!medicineEffect(this.dex, mon, rec.partyUse, move)) throw new Error(`battle: ${rec.name} won't have any effect on ${this.nameOf(mon)}`);
  }

  /** Two wild Pokémon stand (type 74): the bag refuses balls until one is down (decomp BattleBag_Text_CantUseBallTwoPokemon). */
  private twoWild(): boolean {
    return !this.trainer && this.foes().filter((f) => this.activeSim(this.teams[f.id]!).hp > 0).length > 1;
  }

  /** Decomp BattleSystem_UseBagItem for the battle items pocket: a stage below +6, Guard Spec. without Mist, Dire Hit without Focus Energy. */
  private battleItemWorks(rec: Item): boolean {
    const use = rec.partyUse;
    if (!use) return false;
    const sim = this.simMon(this.active);
    const stage = Object.entries(use.stages).some(([k, v]) => v && k in ITEM_STAGES && sim.boosts[ITEM_STAGES[k as keyof typeof ITEM_STAGES]] < MAX_BOOST);
    const crit = !!use.stages.crit && !sim.volatiles['focusenergy'];
    const mist = use.flags.includes('guardSpec') && !this.sim.p1.sideConditions['mist'];
    return stage || crit || mist;
  }

  /** The item choice's effect before the foe moves (decomp: items act before moves); one is taken from the bag. */
  private *useItem(id: Id, target: number | null, move: number | undefined): Tick {
    const rec = this.item(id);
    if (rec.battlePocket & POCKET_BALLS && this.trainer) {
      yield* this.blockedBall(rec);
      return;
    }
    if (!removeItem(this.bag, id, 1)) throw new Error(`battle: no ${rec.name} in the bag`);
    if (rec.battlePocket & POCKET_BALLS) yield* this.throwBall(rec);
    else if (rec.battleUse === BATTLE_USE_ESCAPE) {
      // Decomp subscript_escape_item.
      yield* this.say(this.text.get('UsedTheItem', [rec.name]));
      yield* this.say(this.text.get('GotAwaySafely'));
      this.outcome = 'fled';
    } else if (rec.battlePocket & POCKET_BATTLE_ITEMS) yield* this.battleItem(rec);
    else yield* this.medicine(rec, target!, move);
  }

  /** Decomp friendship from an item (ItemPartyParam friendship low/med/high by the 100/200 tiers), when it had an effect. */
  private itemFriendship(mon: Pokemon, rec: Item): void {
    const use = rec.partyUse!;
    const tier = mon.friendship < 100 ? 0 : mon.friendship < 200 ? 1 : 2;
    const flag = ['giveFriendshipLow', 'giveFriendshipMed', 'giveFriendshipHigh'][tier]!;
    if (use.flags.includes(flag)) mon.friendship = Math.max(0, Math.min(255, mon.friendship + use.friendship[tier]!));
  }

  /** A medicine on a party Pokémon: the party and the sim change, the gauge moves if it is in battle, the battle party's message. */
  private *medicine(rec: Item, slot: number, move: number | undefined): Tick {
    const mon = this.party[slot]!;
    if (this.own.sims[slot]) this.pullSim(this.own, slot);
    const effect = medicineEffect(this.dex, mon, rec.partyUse!, move);
    if (!effect) throw new Error(`battle: ${rec.name} has no effect on ${this.nameOf(mon)}`);
    mon.hp = effect.hp;
    mon.status = effect.status;
    mon.pp = effect.pp;
    this.itemFriendship(mon, rec);
    const sim = this.simMon(slot);
    if (effect.message === 'revived') {
      sim.fainted = false;
      sim.faintQueued = false;
      sim.side.pokemonLeft++;
    }
    sim.hp = effect.hp;
    const status = STATUS_TO_SIM[effect.status];
    if (sim.status !== status) {
      sim.status = status as never;
      sim.statusState = this.sim.initEffectState({ id: status, target: sim } as never);
    }
    sim.baseMoveSlots.forEach((m, i) => {
      if (effect.pp[i] !== undefined) m.pp = effect.pp[i]!;
    });
    const shown = this.playerBattlers().map((b) => this.battlers[b]!).find((x) => this.teams[x.id]!.active === slot);
    if (shown) {
      shown.view.status = effect.status;
      yield* this.gauge(shown, effect.hp);
    }
    yield* this.say(this.text.party(MEDICINE_TEXT[effect.message]!, [this.nameOf(mon), String(effect.amount)]));
  }

  /** X items, Guard Spec. and Dire Hit on the active Pokémon (decomp BattleSystem_UseBagItem; Gen 4: +1 stage). */
  private *battleItem(rec: Item): Tick {
    const use = rec.partyUse!;
    const sim = this.simMon(this.active);
    const name = this.acting.view.name;
    yield* this.say(this.text.get('UsedTheItem', [rec.name]));
    for (const [k, v] of Object.entries(use.stages)) {
      if (!v || !(k in ITEM_STAGES)) continue;
      const id = ITEM_STAGES[k as keyof typeof ITEM_STAGES];
      if (sim.boosts[id] >= MAX_BOOST) continue;
      sim.boosts[id]++;
      yield* this.say(this.text.get('PokemonsStatRose', [name, this.text.stat(id)], 'Ally'));
    }
    if (use.stages.crit && !sim.volatiles['focusenergy']) {
      sim.addVolatile('focusenergy', sim);
      yield* this.say(this.text.get('PokemonIsGettingPumped', [name]));
    }
    if (use.flags.includes('guardSpec') && !this.sim.p1.sideConditions['mist']) {
      // Decomp: SIDE_CONDITION_MIST for 5 turns (the sim's Mist lasts 5 as well).
      this.sim.p1.addSideCondition('mist', sim);
      yield* this.say(this.text.get('YourTeamBecameShroudedInAWhiteFog'));
    }
    // The sim's own lines for these (side start, volatile start) are not shown again.
    this.logPos = this.sim.log.length;
    this.itemFriendship(this.party[this.active]!, rec);
  }

  /**
   * Decomp subscript_throw_pokeball and BattleScript_CatchMonTask: "X used one Y!", the throw, the ball
   * opens and takes the Pokémon in, it drops, shakes (CalcCatchShakes, drawn as it opens), then caught or
   * broke free.
   */
  private *throwBall(rec: Item): Tick {
    // The wild Pokémon left standing: the first enemy, else the second (decomp BattleScript_CatchMonTask).
    this.catchSide = this.foes().find((f) => this.activeSim(this.teams[f.id]!).hp > 0) ?? null;
    if (!this.catchSide) throw new Error('battle: a ball thrown with no wild Pokémon standing');
    yield* this.say(this.text.get('PlayerUsedOneItem', [this.deps.player.name, rec.name]));
    const shakes = yield* this.ballThrow(rec, () => this.catchShakes(rec));
    if (shakes === CAUGHT) yield* this.caughtMon(rec);
    else yield* this.say(this.text.get(BROKE_FREE[shakes]!));
  }

  /**
   * The ball's flight, the Pokémon taken in, the drop and bounce, the shakes (`shakes` is drawn as the ball
   * opens), then the caught stars, or the ball opening again with the Pokémon back out. Returns the shakes
   * (CAUGHT when caught; the ball stays on screen for the caller).
   */
  private *ballThrow(rec: Item, rollShakes: () => number): Generator<void, number, void> {
    // Where the ball opens: the target's spot (doubles: the enemy slot's, docs/research/double-battles.md §4).
    const target = this.catchSide!;
    const at = this.doubles ? (target.id === 1 ? { x: 216, y: 48 } : { x: 176, y: 40 }) : BALL_AT;
    const restY = at.y + BALL_REST_Y - BALL_AT.y;
    const ball = (x: number, y: number, anim: 0 | 1, tick: number, tilt = 0) => {
      this.ball = { item: rec.id, x: Math.round(x), y: Math.round(y), anim, tick, tilt, shade: 0, alpha: 1, stars: null };
    };
    for (let t = 1; t <= BALL_FLIGHT; t++) {
      const k = t / BALL_FLIGHT;
      ball(BALL_FROM.x + (at.x - BALL_FROM.x) * k, BALL_FROM.y + (at.y - BALL_FROM.y) * k - Math.sin(Math.PI * k) * 40, 0, t);
      yield;
    }
    const foe = target.view;
    foe.flash = true;
    for (let t = 1; t <= BALL_ABSORB; t++) {
      ball(at.x, at.y, 1, t);
      foe.scale = 1 - t / BALL_ABSORB;
      yield;
    }
    foe.visible = false;
    foe.flash = false;
    foe.scale = 1;
    const shakes = rollShakes();
    for (let t = 1; t <= BALL_DROP; t++) {
      ball(at.x, at.y + ((restY - at.y) * t) / BALL_DROP, 0, 0);
      yield;
    }
    let y = restY;
    for (const [dy, squash] of BALL_BOUNCE) {
      y += dy;
      ball(at.x, y, squash ? 1 : 0, squash ? BALL_SQUASH_TICK : 0);
      yield;
    }
    for (let s = 0; s < Math.min(shakes, 3); s++) {
      for (let t = 0; t < BALL_SHAKE_WAIT; t++) {
        ball(at.x, restY, 0, 0);
        yield;
      }
      let dx = 0;
      for (const step of BALL_SHAKES[s]!) {
        dx += step;
        ball(at.x + dx, restY, 0, 0, (dx * 2) / 360);
        yield;
      }
      for (let t = 0; t < BALL_SHAKE_PAUSE; t++) {
        ball(at.x, restY, 0, 0);
        yield;
      }
    }
    if (shakes === CAUGHT) {
      for (let t = 0; t < BALL_CAUGHT_WAIT; t++) yield;
      for (let t = 0; t < BALL_STARS; t++) {
        this.ball = { ...this.ball!, shade: BALL_SHADE, stars: t };
        yield;
      }
      this.ball = { ...this.ball!, stars: null };
      return CAUGHT;
    }
    // Broke free: the ball opens and the Pokémon comes back out.
    foe.visible = true;
    foe.flash = true;
    for (let t = 1; t <= 8; t++) {
      ball(at.x, restY, 1, t);
      foe.scale = t / 8;
      yield;
    }
    foe.flash = false;
    this.ball = null;
    return shakes;
  }

  /** The caught ball brightens again and fades out. */
  private *ballFadeOut(): Tick {
    for (let t = 1; t <= BALL_FADE_OUT; t++) {
      this.ball = { ...this.ball!, shade: 0, alpha: 1 - t / BALL_FADE_OUT };
      yield;
    }
  }

  /**
   * A ball thrown in a trainer battle (decomp BattleScript_CatchMonTask with BATTLE_TYPE_TRAINER): the trainer
   * knocks it away, "The Trainer blocked the Ball!", "Don't be a thief!". The ball stays in the bag
   * (BattleController_UseBagItem removes balls only outside trainer battles); the turn is spent.
   */
  private *blockedBall(rec: Item): Tick {
    yield* this.say(this.text.get('PlayerUsedOneItem', [this.deps.player.name, rec.name]));
    for (let t = 1; t <= BALL_FLIGHT; t++) {
      const k = t / BALL_FLIGHT;
      this.ball = { item: rec.id, x: Math.round(BALL_FROM.x + (BALL_AT.x - BALL_FROM.x) * k), y: Math.round(BALL_FROM.y + (BALL_AT.y - BALL_FROM.y) * k - Math.sin(Math.PI * k) * 40), anim: 0, tick: t, tilt: 0, shade: 0, alpha: 1, stars: null };
      yield;
    }
    this.ball = null;
    yield* this.say(this.text.get('TheTrainerBlockedTheBall'));
    yield* this.say(this.text.get('DontBeAThief'));
  }

  /** The catch inputs at the moment the ball opens (decomp BattleScript_CalcCatchShakes; rolls are the battle's u16 draws). */
  private catchShakes(rec: Item): number {
    const team = this.teams[this.catchSide!.id]!;
    const foe = this.catchSide!.mon;
    const stats = this.dex.form(foe.species, foe.form);
    const ballMod = ballModifier(bare(rec.id), {
      types: stats.types.map(bare),
      level: foe.level,
      terrain: this.setup.terrain && bare(this.setup.terrain),
      time: this.setup.time,
      caughtBefore: this.deps.caught.includes(foe.species),
      turns: this.turns - 1,
    });
    // Decomp: a Safari Ball scales the catch rate by the catch stage (sSafariCatchRate).
    const catchRate = this.safari && bare(rec.id) === 'ITEM_SAFARI_BALL' ? safariScaled(stats.catchRate, this.safari.stage) : stats.catchRate;
    return catchShakes({ catchRate, ball: bare(rec.id), ballMod, maxHp: team.sims[0]!.maxhp, hp: team.sims[0]!.hp, status: STATUS_FROM_SIM[team.sims[0]!.status] ?? 'none', rand16: () => this.rng.next16() });
  }

  /**
   * Caught (decomp SEQ_CATCH_MON_*): "Gotcha!", the Pokédex line and entry for a new species, the nickname,
   * then the party or the PC.
   */
  private *caughtMon(rec: Item): Tick {
    const foe = this.catchSide!;
    const team = this.teams[foe.id]!;
    foe.view.healthbox.visible = false;
    // Decomp SEQ_CATCH_MON_PRINT_POKEMON_WAS_CAUGHT plays the wild victory music with "Gotcha!".
    this.victory();
    yield* this.say(this.text.get('GotchaPokemonWasCaught', [foe.view.name]));
    yield* this.ballFadeOut();
    const mon = team.party[0]!;
    this.pull(mon, team.sims[0]!);
    mon.ball = rec.id;
    if (!this.deps.caught.includes(mon.species)) {
      yield* this.say(this.text.get('PokemonsDataWasAddedToThePokedex', [foe.view.name]));
      // Decomp SEQ_CATCH_MON_SET_POKEDEX_DATA: the entry screen (the game hosts it: `app()`), until it closes.
      if (this.deps.registries.species.get(mon.species)?.dex) {
        this.dexEntryOpen = true;
        this.prompt = { kind: 'pokedex' };
        while (this.dexEntryOpen) yield;
        this.prompt = null;
      } else this.deps.log.stub(`battle:pokedex-entry:${mon.species}`, 'the species has no Pokédex record: no entry to show');
    }
    // Decomp SEQ_CATCH_MON nickname: "Give a nickname to the caught X?"; YES opens the naming screen (the game hosts it).
    const nick = yield* this.ask({ kind: 'nickname', cursor: 0 }, this.text.get('GiveANicknameToTheCaughtPokemonYesNo', [foe.view.name]));
    if (nick.kind === 'nickname' && nick.give) {
      this.naming = { mon, name: undefined };
      this.prompt = { kind: 'naming' };
      while (this.naming.name === undefined) yield;
      if (this.naming.name !== null) mon.nickname = this.naming.name;
      this.naming = null;
      this.prompt = null;
    }
    this.ball = null;
    if (this.party.length < PARTY_SIZE) {
      this.party.push(mon);
      this.caught = { mon, box: null };
    } else {
      const { current, free, metBebe } = this.deps.pc;
      if (!free) throw new Error('battle: a ball was thrown with the party and the PC full');
      const pc = metBebe ? 'Bebes' : 'Someones';
      if (free.box === current.box) yield* this.say(this.text.get(`PokemonWasTransferredToBoxIn${pc}PC`, [foe.view.name, free.name]));
      else yield* this.say(this.text.get(`BoxIn${pc}PCIsFullPokemonWasTransferredToOtherBoxInstead`, [foe.view.name, current.name, free.name]));
      this.caught = { mon, box: free.box };
    }
    this.outcome = 'caught';
  }

  // ---------- messages ----------

  private printer: TextPrinter | null = null;
  /** The touch screen was touched last tick (a touch this tick is a new one when it was not). */
  private touchedBefore = false;

  /**
   * Decomp BattleMessage_Print: a text printer at the battle's text speed with the battle's render flags
   * (BattleSys_SetRenderControlFlags): A/B speed-up, auto-scroll at {clear}/{scroll}; outside the catching
   * tutorial a fresh A/B or touch ends that wait early and touch speeds up printing too. Link and recorded
   * battles (fixed FAST speed, no early end) do not exist here.
   */
  private startMessage(message: string): void {
    const tutorial = this.setup.kind === 'tutorial';
    this.printer = new TextPrinter(toPrintOps(message), { speed: this.deps.textSpeed, canSpeedUp: true, speedUpOnTouch: !tutorial, autoScroll: { skip: !tutorial } });
    this.message = { text: this.printer.text(), done: false };
  }

  /** One tick of printing: the print task runs twice a DS frame (main.c). */
  private printStep(): void {
    const p = this.printer;
    if (!p || p.done) return;
    const has = (b: Button) => this.input.pressed.includes(b);
    const input = {
      pressed: has('a') || has('b'),
      held: this.input.held.includes('a') || this.input.held.includes('b'),
      touchPressed: this.touchPressed(),
      touchHeld: this.input.touch !== null,
    };
    // SE_CONFIRM for each press that ends a {clear}/{scroll} wait early; the auto-scroll's own end is silent.
    for (let i = 0; i < 2; i++) if (p.subStep(input)) this.deps.sound?.se?.(SE_CONFIRM);
    // The view's `done`: the text so far is all printed (the printer finished, or waits at a {clear}/{scroll}).
    this.message = { text: p.text(), done: p.done || p.waiting };
  }

  /** gSystem.touchPressed: the screen touched this tick and not the one before. */
  private touchPressed(): boolean {
    return this.input.touch !== null && !this.touchedBefore;
  }

  private *finishMessage(): Tick {
    while (!this.printer!.done) {
      this.printStep();
      yield;
    }
    // The wait after a message: a shortened WaitButtonABTime (see MESSAGE_HOLD).
    yield* this.waitButtonAB(MESSAGE_HOLD);
  }

  /**
   * Decomp BtlCmd_WaitButtonABTime: `frames` ticks; outside link battles a fresh A, B, X or Y press or a tap on
   * the touch screen ends it, read from its first tick on (the caller has yielded since the message ended).
   */
  private *waitButtonAB(frames: number): Tick {
    for (let t = 0; t < frames; t++) {
      const p = this.input.pressed;
      if (p.includes('a') || p.includes('b') || p.includes('x') || p.includes('y') || this.touchPressed()) break;
      yield;
    }
  }

  /** Prints the message and holds it. */
  private *say(message: string): Tick {
    this.startMessage(message);
    yield* this.finishMessage();
  }

  // ---------- prompt input (d-pad cursor; touch and replays use `choose`) ----------

  private navigate(input: InputFrame): void {
    const p = this.prompt!;
    const press = (b: string) => input.pressed.includes(b as never);
    if (p.kind === 'command' && this.doubles && press('start')) {
      this.hpNumbers = !this.hpNumbers;
    }
    if (p.kind === 'target') {
      if (press('b')) return this.choose({ kind: 'cancel' });
      const aim = p.move.aim!;
      p.cursor = targetCursor(p.cursor, aim, (d) => press(d));
      if (!press('a')) return;
      if (p.cursor === TARGET_CANCEL) this.choose({ kind: 'cancel' });
      else this.choose(aim.group ? { kind: 'move', slot: p.slot } : { kind: 'move', slot: p.slot, target: p.cursor });
      return;
    }
    if (p.kind === 'learn-ask' || p.kind === 'forfeit') {
      // YES / NO; B is NO.
      if (press('left')) p.cursor = 0;
      else if (press('right')) p.cursor = 1;
      else if (press('up') || press('down')) p.cursor = p.cursor ? 0 : 1;
      if (press('b')) this.choose({ kind: 'answer', yes: false });
      else if (press('a')) this.choose({ kind: 'answer', yes: p.cursor === 0 });
      return;
    }
    if (p.kind === 'command') {
      // DS layout: Fight on top; Bag, Run, Pokémon below, left to right.
      const row = [1, 3, 2];
      if (press('up')) p.cursor = 0;
      else if (press('down') && p.cursor === 0) p.cursor = 3;
      else if (press('left') || press('right')) {
        const at = row.indexOf(p.cursor);
        if (at >= 0) p.cursor = row[Math.max(0, Math.min(2, at + (press('left') ? -1 : 1)))]!;
      }
      // B on the second battler's card: back to the first (CANCEL).
      if (press('b') && p.canRewind) {
        this.choose({ kind: 'cancel' });
        return;
      }
      if (!press('a')) return;
      if (!p.enabled[p.cursor]) return;
      // Safari (decomp PLAYER_INPUT_SAFARI_*): Ball, Bait, Mud and Run on the same buttons.
      if (this.safari) {
        this.choose(p.cursor === 3 ? { kind: 'run' } : { kind: 'safari', action: (['ball', 'bait', 'mud'] as const)[p.cursor]! });
        return;
      }
      if (p.cursor === 0) this.choose({ kind: 'fight' });
      // The second battler's RUN button is CANCEL while it can go back (decomp hasCancelButton).
      else this.choose({ kind: p.cursor === 1 ? 'bag' : p.cursor === 2 ? 'party' : p.canRewind ? 'cancel' : 'run' });
      return;
    }
    if (p.kind === 'nickname') {
      // YES / NO; B is NO.
      if (press('left')) p.cursor = 0;
      else if (press('right')) p.cursor = 1;
      else if (press('up') || press('down')) p.cursor = p.cursor ? 0 : 1;
      if (press('b')) this.choose({ kind: 'nickname', give: false });
      else if (press('a')) this.choose({ kind: 'nickname', give: p.cursor === 0 });
      return;
    }
    if (p.kind === 'naming') return;
    if (p.kind === 'shift') {
      // YES / NO; B is NO.
      if (press('left')) p.cursor = 0;
      else if (press('right')) p.cursor = 1;
      else if (press('up') || press('down')) p.cursor = p.cursor ? 0 : 1;
      if (press('b')) this.choose({ kind: 'keep' });
      else if (press('a')) this.choose({ kind: p.cursor === 0 ? 'party' : 'keep' });
      return;
    }
    if (p.kind === 'next') {
      // YES / NO; B is NO.
      if (press('left')) p.cursor = 0;
      else if (press('right')) p.cursor = 1;
      else if (press('up') || press('down')) p.cursor = p.cursor ? 0 : 1;
      if (press('b')) this.choose({ kind: 'run' });
      else if (press('a')) this.choose({ kind: p.cursor === 0 ? 'party' : 'run' });
      return;
    }
    if (p.kind === 'bag' || p.kind === 'party' || p.kind === 'pokedex') return;
    if (p.kind === 'fight') {
      const n = p.moves.length;
      if (press('b')) {
        this.prompt = this.commandPrompt();
        return;
      }
      let c = p.cursor;
      if (press('left') && c % 2) c--;
      if (press('right') && c % 2 === 0) c++;
      if (press('up') && c >= 2) c -= 2;
      if (press('down') && c < 2) c += 2;
      if (c < n) p.cursor = c;
      if (press('a') && (p.moves[p.cursor]!.pp > 0 || p.moves.every((m) => m.pp === 0)) && !this.moveDisabled(p.cursor)) this.choose({ kind: 'move', slot: p.cursor });
      return;
    }
    // The known moves form the same 2×2 grid as Fight. The new move is beside the grid on
    // wide screens and below it on phones, so either edge leads to it; B also selects it.
    const keep = p.moves.length;
    let c = p.cursor;
    if (press('left')) c = c === keep ? keep - 1 : c % 2 ? c - 1 : c;
    if (press('right') && c !== keep) c = c % 2 ? keep : c + 1;
    if (press('up')) c = c === keep ? 2 : c >= 2 ? c - 2 : c;
    if (press('down') && c !== keep) c = c < 2 ? c + 2 : keep;
    p.cursor = press('b') ? keep : c;
    if (press('a')) this.choose(p.cursor === keep ? { kind: 'keep' } : { kind: 'forget', slot: p.cursor });
  }

  // ---------- helpers ----------

  /** A trainer's class name and name (decomp TAG_TRCLASS_TRNAME); a rival takes the rival's name (Trainer_Encounter). */
  private trainerVars(t: Trainer = this.trainer!): [string, string] {
    const cls = this.deps.registries.texts.get(t.className);
    if (!cls) throw new Error(`battle: missing text ${t.className}`);
    return [plainText(cls.text), this.trainerName(t)];
  }

  private trainerName(t: Trainer): string {
    return bare(t.class).endsWith('TRAINER_CLASS_RIVAL') ? this.deps.player.rival : t.name;
  }

  /**
   * A sim side's team: the leads of its battlers (`teams`, in position order) first, then each party's other
   * Pokémon in party order (eggs never battle). Teams sharing a party share its sims. Type 19: both trainers'
   * leads, then the first trainer's reserve, then the second's (up to 12 members).
   */
  private addSide(player: SimSide, teams: Team[]): void {
    const order: [Team, number][] = teams.map((t) => [t, t.active]);
    for (const t of teams) {
      if (teams.find((x) => x.party === t.party) !== t) continue;
      for (const [i, m] of t.party.entries()) if (!m.isEgg && !order.some(([x, k]) => x.party === t.party && k === i)) order.push([t, i]);
    }
    this.sim.setPlayer(player, { name: OWNERS[SIM_SIDES.indexOf(player)]!, team: order.map(([t, i]) => simSet(this.data, this.dex, t.party[i]!, this.nameOf(t.party[i]!))) });
    const shared = new Map<Pokemon[], (SimMon | null)[]>();
    for (const t of teams) {
      if (!shared.has(t.party)) shared.set(t.party, t.party.map(() => null));
      t.sims = shared.get(t.party)!;
    }
    order.forEach(([t, index], k) => {
      t.sims[index] = this.sim[player]!.pokemon[k] as SimMon;
      this.pushSim(t, index, true);
    });
  }

  private activeSim(team: Team): SimMon {
    const s = team.sims[team.active];
    if (!s) throw new Error('battle: no active Pokémon');
    return s;
  }

  private side(mon: Pokemon, battler: number): Side {
    const side = battler & 1 ? 'enemy' : 'player';
    const level = mon.level;
    const table = this.dex.expTable(this.dex.form(mon.species, mon.form).growthRate);
    const base = table[level]!;
    const span = level >= 100 ? 0 : table[level + 1]! - base;
    const view: BattlerView = {
      battler,
      owner: this.owners[battler]!,
      position: battler >> 1 ? 1 : 0,
      side,
      species: mon.species,
      form: mon.form,
      shiny: isShiny(mon.otId, mon.pid),
      gender: monGender(this.dex, mon),
      name: this.nameOf(mon),
      level,
      hp: mon.hp,
      maxHp: mon.stats.hp,
      status: mon.status,
      ...(side === 'player' ? { exp: { into: span ? mon.exp - base : 0, span } } : { caught: this.deps.caught.includes(mon.species) }),
      visible: false,
      dx: 0,
      dy: 0,
      scale: 1,
      clip: 0,
      flash: false,
      healthbox: { visible: false, dx: 0 },
    };
    return { id: battler, mon, view, hpTemp: gaugeTemp(mon.stats.hp, mon.hp, HP_PIXELS), expTemp: view.exp ? gaugeTemp(span, view.exp.into, EXP_PIXELS) : 0 };
  }

  /** The battler a protocol ident (`p1a: X`, multi `p3b: X`) names. */
  private sideOf(ident: string): Side {
    const b = this.battlers[this.battlerOf(ident)];
    if (!b) throw new Error(`battle: unknown battler ${ident}`);
    return b;
  }

  /** The DS battler id of a protocol ident or side id (p1 → 0 … p4 → 3: one sim side per battler; doubles by position). */
  private battlerOf(ident: string): number {
    const b = SIM_SIDES.indexOf(ident.slice(0, 2) as SimSide);
    if (b < 0) throw new Error(`battle: unknown battler ${ident}`);
    // Doubles: `p1a`/`p2a` the first positions (0, 1), `p1b`/`p2b` the second (2, 3); a bare side id its side.
    return this.format === 'doubles' && ident[2] === 'b' ? b + 2 : b;
  }

  private who(side: Side): Who {
    return (side.id & 1) === 0 ? 'Ally' : this.trainer ? 'Foe' : 'Wild';
  }

  /** The first battler on the other side still standing (the default target of an animation), else its first. */
  private opposite(side: Side): Side {
    const others = this.battlers.filter((b) => (b.id & 1) !== (side.id & 1));
    return others.find((b) => b.view.visible) ?? others[0]!;
  }

  private nameOf(mon: Pokemon): string {
    return mon.nickname ?? this.deps.registries.species.get(mon.species)!.name;
  }

  private abilityNumber(mon: Pokemon): number {
    return mon.ability ? (this.deps.registries.abilities.get(mon.ability)?.sourceIndex ?? 0) : 0;
  }

  private itemNumber(mon: Pokemon): number {
    return mon.heldItem ? (this.deps.registries.items.get(mon.heldItem)?.sourceIndex ?? 0) : 0;
  }

  private move(id: Id): Move {
    const m = this.deps.registries.moves.get(id);
    if (!m) throw new Error(`battle: unknown move ${id}`);
    return m;
  }

  private moveView(m: Move, pp: number, max: number): BattleMoveView {
    return { move: m.id, name: m.name, type: m.type, category: m.category, power: m.power, pp, maxPp: max };
  }

  /** Fight, Bag, Pokémon, Run; the first battle has Fight only (decomp subscreen layouts 5/6). */
  private commandPrompt(): BattlePrompt {
    const all = this.setup.kind !== 'first';
    // The frontier's touch screen has no BAG (decomp BattleSubscreen with BATTLE_TYPE_FRONTIER).
    return { kind: 'command', cursor: 0, enabled: [true, all && !this.frontier, all, all], moves: this.safari ? [] : this.moveViews(this.acting.mon, this.acting), actor: this.actor, ...(this.canRewind ? { canRewind: true } : {}) };
  }

  /** The lead's moves with their PP as the sim has them now; in doubles, for the acting battler, each move's `aim`. */
  private moveViews(mon: Pokemon, user?: Side): BattleMoveView[] {
    const index = this.own.party.indexOf(mon);
    const sim = index >= 0 ? this.own.sims[index] : null;
    return mon.moves.map((id, i) => {
      const m = this.move(id);
      const view = this.moveView(m, sim?.baseMoveSlots[i]?.pp ?? mon.pp[i]!, maxPp(m.pp, mon.ppUps[i] ?? 0));
      const aim = user && this.aim(user, sim?.moveSlots[i]);
      return aim ? { ...view, aim } : view;
    });
  }

  private parseHp(s: string): number {
    const m = /^(\d+)(?:\/\d+)?/.exec(s);
    if (!m) throw new Error(`battle: cannot read HP "${s}"`);
    return Number(m[1]);
  }

  /** A protocol line's HP for a side, with what a level-up earlier in the batch added (a faint stays 0). */
  private lineHp(side: Side, s: string): number {
    const hp = this.parseHp(s);
    return hp ? hp + (this.levelHp.get(this.activeSim(this.teams[side.id]!)) ?? 0) : 0;
  }

  /** Our stats are authoritative (pack data, our rules): written over the sim's own. */
  private applyStats(sim: SimMon, mon: Pokemon): void {
    const stats = { atk: mon.stats.attack, def: mon.stats.defense, spa: mon.stats.spAttack, spd: mon.stats.spDefense, spe: mon.stats.speed };
    sim.level = mon.level;
    sim.set.level = mon.level;
    sim.baseStoredStats = { ...stats, hp: mon.stats.hp } as never;
    for (const k of Object.keys(SIM_STATS) as (keyof typeof SIM_STATS)[]) sim.storedStats[k] = stats[k];
    sim.speed = stats.spe;
    sim.maxhp = sim.baseMaxhp = mon.stats.hp;
  }

  /** Party → sim: level, stats, HP, moves and PP (and at the start, status). */
  private pushSim(team: Team, index: number, start: boolean): void {
    const mon = team.party[index]!;
    const sim = team.sims[index]!;
    this.applyStats(sim, mon);
    sim.hp = mon.hp;
    if (start) {
      if (mon.hp === 0) sim.fainted = true;
      const status = STATUS_TO_SIM[mon.status];
      sim.status = status as never;
      const turns = status === 'slp' ? this.sleepTurns(team, index) : 0;
      sim.statusState = this.sim.initEffectState({ id: status, target: sim, ...(status === 'slp' ? { startTime: turns, time: turns } : {}) } as never);
    }
    sim.baseMoveSlots = mon.moves.map((id, i) => {
      const m = this.sim.dex.moves.get(this.data.move(id));
      return { move: m.name, id: m.id, pp: mon.pp[i]!, maxpp: maxPp(this.move(id).pp, mon.ppUps[i] ?? 0), target: m.target, disabled: false, disabledSource: '', used: false } as never;
    });
    if (start || !sim.transformed) sim.moveSlots = sim.baseMoveSlots.slice();
  }

  /** The player's side as the bag code reads it. */
  private get party(): Pokemon[] {
    return this.own.party;
  }

  /** The acting battler's party slot (singles: the player's Pokémon out). */
  private get active(): number {
    return this.teams[this.actor]!.active;
  }

  /** A party slot one of the player's battlers has out. */
  private inBattle(slot: number): boolean {
    return this.playerBattlers().some((b) => this.teams[b]!.active === slot);
  }

  /** A party slot that can come in now: not out, not picked by the other battler's command, able to fight. */
  private canSendOut(slot: number): boolean {
    const mon = this.party[slot];
    return !!mon && !mon.isEgg && !this.inBattle(slot) && !this.reserved.has(slot) && this.simMon(slot).hp > 0;
  }

  private simMon(index: number): SimMon {
    const s = this.own.sims[index];
    if (!s) throw new Error(`battle: party slot ${index} is not in the battle`);
    return s;
  }

  private roamerAfter(): Pick<BattleResult, 'roamer'> {
    const sim = this.foe.sims[0];
    if (!sim) throw new Error('battle: the roamer is not in the battle');
    return { roamer: { hp: sim.hp, status: STATUS_FROM_SIM[sim.status] ?? 'none' } };
  }

  /** Sim → party: HP, status, PP, the held item. */
  /**
   * A sleeping Pokémon's turns at the start: a frontier battle's own (contracts `FrontierBattle.sleep`: the Arcade's
   * sleep effect, 2–5), else 3.
   */
  private sleepTurns(team: Team, index: number): number {
    const sleep = this.setup.frontier?.sleep;
    const turns = sleep && (team === this.own ? sleep.player : team === this.foe ? sleep.enemy : null)?.[index];
    return turns || 3;
  }

  private pullSim(team: Team, index: number): void {
    this.pull(team.party[index]!, team.sims[index]!);
  }

  /**
   * The held item follows the battle (decomp BtlIOCmd_UpdatePartyMon): an eaten berry or a used-up item is
   * gone, a stolen or tricked one stays. A knocked-off item is not written back (knockedOffItemsMask), so
   * the Pokémon has it again after the battle. An item the sim lacks (inert there, `simData.item`) stays.
   */
  private pull(mon: Pokemon, sim: SimMon): void {
    if (sim.item !== toID(this.data.item(mon.heldItem)) && !sim.itemKnockedOff) mon.heldItem = sim.item ? this.data.packItem(sim.item) : null;
    mon.hp = sim.hp;
    mon.status = STATUS_FROM_SIM[sim.status] ?? 'none';
    mon.moves.forEach((id, i) => {
      const slot = sim.baseMoveSlots[i];
      if (slot && slot.id === this.data.move(id)) mon.pp[i] = slot.pp;
    });
  }
}
