import { isDate, isTime } from './clock.ts';
import { isId, type Id } from './ids.ts';

/**
 * Replay files, one statement per line, `#` comments. Ticks are 30 Hz.
 *
 *   from <file>                       first line only: run that replay first (in memory), then this one
 *   set flag <id> true|false          setup lines: after `from`, before any timed line; applied to the
 *   set var <id> <n>                  state between the two replays (or after reset) by save → edit → load
 *   give item <id> [count]
 *   give badge <id>
 *   party <slot> <species> <level> [move...]   a real Pokémon (contracts `setupPokemon`), marked caught
 *   warp <zone> <x> <z> [facing]    facing: up|down|left|right (default: unchanged); the weather becomes
 *                                     the zone's header weather (a map change; objects respawn)
 *   player walk|cycle [0|1]           player state (cycle: the gear, default 0); cycling (set here or
 *                                     carried over from `from`) fails on a zone whose header disallows the bike
 *   date <yyyy-mm-dd> [hh:mm]         the frozen clock the game sees (date, and time of day: seconds 0)
 *   time <hh:mm>                      … its time of day only (the default clock is 2009-03-22 12:00);
 *                                     both also work as timed actions (`<tick> time 21:00`), which step
 *                                     the frozen clock mid-replay
 *   give money <n> | set money <n>    adds (capped) or sets the player's money
 *   set state <path> <json>           writes a GameState value (`party[0].hp 5`); an optional field may be absent
 *                                     before (`gameTime.swarmDaily 0`), the load validates it
 *   event <name>                      grants a dev-only event (contracts `grantDevEvent`: darkrai, shaymin, arceus,
 *                                     rotom, regigigas): the ROM's distribution var and key item, or a fateful Regigigas
 *   giftcodes test                    Mystery Gift takes the test-only gift codes (services `TEST_GIFT_CODES`)
 *   <tick> open mystery-gift          opens Mystery Gift (the title's MYSTERY GIFT) over the idle field (game
 *                                     `openMysteryGift`); the code entry is its naming screen (`tap type:<code>`)
 *   <tick> tap <id>                   taps an element of the open menu app (AppView tap ids; `type:<text>`
 *                                     types text on the naming screen, no spaces; `pen:<x>,<y>;<x>,<y>…`
 *                                     draws a pen stroke on the trainer card's signature; `spoon:<x>,<y>` puts
 *                                     the stylus on the Poffin pot until `spoon-up`; `seal:<x>,<y>` the capsule
 *                                     editor's stylus until `seal-up`; `dress:<x>,<y>` the dress-up's stylus
 *                                     until `dress-up`; `word:<text id>` the Easy Chat word with that text,
 *                                     wherever the game language sorts it)
 *   until app <name>|none [max]       … until that menu app is open (`mart`, `start-menu`, `bag`, …) or none
 *   assert app <name>|none            the open menu app
 *   assert state <path> <json>|<id>   the GameState value (as `until state` reads it) equals the JSON, or the name
 *                                     or text of that record in the game's language (a trade's nickname
 *                                     as its text id)
 *   assert text <json string>         the message box's text as drawn now (the current page, in full; the
 *                                     script's, else the open menu app's)
 *   assert text <text id> <page> [<n>=<value>…]
 *                                     … page <page> (0-based, split at {clear}) of that text record, its
 *                                     {var n} as the given values (no spaces; a record id such as
 *                                     platinum:SPECIES_BIDOOF is that record's name in the game's
 *                                     language, a text id that text), others any line text, its
 *                                     {color n} codes ignored: ROM
 *                                     replays name texts by id, never by their words
 *   <tick> <action>                   absolute tick, counted from the start of this replay
 *   +<n> <action>                     n ticks after the previous timed line
 *   until idle [max]                  advance until no script runs and the world is idle (fails after max ticks)
 *   until message [max]               … until a message box waits for input (no yes/no, menu or choice up)
 *   until yesno|menu|choice [max]     … until the yes/no box, a script menu or the panel choice is up
 *   until position <x> <z> [max]      … until the player's tile is x,z (set when a step starts)
 *   until state <path> <json> [max]   … until the GameState value (or `battles…`, `mapPopup…`, the open app's view
 *                                     `app…`) equals the JSON; a path
 *                                     can pick an array element by a field: `objects[localId=24].x`
 *   until radar <count> [catch <ball>] [max]  … until the Poké Radar's chain is at `count`: walks into a live patch
 *                                     that keeps the chain (the outermost first, round the other live patches), fights
 *                                     each battle with the `battle auto` policy (with `catch`: throws that ball at every
 *                                     command prompt) and waits out the shakes; fails when no live patch keeps the
 *                                     chain (stand in tall grass with Repel on)
 *   until wild <species> [<dir> <dir>] [max]  … until a field wild battle with that species among the foes is
 *                                     up (its first prompt not answered yet: `battle catch` next). With two
 *                                     directions the wait walks like `grind` (one tile the first way, then back
 *                                     the second; stand in tall grass) and runs from every other wild battle
 *                                     (Run at each command prompt, the first able Pokémon after a faint);
 *                                     without, other wild battles are the replay's `wild` mode's (`auto` fights
 *                                     them, as every wait does)
 *   advance text [max]                press A (one tick down, one up) on every message waiting for input,
 *                                     until a yes/no, menu or choice is up, a battle waits for a choice
 *                                     (not a wild one under `wild auto`), or the game is idle
 *   advance message [max]             press A on every page of the open message box until it closes (or a
 *                                     yes/no, menu, choice or menu app is up, or a battle waits): one
 *                                     conversation, however many pages its text has in the ROM's language;
 *                                     timed as `+0 press a` / `+1 release a` / `until message` per page;
 *                                     with a menu app open, the app's own box (its view's `message`)
 *   <tick> field move <slot> <move>   use a party Pokémon's field move as from the party menu (game
 *                                     `useFieldMove`; fails when it is not usable)
 *   until battle [max]                … until a battle waits for a choice (the command card or a prompt)
 *   until battle end [max]            … until no battle runs (it ended and the field is back)
 *   <tick> battle move <1-4>          answer the battle's prompt (bridge `battleChoose`): fight with that
 *   <tick> battle run                 move slot, run, or at the move-learn prompt forget a slot / keep;
 *   <tick> battle forget <1-4>|keep   fails when no prompt waits or the choice is not allowed
 *   <tick> battle item <item> [1-6] [1-4]  use a bag item (a ball, a battle item; a medicine on that party slot;
 *                                     an Ether-like item on that slot's move)
 *   <tick> battle switch <1-6>        send in that party slot (a switch, or the replacement after a faint)
 *   <tick> battle safari ball|bait|mud  a Safari battle's command card: throw a Safari Ball, Bait or Mud
 *   <tick> battle <1|2> move <1-4> [target <0-3>]   doubles: the player's first or second battler (DS
 *                                     battlers 0 and 2) acts; `target` is the DS battler a single-target move
 *                                     aims at (absent: the DS target screen's first slot). `battle <1|2>` also
 *                                     prefixes `switch`, `item` and `run`; the battle refuses another actor
 *   battle catch <ball> [max]         throw that ball at every command prompt until the battle ends (a wait
 *                                     like `until`; fails after max ticks or on any other prompt; in a Safari
 *                                     battle `<ball>` is ITEM_SAFARI_BALL and BALL is thrown)
 *   battle auto [max]                 fight until the battle ends: at every command prompt the usable move
 *                                     with the most damage by estimate (power, ×1.5 sharing the user's type,
 *                                     × the foe's type matchups; the first on a tie); at a move-learn prompt
 *                                     forget the weakest move (the first on a tie) if the new one is
 *                                     stronger, else keep. A wait like `until`. In doubles it answers every
 *                                     battler the player commands, aiming at the foe its estimate likes best
 *   battle auto move <1-4> [max]      the same, but fighting with that move slot every turn (to lose on
 *                                     purpose: a status move)
 *   grind <slot> <level> <dir> <dir> [max]  levelling with real wild battles: the player steps one tile the
 *                                     first way, then back the second way, again and again (stand in tall
 *                                     grass), every battle is fought with the `battle auto` policy, until
 *                                     the field is idle and party[slot] is at `level` or above, or at half
 *                                     its HP or less (heal, then grind again). A wait
 *   <tick> wild flee|battle|auto      wild encounters flee without a battle (the original stub, for replays not
 *                                     re-recorded with battles yet), start real battles (the default; a
 *                                     reset restores it), or start real battles that every wait (`until …`
 *                                     other than `until battle [end]`, `advance text`) fights with the
 *                                     `battle auto` policy: wild encounters on the way are fought for real
 *   <tick> evolve manual|auto|cancel  the evolution scene (after a battle, a Rare Candy, a stone): left to the
 *                                     replay's own lines (the default; a reset restores it), or played by every
 *                                     wait (`until …` but `until app evolution`, `advance text`, `grind`): A on its
 *                                     messages, never a move replaced (NO, then give up), and with `cancel` B
 *                                     as soon as it can be stopped ("as if B were pressed")
 *   <tick> reload                     save, then load that save now (the game re-enters the map); fails
 *                                     when saving is not allowed or the loaded state differs from the saved one
 *   <tick> reset                      after `clear_game`'s credits the game has reset (snapshot `reset`): load
 *                                     the save the clear wrote, as the title's CONTINUE does; fails before
 *
 * Every `until` and `advance text` advances at least one tick and checks after each tick; all of them
 * fail after `max` ticks (default UNTIL_MAX). They run in one loop next to the game (headless, or in the
 * page), so their length depends only on the state, never on wall time.
 * Absolute ticks are non-decreasing and are not allowed after an `until` (its length is not static).
 * Actions on a tick run in file order before that tick advances.
 *
 * Battle log asserts by content (the log is not saved; battle changes alter lengths, not entries):
 *   assert battle <kind> <id> <result>   the entries of that kind (trainer|scripted|wild) with that trainer
 *                                        or species id: at least one, and all ended <result> (won|lost|draw|
 *                                        fled|enemy-fled|caught)
 *   assert battle <kind> * <result>      every entry of that kind (any number) ended <result>
 *   assert battle <kind> <id|*> <result> <topology>   … and every one of them had that topology
 *                                        (single|double|trainer-pair|ai-partner; contracts BattleTopology)
 *   assert battles <kind> <n>                    the log has n entries of that kind
 */
