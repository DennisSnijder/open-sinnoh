/**
 * The DS target screen's d-pad cursor (decomp battle_subscreen.c sSelectTargetMenuButtonLayout and
 * BattleSystem_Cursor_Battler): enemy 2 and enemy 1 on the top row, player 1 and player 2 under them, CANCEL
 * across the bottom. A single-target move's cursor moves between the battlers it may aim at (cells it cannot
 * reach are skipped as the DS blanks them); a group (spread, self) is one cell over its battlers, with CANCEL
 * under it.
 */
import type { BattleMoveView } from '@opensinnoh/contracts';

/** The cursor on CANCEL (the layout's button 4). */
export const TARGET_CANCEL = 4;
/** Rows of battler ids, top to bottom. */
const GRID = [
  [3, 1],
  [0, 2],
] as const;

type Dir = 'up' | 'down' | 'left' | 'right';

/** The cursor after one frame's d-pad: `pressed(dir)` says whether that direction was pressed. */
export function targetCursor(cursor: number, aim: NonNullable<BattleMoveView['aim']>, pressed: (dir: Dir) => boolean): number {
  const first = aim.targets[0];
  if (first === undefined) return TARGET_CANCEL;
  if (aim.group) {
    if (pressed('down')) return TARGET_CANCEL;
    if (pressed('up')) return first;
    return cursor;
  }
  const ok = (b: number) => aim.targets.includes(b);
  if (cursor === TARGET_CANCEL) {
    if (!pressed('up')) return cursor;
    return GRID[1].find(ok) ?? GRID[0].find(ok) ?? first;
  }
  const row = GRID.findIndex((r) => (r as readonly number[]).includes(cursor));
  if (row < 0) throw new Error(`battle: target cursor on ${cursor}`);
  const col = (GRID[row] as readonly number[]).indexOf(cursor);
  if (pressed('left') || pressed('right')) {
    const other = GRID[row]![col ^ 1]!;
    if (ok(other) && (pressed('left') ? col === 1 : col === 0)) return other;
  }
  if (pressed('up') && row === 1) {
    const above = GRID[0][col]!;
    if (ok(above)) return above;
    return GRID[0].find(ok) ?? cursor;
  }
  if (pressed('down')) {
    if (row === 1) return TARGET_CANCEL;
    const below = GRID[1][col]!;
    if (ok(below)) return below;
    return GRID[1].find(ok) ?? TARGET_CANCEL;
  }
  return cursor;
}
