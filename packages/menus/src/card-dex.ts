/**
 * The trainer card (decomp applications/trainer_case: front and back, the badge case) and its signing mode
 * (decomp applications/signature.c: the Pokémon Center 2F attendant's `start_signature_app`, drawn on the
 * card's back here; from the card itself, `sign` on the back opens it too). The Pokédex is pokedex.ts.
 */
import type { Button } from '@opensinnoh/core';
import { encodeSignature, type TrainerCardView } from '@opensinnoh/contracts';
import { cardStars, dexCounts, dexList, incrementTrainerScore, SignaturePad, type PenPoint } from '@opensinnoh/services';
import { menuSe, playTime, type MenuContext } from './context.ts';
import { Dialog } from './dialog.ts';
import type { Screen, Step } from './stack.ts';

type Input = { button: Button } | { tap: string };

/** The badge order (decomp BADGE_ID_*): the card's case shows badge i in slot i. */
const BADGES = ['COAL', 'FOREST', 'COBBLE', 'FEN', 'RELIC', 'MINE', 'ICICLE', 'BEACON'];

/** `pen:<x>,<y>[;<x>,<y>…]` → the samples (signature-window pixels); throws on anything else. */
function penPoints(tap: string): PenPoint[] {
  return tap
    .slice(4)
    .split(';')
    .map((p) => {
      const m = /^(-?\d+),(-?\d+)$/.exec(p);
      if (!m) throw new Error(`trainer card: bad pen sample "${p}" in ${tap}`);
      return { x: Number(m[1]), y: Number(m[2]) };
    });
}

/**
 * `mode` 'card': the start menu's card (A flips, B leaves; `sign` on the back starts signing, B cancels it).
 * 'signature': the signature app (decomp SignatureApp): signing on the back at once, no cancel; DONE and
 * YES close the app.
 */
export function trainerCardScreen(ctx: MenuContext, mode: 'card' | 'signature' = 'card'): Screen {
  const t = ctx.text;
  if (mode === 'card') menuSe(ctx, 1685);
  let side: 'front' | 'back' = mode === 'signature' ? 'back' : 'front';
  let pad: SignaturePad | null = mode === 'signature' ? new SignaturePad() : null;
  const dialog = new Dialog(t.t('yes'), t.t('no'), (n) => menuSe(ctx, n));
  const dateText = (date: string | null): string => {
    if (!date) return t.t('cardBlankDate');
    const [y, m, d] = date.split('-').map(Number);
    return t.t('cardDate', '', '', String(y! % 100).padStart(2, '0'), t.month(m! - 1), String(d));
  };
  // Decomp SignatureApp_ConfirmDone YES: the score counts every signing (TRAINER_SCORE_EVENT_SIGNED_TRAINER_CARD), and the app saves the window.
  const save = (p: SignaturePad): Step => {
    ctx.state.signature = encodeSignature(p.pixels);
    incrementTrainerScore(ctx.state, ctx.registries, 'SIGNED_TRAINER_CARD');
    pad = null;
    return mode === 'signature' ? { close: { app: 'signature' } } : undefined;
  };
  // DONE: "Is this OK?" YES saves; NO asks "Redo your autograph?" (YES clears the window, NO goes on drawing).
  const done = (p: SignaturePad): Step =>
    dialog.confirm([t.t('signOk')], (yes) =>
      yes
        ? save(p)
        : dialog.confirm([t.t('signRedo')], (redo) => {
            if (redo) p.clear();
            return;
          }),
    );
  const flip = () => { menuSe(ctx, 1686); side = side === 'front' ? 'back' : 'front'; };
  const close = (): Step => { menuSe(ctx, 1689); return 'pop'; };
  const signInput = (p: SignaturePad, i: Input): Step => {
    if ('tap' in i && i.tap === 'pen-up') {
      p.up();
      return;
    }
    if (dialog.active) return dialog.input(i);
    if ('tap' in i) {
      if (i.tap.startsWith('pen:')) p.pen(penPoints(i.tap));
      else if (i.tap === 'clear') p.clear();
      else if (i.tap === 'done') return done(p);
      else if (i.tap === 'back' && mode === 'card') pad = null;
      return;
    }
    if (i.button === 'b' && mode === 'card') pad = null;
    return;
  };
  return {
    view(): TrainerCardView {
      const s = ctx.state;
      const counts = dexCounts(s, dexList(ctx.registries, s.pokedex.national));
      const number = (n: number) => t.slot('cardNumber', 5, String(n));
      return {
        app: 'trainer-card',
        title: t.t('startTrainer', s.names.player),
        side,
        fields: [
          // Decomp TrainerInfo_ID_LowHalf: the card shows the low 16 bits, five digits.
          { label: t.t('cardIdNo'), value: String(s.trainerId & 0xffff).padStart(5, '0') },
          { label: t.t('cardName'), value: s.names.player },
          { label: t.t('cardMoney'), value: t.slot('cardMoneyFormat', 5, String(s.money)) },
          // Decomp TrainerCard_DrawFrontText: the Pokédex row stays blank until the Pokédex is obtained.
          s.pokedex.obtained ? { label: t.t('cardPokedex'), value: String(counts.seen) } : { label: '', value: '' },
          { label: t.t('cardScore'), value: number(s.records.score) },
          { label: t.t('cardTime'), value: playTime(ctx) },
        ],
        started: { label: t.t('cardStarted'), value: dateText(s.startDate) },
        back: [
          { label: t.t('cardHallOfFame'), value: dateText(s.records.hallOfFame) },
          { label: t.t('cardTimesLinked'), value: number(s.records.timesLinked) },
          { label: t.t('cardLinkBattles'), value: `${t.t('cardW')}${s.records.linkBattleWins} ${t.t('cardL')}${s.records.linkBattleLosses}` },
          { label: t.t('cardLinkTrades'), value: number(s.records.linkTrades) },
        ],
        gender: s.gender,
        badges: BADGES.map((b) => s.badges.some((id) => id.endsWith(`:BADGE_ID_${b}`))),
        stars: cardStars(s, ctx.registries),
        pokedex: s.pokedex.obtained,
        signature: pad ? encodeSignature(pad.pixels) : s.signature,
        signing: pad ? { prompt: t.t('signPrompt'), done: t.t('signDone'), message: dialog.message(), yesNo: dialog.yesNo(), cancel: mode === 'card' } : null,
        done: t.t('bagCancel'),
      };
    },
    input(i: Input): Step {
      if (pad) return signInput(pad, i);
      if ('tap' in i) {
        if (i.tap === 'flip') flip();
        else if (i.tap === 'sign' && side === 'back') pad = new SignaturePad();
        else if (i.tap === 'done' || i.tap === 'back') return close();
        return;
      }
      if (i.button === 'a') flip();
      else if (i.button === 'b') return close();
      return;
    },
  };
}