export const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'x', 'y', 'l', 'r', 'start', 'select'] as const;
export type Button = (typeof BUTTONS)[number];
export const FACINGS = ['up', 'down', 'left', 'right'] as const;
export type ReplayFacing = (typeof FACINGS)[number];
/** An `until` or `advance text` without a max gives up after this many ticks (60 s). */
export const UNTIL_MAX = 1800;
export const BATTLE_KINDS = ['trainer', 'scripted', 'wild', 'frontier'] as const;
export type LogBattleKind = (typeof BATTLE_KINDS)[number];
/** Decomp BATTLE_RESULT_* (contracts `BattleOutcome`). */
export const BATTLE_RESULTS = ['won', 'lost', 'draw', 'fled', 'enemy-fled', 'caught'] as const;
export type LogBattleResult = (typeof BATTLE_RESULTS)[number];
/** Contracts `BattleTopology` (0.25.0). */
export const BATTLE_TOPOLOGIES = ['single', 'double', 'trainer-pair', 'ai-partner'] as const;
export type LogBattleTopology = (typeof BATTLE_TOPOLOGIES)[number];
/**
 * What `battle …` actions answer (contracts `BattleChoice`; move and forget slots 0-based here, 1–4 in the file).
 * `battler`: the acting DS battler (`battle 1 …` → 0, `battle 2 …` → 2); `target` a DS battler id.
 */
