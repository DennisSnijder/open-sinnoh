/**
 * The Super Contest script commands, offline (decomp src/scrcmd_contests.c, scrcmd.c ScrCmd_OpenPartyMenuForContest,
 * ScrCmd_GetContestPartyMenuResult, ScrCmd_MessageSynchronized, ScrCmd_ChangeIntoContestAttire,
 * ScrCmd_ContestPhotoHasData; contest.c Contest_*). The running contest is `GameState.contest` (services contest.ts holds
 * the rules); the rounds and results are the `contest` app. Without a link, the decomp's comm syncs pass at once
 * (Contest_StartCommSync, Contest_IsSyncState) and a synchronized message is a plain one.
 */
import { CONTEST_COMPETITION, type ContestSession, type Facing } from '@opensinnoh/contracts';
import type { Arg } from '@opensinnoh/core';
import { contestRibbon, endContest, newContest, victoryAccessory, winner } from '@opensinnoh/services';
import { plainMarkup } from '@opensinnoh/text';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp PARTY_SLOT_NONE. */
const PARTY_SLOT_NONE = 0xff;
/** Decomp TEXT_BANK_CONTEST_TEXT: COOL CONTEST … TOUGH CONTEST, NORMAL RANK … MASTER RANK, PRACTICE, CONTEST. */
const CONTEST_TEXT = { bank: 204, type: 41, rank: 46, practice: 50, contest: 52 } as const;
/** SEQ_SE_DP_KATI (the camera shutter), by SDAT index. */
const SE_SHUTTER = 1527;
/**
 * Decomp sNormalRankCameraFrameDelays … sLinkMasterRankCameraFrameDelays: per rank, two variants (the contestant's
 * unk_FC & 1), the frames before each flash.
 */
const FLASH_DELAYS: readonly (readonly (readonly number[])[])[] = [
  [[20, 20], [15, 25]],
  [[10, 10, 30], [15, 15, 15]],
  [[10, 8, 20, 28], [15, 15, 8, 8]],
  [[8, 8, 8, 8, 30], [15, 15, 8, 8, 20]],
];
const DIRS: Facing[] = ['up', 'down', 'left', 'right'];
/**
 * ov5_021E0DE0's two MapObjectAnimCmd lists around the redraw: face north/south/west/east (0–3), each a frame, and
 * MOVEMENT_ACTION_DELAY_1 × n (here [dir, n]).
 */
const SPIN_BEFORE: [number, number][] = [[1, 2], [2, 2], [0, 2], [3, 2], [1, 1], [2, 1], [0, 1], [3, 1], [1, 0], [2, 0], [0, 0], [3, 0], [1, 0], [2, 0], [0, 0], [3, 0]];
const SPIN_AFTER: [number, number][] = [[1, 0], [2, 0], [0, 0], [3, 0], [1, 0], [2, 0], [0, 0], [3, 0], [1, 1], [2, 1], [0, 1], [3, 1], [1, 2], [2, 3], [0, 4], [3, 5], [1, 0]];
/** The player's local id. */
const PLAYER = 0xff;

