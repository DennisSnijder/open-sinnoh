/**
 * The replay grammar's `until …` and `advance text` (core `replay.ts`), as loops over a game. The
 * headless driver runs them on a Game; the app's bridge runs the same functions in the page, so a
 * browser replay pays one round trip per line, not per tick.
 */
import { jsonEqual, RADAR_BATTERY_STEPS, readStatePath, type Button, type Id, type UntilCondition } from '@opensinnoh/core';
import type { AppView, BattleChoice, BattleLogEntry, BattleView, EvolutionMode, GameState, MapPopupView, Registries, ScriptView, WildBattleMode } from '@opensinnoh/contracts';

/** What the loops read and drive: the live game (no snapshot clones per tick). */
export interface UntilTarget {
  tick(): void;
  canSave(): boolean;
  view(): ScriptView;
  state(): GameState;
  battles(): readonly BattleLogEntry[];
  mapPopup(): MapPopupView | null;
  /** The running battle's view (null in the field or while its engine loads) and whether one is active. */
  battle(): BattleView | null;
  inBattle(): boolean;
  /** The open menu app's name (AppView.app), or null. */
  app(): string | null;
  /** The blackout screen waits for A or B (0.19.0). */
  blackOutWaiting(): boolean;
  press(button: Button): void;
  release(button: Button): void;
  battleChoose(choice: BattleChoice): void;
  /** The game's wild battle mode: `auto` makes every wait fight a wild battle's prompts (`autoChoice`). */
  wildBattles(): WildBattleMode;
  /** The game's records (the auto policy reads move and species types). */
  registries(): Registries;
  /** The replay's evolution mode (`evolve …`) and the open app's view, which the waits play under `auto`/`cancel`. */
  evolutions(): EvolutionMode;
  appView(): AppView | null;
  /** A tap on the open app next tick (InputFrame.tap). */
  tap(id: string): void;
  /** 0.31.0. The Poké Radar's live patches (`World.radarPatches`; `until radar`). */
  radar(): { count: number; patches: { x: number; z: number; continues: boolean }[] } | null;
}

/** `until idle` holds when the game was idle (`Game.canSave`) at the end of this many ticks in a row. */
export const IDLE_TICKS = 2;

/** The game waits on the player for something other than a plain message: yes/no, a menu or the panel choice. */
function choosing(view: ScriptView): boolean {
  return view.yesNo !== null || view.menu !== null || view.panel.kind === 'choice';
}

function holds(t: UntilTarget, until: UntilCondition): boolean {
  switch (until.kind) {
    case 'idle':
      throw new Error('until idle is counted in runUntil');
    case 'message': {
      const view = t.view();
      return (view.message?.waitingForInput === true || view.waitsForAB === true || view.frontier?.waitsForAB === true) && !choosing(view);
    }
    case 'yesno':
      return t.view().yesNo !== null;
    case 'menu':
      return t.view().menu !== null;
    case 'choice':
      return t.view().panel.kind === 'choice';
    case 'position': {
      const p = t.state().player;
      return p.x === until.x && p.z === until.z;
    }
    case 'battle':
      return t.battle()?.prompt != null;
    case 'battle-end':
      return !t.inBattle();
    case 'state': {
      const root = until.path[0] === 'battles' ? { battles: t.battles() } : until.path[0] === 'mapPopup' ? { mapPopup: t.mapPopup() } : until.path[0] === 'app' ? { app: t.appView() } : t.state();
      const actual = readStatePath(root, until.path);
      return jsonEqual(until.value, actual);
    }
    case 'app': {
      return t.app() === until.app;
    }
    case 'wild':
      return wildAgainst(t, until.species);
    case 'radar':
      throw new Error('until radar is walked in walkRadar');
  }
}

/** A field wild battle with `species` among its foes is up (its view: the engine has started). */
function wildAgainst(t: UntilTarget, species: Id): boolean {
  const view = t.battle();
  return (view?.kind === 'wild' || view?.kind === 'safari') && view.battlers.some((b) => b.side === 'enemy' && b.species === species);
}

/**
 * Ticks until the condition holds after a tick (at least one tick). `idle` needs IDLE_TICKS idle ticks
 * in a row, so a trigger that fires right after a scene (an on-frame script) counts as busy. Returns the
 * ticks advanced, or null after `max`.
 */