export type ReplayBattleChoice =
  | { kind: 'move'; slot: number; target?: number; battler?: number }
  | { kind: 'run'; battler?: number }
  | { kind: 'forget'; slot: number }
  | { kind: 'answer'; yes: boolean }
  | { kind: 'keep' }
  | { kind: 'item'; item: Id; target?: number; move?: number; battler?: number }
  | { kind: 'switch'; slot: number; battler?: number }
  | { kind: 'safari'; action: 'ball' | 'bait' | 'mud' };

/**
 * A JSON path into the snapshot: `badges`, `pokedex.obtained`, `items.platinum:ITEM_JOURNAL`, `battles[0].trainers`,
 * and `objects[localId=24].x` (the first array element whose field equals the number or JSON string).
 */
export type StatePath = (string | number | { field: string; equals: string | number })[];

export type ReplayAction =
  | { type: 'press' | 'release'; button: Button }
  | { type: 'touch'; x: number; y: number }
  | { type: 'untouch' }
  /** `tap <id>`: a tap on the open menu app's element (InputFrame.tap, next tick). */
  | { type: 'tap'; id: string }
  | { type: 'screenshot'; name: string }
  | { type: 'viewport'; width: number; height: number }
  /**
   * `until …`; `until position` coordinates may be read from the state when the step runs (`read`, a
   * `{path}` or `{path|k=v,…}` argument): what the player reads on screen, such as the Hearthome Gym clue's door.
   */
  | { type: 'until'; until: UntilCondition; max: number; read?: { x?: StateArg; z?: StateArg } }
  /** `advance text`, or with `close` `advance message` (until the message box closes). */
  | { type: 'advance-text'; max: number; close?: true }
  | { type: 'field-move'; slot: number; move: Id }
  | { type: 'battle'; choice: ReplayBattleChoice }
  /** `battle auto [move <1-4>] [max]`: `move` (0-based) fights with that slot every turn instead of the policy's pick. */
  | { type: 'battle-auto'; max: number; move?: number }
  | { type: 'grind'; slot: number; level: number; dirs: [ReplayFacing, ReplayFacing]; max: number }
  | { type: 'battle-catch'; ball: Id; max: number }
  | { type: 'wild'; mode: 'flee' | 'battle' | 'auto' }
  | { type: 'evolve'; mode: 'manual' | 'auto' | 'cancel' }
  | { type: 'reload' }
  /** `reset`: the game reset after `clear_game`'s credits; load the save the clear wrote (the title's CONTINUE). */
  | { type: 'reset' }
  /** `open mystery-gift`: Mystery Gift over the idle field (the title's screen; the replays' way in). */
  | { type: 'open'; app: 'mystery-gift' }
  /** `date <yyyy-mm-dd> [hh:mm]` / `time <hh:mm>` as a timed action: sets the frozen clock now. */
  | { type: 'clock'; date?: string; time?: string }
  | { type: 'assert'; what: 'map'; id: Id }
  | { type: 'assert'; what: 'position'; zone: Id; x: number; z: number }
  | { type: 'assert'; what: 'flag'; id: Id; value: boolean }
  | { type: 'assert'; what: 'var'; id: Id; value: number }
  | { type: 'assert'; what: 'party'; index: number; species: Id }
  | { type: 'assert'; what: 'message'; open: boolean }
  /** `assert text <json string>`: the message box's text as drawn now (its current page, the whole page). */
  | { type: 'assert'; what: 'text'; text: string }
  /** `assert text <text id> <page> [<n>=<value>…]`: the message box shows that page of the text record. */
  | { type: 'assert'; what: 'text-id'; id: Id; page: number; vars: Record<number, string> }
  /** `assert facing player <dir>` or `assert facing <localId> <dir>` (an object in the current zone). */
  | { type: 'assert'; what: 'facing'; target: 'player' | number; facing: ReplayFacing }
  /**
   * `assert state <path> <json>`: the GameState value (or the battle log for `battles…`, the open app's view for `app…`)
   * equals the JSON. `assert state <path> <record id>`: equals that record's name or text in the game's language (`name`).
   */
  | { type: 'assert'; what: 'state'; path: StatePath; source: string; value: unknown; name?: Id }
  /** `assert battle <kind> <id|*> <result> [topology]`: `match` is a trainer or species id, null for `*`. */
  | { type: 'assert'; what: 'battle'; kind: LogBattleKind; match: Id | null; result: LogBattleResult; topology?: LogBattleTopology }
  | { type: 'assert'; what: 'battles'; kind: LogBattleKind; count: number }
  /** `assert app <name>|none`: the open menu app's view (`AppView.app`), or none. */
  | { type: 'assert'; what: 'app'; app: string | null };

