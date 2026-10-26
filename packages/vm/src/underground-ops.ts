/**
 * The Underground's and the fossils' script commands (decomp scrcmd_underground_inventory.c ScrCmd_GiveSphere,
 * ScrCmd_GiveTrap, ScrCmd_SendGoodToPC, ScrCmd_CheckHasRoomForGoodsInPC; scrcmd.c ScrCmd_GetCapturedFlagCount,
 * ScrCmd_UndergroundNPCMessage, ScrCmd_CloseUndergroundNPCMessage, ScrCmd_SetCommPlayerDir, ScrCmd_Dummy19E, the
 * ScrCmd_GetUnderground* counters; scrcmd_fossil.c). The rules are core's (underground.ts); the tables are `NewGame.underground`.
 */
import { itemCount, newGameRecord, type UndergroundTables } from '@opensinnoh/contracts';
import { createUnderground, goodsPcHasRoom, readUnderground, tryAddGoodPc, tryAddSphere, tryAddTrap, undergroundInitSeed, type Arg, type Id } from '@opensinnoh/core';
import { plainMarkup } from '@opensinnoh/text';
import type { Handler, Runner, Thread } from './runner.ts';

/**
 * The Underground's system vars (decomp VAR_UNDERGROUND_FOSSILS_UNEARTHED, _TRAPS_SET, _TALK_COUNTER, _ITEMS_GIVEN_AWAY;
 * `vars` sourceIndex), read by Hearthome's Underground fan. Mining and the traps count the first two; the other two count
 * talks with and gifts to other players (UndergroundPlayer, UndergroundTalk), so a solo game leaves them at 0.
 */
const COUNTER_VARS = { fossils: 0x4047, traps: 0x4048, talks: 0x4049, gifts: 0x4054 } as const;
/** Decomp DIR_NORTH, DIR_SOUTH, DIR_WEST, DIR_EAST. */
const DIRS = ['up', 'down', 'left', 'right'] as const;

