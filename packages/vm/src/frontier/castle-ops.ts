/**
 * The Battle Castle's frontier commands (decomp overlay 104 frscrcmd_battle_castle.c): the challenge
 * (`FrontierRunner.castle`, the decomp's facility struct), its two apps, the battles, the Castle Points windows and
 * the saves. The multi challenge's link commands (send/wait comm messages, the partner's CP) are not in scope: no
 * script path reaches them without a link partner.
 */
import type { Id } from '@opensinnoh/core';
import { BattleCastle, castleHeardIntro, castlePoints, receiveCastlePoints, spendCastlePoints } from '@opensinnoh/services';
import { plainMarkup } from '@opensinnoh/text';
import { formatNumber, PADDING_SPACES } from '../m1b-ops.ts';
import { introMessage } from './tower-ops.ts';
import { lcrng, numberOf } from './factory-ops.ts';
import type { FrontierHandler, FrontierRunner } from './runner.ts';

/** Decomp BC_FUNC_* (constants/battle_castle_functions.h). */
const BC = {
  unk0: 0,
  unk1: 1,
  setChallengeType: 2,
  getSelectedAppSlot: 3,
  getCurrentStreak: 4,
  incrementCurrentStreak: 5,
  unk6: 6,
  resetSystem: 7,
  unk8: 8,
  hasSaved: 9,
  quicksave: 10,
  unk11: 11,
  unk12: 12,
  unk13: 13,
  incrementCurrentBattle: 14,
  getMonsSpecies: 15,
  getMonsMove: 16,
  getChallengeType: 17,
  restoreHeldItems: 18,
  getCurrentRound: 19,
  getOpponentObjectId: 20,
  saveOnLoss: 21,
  saveOnCompletingRound: 22,
  getCurrentBattle: 23,
  unk24: 24,
  checkIfMonFainted: 25,
  unk26: 26,
  getCpFromBattle: 27,
  prepForNextBattle: 28,
  initCommManager: 29,
  unk30: 30,
  unk31: 31,
  unk32: 32,
  unk33: 33,
  unk34: 34,
  isMultiplayerChallenge: 35,
  updateEmblemFrame: 36,
  loadTrainers: 37,
  getEarnedBp: 38,
  checkHaveHeardDarachsIntro: 39,
  getNextBattleType: 40,
  createOpponentMons: 41,
  setupOpponentsParty: 42,
  checkSeenValetIntro: 43,
  updateCp: 44,
} as const;
/** Decomp BattleCastle_ShowPlayerInfoWindows: BG1 at tile 1, 1, 10 × 4; the CP at 16, 16 (4 digits), the name at 0, 0. */
const CP_WINDOW = { x: 8, y: 8, width: 80, height: 32, digits: 4 } as const;
const CP_TEXT = 'platinum:BattleCastleSelfApp_Text_CastlePoints' as Id;
const NAME_TEXT = 'platinum:BattleCastleSelfApp_Text_PlayerName' as Id;
/** Decomp CapCurrentRound: the emblem of round 7 for every later one. */
const EMBLEMS = 7;
/** Decomp BattleCastle_UpdateEmblemFrame: BG3 at tile 11, 6. */
const EMBLEM_AT = { x: 88, y: 48 } as const;