/**
 * A step argument read from the state when the step runs: `{<path>}` is the number at the state path,
 * `{<path>|k=v,k=v}` the value `v` of the key `k` equal to that number. Resolving fails loudly when the path
 * is missing, not a number, or not a key of the map.
 */
export interface StateArg {
  path: StatePath;
  source: string;
  map?: Record<number, number>;
}

/** Parses a `{path}` or `{path|k=v,…}` step argument; null when `s` is not one. */
export function parseStateArg(s: string): StateArg | null {
  const m = /^\{([^|{}]+)(?:\|(-?\d+=-?\d+(?:,-?\d+=-?\d+)*))?\}$/.exec(s);
  if (!m) return null;
  const path = parseStatePath(m[1]!);
  if (!path) return null;
  if (!m[2]) return { path, source: m[1]! };
  const map: Record<number, number> = {};
  for (const pair of m[2].split(',')) {
    const [k, v] = pair.split('=').map(Number) as [number, number];
    if (k in map) return null;
    map[k] = v;
  }
  return { path, source: m[1]!, map };
}

/** The number a `StateArg` stands for in `root` (the GameState); throws when it cannot be read. */
export function resolveStateArg(arg: StateArg, root: unknown): number {
  const value = readStatePath(root, arg.path);
  if (typeof value !== 'number') throw new Error(`state argument {${arg.source}}: ${value === undefined ? 'no such state' : `not a number: ${JSON.stringify(value)}`}`);
  if (!arg.map) return value;
  const out = arg.map[value];
  if (out === undefined) throw new Error(`state argument {${arg.source}}: ${value} is not one of ${Object.keys(arg.map).join(', ')}`);
  return out;
}

/** What an `until` waits for (plain data: the browser driver sends it into the page). */
export type UntilCondition =
  | { kind: 'idle' | 'message' | 'yesno' | 'menu' | 'choice' }
  /** `until battle`: a battle waits for a choice; `until battle end`: no battle runs (back in the field). */
  | { kind: 'battle' | 'battle-end' }
  | { kind: 'position'; x: number; z: number }
  | { kind: 'state'; path: StatePath; source: string; value: unknown }
  /** The open menu app is `app` (an `AppView.app` name), or none is open (`null`). */
  | { kind: 'app'; app: string | null }
  /**
   * A field wild battle against `species` is up (`until wild`); with `walk`, the wait steps one tile the first way
   * and back the second, again and again, and runs from every other wild battle.
   */
  | { kind: 'wild'; species: Id; walk?: [ReplayFacing, ReplayFacing] }
  /**
   * 0.31.0. `until radar <count> [catch <ball>]`: the Poké Radar's chain reaches `count`. The wait walks into a live
   * patch that keeps the chain (the outermost first, round any other live patch), fights each battle with the `battle
   * auto` policy (or throws `ball` at every command prompt) and waits out the shakes; it fails when no live patch keeps
   * the chain.
   */
  | { kind: 'radar'; count: number; ball?: Id };

export type ReplaySetup =
  | { type: 'flag'; id: Id; value: boolean }
  | { type: 'var'; id: Id; value: number }
  | { type: 'item'; id: Id; count: number }
  | { type: 'badge'; id: Id }
  | { type: 'party'; slot: number; species: Id; level: number; moves: Id[] }
  | { type: 'warp'; zone: Id; x: number; z: number; facing?: ReplayFacing }
  /** `give money <n>` adds (capped at the money maximum); `set money <n>` sets. */
  | { type: 'money'; mode: 'give' | 'set'; amount: number }
  /** `set state <path> <json>`: writes a GameState value (counters, HP, …); the path must exist. */
  | { type: 'state'; path: StatePath; source: string; value: unknown }
  | { type: 'player'; state: 'walk' }
  | { type: 'player'; state: 'cycle'; gear: 0 | 1 }
  /** `event <name>`: a dev-only event (contracts `DEV_EVENTS`), checked by the runner. */
  | { type: 'event'; name: string }
  /** `giftcodes test`: Mystery Gift takes the test-only codes. */
  | { type: 'giftcodes' }
  /** `date <yyyy-mm-dd> [hh:mm]` / `time <hh:mm>`: the frozen game clock (not state: the runner sends it to the driver). */
  | { type: 'clock'; date?: string; time?: string };