export function runUntil(t: UntilTarget, until: UntilCondition, max: number): number | null {
  if (until.kind === 'wild' && until.walk) return walkUntilWild(t, until.species, until.walk, max);
  if (until.kind === 'radar') return walkRadar(t, until.count, until.ball ?? null, max);
  let idle = 0;
  const fight = until.kind !== 'battle' && until.kind !== 'battle-end';
  for (let n = 1; n <= max; n++) {
    if (fight) wildAuto(t);
    if (until.kind !== 'app' || until.app !== 'evolution') evolveAuto(t);
    t.tick();
    if (until.kind === 'idle') {
      idle = t.canSave() ? idle + 1 : 0;
      if (idle === IDLE_TICKS) return n;
    } else if (holds(t, until)) return n;
  }
  return null;
}

/**
 * `advance text`: A goes down for one tick on every message that waits for input, and on the blackout screen
 * (and up for the next), until a yes/no, menu, panel choice or menu app is up (an evolution scene under
 * `evolve auto|cancel` is played instead), a battle waits for the player's choice (not a wild one under
 * `wild auto`), or the game is idle (as `until idle`). A is never pressed
 * on anything else, so it cannot talk to an object or pick an entry. Returns the ticks advanced
 * (A is up again), or null after `max`.
 */
export function advanceText(t: UntilTarget, max: number): number | null {
  let idle = 0;
  let down = false;
  for (let n = 1; n <= max; n++) {
    wildAuto(t);
    const evolving = evolveAuto(t);
    if (down) {
      t.release('a');
      down = false;
    } else if (!playsEvolution(t)) {
      const view = t.view();
      if (((view.message?.waitingForInput || view.waitsForAB || view.frontier?.waitsForAB) && !choosing(view)) || t.blackOutWaiting()) {
        t.press('a');
        down = true;
      }
    }
    t.tick();
    idle = t.canSave() ? idle + 1 : 0;
    if (!down && !evolving && (idle >= IDLE_TICKS || choosing(t.view()) || (t.app() !== null && !playsEvolution(t)) || battleWaits(t))) return n;
  }
  if (down) t.release('a');
  return null;
}

/**
 * `advance message`: A on every page of the message box until the box closes, however many pages the ROM's
 * language splits the text into. Timed like a replay's `+0 press a` / `+1 release a` / `until message` chain: A goes
 * down on the tick the page waits and up on the next, and when that press closed the box the wait ends there (A
 * released, that tick not yet advanced, as after `+1 release a`). It also ends, after at least one tick, when a
 * yes/no, menu, panel choice or menu app is up or a battle waits for the player's choice. Before the first page it
 * waits for one. Returns the ticks advanced, or null after `max`.
 */
export function advanceMessage(t: UntilTarget, max: number): number | null {
  if (t.app() !== null) return advanceAppMessage(t, max);
  let pressed = false;
  for (let n = 0; n < max; ) {
    const view = t.view();
    if (n > 0 && (choosing(view) || t.app() !== null || battleWaits(t))) return n;
    if (pressed && view.message === null) return n;
    if ((view.message?.waitingForInput || view.waitsForAB) && !choosing(view)) {
      t.press('a');
      t.tick();
      n++;
      t.release('a');
      pressed = true;
      if (t.view().message === null) return n;
    }
    wildAuto(t);
    t.tick();
    n++;
  }
  return null;
}

/** The open menu app's message box (the views' `message`), or null. */
const appMessage = (t: UntilTarget) => (t.appView() as { message?: { waiting: boolean } | null } | null)?.message ?? null;

/**
 * `advance message` over an open menu app: A on every page of the app's own message box (its view's `message`, waiting)
 * until the box closes or the app does, timed as over the script's box. Before the first page it waits for one.
 */
function advanceAppMessage(t: UntilTarget, max: number): number | null {
  let pressed = false;
  for (let n = 0; n < max; ) {
    if (t.app() === null || (pressed && appMessage(t) === null)) return n;
    if (appMessage(t)?.waiting) {
      t.press('a');
      t.tick();
      n++;
      t.release('a');
      pressed = true;
      if (t.app() === null || appMessage(t) === null) return n;
    }
    t.tick();
    n++;
  }
  return null;
}

/** Abilities that take a move type in whole (decomp BattleSystem_TriggerImmunityAbility, Levitate), by bare id. */
const ABSORBS: Readonly<Record<string, string>> = {
  ABILITY_VOLT_ABSORB: 'TYPE_ELECTRIC',
  ABILITY_MOTOR_DRIVE: 'TYPE_ELECTRIC',
  ABILITY_WATER_ABSORB: 'TYPE_WATER',
  ABILITY_DRY_SKIN: 'TYPE_WATER',
  ABILITY_FLASH_FIRE: 'TYPE_FIRE',
  ABILITY_LEVITATE: 'TYPE_GROUND',
};
const bare = (id: Id) => id.slice(id.indexOf(':') + 1);

