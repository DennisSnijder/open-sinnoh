/**
 * The Battle Arcade's frontier commands (decomp overlay 104 frscrcmd_battle_arcade.c, battle_arcade.c): the challenge
 * (`FrontierRunner.arcade`), the game board app, the effect it lands on, the battles, the room's Pokémon icons and
 * effect screens, and the saves. The multi challenge's link commands are not in scope.
 */
import { ARCADE, ARCADE_CATEGORY, ARCADE_EFFECT, arcadeCategory, BattleArcade } from '@opensinnoh/services';
import { plainMarkup } from '@opensinnoh/text';
import { introMessage } from './tower-ops.ts';
import { lcrng, numberOf } from './factory-ops.ts';
import type { FrontierHandler, FrontierRunner } from './runner.ts';

/** Decomp BA_FUNC_* (constants/battle_arcade_functions.h). */
const BA = {
  unk0: 0,
  unk1: 1,
  setChallengeType: 2,
  getAppCursorPos: 3,
  getCurrentStreak: 4,
  incrementCurrentStreak: 5,
  initCommManager: 6,
  resetSystem: 7,
  unk8: 8,
  hasSaved: 9,
  quicksave: 10,
  setEffectBackground: 11,
  getFreeBp: 12,
  unk13: 13,
  incrementCurrentBattle: 14,
  getHeldItem: 15,
  getActiveEffect: 16,
  getChallengeType: 17,
  restoreHeldItems: 18,
  getCurrentRound: 19,
  getOpponentObjectId: 20,
  saveOnLoss: 21,
  saveOnCompletingRound: 22,
  getCurrentBattle: 23,
  unk24: 24,
  swapMonSprites: 25,
  unk26: 26,
  unk27: 27,
  isMultiplayerChallenge: 28,
  loadMonSpriteData: 29,
  unloadMonSpriteData: 30,
  createMonSprites: 31,
  deleteMonSprites: 32,
  loadItemSpriteData: 33,
  unloadItemSpriteData: 34,
  createItemSprites: 35,
  deleteItemSprites: 36,
  loadNormalBackground: 37,
  setNameOfAffectedTrainer: 38,
  createEmitter: 39,
  loadTrainers: 40,
  setDrawFlagPlayerMon: 41,
  setDrawFlagOpponentMon: 42,
  setPalette: 43,
  unk44: 44,
  getEarnedBp: 45,
  disableBg2Layer: 46,
  checkImmuneToEffect: 47,
  getNextBattleType: 48,
  createOpponentMons: 49,
  setupOpponentsParty: 50,
  checkSeenStarIntro: 51,
  clearMsgsReceived: 52,
} as const;
/** Decomp sPlayerMonSpritePositions, sOpponentMonSpritePositions (battle_arcade.c); the item mark 8, 4 from the icon. */
const PLAYER_ICONS = [
  [33, 20],
  [39, 43],
  [43, 66],
  [46, 89],
] as const;
const OPPONENT_ICONS = [
  [222, 20],
  [216, 43],
  [213, 66],
  [210, 89],
] as const;
const ITEM_OFFSET = { x: 8, y: 4 } as const;