export interface ReplayLine {
  line: number;
  /** When the action runs: an absolute tick of this replay, or ticks after the previous timed line. */
  at: { tick: number } | { after: number };
  action: ReplayAction;
}

export interface Replay {
  from: { line: number; file: string } | null;
  setup: { line: number; text: string; setup: ReplaySetup }[];
  lines: ReplayLine[];
}

function int(s: string | undefined, err: () => never): number {
  if (s === undefined || !/^-?\d+$/.test(s)) err();
  return Number(s);
}

function id(s: string | undefined, err: () => never): Id {
  if (s === undefined || !isId(s)) err();
  return s;
}

/** `a.b[0]["c.d"][id=3]` → ['a', 'b', 0, 'c.d', {field: 'id', equals: 3}]. Plain segments may contain `:` (ids). */
export function parseStatePath(s: string): StatePath | null {
  const head = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s);
  if (!head) return null;
  const out: StatePath = [head[0]];
  const re = /^(?:\.([A-Za-z_][A-Za-z0-9_:-]*)|\[(\d+)\]|\[("(?:[^"\\]|\\.)*")\]|\[([A-Za-z_][A-Za-z0-9_]*)=(-?\d+|"(?:[^"\\]|\\.)*")\])/;
  let rest = s.slice(head[0].length);
  while (rest) {
    const m = re.exec(rest);
    if (!m) return null;
    if (m[4] !== undefined) out.push({ field: m[4], equals: JSON.parse(m[5]!) as string | number });
    else out.push(m[1] ?? (m[2] !== undefined ? Number(m[2]) : (JSON.parse(m[3]!) as string)));
    rest = rest.slice(m[0].length);
  }
  return out;
}

