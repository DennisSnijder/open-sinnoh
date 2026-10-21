/**
 * The Poffin Case (decomp applications/poffin_case: main.c, manager.c, menus.c, cutscene.c): the list of Poffins
 * (newest first) filtered by flavour, GIVE (the party, the summary's CONDITION in feed mode, the eating scene, the
 * CONDITION's change) and TRASH; CLOSE or B leaves. Feeding is services `feedPoffin`.
 */
import { isShiny, monGender, type Button } from '@opensinnoh/core';
import { dexOf, type Poffin, type PoffinCaseView, type PoffinFeedView } from '@opensinnoh/contracts';
import { poffinLevel, poffinPreference, removePoffin } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { Dialog } from './dialog.ts';
import { monName, partyScreen } from './party.ts';
import { poffinTypeName } from './poffin-cooking.ts';
import { moveCursor, tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';
import { summaryScreen } from './summary.ts';

/** Decomp POFFIN_LIST_VIEW_HEIGHT; FLAVOR_MAX (the ALL filter). */
const VISIBLE = 6;
const ALL = 5;
const FILTERS: MenuKey[] = ['poffinSpicy', 'poffinDry', 'poffinSweet', 'poffinBitter', 'poffinSour', 'poffinAll'];
const RAISES: MenuKey[] = ['poffinRaiseCool', 'poffinRaiseBeauty', 'poffinRaiseCute', 'poffinRaiseSmart', 'poffinRaiseTough'];
/** SE_CONFIRM (the case's every sound) and SEQ_SE_DP_BUTTON9 (a filter button). */
const SE_CONFIRM = 1500;
const SE_BUTTON = 1508;

/**
 * The case; `done` when it closes. After a GIVE the next screens are pushed as each one pops (decomp PoffinCaseApp's
 * states: the party, the feed summary, the eating scene, the change summary, back to the list).
 */
export function poffinCaseScreen(ctx: MenuContext, done: () => Step): Screen {
  const t = ctx.text;
  const dialog = new Dialog(t.t('yes'), t.t('no'), (n) => menuSe(ctx, n));
  let filter = ALL;
  let cursor = 0;
  let top = 0;
  let menu: { cursor: number } | null = null;
  /** The next screen to open when the one above pops (GIVE's chain), or null. */
  let next: (() => Step) | null = null;

  /** PoffinManager_FilterPoffins: the case's Poffins with the filter's flavour, newest first (case indexes). */
  const listed = (): number[] =>
    ctx.state.poffins
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => filter === ALL || p.flavors[filter]! > 0)
      .map(({ i }) => i)
      .reverse();
  const clamp = () => {
    const n = listed().length + 1;
    if (cursor >= n) cursor = n - 1;
    if (top > Math.max(0, n - VISIBLE)) top = Math.max(0, n - VISIBLE);
    if (cursor < top) top = cursor;
    if (cursor >= top + VISIBLE) top = cursor - VISIBLE + 1;
  };
  const name = (p: Poffin) => t.message(poffinTypeName(p.type));
  const selected = (): number | null => listed()[cursor] ?? null;

  const give = (index: number): Step => {
    menu = null;
    const poffin = ctx.state.poffins[index]!;
    return {
      push: partyScreen(ctx, {
        kind: 'feed',
        pick: (slot) => {
          if (slot !== null) next = () => feedSummary(index, poffin, slot);
          return 'pop';
        },
      }),
    };
  };
  /** State_InitPokemonSummary: CONDITION in feed mode; OK eats (the Poffin leaves the case), B or a full sheen go back. */
  const feedSummary = (index: number, poffin: Poffin, slot: number): Step => ({
    push: summaryScreen(ctx, {
      party: () => ctx.state.party,
      slot,
      mode: {
        kind: 'feed',
        done: (pick) => {
          if (pick !== null) {
            removePoffin(ctx.state, index);
            clamp();
            next = () => ({ push: feedScene(ctx, pick, poffin, () => ((next = () => changeSummary(pick, poffin)), 'pop')) });
          }
          return 'pop';
        },
      },
    }),
  });
  /** State_InitSummaryAfterGiving: CONDITION shows what the Poffin changed. */
  const changeSummary = (slot: number, poffin: Poffin): Step => ({
    push: summaryScreen(ctx, { party: () => ctx.state.party, slot, mode: { kind: 'condition-change', poffin, done: () => 'pop' } }),
  });

  const trash = (index: number): Step => {
    menu = null;
    const p = ctx.state.poffins[index]!;
    return dialog.confirm(t.pages('poffinDiscard', name(p)), (yes) => {
      if (!yes) return void (menu = { cursor: 0 });
      removePoffin(ctx.state, index);
      clamp();
      return dialog.say(t.pages('poffinThrownOut', name(p)));
    });
  };
  const close = (): Step => {
    menuSe(ctx, SE_CONFIRM);
    return done();
  };
  const pick = (): Step => {
    menuSe(ctx, SE_CONFIRM);
    if (selected() === null) return done();
    menu = { cursor: 0 };
    return;
  };
  const runMenu = (n: number): Step => {
    menuSe(ctx, SE_CONFIRM);
    const index = selected()!;
    if (n === 0) return give(index);
    if (n === 1) return trash(index);
    menu = null;
    return;
  };
  /** PoffinManager_UpdatePoffinFilter: the list starts over at the top. */
  const setFilter = (f: number) => {
    menuSe(ctx, SE_BUTTON);
    filter = f;
    cursor = 0;
    top = 0;
  };
  const moveList = (b: Button) => {
    const n = listed().length + 1;
    const before = cursor;
    if (b === 'up') cursor = Math.max(0, cursor - 1);
    else if (b === 'down') cursor = Math.min(n - 1, cursor + 1);
    // PAGER_MODE_LEFT_RIGHT_PAD: left and right page by the view's height.
    else if (b === 'left') cursor = Math.max(0, cursor - VISIBLE);
    else if (b === 'right') cursor = Math.min(n - 1, cursor + VISIBLE);
    if (cursor !== before) menuSe(ctx, SE_CONFIRM);
    clamp();
  };

  return {
    resume(): Step {
      const open = next;
      next = null;
      clamp();
      return open?.();
    },
    view(): PoffinCaseView {
      clamp();
      const rows = listed().map((i) => {
        const p = ctx.state.poffins[i]!;
        return { name: name(p), level: String(poffinLevel(p)).padStart(2, '0'), type: p.type };
      });
      const sel = selected();
      const p = sel === null ? null : ctx.state.poffins[sel]!;
      return {
        app: 'poffin-case',
        title: t.t('poffinCaseTitle'),
        rows,
        close: t.t('poffinClose'),
        cursor,
        top,
        visible: VISIBLE,
        selected: p ? { type: p.type, smooth: t.t('poffinSmooth', String(Math.min(99, p.smoothness))), flavors: p.flavors.map((f) => f > 0) } : null,
        filters: FILTERS.map((k) => t.t(k)),
        filter,
        filterText: filter === ALL ? null : t.t(RAISES[filter]!),
        menu: menu ? { entries: [t.t('poffinGive'), t.t('poffinTrash'), t.t('poffinBack')].map((label) => ({ label })), cursor: menu.cursor } : null,
        message: dialog.message(),
        yesNo: dialog.yesNo(),
      };
    },
    input(i): Step {
      if (dialog.active) return dialog.input(i);
      if (menu) {
        const m = menu;
        if ('tap' in i) {
          if (i.tap === 'back') return void ((menu = null), menuSe(ctx, SE_CONFIRM));
          const n = tapIndex(i.tap, 'menu');
          return n !== null && n >= 0 && n < 3 ? runMenu(n) : undefined;
        }
        if (i.button === 'up' || i.button === 'down') m.cursor = moveCursor(m.cursor, 3, 1, i.button);
        else if (i.button === 'a') return runMenu(m.cursor);
        else if (i.button === 'b') {
          menu = null;
          menuSe(ctx, SE_CONFIRM);
        }
        return;
      }
      if ('tap' in i) {
        if (i.tap === 'close' || i.tap === 'back') return close();
        if (i.tap === 'up' || i.tap === 'down') return void moveList(i.tap);
        const f = tapIndex(i.tap, 'filter');
        if (f !== null && f >= 0 && f <= ALL) return void setFilter(f);
        const r = tapIndex(i.tap, 'row');
        if (r === null || r < 0 || r >= listed().length) return;
        cursor = r;
        clamp();
        return pick();
      }
      const b = i.button;
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') moveList(b);
      else if (b === 'a') return pick();
      else if (b === 'b') return close();
      return;
    },
  };
}

