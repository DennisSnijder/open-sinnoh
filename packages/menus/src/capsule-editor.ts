/**
 * The Ball Capsule editor (decomp applications/capsule_menu: main.c's field task, manager.c, graphics.c, placement.c;
 * docs/research/seals.md §5), the PC's BALL CAPSULES (`open_seal_capsule_editor`).
 *
 * - Capsule selection (CapsuleManager_SelectionActions): the 12 capsules, the D-pad (Right/Left ±1 wrapping, Up/Down ±4
 *   within the grid), A opens the capsule menu (EDIT, SET or REMOVE, SHIFT, QUIT by the capsule's state), B leaves. SET
 *   opens the party in its BALL_SEAL mode and comes back here; REMOVE takes the capsule off its holder; SHIFT swaps two
 *   capsules (their holders follow).
 * - The editor (CapsuleManager_HandleCancelUpdateSeals, CapsuleManager_HandleSpritePress): the seal list in pages of 8
 *   (every seal with loose ones or on any capsule, as saved), the page arrows (wrapping), Test, CONFIRM and CANCEL. A
 *   press on a list slot takes one loose seal (none left: "There are no Seals left."; 8 placed: "There's no more
 *   room!") and it follows the stylus; a press within 10 px of a placed seal picks it up (front first). On release a
 *   seal more than 60 px from (190, 70) goes back to the case (GiveOrTakeSeal2); any other place stays, no snapping.
 *   CONFIRM saves the capsule (front first), refreshes the holder's copy (or lets an emptied capsule go) and counts
 *   trainer score event 6; CANCEL leaves at once when nothing changed, else asks "Quit without changing the capsule
 *   design?": YES puts the capsule and every loose count back as they were at EDIT and leaves as CONFIRM does, NO
 *   goes on editing.
 * - Test (capsule-test.ts): a copy of the first non-Egg party Pokémon (the holder, when the capsule has one) comes out
 *   of its ball with the capsule as it is on screen and the battle's send-out effect; input waits until it is over.
 * - Keys (OpenSinnoh: the DS edits by touch only): a hand moves between the list's seals, the page arrows, the buttons
 *   and the placed seals (the D-pad jumps to the nearest in that direction); A presses there (a list seal comes out at
 *   the capsule's centre); while a seal is held the D-pad moves it 1 px a tick (2 after 8 ticks, 4 after 24), A drops
 *   it and B puts it back in the case. Without a seal held, B is CANCEL, L/R turn the page, START is CONFIRM and SELECT
 *   is Test.
 * The stylus is `seal:<x>,<y>` taps while it is down and `seal-up` when it lifts (DS pixels).
 */