function parseAction(verb: string | undefined, rest: string[], tail: string, err: () => never): ReplayAction {
  if (verb === 'press' || verb === 'release') {
    const button = rest[0] as Button;
    if (rest.length !== 1 || !BUTTONS.includes(button)) err();
    return { type: verb, button };
  }
  if (verb === 'touch' && rest.length === 2) return { type: 'touch', x: int(rest[0], err), y: int(rest[1], err) };
  if (verb === 'untouch' && rest.length === 0) return { type: 'untouch' };
  if (verb === 'reload' && rest.length === 0) return { type: 'reload' };
  if (verb === 'reset' && rest.length === 0) return { type: 'reset' };
  if (verb === 'open' && rest.length === 1 && rest[0] === 'mystery-gift') return { type: 'open', app: 'mystery-gift' };
  if (verb === 'date' || verb === 'time') return parseClock(verb, rest, err);
  if (verb === 'tap' && rest.length === 1 && (/^[a-z-]+(:[a-z0-9+-]+)*$/.test(rest[0]!) || /^type:\S+$/.test(rest[0]!) || /^pen:-?\d+,-?\d+(;-?\d+,-?\d+)*$/.test(rest[0]!) || /^(spoon|hit|tile|rub|seal|dress):-?\d+,-?\d+$/.test(rest[0]!) || /^word:[a-z0-9-]+:\S+$/.test(rest[0]!))) return { type: 'tap', id: rest[0]! };
  if (verb === 'screenshot' && rest.length === 1 && /^[A-Za-z0-9_-]+$/.test(rest[0]!)) return { type: 'screenshot', name: rest[0]! };
  if (verb === 'viewport' && rest.length === 1) {
    const m = /^(\d+)x(\d+)$/.exec(rest[0]!) ?? err();
    return { type: 'viewport', width: Number(m[1]), height: Number(m[2]) };
  }
  const maxOf = (s: string | undefined) => {
    const max = s === undefined ? UNTIL_MAX : int(s, err);
    if (max < 1) err();
    return max;
  };
  if (verb === 'until') {
    const [kind, a, b, c] = rest;
    if ((kind === 'idle' || kind === 'message' || kind === 'yesno' || kind === 'menu' || kind === 'choice') && rest.length <= 2) return { type: 'until', until: { kind }, max: maxOf(a) };
    if (kind === 'battle' && a === 'end' && rest.length <= 3) return { type: 'until', until: { kind: 'battle-end' }, max: maxOf(b) };
    if (kind === 'battle' && rest.length <= 2) return { type: 'until', until: { kind }, max: maxOf(a) };
    if (kind === 'position' && (rest.length === 3 || rest.length === 4)) {
      const xs = a!.startsWith('{') ? (parseStateArg(a!) ?? err()) : null;
      const zs = b!.startsWith('{') ? (parseStateArg(b!) ?? err()) : null;
      const until = { kind, x: xs ? 0 : int(a, err), z: zs ? 0 : int(b, err) } as const;
      if (!xs && !zs) return { type: 'until', until, max: maxOf(c) };
      return { type: 'until', until, max: maxOf(c), read: { ...(xs && { x: xs }), ...(zs && { z: zs }) } };
    }
    if (kind === 'app' && (rest.length === 2 || rest.length === 3) && APP_NAME.test(a!)) return { type: 'until', until: { kind, app: a === 'none' ? null : a! }, max: maxOf(b) };
    if (kind === 'wild' && rest.length >= 2 && rest.length <= 5) {
      const species = id(a, err);
      if (rest.length <= 3) return { type: 'until', until: { kind, species }, max: maxOf(b) };
      if (!FACINGS.includes(b as ReplayFacing) || !FACINGS.includes(c as ReplayFacing)) err();
      return { type: 'until', until: { kind, species, walk: [b as ReplayFacing, c as ReplayFacing] }, max: maxOf(rest[4]) };
    }
    if (kind === 'radar' && rest.length >= 2 && rest.length <= 5) {
      const count = int(a, err);
      if (count < 1) err();
      if (b === 'catch') {
        if (rest.length < 4) err();
        return { type: 'until', until: { kind, count, ball: id(c, err) }, max: maxOf(rest[4]) };
      }
      if (rest.length > 3) err();
      return { type: 'until', until: { kind, count }, max: maxOf(b) };
    }
    if (kind === 'state' && a !== undefined && rest.length >= 3) {
      const path = parseStatePath(a) ?? err();
      const json = /^until\s+state\s+\S+\s+(.*)$/.exec(tail)?.[1] ?? err();
      // The JSON may contain spaces; a trailing integer that does not belong to it is the max.
      const whole = parseJson(json);
      if (whole) return { type: 'until', until: { kind, path, source: a, value: whole.value }, max: UNTIL_MAX };
      const m = /^(.*\S)\s+(\d+)$/.exec(json) ?? err();
      return { type: 'until', until: { kind, path, source: a, value: (parseJson(m[1]!) ?? err()).value }, max: maxOf(m[2]) };
    }
    err();
  }
  if (verb === 'advance' && rest[0] === 'text' && rest.length <= 2) return { type: 'advance-text', max: maxOf(rest[1]) };
  if (verb === 'advance' && rest[0] === 'message' && rest.length <= 2) return { type: 'advance-text', max: maxOf(rest[1]), close: true };
  if (verb === 'field' && rest[0] === 'move' && rest.length === 3) {
    const slot = int(rest[1], err);
    if (slot < 0 || slot > 5) err();
    return { type: 'field-move', slot, move: id(rest[2], err) };
  }
  if (verb === 'battle') {
    // `battle <1|2> move|switch|item|run …`: the acting battler (the player's first or second).
    const actor = (rest[0] === '1' || rest[0] === '2') && ['move', 'switch', 'item', 'run'].includes(rest[1]!) ? (rest[0] === '1' ? 0 : 2) : undefined;
    if (actor !== undefined) rest = rest.slice(1);
    const who = actor === undefined ? {} : { battler: actor };
    const [what, n] = rest;
    const slot = () => {
      const v = int(n, err);
      if (v < 1 || v > 4) err();
      return v - 1;
    };
    if (what === 'move' && rest.length === 2) return { type: 'battle', choice: { kind: 'move', slot: slot(), ...who } };
    if (what === 'move' && rest.length === 4 && rest[2] === 'target') {
      const target = int(rest[3], err);
      if (target < 0 || target > 3) err();
      return { type: 'battle', choice: { kind: 'move', slot: slot(), target, ...who } };
    }
    if (what === 'answer' && rest.length === 2 && (rest[1] === 'yes' || rest[1] === 'no')) return { type: 'battle', choice: { kind: 'answer', yes: rest[1] === 'yes' } };
    if (what === 'forget' && rest.length === 2) return { type: 'battle', choice: { kind: 'forget', slot: slot() } };
    if (what === 'run' && rest.length === 1) return { type: 'battle', choice: { kind: what, ...who } };
    if (what === 'keep' && rest.length === 1 && actor === undefined) return { type: 'battle', choice: { kind: what } };
    if (what === 'safari' && rest.length === 2 && actor === undefined && (n === 'ball' || n === 'bait' || n === 'mud')) return { type: 'battle', choice: { kind: 'safari', action: n } };
    if (what === 'auto' && rest.length <= 2) return { type: 'battle-auto', max: maxOf(n) };
    if (what === 'auto' && n === 'move' && (rest.length === 3 || rest.length === 4)) {
      const v = int(rest[2], err);
      if (v < 1 || v > 4) err();
      return { type: 'battle-auto', move: v - 1, max: maxOf(rest[3]) };
    }
    const partySlot = (v: string | undefined) => {
      const k = int(v, err);
      if (k < 1 || k > 6) err();
      return k - 1;
    };
    if (what === 'item' && rest.length >= 2 && rest.length <= 4) {
      const move = () => {
        const v = int(rest[3], err);
        if (v < 1 || v > 4) err();
        return v - 1;
      };
      return { type: 'battle', choice: { kind: 'item', item: id(n, err), ...(rest.length >= 3 ? { target: partySlot(rest[2]) } : {}), ...(rest.length === 4 ? { move: move() } : {}), ...who } };
    }
    if (what === 'switch' && rest.length === 2) return { type: 'battle', choice: { kind: 'switch', slot: partySlot(n), ...who } };
    if (what === 'catch' && (rest.length === 2 || rest.length === 3)) return { type: 'battle-catch', ball: id(n, err), max: maxOf(rest[2]) };
    err();
  }
  if (verb === 'grind' && (rest.length === 4 || rest.length === 5)) {
    const [slot, level, a, b] = rest;
    if (!FACINGS.includes(a as ReplayFacing) || !FACINGS.includes(b as ReplayFacing)) err();
    const s = int(slot, err);
    const l = int(level, err);
    if (s < 0 || s > 5 || l < 1 || l > 100) err();
    return { type: 'grind', slot: s, level: l, dirs: [a as ReplayFacing, b as ReplayFacing], max: maxOf(rest[4]) };
  }
  if (verb === 'wild' && rest.length === 1 && (rest[0] === 'flee' || rest[0] === 'battle' || rest[0] === 'auto')) return { type: 'wild', mode: rest[0] };
  if (verb === 'evolve' && rest.length === 1 && (rest[0] === 'manual' || rest[0] === 'auto' || rest[0] === 'cancel')) return { type: 'evolve', mode: rest[0] };
  if (verb !== 'assert') err();
  const [what, a, b] = rest;
  if (what === 'map' && rest.length === 2) return { type: 'assert', what, id: id(a, err) };
  if (what === 'position' && rest.length === 4) return { type: 'assert', what, zone: id(a, err), x: int(b, err), z: int(rest[3], err) };
  if (what === 'flag' && rest.length === 3 && (b === 'true' || b === 'false')) return { type: 'assert', what, id: id(a, err), value: b === 'true' };
  if (what === 'var' && rest.length === 3) return { type: 'assert', what, id: id(a, err), value: int(b, err) };
  if (what === 'party' && rest.length === 3) return { type: 'assert', what, index: int(a, err), species: id(b, err) };
  if (what === 'message' && rest.length === 2 && (a === 'open' || a === 'closed')) return { type: 'assert', what, open: a === 'open' };
  if (what === 'text' && rest.length >= 3 && !a!.startsWith('"')) {
    const vars: Record<number, string> = {};
    for (const v of rest.slice(3)) {
      const m = /^(\d+)=(\S+)$/.exec(v) ?? err();
      vars[Number(m[1])] = m[2]!;
    }
    return { type: 'assert', what: 'text-id', id: id(a, err), page: int(b, err), vars };
  }
  if (what === 'text' && rest.length >= 2) {
    const value = parseJson(/^assert\s+text\s+(.*)$/.exec(tail)?.[1] ?? err())?.value;
    if (typeof value !== 'string') err();
    return { type: 'assert', what, text: value };
  }
  if (what === 'app' && rest.length === 2 && APP_NAME.test(a!)) return { type: 'assert', what, app: a === 'none' ? null : a! };
  if (what === 'facing' && rest.length === 3 && FACINGS.includes(b as ReplayFacing)) {
    return { type: 'assert', what, target: a === 'player' ? 'player' : int(a, err), facing: b as ReplayFacing };
  }
  if (what === 'state' && a !== undefined && rest.length >= 3) {
    const path = parseStatePath(a) ?? err();
    // The JSON is the rest of the line after the path (it may contain spaces).
    const json = /^assert\s+state\s+\S+\s+(.*)$/.exec(tail)?.[1] ?? err();
    if (/^[a-z0-9-]+:\S+$/.test(json)) return { type: 'assert', what, path, source: a, value: null, name: id(json, err) };
    return { type: 'assert', what, path, source: a, value: (parseJson(json) ?? err()).value };
  }
  if (what === 'battle' && (rest.length === 4 || (rest.length === 5 && BATTLE_TOPOLOGIES.includes(rest[4] as LogBattleTopology))) && BATTLE_KINDS.includes(a as LogBattleKind) && BATTLE_RESULTS.includes(rest[3] as LogBattleResult)) {
    return { type: 'assert', what, kind: a as LogBattleKind, match: b === '*' ? null : id(b, err), result: rest[3] as LogBattleResult, ...(rest[4] ? { topology: rest[4] as LogBattleTopology } : {}) };
  }
  if (what === 'battles' && rest.length === 3 && BATTLE_KINDS.includes(a as LogBattleKind)) {
    const count = int(b, err);
    if (count < 0) err();
    return { type: 'assert', what, kind: a as LogBattleKind, count };
  }
  return err();
}

