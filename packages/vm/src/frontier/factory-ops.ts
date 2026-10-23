/**
 * The Battle Factory's frontier commands (decomp overlay 104 frscrcmd_battle_factory.c): the challenge
 * (`FrontierRunner.factory`, the decomp's facility struct), the rental app, the battles, the info messages and the
 * saves. The multi challenge's link commands (send/wait comm messages, the partner's party) are not in scope: no
 * script path reaches them without a link partner.
 */
import type { Id } from '@opensinnoh/core';
import { dexOf } from '@opensinnoh/contracts';
import { BattleFactory, type Rand16 } from '@opensinnoh/services';
import { plainMarkup } from '@opensinnoh/text';
import { introMessage } from './tower-ops.ts';
import type { FrontierHandler, FrontierRunner } from './runner.ts';

/** Decomp BF_FUNC_* (constants/battle_factory_functions.h). */
const BF = {
  unk0: 0,
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
  getMonsType: 17,
  getCommonType: 18,
  getCurrentRound: 19,
  getOpponentObjectId: 20,
  saveOnLoss: 21,
  saveOnCompletingRound: 22,
  getCurrentBattle: 23,
  unk24: 24,
  unk25: 25,
  unk26: 26,
  isMultiplayerChallenge: 28,
  getChallengeType: 29,
  updateBackground: 30,
  startCorridorAnimation: 31,
  stopCorridorAnimation: 32,
  loadTrainers: 33,
  setRentedMonsInString: 34,
  getEarnedBp: 35,
  incrementTradeCount: 36,
  getNextBattleType: 37,
  checkSeenHeadIntro: 41,
} as const;
/** Decomp BattleFactoryOTName_Text_Unknown (SetRentalPokemonSummaryInfo): the rentals' OT name. */
const RENTAL_OT_NAME = 'platinum:BattleFactoryOTName_Text_Unknown' as Id;

/** Decomp LCRNG_Next as the services take it: the high 16 bits of the game's next draw. */
export const lcrng = (f: FrontierRunner): Rand16 => () => f.r.rng() >>> 16;

/** A record's number (the scripts' species, move and type operands). */
export function numberOf(f: FrontierRunner, registry: 'species' | 'moves' | 'types' | 'items', id: Id): number {
  const n = f.r.registries[registry].get(id)?.sourceIndex;
  if (n === undefined) throw new Error(`frontier: ${id} has no number`);
  return n;
}

