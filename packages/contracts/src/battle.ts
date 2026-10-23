/**
 * The battle seam (contracts 0.10.0).
 *
 * The world (wild encounters) and the VM (battle script commands) ask the game for a battle through
 * `FieldHost.startBattle`. The game runs it in battle mode: while a battle is active the field and the VM
 * do not tick, every tick's input goes to `Battle.step`, and nothing is saved. When `Battle.done()` returns
 * a result the game applies it to the state (the party), logs it and resumes the field.
 *
 * The battle is headless and owns its whole timeline (intro, messages, HP and EXP gauges, animations) in
 * 30 Hz ticks; `BattleView` is everything a scene draws. Same setup + same seed + same choices = the same
 * battle, tick for tick. It is not the cartridge's RNG order (docs/decisions.md: battle engine).
 */
import type { Bag, Gender, Id, Pokemon, Stats, StatusCondition } from '@opensinnoh/core';
import type { AppRequest, AppResult } from './apps.ts';
import type { CryMod } from './audio.ts';
import type { StubLog } from './runtime.ts';
import type { Registries } from './runtime.ts';
import type { InputFrame } from './ui.ts';
import type { FrontierBattle } from './frontier.ts';

/**
 * Decomp battle types (0.14.0: all four run): `wild`; `trainer` singles (StartTrainerBattle);
 * `first`, the Route 201 rival (BATTLE_STATUS_FIRST_BATTLE: no crits, no blackout, Fight only); `tutorial`, the
 * catching tutorial (BATTLE_TYPE_CATCH_TUTORIAL: the counterpart fights a wild Pokémon for the player to
 * watch, then catches it).
 *
 * 0.27.2: a script's wild battle (decomp Encounter_NewVsSpeciesAtLevel, Encounter_NewVsGiratinaOrigin; both
 * BATTLE_TYPE_WILD_MON): `static` from StartWildBattle, `legendary` from StartLegendaryBattle and
 * StartGiratinaOriginBattle (BATTLE_STATUS_LEGENDARY, which no battle code reads). They battle as `wild` does, but
 * the script owns the blackout (the game blacks out only after a lost `wild` battle) and replay `wild flee` leaves
 * them alone.
 *
 * 0.29.1: `safari`, a field wild battle in a Safari Game (decomp FieldBattleDTO_NewSafari, BATTLE_TYPE_SAFARI): no
 * Pokémon is sent out, the command card is Safari Ball, Bait, Mud and Run (`BattleChoice` `safari`), `safariBalls`
 * comes in with the setup and goes back with the result.
 */
export type BattleKind = 'wild' | 'trainer' | 'first' | 'tutorial' | 'static' | 'legendary' | 'safari';

/** 0.27.2. The kinds that battle wild Pokémon (decomp BATTLE_TYPE_WILD_MON): `wild`, `static`, `legendary`; 0.29.1 `safari`. */
export function isWildKind(kind: BattleKind): boolean {
  return kind === 'wild' || kind === 'static' || kind === 'legendary' || kind === 'safari';
}

export type BattleWeather = 'rain' | 'sun' | 'sandstorm' | 'hail' | 'fog' | 'trickroom';

export type TimeOfDay = 'day' | 'twilight' | 'night';

/**
 * 0.25.0. Who stands on each side (decomp BATTLE_TYPE_* masks; docs/research/double-battles.md §1). `single`: one
 * battler a side. `double`: one owner a side with two out (trainer doubles, type 3). `trainer-pair`: two enemy
 * trainers against the player alone with two out (type 19). `ai-partner`: the player and an AI partner, one out
 * each, against two trainers (type 75) or two wild Pokémon (type 74). The battle derives the DS mask from the kind
 * and the topology.
 */
export type BattleTopology = 'single' | 'double' | 'trainer-pair' | 'ai-partner';

/**
 * 0.25.0. A battler's owner, whose party it comes from and whose reserve replaces it: the player, the AI
 * partner, the first enemy (a trainer or a wild Pokémon) or the second (a second trainer, a second wild Pokémon).
 */
