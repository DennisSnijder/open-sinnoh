/**
 * The contest app (decomp FieldTask_RunContest / FieldTask_RunPracticeCompetition, ov17 ContestFinalScoring): the
 * competition's rounds one after the other through the round seam (rounds.ts), then for a full contest the final
 * scoring and the results (ov17_02251D6C's announcements in TEXT_BANK_CONTEST_RESULTS, the table of points, the winner
 * with SEQ_CO_FANFA). A practice ends after its one round with the player's placement. Everything the app decides is
 * written to `GameState.contest` for the script (placements, the player's outfit).
 */
import { CONTEST_COMPETITION, CONTEST_ROUNDS, type ContestRawScores, type ContestRound, type ContestRoundKind, type ContestSession, type ContestView } from '@opensinnoh/contracts';
import { conditionPoints, contestRandom, finalResult, practicePlacement } from '@opensinnoh/services';
import { menuSe, type MenuContext } from '../context.ts';
import { Dialog } from '../dialog.ts';
import type { Screen, Step } from '../stack.ts';
import { createContestRound } from './rounds.ts';

/** BGM and fanfare by SDAT index: SEQ_CON_TEST (CONTEST_DRESSING_ROOM_sseq), SEQ_CO_KEKKA, SEQ_CO_FANFA. */
const BGM = { rounds: 1135, results: 1181, fanfare: 1182 } as const;
/** TEXT_BANK_CONTEST_TEXT names: COOL CONTEST …, NORMAL RANK …, PRACTICE, CONTEST. */
const TYPE_NAMES = ['Contest_Text_CoolContest', 'Contest_Text_BeautyContest', 'Contest_Text_CuteContest', 'Contest_Text_SmartContest', 'Contest_Text_ToughContest'];
const RANK_NAMES = ['Contest_Text_NormalRank', 'Contest_Text_GreatRank', 'Contest_Text_UltraRank', 'Contest_Text_MasterRank'];
const RESULTS = {
  judged: 'ContestResults_Text_JudgingCompleted',
  rounds: ['ContestResults_Text_VisualCompetitionResults', 'ContestResults_Text_DanceCompetitionResults', 'ContestResults_Text_ActingCompetitionResults'],
  winner: 'ContestResults_Text_TheWinnerIs',
} as const;
const HEADINGS = ['Lantern_Contest_Visual', 'Lantern_Contest_Dance', 'Lantern_Contest_Acting', 'Lantern_Contest_Total'];
/** The names the contest app reads (checked with the menus' strings). */
export const CONTEST_APP_TEXTS = [...TYPE_NAMES, ...RANK_NAMES, 'Contest_Text_Practice', 'Contest_Text_Contest', RESULTS.judged, ...RESULTS.rounds, RESULTS.winner, ...HEADINGS];

/** The rounds a competition runs (decomp FieldTask_RunContest: all three; a practice its one). */
export function competitionRounds(competition: number): ContestRoundKind[] {
  switch (competition) {
    case CONTEST_COMPETITION.full:
      return [...CONTEST_ROUNDS];
    case CONTEST_COMPETITION.practiceVisual:
      return ['visual'];
    case CONTEST_COMPETITION.practiceDance:
      return ['dance'];
    case CONTEST_COMPETITION.practiceActing:
      return ['acting'];
  }
  throw new Error(`contest: competition ${competition} is not offline play`);
}

