/**
 * The Game Corner's slot machine app (decomp overlay101; docs/research/game-corner.md): services `SlotMachine` runs the
 * rules and their timing frame by frame; this screen feeds it the frame's buttons, plays its sounds and music, and
 * hands back the coins, the best bonus streak and the bonus rounds played when it closes.
 * - Keys are the DS's: X bets (and spins after the bet), ↓ spins, Y / B / A stop the left, middle and right reels,
 *   START quits, A or B close a message; A, B, X or Y held counts the payout twice as fast.
 * - Taps (our addition: the DS has no touch here) press the same buttons: `stop:<0–2>`, `bet`, `spin`, `quit`, `next`.
 */
import { newGameRecord, SLOT, type InputFrame, type SlotsRequest, type SlotsView } from '@opensinnoh/contracts';
import { asId, type Button, type Id } from '@opensinnoh/core';
import { SlotMachine, type SlotMusic } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';
import { plainText } from './strings.ts';

/** Sound effects by SDAT index (docs/research/game-corner.md §6). */
const SE = { bet: 1517, spin: 1518, stop: 1574, 'bonus-stop': 1525, coin: 1581, 'ball-rise': 1572, 'ball-open': 1744, 'clefairy-in': 1745, moon: 1520 } as const;
/** SEQ_SLOT_ATARI (standby) and SEQ_SLOT_OOATARI (bonus). */
const BGM = { standby: 1184, bonus: 1185 } as const;
const CLEFAIRY = asId('platinum:SPECIES_CLEFAIRY');
const TAPS: Record<string, Button> = { 'stop:0': 'y', 'stop:1': 'b', 'stop:2': 'a', bet: 'x', spin: 'down', quit: 'start', next: 'a' };

export function slotsScreen(ctx: MenuContext, request: SlotsRequest): Screen {
  const tables = newGameRecord(ctx.registries).slots;
  if (!tables) throw new Error('slots: the packs have no slot tables (NewGame.slots)');
  if (request.machine < 0 || request.machine >= SLOT.machines) throw new Error(`slots: no machine ${request.machine}`);
  const machine = new SlotMachine(tables, request.mode, ctx.state.coins, request.seed);
  const messages = tables.messages.map((id) => {
    const t = ctx.registries.texts.get(id);
    if (!t) throw new Error(`slots: no text ${id}`);
    return plainText(t.text);
  });
  const sequence = (source: number): Id => {
    const s = [...ctx.registries.sequences.values()].find((q) => q.sourceIndex === source);
    if (!s) throw new Error(`slots: no sequence with SDAT index ${source}`);
    return s.id;
  };
  const music = (op: 'stop' | 'play', bgm: SlotMusic) => {
    const sound = ctx.host.sound;
    if (!sound) return;
    if (bgm === 'field') sound.setBgmPaused('field', op === 'stop');
    else if (op === 'stop') sound.stopBgm();
    else sound.playBgm(sequence(BGM[bgm]));
  };

  return {
    view(): SlotsView {
      return machine.view(machine.message === null ? null : { text: messages[machine.message]!, waiting: true });
    },
    input: () => undefined,
    tick(f: InputFrame): Step {
      const tapped = f.tap === undefined ? undefined : TAPS[f.tap];
      const pressed = tapped && !f.pressed.includes(tapped) ? [...f.pressed, tapped] : f.pressed;
      machine.step({ pressed, held: f.held });
      for (const e of machine.events) {
        if ('se' in e) menuSe(ctx, SE[e.se]);
        else if ('cry' in e) ctx.host.sound?.playCry(CLEFAIRY);
        else music(e.music, e.bgm);
      }
      if (!machine.done) return undefined;
      return { close: { app: 'slots', coins: Math.min(SLOT.maxCoins, machine.coins), streak: machine.streak, rounds: machine.rounds } };
    },
  };
}
