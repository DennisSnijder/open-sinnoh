/**
 * The contest rounds behind the round seam (contracts `CreateContestRound`, docs/research/contests.md). Each round lane
 * replaces its placeholder case here with its own model; the contest app (contest.ts) only sees the interface.
 *
 * The placeholders are not the DS rounds: no gameplay, a message box, and points from condition only (the dress-up
 * points 0; the dance and acting points each contestant's condition score + 1). They log `contest:placeholder:<round>`
 * once and are counted, as every stand-in is.
 */
import type { ContestDressUp, ContestRound, ContestRoundContext, ContestRoundKind, ContestRoundOutcome, CreateContestRound } from '@opensinnoh/contracts';
import { conditionPoints } from '@opensinnoh/services';
import { plainText } from '../strings.ts';

/** ContestCommon_Text_VisualCompetition, …Dance…, …Acting… (the receptionist's names for the rounds). */
const ROUND_NAMES: Record<ContestRoundKind, string> = { visual: 'ContestCommon_Text_VisualCompetition', dance: 'ContestCommon_Text_DanceCompetition', acting: 'ContestCommon_Text_ActingCompetition' };
const PLACEHOLDER_TEXT = 'Lantern_Contest_Placeholder';
/** The engine and ROM text names the placeholder rounds read (checked when the menus' strings are made). */
export const CONTEST_ROUND_TEXTS = [...Object.values(ROUND_NAMES), PLACEHOLDER_TEXT];
const EMPTY_OUTFIT: ContestDressUp = { accessories: [], monPriority: 0, backdrop: 0 };

export const createContestRound: CreateContestRound = (kind, ctx) => {
  switch (kind) {
    case 'visual':
    case 'dance':
    case 'acting':
      return placeholderRound(kind, ctx);
  }
};

/** A placeholder round: the message until A (or a tap), then the outcome scored from condition. */
export function placeholderRound(kind: ContestRoundKind, ctx: ContestRoundContext): ContestRound {
  ctx.log.stub(`contest:placeholder:${kind}`, `contest round ${kind}: placeholder (no gameplay; scored from condition only)`);
  const ns = [...ctx.registries.newGame.values()][0]!.id.split(':')[0]!;
  const text = (name: string, ...slots: string[]) => {
    const t = ctx.registries.texts.get(`${ns}:${name}`);
    if (!t) throw new Error(`contest: the pack has no text ${ns}:${name}`);
    return plainText(t.text, slots);
  };
  const message = text(PLACEHOLDER_TEXT, text(ROUND_NAMES[kind]));
  const outcome = (): ContestRoundOutcome => {
    const s = ctx.session;
    const condition = s.entrants.map((e) => conditionPoints(ctx.registries, e.mon, s.type));
    if (kind === 'visual') return { kind, dressUp: condition.map(() => 0), outfit: EMPTY_OUTFIT };
    return { kind, points: condition.map((c) => c + 1) };
  };
  return {
    kind,
    placeholder: true,
    step(input) {
      return input.pressed.includes('a') || input.tap === 'next' ? outcome() : null;
    },
    view: () => ({ round: kind, placeholder: true, message: { text: message, waiting: true } }),
  };
}
