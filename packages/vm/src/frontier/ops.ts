/**
 * The frontier's general commands (decomp overlay 104 frscrcmd.c, frscrcmd_sound.c): flow, vars, messages, menus,
 * the room's actors and sprites, fades, sound, the party, BP and the save. Each follows its decomp handler; a
 * handler returns 'yield' where the decomp returns TRUE.
 */
import type { Arg, Id } from '@opensinnoh/core';
import { heal } from '@opensinnoh/core';
import { dexOf, type InputFrame } from '@opensinnoh/contracts';
import { addToGameRecord, giveBattlePoints, incrementTrainerScore, removeBattlePoints, battlePoints } from '@opensinnoh/services';
import { plainMarkup, TEXT_SPEED, TextPrinter, toPrintOps } from '@opensinnoh/text';
import { CONDITIONS } from '../commands.ts';
import { LIST_HEADER, MENU_RESULT, NO_ALT_TEXT, ScriptMenu, type MenuKind } from '../menu.ts';
import { M1B_BANKS } from '../m1b-ops.ts';
import { measureText } from '../ops.ts';
import { FRONTIER_TABLE } from './commands.ts';
import type { FrontierContext, FrontierHandler, FrontierResult, FrontierRunner } from './runner.ts';

/** Decomp sConditionTable: [condition][comparison result 0 <, 1 ==, 2 >]. */
const CONDITION_TABLE: Record<string, [boolean, boolean, boolean]> = {
  lt: [true, false, false],
  eq: [false, true, false],
  gt: [false, false, true],
  le: [true, true, false],
  ge: [false, true, true],
  ne: [true, false, true],
};
/** Decomp MENU_YES, MENU_NO. */
const MENU_YES = 0;
const MENU_NO = 1;
/** Decomp FADE_TYPE_* brightness out are even (field fade_screen's rule). */
const fadeOut = (type: number) => type % 2 === 0;
/** Decomp SE_CONFIRM (the menus' and yes/no's sound). */
const SE_CONFIRM = 1500;
/** Decomp OBJ_EVENT_GFX_PLAYER_M / _F (generated/object_events_gfx.txt). */
const PLAYER_GFX = { male: 0, female: 0x61 } as const;

const has = (input: InputFrame, b: InputFrame['pressed'][number]) => input.pressed.includes(b);

