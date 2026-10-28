/**
 * The end credits (decomp cutscenes/end_credits; docs/research/hall-of-fame-credits.md §4), one app frame per
 * tick on one screen (never the split DS layout): the screen the staff rows rise through first (the
 * decomp's first strings manager, from y −240, one pixel a frame), with the rows from `NewGame.credits` (the
 * ROM's rows and texts); the second screen's copy of the rows, 208 frames later, is left out. Under them the
 * scenes run on the decomp's timeline (code constants: the global frames 1830, 4815, 6000, 6960, 7980, 8280,
 * 10080 and the fade lengths): morning ride, seven memories, day ride, three memories, night ride, four
 * Twinleaf pictures (crossfades shown as cuts), the final screen (A, Start or frame 10080). Then the OpenSinnoh
 * card (engine text). On a repeat clear Start skips to the final screen.
 */
import { ENGLISH, forLanguage, GERMAN } from '@opensinnoh/core';
import { newGameRecord, type CreditsView, type SceneLine } from '@opensinnoh/contracts';
import { gameLanguage } from '@opensinnoh/services';
import type { InputFrame } from '@opensinnoh/contracts';
import type { MenuContext } from './context.ts';
import type { Screen, Step } from './stack.ts';

/** The OpenSinnoh card, per game language. */
export const OPENSINNOH_CARD: Readonly<Record<number, { title: string; lines: readonly string[] }>> = {
  [ENGLISH]: {
    title: 'OpenSinnoh',
    lines: ['OpenSinnoh — an unofficial fan engine. Not affiliated with Nintendo, Game Freak or The Pokémon Company.', 'Made by the OpenSinnoh contributors.'],
  },
  [GERMAN]: {
    title: 'OpenSinnoh',
    lines: ['OpenSinnoh — eine inoffizielle Fan-Engine. Nicht verbunden mit Nintendo, Game Freak oder The Pokémon Company.', 'Gemacht von den Mitwirkenden an OpenSinnoh.'],
  },
};
/** The card fades in and out over 15 ticks and waits for A or Start (at least 60 ticks, at most 300). */
const CARD_FADE = 15;
const CARD_MIN = 60;
const CARD_MAX = 300;

/** Decomp EndCreditsStrings_CreateManager: the first manager's screen starts at y −240 of the rows. */
const SCROLL_START = -240;
const SCREEN_H = 192;
const ROW_H = 16;
const LEFT_X = 32;
/** Decomp SEQ_BLD_ENDING. */
const MUSIC = 'SEQ_BLD_ENDING';

type Scene = 'morning' | 'memories-1' | 'day' | 'memories-2' | 'night' | 'twinleaf' | 'final';
const SCENES: Scene[] = ['morning', 'memories-1', 'day', 'memories-2', 'night', 'twinleaf', 'final'];
/** Memories per set (decomp END_CREDITS_MEMORY_8 ends the first set at index 7, MEMORY_COUNT 10) and the Twinleaf pictures. */
const MEMORIES_1 = 7;
const MEMORIES = 10;
const TWINLEAF = 4;

/** A brightness transition (decomp BrightnessController, one step a main loop): `from` to `to` in `steps`. */
class Fade {
  private k = 0;
  constructor(
    private readonly from: number,
    private readonly to: number,
    private readonly steps: number,
  ) {}
  step(): void {
    if (this.k < this.steps) this.k++;
  }
  get done(): boolean {
    return this.k >= this.steps;
  }
  get value(): number {
    return this.from + ((this.to - this.from) * this.k) / this.steps;
  }
}

