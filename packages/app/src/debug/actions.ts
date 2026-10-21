/** Dev tools use the same state edits and field contracts as scripts and replays. */
import { PARTY_SIZE, type Id } from '@opensinnoh/core';
import { DEV_EVENTS, firstFreeBox, giveItem, grantDevEvent, markCaught, setupPokemon, storeInBox, type DevEvent } from '@opensinnoh/contracts';
import { saveFromJson, validateSave } from '@opensinnoh/game';
import type { Session } from '../boot.ts';

export function integer(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`Expected an integer from ${min} to ${max}`);
  return Number(value);
}

export function debugActions(session: () => Session) {
  const idle = () => {
    const game = session().game;
    if (!game.canSave()) throw new Error('Wait for an idle field (close menus and finish scripts or battles).');
    return game;
  };
  return {
    warp(id: string, x: string, z: string) {
      const game = idle();
      const zone = game.registries.zones.get(id as Id);
      if (!zone) throw new Error(`Unknown map ${id}`);
      const matrix = game.registries.matrices.get(zone.matrix)!;
      const tx = integer(x, 0, matrix.width * 32 - 1);
      const tz = integer(z, 0, matrix.height * 32 - 1);
      const cell = Math.floor(tx / 32) + Math.floor(tz / 32) * matrix.width;
      if (!matrix.chunks[cell] || (matrix.zones && matrix.zones[cell] !== zone.id)) throw new Error('Tile is outside the selected map.');
      if (game.state.playerState === 'cycle' && !zone.flags.bike) throw new Error('Dismount before warping to a map without cycling.');
      game.world.warp(zone.id, tx, tz, game.state.player.facing);
    },
    flag(id: string, value: boolean | null) {
      const game = idle();
      const key = id as Id;
      const def = game.registries.flags.get(key);
      if (!def) throw new Error(`Unknown flag ${id}`);
      if (value === null || value === def.initial) delete game.state.flags[key];
      else game.state.flags[key] = value;
    },
    variable(id: string, value: string | null) {
      const game = idle();
      const key = id as Id;
      const def = game.registries.vars.get(key);
      if (!def) throw new Error(`Unknown var ${id}`);
      if (def.scope === 'temp') throw new Error('Script-local temporary vars are not part of GameState.');
      const n = value === null ? def.initial : integer(value, 0, 65535);
      if (n === def.initial) delete game.state.vars[key];
      else game.state.vars[key] = n;
    },
    item(id: string, count: string) {
      const game = idle();
      if (!game.registries.items.has(id as Id)) throw new Error(`Unknown item ${id}`);
      if (!giveItem(game.state, game.registries, id as Id, integer(count, 1, 999))) throw new Error('Item does not fit in the bag.');
    },
    pokemon(id: string, level: string) {
      const game = idle();
      if (!game.registries.species.has(id as Id)) throw new Error(`Unknown species ${id}`);
      const box = game.state.party.length < PARTY_SIZE ? null : firstFreeBox(game.state);
      if (game.state.party.length >= PARTY_SIZE && box === null) throw new Error('Party and PC boxes are full.');
      const mon = setupPokemon(game.state, game.registries, game.state.party.length, id as Id, integer(level, 1, 100));
      if (box === null) game.state.party.push(mon);
      else storeInBox(game.state, game.registries, box, mon);
      markCaught(game.state, game.registries, mon);
    },
    clock(date: string, time: string) {
      idle().setClock(date, time);
    },
    /** The event-only content (docs/decisions.md: a dev-only flag, never in the player's UI): contracts `grantDevEvent`. */
    event(name: string) {
      const game = idle();
      if (!Object.hasOwn(DEV_EVENTS, name)) throw new Error(`Unknown event ${name}`);
      grantDevEvent(game.state, game.registries, name as DevEvent);
    },
    /** As the story specs start a chunk (tests/integration/checkpoints-anchors.ts `anchoredDriver`): a reset, the anchor's clock, the anchor loaded. Any time: the reset ends whatever runs. */
    async checkpoint(json: string) {
      const game = session().game;
      const save = validateSave(saveFromJson(json), game.registries, game.loadOrder, game.labels);
      const now = save.state.gameTime.now;
      game.reset();
      game.setClock(now.date, `${String(now.hour).padStart(2, '0')}:${String(now.minute).padStart(2, '0')}`);
      await session().load(json);
    },
  };
}
