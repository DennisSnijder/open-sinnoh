/**
 * The dress-up's Fashion Case and stage (decomp overlay022: the case ov22_02257F50.c, the stage ov22_022578F4.c, the
 * stylus ov22_022589E0.c, the buttons ov22_02259C58.c), shared by the contest's visual round (contest/visual.ts,
 * VisualCompetition_*) and the Jubilife TV gallery's dress-up (gallery-dress-up.ts, ov22_02255D44 / ov22_02255E50 /
 * ov22_02256098). Each runs its own frame around it (the clock, the intro, the finish).
 *
 * - The stylus picks an accessory from the case page or the stage, drags it and drops it: on the stage it stays (if
 *   fewer than the limit are there; else "There is no more space." and it goes back), in the case it stays where
 *   dropped, anywhere else it goes back (from the stage: to a random place in the case). An accessory goes down "on the
 *   Pokémon" when one of its 16 points hits the Pokémon's pixels. A backdrop from the BACKDROPS page is chosen by picking
 *   it up.
 * - The gallery (ov22_022589E0's last flag, ov22_02256708): the Pokémon stands centred at (192, 56) and the stylus picks
 *   it too: it moves with the accessories on it, its opaque box kept inside the stage (ov22_02258DAC), and those
 *   accessories pushed back inside (ov22_02257D04). In a contest it stands lower (ov22_02256790) and picks nothing.
 * - Keys (an OpenSinnoh addition, the DS has none here): the PC's hand is the stylus. The +Control Pad moves it, A
 *   picks up or drops, B puts back what is held, Y jumps to the next item of the page (or, holding one, to the
 *   Pokémon's head), L/R turn the page, SELECT switches ACCESSORIES/BACKDROPS, X or START is DONE.
 *
 * The case's scatter and the stage's random returns use the DS's MTRNG: here a local LCRNG seeded by the caller.
 */
import type { ContestDressUp, ContestDressView, ContestTables, DressUpStageView, FashionCase, InputFrame, Registries } from '@opensinnoh/contracts';
import {
  accessoryHit, accessoryOpaque, accessoryPage, ACCESSORY_PAGES, backdropSlot, BACKDROPS_PER_PAGE, inRect, innerRect, monHit, onMon, opaqueRows, photoAccessories,
  type Rect, type StagedAccessory,
} from '@opensinnoh/services';
import { PHOTO_SHIFT, photoFace, STAGE_MON_X, stageMonY, type PhotoMon } from './picture.ts';

/** TEXT_BANK_UNK_0385 (the dress-up), TEXT_BANK_CONTEST_ACCESSORY_NAMES (386), _BACKDROP_NAMES (388). */
export const msg385 = (n: number) => `pl_msg_00000385_${String(n).padStart(5, '0')}`;
export const accessoryName = (n: number) => `pl_msg_00000386_${String(n).padStart(5, '0')}`;
export const backdropName = (n: number) => `pl_msg_00000388_${String(n).padStart(5, '0')}`;
/** "There is no more space." */
export const NO_SPACE = msg385(3);
/** The names the stage reads: the accessories' and backdrops' names and the no-space line. */
export const STAGE_TEXTS = [NO_SPACE, ...Array.from({ length: 100 }, (_, a) => accessoryName(a)), ...Array.from({ length: 18 }, (_, b) => backdropName(b))];

/** The stage's SEs by symbol (the SDAT names). */
export const STAGE_SEQ = {
  hurry: 'SEQ_SE_DP_HYUN2', pickAccessory: 'SEQ_SE_DP_BOX02', pickBackdrop: 'SEQ_SE_DP_SYARAAN', place: 'SEQ_SE_DP_BOX01', drop: 'SEQ_SE_DP_BOX02',
  page: 'SEQ_SE_DP_MAZYO3', tab: 'SEQ_SE_DP_PASO', done: 'SEQ_SE_DP_PIRORIRO',
} as const;