export function creditsScreen(ctx: MenuContext, skippable: boolean): Screen {
  const rows = newGameRecord(ctx.registries).credits;
  const cardText = forLanguage(gameLanguage(ctx.registries), OPENSINNOH_CARD);
  if (!rows?.length) throw new Error('credits: the pack has no NewGame.credits');
  const sound = ctx.host.sound;
  const music = ctx.text.id(MUSIC);
  if (sound) {
    if (ctx.registries.sequences.has(music)) sound.playBgm(music);
    else ctx.log.stub('menus:credits-music', `the pack has no ${music}`);
  }
  const texts = rows.map((r) => ctx.text.text(r.text));
  let frame = 0;
  let scene = 0;
  /** Decomp END_CREDITS_STATE_INIT_SCENE (load) or RUN_SCENE, the scene's own state and counters. */
  let loaded = false;
  let state = 0;
  let sceneFrames = 0;
  let sceneStart = 0;
  let cooldown = 0;
  let memory: number | null = null;
  let art = new Fade(0, 0, 1);
  /** The whole screen's fade (decomp StartScreenFade): the skip, the final screen. */
  let screen: Fade = new Fade(1, 1, 1);
  let skip: 'none' | 'skipping' | 'skipped' = 'none';
  let scrolling = true;
  let card: { t: number; out: boolean; fade: Fade } | null = null;

  /** Decomp EndCreditsScenes_RunScene: true when the scene is over. */
  const runScene = (f: InputFrame): boolean => {
    const name = SCENES[scene]!;
    switch (name) {
      case 'morning':
      case 'day':
      case 'night': {
        const end = name === 'morning' ? 1830 : name === 'day' ? 6000 : 7980;
        if (state === 0) [art, state] = [new Fade(0, 1, 24), 1];
        else if (state === 1) {
          if (frame >= end) [art, state] = [new Fade(1, 0, 24), 2];
        } else if (art.done) return true;
        return false;
      }
      case 'memories-1':
      case 'memories-2': {
        const first = name === 'memories-1';
        const last = first ? MEMORIES_1 : MEMORIES;
        // Decomp: the dwell divides the scene's span (1830–4815 or 6000–6960) over its pictures.
        const dwell = first ? Math.trunc((4815 - 1830 - 30 * (7 - 1)) / 7) : Math.trunc((6960 - 6000 - 30 * (10 - 7 - 1)) / (10 - 7));
        let done = false;
        if (state === 0) [art, state] = [new Fade(0, 1, 24), 1];
        else if (state === 1) {
          if (sceneFrames > dwell) [art, sceneFrames, state] = [new Fade(1, 0, 32), 0, 2];
        } else if (state === 2) {
          if (art.done) state = memory! + 1 < last ? 3 : 4;
        } else if (state === 3) {
          if (++cooldown > 30) [cooldown, memory, art, state] = [0, memory! + 1, new Fade(0, 1, 32), 1];
          // Decomp source anomaly kept: both sets end at global frame 4815, not 6960 for the second.
        } else if (frame >= 4815) done = true;
        sceneFrames++;
        return done;
      }
      case 'twinleaf': {
        const dwell = Math.trunc((8280 - 7980 - 4 * 16 * (4 - 1)) / 4);
        if (state === 0) [art, state] = [new Fade(0, 1, 24), 1];
        else if (state === 1) {
          if (++sceneFrames > dwell) [sceneFrames, state] = [0, 2];
        } else if (state === 2) {
          if (memory! >= TWINLEAF - 1) [art, state] = [new Fade(1, 0, 32), 4];
          else [memory, cooldown, state] = [memory! + 1, 0, 3];
        } else if (state === 3) {
          // The 16-step crossfade of the next picture (shown as a cut).
          if (++cooldown >= 17) state = 1;
        } else if (art.done) return true;
        return false;
      }
      case 'final':
        if (state === 0) [screen, state] = [new Fade(0, 1, 30), 1];
        else if (state === 1) {
          if (screen.done && (frame > 10080 || f.pressed.includes('a') || f.pressed.includes('start') || f.tap === 'next')) [screen, state] = [new Fade(1, 0, 45), 2];
        } else if (screen.done) return true;
        return false;
    }
  };
  /** Decomp EndCreditsScenes_RunSceneLoadFuncs: the scene's first picture. */
  const load = () => {
    sceneStart = frame;
    state = 0;
    sceneFrames = 0;
    cooldown = 0;
    const name = SCENES[scene]!;
    memory = name === 'memories-1' ? 0 : name === 'memories-2' ? MEMORIES_1 : name === 'twinleaf' ? 0 : null;
    if (name === 'final') art = new Fade(1, 1, 1);
  };

  const tick = (f: InputFrame): Step => {
    if (card) {
      card.t++;
      card.fade.step();
      if (!card.out && card.t >= CARD_FADE + CARD_MIN && (card.t >= CARD_FADE + CARD_MAX || f.pressed.includes('a') || f.pressed.includes('start') || f.tap === 'next')) [card.out, card.fade] = [true, new Fade(1, 0, CARD_FADE)];
      else if (card.out && card.fade.done) return { close: { app: 'credits' } };
      return;
    }
    // Decomp EndCreditsApp_Main: on a repeat clear Start before the final screen fades out and skips to it.
    if (skippable && skip === 'none' && SCENES[scene] !== 'final' && (f.pressed.includes('start') || f.tap === 'skip')) [skip, screen] = ['skipping', new Fade(1, 0, 6)];
    if (skip === 'skipping' && screen.done) [skip, scrolling, scene, loaded] = ['skipped', false, SCENES.indexOf('final'), false];
    if (!loaded) {
      if (skip !== 'skipping') {
        load();
        loaded = true;
      }
    } else if (runScene(f)) {
      loaded = false;
      if (++scene >= SCENES.length) card = { t: 0, out: false, fade: new Fade(0, 1, CARD_FADE) };
    }
    art.step();
    screen.step();
    frame++;
    return;
  };

  const lines = (): SceneLine[] => {
    if (!scrolling) return [];
    const out: SceneLine[] = [];
    // A row's screen y: its y less the manager's top, which moves down a pixel a frame.
    for (let i = 0; i < rows.length - 1; i++) {
      const y = rows[i]!.y - (SCROLL_START + frame);
      if (y > -ROW_H && y < SCREEN_H) out.push(rows[i]!.centered ? { text: texts[i]!, x: 0, y, width: 256 } : { text: texts[i]!, x: LEFT_X, y });
    }
    return out;
  };

  return {
    tick,
    input: () => undefined,
    view(): CreditsView {
      const name = SCENES[scene] ?? 'final';
      return {
        app: 'credits',
        frame,
        sceneFrame: frame - sceneStart,
        scene: card ? 'card' : name === 'memories-1' || name === 'memories-2' ? 'memories' : name,
        memory,
        gender: ctx.state.gender,
        lines: card ? [] : lines(),
        brightness: art.value,
        screen: card ? card.fade.value : screen.value,
        final: !card && name === 'final' && loaded ? texts.at(-1)! : null,
        card: card ? { title: cardText.title, lines: [...cardText.lines] } : null,
      };
    },
  };
}