export type BattleOwner = 'player' | 'partner' | 'enemy' | 'enemy2';

/** A wild Pokémon to battle; the battle rolls its PID, IVs and held item from its own seed. */
export interface WildSpec {
  species: Id;
  level: number;
  form?: number;
  /**
   * 0.27.2. A roamer (decomp BATTLE_TYPE_ROAMER, AddRoamerToEnemyParty): its saved PID, IVs, HP and status instead
   * of a fresh roll, and no held item. It flees at its first chance unless trapped (decomp AI_FLAG_ROAMING_POKEMON);
   * `BattleResult.roamer` carries its HP and status back.
   */
  roamer?: { pid: number; ivs: Stats; hp: number; status: StatusCondition };
  /** 0.28.1. A fateful encounter (decomp Encounter_NewFatefulVsSpeciesAtLevel): the wild Pokémon carries `Pokemon.fatefulEncounter`. */
  fateful?: true;
  /**
   * 0.31.0. A Poké Radar shiny patch (decomp CreateWildMonShinyWithGenderOrNature): the PID is made shiny with the
   * player's OT id (core `shinyPid`), the IVs random.
   */
  shiny?: true;
}

/** What `FieldHost.startBattle` asks for. */
export interface BattleSetup {
  kind: BattleKind;
  /**
   * Trainer battles: the trainers (slot order). Empty for wild battles. `trainer-pair` and `ai-partner` against
   * trainers: the two enemy trainers (battlers 1 and 3).
   */
  trainers: Id[];
  /** Wild battles: the wild side. */
  wild: WildSpec[];
  /**
   * The backdrop (a `battleBackgrounds` id, decomp BACKGROUND_*; zone header, WATER while surfing) and the
   * platforms (a `battleTerrains` id, decomp CalcTerrain). Null when the packs have no battle art (the
   * scene draws a plain backdrop).
   */
  background: Id | null;
  terrain: Id | null;
  time: TimeOfDay;
  /** Field condition at entry, before switch-in abilities; absent means clear. */
  weather?: BattleWeather;
  /**
   * The catching tutorial's player side (decomp FieldBattleDTO_NewCatchingTutorial, 0.14.0): the counterpart's
   * name and gender, and the starter it sends out (level 5).
   */
  counterpart?: { name: string; gender: 'male' | 'female'; species: Id };
  /** 0.25.0. The topology; absent: `single`. */
  topology?: BattleTopology;
  /** 0.25.0. `ai-partner`: the partner trainer (decomp ScrCmd_StartTagBattle's partner, VAR_PARTNER_TRAINER_ID). */
  partner?: Id;
  /**
   * 0.27.2. Decomp Encounter_NewVsGiratinaOrigin (BATTLE_STATUS_GIRATINA | BATTLE_STATUS_DISTORTION): the world puts
   * the battle on TERRAIN_GIRATINA when the pack has battle art. The battle runs Task_SetGiratinaEncounter's shaded vertical entrance.
   */
  giratina?: boolean;
  /**
   * 0.31.0. Decomp Encounter_NewVsHoneyTree (BATTLE_STATUS_HONEY_TREE): the battle is on BACKGROUND_PLAIN and
   * TERRAIN_PLAIN whatever the zone (the world sets them when the pack has battle art).
   */
  honeyTree?: true;
  /** 0.29.1. `safari`: the Safari Balls left (decomp FieldBattleDTO countSafariBalls). */
  safariBalls?: number;
  /**
   * 0.34.0. A Battle Frontier battle (`FrontierBattle`): `kind` is `trainer` with no `trainers`; the frontier's own
   * trainers and the player's battle party come with it. The world puts it on the facility's backdrop.
   */
  frontier?: FrontierBattle;
}

/** What a script asks `FieldHost.startBattle` for (0.14.0): the setup without its scene, which the world adds. */
export type BattleRequest = Omit<BattleSetup, 'background' | 'terrain' | 'time' | 'weather'>;