/** The case's and the stage's touch areas (ov22_022582E8, ov22_02257BE8): the frames less 2 px. Accessories draw only inside (8 + 2, 16 + 2) … (246, 143) (ov22_02255390's window). */
export const CASE_AREA: Rect = { left: 10, top: 18, right: 118, bottom: 143 };
export const STAGE_AREA: Rect = { left: 138, top: 18, right: 246, bottom: 143 };
/** The buttons' touch rects (ov22_02259DBC): NEXT and BACK pages, the ACCESSORIES and BACKDROPS tabs, DONE. */
export const DRESS_BUTTONS: { id: 'case-next' | 'case-prev' | 'tab-accessories' | 'tab-backdrops' | 'done'; rect: Rect }[] = [
  { id: 'case-next', rect: { left: 48, top: 152, right: 88, bottom: 176 } },
  { id: 'case-prev', rect: { left: 8, top: 152, right: 48, bottom: 176 } },
  { id: 'tab-accessories', rect: { left: 96, top: 156, right: 136, bottom: 190 } },
  { id: 'tab-backdrops', rect: { left: 136, top: 156, right: 176, bottom: 190 } },
  { id: 'done', rect: { left: 184, top: 156, right: 256, bottom: 190 } },
];
/** The gallery's Pokémon centre (ov22_022590D4) and its picture's size (ov22_02259270). */
export const GALLERY_MON = { x: 192, y: 56 } as const;
const MON_SIZE = 80;
/** A back-to-case move's frames (ov22_02258F4C). */
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

/** A local LCRNG (the stand-in for the DS's MTRNG in the dress-up). */
function localRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 0x41c64e6d) + 0x6073) >>> 0;
    return s >>> 16;
  };
}

export interface DressUpStageConfig {
  registries: Registries;
  tables: ContestTables;
  fashionCase: FashionCase;
  mon: PhotoMon;
  /** The accessories the stage holds (ov22_02257580 by rank; 10 in the gallery). */
  limit: number;
  /** The local LCRNG's seed. */
  seed: number;
  se(name: string): void;
  /** A text record's plain line. */
  line(name: string): string;
  /** The gallery's stage (the Pokémon higher up, picked and moved by the stylus). */
  gallery: boolean;
  /** The caller's name in errors. */
  label: string;
}

export interface DressUpStage {
  /** Once a frame first: the status line's hold and the pressed button's. */
  tick(): void;
  /** The frame's stylus, taps and keys. */
  input(f: InputFrame): void;
  /** Once a frame: the accessories going back to the case. */
  moveReturning(): void;
  /** DONE was pressed (ov22_02256AE4). */
  readonly done: boolean;
  clearDone(): void;
  /** Nothing in hand. */
  idle(): boolean;
  /** Drops what is held where it is (the stylus lifted). */
  release(): void;
  /** The contest photo (ov22_02256FD8): the accessories on the Pokémon and those touching them. */
  contestPhoto(): ContestDressUp;
  /**
   * The gallery photo (ov22_02256F38): every accessory on the stage (on the Pokémon front to back, then the others) and
   * the Pokémon's centre, in the photo's coordinates (the stage moves by (−64, +40) before the save, ov22_02257098).
   */
  galleryPhoto(): { dressUp: ContestDressUp; x: number; y: number };
  view(cursor: boolean): DressUpStageView;
}