/** Decomp cutscene.c: 24 frames for the Poffin's throw and the Pokémon's approach (and 5 more), 8 for its return (and 5). */
const THROW = 24;
const SETTLE = 5;
const RETURN = 8;
/** The message closes by itself after 90 frames (WaitForMessageClose). */
const MESSAGE_FRAMES = 90;

/**
 * The eating scene (decomp poffin_case/cutscene.c): the Poffin flies in an arc from below to the middle and shrinks
 * (1 to 0.5) as the Pokémon comes closer (to (128, 112) at 1.5, hopping); its cry (pinched when it dislikes the
 * Poffin); it goes back; the message.
 */
export function feedScene(ctx: MenuContext, slot: number, poffin: Poffin, done: () => Step): Screen {
  const t = ctx.text;
  const dex = dexOf(ctx.registries);
  const mon = ctx.state.party[slot]!;
  const pref = poffinPreference(poffin, dex.nature(mon.pid));
  let frame = 0;
  let phase: 'throw' | 'cry' | 'return' | 'message' = 'throw';
  let messageFrame = 0;
  const text = () => t.message(pref === 'like' ? 'PoffinCutscene_Text_LikedPoffin' : pref === 'dislike' ? 'PoffinCutscene_Text_DislikedPoffin' : 'PoffinCutscene_Text_NeutralToPoffin', monName(ctx, mon));
  return {
    tick(f): Step {
      frame++;
      if (phase === 'throw' && frame >= THROW + SETTLE) {
        phase = 'cry';
        frame = 0;
        ctx.host.sound?.playCry(mon.species, mon.form, pref === 'dislike' ? 'pinch' : 'normal');
      } else if (phase === 'cry' && !(ctx.host.sound?.cryPlaying() ?? false)) {
        phase = 'return';
        frame = 0;
      } else if (phase === 'return' && frame >= RETURN + SETTLE) {
        phase = 'message';
        frame = 0;
      } else if (phase === 'message') {
        const press = f.pressed.includes('a') || f.pressed.includes('b') || f.tap === 'next';
        if (press || ++messageFrame > MESSAGE_FRAMES) return done();
      }
      return;
    },
    view(): PoffinFeedView {
      const female = monGender(dex, mon) === 'female';
      const at = (t2: number, n: number) => Math.min(t2, n) / n;
      let monY = 96;
      let scale = 4096;
      let poffinView: PoffinFeedView['poffin'] = null;
      if (phase === 'throw') {
        const k = at(frame, THROW);
        poffinView = frame < THROW ? { type: poffin.type, x: 128, y: Math.round(224 - 128 * k + Math.sin(k * Math.PI) * -64), scale: Math.round(4096 - 2048 * k) } : null;
        const hop = frame < THROW ? -(((frame % 9) - 4) ** 2) + 16 : 0;
        monY = 96 + 16 * k - hop * 1.4;
        scale = Math.round(4096 + 2048 * k);
      } else if (phase === 'cry') {
        monY = 112;
        scale = 6144;
      } else if (phase === 'return') {
        const k = at(frame, RETURN);
        monY = 112 - 16 * k + Math.sin(k * Math.PI) * -6;
        scale = Math.round(6144 - 2048 * k);
      }
      return {
        app: 'poffin-feed',
        tick: frame,
        mon: { species: mon.species, form: mon.form, shiny: isShiny(mon.otId, mon.pid), female, x: 128, y: Math.round(monY), scale },
        poffin: poffinView,
        message: phase === 'message' ? { text: text(), waiting: true } : null,
      };
    },
    input(): Step {
      return;
    },
  };
}