/** Decomp BATTLE_RESULT_*. */
export type BattleOutcome = 'won' | 'lost' | 'draw' | 'fled' | 'enemy-fled' | 'caught';

/** What the game applies when a battle ends. */
export interface BattleResult {
  outcome: BattleOutcome;
  /** Turns played (the turn counter at the end). */
  turns: number;
  /** The party after the battle (HP, PP, status, exp, level, stats, moves, EVs, friendship), same order. */
  party: Pokemon[];
  /** The player's money after the prize or the loss penalty (decomp BtlCmd_PayPrizeMoney; 0.14.0). */
  money: number;
  /** The bag after the battle (items used, balls thrown; 0.12.0). */
  bag: Bag;
  /**
   * The caught Pokémon (0.12.0): already the last of `party` when there was room (`box` null), else the
   * game stores it in PC box `box` (`BattleDeps.pc.free`). The game marks its species caught.
   */
  caught: { mon: Pokemon; box: number | null } | null;
  /**
   * 0.16.0. The foe species the trainer sent out, in order (decomp Pokedex_Encounter on each send-out); the
   * game marks them seen. A wild foe is marked when the battle starts.
   */
  seen: Id[];
  /**
   * 0.21.1. The party slots (same order as `party`) of the Pokémon that levelled up in the battle, ascending
   * (decomp FieldBattleDTO.leveledUpMonsMask): after a win, a catch or a flight the game checks each for a
   * level-up evolution (Battle_FindEvolvingPartyMember).
   */
  levelled: number[];
  /** 0.27.2. A roamer battle (`WildSpec.roamer`): the roamer's HP and status at the end (decomp RoamerAfterBattle_UpdateRoamers). */
  roamer?: { hp: number; status: StatusCondition };
  /** 0.29.1. A `safari` battle: the Safari Balls left (decomp UpdateFieldSystemFromDTO). */
  safariBalls?: number;
  /** 0.39.0. A frontier battle: the first trainer's party at the end (decomp dto->parties[BATTLER_ENEMY_1]). */
  enemyParty?: Pokemon[];
}

/**
 * A player decision. Replays and the command card send these; the battle validates them.
 *
 * 0.25.0: `battler` is the acting battler (0 or 2, the player's side; absent: the prompt's `actor`), so a
 * replay or the card can name the actor; the battle refuses a choice for another one.
 */
export type BattleChoice =
  /** Open Fight using the same remembered cursor for pointer, keyboard and gamepad input. */
  | { kind: 'fight' }
  /** 0.27.6. YES / NO at a `learn-ask` prompt ("Make it forget another move?", "Should it give up on learning?"). */
  | { kind: 'answer'; yes: boolean }
  /**
   * Fight with the active Pokémon's move in that slot (0–3). 0.25.0: `target`, the battler (0–3) a single-target
   * move aims at in a double battle; absent: the DS target screen's first cursor position (the second enemy, else
   * the first, else the player's side). A single battle refuses one; a move that takes no chosen target (spread,
   * self, random) ignores it.
   */
  | { kind: 'move'; slot: number; target?: number; battler?: number }
  | { kind: 'run'; battler?: number }
  /** The move-learn prompt: forget the move in `slot` for the new one, or keep the old moves; 0.23.0: NO at the shift question. */
  | { kind: 'forget'; slot: number }
  | { kind: 'keep' }
  /** 0.15.0. The nickname question after a catch: YES opens the naming screen, NO keeps the species name. */
  | { kind: 'nickname'; give: boolean }
  /**
   * 0.12.0. Use a bag item: a ball, a medicine on party slot `target` (0–5), or a battle item (X items,
   * Guard Spec.; on the active Pokémon). Takes the turn. Valid at the command prompt and while the bag is open.
   * 0.23.0: `move`, the target's move slot (0–3) a one-move PP item (Ether, Leppa Berry) restores.
   */
  | { kind: 'item'; item: Id; target?: number; move?: number; battler?: number }
  /**
   * 0.12.0. Send in party slot `slot`: a voluntary switch (takes the turn) at the command prompt or with the
   * party open, or the replacement after a faint (at "Use next Pokémon?" or the forced party).
   */
  | { kind: 'switch'; slot: number; battler?: number }
  /** 0.12.0. Open the bag or the party sheet (the command card's BAG and POKéMON; "Use next Pokémon?" YES). */
  | { kind: 'bag' }
  | { kind: 'party' }
  /**
   * 0.27.1. CANCEL on the second battler's command card in a double battle the player commands alone (types 3 and
   * 19; decomp BattleControllerPlayer_CommandSelectionInput): back to the first battler's command. Only while the
   * prompt's `canRewind` is set (a first command that used an item other than a ball cannot be taken back: the
   * decomp's item id > 16 gate).
   */
  | { kind: 'cancel' }
  /**
   * 0.29.1. A `safari` battle's command card (decomp PLAYER_INPUT_SAFARI_*): throw a Safari Ball, Bait or Mud. Run is
   * `run`. The card's buttons are 0 ball, 1 bait, 2 mud, 3 run.
   */
  | { kind: 'safari'; action: 'ball' | 'bait' | 'mud' };

