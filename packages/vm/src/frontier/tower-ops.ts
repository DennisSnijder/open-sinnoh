/**
 * The Battle Tower's frontier commands (decomp overlay 104 frscrcmd_battle_tower.c, ov104_022394A4.c): the battle room's
 * `fr_call_battle_tower_function`, the opponent's intro, the battle and its result. The challenge is the field VM's
 * (`Runner.tower`, the decomp's fieldData->facilityData).
 */
import { tvBattlePoints } from '@opensinnoh/contracts';
import type { BattleTower } from '@opensinnoh/services';
import { TextPrinter, toPrintOps } from '@opensinnoh/text';
import { towerPartnerParam } from '../frontier-field-ops.ts';
import type { Id } from '@opensinnoh/core';
import { BRAIN_FACILITIES, BrainCutIn } from './effects.ts';
import { BlockWipe, LineWipe } from './wipes.ts';
import type { FrontierContext, FrontierHandler, FrontierRunner } from './runner.ts';

/** Decomp BT_FUNC_* (constants/battle_tower_functions.h) the battle rooms call. */
const BT = {
  resetSystem: 2,
  nextOpponentNum: 33,
  unk34: 34,
  hasDefeatedSeven: 35,
  unk36: 36,
  updateGameRecords: 37,
  updateGameRecordsAndJournal: 38,
  unk39: 39,
  setOpponentTeams: 40,
  opponentObjectId: 41,
  challengeMode: 43,
  setBeatPalmer: 44,
  unk46: 46,
  partnerParam: 55,
  unk58: 58,
  unk59: 59,
  checkIsNull: 100,
} as const;
/** Decomp BATTLE_FRONTIER_BRAIN_sseq (SEQ_PL_BA_BRAIN). */
const SEQ_PL_BA_BRAIN = 1202;