/** The foe's shown ability makes the move useless (decomp trainer AI Basic_CheckForImmunity): it takes the type or, Wonder Guard, the move is not super effective. */
function useless(ability: Id | undefined, move: { type: Id; power: number }, matchup: number): boolean {
  if (!ability) return false;
  const a = bare(ability);
  return ABSORBS[a] === bare(move.type) || (a === 'ABILITY_WONDER_GUARD' && move.power > 0 && matchup <= 1);
}

/**
 * The `battle auto` policy for the prompt that waits, or null when there is none. At the command prompt: the
 * usable move with the most damage by a plain estimate, power × 1.5 when it shares a type with the user ×
 * the foe's type matchups (the first on a tie), below every other move when the foe's shown ability
 * (BattlerView.ability) takes its type or, Wonder Guard, it is not super effective. At the move-learn questions YES; on the forget screen: forget the move with the lowest
 * power (the first on a tie) when the new one has more, else keep. With no PP left: slot 1 (Struggle). After
 * a catch: no nickname. At the shift question: no. `refused`: move slots the battle refused this turn (autoAnswer).
 */
export function autoChoice(view: BattleView | null, reg: Registries, refused: ReadonlySet<number> = new Set()): BattleChoice | null {
  const p = view?.prompt;
  if (!p) return null;
  if (p.kind === 'next' || p.kind === 'party' || p.kind === 'bag' || p.kind === 'naming' || p.kind === 'pokedex') throw new Error(`battle auto: autoChoice has no answer for the ${p.kind} prompt`);
  // The move-learn questions: open the forget screen (which decides), and give up when it was cancelled.
  if (p.kind === 'learn-ask') return { kind: 'answer', yes: true };
  // A frontier forfeit question: no (the policy fights on).
  if (p.kind === 'forfeit') return { kind: 'answer', yes: false };
  if (p.kind === 'nickname') return { kind: 'nickname', give: false };
  // SHIFT style's "Will you switch?": no (the policy keeps its Pokémon in).
  if (p.kind === 'shift') return { kind: 'keep' };
  if (p.kind === 'learn') {
    let weakest = 0;
    p.moves.forEach((m, i) => {
      if (m.power < p.moves[weakest]!.power) weakest = i;
    });
    return p.move.power > p.moves[weakest]!.power ? { kind: 'forget', slot: weakest } : { kind: 'keep' };
  }
  // The doubles target screen: the battler the cursor is on (a group goes as one).
  if (p.kind === 'target') return p.move.aim?.group ? { kind: 'move', slot: p.slot } : { kind: 'move', slot: p.slot, target: p.cursor };
  const typesOf = (b: BattleView['battlers'][number] | undefined) => {
    const s = b && reg.species.get(b.species);
    if (!s) throw new Error('battle auto: no such battler');
    return [...new Set(s.forms?.find((f) => f.form === b!.form)?.types ?? s.types)];
  };
  const own = typesOf(view!.battlers.find((x) => x.battler === p.actor));
  // Singles: the foe. Doubles: each foe standing, in the DS target screen's order (the second enemy first).
  const single = view!.topology === 'single';
  const foes = single ? view!.battlers.filter((x) => x.side === 'enemy') : [3, 1].flatMap((id) => view!.battlers.filter((x) => x.battler === id && x.visible));
  if (!foes.length) throw new Error('battle auto: no foe to aim at');
  const score = (m: (typeof p.moves)[number], foe: BattleView['battlers'][number]) => {
    let matchup = 1;
    for (const t of typesOf(foe)) matchup *= (reg.types.get(m.type)?.matchups.find((r) => r.type === t)?.multiplier ?? 10) / 10;
    if (useless(foe.ability, m, matchup)) return -1;
    return m.power * (own.includes(m.type) ? 1.5 : 1) * matchup;
  };
  let best: { slot: number; target: number; score: number } | null = null;
  p.moves.forEach((m, i) => {
    if (m.pp <= 0 || refused.has(i)) return;
    for (const foe of foes) {
      // A single-target move only at a battler the target screen offers it.
      if (m.aim && !m.aim.group && !m.aim.targets.includes(foe.battler)) continue;
      const x = score(m, foe);
      if (!best || x > best.score) best = { slot: i, target: foe.battler, score: x };
    }
  });
  // No PP anywhere: FIGHT uses Struggle (any slot).
  if (!best) return { kind: 'move', slot: 0 };
  const { slot, target } = best;
  return single || p.moves[slot]!.aim?.group ? { kind: 'move', slot } : { kind: 'move', slot, target };
}