export interface BattleMoveView {
  move: Id;
  name: string;
  type: Id;
  category: 'physical' | 'special' | 'status';
  power: number;
  pp: number;
  maxPp: number;
  /**
   * 0.27.6. Double battles: what the DS target screen offers for this move now (decomp GetTargetSelectLayout and the
   * presence check): `group` false, the battlers it may aim at, in the cursor's start order (3, 1, 0, 2); `group`
   * true, the battlers highlighted together (spread moves, and the user alone for self, random and special targets),
   * confirmed as one. Absent in singles.
   */
  aim?: { targets: number[]; group: boolean };
}

/**
 * What the battle waits for. `cursor` is the DS d-pad cursor (keys and gamepad move it in `step`).
 * command: 0 Fight, 1 Bag, 2 Pokémon, 3 Run (`enabled` per button) and the lead's moves. fight: the 4
 * move slots. learn: forget one of `moves` for `move`, or `keep` (cursor = moves.length).
 * 0.12.0: next: "Use next Pokémon?" after the active Pokémon fainted in a wild battle (0 YES → `party`
 * or `switch`, 1 NO → `run`). bag / party: the battle's bag or party sheet is open (`Battle.app()`, hosted
 * by the game); a `forced` party (after a faint) cannot be cancelled.
 * 0.25.0: command and fight name their `actor`, the battler (0 or 2) the player commands now.
 * 0.27.1: in a double battle the player commands alone (types 3 and 19) the command card asks battler 0, then
 * battler 2; the second's `canRewind` says whether CANCEL (B, or the `cancel` choice) goes back to the first. A
 * forced `party` (a replacement after a faint) names the battler it replaces as `actor`.
 */
