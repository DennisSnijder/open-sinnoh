/**
 * The move tutors and the move relearner (decomp overlay005/scrcmd_move_tutor.c, move_reminder_data.c): which moves
 * a Pokémon can be taught at a tutor location, the shard costs, and the level-up moves it can be reminded of.
 */
import { Dex, type Id, type Pokemon } from '@opensinnoh/core';
import { itemCount, newGameRecord, takeItem, type GameState, type MoveTutorTables, type Registries } from '@opensinnoh/contracts';

/** Decomp MAX_NUMBER_REMINDER_MOVES: the relearner reads at most this many level-up entries. */
const REMINDER_ENTRIES = 22;

export function tutorTables(registries: Registries): MoveTutorTables {
  const t = newGameRecord(registries).moveTutors;
  if (!t) throw new Error('move tutors: the packs have no NewGame.moveTutors');
  return t;
}

function tutorMove(tables: MoveTutorTables, move: Id) {
  const t = tables.moves.find((m) => m.move === move);
  if (!t) throw new Error(`move tutors: ${move} is not a tutor move`);
  return t;
}

/**
 * Decomp Pokemon_HasLearnableMovesAt / ShowMoveTutorMoveSelectionMenu: the tutor moves of `location` its species
 * (or form) learns and does not know, in table order. Without a Pokémon (PARTY_SLOT_NONE): every move there.
 */
export function tutorMovesAt(registries: Registries, mon: Pokemon | null, location: number): Id[] {
  const at = tutorTables(registries).moves.filter((m) => m.location === location);
  if (!mon) return at.map((m) => m.move);
  const learns = new Set(new Dex(registries).form(mon.species, mon.form).tutorMoves ?? []);
  return at.filter((m) => learns.has(m.move) && !mon.moves.includes(m.move)).map((m) => m.move);
}

/** A tutor move's shard costs, Red, Blue, Yellow, Green (decomp sTeachableMoves). */
export function shardCost(registries: Registries, move: Id): [number, number, number, number] {
  return tutorMove(tutorTables(registries), move).cost;
}

/** Decomp ScrCmd_CheckCanAffordMove: the bag holds every shard the move costs. */
export function canAffordTutorMove(state: GameState, registries: Registries, move: Id): boolean {
  const tables = tutorTables(registries);
  return tutorMove(tables, move).cost.every((n, i) => n === 0 || itemCount(state, tables.shards[i]!) >= n);
}

/** Decomp ScrCmd_PayShardCost: the shards leave the bag (Bag_TryRemoveItem: a shortfall takes nothing of that colour). */
export function payShardCost(state: GameState, registries: Registries, move: Id): void {
  const tables = tutorTables(registries);
  tutorMove(tables, move).cost.forEach((n, i) => {
    if (n > 0 && itemCount(state, tables.shards[i]!) >= n) takeItem(state, tables.shards[i]!, n);
  });
}

/**
 * Decomp MoveReminderData_GetMoves: the level-up moves at or below its level (of the first 22 learnset entries) that
 * it does not know, each once, in learnset order.
 */
export function reminderMoves(registries: Registries, mon: Pokemon): Id[] {
  const out: Id[] = [];
  for (const e of new Dex(registries).form(mon.species, mon.form).learnset.slice(0, REMINDER_ENTRIES)) {
    if (e.level > mon.level || mon.moves.includes(e.move) || out.includes(e.move)) continue;
    out.push(e.move);
  }
  return out;
}
