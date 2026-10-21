/**
 * The side systems' script commands: berry patches (decomp scrcmd_berry.c, the script bag ScrCmd_OpenBag /
 * GetSelectedItem), the shard move tutors (overlay005/scrcmd_move_tutor.c), the move relearner, the tutor menu and
 * the move deleter (scrcmd_party_mon_moves.c, scrcmd_party.c), and the in-game trades (scrcmd.c ScrCmd_*NPCTrade).
 * The rules are services' (berries.ts, tutors.ts, trades.ts); 'yield' where the decomp handler returns TRUE.
 */
import { addPoketchHistory, dexOf, giveItem, markCaught, newGameRecord, type BerryTables } from '@opensinnoh/contracts';
import { dayPeriod, setMoveSlot, type Arg, type Id, type Pokemon } from '@opensinnoh/core';
import {
  addToGameRecord, berryPatch, berryStageIndex, canAffordTutorMove, createTradeMon, harvestBerryPatch, incrementTrainerScore, mulchBerryPatch, npcTrade, patchMoisture,
  payShardCost, plantBerry, reminderMoves, scoreCatch, shardCost, tutorMovesAt,
} from '@opensinnoh/services';
import { MENU_RESULT, ScriptMenu } from './menu.ts';
import { BANKS, showScriptMenu } from './ops.ts';
import { toPrintOps } from '@opensinnoh/text';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp PARTY_SLOT_NONE, MOVE_NOT_SELECTED. */
const PARTY_SLOT_NONE = 0xff;
const MOVE_NOT_SELECTED = 0xff;
/** Decomp RECORD_BERRIES_PLANTED (generated/game_records.txt) and BERRY_WATERING_START / _END. */
const RECORD_BERRIES_PLANTED = 4;
const WATERING = { start: 0, end: 1 } as const;
/** Decomp ScrCmd_OpenBag: 0 OpenItemsBag (POCKET_ITEMS), else OpenBerriesBag (POCKET_BERRIES); `NewGame.pockets` names. */
const BAG_POCKETS = ['items', 'berries'] as const;
/** Decomp ScrCmd_ShowMoveTutorMoveSelectionMenu: MoveTutorManager_New(…, 20, 1, 0, TRUE, …): the list at tile 20,1, B allowed. */
const TUTOR_LIST = { x: 20, y: 1 };
/** Decomp FieldMenuManager_NewMoveTutorCostWindow: 10×16 tiles; the shard names (menu entries 273–276) with each cost (277) below. */
const SHARD_WINDOW = { width: 80, height: 128, names: [273, 274, 275, 276], cost: 277, row: 16 };
/** Decomp MenuEntries_Text_Exit (TEXT_BANK_MENU_ENTRIES): the tutor list's last row. */
const MENU_ENTRY_EXIT = 'MenuEntries_Text_Exit';