export function dressUpStage(cfg: DressUpStageConfig): DressUpStage {
  const { tables, limit, se, line } = cfg;
  const fc = cfg.fashionCase;
  const scatter = localRng(cfg.seed);

  // The Pokémon on the stage: centre x 192, y by its picture's height (contest, ov22_02256790) or 56 (gallery).
  const player = cfg.mon;
  const playerFace = photoFace(cfg.registries, player);
  if (!playerFace.face.opaque) throw new Error(`${cfg.label}: the pack's front picture of ${player.species} has no opaque mask (PokemonFace.opaque)`);
  const monRows = opaqueRows(playerFace.face.opaque);
  let monX: number = cfg.gallery ? GALLERY_MON.x : STAGE_MON_X;
  let monY = cfg.gallery ? GALLERY_MON.y : stageMonY(playerFace.face.yOffset);
  // The head: the middle of the topmost opaque rows (an aim for the keys' jump).
  const headRow = monRows.findIndex((r) => r.length > 0) + 8;
  const headAt = (() => {
    const runs = monRows[Math.min(79, headRow)] ?? [];
    const x = runs.length ? Math.floor((runs[0]![0] + runs[runs.length - 1]![1]) / 2) : 40;
    return { x: x - 40, y: Math.min(79, headRow) - 40 };
  })();
  const head = () => ({ x: monX + headAt.x, y: monY + headAt.y });
  // The opaque box's margins (ov22_022593B8): left, right, top, bottom, 40 each when the picture is empty.
  const margins = (() => {
    const m = { left: 40, right: 40, top: 40, bottom: 40 };
    monRows.forEach((runs, y) => {
      for (const [a, b] of runs) {
        m.left = Math.min(m.left, a);
        m.right = Math.min(m.right, MON_SIZE - (b - 1));
        m.top = Math.min(m.top, y);
        m.bottom = Math.min(m.bottom, MON_SIZE - y);
      }
    });
    return m;
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
  /** The gallery's Pokémon in hand: the touch's offset from its picture's top-left. */
  let heldMon: { ox: number; oy: number } | null = null;
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

  const setStatus = (text: string, hold: boolean) => {
    status = { text, frames: hold ? null : STATUS_FRAMES };
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
  const pressButton = (id: (typeof DRESS_BUTTONS)[number]['id']) => {
    if (held || heldMon) return;
    switch (id) {
      case 'case-next':
      case 'case-prev':
        se(STAGE_SEQ.page);
        pressed = { id, frames: 4 };
        turnPage(id === 'case-next' ? 1 : -1);
        return;
      case 'tab-accessories':
      case 'tab-backdrops': {
        const to: ListKind = id === 'tab-accessories' ? 0 : 1;
        se(STAGE_SEQ.tab);
        if (list !== to) {
          list = to;
          cycle = -1;
        }
        return;
      }
      case 'done':
        se(STAGE_SEQ.done);
        pressed = { id, frames: 4 };
        doneRequested = true;
        return;
    }
  };

  // ov22_02258A48: a touch picks the stage's first hit (on the Pokémon front to back, then the Pokémon itself, which
  // picks nothing in a contest, then the others), else the shown case page's.
  const pick = (x: number, y: number) => {
    let item: Item | null = null;
    let from: Held['from'] = 'case';
    const hits = (i: Item) => (i.kind === 'accessory' ? accessoryHit(tables.accessories[i.id]!, i.x, i.y, x, y) : inRect({ left: i.x, top: i.y, right: i.x + i.w, bottom: i.y + i.h }, x, y));
    if (inRect(STAGE_AREA, x, y)) {
      const k = onMonItems.findIndex(hits);
      if (k >= 0) item = onMonItems.splice(k, 1)[0]!;
      else if (monHit(monRows, monX, monY, x, y)) {
        if (cfg.gallery) {
          // ov22_022579E8 and ov22_02258D7C/DAC: the Pokémon in hand.
          heldMon = { ox: x - (monX - MON_SIZE / 2), oy: y - (monY - MON_SIZE / 2) };
          cycle = -1;
          se(STAGE_SEQ.pickAccessory);
          return;
        }
      } else {
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
      se(STAGE_SEQ.pickBackdrop);
      setStatus(line(backdropName(item.id)), true);
    } else {
      se(STAGE_SEQ.pickAccessory);
      setStatus(line(accessoryName(item.id)), true);
    }
  };
  // ov22_02258DAC with ov22_02259074 and ov22_02257D04: the Pokémon to the touch less the grab, its opaque box inside
  // the stage; the accessories on it move along, then all of them again by the farthest any of those sticks out.
  const dragMon = (x: number, y: number) => {
    const h = heldMon!;
    let left = x - h.ox;
    let top = y - h.oy;
    if (left + margins.left <= STAGE_AREA.left) left = STAGE_AREA.left - margins.left;
    else if (left + (MON_SIZE - margins.right) >= STAGE_AREA.right) left = STAGE_AREA.right - (MON_SIZE - margins.right);
    if (top + margins.top <= STAGE_AREA.top) top = STAGE_AREA.top - margins.top;
    else if (top + (MON_SIZE - margins.bottom) >= STAGE_AREA.bottom) top = STAGE_AREA.bottom - (MON_SIZE - margins.bottom);
    const moveTo = (l: number, t: number) => {
      const dx = l - (monX - MON_SIZE / 2);
      const dy = t - (monY - MON_SIZE / 2);
      monX += dx;
      monY += dy;
      for (const i of onMonItems) {
        i.x += dx;
        i.y += dy;
      }
    };
    moveTo(left, top);
    let cx = 0;
    let cy = 0;
    for (const i of onMonItems) {
      const r = innerRect(tables.accessories[i.id]!, i.x, i.y);
      const ox = STAGE_AREA.left - r.left > 0 ? STAGE_AREA.left - r.left : r.right - STAGE_AREA.right > 0 ? -(r.right - STAGE_AREA.right) : 0;
      const oy = STAGE_AREA.top - r.top > 0 ? STAGE_AREA.top - r.top : r.bottom - STAGE_AREA.bottom > 0 ? -(r.bottom - STAGE_AREA.bottom) : 0;
      if (Math.abs(ox) > Math.abs(cx)) cx = ox;
      if (Math.abs(oy) > Math.abs(cy)) cy = oy;
    }
    moveTo(left + cx, top + cy);
  };
  const drag = (x: number, y: number) => {
    if (heldMon) {
      dragMon(x, y);
      return;
    }
    if (!held || held.item.kind !== 'accessory') return;
    held.item.x = x - held.ox;
    held.item.y = y - held.oy;
  };
  // ov22_02258BB8 / ov22_02258B78: the drop (ov22_02258D7C: the Pokémon goes down where it is, at the back of the list).
  const drop = (putBack: boolean) => {
    if (heldMon) {
      heldMon = null;
      se(STAGE_SEQ.drop);
      return;
    }
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
        se(STAGE_SEQ.place);
        return;
      }
      se(STAGE_SEQ.hurry);
      setStatus(line(NO_SPACE), false);
      sendBack(item, h.origin, h.page);
      return;
    }
    const page = h.from === 'stage' ? accessoryPage(item.id) : h.page;
    if (!putBack && inRect(CASE_AREA, item.x, item.y) && inRect(CASE_AREA, item.x + item.w, item.y + item.h)) {
      se(STAGE_SEQ.drop);
      sendBack(item, { x: item.x, y: item.y }, page);
      return;
    }
    se(STAGE_SEQ.hurry);
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

  const input = (f: InputFrame) => {
    // Named button taps (replays, the app's buttons) and the stylus's points.
    const m = f.tap ? /^dress:(-?\d+),(-?\d+)$/.exec(f.tap) : null;
    if (m) {
      stylus = { x: Math.max(0, Math.min(255, Number(m[1]))), y: Math.max(0, Math.min(191, Number(m[2]))) };
      hand = null;
    } else if (f.tap === 'dress-up') stylus = null;
    else if (f.tap && DRESS_BUTTONS.some((b) => b.id === f.tap)) pressButton(f.tap as (typeof DRESS_BUTTONS)[number]['id']);
    if (stylus) {
      if (!stylusWas) {
        const b = DRESS_BUTTONS.find((q) => inRect(q.rect, stylus!.x, stylus!.y));
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
    if (dirs.length || p.some((b) => b === 'a' || b === 'y' || b === 'b')) hand ??= held ? { x: held.item.x + held.ox, y: held.item.y + held.oy } : heldMon ? { x: monX - MON_SIZE / 2 + heldMon.ox, y: monY - MON_SIZE / 2 + heldMon.oy } : { x: 64, y: 80 };
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
    if (p.includes('y') && !heldMon) {
      if (held) hand = head();
      else {
        const page = shownPage();
        if (page.length) {
          cycle = (cycle + 1) % page.length;
          hand = aimAt(page[cycle]!);
        }
      }
    }
    if (held || heldMon) {
      drag(hand.x, hand.y);
      if (heldMon) hand = { x: monX - MON_SIZE / 2 + heldMon.ox, y: monY - MON_SIZE / 2 + heldMon.oy };
    }
    if (p.includes('a')) {
      if (held || heldMon) drop(false);
      else pick(hand.x, hand.y);
    } else if (p.includes('b') && (held || heldMon)) drop(true);
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

  // The stage's priorities (ov22_02257B1C): on the Pokémon −1, −2 … then the Pokémon, then 8 lower the others.
  const staged = (): (StagedAccessory & { priority: number })[] => [
    ...onMonItems.map((i, k) => ({ accessory: i.id, x: i.x, y: i.y, onMon: true, priority: -1 - k })),
    ...freeItems.map((i, k) => ({ accessory: i.id, x: i.x, y: i.y, onMon: false, priority: -1 - (onMonItems.length + 1) - 8 - k })),
  ];
  const shifted = (a: StagedAccessory & { priority: number }) => ({ accessory: a.accessory, x: a.x + PHOTO_SHIFT.x, y: a.y + PHOTO_SHIFT.y, priority: a.priority });

  return {
    tick() {
      if (pressed && --pressed.frames <= 0) pressed = null;
      if (status && status.frames !== null && --status.frames <= 0) status = null;
    },
    input,
    moveReturning,
    get done() {
      return doneRequested;
    },
    clearDone() {
      doneRequested = false;
    },
    idle: () => !held && !heldMon,
    release() {
      if (held || heldMon) drop(false);
      stylus = null;
      stylusWas = false;
    },
    contestPhoto() {
      const kept = photoAccessories(tables, staged()) as ReturnType<typeof staged>;
      return { accessories: kept.map(shifted), monPriority: -1 - onMonItems.length, backdrop };
    },
    galleryPhoto() {
      return { dressUp: { accessories: staged().map(shifted), monPriority: -1 - onMonItems.length, backdrop }, x: monX + PHOTO_SHIFT.x, y: monY + PHOTO_SHIFT.y };
    },
    view(cursor) {
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
      return {
        status: status?.text ?? null,
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
        cursor: hand && cursor ? { x: hand.x, y: hand.y, grabbing: !!held || !!heldMon } : null,
      };
    },
  };
}