export function factoryFrontierHandlers(): Record<string, FrontierHandler> {
  const factory = (f: FrontierRunner): BattleFactory => {
    if (!f.factory) throw new Error('the frontier runs a Battle Factory command without a challenge (InitBattleFactory)');
    return f.factory;
  };
  /** Decomp BattleFactory opponents[2]: the trainers LOAD_TRAINERS read for their intros. */
  const loaded = new WeakMap<BattleFactory, number[]>();

  return {
    fr_init_battle_factory: (f, c, a) => {
      if (f.factory) throw new Error('fr_init_battle_factory: a challenge is already set up');
      const otName = plainMarkup(f.r.textOf(RENTAL_OT_NAME));
      f.factory = BattleFactory.init(f.r.state, f.r.registries, lcrng(f), otName, f.val(c, a[0]) === 1, f.val(c, a[1]), f.val(c, a[2]) === 1);
      return 'continue';
    },
    fr_battle_factory_load_trainers_for_round: (f, c, a) => (factory(f).loadRound(f.val(c, a[0]) === 1), 'continue'),
    fr_free_battle_factory: (f) => ((f.factory = null), 'continue'),

    // Decomp FrontierScrCmd_OpenBattleFactoryAppInitial: the rental app over the six rentals; its picks are kept.
    fr_open_battle_factory_app_initial: (f, c) => {
      const t = factory(f);
      return f.openApp(c, { app: 'factory', mode: 'rent', rentals: t.players.map((m) => structuredClone(m)), count: 3 }, (result) => {
        if (result.app !== 'factory' || !('picks' in result)) throw new Error('fr_open_battle_factory_app_initial: not a rental result');
        t.setAppResult(result.picks);
      });
    },
    // Decomp FrontierScrCmd_OpenBattleFactoryAppForTrade: the player's three against the beaten trainer's.
    fr_open_battle_factory_app_for_trade: (f, c) => {
      const t = factory(f);
      t.setAppResult([0, 0, 0, 0, 0, 0]);
      return f.openApp(c, { app: 'factory', mode: 'swap', rentals: t.players.map((m) => structuredClone(m)), offers: t.opponents.map((m) => structuredClone(m)) }, (result) => {
        if (result.app !== 'factory' || !('swap' in result)) throw new Error('fr_open_battle_factory_app_for_trade: not a trade result');
        t.setAppResult(result.swap ? [...result.swap] : [0xff, 0]);
      });
    },
    fr_add_selected_rentals_to_party: (f) => (factory(f).addRentals(), 'continue'),
    fr_battle_factory_setup_next_opponent: (f) => (factory(f).setupNextOpponent(), 'continue'),
    fr_battle_factory_apply_trade: (f) => (factory(f).applyTrade(), 'continue'),
    fr_battle_factory_setup_next_opponents_party: (f) => (factory(f).setupNextOpponentsParty(), 'continue'),

    // Decomp FrontierScrCmd_BattleFactory_StartBattle: the battle (a sub-app); the scripts wait for its end.
    fr_battle_factory_start_battle: (f, c) => {
      const t = factory(f);
      f.r.field.startBattle({ kind: 'trainer', trainers: [], wild: [], ...(t.challengeType === 1 ? { topology: 'double' as const } : {}), frontier: t.battleSetup() });
      return f.pause(c, () => {
        if (!f.r.field.battleDone()) return false;
        f.afterSubApp();
        return true;
      });
    },
    // Decomp FrontierScrCmd_BattleFactory_CleanupBattle: CheckPlayerWonBattle (anything but a loss or a draw).
    fr_battle_factory_cleanup_battle: (f) => {
      const result = f.r.field.battleDone();
      if (!result) throw new Error('fr_battle_factory_cleanup_battle: no battle has ended');
      factory(f).won = result.outcome !== 'lost' && result.outcome !== 'draw';
      return 'continue';
    },
    fr_battle_factory_check_won_battle: (f, c, a) => (f.set(c, a[0], factory(f).won ? 1 : 0), 'continue'),
    // Decomp FrontierScrCmd_BattleFactory_PrintTrainerIntro: the loaded trainer's intro (nothing without a challenge).
    fr_battle_factory_print_trainer_intro: (f, c, a) => {
      if (!f.factory) return 'continue';
      const trainer = loaded.get(f.factory)?.[f.int(a[0])];
      if (trainer === undefined) throw new Error('fr_battle_factory_print_trainer_intro: no trainer loaded (BF_FUNC_LOAD_TRAINERS)');
      return introMessage(f, c, trainer * 3);
    },

    fr_call_battle_factory_function: (f, c, a) => {
      const fn = f.int(a[0]);
      const arg1 = f.int(a[1]);
      const arg2 = f.int(a[2]);
      const dest = (v: number) => f.set(c, a[3], v);
      if (fn === BF.resetSystem) {
        f.r.saves().reset();
        return 'yield';
      }
      const t = factory(f);
      switch (fn) {
        // Decomp: unused2, and functions with no case.
        case BF.unk0:
        case BF.unk6:
        case BF.unk8:
        case BF.unk11:
        case BF.unk12:
        case BF.unk13:
        case BF.unk25:
          break;
        case BF.getSelectedAppSlot:
          dest(t.appSlots[arg1]!);
          break;
        case BF.getCurrentStreak:
          dest(t.streak);
          break;
        case BF.incrementCurrentStreak:
          t.incrementStreak();
          break;
        case BF.hasSaved:
          dest(f.r.state.frontier?.factory?.save.saved ? 1 : 0);
          break;
        case BF.quicksave:
          t.save(2);
          break;
        case BF.incrementCurrentBattle:
          dest(++t.battle);
          break;
        case BF.getMonsSpecies:
          dest(numberOf(f, 'species', t.opponentSet(arg1).species));
          break;
        case BF.getMonsMove: {
          const move = t.opponentSet(arg1).moves[arg2];
          dest(move ? numberOf(f, 'moves', move) : 0);
          break;
        }
        case BF.getMonsType: {
          const set = t.opponentSet(arg1);
          dest(numberOf(f, 'types', dexOf(f.r.registries).form(set.species, set.form).types[0]!));
          break;
        }
        case BF.getCommonType:
          dest(t.commonType());
          break;
        case BF.getCurrentRound:
          dest(t.round);
          break;
        case BF.getOpponentObjectId:
          dest(t.opponentObject(arg1));
          break;
        case BF.saveOnLoss:
          t.saveOnLoss();
          break;
        case BF.saveOnCompletingRound:
          t.saveOnRoundComplete();
          break;
        case BF.getCurrentBattle:
          dest(t.battle);
          break;
        // Decomp unk_57C / unk_57D: a link partner retired or declined the trade (no link: never).
        case BF.unk24:
        case BF.unk26:
          dest(0);
          break;
        case BF.isMultiplayerChallenge:
          dest(0);
          break;
        case BF.getChallengeType:
          dest(t.challengeType);
          break;
        // Decomp Bg_ChangeTilemapRectPalette on BG3 (3, 10, 26 × 11): the battle room's door lighting up, step 0–4.
        case BF.updateBackground:
          f.r.log.stub('frontier:factory-room-palette', "the Factory battle room's door light palette steps are not drawn");
          break;
        case BF.startCorridorAnimation:
          f.scene.corridorFloor = true;
          break;
        case BF.stopCorridorAnimation:
          f.scene.corridorFloor = false;
          break;
        case BF.loadTrainers:
          loaded.set(t, [t.trainerAt(0), t.trainerAt(1)]);
          break;
        case BF.setRentedMonsInString:
          t.players.forEach((m, i) => (f.slots[i] = plainMarkup(f.r.speciesName(numberOf(f, 'species', m.species)))));
          break;
        case BF.getEarnedBp:
          dest(t.earnedBp());
          break;
        case BF.incrementTradeCount:
          t.incrementTrades();
          break;
        case BF.getNextBattleType:
          dest(t.nextBattleType());
          break;
        case BF.checkSeenHeadIntro:
          dest(t.seenHeadIntro ? 1 : 0);
          t.seenHeadIntro = true;
          break;
        default:
          throw new Error(`fr_call_battle_factory_function: BF function ${fn} is a link challenge's (no wireless) or unknown`);
      }
      return 'continue';
    },
  };
}

