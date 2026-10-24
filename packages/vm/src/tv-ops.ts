/**
 * The TV's script commands (decomp scrcmd_tv_broadcast.c; res/field/scripts/scripts_tv_broadcast.s and
 * scripts_tv_reporter_interviews.s; docs/research/tv.md). The broadcast and the interviews are services `tv.ts`; the saved
 * segments and the recorders are contracts `tv.ts`. A TV message is printed by the script's own MessageFromBank from the
 * bank and message these commands put in its vars, with the string template filled here.
 */
import { plainMarkup } from '@opensinnoh/text';
import { monGender, type Arg, type Id } from '@opensinnoh/core';
import { dexOf, saveTvSegment, type TvAmityFind } from '@opensinnoh/contracts';
import {
  easyChatWordText, incrementTrainerScore, localDexCompleted, tvCommercial, tvFinish, tvFraming, tvInterviewEligible, tvInterviewMessage,
  tvLoadSegment, tvNextSegment, tvSaveInterview, tvStatus, zoneLabel, type TvContext, type TvMessage, type TvSlot,
} from '@opensinnoh/services';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp TV_BROADCAST_CALL_* and TV_INTERVIEW_CALL_*. */
const CALL = { status: 0, framing: 1, finish: 2, segment: 3, commercial: 4, unused: 5, next: 6 } as const;
const INTERVIEW = { message: 0, save: 1 } as const;
/** ScrCmd_GetBattleFrontierReporterPosition's default (no multi partner offline): x 47, z 21, DIR_NORTH, MOVEMENT_TYPE_LOOK_NORTH. */
const REPORTER_AT = { x: 47, z: 21, dir: 0, movement: 14 } as const;
/** Decomp GENDER_MALE, GENDER_FEMALE, GENDER_NONE (Pokemon_GetValue MON_DATA_GENDER). */
const GENDERS = { male: 0, female: 1, none: 2 } as const;

