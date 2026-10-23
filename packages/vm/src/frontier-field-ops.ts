/**
 * The field side of the Battle Frontier: the Battle Tower's receptionist commands (decomp
 * unk_020494DC.c's ScrCmd_*BattleTower*, unk_02049D08.c), the scene launch into the frontier VM (`frontier/`), the
 * Battle Points windows and the exchange counters, the IV judge, and the in-script save (CommonScript_SaveGame's
 * check_save_type, the save info window, try_save_game and the saving icon).
 *
 * Wireless stays out: the Wi-Fi tower's connection (BT_FUNC_UNK_16) and the link battle club (`start_battle_client`,
 * `start_battle_server`) are logged and answer as a cancelled connection, so every such entry ends at the attendant's
 * goodbye.
 */
import type { Id } from '@opensinnoh/core';
import {
  BattleTower,
  battlePoints,
  clearTowerSave,
  deleteFactoryStreak,
  deleteHallStreak,
  enoughValidPokemon,
  frontierTables,
  giveBattlePoints,
  hallPartyEligible,
  hallPartySize,
  hallRecordKeeper,
  hallSpeciesWithRecords,
  hallStreakIs50,
  hallStreakSpecies,
  hallTotalSinglesRecord,
  judgeStats,
  removeBattlePoints,
  towerQuitWithoutSaving,
  towerSaveInProgress,
  towerTrophy,
  towerTrophyDue,
  TOWER_MODE,
} from '@opensinnoh/services';
import { formatNumber, PADDING_SPACES } from './m1b-ops.ts';
import { FrontierRunner } from './frontier/runner.ts';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp BT_FUNC_* (constants/battle_tower_functions.h). */
const BT = {
  checkEnoughValidPokemon: 1,
  resetSystem: 2,
  clearSave: 3,
  saveInProgress: 4,
  setCommunicationClubAccessible: 5,
  clearCommunicationClubAccessible: 6,
  latestStreak: 8,
  wifiDemote: 9,
  wifiRank: 10,
  wifiRecordFlag: 11,
  wifiResultsPending: 12,
  quitWithoutSaving: 14,
  wifiHasOpponents: 15,
  wifiConnect: 16,
  openPartyMenu: 30,
  readPartyMenu: 31,
  checkDuplicates: 32,
  hasDefeatedSeven: 35,
  updateGameRecords: 37,
  updateGameRecordsAndJournal: 38,
  saveChallenge: 39,
  opponentObjectId: 41,
  challengeMode: 43,
  getBeatPalmer: 45,
  trophyDue: 47,
  palmerRibbons: 48,
  streakRibbons: 49,
  setPartnerId: 50,
  getPartnerId: 51,
  chooseTrainers: 52,
  slotIndex: 53,
  wifiPromote: 54,
  partnerParam: 55,
  partnerParties: 56,
  seedChallenge: 57,
  clearLinkBuffer: 58,
  checkIsNull: 100,
} as const;

/** Decomp SAVE_TYPE_* (CommonScript_TrySaveGame): our one save has no overwrite or full-save states. */
const SAVE_TYPE = { noData: 1, quick: 3 } as const;
/** Decomp TEXT_BANK_SAVE_INFO_WINDOW (pl_msg 534) and SAVE_INFO_WINDOW_WIDTH/HEIGHT (tiles). */
const SAVE_INFO = { bank: 534, map: 0, labels: [1, 2, 3, 4], values: [5, 6, 7, 8], width: 13, height: 10 } as const;
/** Decomp FieldMenu_DrawBPWindow: COIN_BP_WINDOW_WIDTH × HEIGHT tiles, menu entries pl_msg_00000361_00230. */
const BP_WINDOW = { width: 10, height: 2, text: 'platinum:pl_msg_00000361_00230' as Id, digits: 5 } as const;
/** Decomp COMM_CLUB_RET_CANCEL: the link club closed without a group. */
const COMM_CLUB_RET_CANCEL = 1;
/** Decomp BH_LOBBY_FUNC_* (constants/battle_hall_functions.h). */
const BH_LOBBY = { checkPartyEligible: 0, checkStreakActive: 1, currentStreakSpecies: 2, deleteActiveStreak: 3, selectPokemon: 4 } as const;
/** Decomp PARTY_SLOT_NONE: no Pokémon picked. */
const PARTY_SLOT_NONE = 0xff;
/** Decomp MART_FRONTIER_ID_* (generated/mart_frontier_id.txt). */
const FRONTIER_MARTS = ['platinum:MART_FRONTIER_ID_EXCHANGE_SERVICE_CORNER_RIGHT', 'platinum:MART_FRONTIER_ID_EXCHANGE_SERVICE_CORNER_LEFT'] as Id[];