export type BattlePrompt =
  | { kind: 'command'; cursor: number; enabled: [boolean, boolean, boolean, boolean]; moves: BattleMoveView[]; actor: number; canRewind?: boolean }
  | { kind: 'fight'; cursor: number; moves: BattleMoveView[]; actor: number }
  /**
   * 0.27.6. The DS target screen after A (or a tap) on a move in a double battle (decomp BattleSubscreen target
   * select): the move in `slot` and its `aim`; `cursor` the battler the d-pad points at, 4 for CANCEL (a group moves
   * as one, on its first). The grid is enemy 3, enemy 1 over player 0, player 2, CANCEL under them. A answers `move`
   * with the cursor's battler as its target (none for a group); B or `cancel` goes back to the moves. Touch answers
   * `move` directly.
   */
  | { kind: 'target'; cursor: number; slot: number; move: BattleMoveView; actor: number }
  | { kind: 'learn'; cursor: number; move: BattleMoveView; moves: BattleMoveView[] }
  /**
   * 0.27.6. The move-learn questions (decomp battle_script.c SEQ_GET_EXP_*): `forget`, "Make it forget another move?"
   * (YES: the forget screen, `learn`; NO: "Well, then…" and `give-up`); `give-up`, "Should this Pokémon give up on
   * learning this new move?" (YES: it did not learn it; NO: it asks again). 0 YES, 1 NO; B is NO. Answered by `answer`.
   */
  | { kind: 'learn-ask'; cursor: 0 | 1; ask: 'forget' | 'give-up' }
  /** 0.34.0. A frontier battle's RUN: "Would you like to forfeit the match and quit now?" (0 YES, 1 NO; B is NO), by `answer`. */
  | { kind: 'forfeit'; cursor: 0 | 1 }
  | { kind: 'next'; cursor: 0 | 1 }
  | { kind: 'bag' }
  | { kind: 'party'; forced: boolean; actor?: number }
  /** 0.15.0: "Give a nickname to the caught X?" (0 YES, 1 NO), then the naming screen (`Battle.app()`). */
  | { kind: 'nickname'; cursor: 0 | 1 }
  | { kind: 'naming' }
  /**
   * 0.23.0. SHIFT style, after the trainer's Pokémon fainted: "{trainer} is about to send in X. Will you switch
   * your Pokémon?" (0 YES → `party` or `switch <slot>`, 1 NO → `keep`); the party it opens can be cancelled.
   */
  | { kind: 'shift'; cursor: 0 | 1 }
  /** 0.23.0. The Pokédex entry of a newly caught species (`Battle.app()`: `pokedex-entry`) after "data was added". */
  | { kind: 'pokedex' };

export interface BattlerView {
  /**
   * 0.25.0. The DS battler id (decomp BATTLER_*): 0 the player's first, 1 the enemy's first, 2 and 3 their
   * second (partners). Side = battler & 1; `position` = battler >> 1 (0 the first slot, 1 the second).
   */
  battler: number;
  owner: BattleOwner;
  position: 0 | 1;
  side: 'player' | 'enemy';
  species: Id;
  form: number;
  shiny: boolean;
  gender: Gender;
  name: string;
  level: number;
  /** HP and EXP as the gauges show them now (they move toward the real values, DS speed). */
  hp: number;
  maxHp: number;
  status: StatusCondition;
  /** Player side: exp into the current level and the level's span (0 at level 100). */
  exp?: { into: number; span: number };
  /** The species is in the Pokédex as caught (the enemy healthbox shows a ball). */
  caught?: boolean;
  /** Drawn at all (false before send-out and after fainting). */
  visible: boolean;
  /** DS px offset from the battler position (slides, faint drop, hit shake). */
  dx: number;
  dy: number;
  /** 0–1 send-out scale; 1 at rest. */
  scale: number;
  /** Rows hidden from the bottom while fainting (the DS drops the sprite behind a mask). */
  clip: number;
  /** A white silhouette (send-out flash). */
  flash: boolean;
  /** The healthbox: shown, and its DS px slide offset. */
  healthbox: { visible: boolean; dx: number; numbers?: boolean };
  /** 0.27.15. Giratina encounter: black palette blend (0–1); absent outside the entrance. */
  introShade?: number;
  /**
   * 0.27.25. The ability a battle message has named for this battler (decomp BattleMessage_AbilityTag), until it
   * leaves the field; absent while none has. Not drawn; the replay auto policy reads it.
   */
  ability?: Id;
}

