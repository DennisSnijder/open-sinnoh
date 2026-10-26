/**
 * The start menu's objective (an OpenSinnoh addition, `DeviceOptions.objective`): the first step of the pack's
 * `NewGame.objectives` that is not done yet, read from the flags, vars and badges the state already has.
 * Nothing new is tracked. With every step done the table's `explore` text is shown.
 */
import { newGameRecord, type GameState, type ObjectiveCheck, type Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

function holds(check: ObjectiveCheck, state: GameState, registries: Registries): boolean {
  switch (check.kind) {
    case 'flag':
      return state.flags[check.flag] ?? registries.flags.get(check.flag)?.initial ?? false;
    case 'var':
      return (state.vars[check.var] ?? registries.vars.get(check.var)?.initial ?? 0) >= check.atLeast;
    case 'badge':
      return state.badges.includes(check.badge);
  }
}

/**
 * The text id of the current objective and the zone it leads to (`to`, when the step names one), or null when the
 * packs have no objective table.
 */
export function currentObjective(state: GameState, registries: Registries): { title: Id; text: Id; to: Id | null } | null {
  const table = newGameRecord(registries).objectives;
  if (!table) return null;
  const step = table.steps.find((s) => !s.done.some((c) => holds(c, state, registries)));
  return { title: table.title, text: step ? step.text : table.explore, to: step?.to ?? null };
}