export function frontierFieldHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Parameters<Handler>[2][number] | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Parameters<Handler>[2][number] | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const tower = (op: string): BattleTower => {
    if (!r.tower) throw new Error(`${op}: no Battle Tower challenge (InitBattleTower)`);
    return r.tower;
  };
  /** The party menu's pick (decomp SCRIPT_MANAGER_PARTY_MANAGEMENT_DATA) between BT_FUNC_UNK_30 and _31. */
  let picked: number[] | null | undefined;
  /** The Hall's party pick (the same script member) between BH_LOBBY_FUNC_SELECT_POKEMON and GetBattleHallSelectedSlots. */
  let hallPicked: number[] | null | undefined;
  /** A species' number (the scripts' species operands). */
  const speciesNumber = (id: Id) => {
    const n = r.registries.species.get(id)?.sourceIndex;
    if (n === undefined) throw new Error(`frontier: species ${id} has no number`);
    return n;
  };

  const bpText = () => {
    const text = r.textOf(BP_WINDOW.text);
    return r.plainSlots(text, [formatNumber(battlePoints(r.state), PADDING_SPACES, BP_WINDOW.digits)]);
  };
  const bpWindow = (op: string) => {
    if (!r.ui.bpWindow) throw new Error(`${op}: the BP window is not shown`);
    return r.ui.bpWindow;
  };

  /** Decomp SaveInfoWindow (overlay 5): the map, the player, the badges, the Pokédex while obtained, the play time. */
  const saveInfo = () => {
    const s = r.state;
    const line = (i: number) => r.plainText(r.bankText(SAVE_INFO.bank, i));
    const value = (i: number, slots: string[]) => r.plainSlots(r.textOf(r.bankText(SAVE_INFO.bank, i)), slots);
    const zone = r.registries.zones.get(s.player.zone);
    if (!zone) throw new Error(`open_save_info: unknown zone ${s.player.zone}`);
    const seen = s.pokedex.obtained ? s.pokedex.seen.length : 0;
    const slots = ['', s.names.player, String(s.badges.length), String(seen), String(s.playTime.hours), String(s.playTime.minutes).padStart(2, '0')];
    const lines = [0, 1, 2, 3].filter((i) => i !== 2 || seen !== 0).map((i) => ({ label: line(SAVE_INFO.labels[i]!), value: value(SAVE_INFO.values[i]!, slots) }));
    return { x: 8, y: 8, width: SAVE_INFO.width * 8, height: (seen ? SAVE_INFO.height : SAVE_INFO.height - 2) * 8, title: r.plainSlots(r.textOf(r.bankText(SAVE_INFO.bank, SAVE_INFO.map)), [r.plainSlots(zone.name, [])]), lines };
  };

  const wifi = (fn: number) => r.log.stub(`communication:battle-tower-wifi-${fn}`, `Battle Tower function ${fn} is the Wi-Fi tower's (no wireless): it reads as no Wi-Fi data`);

  return {
    // Decomp ScrCmd_InitBattleTower(resume, challengeMode): the challenge in the field (fieldSystem->battleTower).
    init_battle_tower: (_t, _c, a) => {
      if (r.tower) throw new Error('init_battle_tower: a challenge is already set up');
      r.tower = BattleTower.init(r.state, r.registries, r.int(a[0]) === 1, r.int(a[1]));
      return 'continue';
    },
    set_battle_tower_null: () => {
      if (r.tower) throw new Error('set_battle_tower_null: a challenge is still set up');
      return 'continue';
    },
    free_battle_tower: () => ((r.tower = null), 'continue'),

    call_battle_tower_function: (t, c, a) => {
      const fn = r.int(a[0]);
      const arg = val(t, a[1]);
      const out = (v: number) => dest(t, a[2], v);
      switch (fn) {
        case BT.checkEnoughValidPokemon:
          out(enoughValidPokemon(r.state, r.registries, arg === 0 ? tower('BT_FUNC_CHECK_ENOUGH_VALID_POKEMON').partySize : arg) ? 1 : 0);
          break;
        case BT.resetSystem:
          r.saves().reset();
          return 'yield';
        case BT.clearSave:
          clearTowerSave(r.state);
          break;
        case BT.saveInProgress:
          out(towerSaveInProgress(r.state) ? 1 : 0);
          break;
        case BT.setCommunicationClubAccessible: {
          // Decomp BattleTower_SetCommunicationClubAccessible: CONTINUE resumes here (the lobby's OnFrame scripts).
          const p = r.state.player;
          r.state.specialLocation = { zone: p.zone, warp: -1, x: p.x, z: p.z, facing: 'up' };
          r.setFlag('platinum:FLAG_COMMUNICATION_CLUB_ACCESSIBLE' as Id, true);
          break;
        }
        case BT.clearCommunicationClubAccessible:
          r.setFlag('platinum:FLAG_COMMUNICATION_CLUB_ACCESSIBLE' as Id, false);
          break;
        case BT.latestStreak:
          out(arg === TOWER_MODE.wifiEarlier ? 0 : (r.state.frontier?.towerStreaks[arg]?.latest ?? 0));
          break;
        case BT.wifiDemote:
        case BT.wifiRank:
        case BT.wifiResultsPending:
        case BT.wifiHasOpponents:
        case BT.wifiPromote:
          wifi(fn);
          out(0);
          break;
        case BT.wifiRecordFlag:
          wifi(fn);
          break;
        // Decomp sub_0206BCE4: the Wi-Fi connection app. Without wireless it ends as a failed connection (non-zero).
        case BT.wifiConnect:
          wifi(fn);
          out(1);
          break;
        case BT.quitWithoutSaving:
          out(towerQuitWithoutSaving(r.state));
          break;
        // Decomp sub_0204A358: the party menu picking the challenge's Pokémon in order (PARTY_MENU_MODE_BATTLE_TOWER).
        case BT.openPartyMenu:
          return r.openApp(c, { app: 'party-order', count: tower('BT_FUNC_UNK_30').partySize }, (result) => {
            if (result.app !== 'party-order') throw new Error(`BT_FUNC_UNK_30: got a ${result.app} result`);
            picked = result.order;
          });
        // Decomp sub_0204A378: 0 when cancelled, else the picks are the challenge's (slots, species, items).
        case BT.readPartyMenu: {
          if (picked === undefined) throw new Error('BT_FUNC_UNK_31: no party menu has run');
          const order = picked;
          picked = undefined;
          if (order) tower('BT_FUNC_UNK_31').setSelection(order);
          out(order ? 1 : 0);
          break;
        }
        case BT.checkDuplicates:
          out(tower('BT_FUNC_CHECK_DUPLICATE_SPECIES_AND_HELD_ITEMS').duplicates());
          break;
        case BT.hasDefeatedSeven:
          out(tower('BT_FUNC_HAS_DEFEATED_SEVEN_TRAINERS').hasDefeatedSeven() ? 1 : 0);
          break;
        case BT.updateGameRecords:
          tower('BT_FUNC_UPDATE_GAME_RECORDS').updateRecords();
          break;
        case BT.updateGameRecordsAndJournal:
          tower('BT_FUNC_UPDATE_GAME_RECORDS_AND_JOURNAL').updateRecordsAndJournal();
          break;
        case BT.saveChallenge:
          tower('BT_FUNC_UNK_39').saveChallenge();
          break;
        case BT.opponentObjectId:
          out(tower('BT_FUNC_GET_OPPONENT_OBJECT_ID').opponentObject(arg));
          break;
        case BT.challengeMode:
          out(tower('BT_FUNC_GET_CHALLENGE_MODE').mode);
          break;
        case BT.getBeatPalmer:
          out(tower('BT_FUNC_GET_BEAT_PALMER').beatPalmer);
          break;
        case BT.palmerRibbons:
          out(tower('BT_FUNC_UNK_48').palmerRibbons() ? 1 : 0);
          break;
        case BT.streakRibbons:
          out(tower('BT_FUNC_UNK_49').streakRibbons() ? 1 : 0);
          break;
        case BT.setPartnerId:
          tower('BT_FUNC_SET_PARTNER_ID').partner = arg;
          break;
        case BT.getPartnerId:
          out(tower('BT_FUNC_GET_PARTNER_ID').partner);
          break;
        case BT.chooseTrainers:
          tower('BT_FUNC_UNK_52').chooseTrainers();
          break;
        case BT.slotIndex: {
          const slot = tower('BT_FUNC_GET_SLOT_INDEX').slots[arg];
          if (slot === undefined) throw new Error(`BT_FUNC_GET_SLOT_INDEX: no slot ${arg}`);
          out(slot);
          break;
        }
        case BT.partnerParam:
          out(towerPartnerParam(r, tower('BT_FUNC_GET_PARTNER_PARAM'), arg));
          break;
        case BT.partnerParties:
          tower('BT_FUNC_UNK_56').partnerParties();
          break;
        case BT.seedChallenge:
          out(tower('BT_FUNC_UNK_57').seedChallenge());
          break;
        case BT.clearLinkBuffer:
          break;
        case BT.checkIsNull:
          out(r.tower ? 0 : 1);
          break;
        default:
          r.log.stub(`battle-tower:fn-${fn}`, `Battle Tower function ${fn} is not built yet (returns 0)`);
          out(0);
      }
      return 'continue';
    },

    // Decomp ScrCmd_DeleteActiveBattleFactoryStreak: the lobby's "you didn't save" ends that streak.
    delete_active_battle_factory_streak: (t, _c, a) => (deleteFactoryStreak(r.state, val(t, a[0]), val(t, a[1]) === 1), 'continue'),

    // Decomp ScrCmd_CallBattleHallLobbyFunction.
    call_battle_hall_lobby_function: (t, c, a) => {
      const fn = r.int(a[0]);
      const arg = val(t, a[1]);
      const out = (v: number) => dest(t, a[2], v);
      switch (fn) {
        case BH_LOBBY.checkPartyEligible:
          out(hallPartyEligible(r.state, r.registries, arg) ? 1 : 0);
          break;
        case BH_LOBBY.checkStreakActive:
          out(r.state.frontier?.hall?.active[arg] ? 1 : 0);
          break;
        case BH_LOBBY.currentStreakSpecies: {
          const species = hallStreakSpecies(r.state, arg);
          out(species ? speciesNumber(species) : 0);
          break;
        }
        case BH_LOBBY.deleteActiveStreak:
          deleteHallStreak(r.state, arg);
          break;
        // Decomp SelectBattleHallChallengers: the party menu (PARTY_MENU_MODE_BATTLE_HALL, level 30, one or two of a
        // kind), its SUMMARY in the menu; the pick is read by GetBattleHallSelectedSlots.
        case BH_LOBBY.selectPokemon: {
          if (arg > 1) throw new Error('BH_LOBBY_FUNC_SELECT_POKEMON: the multi challenge needs a link partner');
          return r.openApp(c, { app: 'party-order', count: hallPartySize(arg), hall: true }, (result) => {
            if (result.app !== 'party-order') throw new Error(`BH_LOBBY_FUNC_SELECT_POKEMON: got a ${result.app} result`);
            hallPicked = result.order;
          });
        }
        default:
          throw new Error(`call_battle_hall_lobby_function: no lobby function ${fn}`);
      }
      return 'continue';
    },
    // Decomp ScrCmd_GetBattleHallSelectedSlots: the picks, or PARTY_SLOT_NONE in the first when cancelled.
    get_battle_hall_selected_slots: (t, _c, a) => {
      if (hallPicked === undefined) throw new Error('get_battle_hall_selected_slots: no party menu has run');
      if (hallPicked === null) dest(t, a[0], PARTY_SLOT_NONE);
      else {
        dest(t, a[0], hallPicked[0]!);
        dest(t, a[1], hallPicked[1] ?? 0);
      }
      hallPicked = undefined;
      return 'continue';
    },
    delete_active_battle_hall_streak: (t, _c, a) => (deleteHallStreak(r.state, val(t, a[0])), 'continue'),
    get_num_species_with_battle_hall_records: (t, _c, a) => (dest(t, a[0], hallSpeciesWithRecords(r.state)), 'continue'),
    get_battle_hall_total_singles_record: (t, _c, a) => (dest(t, a[0], hallTotalSinglesRecord(r.state)), 'continue'),
    check_if_battle_hall_streak_is50: (t, _c, a) => (dest(t, a[0], hallStreakIs50(r.state) ? 1 : 0), 'continue'),
    // Decomp ScrCmd_GetBattleHallRecordKeeperStats: the singles total against the milestones; the BP for those reached.
    get_battle_hall_record_keeper_stats: (t, _c, a) => {
      const [total, passed, upcoming, earned] = [0, 1, 2, 3].map((i) => r.int(a[i]));
      const records = r.state.frontier?.hall?.records[0] ?? {};
      const sum = Object.values(records).reduce((x, y) => x + y, 0);
      const k = hallRecordKeeper(frontierTables(r.registries).hall, sum, val(t, a[4]));
      t.slots[total!] = String(sum);
      dest(t, a[4], k.next);
      // Decomp: RECORD_BATTLE_POINTS_RECEIVED and the BP (none when no milestone was reached).
      giveBattlePoints(r.state, r.registries, k.bp);
      dest(t, a[5], k.response);
      if (k.response === 3) return 'continue';
      t.slots[passed!] = String(k.passed);
      t.slots[upcoming!] = String(k.upcoming ?? 0);
      t.slots[earned!] = String(k.bp);
      return 'continue';
    },

    // Decomp ScrCmd_GetBattleTowerPartnerSpeciesAndMove: the Battle Salon's partner tells their Pokémon and first move.
    get_battle_tower_partner_species_and_move: (t, _c, a) => {
      const mon = tower('get_battle_tower_partner_species_and_move').partnerMon(val(t, a[0]), val(t, a[1]));
      const number = (registry: 'species' | 'moves', id: Id) => {
        const n = r.registries[registry].get(id)?.sourceIndex;
        if (n === undefined) throw new Error(`get_battle_tower_partner_species_and_move: ${id} has no number`);
        return n;
      };
      dest(t, a[2], number('species', mon.species));
      dest(t, a[3], number('moves', mon.moves[0]!));
      return 'continue';
    },

    // Decomp ScrCmd_1DF (sub_0206BDBC): the singles trophy Teala hands over (1–3), a full PC (4) or none (0).
    scr_cmd_1df: (t, _c, a) => (dest(t, a[0], towerTrophy(r.state)), 'continue'),
    // Decomp ScrCmd_1E0 (sub_0206BF04): whether a trophy is due, so Teala stands in the lobby.
    scr_cmd_1e0: (t, _c, a) => (dest(t, a[0], towerTrophyDue(r.state)), 'continue'),

    // Decomp ScrCmd_LaunchBattleFrontierScene: the frontier app over the field; the script waits until it exits.
    launch_battle_frontier_scene: (_t, c, a) => {
      const scene = r.int(a[0]);
      const entry = a[1] && a[1].kind === 'label' ? a[1].id : null;
      if (!entry) throw new Error(`launch_battle_frontier_scene ${scene}: the decoder gave no entry label`);
      if (r.frontier) throw new Error('launch_battle_frontier_scene: a frontier scene already runs');
      r.frontier = new FrontierRunner(r, scene, entry, () => r.tower);
      return r.pause(c, () => {
        if (!r.frontier?.done) return false;
        r.frontier = null;
        return true;
      });
    },

    // Decomp ScrCmd_ShowBattlePoints → FieldMenu_DrawBPWindow(left, top).
    show_battle_points: (_t, _c, a) => {
      r.ui.bpWindow = { x: r.int(a[0]) * 8, y: r.int(a[1]) * 8, width: BP_WINDOW.width * 8, height: BP_WINDOW.height * 8, text: bpText() };
      return 'continue';
    },
    hide_battle_points: () => (bpWindow('hide_battle_points'), (r.ui.bpWindow = null), 'continue'),
    update_bp_display: () => ((bpWindow('update_bp_display').text = bpText()), 'continue'),
    get_battle_points: (t, _c, a) => (dest(t, a[0], battlePoints(r.state)), 'continue'),
    give_battle_points: (t, _c, a) => (giveBattlePoints(r.state, r.registries, val(t, a[0])), 'continue'),
    remove_battle_points: (t, _c, a) => (removeBattlePoints(r.state, r.registries, val(t, a[0])), 'continue'),
    // Decomp ScrCmd_CheckBattlePoints: whether the player has at least the value.
    check_battle_points: (t, _c, a) => (dest(t, a[1], battlePoints(r.state) >= val(t, a[0]) ? 1 : 0), 'continue'),

    // Decomp ScrCmd_PokeMartFrontier → Shop_Start(MART_TYPE_FRONTIER): the exchange counter, priced in BP.
    poke_mart_frontier: (_t, c, a) => {
      const mart = FRONTIER_MARTS[r.int(a[0])];
      if (!mart || !r.registries.marts.has(mart)) throw new Error(`poke_mart_frontier: no exchange counter ${r.int(a[0])}`);
      const greeting = r.ui.message ? r.ui.message.printer.text() : null;
      r.ui.message = null;
      return r.openApp(c, { app: 'mart', mart, countVar: null, greeting, currency: 'bp' }, () => {});
    },

    // Decomp ScrCmd_JudgeStats: the total IVs, the best stat's message number in the judge's bank, and its IV.
    judge_stats: (t, _c, a) => {
      const slot = val(t, a[0]);
      const mon = r.state.party[slot];
      if (!mon) throw new Error(`judge_stats: no Pokémon in party slot ${slot}`);
      const rng = r.rngSource();
      const j = judgeStats(mon, () => rng.next() % 2 === 0);
      const message = frontierTables(r.registries).judgeMessages[j.best];
      if (!message) throw new Error(`judge_stats: no message for stat ${j.best}`);
      dest(t, a[1], j.total);
      dest(t, a[2], r.indexInBank(message));
      dest(t, a[3], j.bestIv);
      return 'continue';
    },

    // Decomp ScrCmd_WaitABPressTime: until A or B, or the frames run out (the save's "saved" line, the tower's REST).
    wait_ab_press_time: (t, c, a) => {
      let left = val(t, a[0]);
      return r.pause(c, (input) => input.pressed.includes('a') || input.pressed.includes('b') || --left <= 0);
    },

    // ---------------------------------------------------------------- the in-script save (CommonScript_SaveGame)
    check_save_type: (t, _c, a) => (dest(t, a[0], r.saves().exists() ? SAVE_TYPE.quick : SAVE_TYPE.noData), 'continue'),
    // Decomp SaveDataExtra_Init and SaveData_MiscSaveBlock_InitFlag: our save has no extra blocks to set up.
    save_extra_data: () => 'continue',
    check_is_misc_save_init: (t, _c, a) => (dest(t, a[0], 1), 'continue'),
    try_save_game: (t, _c, a) => (dest(t, a[0], r.saves().write() ? 1 : 0), 'continue'),
    open_save_info: () => ((r.ui.saveInfo = saveInfo()), 'continue'),
    close_save_info: () => ((r.ui.saveInfo = null), 'continue'),
    show_saving_icon: () => ((r.ui.savingIcon = true), 'continue'),
    hide_saving_icon: () => ((r.ui.savingIcon = false), 'continue'),

    // Decomp ScrCmd_StartBattleClient/Server: the wireless link club. Out of scope (no wireless): logged, and it
    // answers COMM_CLUB_RET_CANCEL, so the script goes back to its menu.
    start_battle_client: (t, _c, a) => (r.log.stub('communication:link-club', 'the wireless link club is not available (no wireless): cancelled'), dest(t, a[3], COMM_CLUB_RET_CANCEL), 'continue'),
    start_battle_server: (t, _c, a) => (r.log.stub('communication:link-club', 'the wireless link club is not available (no wireless): cancelled'), dest(t, a[3], COMM_CLUB_RET_CANCEL), 'continue'),
  };
}

/** Decomp BattleTower_GetPartnerParam (BT_PARAM_*): the player's gfx, the multi partner's, or the partner id. */
export function towerPartnerParam(r: Runner, t: BattleTower, param: number): number {
  if (param === 2) return t.partner;
  if (param === 1) {
    if (t.mode === TOWER_MODE.multi) {
      const gfx = PARTNER_GFX[t.partner];
      if (gfx === undefined) throw new Error(`battle tower: no partner ${t.partner}`);
      return gfx;
    }
    throw new Error('battle tower: a link partner\'s graphics (no wireless)');
  }
  return r.state.gender === 'male' ? PLAYER_GFX.male : PLAYER_GFX.female;
}

/** OBJ_EVENT_GFX_CHERYL, _MIRA, _RILEY, _MARLEY, _BUCK (the partners in partner-id order) and the players. */
const PARTNER_GFX = [0x8d, 0x91, 0x8e, 0x8f, 0x90];
export const PLAYER_GFX = { male: 0, female: 0x61 } as const;