export interface BattleView {
  kind: BattleKind;
  /** 0.25.0. */
  topology: BattleTopology;
  background: Id | null;
  terrain: Id | null;
  time: TimeOfDay;
  /** Ticks since the battle started. */
  tick: number;
  /**
   * The field-to-battle transition: the field shows under it while `field` is true (white flashes, then
   * black closing in, `amount` 0–1). Null once the scene is up.
   */
  transition: { field: boolean; flash: number; close: number } | null;
  /** Platform slide offsets (enemy from the left, player from the right), DS px; 0 at rest. */
  platforms: { enemyDx: number; playerDx: number };
  /** The player's trainer back sprite (wild intro): its offset and the frame of its throw (null = still). */
  trainer: { class: Id; dx: number; throwTick: number | null } | null;
  /**
   * The opposing trainer's front sprite (0.14.0; a `trainerSprites` class): its DS px offset from its rest
   * position (192, 50 is the enemy battler's spot), shown while it slides in, before its send-out and after
   * the win. Null when not on screen or the packs have no sprite for the class.
   */
  enemyTrainer: { class: Id; dx: number } | null;
  /**
   * 0.27.6. Doubles intros (decomp: two trainer sprites for a trainer double, three for TAG, four for 2vs2): the
   * second enemy trainer (types 19 and 75), and the AI partner's back sprite beside the player's (types 74 and 75),
   * with its throw frame like `trainer`'s. Where they stand follows the topology: two enemy trainers and every
   * trainer of a 2vs2 at their battlers' spots, a lone trainer at its side's solo spot.
   */
  enemyTrainer2?: { class: Id; dx: number } | null;
  partnerTrainer?: { class: Id; dx: number; throwTick: number | null } | null;
  /** 0.25.0: by battler id (two in singles, up to four); a slot nobody stands in is left out. */
  battlers: BattlerView[];
  /** The textbox: the message so far (lines joined by \n) and whether it is complete. */
  message: { text: string; done: boolean } | null;
  prompt: BattlePrompt | null;
  /**
   * The thrown ball (0.12.0): the ball item, its DS px centre, the `battle/ball_throws/<ball>` animation
   * (0 spinning, 1 opening) and the tick into it, and its tilt in turns (the shakes). Null when none.
   */
  ball: {
    item: Id;
    x: number;
    y: number;
    anim: 0 | 1;
    tick: number;
    tilt: number;
    /** Blend toward black, 0–1 (the caught ball darkens while its stars fly). */
    shade: number;
    /** Opacity, 0–1 (the caught ball fades out). */
    alpha: number;
    /** Ticks since the caught stars came out of the ball (the ball's `battle/ball_stars/<ball>` sheet), or null. */
    stars: number | null;
    /** 0.29.1. Thrown Bait or Mud in a Safari battle (`battle/ball_throws/bait|mud`) instead of the ball item's art. */
    throw?: 'bait' | 'mud';
  } | null;
  /**
   * 0.29.1. A `safari` battle: the player's Safari healthbox (decomp HEALTHBOX_TYPE_SAFARI_ZONE, "SAFARI BALLS" and
   * the count left) in place of a Pokémon's, with its slide offset. Absent in other battles.
   */
  safari?: { balls: number; healthbox: { visible: boolean; dx: number } };
  /** Black over everything, 0–1 (the end-of-battle fade). */
  fade: number;
  /** The battle animation playing (0.19.0: a move's or a common animation), or null. */
  anim: AnimView | null;
  /**
   * The send-out effect's particles (docs/research/seals.md §6): a Ball Capsule's seals, or the ball's default burst,
   * from the frame the ball opens; drawn like `anim.particles`, over the battlers and under the healthboxes (and under
   * an animation's own). Absent when none play.
   */
  sendOut?: AnimParticle[];
}

/**
 * What a battle animation draws this tick (0.19.0; docs/research/move-animations.md). The battle's
 * animation VM (decomp battle_anim_system.c) runs the ROM's scripts headless at 30 Hz; the scene applies
 * this on top of the `BattleView`: battler sprite changes, the particles (decomp SPL, drawn as the DS does:
 * textured quads, modulated by a vertex colour, with polygon alpha), extra sprites and background effects.
 */