export function contestHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const slot = (t: Thread, a: Arg | undefined, markup: string) => void (t.slots[val(t, a)] = markup);
  const session = (op: string): ContestSession => {
    const s = r.state.contest;
    if (!s) throw new Error(`${op}: no contest runs (new_contest first)`);
    return s;
  };
  /** Decomp Contest_ContestantEntryNumToContestantID. */
  const entrant = (op: string, entry: number) => {
    const e = session(op).entrants[3 - entry];
    if (!e) throw new Error(`${op}: no contestant with entry number ${entry}`);
    return e;
  };
  const contestText = (i: number) => r.textOf(r.bankText(CONTEST_TEXT.bank, i));
  const practice = (s: ContestSession) => s.mode === 'practice';
  /** The pick of the contest party menu until `get_contest_party_menu_result` reads it. */
  let pick: number | null | undefined;
  /** The camera flash task (decomp ContestCameraFlashTask), while it runs. */
  let flash: { delays: readonly number[]; count: number; frame: number } | null = null;
  const seq = (n: number) => r.source('sequences', n, false);

  /** Faces the player per step, as a MapObject animation of one-frame faces and delays, then calls `then`. */
  const spin = (steps: [number, number][]) => {
    const ticks: (Facing | null)[] = steps.flatMap(([d, n]) => [DIRS[d]!, ...Array.from({ length: n }, () => null)]);
    let i = 0;
    return () => {
      if (i >= ticks.length) return true;
      const f = ticks[i++];
      if (f) r.field.faceObject(PLAYER, f);
      return false;
    };
  };

  return {
    /** ScrCmd_NewContest (offline): the contest's session, seeded from one draw of the game's main stream. */
    new_contest: (t, _c, a) => {
      const rank = val(t, a[0]);
      const type = val(t, a[1]);
      const competition = val(t, a[2]);
      const mode = competition === CONTEST_COMPETITION.full ? 'official' : 'practice';
      r.state.contest = newContest(r.state, r.registries, { mode, rank, type, competition, partySlot: val(t, a[3]), seed: r.rngSource().next() });
      return 'continue';
    },
    /** ScrCmd_EndContest: the rewards and the TV's data (services `endContest`), then the contest is gone. */
    end_contest: () => {
      const s = session('end_contest');
      endContest(r.state, r.registries, s);
      delete r.state.contest;
      return 'continue';
    },
    buffer_judge_name: (t, _c, a) => {
      const j = session('buffer_judge_name').judges[val(t, a[0])];
      if (j === undefined) throw new Error(`buffer_judge_name: no judge ${val(t, a[0])}`);
      const tables = [...r.registries.newGame.values()][0]!.contests!;
      slot(t, a[1], r.textOf(tables.judges[j]!.name));
      return 'continue';
    },
    buffer_contestant_trainer_name: (t, _c, a) => (slot(t, a[1], plainMarkup(entrant('buffer_contestant_trainer_name', val(t, a[0])).trainerName)), 'continue'),
    buffer_contestant_mon_name: (t, _c, a) => {
      const m = entrant('buffer_contestant_mon_name', val(t, a[0])).mon;
      slot(t, a[1], plainMarkup(m.nickname ?? r.registries.species.get(m.species)!.name));
      return 'continue';
    },
    /** StringTemplate_SetNumber(…, 1 digit). */
    buffer_contest_registration_entry_number: (t, _c, a) => (slot(t, a[1], String(val(t, a[0]))), 'continue'),
    /** Contest_GetContestRankTitleMessageID: PRACTICE for a practice, else the rank. */
    buffer_contest_rank: (t, _c, a) => {
      const s = session('buffer_contest_rank');
      slot(t, a[0], contestText(practice(s) ? CONTEST_TEXT.practice : CONTEST_TEXT.rank + s.rank));
      return 'continue';
    },
    /** Contest_GetFullContestTypeMessageID: CONTEST for the dance practice, else the type's. */
    buffer_contest_type: (t, _c, a) => {
      const s = session('buffer_contest_type');
      slot(t, a[0], contestText(s.competition === CONTEST_COMPETITION.practiceDance ? CONTEST_TEXT.contest : CONTEST_TEXT.type + s.type));
      return 'continue';
    },
    buffer_winning_contestant_trainer_name: (t, _c, a) => {
      const s = session('buffer_winning_contestant_trainer_name');
      slot(t, a[0], plainMarkup(s.entrants[winner(s)]!.trainerName));
      return 'continue';
    },
    buffer_winning_contestant_mon_name: (t, _c, a) => {
      const s = session('buffer_winning_contestant_mon_name');
      const m = s.entrants[winner(s)]!.mon;
      slot(t, a[0], plainMarkup(m.nickname ?? r.registries.species.get(m.species)!.name));
      return 'continue';
    },
    /** Contest_SetRibbonName: the ribbon of the contest's type and rank. */
    set_ribbon_name: (t, _c, a) => {
      const s = session('set_ribbon_name');
      const texts = [...r.registries.newGame.values()][0]?.ribbons?.[contestRibbon(s.type, s.rank)];
      if (!texts) throw new Error('set_ribbon_name: the pack has no ribbon texts');
      slot(t, a[0], r.textOf(texts.name));
      return 'continue';
    },
    get_player_contest_placement: (t, _c, a) => {
      const s = session('get_player_contest_placement');
      if (s.placement === null) throw new Error('get_player_contest_placement: the contest has not run');
      dest(t, a[0], s.placement);
      return 'continue';
    },
    get_winning_contestant_entry_num: (t, _c, a) => (dest(t, a[0], 3 - winner(session('get_winning_contestant_entry_num'))), 'continue'),
    /** The player is contestant 0: entry number 3. */
    get_contest_registration_entry_num: (t, _c, a) => (session('get_contest_registration_entry_num'), dest(t, a[0], 3), 'continue'),
    get_contestant_obj_event_gfx: (t, _c, a) => (dest(t, a[1], entrant('get_contestant_obj_event_gfx', val(t, a[0])).gfx), 'continue'),
    get_contestant_mon_contest_fame: (t, _c, a) => (dest(t, a[1], entrant('get_contestant_mon_contest_fame', val(t, a[0])).fame), 'continue'),
    /** Contest_GetContestMode: official or practice (never link offline). */
    get_contest_mode: (t, _c, a) => (dest(t, a[0], practice(session('get_contest_mode')) ? 2 : 0), 'continue'),
    get_contest_info: (t, _c, a) => {
      const s = session('get_contest_info');
      dest(t, a[0], s.rank);
      dest(t, a[1], s.type);
      dest(t, a[2], s.competition);
      dest(t, a[3], s.partySlot);
      return 'continue';
    },
    /** Contest_CheckPlayerMonHasRibbon: the party Pokémon (after end_contest's reward it would be set; the script asks before). */
    check_player_mon_has_ribbon: (t, _c, a) => {
      const s = session('check_player_mon_has_ribbon');
      dest(t, a[0], r.state.party[s.partySlot]!.ribbons.includes(contestRibbon(s.type, s.rank)) ? 1 : 0);
      return 'continue';
    },
    get_first_time_victory_accessory: (t, _c, a) => (dest(t, a[0], victoryAccessory(session('get_first_time_victory_accessory'), r.state.fashionCase)), 'continue'),
    /** ScrCmd_GetShouldSkipAwardCeremony: practice skips it; an NPC winner too (decomp v4: a winner past the connected players). */
    get_should_skip_award_ceremony: (t, _c, a) => {
      const s = session('get_should_skip_award_ceremony');
      dest(t, a[0], practice(s) || winner(s) !== 0 ? 1 : 0);
      return 'continue';
    },
    /** ScrCmd_RunContestApplication: the rounds (and the results of a full contest) in the contest app. */
    run_contest_application: (_t, c) => (session('run_contest_application'), r.openApp(c, { app: 'contest' }, () => {})),
    /** Contest_StartCameraFlashTask: the rank's (variant's) delays, a flash and the shutter after each. */
    start_contest_camera_flash_task: (t, _c, a) => {
      const s = session('start_contest_camera_flash_task');
      if (flash) throw new Error('start_contest_camera_flash_task: a flash task runs already');
      const e = entrant('start_contest_camera_flash_task', val(t, a[0]));
      flash = { delays: FLASH_DELAYS[s.rank]![e.aiLevel & 1]!, count: 0, frame: 0 };
      t.tasks.push(() => {
        const f = flash!;
        if (++f.frame <= f.delays[f.count]!) return false;
        r.field.cameraFlash();
        const se = seq(SE_SHUTTER);
        if (se) r.audio.playSe(se);
        f.count++;
        f.frame = 0;
        if (f.count < f.delays.length) return false;
        flash = null;
        return true;
      });
      return 'continue';
    },
    wait_for_contest_camera_flash_task: (_t, c) => r.pause(c, () => flash === null),
    /** Offline the comm syncs pass at once (Contest_StartCommSync returns, Contest_IsSyncState is TRUE). */
    start_contest_comm_sync: () => 'continue',
    wait_for_comm_sync_state: () => 'continue',
    /** SetLockTextWithAutoScroll(FALSE) offline: the field's own text settings, which ours are already. */
    lock_auto_scroll_for_link_contests: () => 'continue',
    /** LockTextSpeed: the field's message printer sets these render flags again for every message (field_message.c), so nothing outlasts it here. */
    lock_text_speed: () => 'continue',
    /** ScrCmd_ChangeIntoContestAttire (ov5_021E0DE0): the spin, the redraw in the contest attire, the spin back. */
    change_into_contest_attire: (_t, c) => {
      const before = spin(SPIN_BEFORE);
      let after: (() => boolean) | null = null;
      return r.pause(c, () => {
        if (!after) {
          if (!before()) return false;
          r.field.setPlayerAvatar('contest');
          after = spin(SPIN_AFTER);
        }
        return after();
      });
    },
    /** ScrCmd_OpenPartyMenuForContest: the party in contest mode (rank Normal for a link's default rank). */
    open_party_menu_for_contest: (t, c, a) => {
      const rank = val(t, a[3]) ? 0 : val(t, a[1]);
      return r.openApp(c, { app: 'contest-select', rank, type: val(t, a[2]) }, (res) => {
        if (res.app !== 'contest-select') throw new Error(`open_party_menu_for_contest: got ${res.app}`);
        pick = res.slot;
      });
    },
    /** ScrCmd_GetContestPartyMenuResult: the slot (PARTY_SLOT_NONE for none); SUMMARY runs inside the app, so never "show summary". */
    get_contest_party_menu_result: (t, _c, a) => {
      if (pick === undefined) throw new Error('get_contest_party_menu_result: no contest party menu ran');
      dest(t, a[0], pick ?? PARTY_SLOT_NONE);
      dest(t, a[1], 0);
      pick = undefined;
      return 'continue';
    },
    /**
     * ScrCmd_0A8 (the lobby's frames): the contest photo of type `slot` in the photo viewer (ov22_0225B660); the var is
     * 1 when the slot is empty (no viewer), else 0.
     */
    scr_cmd_0a8: (t, c, a) => {
      const slot = val(t, a[0]);
      if (!r.state.contestPhotos[slot]) {
        dest(t, a[1], 1);
        return 'continue';
      }
      dest(t, a[1], 0);
      return r.openApp(c, { app: 'contest-photo', slot }, () => {});
    },
    /** ImageClipsSlotHasData(…, contest photos, slot). */
    contest_photo_has_data: (t, _c, a) => (dest(t, a[1], r.state.contestPhotos[val(t, a[0])] ? 1 : 0), 'continue'),
    /** Offline, MessageSynchronized is ScriptMessage_Show as Message. */
    message_synchronized: (t, c, a) => {
      const p = r.showMessage(t, r.ref(a[0], 'text'), r.textSpeed());
      return r.pause(c, () => p.done);
    },
    /** HBlankSystem_Stop/Start: the field has no HBlank tasks to pause (no per-scanline effects are drawn). */
    stop_h_blank: () => 'continue',
    start_h_blank: () => 'continue',
    /** NetworkIcon_Init, NetworkIcon_Destroy and the battle sync's end: nothing offline (no comm system runs). */
    scr_cmd_2b0: () => 'continue',
    scr_cmd_2bb: () => 'continue',
    destroy_network_icon: () => 'continue',
  };
}

