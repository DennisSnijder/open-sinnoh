/**
 * The move relearner's and move tutor's screen (decomp applications/move_reminder.c): the moves list (7 rows, then
 * CANCEL), the selected move's category, power, accuracy, PP and description, and the message box. A on a move asks
 * to teach it; with four moves known the summary picks one to forget (SUMMARY_MODE_SELECT_MOVE with the new move),
 * then "forget this move?", "1, 2, and... Poof!" and the learned message. B or CANCEL asks to give up. The texts
 * follow the decomp's isMoveTutor row: the relearner reads the `Tutor_` messages, OpenMoveTutorMenu the `Reminder_`
 * ones. The contest moves page (left/right) waits for contests.
 */
import { maxPp, monGender, type Button, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type MoveReminderView } from '@opensinnoh/contracts';
import { menuSe, type MenuContext } from './context.ts';
import { Dialog } from './dialog.ts';
import { monName } from './party.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';
import { summaryScreen } from './summary.ts';

type Input = { button: Button } | { tap: string };

/** Decomp sListMenuTemplate maxDisplay. */
export const MOVE_REMINDER_ROWS = 7;
const KINDS = ['Reminder', 'Tutor'] as const;
const ASKS = ['AskTeachWhichToMon', 'AskShouldTeachMove', 'AskGiveUpTeachingMon', 'LearnedMoveNoFanfare', 'AskMoreThanFourMoves', '12AndPoof', 'LearnedMoveFanfare', 'AskStopTryingToTeachMove', 'MonDidNotLearnMove', 'AskForgetThisMove'] as const;
type Ask = (typeof ASKS)[number];
const LABELS = ['BattleMoves', 'Category', 'Power', 'Accuracy', 'Pp', 'PowerValue', 'AccuracyValue', 'Cancel', 'Dashes'] as const;
/** The move reminder bank's messages this screen reads. */
export const MOVE_REMINDER_MESSAGES = [...KINDS.flatMap((k) => ASKS.map((a) => `MoveReminder_Text_${k}_${a}`)), ...LABELS.map((l) => `MoveReminder_Text_${l}`)];