export function arcadeFrontierHandlers(): Record<string, FrontierHandler> {
  const arcade = (f: FrontierRunner): BattleArcade => {
    if (!f.arcade) throw new Error('the frontier runs a Battle Arcade command without a challenge (InitBattleArcade)');
    return f.arcade;
  };
  /** Decomp BattleArcade opponents[2]: the trainers LOAD_TRAINERS read for their intros. */
  const loaded = new WeakMap<BattleArcade, number[]>();

  /** Decomp BattleArcade_CreateMonSprites / _CreateItemSprites: a side's icons, items shown only when held. */
  const createIcons = (f: FrontierRunner, opponent: boolean, what: 'mon' | 'item') => {
    const t = arcade(f);
    const party = opponent ? t.opponents : t.players;
    const at = opponent ? OPPONENT_ICONS : PLAYER_ICONS;
    party.forEach((m, i) => {
      const key = `${opponent ? 'o' : 'p'}${i}`;
      const [x, y] = at[i]!;
      const icon = f.scene.icons.get(key) ?? { species: m.species, form: m.form, x, y, visible: false, item: { x: x + ITEM_OFFSET.x, y: y + ITEM_OFFSET.y, visible: false } };
      if (what === 'mon') {
        icon.species = m.species;
        icon.form = m.form;
        icon.x = x;
        icon.y = y;
        icon.visible = true;
      } else icon.item = { x: x + ITEM_OFFSET.x, y: y + ITEM_OFFSET.y, visible: m.heldItem !== null };
      f.scene.icons.set(key, icon);
    });
  };
  const deleteIcons = (f: FrontierRunner, opponent: boolean, what: 'mon' | 'item') => {
    for (const [key, icon] of f.scene.icons) {
      if (key[0] !== (opponent ? 'o' : 'p')) continue;
      if (what === 'mon') icon.visible = false;
      else icon.item.visible = false;
    }
  };
  const icon = (f: FrontierRunner, opponent: boolean, slot: number) => f.scene.icons.get(`${opponent ? 'o' : 'p'}${slot}`);

  return {
    fr_init_battle_arcade: (f, c, a) => {
      if (f.arcade) throw new Error('fr_init_battle_arcade: a challenge is already set up');
      f.arcade = BattleArcade.init(f.r.state, f.r.registries, lcrng(f), f.val(c, a[0]) === 1, f.val(c, a[1]), [2, 3, 4].map((i) => f.val(c, a[i])));
      return 'continue';
    },
    fr_battle_arcade_load_trainers_for_round: (f, c, a) => (arcade(f).loadRound(f.val(c, a[0]) === 1), 'continue'),
    fr_free_battle_arcade: (f) => ((f.arcade = null), 'continue'),

    // Decomp FrontierScrCmd_OpenBattleArcadeApp: the game board; its effect, cursor and random number are kept.
    fr_open_battle_arcade_app: (f, c) => {
      const t = arcade(f);
      const { randomCursor } = t.beforeBoard();
      const request = { app: 'arcade' as const, challengeType: t.challengeType, round: t.round, streak: t.streak, performance: t.performance, speed: t.speed, randomCursor, party: t.players.map((m) => structuredClone(m)), opponents: t.opponents.map((m) => structuredClone(m)) };
      return f.openApp(c, request, (result) => {
        if (result.app !== 'arcade') throw new Error(`fr_open_battle_arcade_app: got a ${result.app} result`);
        t.setAppResult(result.effect, result.cursor, result.random);
      });
    },
    fr_apply_arcade_effect: (f) => (arcade(f).applyEffect(), 'yield'),
    fr_battle_arcade_setup_first_opponent: (f) => (arcade(f).setupOpponentsParty(), 'continue'),
    fr_battle_arcade_setup_next_opponent: (f) => (arcade(f).setupNextOpponent(), 'continue'),

    // Decomp FrontierScrCmd_BattleArcade_StartBattle: the battle (a sub-app) with the board's weather.
    fr_battle_arcade_start_battle: (f, c) => {
      const t = arcade(f);
      f.r.field.startBattle({ kind: 'trainer', trainers: [], wild: [], ...(t.challengeType === 1 ? { topology: 'double' as const } : {}), frontier: t.battleSetup() });
      return f.pause(c, () => {
        if (!f.r.field.battleDone()) return false;
        f.afterSubApp();
        return true;
      });
    },
    fr_battle_arcade_cleanup_battle: (f) => {
      const result = f.r.field.battleDone();
      if (!result) throw new Error('fr_battle_arcade_cleanup_battle: no battle has ended');
      if (!result.enemyParty) throw new Error('fr_battle_arcade_cleanup_battle: the battle did not return the enemy party');
      arcade(f).cleanupBattle({ party: result.party, enemy: result.enemyParty, turns: result.turns, won: result.outcome !== 'lost' && result.outcome !== 'draw' });
      return 'continue';
    },
    fr_battle_arcade_check_won_battle: (f, c, a) => (f.set(c, a[0], arcade(f).won ? 1 : 0), 'continue'),
    fr_battle_arcade_print_trainer_intro: (f, c, a) => {
      if (!f.arcade) return 'continue';
      const trainer = loaded.get(f.arcade)?.[f.int(a[0])];
      if (trainer === undefined) throw new Error('fr_battle_arcade_print_trainer_intro: no trainer loaded (BA_FUNC_LOAD_TRAINERS)');
      return introMessage(f, c, trainer * 3);
    },
    // Decomp FrontierScrCmd_SetItemDrawFlag: a held-item mark shown (when the Pokémon holds one) or hidden.
    fr_set_item_draw_flag: (f, c, a) => {
      const opponent = f.val(c, a[0]) === 1;
      const slot = f.val(c, a[1]);
      const draw = f.val(c, a[2]) === 1;
      const t = arcade(f);
      const party = opponent ? t.opponents : t.players;
      const i = icon(f, opponent, slot);
      if (slot >= party.length) return 'continue';
      if (!i) throw new Error(`fr_set_item_draw_flag: no item sprite ${opponent ? 'opponent' : 'player'} ${slot}`);
      i.item.visible = draw && party[slot]!.heldItem !== null;
      return 'continue';
    },

    fr_call_battle_arcade_function: (f, c, a) => {
      const fn = f.int(a[0]);
      const arg1 = f.val(c, a[1]) & 0xff;
      const arg2 = f.val(c, a[2]) & 0xff;
      const dest = (v: number) => f.set(c, a[3], v);
      if (fn === BA.resetSystem) {
        f.r.saves().reset();
        return 'yield';
      }
      const t = arcade(f);
      switch (fn) {
        // Decomp: no case (unk0, 1, 8, 13, 26, 27), the comm manager and its messages (multi only).
        case BA.unk0:
        case BA.unk1:
        case BA.unk8:
        case BA.unk13:
        case BA.unk26:
        case BA.unk27:
        case BA.initCommManager:
        case BA.clearMsgsReceived:
          break;
        case BA.setChallengeType:
          throw new Error('BA_FUNC_SET_CHALLENGE_TYPE: no script calls it');
        case BA.getAppCursorPos:
          dest(t.appCursor);
          break;
        case BA.getCurrentStreak:
          dest(t.streak);
          break;
        case BA.incrementCurrentStreak:
          t.incrementStreak();
          break;
        case BA.hasSaved:
          dest(f.r.state.frontier?.arcade?.save.saved ? 1 : 0);
          break;
        case BA.quicksave:
          t.save(2);
          break;
        // Decomp BattleArcade_UpdateBackgroundForEffect: BG2 shows the effect's screen (hidden without one).
        case BA.setEffectBackground: {
          const screens = f.tables.arcade.art?.screens;
          if (t.effect === ARCADE.effects) f.scene.fgHidden = true;
          else if (screens) {
            const sheet = f.r.registries.ui2d.get(screens[t.effect]!);
            const cell = sheet?.cells[0];
            if (!cell) throw new Error(`BA_FUNC_SET_EFFECT_BACKGROUND: no screen for effect ${t.effect}`);
            f.scene.fgOverride = { sheet: screens[t.effect]!, width: cell.w, height: cell.h };
            f.scene.fgHidden = false;
          } else f.scene.fgHidden = false;
          break;
        }
        case BA.getFreeBp:
          dest(t.freeBp());
          break;
        case BA.incrementCurrentBattle:
          dest(++t.battle);
          break;
        case BA.getHeldItem: {
          const m = (arg1 === 0 ? t.players : t.opponents)[0]!;
          dest(m.heldItem ? numberOf(f, 'items', m.heldItem) : 0);
          break;
        }
        case BA.getActiveEffect:
          dest(t.effect);
          break;
        case BA.getChallengeType:
          dest(t.challengeType);
          break;
        case BA.restoreHeldItems:
          t.restoreHeldItems();
          break;
        case BA.getCurrentRound:
          dest(t.round);
          break;
        case BA.getOpponentObjectId:
          dest(t.opponentObject(arg1));
          break;
        case BA.saveOnLoss:
          t.saveOnLoss();
          break;
        case BA.saveOnCompletingRound:
          t.saveOnRoundComplete();
          break;
        case BA.getCurrentBattle:
          dest(t.battle);
          break;
        // Decomp unk_A74: a link partner retired (no link: never).
        case BA.unk24:
          dest(0);
          break;
        // Decomp BA_FUNC_SWAP_MON_SPRITES: under SWAP_MONS the icon columns (and their item marks) trade places.
        case BA.swapMonSprites:
          if (t.effect === ARCADE_EFFECT.swapMons) {
            for (let i = 0; i < t.players.length; i++) {
              const p = icon(f, false, i);
              const o = icon(f, true, i);
              if (!p || !o) throw new Error('BA_FUNC_SWAP_MON_SPRITES: the icons are not created');
              [p.x, o.x] = [o.x, p.x];
              [p.y, o.y] = [o.y, p.y];
              [p.item, o.item] = [o.item, p.item];
            }
          }
          break;
        case BA.isMultiplayerChallenge:
          dest(0);
          break;
        // Decomp: the icon and item-mark resources (no state of their own here).
        case BA.loadMonSpriteData:
        case BA.unloadMonSpriteData:
        case BA.loadItemSpriteData:
        case BA.unloadItemSpriteData:
          break;
        case BA.createMonSprites:
          createIcons(f, arg1 === 1, 'mon');
          break;
        case BA.deleteMonSprites:
          deleteIcons(f, arg1 === 1, 'mon');
          break;
        case BA.createItemSprites:
          createIcons(f, arg1 === 1, 'item');
          break;
        case BA.deleteItemSprites:
          deleteIcons(f, arg1 === 1, 'item');
          break;
        // Decomp BattleArcade_LoadNormalBackground: the multi room's BG3 (solo: nothing).
        case BA.loadNormalBackground:
          break;
        // Decomp: the foe's trainer (slot arg2's), or the player, in template slot arg1.
        case BA.setNameOfAffectedTrainer:
          f.slots[arg1] = arcadeCategory(t.effect) === ARCADE_CATEGORY.foe ? f.r.textOf(f.tables.trainers[t.trainerAt(arg2)]!.name) : plainMarkup(f.r.state.names.player);
          break;
        // Decomp CreateEmitter: an SPL particle emitter (not drawn).
        case BA.createEmitter:
          f.r.log.stub('frontier:particles', 'the frontier particle effects (SPL) are not drawn');
          break;
        case BA.loadTrainers:
          loaded.set(t, [t.trainerAt(0), t.trainerAt(1)]);
          break;
        case BA.setDrawFlagPlayerMon:
        case BA.setDrawFlagOpponentMon: {
          const opponent = fn === BA.setDrawFlagOpponentMon;
          if (arg2 >= (opponent ? t.opponents : t.players).length) break;
          const i = icon(f, opponent, arg2);
          if (!i) throw new Error(`BA_FUNC_SET_DRAW_FLAG: no Pokémon sprite ${opponent ? 'opponent' : 'player'} ${arg2}`);
          i.visible = arg1 === 1;
          break;
        }
        // Decomp BattleArcade_SetPalette(fraction, source): BG3's palette blended toward black.
        case BA.setPalette:
          f.scene.bgDarken = arg1;
          break;
        // Decomp: fraction 0 restores every sprite palette; else the actor `arg2`'s palette blended toward black.
        case BA.unk44:
          if (arg1 === 0) f.scene.clearActorDarken();
          else f.scene.setActorDarken(arg2, arg1);
          break;
        case BA.getEarnedBp:
          dest(t.earnedBp());
          break;
        case BA.disableBg2Layer:
          f.scene.fgHidden = true;
          break;
        case BA.checkImmuneToEffect:
          dest(t.immune ? 1 : 0);
          break;
        case BA.getNextBattleType:
          dest(t.nextBattleType());
          break;
        case BA.setupOpponentsParty:
          t.setupOpponentsParty();
          break;
        case BA.checkSeenStarIntro:
          dest(t.seenStarIntro ? 1 : 0);
          t.seenStarIntro = true;
          break;
        default:
          throw new Error(`fr_call_battle_arcade_function: BA function ${fn} is a link challenge's (no wireless) or unknown`);
      }
      return 'continue';
    },
  };
}