export function towerFrontierHandlers(): Record<string, FrontierHandler> {
  const tower = (f: FrontierRunner): BattleTower => {
    const t = f.tower();
    if (!t) throw new Error('the frontier runs a Battle Tower command without a challenge (InitBattleTower)');
    return t;
  };

  return {
    fr_call_battle_tower_function: (f, c, a) => {
      const fn = f.int(a[0]);
      const arg = f.val(c, a[1]);
      const dest = (v: number) => f.set(c, a[2], v);
      if (fn === BT.checkIsNull) {
        dest(f.tower() ? 0 : 1);
        return 'continue';
      }
      if (fn === BT.resetSystem) {
        f.r.saves().reset();
        return 'yield';
      }
      const t = tower(f);
      switch (fn) {
        case BT.unk46:
          {
            // FrontierScrCmd_CallBattleTowerFunction: the BP, then the day's BP for the TV (sub_0206D0C8).
            const bp = t.giveReward();
            tvBattlePoints(f.r.state, bp);
            dest(bp);
          }
          break;
        case BT.partnerParam:
          dest(towerPartnerParam(f.r, t, arg));
          break;
        case BT.nextOpponentNum:
          dest(t.nextOpponent);
          break;
        case BT.unk34:
          dest(t.advance());
          break;
        case BT.hasDefeatedSeven:
          dest(t.hasDefeatedSeven() ? 1 : 0);
          break;
        case BT.unk36:
          dest(t.streak());
          break;
        case BT.challengeMode:
          dest(t.mode);
          break;
        case BT.setOpponentTeams:
          t.createOpponentParties();
          break;
        case BT.opponentObjectId:
          dest(t.opponentObject(arg));
          break;
        case BT.setBeatPalmer:
          t.beatPalmer = arg;
          break;
        case BT.updateGameRecords:
          t.updateRecords();
          break;
        case BT.updateGameRecordsAndJournal:
          t.updateRecordsAndJournal();
          break;
        case BT.unk39:
          t.saveChallenge();
          break;
        // Decomp: clears the link send buffer (unk_884) and sets a link flag (unk_8D6): nothing without a link.
        case BT.unk58:
        case BT.unk59:
          break;
        default:
          throw new Error(`fr_call_battle_tower_function: BT function ${fn} is not one the frontier calls`);
      }
      return 'continue';
    },

    // Decomp FrontierScrCmd_85: the opponent's intro (FRONTIER_TRAINER_MESSAGES message trainer × 3), waiting for the printer.
    fr_cmd_85: (f, c, a) => {
      const t = tower(f);
      const o = t.opponents[f.int(a[0])];
      if (!o) throw new Error(`fr_cmd_85: no opponent ${f.int(a[0])}`);
      return introMessage(f, c, o.trainer * 3);
    },
    /**
     * Decomp FrontierScrCmd_3F → Unk_ov104_0223F65C[type]: the pre-battle wipe (the battle's music starts with the battle).
     * Types 0–4 first flash the main screen white twice (ov104_0223E894: 0 → 16 → 0 brightness, 3 frames each way), then:
     * 0 the Tower (ov104_02231148) fades to black over 12 frames (FADE_TYPE_UNK_32's pattern drawn as a plain fade);
     * 1 the Hall and 2 the Arcade fill BG1 black block by block (`BlockWipe`), then the screen is black; 3 the Factory and
     * 4 the Castle run the line wipe (`LineWipe`) while BG1–3 and the sprites darken over 40 frames, then BG3 goes off.
     * Type 5 (ov104_022319CC, a wave on BG3 that never ends) is in no script: a mod's call is loud.
     */
    fr_cmd_3f: (f, c, a) => {
      const type = f.val(c, a[0]);
      if (type > 4) throw new Error(`FrontierScrCmd_3F: wipe ${type} (the endless BG3 wave, used by no script) is not built`);
      const flashes: [boolean, number][] = [
        [true, 3],
        [false, 3],
        [true, 3],
        [false, 3],
      ];
      let i = 0;
      const flash = () => {
        const [out, ticks] = flashes[i++]!;
        f.scene.startFade(out, ticks, 'white');
      };
      flash();
      let state: 'flash' | 'wipe' | 'end' = 'flash';
      return f.pause(c, () => {
        const scene = f.scene;
        if (state === 'flash') {
          if (!scene.fadeDone()) return false;
          if (i < flashes.length) {
            flash();
            return false;
          }
          state = 'wipe';
          if (type === 0) scene.startFade(true, 12, 'black');
          else if (type === 1 || type === 2) {
            scene.wipe = new BlockWipe(type === 1 ? 'rows' : 'columns');
            return false;
          } else {
            scene.wipe = new LineWipe(type === 3 ? 1 : 2, scene.lineLayers());
            scene.startFade(true, 40, 'black');
          }
        }
        const wipe = scene.wipe;
        if (state === 'wipe') {
          if (type === 0) return scene.fadeDone();
          if (wipe instanceof BlockWipe) {
            // The step after the last block ends it (the default case of ov104_022311BC / 022312D8).
            if (wipe.step()) state = 'end';
            return false;
          }
          if (wipe instanceof LineWipe) {
            wipe.step();
            if (!scene.fadeDone()) return false;
            wipe.bgHidden = true;
            state = 'end';
            return false;
          }
          throw new Error('FrontierScrCmd_3F: the wipe is gone');
        }
        // ov104_02231AA8: both screens black, the wipe's window and task freed.
        scene.blackOut();
        scene.wipe = null;
        return true;
      });
    },
    /**
     * Decomp FrontierScrCmd_PlayFrontierBrainEncounterEffect (frontier_brain_encounter_effect.c): the Brain's cut-in
     * before the battle (`BrainCutIn`) with the Frontier Brain battle music (Sound_SetSceneAndPlayBGM); the script
     * waits for its end.
     */
    fr_play_frontier_brain_encounter_effect: (f, c, a) => {
      const facility = BRAIN_FACILITIES[f.int(a[0])];
      if (!facility) throw new Error(`fr_play_frontier_brain_encounter_effect: facility ${f.int(a[0])}`);
      const effect = new BrainCutIn(facility, { fade: (out, frames) => f.scene.startFade(out, frames, 'white'), fadeDone: () => f.scene.fadeDone() });
      const art = f.tables.effects;
      if (!art) f.r.log.stub('frontier:brain-cut-in-art', 'the pack has no Frontier Brain cut-in art (FrontierTables.effects): its timing and flashes only');
      const name = art ? f.r.plainText(art.brains[facility].name) : '';
      const animations = (sheet: Id) => {
        const s = f.r.registries.ui2d.get(sheet);
        if (!s?.animations) throw new Error(`frontier cut-in: sheet ${sheet} has no animations`);
        return s.animations;
      };
      f.scene.brainCutIn = { effect, view: () => (art ? effect.view(art, name, animations) : null) };
      const music = f.r.source('sequences', SEQ_PL_BA_BRAIN, false);
      if (music) f.r.audio.playBgm(music);
      else f.r.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${SEQ_PL_BA_BRAIN} in the packs: not played`);
      return f.pause(c, () => {
        if (!effect.finished) return false;
        f.scene.brainCutIn = null;
        return true;
      });
    },
    fr_free_tower_struct: (f) => {
      f.r.tower = null;
      return 'continue';
    },
    // Decomp FrontierScrCmd_BattleTower_StartBattle: the battle (a sub-app); the scripts wait for its end.
    fr_battle_tower_start_battle: (f, c) => {
      const t = tower(f);
      // Decomp BattleTower_GetBattleTypeFromChallengeMode: singles, doubles, or multi beside the AI partner.
      const topology = t.mode === 1 ? { topology: 'double' as const } : t.mode === 2 ? { topology: 'ai-partner' as const } : {};
      f.r.field.startBattle({ kind: 'trainer', trainers: [], wild: [], ...topology, frontier: t.battle() });
      return f.pause(c, () => {
        if (!f.r.field.battleDone()) return false;
        f.afterSubApp();
        return true;
      });
    },
    // Decomp FrontierScrCmd_BattleTower_CheckWonBattle (CheckPlayerWonBattle): anything but a loss or a draw.
    fr_battle_tower_check_won_battle: (f, c, a) => {
      const t = tower(f);
      const result = f.r.field.battleDone();
      if (!result) throw new Error('fr_battle_tower_check_won_battle: no battle has ended');
      t.won = result.outcome !== 'lost' && result.outcome !== 'draw';
      f.set(c, a[0], t.won ? 1 : 0);
      return 'continue';
    },
  };
}

/** Decomp BattleFrontier_PrintTrainerMessage: a FRONTIER_TRAINER_MESSAGES message, waiting for the printer. */
export function introMessage(f: FrontierRunner, c: FrontierContext, index: number): ReturnType<FrontierHandler> {
  const bank = f.r.registries.textBanks.get(f.tables.trainerMessages);
  const id = bank?.messages[index];
  const text = id && f.r.registries.texts.get(id);
  if (!text) throw new Error(`frontier: no trainer message ${index}`);
  const printer = new TextPrinter(toPrintOps(text.text, f.slots), { speed: f.r.textSpeed(), canSpeedUp: true });
  f.r.ui.message = { printer };
  return f.pause(c, () => printer.done);
}
