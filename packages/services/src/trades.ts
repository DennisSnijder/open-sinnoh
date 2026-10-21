/**
 * The in-game trades (decomp overlay006/npc_trade.c): the Pokémon an NPC gives, built from its `NpcTrade` record.
 */
import { createPokemon, type Pokemon } from '@opensinnoh/core';
import { dexOf, newGameRecord, type NpcTrade, type Registries } from '@opensinnoh/contracts';

export function npcTrade(registries: Registries, id: number): NpcTrade {
  const t = newGameRecord(registries).npcTrades?.[id];
  if (!t) throw new Error(`NPC trade ${id}: not in NewGame.npcTrades`);
  return t;
}

/**
 * Decomp NPCTrade_CreateMon: the species at the traded Pokémon's level with the table's PID, OT id, IVs, held item,
 * language and contest condition, its nickname and OT; met at the traded level on `date` (UpdateMonStatusAndTrainerInfo case 1: the
 * in-game trade's special met location, which the model has no zone for: null).
 */
export function createTradeMon(registries: Registries, trade: NpcTrade, level: number, date: string): Pokemon {
  const mon = createPokemon(dexOf(registries), {
    species: trade.species,
    level,
    pid: trade.pid,
    ivs: trade.ivs,
    otId: trade.otId,
    otName: trade.otName,
    otGender: trade.otGender,
    language: trade.language,
    ball: newGameRecord(registries).pokeBall,
    met: { zone: null, level, date },
    heldItem: trade.heldItem,
    nickname: trade.nickname,
  });
  mon.condition = { ...trade.condition, sheen: 0 };
  return mon;
}
