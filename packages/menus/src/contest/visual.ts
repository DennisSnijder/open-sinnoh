/**
 * The visual round (docs/research/contests.md §5): the dress-up (decomp overlay022 VisualCompetition_Init/_Main/_Exit,
 * ov22_02255D44.c with the Fashion Case ov22_02257F50.c, the stage ov22_022578F4.c, the stylus ov22_022589E0.c, the
 * buttons ov22_02259C58.c and the clock ov22_0225A428.c), then the judging (overlay017 VisualCompetitionScoring_*,
 * ov17_0223CB1C.c, ov17_02247A48.c).
 *
 * - Intro: the BGM fades (30 frames), then the host's messages (bank 385: 26 or 28 in practice, the theme 29 + theme,
 *   41/42 with the rank's limit), each page on A; SE CON_016 and the stage fades in; SEQ_CO_DRESS.
 * - Dress-up: 1800 frames, one a tick; it ends when the clock shows 0 (frame 1771) or on DONE. The Fashion Case, the
 *   stage, the stylus and the keys' hand are dress-up.ts (shared with the TV gallery's dress-up).
 * - The photo keeps the accessories on the Pokémon and those touching them (services `photoAccessories`), in the
 *   photo's coordinates; its dress-up points are their theme points (`dressUpPoints`); the NPCs' photos are their
 *   outfits for the theme (`npcOutfit`).
 * - Judging: the stage, then per entrant (entry 1 … 4) its message, its photo (SE CON_019) and its hearts (condition,
 *   then dress-up: one every 4 frames at random places, SE CON_003 each), then the closing message (official). Every
 *   frame of the judging draws one number of the contest RNG (Contest_GetRNGNext in VisualCompetitionScoring_Main),
 *   and each heart four or five more (ov17_02247F8C).
 *
 * The case's scatter and the stage's random returns use the DS's MTRNG, which is not the contest's: here a local LCRNG
 * seeded from the session's RNG state at the round's start (read, not drawn).
 */
import {
  type ContestDressUp, type ContestDressView, type ContestPicture, type ContestRound, type ContestRoundContext, type ContestRoundOutcome,
  type ContestTables, type ContestVisualRoundView, type InputFrame,
} from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { accessoryLimit, conditionHearts, conditionPoints, contestTables, dressUpHearts, dressUpPoints, npcOutfit } from '@opensinnoh/services';
import { plainPages } from '../strings.ts';
import { dressUpStage, msg385, STAGE_TEXTS } from './dress-up.ts';
import { contestPicture } from './picture.ts';

/** TEXT_BANK_UNK_0385 (the dress-up). */
const DRESS = { themeLabel: msg385(6), theme: (t: number) => msg385(7 + t), intro: msg385(26), introPractice: msg385(28), themeIntro: (t: number) => msg385(29 + t), begin: msg385(42), beginPractice: msg385(41) };
/** TEXT_BANK_CONTEST_VISUAL_COMPETITION (Unk_ov17_0225442C). */
const JUDGING = {
  begin: 'VisualCompetition_Text_LetsBeginTheVisualCompetition',
  practice: 'VisualCompetition_Text_PracticeSession',
  entries: ['VisualCompetition_Text_EntryNumberOne', 'VisualCompetition_Text_EntryNumberTwo', 'VisualCompetition_Text_EntryNumberThree', 'VisualCompetition_Text_EntryNumberFour'],
  next: 'VisualCompetition_Text_DanceCompetitionIsNext',
} as const;
/** The text names the round reads (checked when it starts: packs without the visual round's texts fail there). */
export const VISUAL_TEXTS = [
  ...Object.values(DRESS).flatMap((v) => (typeof v === 'string' ? [v] : Array.from({ length: 12 }, (_, t) => v(t)))),
  JUDGING.begin, JUDGING.practice, ...JUDGING.entries, JUDGING.next,
  ...STAGE_TEXTS,
];

/** Sequences by symbol (the SDAT names): BGM and the SEs the decomp plays. */
const SEQ = {
  dress: 'SEQ_CO_DRESS', judging: 'SEQ_CON_TEST', confirm: 'SEQ_SE_CONFIRM', stageIn: 'SEQ_SE_DP_CON_016', stageOut: 'SEQ_SE_DP_CON_017', photo: 'SEQ_SE_DP_CON_019',
  heartsStart: 'SEQ_SE_DP_CON_007', heart: 'SEQ_SE_DP_CON_003', door: 'SEQ_SE_DP_DOOR_OPEN', hurry: 'SEQ_SE_DP_HYUN2', end: 'SEQ_SE_DP_MAZYO',
} as const;