export function moveReminderScreen(ctx: MenuContext, o: { slot: number; moves: Id[]; tutor: boolean; done: (learned: boolean) => Step }): Screen {
  const t = ctx.text;
  const dex = dexOf(ctx.registries);
  const dialog = new Dialog(t.t('yes'), t.t('no'), (n) => menuSe(ctx, n));
  const mon = (): Pokemon => {
    const m = ctx.state.party[o.slot];
    if (!m) throw new Error(`move reminder: no Pokémon in party slot ${o.slot}`);
    return m;
  };
  if (!o.moves.length) throw new Error('move reminder: no moves to teach');
  let cursor = 0;
  let top = 0;
  let forget: number | null = null;
  const kind = o.tutor ? 'Reminder' : 'Tutor';
  const move = () => o.moves[cursor]!;
  const name = (id: Id) => ctx.registries.moves.get(id)!.name;
  const say = (ask: Ask) => t.messagePages(`MoveReminder_Text_${kind}_${ask}`, monName(ctx, mon()), name(forget !== null && ask === '12AndPoof' ? mon().moves[forget]! : move()), ctx.state.names.player);
  const askForget = () => t.messagePages(`MoveReminder_Text_${kind}_AskForgetThisMove`, name(mon().moves[forget!]!));
  const done = (learned: boolean): Step => o.done(learned);

  /** Decomp MoveReminder_State_ReplaceOldMove: the move in the slot with full PP and no PP Ups. */
  const learn = (slot: number) => {
    const m = mon();
    m.moves[slot] = move();
    m.ppUps[slot] = 0;
    m.pp[slot] = dex.move(move()).pp;
  };
  const giveUp = (): Step => dialog.confirm(say('AskStopTryingToTeachMove'), (yes) => (yes ? dialog.say(say('MonDidNotLearnMove'), () => done(false)) : moreThanFour()));
  const moreThanFour = (): Step => dialog.confirm(say('AskMoreThanFourMoves'), (yes) => (yes ? pickForget() : giveUp()));
  const pickForget = (): Step => ({
    push: summaryScreen(ctx, {
      party: () => ctx.state.party,
      slot: o.slot,
      mode: {
        kind: 'teach',
        move: move(),
        done: (slot) => {
          forget = slot;
          return 'pop';
        },
      },
    }),
  });
  const choose = (): Step => {
    menuSe(ctx, 1500);
    if (cursor === o.moves.length) return dialog.confirm(say('AskGiveUpTeachingMon'), (yes) => (yes ? done(false) : undefined));
    if (mon().moves.length < 4)
      return dialog.confirm(say('AskShouldTeachMove'), (yes) => {
        if (!yes) return;
        const slot = mon().moves.length;
        return dialog.say(say('LearnedMoveNoFanfare'), () => (learn(slot), done(true)));
      });
    return moreThanFour();
  };
  const scroll = () => {
    if (cursor < top) top = cursor;
    else if (cursor >= top + MOVE_REMINDER_ROWS) top = cursor - MOVE_REMINDER_ROWS + 1;
  };
  const moveTo = (next: number) => {
    if (next === cursor) return;
    menuSe(ctx, 1500);
    cursor = next;
    scroll();
  };

  return {
    view(): MoveReminderView {
      const m = mon();
      const selected = cursor < o.moves.length ? ctx.registries.moves.get(move())! : null;
      const dash = t.message('MoveReminder_Text_Dashes');
      return {
        app: 'move-reminder',
        mon: { species: m.species, form: m.form, name: monName(ctx, m), gender: monGender(dex, m), level: String(m.level) },
        labels: { title: t.message('MoveReminder_Text_BattleMoves'), category: t.message('MoveReminder_Text_Category'), pp: t.message('MoveReminder_Text_Pp') },
        rows: o.moves.map((id) => {
          const mv = ctx.registries.moves.get(id)!;
          return { move: id, name: mv.name, type: mv.type, pp: t.message('MoveReminder_Text_PpValue', String(maxPp(mv.pp, 0))) };
        }),
        cancel: t.message('MoveReminder_Text_Cancel'),
        cursor,
        top,
        visible: MOVE_REMINDER_ROWS,
        detail: selected
          ? {
              category: selected.category,
              power: { label: t.message('MoveReminder_Text_Power'), value: selected.power > 1 ? t.message('MoveReminder_Text_PowerValue', String(selected.power)) : dash },
              accuracy: { label: t.message('MoveReminder_Text_Accuracy'), value: selected.accuracy > 0 ? t.message('MoveReminder_Text_AccuracyValue', String(selected.accuracy)) : dash },
              description: t.text(selected.description),
            }
          : null,
        message: dialog.message() ?? { text: say('AskTeachWhichToMon').join('\n'), waiting: false },
        yesNo: dialog.yesNo(),
      };
    },
    resume(): Step {
      // Decomp MoveReminder_State_ConfirmSelection after the summary: a move to forget asks again, none asks to give up.
      if (forget === null) return giveUp();
      return dialog.confirm(askForget(), (yes) => {
        if (!yes) return pickForget();
        const slot = forget!;
        return dialog.say([...say('12AndPoof'), ...say('LearnedMoveFanfare')], () => (learn(slot), done(true)));
      });
    },
    input(i: Input): Step {
      if (dialog.active) return dialog.input(i);
      const rows = o.moves.length + 1;
      if ('tap' in i) {
        if (i.tap === 'cancel' || i.tap === 'back') return (cursor = o.moves.length), choose();
        if (i.tap === 'up') return void moveTo(Math.max(0, cursor - 1));
        if (i.tap === 'down') return void moveTo(Math.min(rows - 1, cursor + 1));
        const n = tapIndex(i.tap, 'row');
        if (n === null || n < 0 || n >= o.moves.length) return;
        cursor = n;
        return choose();
      }
      // Decomp ListMenu (PAGER_MODE_NONE): the cursor stops at the ends.
      if (i.button === 'up') moveTo(Math.max(0, cursor - 1));
      else if (i.button === 'down') moveTo(Math.min(rows - 1, cursor + 1));
      else if (i.button === 'a') return choose();
      else if (i.button === 'b') return (cursor = o.moves.length), choose();
      return;
    },
  };
}