export function tvHandlers(r: Runner): Record<string, Handler> {
  const ns = () => [...r.registries.newGame.values()][0]!.id.split(':')[0]!;
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const ctx = (): TvContext => ({ registries: r.registries, state: r.state, rng: () => r.rng() >>> 0 });
  const bankNumber = (bank: string) => {
    const b = r.registries.textBanks.get(`${ns()}:${bank}` as Id);
    if (!b) throw new Error(`tv: the pack has no ${bank}`);
    if (b.sourceIndex === undefined) throw new Error(`tv: ${bank} has no source index`);
    return b.sourceIndex;
  };
  const slotText = (s: TvSlot): string => {
    if ('plain' in s) return plainMarkup(s.plain);
    if ('number' in s) return String(s.number);
    if ('word' in s) return r.textOf(easyChatWordText(r.registries, s.word));
    const id = r.registries.textBanks.get(`${ns()}:${s.bank}` as Id)?.messages[s.entry];
    if (!id) throw new Error(`tv: ${s.bank} has no entry ${s.entry}`);
    return r.textOf(id);
  };
  /** The message's template into the thread's slots, its bank and number into the two vars. */
  const put = (t: Thread, m: TvMessage, bankVar: Arg | undefined, messageVar: Arg | undefined) => {
    for (const [i, s] of Object.entries(m.slots)) t.slots[Number(i)] = slotText(s);
    dest(t, bankVar, bankNumber(m.bank));
    dest(t, messageVar, m.message);
  };
  const partyMon = (op: string, slot: number) => {
    const mon = r.state.party[slot];
    if (!mon) throw new Error(`${op}: no party member ${slot}`);
    return mon;
  };
  const itemBySource = (n: number) => r.source('items', n)!;
  const nickname = (mon: { nickname?: string | null; species: Id }) => mon.nickname ?? r.registries.species.get(mon.species)!.name;

  return {
    /** ScrCmd_CallTVBroadcast. */
    call_tv_broadcast: (t, _c, a) => {
      const call = r.int(a[0]);
      switch (call) {
        case CALL.status:
          dest(t, a[1], tvStatus(r.state));
          break;
        case CALL.framing:
          dest(t, a[2], bankNumber('TEXT_BANK_TV_PROGRAMS'));
          dest(t, a[3], tvFraming(r.registries, r.state, r.int(a[1])));
          break;
        case CALL.finish:
          tvFinish(r.state);
          break;
        case CALL.segment:
          put(t, tvLoadSegment(ctx(), r.val(t, a[1])), a[2], a[3]);
          break;
        case CALL.commercial:
          dest(t, a[1], bankNumber('TEXT_BANK_TV_COMMERCIALS'));
          dest(t, a[2], tvCommercial(ctx(), localDexCompleted(r.state, r.registries)));
          break;
        case CALL.next:
          dest(t, a[1], tvNextSegment(ctx()));
          break;
        default:
          throw new Error(`call_tv_broadcast: call ${call} (no script uses ${call === CALL.unused ? 'the unused call' : 'it'})`);
      }
      return 'continue';
    },
    /** ScrCmd_CallTVInterview: the reporter's question, or the answer saved (and TRAINER_SCORE_EVENT_TV_INTERVIEW_GIVEN). */
    call_tv_interview: (t, _c, a) => {
      const call = r.int(a[0]);
      const id = r.val(t, a[1]);
      if (call === INTERVIEW.message) put(t, tvInterviewMessage(ctx(), id), a[2], a[3]);
      else if (call === INTERVIEW.save) {
        tvSaveInterview(ctx(), id, r.val(t, a[2]));
        incrementTrainerScore(r.state, r.registries, 'TV_INTERVIEW_GIVEN');
      } else throw new Error(`call_tv_interview: call ${call}`);
      return 'continue';
    },
    /** ScrCmd_CheckTVInterviewEligible. */
    check_tv_interview_eligible: (t, _c, a) => (dest(t, a[1], tvInterviewEligible(ctx(), r.val(t, a[0])) ? 1 : 0), 'continue'),
    /** FieldSystem_SaveTVSegment_HiddenItemBreakingNews: the item and the map's label. */
    save_tv_segment_hidden_item: (t, _c, a) => {
      saveTvSegment(r.state, { kind: 'hidden-item', item: itemBySource(r.val(t, a[0])), location: zoneLabel(r.registries, r.state.player.zone) });
      return 'continue';
    },
    /** ScrCmd_2B8 (FieldSystem_SaveTVSegment_RateThatNameChange): the Name Rater's new name. */
    scr_cmd_2b8: (t, _c, a) => {
      const mon = partyMon('scr_cmd_2b8', r.val(t, a[0]));
      saveTvSegment(r.state, { kind: 'name-change', species: mon.species, nickname: nickname(mon) });
      return 'continue';
    },
    /**
     * FieldSystem_SaveTVSegment_PokemonStorageSpecialNewsBulletin: a party of one gender (no genderless member, Eggs left
     * out) makes the bulletin about its first Pokémon that is not an Egg.
     */
    save_tv_segment_pokemon_storage_bulletin: () => {
      const genders = new Set(r.state.party.filter((m) => !m.isEgg).map((m) => GENDERS[monGender(dexOf(r.registries), m)]));
      if (genders.has(GENDERS.none) || genders.size !== 1) return 'continue';
      const first = r.state.party.find((m) => !m.isEgg)!;
      saveTvSegment(r.state, { kind: 'storage', species: first.species, male: genders.has(GENDERS.male) });
      return 'continue';
    },
    save_tv_segment_home_and_manor_no_furniture: () => (saveTvSegment(r.state, { kind: 'villa-empty' }), 'continue'),
    save_tv_segment_home_and_manor: (t, _c, a) => (saveTvSegment(r.state, { kind: 'villa', furniture: r.val(t, a[0]) }), 'continue'),
    /**
     * ScrCmd_27C (Amity Square): 0 the walk's Pokémon (sub_0206CF48: its species and nature, nothing found yet), 1 an
     * item found (sub_0206CFB4), 2 an accessory found (sub_0206CF9C).
     */
    scr_cmd_27c: (t, _c, a) => {
      const sub = r.int(a[0]);
      const p = r.state.tv.pending;
      if (sub === 0) {
        const mon = partyMon('scr_cmd_27c', r.val(t, a[1]));
        p.amity = { species: mon.species, nature: mon.pid % 25, found: null };
      } else if (sub === 1 || sub === 2) {
        if (!p.amity) throw new Error('scr_cmd_27c: a find with no Amity Square walk recorded');
        const found: TvAmityFind = sub === 1 ? { item: itemBySource(r.val(t, a[1])) } : { accessory: r.val(t, a[1]) };
        p.amity.found = found;
      } else throw new Error(`scr_cmd_27c: case ${sub}`);
      return 'continue';
    },
    /** ScrCmd_GetBattleFrontierReporterPosition: by the multi partner's facility (link-only), so always the default spot. */
    get_battle_frontier_reporter_position: (t, _c, a) => {
      dest(t, a[0], REPORTER_AT.x);
      dest(t, a[1], REPORTER_AT.z);
      dest(t, a[2], REPORTER_AT.dir);
      dest(t, a[3], REPORTER_AT.movement);
      return 'continue';
    },
  };
}
