/**
 * The Battle Hall's frontier commands (decomp overlay 104 frscrcmd_battle_hall.c) and the scene effects its scripts
 * (and the Factory's) use: the stage's Pokémon (FrontierScrCmd_45/46), the shake (4C/4D), window 0 (4E/4F), the
 * particle systems and the save that waits (73). The multi challenge's link commands are not in scope.
 */
import { dexOf } from '@opensinnoh/contracts';
import { isShiny, monGender } from '@opensinnoh/core';
import { BattleHall, hallPartySize } from '@opensinnoh/services';
import { introMessage } from './tower-ops.ts';
import { lcrng, numberOf } from './factory-ops.ts';
import type { FrontierHandler, FrontierRunner } from './runner.ts';

/** Decomp BH_FUNC_* (constants/battle_hall_functions.h). */
const BH = {
  unk0: 0,
  unk1: 1,
  getSelectedTypeIndex: 3,
  getCurrentStreak: 4,
  incrementCurrentStreak: 5,
  unk6: 6,
  resetSystem: 7,
  unk8: 8,
  checkHasSaved: 9,
  quicksave: 10,
  unk11: 11,
  unk12: 12,
  unk13: 13,
  incrementCurrentBattle: 14,
  getPlayersMonsSpecies: 15,
  unk16: 16,
  getChallengeType: 17,
  unk18: 18,
  getCurrentRound: 19,
  getOpponentObjectId: 20,
  saveOnLoss: 21,
  saveOnCompletingRound: 22,
  getCurrentBattle: 23,
  unk24: 24,
  unk25: 25,
  unk26: 26,
  restoreHeldItems: 27,
  incrementRankOfBeatenType: 28,
  isMultiplayerChallenge: 30,
  toggleEngineLayer: 31,
  loadTrainers: 32,
  getRankOfBeatenType: 33,
  getEarnedBp: 34,
  capTypeRanks: 35,
  setBaseLevel: 36,
  getNextBattleType: 37,
  dummy: 38,
} as const;
/** Decomp ov104_02232CE0's blend (FrontierScrCmd_45 overrides the script's: 8/16 toward black). */
const STAGE_DARKEN = 8;

