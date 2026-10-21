/**
 * The trade scene (decomp cutscenes/trade_sequence, TRADE_TYPE_NORMAL), one timeline of 30 Hz ticks with no input:
 * the send phase (10 ticks, "… will be sent to …" 60, "Bye-bye, …!" with the cry 60, 20 more, the Pokémon flashes
 * white into its ball and the ball bounces as the screen fades), the tube (the ball rises), the wormhole, the
 * other ball comes down, opens on the received Pokémon (its cry), and the receive phase ("… sent over …" with the
 * trade fanfare at least 60, "Take good care of …!" 60, then the fade). The trade BGM plays throughout. The 3D tube
 * and ball models and the palette shimmer are drawn by the app from the timeline (`TradeView`), not timed here.
 */
import { isShiny, monGender, type Id, type Pokemon } from '@opensinnoh/core';
import { dexOf, type AppRequest, type TradeView } from '@opensinnoh/contracts';
import type { MenuContext } from './context.ts';
import { monName } from './party.ts';
import type { Screen, Step } from './stack.ts';

/** The trade bank (decomp TEXT_BANK_TRADE): will be sent, bye-bye, sent over, take good care. */
export const TRADE_MESSAGES = [0, 1, 2, 3].map((n) => `pl_msg_00000350_${String(n).padStart(5, '0')}`);

/** Each phase's length in ticks (decomp timers; the 3D phases' lengths are their animations', measured on the DS). */
export const TRADE_PHASES: { phase: TradeView['phase']; ticks: number }[] = [
  { phase: 'send', ticks: 216 },
  { phase: 'tube', ticks: 96 },
  { phase: 'wormhole', ticks: 90 },
  { phase: 'arrive', ticks: 70 },
  { phase: 'reveal', ticks: 60 },
  { phase: 'receive', ticks: 160 },
];
/** Send phase: the messages' windows (decomp TradeSendPhase_ShowPokemonInfo) and the white flash into the ball. */
const SEND = { firstMessage: 11, secondMessage: 72, erase: 133, flash: 154 };
/** Receive phase (TradeReceivePhase_ShowMessage): the messages; the fanfare holds the first one at least 60 ticks. */
const RECEIVE = { firstMessage: 11, secondMessage: 72, erase: 133 };

type Trade = Extract<AppRequest, { app: 'trade' }>;

export function tradeScreen(ctx: MenuContext, request: Trade, done: () => Step): Screen {
  const t = ctx.text;
  const dex = dexOf(ctx.registries);
  const sound = ctx.host.sound;
  const slots = [monName(ctx, request.sent), monName(ctx, request.received), request.otName];
  const msg = (n: number) => t.message(TRADE_MESSAGES[n]!, ...slots);
  const look = (m: Pokemon) => ({ species: m.species, form: m.form, shiny: isShiny(m.otId, m.pid), female: monGender(dex, m) === 'female', ball: m.ball });
  const seq = (name: string): Id | null => {
    const id = t.id(name);
    if (ctx.registries.sequences.has(id)) return id;
    ctx.log.stub('menus:trade-sound', `the pack has no ${name}: the trade plays without it`);
    return null;
  };
  let phase = 0;
  let tick = 0;
  let fanfareWait = false;

  const message = (): string | null => {
    const p = TRADE_PHASES[phase]!.phase;
    if (p === 'send') return tick >= SEND.erase || tick < SEND.firstMessage ? null : msg(tick < SEND.secondMessage ? 0 : 1);
    if (p === 'receive') return tick >= RECEIVE.erase || tick < RECEIVE.firstMessage ? null : msg(tick < RECEIVE.secondMessage ? 2 : 3);
    return null;
  };

  return {
    view(): TradeView {
      const m = message();
      return {
        app: 'trade',
        background: request.background,
        phase: TRADE_PHASES[phase]!.phase,
        tick,
        ticks: TRADE_PHASES[phase]!.ticks,
        sent: look(request.sent),
        received: look(request.received),
        message: m === null ? null : { text: m, waiting: false },
      };
    },
    tick(): Step {
      const p = TRADE_PHASES[phase]!.phase;
      if (phase === 0 && tick === 0) {
        const bgm = seq('SEQ_KOUKAN');
        if (bgm) sound?.playBgm(bgm);
      }
      if (p === 'send' && tick === SEND.secondMessage) sound?.playCry(request.sent.species, request.sent.form);
      if (p === 'send' && tick === SEND.flash) {
        const se = seq('SEQ_SE_DP_KOUKAN01');
        if (se) sound?.playSe(se);
      }
      if (p === 'reveal' && tick === 30) sound?.playCry(request.received.species, request.received.form);
      if (p === 'receive' && tick === RECEIVE.firstMessage) {
        const fanfare = seq('SEQ_FANFA5');
        if (fanfare && sound) {
          sound.playFanfare(fanfare);
          fanfareWait = true;
        }
      }
      // Decomp TradeReceivePhase_IsTimerAndFanfareDone: the first message stays until the fanfare ends too.
      if (p === 'receive' && tick === RECEIVE.secondMessage - 1 && fanfareWait) {
        if (sound!.waitFanfare()) return;
        fanfareWait = false;
      }
      tick++;
      if (tick < TRADE_PHASES[phase]!.ticks) return;
      tick = 0;
      phase++;
      if (phase < TRADE_PHASES.length) return;
      phase = TRADE_PHASES.length - 1;
      tick = TRADE_PHASES[phase]!.ticks - 1;
      return done();
    },
    input(): Step {
      return;
    },
  };
}