/**
 * One answer of the auto policy to the waiting prompt, if any: `autoChoice`, and after a faint the first
 * party Pokémon that can go in. An open bag or a voluntary party sheet fails (the policy never opens them).
 */
function autoAnswer(t: UntilTarget): void {
  const view = t.battle();
  const p = view?.prompt;
  if (!p) return;
  if (p.kind === 'next' || (p.kind === 'party' && p.forced)) return sendFirst(t);
  if (p.kind === 'bag' || p.kind === 'party') throw new Error(`battle auto: the ${p.kind} sheet is open`);
  // The battle's own check refuses a move this turn (Disable, Encore, Taunt, Torment, Imprison, a Choice item):
  // the next best. choose() validates before it takes the answer; each slot is refused at most once.
  const refused = new Set<number>();
  for (;;) {
    const choice = autoChoice(view, t.registries(), refused)!;
    try {
      return t.battleChoose(choice);
    } catch (e) {
      if (choice.kind !== 'move' || refused.has(choice.slot) || !/can't be used now/.test((e as Error).message)) throw e;
      refused.add(choice.slot);
    }
  }
}

/** A battle prompt waits for the replay (`wild auto` answers wild ones itself). */
function battleWaits(t: UntilTarget): boolean {
  const view = t.battle();
  return !!view?.prompt && !(view.kind === 'wild' && t.wildBattles() === 'auto');
}

/** Under `evolve auto|cancel` the waits play an open evolution scene. */
function playsEvolution(t: UntilTarget): boolean {
  return t.evolutions() !== 'manual' && t.app() === 'evolution';
}

/**
 * `evolve auto|cancel`: one tap on an open evolution scene where the replay waits: `back` (B) once it can be
 * stopped under `cancel`; at the move questions NO ("Should a move be deleted?") then YES (give up), so a
 * move is never replaced; `next` (A) on a waiting message. True when it tapped.
 */
function evolveAuto(t: UntilTarget): boolean {
  if (t.evolutions() === 'manual') return false;
  const v = t.appView();
  if (v?.app !== 'evolution') return false;
  let tap: string | null = null;
  if (t.evolutions() === 'cancel' && v.cancellable) tap = 'back';
  else if (v.question) tap = v.question === 'forget' ? 'no' : 'yes';
  else if (v.message?.waiting) tap = 'next';
  if (tap) t.tap(tap);
  return tap !== null;
}

/** `wild auto`: a wild battle's prompt is answered by the auto policy wherever the replay waits. */
function wildAuto(t: UntilTarget): void {
  if (t.wildBattles() !== 'auto') return;
  if (t.battle()?.kind !== 'wild') return;
  autoAnswer(t);
}

/** `battle auto`: until the battle ends, answers every prompt with the auto policy. Fails (null) after `max` ticks. */
export function battleAuto(t: UntilTarget, max: number, move?: number): number | null {
  for (let n = 1; n <= max; n++) {
    const p = t.battle()?.prompt;
    if (move !== undefined && (p?.kind === 'command' || p?.kind === 'fight')) t.battleChoose({ kind: 'move', slot: move });
    else autoAnswer(t);
    t.tick();
    if (!t.inBattle()) return n;
  }
  return null;
}

/**
 * `grind`: steps one tile `dirs[0]`, then one tile back `dirs[1]`, again and again, answering every battle
 * prompt with `autoChoice`, until the field is idle and party[slot] has reached `level`, or its HP is down
 * to half or less (the replay heals and grinds again). A step is held until the player's tile changes.
 * Returns the ticks advanced, or null after `max`.
 */
export function grind(t: UntilTarget, slot: number, level: number, dirs: readonly [Button, Button], max: number): number | null {
  let way = 0;
  let held: { button: Button; x: number; z: number } | null = null;
  let idle = 0;
  for (let n = 1; n <= max; n++) {
    autoAnswer(t);
    evolveAuto(t);
    const p = t.state().player;
    if (held && (p.x !== held.x || p.z !== held.z)) {
      t.release(held.button);
      held = null;
      way ^= 1;
    }
    if (!held && idle >= IDLE_TICKS) {
      const mon = t.state().party[slot];
      if (!mon) throw new Error(`grind: no party member ${slot}`);
      if (mon.level >= level || mon.hp * 2 <= mon.stats.hp) return n - 1;
      held = { button: dirs[way]!, x: p.x, z: p.z };
      t.press(held.button);
      idle = 0;
    }
    t.tick();
    idle = t.canSave() ? idle + 1 : 0;
  }
  if (held) t.release(held.button);
  return null;
}

/**
 * `until wild <species> <dir> <dir>`: steps as `grind` does, running from every other wild battle (Run at each
 * command prompt; after a faint the first able Pokémon goes in), until a wild battle against `species` is up.
 * Its prompts are left to the replay. Returns the ticks advanced, or null after `max`.
 */
function walkUntilWild(t: UntilTarget, species: Id, dirs: readonly [Button, Button], max: number): number | null {
  let way = 0;
  let held: { button: Button; x: number; z: number } | null = null;
  let idle = 0;
  for (let n = 1; n <= max; n++) {
    const p = t.battle()?.prompt;
    if (p?.kind === 'command' || p?.kind === 'fight') t.battleChoose({ kind: 'run' });
    else if (p?.kind === 'next' || (p?.kind === 'party' && p.forced)) sendFirst(t);
    else if (p) throw new Error(`until wild: no answer for the ${p.kind} prompt of another wild battle`);
    const at = t.state().player;
    if (held && (at.x !== held.x || at.z !== held.z)) {
      t.release(held.button);
      held = null;
      way ^= 1;
    }
    if (!held && idle >= IDLE_TICKS) {
      held = { button: dirs[way]!, x: at.x, z: at.z };
      t.press(held.button);
      idle = 0;
    }
    t.tick();
    if (wildAgainst(t, species)) {
      if (held) t.release(held.button);
      return n;
    }
    idle = t.canSave() ? idle + 1 : 0;
  }
  if (held) t.release(held.button);
  return null;
}

/** Ticks a held step may take before the walk counts it as bumped. */
const BUMP_TICKS = 24;


/**
 * `until radar <count>`: on an idle field the player walks, one held step at a time, into the outermost live patch
 * that keeps the chain (the first patch of a new chain: the outermost), by the shortest way within six tiles that steps
 * on no other live patch and on no tile it bumped into; each battle gets the `battle auto` policy, or `ball` at every
 * command prompt (a catch keeps the chain more often). When no live patch keeps the chain, it steps to and fro until the
 * battery is full and presses Y (the Radar must be the registered item), which keeps the chain. Done once idle with
 * the chain at `count`; throws when no live patch keeps the chain or none can be reached; null after `max` ticks.
 */
function walkRadar(t: UntilTarget, count: number, ball: Id | null, max: number): number | null {
  let held: { button: Button; x: number; z: number; since: number } | null = null;
  const bumped = new Set<string>();
  let idle = 0;
  let pressed = false;
  /** The tile the charging walk came from (it steps back to it). */
  let previous: { x: number; z: number } | null = null;
  for (let n = 1; n <= max; n++) {
    const p = t.battle()?.prompt;
    if (pressed) {
      t.release('a');
      pressed = false;
    } else if (ball && p?.kind === 'pokedex') {
      // The Pokédex entry of a new species caught: A closes it.
      if (t.app() !== null) {
        t.press('a');
        pressed = true;
      }
    } else if (ball && p?.kind === 'nickname') t.battleChoose({ kind: 'nickname', give: false });
    else if (ball && (p?.kind === 'command' || p?.kind === 'fight')) t.battleChoose({ kind: 'item', item: ball });
    else autoAnswer(t);
    evolveAuto(t);
    const at = t.state().player;
    if (held && (at.x !== held.x || at.z !== held.z)) {
      t.release(held.button);
      held = null;
    } else if (held && n - held.since > BUMP_TICKS) {
      t.release(held.button);
      const [dx, dz] = STEP[held.button]!;
      bumped.add(`${at.x + dx},${at.z + dz}`);
      held = null;
    }
    if (!held && idle >= IDLE_TICKS && !t.inBattle()) {
      const radar = t.radar();
      if ((radar?.count ?? 0) >= count) return n;
      if (!radar) throw new Error('until radar: no Poké Radar chain');
      const target = radar.patches.find((p) => p.continues) ?? (radar.count === 0 ? radar.patches[0] : undefined);
      const avoid = new Set([...bumped, ...radar.patches.filter((p) => p !== target).map((p) => `${p.x},${p.z}`)]);
      if (!target) {
        // No patch keeps the chain: step to and fro until the battery is full, then Y (the registered Radar) draws
        // the patches again, the chain kept (RefreshRadarChain).
        if ((t.state().encounters?.radarCharge ?? 0) >= RADAR_BATTERY_STEPS) {
          t.press('y');
          t.tick();
          t.release('y');
          idle = 0;
          continue;
        }
        const back = Object.entries(STEP).find(([, [dx, dz]]) => previous && at.x + dx === previous.x && at.z + dz === previous.z);
        const step = back ?? Object.entries(STEP).find(([, [dx, dz]]) => !avoid.has(`${at.x + dx},${at.z + dz}`));
        if (!step) throw new Error(`until radar: boxed in at ${at.x},${at.z} while charging`);
        previous = { x: at.x, z: at.z };
        held = { button: step[0] as Button, x: at.x, z: at.z, since: n };
      } else {
        previous = null;
        const button = firstStep(at, target, avoid);
        if (!button) throw new Error(`until radar: no way to the patch at ${target.x},${target.z} from ${at.x},${at.z}`);
        held = { button, x: at.x, z: at.z, since: n };
      }
      t.press(held.button);
      idle = 0;
    }
    t.tick();
    idle = t.canSave() ? idle + 1 : 0;
    if (t.inBattle()) bumped.clear();
  }
  if (held) t.release(held.button);
  return null;
}

const STEP: Partial<Record<Button, [number, number]>> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** The first step of a shortest way from `from` to `to` within six tiles of `to`, around the `avoid` tiles (breadth first). */
function firstStep(from: { x: number; z: number }, to: { x: number; z: number }, avoid: ReadonlySet<string>): Button | null {
  const key = (x: number, z: number) => `${x},${z}`;
  const first = new Map<string, Button>([[key(from.x, from.z), 'a']]);
  const queue: [number, number][] = [[from.x, from.z]];
  while (queue.length) {
    const [x, z] = queue.shift()!;
    for (const [button, [dx, dz]] of Object.entries(STEP) as [Button, [number, number]][]) {
      const nx = x + dx;
      const nz = z + dz;
      const k = key(nx, nz);
      if (first.has(k) || avoid.has(k) || Math.abs(nx - to.x) > 6 || Math.abs(nz - to.z) > 6) continue;
      const via = first.get(key(x, z))!;
      const step = via === 'a' ? button : via;
      if (nx === to.x && nz === to.z) return step;
      first.set(k, step);
      queue.push([nx, nz]);
    }
  }
  return null;
}

/** After a faint: the first party slot that can go in (the battle refuses the others). */
function sendFirst(t: UntilTarget): void {
  const refused: string[] = [];
  for (let slot = 0; slot < 6; slot++) {
    try {
      t.battleChoose({ kind: 'switch', slot });
      return;
    } catch (e) {
      // In battle, fainted, an Egg or empty: the next slot.
      refused.push(`${slot + 1}: ${(e as Error).message}`);
    }
  }
  throw new Error(`battle auto: no party Pokémon can be sent in (${refused.join('; ')})`);
}

/**
 * `battle catch <ball>`: until the battle ends, throws `ball` at every command prompt; A closes the Pokédex
 * entry of a new species, the nickname is declined. Fails (null) after `max` ticks or at any other prompt (a
 * move to learn, a faint).
 */
export function battleCatch(t: UntilTarget, ball: Id, max: number): number | null {
  for (let n = 1; n <= max; n++) {
    const p = t.battle()?.prompt;
    // The Pokédex entry of a new species (a menu app the game hosts): A closes it.
    if (p?.kind === 'pokedex') {
      if (t.app() !== null) t.press('a');
      t.tick();
      t.release('a');
      continue;
    }
    // The nickname question after the catch: no (name it with `battle nickname`).
    if (p?.kind === 'nickname') t.battleChoose({ kind: 'nickname', give: false });
    else if (p && p.kind !== 'command' && p.kind !== 'fight') return null;
    // A Safari battle throws its Safari Balls (the command card's BALL): `ball` names ITEM_SAFARI_BALL.
    else if (p && t.battle()!.kind === 'safari') {
      if (!ball.endsWith(':ITEM_SAFARI_BALL')) throw new Error(`battle catch: a Safari battle throws only Safari Balls, not ${ball}`);
      t.battleChoose({ kind: 'safari', action: 'ball' });
    } else if (p) t.battleChoose({ kind: 'item', item: ball });
    t.tick();
    if (!t.inBattle()) return n;
  }
  return null;
}