export function undergroundHandlers(r: Runner): Record<string, Handler> {
  const tables = (op: string): UndergroundTables => {
    const t = newGameRecord(r.registries).underground;
    if (!t) throw new Error(`${op}: the packs have no Underground (NewGame.underground)`);
    return t;
  };
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const sourceOf = (kind: 'items' | 'species', id: Id): number => {
    const n = r.registries[kind].get(id)?.sourceIndex;
    if (n === undefined) throw new Error(`${kind} ${id} has no sourceIndex`);
    return n;
  };
  const count = (item: Id) => itemCount(r.state, item);
  const counter = (t: Thread, name: keyof typeof COUNTER_VARS) => r.getVar(t, r.source('vars', COUNTER_VARS[name])!);
  const underground = () => createUnderground(r.state, undergroundInitSeed(r.clock(), r.state.trainerId));
  /** TEXT_BANK_UNDERGROUND_NPCS, the bank the Underground's NPC messages come from. */
  const npcText = (n: number): Id => {
    const ns = newGameRecord(r.registries).id.split(':')[0];
    const bank = r.registries.textBanks.get(`${ns}:TEXT_BANK_UNDERGROUND_NPCS` as Id);
    const id = bank?.messages[n];
    if (!id) throw new Error(`underground_npc_message: TEXT_BANK_UNDERGROUND_NPCS has no message ${n}`);
    return id;
  };
  return {
    /** Underground_TryAddSphere (no size cap, as the script gives it): TRUE when it fit. */
    give_sphere: (t, _c, a) => {
      tables('give_sphere');
      dest(t, a[2], tryAddSphere(underground(), r.val(t, a[0]), r.val(t, a[1])) ? 1 : 0);
      return 'continue';
    },
    /** Underground_TryAddTrap. */
    give_trap: (t, _c, a) => {
      tables('give_trap');
      dest(t, a[2], tryAddTrap(underground(), r.val(t, a[0])) ? 1 : 0);
      return 'continue';
    },
    /** Underground_TryAddGoodPC. */
    send_good_to_pc: (t, _c, a) => {
      tables('send_good_to_pc');
      dest(t, a[2], tryAddGoodPc(underground(), r.val(t, a[0])) ? 1 : 0);
      return 'continue';
    },
    /** Underground_IsRoomForGoodsInPC. */
    check_has_room_for_goods_in_pc: (t, _c, a) => {
      dest(t, a[2], goodsPcHasRoom(readUnderground(r.state)) ? 1 : 0);
      return 'continue';
    },
    /** UndergroundRecord_GetCapturedFlagCount: flags are taken from other players' bases only, so a solo game has none. */
    get_captured_flag_count: (t, _c, a) => (dest(t, a[0], 0), 'continue'),
    /** UndergroundVendors_PrintNPCMessage: a TEXT_BANK_UNDERGROUND_NPCS message; the script waits until it has printed. */
    underground_npc_message: (t, c, a) => {
      // UndergroundTextPrinter_SetPlayerNameIndex0: the player's name in slot 0.
      t.slots[0] = plainMarkup(r.state.names.player);
      const p = r.showMessage(t, npcText(r.val(t, a[0])), r.textSpeed());
      return r.pause(c, () => p.done);
    },
    close_underground_npc_message: () => ((r.ui.message = null), 'continue'),
    /** CommPlayer_SetDir: in a solo Underground the one player is the player (Roark's intro turns them east). */
    set_comm_player_dir: (_t, _c, a) => {
      const dir = DIRS[r.int(a[0])];
      if (!dir) throw new Error(`set_comm_player_dir: direction ${r.int(a[0])}`);
      r.field.turnPlayer(dir);
      return 'continue';
    },
    /**
     * The vendors' unused scripts (decomp: their talk opens the shop from the overlay, UndergroundVendors_StartShopMenuTask;
     * Dummy19E would wait forever). The field opens the shop itself, so this never runs.
     */
    dummy19_e: () => {
      throw new Error('dummy19_e: an Underground vendor script ran; the field opens the vendors\' shops (World.undergroundRequest)');
    },
    /** ScrCmd_GetUndergroundFossilsUnearthed, …TrapsSet, …TalkCounter, …ItemsGivenAway: the SystemVars_Get* counters. */
    get_underground_fossils_unearthed: (t, _c, a) => (dest(t, a[0], counter(t, 'fossils')), 'continue'),
    get_underground_traps_set: (t, _c, a) => (dest(t, a[0], counter(t, 'traps')), 'continue'),
    get_underground_talk_counter: (t, _c, a) => (dest(t, a[0], counter(t, 'talks')), 'continue'),
    get_underground_items_given_away: (t, _c, a) => (dest(t, a[0], counter(t, 'gifts')), 'continue'),
    /** ScrCmd_GetFossilCount: every fossil item in the bag, summed. */
    get_fossil_count: (t, _c, a) => {
      dest(t, a[0], tables('get_fossil_count').fossils.reduce((n, f) => n + count(f.item), 0));
      return 'continue';
    },
    /** ScrCmd_GetSpeciesFromFossil: the species the fossil item revives into, or 0. */
    get_species_from_fossil: (t, _c, a) => {
      const item = r.val(t, a[1]);
      const f = tables('get_species_from_fossil').fossils.find((x) => sourceOf('items', x.item) === item);
      dest(t, a[0], f ? sourceOf('species', f.species) : 0);
      return 'continue';
    },
    /** ScrCmd_FindFossilAtThreshold: the first fossil (in table order) at which the running count reaches the threshold, and its index. */
    find_fossil_at_threshold: (t, _c, a) => {
      const threshold = r.val(t, a[2]);
      let total = 0;
      let found: { item: number; index: number } = { item: 0, index: 0 };
      for (const [i, f] of tables('find_fossil_at_threshold').fossils.entries()) {
        total += count(f.item);
        if (total >= threshold) {
          found = { item: sourceOf('items', f.item), index: i };
          break;
        }
      }
      dest(t, a[0], found.item);
      dest(t, a[1], found.index);
      return 'continue';
    },
  };
}
