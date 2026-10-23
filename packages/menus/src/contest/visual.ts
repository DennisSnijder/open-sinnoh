/**
 * The visual round (docs/research/contests.md §5): the dress-up (decomp overlay022 VisualCompetition_Init/_Main/_Exit,
 * ov22_02255D44.c with the Fashion Case ov22_02257F50.c, the stage ov22_022578F4.c, the stylus ov22_022589E0.c, the
 * buttons ov22_02259C58.c and the clock ov22_0225A428.c), then the judging (overlay017 VisualCompetitionScoring_*,
 * ov17_0223CB1C.c, ov17_02247A48.c).
 *
 * - Intro: the BGM fades (30 frames), then the host's messages (bank 385: 26 or 28 in practice, the theme 29 + theme,
 *   41/42 with the rank's limit), each page on A; SE CON_016 and the stage fades in; SEQ_CO_DRESS.
 * - Dress-up: 1800 frames, one a tick; it ends when the clock shows 0 (frame 1771) or on DONE. The stylus picks an
 *   accessory from the case page or the stage, drags it and drops it: on the stage it stays (if fewer than the limit
 *   are there; else "There is no more space." and it goes back), in the case it stays where dropped, anywhere else it
 *   goes back (from the stage: to a random place in the case). An accessory goes down "on the Pokémon" when one of its
 *   16 points hits the Pokémon's pixels. A backdrop from the BACKDROPS page is chosen by picking it up.
 * - Keys (an OpenSinnoh addition, the DS has none here): the PC's hand is the stylus. The +Control Pad moves it, A
 *   picks up or drops, B puts back what is held, Y jumps to the next item of the page (or, holding one, to the
 *   Pokémon's head), L/R turn the page, SELECT switches ACCESSORIES/BACKDROPS, X or START is DONE.
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
import {
  accessoryHit, accessoryLimit, accessoryOpaque, accessoryPage, ACCESSORY_PAGES, backdropSlot, BACKDROPS_PER_PAGE, conditionHearts, conditionPoints,
  contestTables, dressUpHearts, dressUpPoints, inRect, innerRect, monHit, npcOutfit, onMon, opaqueRows, photoAccessories, type Rect, type StagedAccessory,
} from '@opensinnoh/services';
import { plainPages } from '../strings.ts';
import { contestPicture, PHOTO_SHIFT, photoFace, STAGE_MON_X, stageMonY } from './picture.ts';

/** TEXT_BANK_UNK_0385 (the dress-up), TEXT_BANK_CONTEST_ACCESSORY_NAMES (386), _BACKDROP_NAMES (388). */
const msg385 = (n: number) => `pl_msg_00000385_${String(n).padStart(5, '0')}`;
const accessoryName = (n: number) => `pl_msg_00000386_${String(n).padStart(5, '0')}`;
const backdropName = (n: number) => `pl_msg_00000388_${String(n).padStart(5, '0')}`;
const DRESS = { noSpace: msg385(3), themeLabel: msg385(6), theme: (t: number) => msg385(7 + t), intro: msg385(26), introPractice: msg385(28), themeIntro: (t: number) => msg385(29 + t), begin: msg385(42), beginPractice: msg385(41) };
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
  ...Array.from({ length: 100 }, (_, a) => accessoryName(a)),
  ...Array.from({ length: 18 }, (_, b) => backdropName(b)),
];

/** Sequences by symbol (the SDAT names): BGM and the SEs the decomp plays. */
const SEQ = {
  dress: 'SEQ_CO_DRESS', judging: 'SEQ_CON_TEST', confirm: 'SEQ_SE_CONFIRM', stageIn: 'SEQ_SE_DP_CON_016', stageOut: 'SEQ_SE_DP_CON_017', photo: 'SEQ_SE_DP_CON_019',
  heartsStart: 'SEQ_SE_DP_CON_007', heart: 'SEQ_SE_DP_CON_003', door: 'SEQ_SE_DP_DOOR_OPEN', hurry: 'SEQ_SE_DP_HYUN2', end: 'SEQ_SE_DP_MAZYO',
  pickAccessory: 'SEQ_SE_DP_BOX02', pickBackdrop: 'SEQ_SE_DP_SYARAAN', place: 'SEQ_SE_DP_BOX01', drop: 'SEQ_SE_DP_BOX02', page: 'SEQ_SE_DP_MAZYO3', tab: 'SEQ_SE_DP_PASO', done: 'SEQ_SE_DP_PIRORIRO',
} as const;