export interface AnimView {
  /** The battlers the animation changes (others draw as the `BattleView` says). */
  battlers: AnimBattlerView[];
  /** In draw order, over the battlers and under the healthboxes. */
  particles: AnimParticle[];
  /** Sprites the animation adds (copies of a battler's sprite, OAM cells), in draw order. */
  sprites: AnimSpriteView[];
  bg: AnimBgView;
  /** Fake Out: black curtains, DS px from the top and bottom edges. */
  curtain?: { top: number; bottom: number };
  /**
   * A background pattern seen only through a battler's silhouette (the stat change arrows: BG2 inside the OBJ
   * window of the battler's sprite copy), scrolled by `dx`/`dy`, at weight `alpha` 0–1 over what is under it.
   * 0.27.6: `mask` is the battler id (was its side).
   */
  overlay: { sheet: Id; dx: number; dy: number; alpha: number; mask: number } | null;
}

/** One battler's sprite as the animation has it (decomp PokemonSprite attributes). */
export interface AnimBattlerView {
  /** 0.27.6: the DS battler id (was `side`: doubles have two a side). */
  battler: number;
  /** DS px offset of the sprite's centre from its place (added to `BattlerView.dx`/`dy`). */
  dx: number;
  dy: number;
  /** 1 = 100 %, about the sprite's centre. */
  scaleX: number;
  scaleY: number;
  /** Turns, clockwise, about the pivot. */
  rotation: number;
  /** The rotation's pivot: DS px from the sprite's centre. */
  pivotX: number;
  pivotY: number;
  hidden: boolean;
  /** Pixels removed from the bottom of the 80 px battler image (Dig). */
  cropBottom?: number;
  /** Palette blend toward `color` (BGR555): `amount` 0–16 (decomp PokemonSprite_StartFade). */
  fade: { color: number; amount: number } | null;
  /** Translucency, 0–1 (1 = opaque). */
  alpha: number;
}

/**
 * One particle: a textured quad. `m` maps the texture's square (u, v in 0–1, v down) to DS px:
 * x = m[0]·u + m[2]·v + m[4], y = m[1]·u + m[3]·v + m[5].
 */
export interface AnimParticle {
  /** The `ui2d` sheet of the particle system's textures, and the texture's cell. */
  textures: Id;
  cell: number;
  m: [number, number, number, number, number, number];
  /** Repeats of the texture across the quad, S and T (1, 2, 4 or 8; negative: the whole quad mirrored). */
  tile: [number, number];
  /** The texture's GX flip bits: every other repeat is mirrored, S and T. */
  mirror: [boolean, boolean];
  /** The vertex colour (BGR555) the texels are multiplied by. */
  color: number;
  /** Polygon alpha, 1–31 (31 opaque). */
  alpha: number;
}

/** A sprite the animation adds: a copy of a battler's sprite, or a cell of a `ui2d` sheet (centre at DS (x, y)). */
export interface AnimSpriteView {
  kind: 'pokemon' | 'cell';
  /** `pokemon`: whose sprite it copies (0.27.6: the battler id, was the side); `x`, `y` are then DS px from that battler's place. */
  battler?: number;
  /** `cell`: the sheet and the cell. */
  sheet?: Id;
  cell?: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  alpha: number;
  fade: { color: number; amount: number } | null;
}

/** The animation's background effects (decomp BG2/BG3 of the battle screen). */
export interface AnimBgView {
  /** The backdrop's palette blend toward `color` (BGR555), `amount` 0–16 (decomp PaletteData fades). */
  fade: { color: number; amount: number } | null;
  /** The backdrop's scroll in DS px (BG shake). */
  dx: number;
  dy: number;
  /**
   * A background switched in over the backdrop (SwitchBg): a `ui2d` sheet (cell 0 as drawn for the player's
   * side, 1 mirrored for the enemy's, 2 a contest's), its weight 0–1 against the backdrop, its scroll and its own fade.
   */
  effect: {
    sheet: Id;
    cell: number;
    alpha: number;
    dx: number;
    dy: number;
    fade: { color: number; amount: number } | null;
    /** Per-row horizontal offsets of the switched layer (HBlank waves), DS rows 0–191, or null. */
    rows: number[] | null;
  } | null;
  /** The backdrop's colours turned to greys (SetBgGrayscale). */
  grayscale: boolean;
}

