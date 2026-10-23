/**
 * A diploma (decomp applications/diploma.c Diploma_Main; docs/research/villa-journal.md §3), one DS frame per tick: a
 * 6-step fade in, 60 frames still, 48 frames of the DS's slide from the top screen to the bottom one (one composed
 * screen here: the document stays put, inferred), then A, B or a touch fades it out (6 steps) and it closes. The text in
 * the document's window: the player line at tiles (6, 4), the body at (8, 8), the credit at (17.25, 18).
 */
import { newGameRecord, type DiplomaView } from '@opensinnoh/contracts';
import { plainText } from './strings.ts';
import type { MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';

const FADE_STEPS = 6;
const BLACK = 16;
const HOLD = 60;
/** 192 px at 4 px a frame (Diploma_Main state 3). */
const SLIDE = 48;
const TILE = 8;

export function diplomaScreen(ctx: MenuContext, national: boolean): Screen {
  const d = newGameRecord(ctx.registries).diploma;
  if (!d) throw new Error('diploma: the pack has no diploma art (NewGame.diploma)');
  const text = (id: typeof d.texts.player, ...slots: string[]) => {
    const rec = ctx.registries.texts.get(id);
    if (!rec) throw new Error(`diploma: unknown text ${id}`);
    return plainText(rec.text, slots);
  };
  const lines: DiplomaView['lines'] = [
    { text: text(d.texts.player, ctx.state.names.player), x: 6 * TILE, y: 4 * TILE },
    { text: text(national ? d.texts.national : d.texts.sinnoh), x: 8 * TILE, y: 8 * TILE },
    { text: text(d.texts.credit), x: 17.25 * TILE, y: 18 * TILE },
  ];
  let phase: 'fade-in' | 'hold' | 'slide' | 'wait' | 'fade-out' = 'fade-in';
  let n = 0;
  const leave = (): Step => {
    if (phase !== 'wait') return;
    phase = 'fade-out';
    n = 0;
  };
  return {
    view: (): DiplomaView => ({
      app: 'diploma',
      sheet: national ? d.national : d.sinnoh,
      lines,
      black: phase === 'fade-in' ? Math.round((BLACK * (FADE_STEPS - n)) / FADE_STEPS) : phase === 'fade-out' ? Math.round((BLACK * n) / FADE_STEPS) : 0,
    }),
    tick(): Step {
      n++;
      if (phase === 'fade-in' && n >= FADE_STEPS) [phase, n] = ['hold', 0];
      else if (phase === 'hold' && n >= HOLD) [phase, n] = ['slide', 0];
      else if (phase === 'slide' && n >= SLIDE) [phase, n] = ['wait', 0];
      else if (phase === 'fade-out' && n >= FADE_STEPS) return { close: { app: 'diploma' } };
      return undefined;
    },
    input(i): Step {
      if ('tap' in i) return i.tap === 'next' || i.tap === 'back' ? leave() : undefined;
      return i.button === 'a' || i.button === 'b' ? leave() : undefined;
    },
  };
}