import { isShiny, monGender, type BallSeal, type Button, type Pokemon } from '@opensinnoh/core';
import { dexOf, SEALS, type CapsuleEditorView, type InputFrame } from '@opensinnoh/contracts';
import { capsuleHolder, giveOrTakeSeal, incrementTrainerScore, onCapsule, removeCapsule, returnSeal, saveCapsule, sealList, sealTables, shiftCapsules } from '@opensinnoh/services';
import { SplRandom } from '@opensinnoh/battle/particles';
import { CapsuleTest } from './capsule-test.ts';
import { menuSe, type MenuContext } from './context.ts';
import { partyScreen } from './party.ts';
import { sealNameText } from './seal-mart.ts';
import { moveCursor, tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';

/** SDAT sequences (§8): SE_CONFIRM, SEQ_SE_DP_DECIDE, _CUSTOM02, _PIRORIRO, _CUSTOM06, _BOX02, _BOX01. */
const SE = { confirm: 1500, decide: 1501, page: 1733, done: 1506, refuse: 1522, pick: 1515, drop: 1514 } as const;
/** Decomp TRAINER_SCORE_EVENT_UNK_06: every CONFIRM. */
const SCORE_EVENT = 6;
/** The cell bank of the seals in `capsule/seals` starts at cb_data member 184. */
const SEAL_ART_FIRST = 184;
const PER_PAGE = 8;
const MAX_PAGES = 10;
/** The editor's touch rects (decomp CapsuleUIRects; 8–12 replaced by the sprites' centres ± their offsets, InitCapsuleUI). */
type Rect = { left: number; top: number; right: number; bottom: number };
const LIST_RECTS: Rect[] = Array.from({ length: PER_PAGE }, (_, i) => ({ left: 8 + 56 * (i % 2), right: 24 + 56 * (i % 2), top: 16 + 24 * Math.floor(i / 2), bottom: 32 + 24 * Math.floor(i / 2) }));
/** The list slot's sprite place (graphics.c initialXY with the placed seals' cell origin). */
export const listSlotAt = (i: number) => ({ x: 19 + 56 * (i % 2), y: 23 + 24 * Math.floor(i / 2) });
type ButtonId = 'page-up' | 'page-down' | 'test' | 'confirm' | 'cancel';
const around = (x: number, y: number, dx: number, dy: number): Rect => ({ left: x - dx, right: x + dx, top: y - dy, bottom: y + dy });
export const CAPSULE_BUTTONS: { id: ButtonId; x: number; y: number; rect: Rect }[] = [
  { id: 'page-up', x: 27, y: 124, rect: around(27, 124, 13, 10) },
  { id: 'page-down', x: 67, y: 124, rect: around(67, 124, 13, 10) },
  { id: 'test', x: 32, y: 171, rect: around(32, 171, 16, 12) },
  { id: 'confirm', x: 104, y: 171, rect: around(104, 171, 28, 12) },
  { id: 'cancel', x: 192, y: 171, rect: around(192, 171, 28, 12) },
];
/** A placed seal's touch rect while idle (SealPlacement_UpdateSealTouchRect): ±10 px. */
const SEAL_TOUCH = 10;
const inRect = (r: Rect, x: number, y: number) => x >= r.left && x < r.right && y >= r.top && y < r.bottom;
/** The pressed button's frame shows this long. */
const PRESS_TICKS = 4;
/** CONFIRM's "Finished editing the capsule." while the editor slides away (the exit fade, 16 frames, and the slide, 4). */
const FINISH_TICKS = 20;
/** The keys' seal speed: 1 px a tick, 2 after 8 ticks held, 4 after 24. */
const SPEED = [
  { after: 24, px: 4 },
  { after: 8, px: 2 },
  { after: 0, px: 1 },
];
/** The capsule's centre, where a seal taken with the keys comes out. */
const CENTRE = { x: 190, y: 70 };
/** The cancel prompt's dim: PaletteData_StartFade to 10/16 toward black. */
const ASK_DIM = 10 / 16;

type Phase =
  | { kind: 'select' }
  | { kind: 'menu'; entries: { key: MenuKey; run: () => Step }[]; cursor: number }
  | { kind: 'shift'; other: number }
  | { kind: 'message'; text: string; then: () => Step }
  | { kind: 'edit' }
  | { kind: 'ask'; yes: boolean }
  | { kind: 'test'; run: CapsuleTest }
  | { kind: 'finish'; ticks: number };

export function capsuleEditorScreen(ctx: MenuContext): Screen {
  const t = ctx.text;
  const tables = sealTables(ctx.registries);
  const sealCase = () => ctx.state.sealCase;
  const se = (n: number) => menuSe(ctx, n);
  const sealName = (seal: number) => t.message(sealNameText(tables.types[seal]!.name));
  const cellOf = (seal: number) => tables.types[seal]!.sheet - SEAL_ART_FIRST;

  let cursor = 0;
  let phase: Phase = { kind: 'select' };
  let message: string | null = t.t('capsuleChoose');
  /** The tick's input was taken by `tick` (the editor and the Test read the frame themselves). */
  let consumed = false;
  /** The Test's particles' own random stream (never the game's), and its hold counter (the DS never resets it while the app runs). */
  const testRng = new SplRandom(0);
  const testHeld = { frames: 0 };

  // --- the editor's state ---
  /** The capsule being edited, back to front (the last is drawn in front). */
  let working: BallSeal[] = [];
  let before: { seals: BallSeal[]; counts: number[] } = { seals: [], counts: [] };
  let pageIds: number[] = [];
  let page = 0;
  let pages = 1;
  let held: number | null = null;
  let status: string | null = null;
  let pressed: { id: ButtonId; ticks: number } | null = null;
  let stylus: { x: number; y: number } | null = null;
  let stylusWas = false;
  let hand: { x: number; y: number } | null = null;
  let heldTicks = 0;
  let dirHeld: { dir: Button; ticks: number } | null = null;

  const populate = () => {
    const ids = sealList(sealCase());
    pages = Math.max(1, Math.min(MAX_PAGES, Math.ceil(ids.length / PER_PAGE)));
    if (page >= pages) page = 0;
    pageIds = ids.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);
  };
  const toSelect = (text: string | null = t.t('capsuleChoose')): Step => {
    phase = { kind: 'select' };
    message = text;
    return;
  };
  const say = (key: MenuKey, then: () => Step): Step => {
    phase = { kind: 'message', text: t.t(key), then };
    message = null;
    return;
  };

  // --- capsule selection ---
  const sealed = (i: number) => sealCase().capsules[i]!.length > 0;
  const openMenu = (): Step => {
    se(SE.confirm);
    const holder = capsuleHolder(ctx.state.party, cursor);
    const entries: { key: MenuKey; run: () => Step }[] = [];
    if (sealed(cursor)) entries.push(holder >= 0 ? { key: 'capsuleRemove', run: remove } : { key: 'capsuleSet', run: set });
    entries.push({ key: 'capsuleEdit', run: startEdit }, { key: 'capsuleShift', run: startShift }, { key: 'capsuleQuit', run: () => toSelect() });
    phase = { kind: 'menu', entries, cursor: 0 };
    message = t.t('capsuleWhat');
    return;
  };
  const remove = (): Step => {
    removeCapsule(ctx.state.party, cursor);
    return say('capsuleRemoved', () => toSelect());
  };
  const set = (): Step => {
    toSelect();
    // The DS leaves the app for the party menu and starts it again.
    testHeld.frames = 0;
    return { push: partyScreen(ctx, { kind: 'ball-seal', index: cursor }) };
  };
  const startShift = (): Step => {
    phase = { kind: 'shift', other: cursor };
    message = t.t('capsuleSwitchWith');
    return;
  };
  const shiftTo = (other: number): Step => {
    se(SE.confirm);
    shiftCapsules(ctx.state, cursor, other);
    return say('capsuleSwitched', () => toSelect());
  };
  const gridMove = (c: number, b: Button): number => {
    if (b === 'right') return (c + 1) % SEALS.capsules;
    if (b === 'left') return (c + SEALS.capsules - 1) % SEALS.capsules;
    if (b === 'up') return c >= 4 ? c - 4 : c;
    if (b === 'down') return c < 8 ? c + 4 : c;
    return c;
  };

  // --- the editor ---
  const startEdit = (): Step => {
    before = { seals: sealCase().capsules[cursor]!.map((s) => ({ ...s })), counts: [...sealCase().counts] };
    working = before.seals.map((s) => ({ ...s })).reverse();
    page = 0;
    populate();
    held = null;
    status = null;
    pressed = null;
    stylus = null;
    stylusWas = false;
    hand = null;
    phase = { kind: 'edit' };
    message = null;
    return;
  };
  /** Decomp SealPlacement_AnySealsChanged: the seals (type and place) differ from the capsule as saved. */
  const changed = () => {
    const key = (s: BallSeal) => `${s.seal},${s.x},${s.y}`;
    const a = working.map(key).sort();
    const b = before.seals.map(key).sort();
    return a.length !== b.length || a.some((k, i) => k !== b[i]);
  };
  const finish = (revert: boolean) => {
    if (revert) {
      sealCase().counts = [...before.counts];
      working = before.seals.map((s) => ({ ...s })).reverse();
    }
    saveCapsule(ctx.state, cursor, [...working].reverse());
    incrementTrainerScore(ctx.state, ctx.registries, SCORE_EVENT);
    phase = { kind: 'finish', ticks: FINISH_TICKS };
    message = t.t('capsuleFinished');
  };
  const pressButton = (id: ButtonId) => {
    pressed = { id, ticks: PRESS_TICKS };
    switch (id) {
      case 'page-up':
      case 'page-down':
        page = id === 'page-up' ? (page > 0 ? page - 1 : pages - 1) : (page + 1) % pages;
        populate();
        se(SE.page);
        return;
      case 'test': {
        se(SE.decide);
        const holder = capsuleHolder(ctx.state.party, cursor);
        const mon = holder >= 0 ? ctx.state.party[holder]! : ctx.state.party.find((m) => !m.isEgg);
        if (!mon) throw new Error('capsule editor: no Pokémon to test with');
        // THROW_SET_CAPSULE: a copy holding the capsule as it is on screen (SealPlacement_GetCapsuleSeals, front first).
        const copy: Pokemon = { ...mon, capsule: { id: cursor + 1, seals: [...working].reverse().map((s) => ({ ...s })) } };
        phase = { kind: 'test', run: new CapsuleTest({ registries: ctx.registries, tables, rng: testRng, se, held: testHeld }, copy) };
        message = t.t('capsuleConfirming');
        return;
      }
      case 'confirm':
        se(SE.done);
        finish(false);
        return;
      case 'cancel':
        se(SE.decide);
        if (!changed()) return void toSelect();
        phase = { kind: 'ask', yes: true };
        return;
    }
  };
  const pickNew = (slot: number, at: { x: number; y: number }) => {
    if (working.length >= SEALS.perCapsule) {
      se(SE.refuse);
      status = t.t('capsuleNoRoom');
      return;
    }
    const seal = pageIds[slot];
    if (seal === undefined) return;
    if (sealCase().counts[seal - 1] === 0) {
      se(SE.refuse);
      status = t.t('capsuleNoSeals');
      return;
    }
    giveOrTakeSeal(sealCase(), seal, -1);
    working.push({ seal, x: at.x, y: at.y });
    held = working.length - 1;
    status = sealName(seal);
    se(SE.pick);
  };
  const pickPlaced = (k: number) => {
    const [s] = working.splice(k, 1);
    working.push(s!);
    held = working.length - 1;
    status = sealName(s!.seal);
    se(SE.pick);
  };
  /** A press at (x, y): a list slot, a button or a placed seal (front first). */
  const press = (x: number, y: number, keys: boolean) => {
    const slot = LIST_RECTS.findIndex((r) => inRect(r, x, y));
    if (slot >= 0) return pickNew(slot, keys ? CENTRE : { x, y });
    const button = CAPSULE_BUTTONS.find((b) => inRect(b.rect, x, y));
    if (button) return pressButton(button.id);
    for (let k = working.length - 1; k >= 0; k--) {
      const s = working[k]!;
      if (Math.abs(x - s.x) <= SEAL_TOUCH && Math.abs(y - s.y) <= SEAL_TOUCH) return pickPlaced(k);
    }
  };
  const moveHeld = (x: number, y: number) => {
    if (held === null) return;
    const s = working[held]!;
    s.x = Math.max(0, Math.min(255, Math.round(x)));
    s.y = Math.max(0, Math.min(191, Math.round(y)));
  };
  /** The seal held is let go: off the capsule (or `back`) it returns to the case (GiveOrTakeSeal2). */
  const release = (back: boolean) => {
    if (held === null) return;
    const s = working[held]!;
    held = null;
    if (back || !onCapsule(s.x, s.y)) {
      returnSeal(sealCase(), s.seal, 1);
      working.splice(working.indexOf(s), 1);
    }
    se(SE.drop);
    status = null;
  };

  // The keys' hand: the places it stops at, and the nearest one in a direction.
  const stops = (): { x: number; y: number }[] => [
    ...pageIds.map((_, i) => listSlotAt(i)),
    ...CAPSULE_BUTTONS.map((b) => ({ x: b.x, y: b.y })),
    ...working.map((s) => ({ x: s.x, y: s.y })),
  ];
  const nearest = (from: { x: number; y: number }, dir: Button): { x: number; y: number } | null => {
    let best: { p: { x: number; y: number }; score: number } | null = null;
    for (const p of stops()) {
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      const main = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
      const side = Math.abs(dir === 'left' || dir === 'right' ? dy : dx);
      if (main <= 0 || side > main * 2) continue;
      const score = main + 2 * side;
      if (!best || score < best.score) best = { p, score };
    }
    return best?.p ?? null;
  };
  const DIRS: Button[] = ['up', 'down', 'left', 'right'];
  const keys = (f: InputFrame) => {
    const p = f.pressed;
    const dir = DIRS.find((d) => f.held.includes(d)) ?? null;
    const any = dir !== null || p.length > 0;
    if (!hand && any) {
      hand = held !== null ? { x: working[held]!.x, y: working[held]!.y } : (stops()[0] ?? null);
      if (!hand) return;
      // The first D-pad press only shows the hand; a button acts at once.
      if (p.every((b) => DIRS.includes(b))) return;
    }
    if (!hand) return;
    if (held !== null) {
      if (dir) {
        heldTicks++;
        const v = SPEED.find((s) => heldTicks > s.after)!.px;
        const s = working[held]!;
        moveHeld(s.x + (dir === 'right' ? v : dir === 'left' ? -v : 0), s.y + (dir === 'down' ? v : dir === 'up' ? -v : 0));
      } else heldTicks = 0;
      hand = { x: working[held]!.x, y: working[held]!.y };
      if (p.includes('a')) release(false);
      else if (p.includes('b')) release(true);
      return;
    }
    heldTicks = 0;
    // The hand jumps on a press and repeats as the DS cursor does (8 ticks, then every 4).
    if (dir) {
      dirHeld = dirHeld?.dir === dir ? { dir, ticks: dirHeld.ticks + 1 } : { dir, ticks: 0 };
      const repeat = dirHeld.ticks >= 8 && (dirHeld.ticks - 8) % 4 === 0;
      if (dirHeld.ticks === 0 || repeat) hand = nearest(hand, dir) ?? hand;
    } else dirHeld = null;
    if (p.includes('a')) {
      press(hand.x, hand.y, true);
      if (held !== null) hand = { x: working[held]!.x, y: working[held]!.y };
    } else if (p.includes('b')) pressButton('cancel');
    else if (p.includes('l')) pressButton('page-up');
    else if (p.includes('r')) pressButton('page-down');
    else if (p.includes('start')) pressButton('confirm');
    else if (p.includes('select')) pressButton('test');
  };
  const editTick = (f: InputFrame) => {
    if (pressed && --pressed.ticks <= 0) pressed = null;
    const m = f.tap ? /^seal:(-?\d+),(-?\d+)$/.exec(f.tap) : null;
    if (m) {
      stylus = { x: Math.max(0, Math.min(255, Number(m[1]))), y: Math.max(0, Math.min(191, Number(m[2]))) };
      hand = null;
    } else if (f.tap === 'seal-up') stylus = null;
    if (stylus) {
      if (!stylusWas) press(stylus.x, stylus.y, false);
      else moveHeld(stylus.x, stylus.y);
      stylusWas = true;
      return;
    }
    if (stylusWas) {
      stylusWas = false;
      release(false);
      return;
    }
    keys(f);
  };

  return {
    tick(f: InputFrame): Step {
      consumed = false;
      const p = phase;
      if (p.kind === 'finish') {
        consumed = true;
        if (--p.ticks <= 0) return toSelect();
        return;
      }
      if (p.kind === 'test') {
        consumed = true;
        p.run.tick();
        if (p.run.done) {
          phase = { kind: 'edit' };
          message = null;
          stylus = null;
          stylusWas = false;
        }
        return;
      }
      if (p.kind === 'edit') {
        consumed = true;
        editTick(f);
      }
      return;
    },
    resume(): Step {
      return toSelect();
    },
    input(i): Step {
      if (consumed) return;
      const p = phase;
      const b = 'button' in i ? i.button : null;
      const tap = 'tap' in i ? i.tap : null;
      switch (p.kind) {
        case 'select': {
          const n = tap ? tapIndex(tap, 'capsule') : null;
          if (n !== null && n >= 0 && n < SEALS.capsules) {
            cursor = n;
            return openMenu();
          }
          if (b === 'a') return openMenu();
          if (b === 'b' || tap === 'back') {
            se(SE.decide);
            return { close: { app: 'capsule-editor' } };
          }
          if (b) {
            const next = gridMove(cursor, b);
            if (next !== cursor) se(SE.confirm);
            cursor = next;
          }
          return;
        }
        case 'menu': {
          const n = tap ? tapIndex(tap, 'menu') : null;
          if (n !== null && n >= 0 && n < p.entries.length) {
            se(SE.confirm);
            return p.entries[n]!.run();
          }
          if (b === 'up' || b === 'down') {
            const next = moveCursor(p.cursor, p.entries.length, 1, b);
            if (next !== p.cursor) se(SE.confirm);
            p.cursor = next;
          } else if (b === 'a') {
            se(SE.confirm);
            return p.entries[p.cursor]!.run();
          } else if (b === 'b' || tap === 'back') {
            se(SE.confirm);
            return toSelect();
          }
          return;
        }
        case 'shift': {
          const n = tap ? tapIndex(tap, 'capsule') : null;
          if (n !== null && n >= 0 && n < SEALS.capsules) return shiftTo(n);
          if (b === 'a') return shiftTo(p.other);
          if (b === 'b' || tap === 'back') {
            se(SE.decide);
            return toSelect();
          }
          if (b) {
            const next = gridMove(p.other, b);
            if (next !== p.other) se(SE.confirm);
            p.other = next;
          }
          return;
        }
        case 'message':
          // Decomp: any of A, B, X, Y, L, R, START, SELECT or the D-pad goes on (mask 0xCF3).
          if (b || tap === 'next' || tap === 'back') return p.then();
          return;
        case 'ask': {
          let yes: boolean | null = null;
          if (tap === 'yes') yes = true;
          else if (tap === 'no' || tap === 'back' || b === 'b') yes = false;
          else if (b === 'a') yes = p.yes;
          else if (b === 'up' || b === 'down') {
            p.yes = !p.yes;
            se(SE.confirm);
          }
          if (yes === null) return;
          se(SE.confirm);
          if (yes) finish(true);
          else {
            phase = { kind: 'edit' };
            stylus = null;
            stylusWas = false;
          }
          return;
        }
        default:
          return;
      }
    },
    view(): CapsuleEditorView {
      const p = phase;
      const editing = p.kind === 'edit' || p.kind === 'ask' || p.kind === 'test';
      const testing = p.kind === 'test' && p.run.onTop ? p.run : null;
      const screen = testing ? 'test' : editing ? 'edit' : 'select';
      const shown = testing ? [] : editing ? working : [...sealCase().capsules[cursor]!].reverse();
      const ghostAt = held !== null && editing ? held : -1;
      const testMon = testing?.mon;
      return {
        app: 'capsule-editor',
        screen,
        capsules: Array.from({ length: SEALS.capsules }, (_, i) => {
          const h = capsuleHolder(ctx.state.party, i);
          const mon = h >= 0 ? ctx.state.party[h]! : null;
          return { sealed: sealed(i), holder: mon ? { species: mon.species, form: mon.form, egg: mon.isEgg } : null };
        }),
        cursor,
        shift: p.kind === 'shift' ? p.other : null,
        seals: shown.map((s, k) => ({ cell: cellOf(s.seal), x: s.x, y: s.y, ghost: k === ghostAt && !onCapsule(s.x, s.y) })),
        list: editing ? pageIds.map((id) => ({ cell: cellOf(id), count: String(sealCase().counts[id - 1]).padStart(3, ' ') })) : [],
        page: { index: page, count: pages },
        pressed: pressed?.id ?? null,
        buttons: { confirm: t.t('capsuleConfirm'), cancel: t.t('capsuleCancel') },
        hand: editing && hand ? { x: hand.x, y: hand.y, grabbing: held !== null } : null,
        status: editing ? status : null,
        message: p.kind === 'message' ? { text: p.text, waiting: true } : p.kind === 'ask' ? { text: t.t('capsuleQuitAsk'), waiting: false } : message ? { text: message, waiting: false } : null,
        menu: p.kind === 'menu' ? { entries: p.entries.map((e) => ({ label: t.t(e.key) })), cursor: p.cursor } : null,
        yesNo: p.kind === 'ask' ? { yes: t.t('yes'), no: t.t('no'), cursor: p.yes ? 0 : 1 } : null,
        test: testing && testMon ? testing.view({ species: testMon.species, form: testMon.form, female: monGender(dexOf(ctx.registries), testMon) === 'female', shiny: isShiny(testMon.otId, testMon.pid) }) : null,
        dim: p.kind === 'ask' ? ASK_DIM : p.kind === 'test' && !testing ? p.run.dim : 0,
      };
    },
  };
}