export function hallFrontierHandlers(): Record<string, FrontierHandler> {
  const hall = (f: FrontierRunner): BattleHall => {
    if (!f.hall) throw new Error('the frontier runs a Battle Hall command without a challenge (InitBattleHall)');
    return f.hall;
  };
  /** Decomp BattleHall opponents[2]: the trainers LOAD_TRAINERS read for their intros. */
  const loaded = new WeakMap<BattleHall, number[]>();

  return {
    fr_init_battle_hall: (f, c, a) => {
      if (f.hall) throw new Error('fr_init_battle_hall: a challenge is already set up');
      f.hall = BattleHall.init(f.r.state, f.r.registries, lcrng(f), f.val(c, a[0]) === 1, f.val(c, a[1]), f.val(c, a[2]), f.val(c, a[3]));
      return 'continue';
    },
    fr_battle_hall_setup_next_opponent: (f) => (hall(f).setupNextOpponent(), 'continue'),
    fr_free_battle_hall: (f) => ((f.hall = null), 'continue'),

    // Decomp FrontierScrCmd_OpenBattleHallApp: the type board over the entered Pokémon; the cell picked is kept.
    fr_open_battle_hall_app: (f, c) => {
      const h = hall(f);
      const party = h.mons().map((m) => structuredClone(m));
      return f.openApp(c, { app: 'hall-board', challengeType: h.challengeType, ranks: [...h.ranks], streak: h.streak, party, cursor: h.rankCell }, (result) => {
        if (result.app !== 'hall-board') throw new Error(`fr_open_battle_hall_app: got a ${result.app} result`);
        h.setCell(result.cell);
      });
    },
    // Decomp FrontierScrCmd_BattleHall_StartBattle: the battle (a sub-app); the scripts wait for its end.
    fr_battle_hall_start_battle: (f, c) => {
      const h = hall(f);
      f.r.field.startBattle({ kind: 'trainer', trainers: [], wild: [], ...(hallPartySize(h.challengeType) === 2 ? { topology: 'double' as const } : {}), frontier: h.battleSetup() });
      return f.pause(c, () => {
        if (!f.r.field.battleDone()) return false;
        f.afterSubApp();
        return true;
      });
    },
    fr_battle_hall_cleanup_battle: (f) => {
      const result = f.r.field.battleDone();
      if (!result) throw new Error('fr_battle_hall_cleanup_battle: no battle has ended');
      hall(f).won = result.outcome !== 'lost' && result.outcome !== 'draw';
      return 'continue';
    },
    fr_battle_hall_check_won_battle: (f, c, a) => (f.set(c, a[0], hall(f).won ? 1 : 0), 'continue'),
    fr_battle_hall_print_trainer_intro: (f, c, a) => {
      if (!f.hall) return 'continue';
      const trainer = loaded.get(f.hall)?.[f.int(a[0])];
      if (trainer === undefined) throw new Error('fr_battle_hall_print_trainer_intro: no trainer loaded (BH_FUNC_LOAD_TRAINERS)');
      return introMessage(f, c, trainer * 3);
    },
    // Decomp FrontierScrCmd_BattleHall_UpdateWinRecord: the species' record; a changed one is saved at once.
    fr_battle_hall_update_win_record: (f, c, a) => {
      const updated = hall(f).updateWinRecord();
      if (updated) f.r.saves().write();
      f.set(c, a[0], updated ? 1 : 0);
      return 'yield';
    },
    // Decomp FrontierScrCmd_C7: the Hall's singles Pokémon for a TV segment (sub_0206D048). No TV yet.
    fr_cmd_c7: (f) => {
      if (hall(f).challengeType === 0) f.r.log.stub('tv:battle-hall', 'the Battle Hall TV segment is not recorded (no TV yet)');
      return 'continue';
    },

    fr_call_battle_hall_function: (f, c, a) => {
      const fn = f.int(a[0]);
      const arg1 = f.int(a[1]);
      const dest = (v: number) => f.set(c, a[3], v);
      if (fn === BH.resetSystem) {
        f.r.saves().reset();
        return 'yield';
      }
      const h = hall(f);
      switch (fn) {
        case BH.unk0:
        case BH.unk1:
        case BH.unk6:
        case BH.unk8:
        case BH.unk11:
        case BH.unk12:
        case BH.unk13:
        case BH.unk16:
        case BH.unk18:
        case BH.unk25:
        case BH.unk26:
        case BH.dummy:
          break;
        case BH.getSelectedTypeIndex:
          dest(h.cell);
          break;
        case BH.getCurrentStreak:
          dest(h.streak);
          break;
        case BH.incrementCurrentStreak:
          h.incrementStreak();
          break;
        case BH.checkHasSaved:
          dest(f.r.state.frontier?.hall?.save.saved ? 1 : 0);
          break;
        case BH.quicksave:
          h.save(2);
          break;
        case BH.incrementCurrentBattle:
          dest(++h.battle);
          break;
        case BH.getPlayersMonsSpecies:
          dest(numberOf(f, 'species', h.mons()[0]!.species));
          break;
        case BH.getChallengeType:
          dest(h.challengeType);
          break;
        case BH.getCurrentRound:
          dest(h.round);
          break;
        case BH.getOpponentObjectId:
          dest(h.opponentObject(arg1));
          break;
        case BH.saveOnLoss:
          h.saveOnLoss();
          break;
        case BH.saveOnCompletingRound:
          h.saveOnRoundComplete();
          break;
        case BH.getCurrentBattle:
          dest(h.battle);
          break;
        // Decomp unk_D88: the link partner retired (no link: never).
        case BH.unk24:
          dest(0);
          break;
        case BH.restoreHeldItems:
          h.restoreHeldItems();
          break;
        case BH.incrementRankOfBeatenType:
          h.incrementRank();
          break;
        case BH.isMultiplayerChallenge:
          dest(0);
          break;
        // Decomp GXLayers_EngineAToggleLayers(BG2): 0 shows the room's lights, 1 hides them.
        case BH.toggleEngineLayer:
          f.scene.fgHidden = arg1 !== 0;
          break;
        case BH.loadTrainers:
          loaded.set(h, [h.trainerAt(0), h.trainerAt(1)]);
          break;
        case BH.getRankOfBeatenType:
          dest(h.beatenRank());
          break;
        case BH.getEarnedBp:
          dest(h.earnedBp());
          break;
        case BH.capTypeRanks:
          h.capRanks();
          break;
        case BH.setBaseLevel:
          h.setBaseLevel();
          break;
        case BH.getNextBattleType:
          dest(h.nextBattleType());
          break;
        default:
          throw new Error(`fr_call_battle_hall_function: BH function ${fn} is a link challenge's (no wireless) or unknown`);
      }
      return 'continue';
    },

    // ---------------------------------------------------------------- scene effects (frscrcmd.c)
    // Decomp FrontierScrCmd_45: a party Pokémon's battle sprite on the stage, its palette half toward black.
    fr_cmd_45: (f, c, a) => {
      const slot = f.val(c, a[0]);
      const mon = f.r.state.party[slot];
      if (!mon) throw new Error(`fr_cmd_45: no party Pokémon in slot ${slot}`);
      const gender = monGender(dexOf(f.r.registries), mon);
      f.scene.showPokemon(f.int(a[3]), { species: mon.species, form: mon.form, female: gender === 'female', shiny: isShiny(mon.otId, mon.pid), x: f.val(c, a[1]), y: f.val(c, a[2]), darken: STAGE_DARKEN });
      return 'continue';
    },
    fr_cmd_46: (f, _c, a) => (f.scene.hidePokemon(f.int(a[0])), 'continue'),
    fr_cmd_4c: (f, c, a) => {
      const [x, y, every, count] = [0, 1, 2, 3].map((i) => f.val(c, a[i])) as [number, number, number, number];
      // Decomp: s16 offsets from u16 operands.
      f.scene.startShake((x << 16) >> 16, (y << 16) >> 16, every, count);
      return 'continue';
    },
    fr_cmd_4d: (f, c) => f.pause(c, () => f.scene.shakeDone()),
    fr_cmd_4e: (f, c, a) => {
      const [x1, y1, x2, y2, delay, on] = [0, 1, 2, 3, 4, 5].map((i) => f.val(c, a[i])) as [number, number, number, number, number, number];
      f.scene.startWindow({ x1: x1 & 0xff, y1: y1 & 0xff, x2: x2 & 0xff, y2: y2 & 0xff }, (delay << 16) >> 16, on === 1);
      return 'continue';
    },
    fr_cmd_4f: (f, c) => f.pause(c, () => f.scene.windowDone()),
    // Decomp FrontierScrCmd_InitParticleSystem … WaitForParticleSystemEmitters (frontier_particle_system.c): the scene's
    // SPL particle systems (the Factory head's smoke, the Hall's lights, the Castle's twinkle, the Arcade's effects).
    fr_init_particle_system: (f, c, a) => (f.scene.particles.init(f.val(c, a[0]), f.val(c, a[1]), f.val(c, a[2])), 'continue'),
    fr_free_particle_system: (f, c, a) => (f.scene.particles.free(f.val(c, a[0])), 'continue'),
    fr_create_particle_system_emitter: (f, c, a) => (f.scene.particles.createEmitter(f.val(c, a[0]), f.val(c, a[1])), 'continue'),
    fr_wait_for_particle_system_emitters: (f, c) => f.pause(c, () => f.scene.particles.idle()),
    // Decomp FrontierScrCmd_73: SaveData_SaveStateInit (a full save) and the wait for it.
    fr_cmd_73: (f) => (f.r.saves().write(), 'yield'),
  };
}
