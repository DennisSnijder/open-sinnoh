/**
 * The suspend point (OpenSinnoh, a Switch-style suspend; docs/decisions.md): phones kill hidden tabs, so when
 * the page hides the game is kept in its own save slot, next to the real save the in-game SAVE writes. The next
 * CONTINUE loads it when it is newer than the save (more play ticks), and every load clears it, so it is never a
 * second save to go back to. It is the game's state at the hide when the field can be saved then (idle, no menu,
 * no battle), else the last idle moment, which is checked every IDLE_EVERY ticks. Changeable in Options (DATA):
 * `lantern-nds:suspend`, on by default. Never in replays.
 */
import type { SaveEnvelope } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';

export const SUSPEND_SLOT = 'suspend';
const KEY = 'lantern-nds:suspend'; // pre-rename name, kept: players' stored data uses it
/** How often (ticks) the last idle moment is kept: about every three seconds. */
const IDLE_EVERY = 90;

/** Whether the suspend point is on (device data: anything unreadable counts as on, the default). */
export function suspendOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Turns it on or off; returns the storage error, or null. */
export function setSuspendOn(on: boolean): string | null {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

export interface SuspendStore {
  put(slot: string, save: SaveEnvelope): Promise<void>;
  get(slot: string): Promise<string | undefined>;
  remove(slot: string): Promise<void>;
}

export function createSuspend(deps: { game: () => Game; store: SuspendStore; on(): boolean }) {
  /** The last idle moment (an envelope), or null. */
  let idle: SaveEnvelope | null = null;
  let since = IDLE_EVERY;
  return {
    /** Once a field tick, after it: keeps the last idle moment fresh. */
    tick(): void {
      if (++since < IDLE_EVERY || !deps.game().canSave()) return;
      since = 0;
      idle = deps.game().save();
    },
    /** The page hides: the suspend point is written (now when the field can be saved, else the last idle moment). */
    hide(): Promise<void> {
      if (!deps.on()) return Promise.resolve();
      const game = deps.game();
      const point = game.canSave() ? game.save() : idle;
      return point ? deps.store.put(SUSPEND_SLOT, point) : Promise.resolve();
    },
    /** A game was loaded or started: the old moment is gone, and the stored point is cleared. */
    loaded(): Promise<void> {
      idle = null;
      since = IDLE_EVERY;
      return deps.store.remove(SUSPEND_SLOT);
    },
    /**
     * What CONTINUE loads: the suspend point's JSON when there is no save or it is newer than the save (more play
     * ticks), else the save's; undefined when there is neither.
     */
    async pick(save: string | undefined): Promise<string | undefined> {
      const point = await deps.store.get(SUSPEND_SLOT);
      if (point === undefined || save === undefined) return point ?? save;
      return ticks(point) > ticks(save) ? point : save;
    },
  };
}

/** A save's play ticks (GameState.tick); -1 when unreadable (the other one wins, and its load reports any problem). */
function ticks(json: string): number {
  try {
    const t = (JSON.parse(json) as { state?: { tick?: unknown } }).state?.tick;
    return typeof t === 'number' ? t : -1;
  } catch {
    return -1;
  }
}