export interface Battle {
  /** One 30 Hz tick: the timeline advances; d-pad/A/B drive the prompt's cursor. */
  step(input: InputFrame): void;
  /** Answers the current prompt directly (touch, replays). Throws when no prompt waits or the choice is not allowed. */
  choose(choice: BattleChoice): void;
  view(): BattleView;
  /** The result once the battle is over and its exit has played; null until then. */
  done(): BattleResult | null;
  /**
   * The menu app the battle waits on (0.12.0): the battle bag (`bag-select`) or party (`party-select`)
   * while the prompt is `bag` / `party`, else null. The game opens it and steps it instead of the battle;
   * its result goes to `appDone`.
   */
  app(): AppRequest | null;
  /** The app's result: an item or a Pokémon (the turn's choice), or nothing (back to the commands). */
  appDone(result: AppResult): void;
}

export interface BattleDeps {
  registries: Registries;
  /** A copy of the party: the battle works on it and returns it in the result. */
  party: Pokemon[];
  /** The player; `rival` is the rival's name (decomp Trainer_Encounter names TRAINER_CLASS_RIVAL trainers after it). */
  player: { name: string; gender: 'male' | 'female'; trainerId: number; rival: string; language?: number };
  /** Money and badge count (prize money, the loss penalty; 0.14.0). */
  money: number;
  badges: number;
  /** Species caught so far (the enemy healthbox's ball). */
  caught: readonly Id[];
  /** A u32 from the game's main stream: the battle's whole randomness derives from it. */
  seed: number;
  /** A copy of the bag (0.12.0): the battle spends items from it and returns it in the result. */
  bag: Bag;
  /**
   * Where a caught Pokémon goes when the party is full (0.12.0, decomp PCBoxes_FirstEmptyBox from the
   * current box): the current box's name, the first box with room and its name (null: the PC is full, no
   * ball can be thrown), and whether the player met Bebe (her PC, not "someone's").
   */
  pc: { current: { box: number; name: string }; free: { box: number; name: string } | null; metBebe: boolean };
  /** A caught Pokémon's met data (0.12.0): the zone and the date. */
  met: { zone: Id | null; date: string | null };
  /** Frames per character of battle messages (the text speed option). */
  textSpeed: number;
  log: StubLog;
  /**
   * The game's battle sound (0.18.0): `victory()` at the decomp's points (the result check of a won trainer
   * battle; a wild battle's first exp with every foe fainted, or "Gotcha!"); the game picks the music by
   * trainer class. Absent without sound (tests).
   */
  sound?: {
    victory(): void;
    /**
     * The battle animations' sound (0.24.0; decomp Sound_PlayEffect, Sound_StopEffect, Sound_IsEffectPlaying,
     * PlayCryWithParams, Sound_IsPokemonCryPlaying, Sound_StopPokemonCries): sound effects by SDAT sequence
     * number. The animations wait on them as the DS does, so they must be the game's deterministic sound
     * state. Absent (all of them): animations are silent and never wait on sound.
     */
    se?(seq: number): void;
    stopSe?(seq: number): void;
    /** A sound effect plays: `seq`, or any when undefined. */
    sePlaying?(seq?: number): boolean;
    cry?(species: Id, form: number, mod: CryMod, pan: number, volume: number): void;
    cryPlaying?(): boolean;
    stopCries?(): void;
  };
  /**
   * The saved BATTLE SCENE and BATTLE STYLE options (0.20.0; decomp Options battleScene, battleStyle), passed
   * on to the battle: `scene` false skips the move animations, `style` 'shift' asks
   * "Will you change Pokémon?" before a trainer's next Pokémon comes out (decomp BattleSystem_BattleType
   * SHIFT; 'set' never asks). Absent in hosts without saved options (battle tests): scene on, shift.
   */
  options?: { scene: boolean; style: 'shift' | 'set' };
}

export type CreateBattle = (setup: BattleSetup, deps: BattleDeps) => Battle;