function parseJson(s: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(s) as unknown };
  } catch {
    return null;
  }
}

/** `date <yyyy-mm-dd> [hh:mm]` or `time <hh:mm>`. */
function parseClock(verb: 'date' | 'time', rest: string[], err: () => never): { type: 'clock'; date?: string; time?: string } {
  const [a, b] = rest;
  if (verb === 'time' && rest.length === 1 && isTime(a!)) return { type: 'clock', time: a! };
  if (verb === 'date' && (rest.length === 1 || rest.length === 2) && isDate(a!) && (b === undefined || isTime(b))) return { type: 'clock', date: a!, ...(b ? { time: b } : {}) };
  return err();
}

/** Menu app names (`AppView.app`: `start-menu`, `mart`, …) or `none`. */
const APP_NAME = /^[a-z]+(-[a-z]+)*$/;

function parseSetup(words: string[], err: () => never, line: string): ReplaySetup | null {
  const [verb, kind, a, b, ...more] = words;
  if ((verb === 'give' || verb === 'set') && kind === 'money' && words.length === 3) {
    const amount = int(a, err);
    if (amount < 0) err();
    return { type: 'money', mode: verb, amount };
  }
  if (verb === 'set' && kind === 'state' && a !== undefined && words.length >= 4) {
    const path = parseStatePath(a) ?? err();
    const json = /^set\s+state\s+\S+\s+(.*)$/.exec(line)?.[1] ?? err();
    return { type: 'state', path, source: a, value: (parseJson(json) ?? err()).value };
  }
  if (verb === 'set' && kind === 'flag' && words.length === 4 && (b === 'true' || b === 'false')) return { type: 'flag', id: id(a, err), value: b === 'true' };
  if (verb === 'set' && kind === 'var' && words.length === 4) return { type: 'var', id: id(a, err), value: int(b, err) };
  if (verb === 'give' && kind === 'item' && (words.length === 3 || words.length === 4)) {
    const count = b === undefined ? 1 : int(b, err);
    if (count < 1) err();
    return { type: 'item', id: id(a, err), count };
  }
  if (verb === 'give' && kind === 'badge' && words.length === 3) return { type: 'badge', id: id(a, err) };
  if (verb === 'party' && words.length >= 4) {
    const level = int(b, err);
    if (level < 1 || level > 100) err();
    return { type: 'party', slot: int(kind, err), species: id(a, err), level, moves: more.map((m) => id(m, err)) };
  }
  if (verb === 'warp' && (words.length === 4 || (words.length === 5 && FACINGS.includes(more[0] as ReplayFacing)))) {
    return { type: 'warp', zone: id(kind, err), x: int(a, err), z: int(b, err), ...(more[0] ? { facing: more[0] as ReplayFacing } : {}) };
  }
  if (verb === 'player' && kind === 'walk' && words.length === 2) return { type: 'player', state: 'walk' };
  if (verb === 'player' && kind === 'cycle' && words.length <= 3) {
    if (a !== undefined && a !== '0' && a !== '1') err();
    return { type: 'player', state: 'cycle', gear: a === '1' ? 1 : 0 };
  }
  if (verb === 'date' || verb === 'time') return parseClock(verb, words.slice(1), err);
  if (verb === 'event' && words.length === 2 && /^[a-z]+$/.test(kind!)) return { type: 'event', name: kind! };
  if (verb === 'giftcodes' && words.length === 2 && kind === 'test') return { type: 'giftcodes' };
  if (verb === 'set' || verb === 'give' || verb === 'party' || verb === 'warp' || verb === 'player' || verb === 'event' || verb === 'giftcodes') err();
  return null;
}