/** The case's and the stage's touch areas (ov22_022582E8, ov22_02257BE8): the frames less 2 px. Accessories draw only inside (8 + 2, 16 + 2) … (246, 143) (ov22_02255390's window). */
const CASE_AREA: Rect = { left: 10, top: 18, right: 118, bottom: 143 };
const STAGE_AREA: Rect = { left: 138, top: 18, right: 246, bottom: 143 };
/** The buttons' touch rects (ov22_02259DBC): NEXT and BACK pages, the ACCESSORIES and BACKDROPS tabs, DONE. */
const BUTTONS: { id: 'case-next' | 'case-prev' | 'tab-accessories' | 'tab-backdrops' | 'done'; rect: Rect }[] = [
  { id: 'case-next', rect: { left: 48, top: 152, right: 88, bottom: 176 } },
  { id: 'case-prev', rect: { left: 8, top: 152, right: 48, bottom: 176 } },
  { id: 'tab-accessories', rect: { left: 96, top: 156, right: 136, bottom: 190 } },
  { id: 'tab-backdrops', rect: { left: 136, top: 156, right: 176, bottom: 190 } },
  { id: 'done', rect: { left: 184, top: 156, right: 256, bottom: 190 } },
];
/** The clock: 60 s of 30 frames (ov22_0225AB54); the last ten seconds pulse for 16 frames (ov22_0225ADC0). */
const CLOCK_FRAMES = 60 * 30;
const PULSE_FRAMES = 16;
/** Frames: the BGM fade before the messages (Sound_FadeOutBGM(42, 30)), the screen fades, the end SE's wait, a back-to-case move (ov22_02258F4C). */
const BGM_FADE = 30;
const FADE = 8;
const END_WAIT = 45;
const RETURN_FRAMES = 4;
/** The status line's hold (an OpenSinnoh line folding the top screen's message window). */
const STATUS_FRAMES = 90;
/** The hand's speed in px per frame: after 10 frames held it doubles. */
const HAND = { slow: 2, fast: 4, after: 10 } as const;