export function contestScreen(ctx: MenuContext): Screen {
  const t = ctx.text;
  const s = (): ContestSession => {
    const c = ctx.state.contest;
    if (!c) throw new Error('contest app: no contest runs');
    return c;
  };
  const session = s();
  const sound = ctx.host.sound;
  const play = (n: number) => {
    const id = [...ctx.registries.sequences.values()].find((q) => q.sourceIndex === n)?.id;
    if (id) sound?.playBgm(id);
    else ctx.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
  };
  const dialog = new Dialog(t.t('yes'), t.t('no'), (n) => menuSe(ctx, n));
  const kinds = competitionRounds(session.competition);
  // Decomp ov17_0223F374: the condition points, from the entrants' Pokémon as they entered.
  const scores: ContestRawScores = { condition: session.entrants.map((e) => conditionPoints(ctx.registries, e.mon, session.type)), dressUp: null, dance: null, acting: null };
  session.scores = scores;
  let index = 0;
  let round: ContestRound | null = null;
  /** The results' revealed columns (0 none … 3 all rounds, 4 the total and places). */
  let revealed = 0;
  let results = false;
  let finished = false;
  if (sound) play(BGM.rounds);

  const startRound = () => {
    round = createContestRound(kinds[index]!, { session: s(), registries: ctx.registries, state: ctx.state, host: ctx.host, log: ctx.log, rng: () => contestRandom(s()) });
  };
  startRound();

  const close = (): Step => {
    const bgm = sound?.effectiveBgm(ctx.state.player.zone) ?? null;
    if (bgm) sound?.playBgm(bgm);
    return { close: { app: 'contest' } };
  };
  const showResults = (): Step => {
    const sess = s();
    sess.result = finalResult(scores, sess.rank, sess.competition, () => contestRandom(sess));
    sess.placement = sess.result.placements[0]!;
    results = true;
    play(BGM.results);
    const reveal = (n: number): Step => {
      revealed = n;
      if (n < 3) return dialog.say(t.messagePages(RESULTS.rounds[n]!), () => reveal(n + 1));
      revealed = 4;
      const w = sess.result!.placements.indexOf(0);
      const e = sess.entrants[w]!;
      play(BGM.fanfare);
      const mon = e.mon.nickname ?? ctx.registries.species.get(e.mon.species)!.name;
      return dialog.say(t.messagePages(RESULTS.winner, String(4 - w), e.trainerName, mon), () => ((finished = true), close()));
    };
    return dialog.say(t.messagePages(RESULTS.judged), () => reveal(0));
  };
  const finishRound = (out: NonNullable<ReturnType<ContestRound['step']>>): Step => {
    const sess = s();
    if (out.kind === 'visual') {
      scores.dressUp = out.dressUp;
      sess.dressUp = out.outfit;
    } else scores[out.kind] = out.points;
    round = null;
    index++;
    if (index < kinds.length) {
      startRound();
      return;
    }
    if (sess.mode === 'practice') {
      sess.placement = practicePlacement(scores, sess.rank, sess.competition);
      finished = true;
      return close();
    }
    return showResults();
  };

  return {
    tick(f): Step {
      if (!round || finished) return;
      const out = (round as ContestRound).step(f);
      return out ? finishRound(out) : undefined;
    },
    input(i): Step {
      if (round) return;
      if (dialog.active) return dialog.input(i);
      return;
    },
    view(): ContestView {
      const sess = s();
      const practice = sess.mode === 'practice';
      const heading = {
        rank: t.message(practice ? 'Contest_Text_Practice' : RANK_NAMES[sess.rank]!),
        type: t.message(sess.competition === CONTEST_COMPETITION.practiceDance ? 'Contest_Text_Contest' : TYPE_NAMES[sess.type]!),
      };
      const table = results
        ? (() => {
            const raw = sess.result!.points;
            return {
              headings: HEADINGS.map((h) => t.message(h)),
              rows: [3, 2, 1, 0].map((id) => {
                const e = sess.entrants[id]!;
                return {
                  entry: 4 - id,
                  trainer: e.trainerName,
                  mon: e.mon.nickname ?? ctx.registries.species.get(e.mon.species)!.name,
                  points: raw.map((p, r) => (r < revealed ? p[id]! : null)),
                  total: revealed >= 4 ? sess.result!.totals[id]! : null,
                  place: revealed >= 4 ? sess.result!.placements[id]! : null,
                  player: id === 0,
                };
              }),
            };
          })()
        : null;
      return { app: 'contest', heading, round: round ? (round as ContestRound).view() : null, results: table, message: dialog.message(), yesNo: null };
    },
  };
}