/** The clock: 60 s of 30 frames (ov22_0225AB54); the last ten seconds pulse for 16 frames (ov22_0225ADC0). */
const CLOCK_FRAMES = 60 * 30;
const PULSE_FRAMES = 16;
/** Frames: the BGM fade before the messages (Sound_FadeOutBGM(42, 30)), the screen fades, the end SE's wait. */
const BGM_FADE = 30;
const FADE = 8;
const END_WAIT = 45;

interface Heart {
  x: number;
  y: number;
  angle: number;
  age: number;
  kind: 'condition' | 'dressUp';
}

export function visualRound(ctx: ContestRoundContext): ContestRound {
  const s = ctx.session;
  const tables: ContestTables = contestTables(ctx.registries);
  const ns = [...ctx.registries.newGame.values()][0]!.id.split(':')[0]!;
  const markup = (name: string) => {
    const t = ctx.registries.texts.get(`${ns}:${name}` as Id);
    if (!t) throw new Error(`contest visual: the pack has no text ${ns}:${name}`);
    return t.text;
  };
  const missing = VISUAL_TEXTS.filter((n) => !ctx.registries.texts.has(`${ns}:${n}` as Id));
  if (missing.length) throw new Error(`contest visual: the pack has no text ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` and ${missing.length - 5} more` : ''}`);
  const pages = (name: string, ...slots: string[]) => plainPages(markup(name), slots);
  const line = (name: string, ...slots: string[]) => pages(name, ...slots).join(' ');
  const sound = ctx.host.sound;
  const seq = (name: string) => {
    const id = `${ns}:${name}` as Id;
    if (ctx.registries.sequences.has(id)) return id;
    ctx.log.stub('audio:sequence-missing', `no sequence ${id} in the packs: not played`);
    return null;
  };
  const se = (name: string) => {
    if (!sound) return;
    const id = seq(name);
    if (id) sound.playSe(id);
  };
  const bgm = (name: string) => {
    if (!sound) return;
    const id = seq(name);
    if (id) sound.playBgm(id);
  };

  const practice = s.mode === 'practice';
  const themeLine = `${line(DRESS.themeLabel)}${line(DRESS.theme(s.theme))}`;
  const limit = accessoryLimit(s.rank);

  // The Fashion Case and the stage (dress-up.ts).
  const player = s.entrants[0]!.mon;
  const stage = dressUpStage({ registries: ctx.registries, tables, fashionCase: ctx.state.fashionCase, mon: player, limit, seed: s.rng, se, line, gallery: false, label: 'contest visual' });

  // Phases.
  type Phase = 'fade-bgm' | 'messages' | 'stage-in' | 'dress' | 'finishing' | 'ending' | 'stage-out' | 'judging' | 'over';
  let phase: Phase = 'fade-bgm';
  let timer = 0;
  /** The intro shows the top screen's clock; the touch screen fades in from black for the dress-up. */
  let fade = 0;
  let message: { pages: string[]; page: number; then: () => void } | null = null;
  let frames = CLOCK_FRAMES;
  let shown = 60;
  let hurry = false;
  let pulse = 0;
  let outcome: ContestRoundOutcome | null = null;

  // The judging's state.
  let photo: ContestDressUp | null = null;
  let points: number[] = [];
  let judging: { curtain: boolean; picture: ContestPicture | null; hearts: Heart[]; script: (() => boolean)[] } = { curtain: true, picture: null, hearts: [], script: [] };

  const say = (p: string[], then: () => void) => {
    message = { pages: p, page: 0, then };
  };

  if (sound) sound.fadeOutBgm(42, BGM_FADE);

  const introMessages = () => {
    say(pages(practice ? DRESS.introPractice : DRESS.intro), () =>
      say(pages(DRESS.themeIntro(s.theme)), () =>
        say(pages(practice ? DRESS.beginPractice : DRESS.begin, String(limit)), () => {
          se(SEQ.stageIn);
          phase = 'stage-in';
          timer = 0;
          fade = 16;
        }),
      ),
    );
  };

  // ov22_0225AC8C: the clock's frame.
  const clockTick = () => {
    if (frames > 0) frames--;
    const now = Math.floor(frames / 30);
    if (now !== shown) {
      shown = now;
      if (shown <= 10) {
        hurry = true;
        pulse = PULSE_FRAMES;
        se(SEQ.hurry);
      }
    }
    if (pulse > 0) pulse--;
  };
  // The judging (ov17_0223CB1C's state table).
  const startJudging = () => {
    phase = 'judging';
    fade = 16;
    timer = 0;
    bgm(SEQ.judging);
    se(SEQ.door);
    photo = stage.contestPhoto();
    const outfits = s.entrants.map((e, id) => (id === 0 ? photo! : npcOutfit(tables, e.opponent!, s.theme)));
    points = outfits.map((o) => dressUpPoints(tables, s.theme, o));
    const wait = (n: number) => {
      let k = 0;
      return () => ++k >= n;
    };
    const run = (f: () => void) => () => (f(), true);
    const talk = (p: string[]) => {
      let started = false;
      return () => {
        if (!started) {
          started = true;
          say(p, () => {});
        }
        return message === null;
      };
    };
    const script: (() => boolean)[] = [];
    script.push(() => {
      fade = Math.max(0, fade - 2);
      return fade === 0;
    });
    script.push(run(() => se(SEQ.heartsStart)));
    script.push(talk(pages(practice ? JUDGING.practice : JUDGING.begin)));
    for (const id of [3, 2, 1, 0]) {
      const e = s.entrants[id]!;
      const mon = e.mon.nickname ?? ctx.registries.species.get(e.mon.species)!.name;
      script.push(run(() => ((judging.curtain = true), (judging.picture = null))));
      script.push(talk(pages(JUDGING.entries[3 - id]!, e.trainerName, mon)));
      script.push(
        run(() => {
          judging.curtain = false;
          // ov22_0225B158: the Pokémon's centre to (128, 64 + height): the photo moves by (0, −77).
          judging.picture = contestPicture(ctx.registries, e.mon, outfits[id]!, 0, -77, false);
          se(SEQ.photo);
        }),
      );
      script.push(wait(10));
      script.push(hearts(conditionHearts(conditionPoints(ctx.registries, e.mon, s.type), s.rank), dressUpHearts(points[id]!, s.rank)));
    }
    script.push(run(() => se(SEQ.heartsStart)));
    if (!practice) script.push(talk(pages(JUDGING.next)));
    script.push(() => {
      fade = Math.min(16, fade + 2);
      return fade === 16;
    });
    script.push(
      run(() => {
        outcome = { kind: 'visual', dressUp: points, outfit: photo! };
        phase = 'over';
      }),
    );
    judging = { curtain: true, picture: null, hearts: [], script };
  };
  // ov17_02247F8C: the hearts, `a` condition then `b` dress-up.
  const hearts = (a: number, b: number) => {
    let state = 0;
    let wait = 15;
    let count = 0;
    let last = { x: 0, y: 0 };
    return () => {
      if (state === 0) {
        se(SEQ.heartsStart);
        state = 1;
      }
      if (state === 1) {
        if (count >= a + b) {
          se(SEQ.heartsStart);
          state = 2;
          wait = 0;
          return false;
        }
        if (wait > 0) {
          wait--;
          return false;
        }
        wait = 3;
        const dx = ctx.rng() % ((256 - 32 - 32) / 2);
        const dy = ctx.rng() % ((192 - 32 - 32) / 2);
        let x = ctx.rng() & 1 ? 128 + dx : 128 - dx;
        let y = ctx.rng() & 1 ? 96 + dy : 96 - dy;
        const sameX = (last.x < 128 && x < 128) || (last.x > 128 && x > 128);
        const sameY = (last.y < 96 && y < 96) || (last.y > 96 && y > 96);
        if (count > 0 && sameX && sameY) {
          if (ctx.rng() & 1) x = x < 128 ? 128 + dx : 128 - dx;
          else y = y < 96 ? 96 + dy : 96 - dy;
        }
        judging.hearts.push({ x, y, angle: 0, age: 0, kind: count >= a ? 'dressUp' : 'condition' });
        se(SEQ.heart);
        last = { x, y };
        count++;
        return false;
      }
      return ++wait > 30;
    };
  };
  // ov17_02247840: a heart rises 1 px a frame, swaying 8 px, for 60 frames or until off the top.
  const moveHearts = () => {
    for (const h of judging.hearts) {
      h.angle += 6;
      h.y -= 1;
      h.age++;
    }
    judging.hearts = judging.hearts.filter((h) => h.age < 60 && h.y > -32);
  };

  const advanceMessage = (f: InputFrame) => {
    const m = message!;
    if (!(f.pressed.includes('a') || f.pressed.includes('b') || f.tap === 'next' || f.tap === 'dress-up')) return;
    se(SEQ.confirm);
    if (m.page + 1 < m.pages.length) {
      m.page++;
      return;
    }
    message = null;
    m.then();
  };

  return {
    kind: 'visual',
    placeholder: false,
    step(f) {
      stage.tick();
      switch (phase) {
        case 'fade-bgm':
          if (++timer >= BGM_FADE) {
            phase = 'messages';
            introMessages();
          }
          break;
        case 'messages':
          if (message) advanceMessage(f);
          break;
        case 'stage-in':
          fade = Math.max(0, 16 - Math.round((16 * ++timer) / FADE));
          if (fade === 0) {
            phase = 'dress';
            bgm(SEQ.dress);
          }
          break;
        case 'dress':
          // VisualCompetition_Main state 13: DONE (seen last frame) ends input; a clock at 0 ends the round.
          if (stage.done) {
            phase = 'finishing';
            break;
          }
          if (shown === 0) {
            phase = 'ending';
            timer = 0;
            se(SEQ.end);
            break;
          }
          stage.input(f);
          stage.moveReturning();
          clockTick();
          break;
        case 'finishing':
          // State 14: the clock goes to 0 at once (ov22_022577A0).
          if (shown === 0) {
            phase = 'ending';
            timer = 0;
            se(SEQ.end);
            break;
          }
          stage.moveReturning();
          clockTick();
          frames = 0;
          break;
        case 'ending':
          // States 15 and 19: the last pulse, the end SE, then the fade out with SE CON_017.
          stage.moveReturning();
          clockTick();
          if (pulse === 0 && ++timer >= END_WAIT) {
            phase = 'stage-out';
            timer = 0;
            se(SEQ.stageOut);
          }
          break;
        case 'stage-out':
          fade = Math.min(16, Math.round((16 * ++timer) / FADE));
          if (fade === 16) startJudging();
          break;
        case 'judging': {
          ctx.rng();
          moveHearts();
          if (message) {
            advanceMessage(f);
            break;
          }
          const next = judging.script[0];
          if (next?.()) judging.script.shift();
          break;
        }
        case 'over':
          break;
      }
      return outcome;
    },
    view(): ContestVisualRoundView {
      const msg = message ? { text: (message as { pages: string[]; page: number }).pages[(message as { page: number }).page]!, waiting: true } : null;
      const intro = phase === 'fade-bgm' || phase === 'messages';
      const dressing = phase === 'stage-in' || phase === 'dress' || phase === 'finishing' || phase === 'ending' || phase === 'stage-out';
      return {
        round: 'visual',
        placeholder: false,
        phase: intro ? 'intro' : dressing ? 'dress' : 'scoring',
        fade,
        message: msg,
        intro: intro ? { seconds: 60, limit, theme: themeLine } : null,
        dress: dressing ? dressView() : null,
        scoring: phase === 'judging' || phase === 'over' ? { curtain: judging.curtain, picture: judging.picture, hearts: judging.hearts.map((h) => ({ x: Math.round(h.x + Math.sin((h.angle * Math.PI) / 180) * 8), y: h.y, kind: h.kind })) } : null,
      };
    },
  };

  function dressView(): ContestDressView {
    const pulseScale = pulse > 0 ? 1 + ((Math.max(0, 10 - shown) * 0.15) * pulse) / PULSE_FRAMES : 1;
    const v = stage.view(phase === 'dress');
    return {
      theme: themeLine,
      status: v.status,
      seconds: shown,
      hurry,
      pulse: Math.round(pulseScale * 100) / 100,
      placed: v.placed,
      limit: v.limit,
      tab: v.tab,
      page: v.page,
      pageBg: v.pageBg,
      pressed: v.pressed,
      backdrop: v.backdrop,
      mon: v.mon,
      items: v.items,
      monAt: v.monAt,
      cursor: v.cursor,
    };
  }
}