type ListKind = 0 | 1;
interface Item {
  kind: 'accessory' | 'backdrop';
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Held {
  item: Item;
  from: 'case' | 'stage';
  ox: number;
  oy: number;
  origin: { x: number; y: number };
  page: number;
}
interface Returning {
  item: Item;
  dx: number;
  dy: number;
  left: number;
  to: { x: number; y: number };
  page: number;
}
interface Heart {
  x: number;
  y: number;
  angle: number;
  age: number;
  kind: 'condition' | 'dressUp';
}

/** A local LCRNG (the stand-in for the DS's MTRNG in the dress-up), seeded from the contest RNG's state without drawing. */
function localRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 0x41c64e6d) + 0x6073) >>> 0;
    return s >>> 16;
  };
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
  const fc = ctx.state.fashionCase;
  const scatter = localRng(s.rng);

  // The player's Pokémon on the stage (ov22_02256790): centre x 192, y by its picture's height.
  const player = s.entrants[0]!.mon;
  const playerFace = photoFace(ctx.registries, player);
  if (!playerFace.face.opaque) throw new Error(`contest visual: the pack's front picture of ${player.species} has no opaque mask (PokemonFace.opaque)`);
  const monRows = opaqueRows(playerFace.face.opaque);
  const monX = STAGE_MON_X;
  const monY = stageMonY(playerFace.face.yOffset);
  // The head: the middle of the topmost opaque rows (an aim for the keys' jump).
  const headRow = monRows.findIndex((r) => r.length > 0) + 8;
  const head = (() => {
    const runs = monRows[Math.min(79, headRow)] ?? [];
    const x = runs.length ? Math.floor((runs[0]![0] + runs[runs.length - 1]![1]) / 2) : 40;
    return { x: monX - 40 + x, y: monY - 40 + Math.min(79, headRow) };
  })();

  // The Fashion Case (ov22_022567FC): each accessory held, as often as held, scattered on its page; each backdrop at
  // its place in the order received.
  const casePages: [Item[][], Item[][]] = [Array.from({ length: ACCESSORY_PAGES }, () => []), Array.from({ length: Math.ceil(18 / BACKDROPS_PER_PAGE) }, () => [])];
  const scatterIn = (w: number, h: number) => ({ x: CASE_AREA.left + (scatter() % (CASE_AREA.right - CASE_AREA.left - w)), y: CASE_AREA.top + (scatter() % (CASE_AREA.bottom - CASE_AREA.top - h)) });
  for (let a = 0; a < fc.accessories.length; a++) {
    const pic = tables.accessories[a]!;
    for (let k = 0; k < fc.accessories[a]!; k++) casePages[0][accessoryPage(a)]!.push({ kind: 'accessory', id: a, ...scatterIn(pic.width, pic.height), w: pic.width, h: pic.height });
  }
  fc.backdrops.forEach((b, i) => {
    const slot = backdropSlot(i);
    casePages[1][slot.page]!.push({ kind: 'backdrop', id: b, x: slot.x, y: slot.y, w: 32, h: 32 });
  });

  // The stage (ov22_022578F4): the accessories on the Pokémon, front first, then the others.
  const onMonItems: Item[] = [];
  const freeItems: Item[] = [];
  let backdrop = 0;
  let list: ListKind = 0;
  const listPage: [number, number] = [0, 0];
  let pageBg: 0 | 1 = 0;
  let held: Held | null = null;
  const returning: Returning[] = [];
  let status: { text: string; frames: number | null } | null = null;
  let pressed: { id: ContestDressView['pressed']; frames: number } | null = null;
  let doneRequested = false;

  // The stylus (`dress:x,y` taps until `dress-up`) and the keys' hand.
  let stylus: { x: number; y: number } | null = null;
  let stylusWas = false;
  let hand: { x: number; y: number } | null = null;
  let handHeld = 0;
  let cycle = -1;

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
  const setStatus = (text: string, hold: boolean) => {
    status = { text, frames: hold ? null : STATUS_FRAMES };
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

  // The case: what shows, and putting an item back.
  const shownPage = () => casePages[list][listPage[list]]!;
  const insertInCase = (item: Item, page: number) => casePages[item.kind === 'accessory' ? 0 : 1][page]!.unshift(item);
  const sendBack = (item: Item, to: { x: number; y: number }, page: number) => {
    returning.push({ item, dx: Math.trunc((to.x - item.x) / RETURN_FRAMES), dy: Math.trunc((to.y - item.y) / RETURN_FRAMES), left: RETURN_FRAMES, to, page });
  };
  const turnPage = (dir: 1 | -1) => {
    const n = casePages[list].length;
    for (let k = 1; k < n; k++) {
      const p = (((listPage[list] + dir * k) % n) + n) % n;
      if (casePages[list][p]!.length) {
        listPage[list] = p;
        pageBg = pageBg ? 0 : 1;
        cycle = -1;
        return;
      }
    }
  };
  const pressButton = (id: (typeof BUTTONS)[number]['id']) => {
    if (held) return;
    switch (id) {
      case 'case-next':
      case 'case-prev':
        se(SEQ.page);
        pressed = { id, frames: 4 };
        turnPage(id === 'case-next' ? 1 : -1);
        return;
      case 'tab-accessories':
      case 'tab-backdrops': {
        const to: ListKind = id === 'tab-accessories' ? 0 : 1;
        se(SEQ.tab);
        if (list !== to) {
          list = to;
          cycle = -1;
        }
        return;
      }
      case 'done':
        se(SEQ.done);
        pressed = { id, frames: 4 };
        doneRequested = true;
        return;
    }
  };

  // ov22_02258A48: a touch picks the stage's first hit (on the Pokémon front to back, the Pokémon itself picks nothing
  // in a contest, then the others), else the shown case page's.
  const pick = (x: number, y: number) => {
    let item: Item | null = null;
    let from: Held['from'] = 'case';
    const hits = (i: Item) => (i.kind === 'accessory' ? accessoryHit(tables.accessories[i.id]!, i.x, i.y, x, y) : inRect({ left: i.x, top: i.y, right: i.x + i.w, bottom: i.y + i.h }, x, y));
    if (inRect(STAGE_AREA, x, y)) {
      const k = onMonItems.findIndex(hits);
      if (k >= 0) item = onMonItems.splice(k, 1)[0]!;
      else if (!monHit(monRows, monX, monY, x, y)) {
        const j = freeItems.findIndex(hits);
        if (j >= 0) item = freeItems.splice(j, 1)[0]!;
      }
      from = 'stage';
    } else if (inRect(CASE_AREA, x, y)) {
      const page = shownPage();
      const k = page.findIndex(hits);
      if (k >= 0) item = page.splice(k, 1)[0]!;
    }
    if (!item) return;
    held = { item, from, ox: x - item.x, oy: y - item.y, origin: { x: item.x, y: item.y }, page: from === 'case' ? listPage[list] : 0 };
    cycle = -1;
    if (item.kind === 'backdrop') {
      backdrop = item.id;
      se(SEQ.pickBackdrop);
      setStatus(line(backdropName(item.id)), true);
    } else {
      se(SEQ.pickAccessory);
      setStatus(line(accessoryName(item.id)), true);
    }
  };
  const drag = (x: number, y: number) => {
    if (!held || held.item.kind !== 'accessory') return;
    held.item.x = x - held.ox;
    held.item.y = y - held.oy;
  };
  // ov22_02258BB8 / ov22_02258B78: the drop.
  const drop = (putBack: boolean) => {
    const h = held;
    if (!h) return;
    held = null;
    if (status?.frames === null) status = null;
    const item = h.item;
    if (item.kind === 'backdrop') {
      sendBack(item, h.origin, h.page);
      return;
    }
    const pic = tables.accessories[item.id]!;
    const r = innerRect(pic, item.x, item.y);
    const onStage = !putBack && [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom]].every(([px, py]) => inRect(STAGE_AREA, px!, py!));
    if (onStage) {
      if (onMonItems.length + freeItems.length < limit) {
        (onMon(pic, item.x, item.y, monRows, monX, monY) ? onMonItems : freeItems).unshift(item);
        se(SEQ.place);
        return;
      }
      se(SEQ.hurry);
      setStatus(line(DRESS.noSpace), false);
      sendBack(item, h.origin, h.page);
      return;
    }
    const page = h.from === 'stage' ? accessoryPage(item.id) : h.page;
    if (!putBack && inRect(CASE_AREA, item.x, item.y) && inRect(CASE_AREA, item.x + item.w, item.y + item.h)) {
      se(SEQ.drop);
      sendBack(item, { x: item.x, y: item.y }, page);
      return;
    }
    se(SEQ.hurry);
    sendBack(item, h.from === 'stage' ? scatterIn(item.w, item.h) : h.origin, page);
  };

  // The keys' hand: Y jumps to the next item of the shown page (to an opaque pixel near its middle).
  const aimAt = (i: Item): { x: number; y: number } => {
    const cx = i.x + (i.w >> 1);
    const cy = i.y + (i.h >> 1);
    if (i.kind === 'backdrop') return { x: cx, y: cy };
    const pic = tables.accessories[i.id]!;
    let best: { x: number; y: number; d: number } | null = null;
    for (let v = 0; v < pic.height; v++)
      for (let u = 0; u < pic.width; u++) {
        if (!accessoryOpaque(pic, u, v)) continue;
        const d = Math.abs(i.x + u - cx) + Math.abs(i.y + v - cy);
        if (!best || d < best.d) best = { x: i.x + u, y: i.y + v, d };
      }
    return best ?? { x: cx, y: cy };
  };

  const dressInput = (f: InputFrame) => {
    // Named button taps (replays, the app's buttons) and the stylus's points.
    const m = f.tap ? /^dress:(-?\d+),(-?\d+)$/.exec(f.tap) : null;
    if (m) {
      stylus = { x: Math.max(0, Math.min(255, Number(m[1]))), y: Math.max(0, Math.min(191, Number(m[2]))) };
      hand = null;
    } else if (f.tap === 'dress-up') stylus = null;
    else if (f.tap && BUTTONS.some((b) => b.id === f.tap)) pressButton(f.tap as (typeof BUTTONS)[number]['id']);
    if (stylus) {
      if (!stylusWas) {
        const b = BUTTONS.find((q) => inRect(q.rect, stylus!.x, stylus!.y));
        if (b) pressButton(b.id);
        else pick(stylus.x, stylus.y);
      } else drag(stylus.x, stylus.y);
      stylusWas = true;
      return;
    }
    if (stylusWas) {
      stylusWas = false;
      drop(false);
      return;
    }
    // The keys.
    const p = f.pressed;
    const dirs = (['left', 'right', 'up', 'down'] as const).filter((d) => f.held.includes(d));
    if (dirs.length || p.some((b) => b === 'a' || b === 'y' || b === 'b')) hand ??= held ? { x: held.item.x + held.ox, y: held.item.y + held.oy } : { x: 64, y: 80 };
    if (p.includes('select')) pressButton(list === 0 ? 'tab-backdrops' : 'tab-accessories');
    if (p.includes('r')) pressButton('case-next');
    if (p.includes('l')) pressButton('case-prev');
    if (p.includes('x') || p.includes('start')) pressButton('done');
    if (!hand) return;
    if (dirs.length) {
      handHeld++;
      const v = handHeld > HAND.after ? HAND.fast : HAND.slow;
      const dx = (dirs.includes('right') ? v : 0) - (dirs.includes('left') ? v : 0);
      const dy = (dirs.includes('down') ? v : 0) - (dirs.includes('up') ? v : 0);
      hand = { x: Math.max(0, Math.min(255, hand.x + dx)), y: Math.max(0, Math.min(191, hand.y + dy)) };
    } else handHeld = 0;
    if (p.includes('y')) {
      if (held) hand = { ...head };
      else {
        const page = shownPage();
        if (page.length) {
          cycle = (cycle + 1) % page.length;
          hand = aimAt(page[cycle]!);
        }
      }
    }
    if (held) drag(hand.x, hand.y);
    if (p.includes('a')) {
      if (held) drop(false);
      else pick(hand.x, hand.y);
    } else if (p.includes('b') && held) drop(true);
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
  const moveReturning = () => {
    for (let i = 0; i < returning.length; i++) {
      const r = returning[i]!;
      r.item.x += r.dx;
      r.item.y += r.dy;
      if (--r.left < 0 || (r.dx === 0 && r.dy === 0)) {
        r.item.x = r.to.x;
        r.item.y = r.to.y;
        insertInCase(r.item, r.page);
        returning.splice(i--, 1);
      }
    }
  };

  // Ov22_02256FD8: the player's photo, in the photo's coordinates.
  const takePhoto = (): ContestDressUp => {
    // The stage's priorities (ov22_02257B1C): on the Pokémon −1, −2 … then the Pokémon, then 8 lower the others.
    const staged: (StagedAccessory & { priority: number })[] = [
      ...onMonItems.map((i, k) => ({ accessory: i.id, x: i.x, y: i.y, onMon: true, priority: -1 - k })),
      ...freeItems.map((i, k) => ({ accessory: i.id, x: i.x, y: i.y, onMon: false, priority: -1 - (onMonItems.length + 1) - 8 - k })),
    ];
    const kept = photoAccessories(tables, staged) as typeof staged;
    return {
      accessories: kept.map((a) => ({ accessory: a.accessory, x: a.x + PHOTO_SHIFT.x, y: a.y + PHOTO_SHIFT.y, priority: a.priority })),
      monPriority: -1 - onMonItems.length,
      backdrop,
    };
  };

  // The judging (ov17_0223CB1C's state table).
  const startJudging = () => {
    phase = 'judging';
    fade = 16;
    timer = 0;
    bgm(SEQ.judging);
    se(SEQ.door);
    photo = takePhoto();
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
      if (pressed && --pressed.frames <= 0) pressed = null;
      if (status && status.frames !== null && --status.frames <= 0) status = null;
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
          if (doneRequested) {
            phase = 'finishing';
            break;
          }
          if (shown === 0) {
            phase = 'ending';
            timer = 0;
            se(SEQ.end);
            break;
          }
          dressInput(f);
          moveReturning();
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
          moveReturning();
          clockTick();
          frames = 0;
          break;
        case 'ending':
          // States 15 and 19: the last pulse, the end SE, then the fade out with SE CON_017.
          moveReturning();
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
    const toView = (i: Item, isHeld: boolean) => ({ kind: i.kind, id: i.id, x: i.x, y: i.y, held: isHeld });
    const page = shownPage();
    const items = [
      ...[...page].reverse().map((i) => toView(i, false)),
      ...[...freeItems].reverse().map((i) => toView(i, false)),
    ];
    const monAt = items.length;
    items.push(...[...onMonItems].reverse().map((i) => toView(i, false)));
    for (const r of returning) if (r.item.kind === 'backdrop' ? list === 1 && r.page === listPage[1] : list === 0 && r.page === listPage[0]) items.push(toView(r.item, false));
    if (held) items.push(toView(held.item, true));
    const pulseScale = pulse > 0 ? 1 + ((Math.max(0, 10 - shown) * 0.15) * pulse) / PULSE_FRAMES : 1;
    return {
      theme: themeLine,
      status: status?.text ?? null,
      seconds: shown,
      hurry,
      pulse: Math.round(pulseScale * 100) / 100,
      placed: onMonItems.length + freeItems.length,
      limit,
      tab: list === 0 ? 'accessories' : 'backdrops',
      page: listPage[list],
      pageBg,
      pressed: pressed?.id ?? null,
      backdrop,
      mon: { species: player.species, form: player.form, female: playerFace.female, shiny: playerFace.shiny, x: monX, y: monY },
      items,
      monAt,
      cursor: hand && phase === 'dress' ? { x: hand.x, y: hand.y, grabbing: !!held } : null,
    };
  }
}