export function frontierHandlers(): Record<string, FrontierHandler> {
  const val = (f: FrontierRunner, c: FrontierContext, a: Arg | undefined) => f.val(c, a);
  const int = (f: FrontierRunner, a: Arg | undefined) => f.int(a);

  /** A sequence by its decomp number (`sequences` sourceIndex); a pack without it plays nothing (logged). */
  const seq = (f: FrontierRunner, n: number): Id | null => {
    if (n === 0) return null;
    const id = f.r.source('sequences', n, false);
    if (!id) f.r.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
    return id ?? null;
  };

  /** Decomp FrontierShowMessage: the message (with the manager's slots) at the text speed; `wait` for the printer. */
  const message = (f: FrontierRunner, c: FrontierContext, text: Id, speed: number, wait: boolean): FrontierResult => {
    const rec = f.r.registries.texts.get(text);
    if (!rec) throw new Error(`unknown text ${text}`);
    const printer = new TextPrinter(toPrintOps(rec.text, f.slots), { speed, canSpeedUp: true });
    f.r.ui.message = { printer };
    return wait ? f.pause(c, () => printer.done) : 'continue';
  };

  // ---------------------------------------------------------------- menus (decomp FrontierMenuManager)
  const menu = (f: FrontierRunner) => {
    const m = f.r.ui.menu;
    if (!m) throw new Error('no frontier menu (init_*_text_menu first)');
    return m;
  };
  /** The menu's result var (decomp FrontierMenuManager selectedOptionPtr, kept in ctx->data[0]). */
  const menuVars = new WeakMap<ScriptMenu, { c: FrontierContext; id: number }>();
  const initMenu =
    (local: boolean): FrontierHandler =>
    (f, c, a) => {
      const id = int(f, a[4]);
      const bank = local ? f.r.registries.textBanks.get(c.textBank)?.sourceIndex : M1B_BANKS.menuEntries;
      if (bank === undefined) throw new Error(`frontier menu: unknown text bank ${c.textBank}`);
      const m = new ScriptMenu({ x: int(f, a[0]), y: int(f, a[1]) }, int(f, a[2]), int(f, a[3]) === 1, bank);
      f.r.ui.menu = m;
      menuVars.set(m, { c, id });
      c.data[0] = id;
      f.setVar(c, id, MENU_RESULT.pending);
      return 'yield';
    };
  const entryText = (f: FrontierRunner, bank: number, index: number) =>
    toPrintOps(f.r.textOf(f.r.bankText(bank, index)), f.slots)
      .map((op) => (op.kind === 'char' ? op.c : ''))
      .join('');
  const showMenu =
    (kind: MenuKind): FrontierHandler =>
    (f, c) => {
      const m = menu(f);
      const target = menuVars.get(m)!;
      m.show(kind, (s) => measureText(f.r, s));
      const alt = () => {
        const id = m.current.altText;
        if (kind !== 'list' || id === undefined || id === NO_ALT_TEXT) return;
        f.r.ui.message = { printer: new TextPrinter(toPrintOps(f.r.textOf(f.r.bankText(m.bank, id)), f.slots), { speed: TEXT_SPEED.instant }) };
      };
      alt();
      return f.pause(c, (input) => {
        const touch = input.touch?.screen === 'main' && !f.r.lastTouch ? input.touch : null;
        const before = m.current;
        const result = m.step(input, touch);
        if (m.current !== before || result !== null) f.r.playFieldSe(SE_CONFIRM);
        if (result === null) {
          if (m.current !== before) alt();
          return false;
        }
        // Decomp: the menu writes its pick (a cancel as MENU_CANCEL), then the script resumes.
        f.setVar(target.c, target.id, result === MENU_RESULT.cancel ? 0xfffe : result);
        f.r.ui.menu = null;
        return true;
      });
    };

  // ---------------------------------------------------------------- the room
  /** A graphics operand of a table row: the player's (0xEEEE) or an object gfx number. */
  const gfxOf = (f: FrontierRunner, n: number): number => {
    if (n === FRONTIER_TABLE.player) return f.r.state.gender === 'male' ? PLAYER_GFX.male : PLAYER_GFX.female;
    if (n === FRONTIER_TABLE.linkPlayers) throw new Error('frontier: the link players\' graphics (0xEEEF) are not in scope (no wireless)');
    return n;
  };
  /** Reads a flattened table's rows (decode.ts), each value a var or a value. */
  const rows = (args: Arg[], size: (row: number[]) => number) => {
    const out: number[][] = [];
    const ints = args.map((a) => {
      if (a.kind !== 'int') throw new Error(`frontier table: ${JSON.stringify(a)}`);
      return a.value;
    });
    for (let i = 0; i < ints.length; ) {
      const head = ints.slice(i);
      const n = size(head);
      out.push(head.slice(0, n));
      i += n;
    }
    return out;
  };

  return {
    // ---------------------------------------------------------------- flow
    fr_noop: () => 'continue',
    fr_end: (f, c) => (f.stop(c), 'continue'),
    fr_exit_frontier: (f, c) => {
      f.stop(c);
      f.exited = true;
      return 'continue';
    },
    // Decomp FrontierScrCmd_ChangeSceneWithinScript: the room changes, this script goes on (it resumes next frame).
    fr_change_scene_within_script: (f, c, a) => {
      f.changeScene(val(f, c, a[0]), null);
      return f.pause(c, () => true);
    },
    fr_change_script: (f, c, a) => {
      f.changeScene(val(f, c, a[0]), f.ref(a[2], 'label'));
      f.stop(c);
      return 'continue';
    },
    fr_wait_time: (f, c, a) => {
      const id = int(f, a[1]);
      f.setVar(c, id, int(f, a[0]));
      c.data[0] = id;
      return f.pause(c, () => {
        const left = (f.getVar(c, c.data[0]!) - 1) & 0xffff;
        f.setVar(c, c.data[0]!, left);
        return left === 0;
      });
    },
    fr_set_var_from_value: (f, c, a) => (f.set(c, a[0], int(f, a[1])), 'continue'),
    fr_set_var_from_var: (f, c, a) => (f.set(c, a[0], f.getVar(c, int(f, a[1]))), 'continue'),
    fr_add_var: (f, c, a) => (f.set(c, a[0], f.getVar(c, int(f, a[0])) + val(f, c, a[1])), 'continue'),
    fr_sub_var: (f, c, a) => (f.set(c, a[0], f.getVar(c, int(f, a[0])) - val(f, c, a[1])), 'continue'),
    fr_compare_var_to_value: (f, c, a) => {
      const x = val(f, c, a[0]);
      const y = int(f, a[1]);
      c.cmp = x < y ? 0 : x === y ? 1 : 2;
      return 'continue';
    },
    fr_compare_var_to_var: (f, c, a) => {
      const x = f.getVar(c, int(f, a[0]));
      const y = f.getVar(c, int(f, a[1]));
      c.cmp = x < y ? 0 : x === y ? 1 : 2;
      return 'continue';
    },
    fr_go_to: (f, c, a) => (f.jump(c, f.ref(a[0], 'label')), 'continue'),
    fr_go_to_if: (f, c, a) => {
      if (condition(a[0], c.cmp)) f.jump(c, f.ref(a[1], 'label'));
      return 'continue';
    },
    fr_call: (f, c, a) => (f.call(c, f.ref(a[0], 'label')), 'continue'),
    fr_call_if: (f, c, a) => {
      if (condition(a[0], c.cmp)) f.call(c, f.ref(a[1], 'label'));
      return 'continue';
    },
    fr_return: (f, c) => (f.ret(c), 'continue'),

    // ---------------------------------------------------------------- messages
    fr_message_instant: (f, c, a) => message(f, c, f.ref(a[0], 'text'), TEXT_SPEED.instant, false),
    fr_message_no_skip: (f, c, a) => message(f, c, f.ref(a[0], 'text'), f.r.textSpeed(), true),
    fr_message: (f, c, a) => message(f, c, f.ref(a[0], 'text'), f.r.textSpeed(), true),
    fr_close_message: (f) => {
      if (!f.r.ui.message) throw new Error('fr_close_message: no message box is open');
      f.r.ui.message = null;
      return 'continue';
    },
    fr_wait_ab_press: (f, c) => f.pause(c, (input) => has(input, 'a') || has(input, 'b')),
    fr_wait_ab_press_time: (f, c, a) => {
      c.data[0] = val(f, c, a[0]);
      return f.pause(c, (input) => {
        if (has(input, 'a') || has(input, 'b')) return true;
        c.data[0] = (c.data[0]! - 1) & 0xffff;
        return c.data[0] === 0;
      });
    },
    fr_buffer_item_name: (f, c, a) => ((f.slots[int(f, a[0])] = f.r.itemRecord(val(f, c, a[1])).name), 'continue'),
    // Decomp StringTemplate_SetNumber with GetNumberDigitCount digits: no padding.
    fr_buffer_number: (f, c, a) => ((f.slots[int(f, a[0])] = String(val(f, c, a[1]))), 'continue'),
    fr_buffer_player_name: (f, _c, a) => ((f.slots[int(f, a[0])] = plainMarkup(f.r.state.names.player)), 'continue'),
    fr_buffer_rival_name: (f, _c, a) => ((f.slots[int(f, a[0])] = plainMarkup(f.r.state.names.rival)), 'continue'),
    fr_buffer_move_name: (f, c, a) => ((f.slots[int(f, a[0])] = f.r.textOf(f.r.bankText(M1B_BANKS.moveNames, val(f, c, a[1])))), 'continue'),
    fr_buffer_species_name: (f, c, a) => ((f.slots[int(f, a[0])] = plainMarkup(f.r.speciesName(val(f, c, a[1])))), 'continue'),
    fr_buffer_type_name: (f, c, a) => ((f.slots[int(f, a[0])] = f.r.textOf(f.r.bankText(M1B_BANKS.typeNames, val(f, c, a[1])))), 'continue'),

    // ---------------------------------------------------------------- menus and yes/no
    fr_init_global_text_menu: initMenu(false),
    fr_init_local_text_menu: initMenu(true),
    fr_init_global_text_list_menu: initMenu(false),
    fr_init_local_text_list_menu: initMenu(true),
    fr_add_menu_entry: (f, _c, a) => {
      const m = menu(f);
      m.add({ text: entryText(f, m.bank, int(f, a[0])), index: int(f, a[1]) });
      return 'continue';
    },
    fr_add_menu_entry_with_desc: (f, _c, a) => {
      const m = menu(f);
      m.add({ text: entryText(f, m.bank, int(f, a[0])), index: int(f, a[2]), altText: int(f, a[1]) & 0xff });
      return 'continue';
    },
    fr_add_list_menu_entry: (f, _c, a) => {
      const m = menu(f);
      const index = int(f, a[2]) & 0xff;
      m.add({ text: entryText(f, m.bank, int(f, a[0])), index: index === LIST_HEADER ? MENU_RESULT.header : index, altText: int(f, a[1]) & 0xff });
      return 'continue';
    },
    fr_show_menu: showMenu('single'),
    fr_show_list_menu: showMenu('list'),
    // Decomp FrontierMenuManager_FreeListMenu: the list closes with MENU_CANCEL.
    fr_free_list_menu: (f) => {
      const m = f.r.ui.menu;
      if (m) {
        const target = menuVars.get(m)!;
        f.setVar(target.c, target.id, 0xfffe);
        f.r.ui.menu = null;
      }
      return 'yield';
    },
    fr_set_menu_x_origin_side: (f, _c, a) => ((menu(f).anchorRight = int(f, a[0]) === 1), 'yield'),
    fr_set_menu_y_origin_side: (f, _c, a) => ((menu(f).anchorBottom = int(f, a[0]) === 1), 'yield'),
    fr_show_yes_no_menu: (f, c, a) => {
      const id = int(f, a[0]);
      c.data[0] = id;
      const box = (f.r.ui.yesNo = { cursor: (int(f, a[1]) === MENU_NO ? 1 : 0) as 0 | 1 });
      return f.pause(c, (input) => {
        const before = box.cursor;
        let result: number | null = null;
        if (has(input, 'a')) result = box.cursor === 0 ? MENU_YES : MENU_NO;
        else if (has(input, 'b')) result = MENU_NO;
        else if (has(input, 'up')) box.cursor = 0;
        else if (has(input, 'down')) box.cursor = 1;
        if (result !== null || box.cursor !== before) f.r.playFieldSe(SE_CONFIRM);
        if (result === null) return false;
        f.setVar(c, id, result);
        f.r.ui.yesNo = null;
        return true;
      });
    },

    // ---------------------------------------------------------------- the room's characters
    fr_cmd_22: (f, c, a) => {
      for (const [gfx] of rows(a, () => 2)) f.scene.loadCharacter(gfxOf(f, f.val(c, { kind: 'int', value: gfx! })));
      return 'continue';
    },
    fr_cmd_23: (f, c, a) => (f.scene.unloadCharacter(gfxOf(f, val(f, c, a[0]))), 'continue'),
    fr_cmd_24: (f, c, a) => {
      for (const row of rows(a, (r) => (r[1] === FRONTIER_TABLE.linkPlayers ? 8 : 7))) {
        const [localId, gfx, dir, x, y, visible] = row as [number, number, number, number, number, number];
        const v = (n: number) => f.val(c, { kind: 'int', value: n });
        const g = v(gfx);
        f.scene.addActor(v(localId), gfxOf(f, g), dir, x, y, visible === 1, g === FRONTIER_TABLE.player);
      }
      return 'continue';
    },
    fr_cmd_25: (f, c, a) => (f.scene.removeActor(val(f, c, a[0])), 'continue'),
    fr_cmd_26: (f, c, a) => (f.scene.setVisible(val(f, c, a[0]), int(f, a[1]) === 1), 'continue'),
    fr_dummy27: () => 'continue',
    fr_apply_movement: (f, c, a) => {
      const id = f.ref(a[1], 'movement');
      const mv = f.r.registries.movements.get(id);
      if (!mv) throw new Error(`unknown movement ${id}`);
      f.scene.applyMovement(val(f, c, a[0]), mv.steps);
      return 'continue';
    },
    fr_wait_movement: (f, c) => f.pause(c, () => f.scene.movements === 0),

    // ---------------------------------------------------------------- the room's sprites
    fr_cmd_2a: (f, c, a) => {
      for (const [id] of rows(a, () => 1)) f.scene.loadSpriteResources(f.val(c, { kind: 'int', value: id! }));
      return 'continue';
    },
    fr_cmd_2b: (f, c, a) => (f.scene.unloadSpriteResources(val(f, c, a[0])), 'continue'),
    fr_cmd_2c: (f, c, a) => {
      for (const row of rows(a, () => 6)) {
        const v = (n: number) => f.val(c, { kind: 'int', value: n });
        const [id, x, y, draw, animate, slot] = row as [number, number, number, number, number, number];
        f.scene.addSprite(slot, v(id), v(x), v(y), v(draw) === 1, animate === 1);
      }
      return 'continue';
    },
    fr_cmd_2d: (f, c, a) => (f.scene.removeSprite(val(f, c, a[0])), 'continue'),
    fr_cmd_2f: (f, c, a) => (f.scene.flipSprite(val(f, c, a[0])), 'continue'),
    // Decomp FrontierScrCmd_71 (sub_0202FAC0): 1 without a battle recording in memory (none is ever kept here).
    fr_cmd_71: (f, c, a) => (f.set(c, a[0], 1), 'continue'),
    fr_cmd_2e: (f, c, a) => (f.scene.setSpriteVisible(val(f, c, a[0]), int(f, a[1]) === 1), 'continue'),
    fr_cmd_31: (f, c, a) => (f.scene.playSprite(val(f, c, a[0]), val(f, c, a[1])), 'continue'),
    fr_cmd_32: (f, c, a) => (f.scene.stopSprite(val(f, c, a[0])), 'continue'),
    fr_cmd_33: (f, c, a) => {
      const slot = val(f, c, a[0]);
      c.data[0] = slot;
      return f.pause(c, () => f.scene.spriteDone(slot));
    },
    fr_get_player_obj_event_gfx: (f, c, a) => (f.set(c, a[0], f.r.state.gender === 'male' ? PLAYER_GFX.male : PLAYER_GFX.female), 'continue'),

    // ---------------------------------------------------------------- fades
    fr_fade_screen: (f, _c, a) => {
      const [steps, frames, type, color] = [0, 1, 2, 3].map((i) => int(f, a[i]));
      f.scene.startFade(fadeOut(type!), steps! * frames!, color === 0 ? 'black' : 'white');
      return 'continue';
    },
    fr_wait_fade_screen: (f, c) => f.pause(c, () => f.scene.fadeDone()),

    // ---------------------------------------------------------------- sound (frscrcmd_sound.c)
    fr_play_sound_effect: (f, c, a) => {
      const s = seq(f, val(f, c, a[0]));
      if (s) f.r.audio.playSe(s);
      return 'continue';
    },
    fr_stop_sound_effect: (f, c, a) => {
      const s = seq(f, val(f, c, a[0]));
      if (s) f.r.audio.stopSe(s);
      return 'continue';
    },
    fr_wait_sound_effect: (f, c, a) => {
      const s = seq(f, val(f, c, a[0]));
      return s ? f.pause(c, () => !f.r.audio.sePlaying(s)) : 'continue';
    },
    fr_play_fanfare: (f, c, a) => {
      const s = seq(f, val(f, c, a[0]));
      if (s) f.r.audio.playFanfare(s);
      return 'continue';
    },
    fr_wait_fanfare: (f, c) => f.pause(c, () => !f.r.audio.waitFanfare()),
    fr_play_bgm: (f, c, a) => (f.r.audio.playBgm(seq(f, val(f, c, a[0]))), 'continue'),
    fr_stop_bgm: (f) => (f.r.audio.stopBgm(), 'continue'),

    // ---------------------------------------------------------------- party, records, BP
    fr_heal_party: (f) => {
      const dex = dexOf(f.r.registries);
      for (const m of f.r.state.party) heal(dex, m);
      return 'continue';
    },
    // Decomp FrontierScrCmd_GetRandom: LCRNG_Next() % bound, then the script yields.
    fr_get_random: (f, c, a) => (f.set(c, a[0], (f.r.rng() >>> 0) % val(f, c, a[1])), 'yield'),
    fr_set_system_var: (f, c, a) => (f.r.setFieldVar(f.ref(a[0], 'var'), val(f, c, a[1])), 'continue'),
    fr_get_system_var: (f, c, a) => (f.set(c, a[1], f.r.getFieldVar(f.ref(a[0], 'var'))), 'continue'),
    fr_increment_record_value: (f, _c, a) => (addToGameRecord(f.r.state, f.r.registries, int(f, a[0]), 1), 'continue'),
    fr_add_to_record_value: (f, c, a) => (addToGameRecord(f.r.state, f.r.registries, int(f, a[0]), val(f, c, a[1])), 'continue'),
    fr_increment_trainer_score: (f, _c, a) => (incrementTrainerScore(f.r.state, f.r.registries, int(f, a[0])), 'continue'),
    fr_get_num_battle_points: (f, c, a) => (f.set(c, a[0], battlePoints(f.r.state)), 'continue'),
    fr_give_battle_points: (f, c, a) => {
      // Decomp FrontierScrCmd_GiveBattlePoints: sub_0206D0C8 records a TV segment first.
      f.r.log.stub('tv:frontier-bp', 'the Battle Points TV segment is not recorded (no TV yet)');
      giveBattlePoints(f.r.state, f.r.registries, val(f, c, a[0]));
      return 'continue';
    },
    fr_remote_battle_points: (f, c, a) => (removeBattlePoints(f.r.state, f.r.registries, val(f, c, a[0])), 'continue'),

    // ---------------------------------------------------------------- the save and battle videos
    fr_show_saving_icon: (f) => ((f.r.ui.savingIcon = true), 'continue'),
    fr_hide_saving_icon: (f) => ((f.r.ui.savingIcon = false), 'continue'),
    // Decomp FrontierScrCmd_72: SaveData_Save (REST); the dest var is unused.
    fr_cmd_72: (f) => (f.r.saves().write(), 'continue'),
    // Decomp BattleRecording_New / BattleRecording_Free: the Vs. Recorder's buffer (no battle videos: see fr_cmd_70).
    fr_init_new_battle_recording: () => 'continue',
    fr_free_battle_recording: () => 'continue',
    // Decomp FrontierScrCmd_70: whether a battle video is saved in that slot. No battle videos are recorded.
    fr_cmd_70: (f, c, a) => {
      f.r.log.stub('frontier:battle-video', 'battle videos (the Vs. Recorder) are not recorded: no video is saved');
      f.set(c, a[0], 0);
      return 'continue';
    },
    // Decomp FrontierScrCmd_6D: saves the battle as a video; the result is 1 saved, 0 failed. Nothing is recorded.
    fr_cmd_6d: (f, c, a) => {
      f.r.log.stub('frontier:battle-video', 'battle videos (the Vs. Recorder) are not recorded: saving one fails');
      f.set(c, a[3], 0);
      return 'yield';
    },

    // ---------------------------------------------------------------- link (no wireless)
    // Decomp FrontierScrCmd_SyncConnectedPlayers: with fewer than two players connected, no wait.
    fr_sync_connected_players: () => 'yield',
  };
}

function condition(a: Arg | undefined, cmp: number): boolean {
  if (a?.kind !== 'string' || !(CONDITIONS as readonly string[]).includes(a.value)) throw new Error(`bad condition ${JSON.stringify(a)}`);
  return CONDITION_TABLE[a.value]![cmp]!;
}
