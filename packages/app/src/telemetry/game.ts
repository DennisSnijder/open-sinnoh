/**
 * What a report says about the running game: the zone id, the mode (title, field, script, menu, battle,
 * battle-hold), the loop's speed and whether it falls behind; breadcrumbs when the zone or mode changes.
 * Ids only, never game text. The player's, rival's, Pokémon's and boxes' names are the reports' secrets.
 */
import type { Game } from '@opensinnoh/game';
import type { LoopStats } from '../loop.ts';
import { addContextSource, breadcrumb, setSecretsSource } from './index.ts';

export interface GameWatchDeps {
  game(): Game;
  loop: LoopStats;
  /** The title screen runs (the game does not tick). */
  title(): boolean;
  /** The loop holds the game on the battle cut-in's black screen until its art is in. */
  holding(): boolean;
}

export function gameMode(game: Game, title: boolean, holding: boolean): string {
  if (title) return 'title';
  if (game.inBattle()) return holding ? 'battle-hold' : 'battle';
  if (game.app()) return `menu:${game.app()!.app}`;
  return game.scripts.running() ? 'script' : 'field';
}

/** The strings of a game's state that name the player's things (reports must not contain them). */
export function gameSecrets(game: Game): string[] {
  const s = game.state;
  const mons = [...s.party, ...s.boxes.flatMap((b) => b.slots)];
  return [s.names.player, s.names.rival, ...s.boxes.map((b) => b.name), ...mons.flatMap((m) => (m ? [m.nickname ?? '', m.otName] : []))].filter(Boolean);
}

/** Registers the game's context and secrets; `tick` (once a loop tick) leaves breadcrumbs on zone and mode changes. */
export function watchGame(deps: GameWatchDeps): { tick(): void } {
  const now = () => ({ zone: deps.game().state.player.zone, mode: gameMode(deps.game(), deps.title(), deps.holding()) });
  addContextSource(() => ({ ...now(), speed: deps.loop.speed, effective: Math.round(deps.loop.effective * 100) / 100, behind: deps.loop.behind, ticks: deps.loop.ticks, dropped: deps.loop.dropped }));
  setSecretsSource(() => gameSecrets(deps.game()));
  let last = { zone: '', mode: '' };
  return {
    tick() {
      const n = now();
      if (n.zone !== last.zone) breadcrumb('zone', n.zone);
      if (n.mode !== last.mode) breadcrumb('mode', n.mode);
      last = n;
    },
  };
}