export function sideHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const item = (n: number): Id => r.source('items', n)!;
  const itemIndex = (id: Id | null): number => {
    if (id === null) return 0;
    const rec = r.registries.items.get(id);
    if (rec?.sourceIndex === undefined) throw new Error(`item ${id} has no sourceIndex`);
    return rec.sourceIndex;
  };
  const moveId = (n: number): Id => {
    const id = [...r.registries.moves.values()].find((m) => m.sourceIndex === n)?.id;
    if (!id) throw new Error(`no move with sourceIndex ${n}`);
    return id;
  };
  const moveIndex = (id: Id): number => {
    const n = r.registries.moves.get(id)?.sourceIndex;
    if (n === undefined) throw new Error(`move ${id} has no sourceIndex`);
    return n;
  };
  const partyMon = (op: string, slot: number): Pokemon => {
    const m = r.state.party[slot];
    if (!m) throw new Error(`${op}: no Pokémon in party slot ${slot}`);
    return m;
  };
  const tables = (op: string): BerryTables => {
    const b = newGameRecord(r.registries).berries;
    if (!b) throw new Error(`${op}: the packs have no NewGame.berries`);
    return b;
  };
  /** Decomp SCRIPT_MANAGER_TARGET_OBJECT's patch: the talked-to soil object's first data value (MapObject_GetDataAt 0). */
  const patchOf = (t: Thread, op: string) => {
    const ev = t.lastTalked === undefined ? undefined : r.registries.zones.get(t.zone)?.events.objects.find((o) => o.localId === t.lastTalked);
    if (!ev || ev.sprite !== tables(op).soil) throw new Error(`${op}: object ${t.lastTalked ?? '(none)'} of ${t.zone} is not berry soil`);
    return berryPatch(r.state.berryPatches, ev.data[0]!);
  };

  /** The script bag's pick (SCRIPT_MANAGER_PARTY_MANAGEMENT_DATA) until `get_selected_item` reads it. */
  let bagPick: Id | null | undefined;
  /** The move reminder's outcome until `check_learned_*_move` reads it. */
  let learned: boolean | undefined;
  /** The summary's move pick (`select_party_mon_move`) until `get_selected_party_mon_move` reads it. */
  let movePick: number | null | undefined;
  /** The NPC trade `init_npc_trade` loaded (SCRIPT_MANAGER_DATA_PTR) until `finish_npc_trade`. */
  let trade: number | null = null;
  const loadedTrade = (op: string) => {
    if (trade === null) throw new Error(`${op}: no NPC trade loaded (init_npc_trade)`);
    return npcTrade(r.registries, trade);
  };

  return {
    // ---------------------------------------------------------------- berries
    get_berry_growth_stage: (t, _c, a) => (dest(t, a[0], berryStageIndex(patchOf(t, 'get_berry_growth_stage').stage)), 'continue'),
    get_berry_item_id: (t, _c, a) => (dest(t, a[0], itemIndex(patchOf(t, 'get_berry_item_id').berry)), 'continue'),
    get_berry_mulch_type: (t, _c, a) => (dest(t, a[0], itemIndex(patchOf(t, 'get_berry_mulch_type').mulch)), 'continue'),
    get_berry_moisture: (t, _c, a) => (dest(t, a[0], patchMoisture(patchOf(t, 'get_berry_moisture'))), 'continue'),
    get_berry_yield: (t, _c, a) => (dest(t, a[0], patchOf(t, 'get_berry_yield').yield), 'continue'),
    set_berry_mulch: (t, _c, a) => (mulchBerryPatch(tables('set_berry_mulch'), patchOf(t, 'set_berry_mulch'), item(val(t, a[0]))), 'continue'),
    /** ScrCmd_PlantBerry: the berry goes in (BerryPatches_PlantInPatch) and RECORD_BERRIES_PLANTED counts it. */
    plant_berry: (t, _c, a) => {
      plantBerry(tables('plant_berry'), patchOf(t, 'plant_berry'), item(val(t, a[0])));
      addToGameRecord(r.state, r.registries, RECORD_BERRIES_PLANTED, 1);
      return 'continue';
    },
    /**
     * ScrCmd_SetBerryWateringState: START runs the Sprayduck task (FieldTask_InitCall: the script waits for it), END
     * gives the avatar back. TRUE either way.
     */
    set_berry_watering_state: (_t, c, a) => {
      const state = r.int(a[0]);
      if (state === WATERING.start) {
        r.field.startWatering();
        return r.pause(c, () => r.field.wateringDone());
      }
      if (state !== WATERING.end) throw new Error(`set_berry_watering_state: state ${state}`);
      r.field.endWatering();
      return 'yield';
    },
    /**
     * ScrCmd_HarvestBerry (BerryPatches_HarvestBerry): the patch is cleared and its berries go in the bag (the script
     * checked the room); TRAINER_SCORE_EVENT_BERRY_HARVESTED. The planting-and-watering TV segment waits for TV.
     */
    harvest_berry: (t) => {
      const { berry, count } = harvestBerryPatch(patchOf(t, 'harvest_berry'));
      if (!giveItem(r.state, r.registries, berry, count)) throw new Error(`harvest_berry: ${count} ${berry} do not fit the bag (the script checks first)`);
      incrementTrainerScore(r.state, r.registries, 'BERRY_HARVESTED');
      return 'continue';
    },
    /** ScrCmd_OpenBag: the one-pocket bag picks an item; the script waits. */
    open_bag: (_t, c, a) => {
      const pocket = BAG_POCKETS[r.int(a[0]) === 0 ? 0 : 1];
      return r.openApp(c, { app: 'bag-pick', pocket }, (result) => {
        if (result.app !== 'bag-pick') throw new Error(`open_bag: got a ${result.app} result`);
        bagPick = result.item;
      });
    },
    /** ScrCmd_GetSelectedItem: the item picked, ITEM_NONE (0) for none. */
    get_selected_item: (t, _c, a) => {
      if (bagPick === undefined) throw new Error('get_selected_item: no bag ran (open_bag)');
      dest(t, a[0], itemIndex(bagPick));
      bagPick = undefined;
      return 'continue';
    },

    // ---------------------------------------------------------------- move tutors
    check_has_learnable_tutor_moves: (t, _c, a) => {
      const mon = partyMon('check_has_learnable_tutor_moves', val(t, a[0]));
      dest(t, a[2], tutorMovesAt(r.registries, mon, val(t, a[1])).length ? 1 : 0);
      return 'continue';
    },
    /**
     * ScrCmd_ShowMoveTutorMoveSelectionMenu: a list of the location's moves the Pokémon can learn (every move there
     * for PARTY_SLOT_NONE) and EXIT; the move's id or MENU_CANCEL goes to the var. TRUE (the script waits).
     */
    show_move_tutor_move_selection_menu: (t, c, a) => {
      const slot = val(t, a[0]);
      const mon = slot === PARTY_SLOT_NONE ? null : partyMon('show_move_tutor_move_selection_menu', slot);
      const menu = new ScriptMenu(TUTOR_LIST, 0, true, BANKS.menuEntries);
      for (const move of tutorMovesAt(r.registries, mon, val(t, a[1]))) menu.add({ text: r.registries.moves.get(move)!.name, index: moveIndex(move) });
      menu.add({ text: r.plainText(exitText()), index: MENU_RESULT.cancel });
      r.ui.menu = menu;
      t.menuVar = r.ref(a[2], 'var');
      r.setVar(t, t.menuVar, MENU_RESULT.pending);
      return showScriptMenu(r, t, c, menu, 'list');
    },
    check_can_afford_move: (t, _c, a) => (dest(t, a[1], canAffordTutorMove(r.state, r.registries, moveId(val(t, a[0]))) ? 1 : 0), 'continue'),
    pay_shard_cost: (t, _c, a) => (payShardCost(r.state, r.registries, moveId(val(t, a[0]))), 'continue'),
    /** ScrCmd_ResetMoveSlot → Party_ResetMonMoveSlot(party, slot, moveSlot, move): the decomp reads the slot second and the move third. */
    reset_move_slot: (t, _c, a) => {
      const mon = partyMon('reset_move_slot', val(t, a[0]));
      setMoveSlot(dexOf(r.registries), mon, val(t, a[1]), moveId(val(t, a[2])));
      return 'continue';
    },
    /** ScrCmd_ShowShardCost: the cost window at tile x,y (the script waits for A or B, then closes it). */
    show_shard_cost: (t, _c, a) => {
      const cost = shardCost(r.registries, moveId(val(t, a[2])));
      // StringTemplate_SetNumber(…, 3, PADDING_MODE_SPACES): the cost right-aligned in three digits.
      const line = (n: number, slots: string[] = []) => toPrintOps(r.textOf(r.bankText(BANKS.menuEntries, n)), slots).map((op) => (op.kind === 'char' ? op.c : '')).join('');
      const lines = cost.flatMap((n, i) => [
        { text: line(SHARD_WINDOW.names[i]!), x: 0, y: 2 * i * SHARD_WINDOW.row },
        { text: line(SHARD_WINDOW.cost, [String(n).padStart(3, ' ')]), x: 0, y: (2 * i + 1) * SHARD_WINDOW.row },
      ]);
      const closeVar = r.ref(a[3], 'var');
      r.setVar(t, closeVar, MENU_RESULT.pending);
      r.ui.floorWindow = { view: { x: r.int(a[0]) * 8, y: r.int(a[1]) * 8, width: SHARD_WINDOW.width, height: SHARD_WINDOW.height, lines }, thread: t, closeVar };
      return 'continue';
    },
    close_shard_cost_window: () => {
      if (!r.ui.floorWindow) throw new Error('close_shard_cost_window: no cost window');
      r.ui.floorWindow = null;
      return 'continue';
    },

    // ---------------------------------------------------------------- relearner, tutor menu, deleter
    check_has_learnable_reminder_moves: (t, _c, a) => (dest(t, a[0], reminderMoves(r.registries, partyMon('check_has_learnable_reminder_moves', val(t, a[1]))).length ? 1 : 0), 'continue'),
    open_move_reminder_menu: (t, c, a) => {
      const slot = val(t, a[0]);
      return r.openApp(c, { app: 'move-reminder', slot, moves: reminderMoves(r.registries, partyMon('open_move_reminder_menu', slot)), tutor: false }, (result) => {
        if (result.app !== 'move-reminder') throw new Error(`open_move_reminder_menu: got a ${result.app} result`);
        learned = result.learned;
      });
    },
    open_move_tutor_menu: (t, c, a) => {
      const slot = val(t, a[0]);
      partyMon('open_move_tutor_menu', slot);
      return r.openApp(c, { app: 'move-reminder', slot, moves: [moveId(val(t, a[1]))], tutor: true }, (result) => {
        if (result.app !== 'move-reminder') throw new Error(`open_move_tutor_menu: got a ${result.app} result`);
        learned = result.learned;
      });
    },
    /** ScrCmd_CheckLearnedReminderMove / _TutorMove: 0 when a move was learned, 0xFF when the old moves stayed. */
    check_learned_reminder_move: (t, _c, a) => readLearned(t, a, 'check_learned_reminder_move'),
    check_learned_tutor_move: (t, _c, a) => readLearned(t, a, 'check_learned_tutor_move'),
    /** ScrCmd_SelectPartyMonMove (FieldSystem_OpenSummaryScreenSelectMove): the summary's move pick with no new move. */
    select_party_mon_move: (t, c, a) => {
      const slot = val(t, a[0]);
      partyMon('select_party_mon_move', slot);
      return r.openApp(c, { app: 'summary-teach', slot, move: null }, (result) => {
        if (result.app !== 'summary-teach') throw new Error(`select_party_mon_move: got a ${result.app} result`);
        movePick = result.forget;
      });
    },
    /** ScrCmd_GetSelectedPartyMonMove: the move slot picked, MOVE_NOT_SELECTED for none. */
    get_selected_party_mon_move: (t, _c, a) => {
      if (movePick === undefined) throw new Error('get_selected_party_mon_move: no summary ran (select_party_mon_move)');
      dest(t, a[0], movePick ?? MOVE_NOT_SELECTED);
      movePick = undefined;
      return 'continue';
    },
    /** ScrCmd_ClearPartyMonMoveSlot (Pokemon_ClearMoveSlot): the moves after it move up. */
    clear_party_mon_move_slot: (t, _c, a) => {
      const mon = partyMon('clear_party_mon_move_slot', val(t, a[0]));
      const slot = val(t, a[1]);
      if (slot >= mon.moves.length) throw new Error(`clear_party_mon_move_slot: slot ${slot} of ${mon.moves.length} moves`);
      for (const list of [mon.moves, mon.pp, mon.ppUps] as unknown[][]) list.splice(slot, 1);
      return 'continue';
    },

    // ---------------------------------------------------------------- NPC trades
    init_npc_trade: (_t, _c, a) => {
      const id = r.int(a[0]);
      npcTrade(r.registries, id);
      trade = id;
      return 'continue';
    },
    get_npc_trade_species: (t, _c, a) => (dest(t, a[0], r.registries.species.get(loadedTrade('get_npc_trade_species').species)!.sourceIndex!), 'continue'),
    get_npc_trade_requested_species: (t, _c, a) => (dest(t, a[0], r.registries.species.get(loadedTrade('get_npc_trade_requested_species').requested)!.sourceIndex!), 'continue'),
    /**
     * ScrCmd_StartNPCTrade (FieldTask_ProcessNPCTrade): the NPC's Pokémon is made at the traded one's level
     * (NPCTrade_CreateMon) and takes its party slot, the Pokédex and catch records count it (SaveData_UpdateCatchRecords);
     * then the trade scene, over the time of day's background. The field's music comes back after it (Field_StartMap).
     */
    start_npc_trade: (t, c, a) => {
      const tr = loadedTrade('start_npc_trade');
      const slot = val(t, a[0]);
      const sent = partyMon('start_npc_trade', slot);
      const received = createTradeMon(r.registries, tr, sent.level, r.clock().date);
      r.state.party[slot] = received;
      scoreCatch(r.state, r.registries, received.species);
      markCaught(r.state, r.registries, received);
      addPoketchHistory(r.state, received);
      const period = dayPeriod(r.state.gameTime.now.hour);
      const background = period === 'morning' || period === 'day' ? 'day' : period === 'twilight' ? 'evening' : 'night';
      return r.openApp(c, { app: 'trade', sent: structuredClone(sent), received: structuredClone(received), otName: tr.otName, background }, (result) => {
        if (result.app !== 'trade') throw new Error(`start_npc_trade: got a ${result.app} result`);
        r.audio.fadeToBgm(r.audio.effectiveBgm(r.state.player.zone));
      });
    },
    finish_npc_trade: () => {
      loadedTrade('finish_npc_trade');
      trade = null;
      return 'continue';
    },
  };

  function exitText(): Id {
    const ns = newGameRecord(r.registries).id.split(':')[0]!;
    return `${ns}:${MENU_ENTRY_EXIT}` as Id;
  }

  function readLearned(t: Thread, a: Arg[], op: string): 'continue' {
    if (learned === undefined) throw new Error(`${op}: no move reminder ran`);
    dest(t, a[0], learned ? 0 : 0xff);
    learned = undefined;
    return 'continue';
  }
}