export function castleFrontierHandlers(): Record<string, FrontierHandler> {
  const castle = (f: FrontierRunner): BattleCastle => {
    if (!f.castle) throw new Error('the frontier runs a Battle Castle command without a challenge (InitBattleCastle)');
    return f.castle;
  };
  /** Decomp BattleCastle opponents[2]: the trainers LOAD_TRAINERS read for their intros. */
  const loaded = new WeakMap<BattleCastle, number[]>();

  /** Decomp BattleCastle_PrintPlayersInfo: the player's name and CP (the window's lines). */
  const printInfo = (f: FrontierRunner) => {
    const w = f.scene.infoWindow;
    if (!w) throw new Error('the Castle Points window is not shown (ShowCastlePointsWindows)');
    const cp = formatNumber(castlePoints(f.r.state, castle(f).challengeType), PADDING_SPACES, CP_WINDOW.digits);
    w.lines = [
      { text: f.r.plainSlots(f.r.textOf(NAME_TEXT), [plainMarkup(f.r.state.names.player)]), x: 0, y: 0 },
      { text: f.r.plainSlots(f.r.textOf(CP_TEXT), [cp]), x: 16, y: 16 },
    ];
  };

  return {
    fr_init_battle_castle: (f, c, a) => {
      if (f.castle) throw new Error('fr_init_battle_castle: a challenge is already set up');
      f.castle = BattleCastle.init(f.r.state, f.r.registries, lcrng(f), f.val(c, a[0]) === 1, f.val(c, a[1]), [2, 3, 4].map((i) => f.val(c, a[i])));
      return 'continue';
    },
    fr_load_trainers_for_round: (f, c, a) => (castle(f).loadRound(f.val(c, a[0]) === 1), 'continue'),
    fr_free_battle_castle: (f) => ((f.castle = null), 'continue'),

    // Decomp FrontierScrCmd_OpenBattleCastleSelfApp / OpponentApp: the app over the challenge's parties.
    fr_open_battle_castle_self_app: (f, c) => openApp(f, c, 'self'),
    fr_open_battle_castle_opponent_app: (f, c) => openApp(f, c, 'opponent'),
    fr_battle_castle_setup_first_opponent: (f) => (castle(f).setupOpponentsParty(), 'continue'),
    fr_battle_castle_setup_next_opponent: (f) => (castle(f).setupNextOpponent(), 'continue'),

    // Decomp FrontierScrCmd_BattleCastle_StartBattle: the battle (a sub-app); the scripts wait for its end.
    fr_battle_castle_start_battle: (f, c) => {
      const t = castle(f);
      f.r.field.startBattle({ kind: 'trainer', trainers: [], wild: [], ...(t.challengeType === 1 ? { topology: 'double' as const } : {}), frontier: t.battleSetup() });
      return f.pause(c, () => {
        if (!f.r.field.battleDone()) return false;
        f.afterSubApp();
        return true;
      });
    },
    // Decomp FrontierScrCmd_BattleCastle_CleanupBattle: the battle's party back into the challenge's; CheckPlayerWonBattle.
    fr_battle_castle_cleanup_battle: (f) => {
      const result = f.r.field.battleDone();
      if (!result) throw new Error('fr_battle_castle_cleanup_battle: no battle has ended');
      castle(f).cleanupBattle(result.party, result.outcome !== 'lost' && result.outcome !== 'draw');
      return 'continue';
    },
    fr_battle_castle_check_won_battle: (f, c, a) => (f.set(c, a[0], castle(f).won ? 1 : 0), 'continue'),
    fr_battle_castle_print_trainer_intro: (f, c, a) => {
      if (!f.castle) return 'continue';
      const trainer = loaded.get(f.castle)?.[f.int(a[0])];
      if (trainer === undefined) throw new Error('fr_battle_castle_print_trainer_intro: no trainer loaded (BC_FUNC_LOAD_TRAINERS)');
      return introMessage(f, c, trainer * 3);
    },

    // ---------------------------------------------------------------- the Castle Points (the CP windows, spend, receive)
    fr_show_castle_points_windows: (f) => {
      if (f.scene.infoWindow) throw new Error('fr_show_castle_points_windows: the window is already shown');
      f.scene.infoWindow = { x: CP_WINDOW.x, y: CP_WINDOW.y, width: CP_WINDOW.width, height: CP_WINDOW.height, lines: [] };
      printInfo(f);
      return 'continue';
    },
    fr_clear_castle_points_windows: (f) => {
      if (!f.scene.infoWindow) throw new Error('fr_clear_castle_points_windows: no window is shown');
      f.scene.infoWindow = null;
      return 'continue';
    },
    fr_reprint_castle_points_info: (f) => (printInfo(f), 'continue'),
    fr_get_current_castle_points: (f, c, a) => (f.set(c, a[1], castlePoints(f.r.state, f.val(c, a[0]))), 'continue'),
    fr_spend_castle_points: (f, c, a) => (spendCastlePoints(f.r.state, f.val(c, a[0]), f.val(c, a[1])), 'continue'),
    fr_receive_castle_points: (f, c, a) => (receiveCastlePoints(f.r.state, f.r.registries, f.val(c, a[0]), f.val(c, a[1])), 'continue'),

    fr_call_battle_castle_function: (f, c, a) => {
      const fn = f.int(a[0]);
      const arg1 = f.int(a[1]);
      const arg2 = f.int(a[2]);
      const dest = (v: number) => f.set(c, a[3], v);
      if (fn === BC.resetSystem) {
        f.r.saves().reset();
        return 'yield';
      }
      if (fn === BC.checkHaveHeardDarachsIntro) {
        dest(castleHeardIntro(f.r.state) ? 1 : 0);
        return 'continue';
      }
      const t = castle(f);
      switch (fn) {
        // Decomp: no case (unk0, 1, 6, 8, 11–13), the comm manager (multi only), the WFC multi's CP swap.
        case BC.unk0:
        case BC.unk1:
        case BC.unk6:
        case BC.unk8:
        case BC.unk11:
        case BC.unk12:
        case BC.unk13:
        case BC.updateCp:
          break;
        case BC.setChallengeType:
          throw new Error('BC_FUNC_SET_CHALLENGE_TYPE: no script calls it');
        case BC.getSelectedAppSlot:
          dest(t.appSlot);
          break;
        case BC.getCurrentStreak:
          dest(t.streak);
          break;
        case BC.incrementCurrentStreak:
          t.incrementStreak();
          break;
        case BC.hasSaved:
          dest(f.r.state.frontier?.castle?.save.saved ? 1 : 0);
          break;
        case BC.quicksave:
          t.save(2);
          break;
        case BC.incrementCurrentBattle:
          dest(++t.battle);
          break;
        case BC.getMonsSpecies:
          dest(numberOf(f, 'species', t.opponentSet(arg1).species));
          break;
        case BC.getMonsMove: {
          const move = t.opponentSet(arg1).moves[arg2];
          dest(move ? numberOf(f, 'moves', move) : 0);
          break;
        }
        case BC.getChallengeType:
          dest(t.challengeType);
          break;
        case BC.restoreHeldItems:
          t.restoreHeldItems();
          break;
        case BC.getCurrentRound:
          dest(t.round);
          break;
        case BC.getOpponentObjectId:
          dest(t.opponentObject(arg1));
          break;
        case BC.saveOnLoss:
          t.saveOnLoss();
          break;
        case BC.saveOnCompletingRound:
          t.saveOnRoundComplete();
          break;
        case BC.getCurrentBattle:
          dest(t.battle);
          break;
        // Decomp unk_A10 / unk_A11: a link partner retired or chose (no link: never).
        case BC.unk24:
        case BC.unk26:
          dest(0);
          break;
        case BC.checkIfMonFainted:
          dest(t.monFainted ? 1 : 0);
          break;
        case BC.getCpFromBattle:
          dest(t.receiveBattleCp());
          break;
        case BC.prepForNextBattle:
          t.prepForNextBattle();
          break;
        // Decomp unk_A1B (the link partner's menu choice: none), unk_A18 (the player's, kept for the partner).
        case BC.unk30:
          dest(0);
          break;
        case BC.unk31:
        case BC.unk32:
          break;
        case BC.unk34:
          dest(0);
          break;
        case BC.isMultiplayerChallenge:
          dest(0);
          break;
        // Decomp BattleCastle_UpdateEmblemFrame: the round's emblem on BG3 (round 7 for later ones).
        case BC.updateEmblemFrame: {
          const emblems = f.tables.castle.art?.emblems;
          if (emblems) f.scene.bgPatch = { sheet: emblems[Math.min(t.round, EMBLEMS - 1)]!, ...EMBLEM_AT };
          break;
        }
        case BC.loadTrainers:
          loaded.set(t, [t.trainerAt(0), t.trainerAt(1)]);
          break;
        case BC.getEarnedBp:
          dest(t.earnedBp());
          break;
        case BC.getNextBattleType:
          dest(t.nextBattleType());
          break;
        case BC.setupOpponentsParty:
          t.setupOpponentsParty();
          break;
        case BC.checkSeenValetIntro:
          dest(t.seenValetIntro ? 1 : 0);
          t.seenValetIntro = true;
          break;
        default:
          throw new Error(`fr_call_battle_castle_function: BC function ${fn} is a link challenge's (no wireless) or unknown`);
      }
      return 'continue';
    },
  };

  /** Decomp BattleFrontier_RunSubApp with the Castle's app; StoreBattleCastleAppResult keeps what it changed. */
  function openApp(f: FrontierRunner, c: Parameters<FrontierHandler>[1], mode: 'self' | 'opponent'): ReturnType<FrontierHandler> {
    const t = castle(f);
    const request = { app: 'castle' as const, mode, challengeType: t.challengeType, party: t.players.map((m) => structuredClone(m)), opponents: t.opponents.map((m) => structuredClone(m)), unlocked: structuredClone(t.unlocked) };
    return f.openApp(c, request, (result) => {
      if (result.app !== 'castle') throw new Error(`fr_open_battle_castle_${mode}_app: got a ${result.app} result`);
      t.setAppResult(result);
    });
  }
}