export function parseReplay(text: string): Replay {
  const replay: Replay = { from: null, setup: [], lines: [] };
  /** This replay's tick at the previous timed line; null once an `until` makes it dynamic. */
  let cursor: number | null = 0;
  let statements = 0;
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.replace(/#.*/, '').trim();
    if (!trimmed) return;
    statements++;
    function err(): never {
      throw new Error(`Replay line ${line}: cannot parse "${trimmed}"`);
    }
    const words = trimmed.split(/\s+/);
    const [first] = words as [string];
    if (first === 'from') {
      if (statements !== 1 || words.length !== 2) throw new Error(`Replay line ${line}: "from <replay>" must be the first line`);
      replay.from = { line, file: words[1]! };
      return;
    }
    const setup = parseSetup(words, err, trimmed);
    if (setup) {
      if (replay.lines.length) throw new Error(`Replay line ${line}: setup lines must come before the first timed line`);
      replay.setup.push({ line, text: trimmed, setup });
      return;
    }
    if (first === 'until' || first === 'advance' || first === 'grind' || (first === 'battle' && (words[1] === 'auto' || words[1] === 'catch'))) {
      replay.lines.push({ line, at: { after: 0 }, action: parseAction(first, words.slice(1), trimmed, err) });
      cursor = null;
      return;
    }
    let at: ReplayLine['at'];
    if (/^\+\d+$/.test(first)) {
      const after = Number(first.slice(1));
      at = { after };
      if (cursor !== null) cursor += after;
    } else {
      const tick = int(first, err);
      if (cursor === null) throw new Error(`Replay line ${line}: absolute tick ${tick} after an "until"; use +N`);
      if (tick < cursor) throw new Error(`Replay line ${line}: tick ${tick} goes backwards`);
      cursor = tick;
      at = { tick };
    }
    const action = parseAction(words[1], words.slice(2), trimmed.slice(first.length).trim(), err);
    if (action.type === 'until' || action.type === 'advance-text' || action.type === 'battle-auto' || action.type === 'battle-catch' || action.type === 'grind') cursor = null;
    replay.lines.push({ line, at, action });
  });
  return replay;
}

/** Value at `path` (undefined when missing). */
export function readStatePath(root: unknown, path: StatePath): unknown {
  let cur = root;
  for (const seg of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    if (typeof seg !== 'object') cur = (cur as Record<string | number, unknown>)[seg];
    else if (!Array.isArray(cur)) return undefined;
    else cur = cur.find((x: unknown) => x !== null && typeof x === 'object' && (x as Record<string, unknown>)[seg.field] === seg.equals);
  }
  return cur;
}

/** Structural JSON equality (object key order does not matter). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((x, i) => jsonEqual(x, (b as unknown[])[i]));
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => jsonEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
