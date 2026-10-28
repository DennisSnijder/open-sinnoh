/**
 * The naming screen (decomp applications/naming_screen.c): the prompt, the entity icon, the entered text
 * and the 13 × 6 keyboard (the home row's page buttons UPPER / lower / Others, BACK and OK, then five
 * rows of keys). A enters a key; B deletes; Select changes the page; Start jumps to OK; a full name moves
 * the cursor to OK. Typing on a physical keyboard (tap `type:<text>`) fills the same buffer. OK with an
 * empty or all-space name keeps the old one (result null).
 * Sounds (naming_screen.c): SE_CONFIRM on each d-pad press and Start, and on BACK when a character goes;
 * SEQ_SE_DP_BOX02 when a character is entered; SEQ_SE_DP_SYU03 on a page change; SEQ_SE_DP_PIRORIRO on OK.
 * The DS also plays SEQ_SE_DP_NAMEIN_01 when its page slide ends; the page changes here at once, without it.
 */
import { ENGLISH, forLanguage, GERMAN, type Button } from '@opensinnoh/core';
import type { AppHost, NamingRequest, NamingView } from '@opensinnoh/contracts';
import { finishName, gameLanguage, keyboardPages, typedChars } from '@opensinnoh/services';
import { menuSe, type MenuContext } from './context.ts';
import { tapIndex, type Screen, type Step } from './stack.ts';
import type { MenuKey } from './strings.ts';

type Input = { button: Button } | { tap: string };
type NamingContext = Pick<MenuContext, 'text' | 'registries' | 'log'> & { host: Pick<AppHost, 'sound'> };

/** Sequence numbers (SDAT): SE_CONFIRM, SEQ_SE_DP_PIRORIRO, SEQ_SE_DP_BOX02, SEQ_SE_DP_SYU03. */
const SE_CONFIRM = 1500;
const SE_OK = 1506;
const SE_KEY = 1515;
const SE_PAGE = 1694;

const COLS = 13;
const ROWS = 5;
/** Home row stops: the three page buttons, BACK, OK. */
const HOME = 5;
const BACK = 3;
const OK = 4;
/** Decomp sHomeRowAll: which home-row button sits over each key column. */
const HOME_OF_COL = [0, 0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4];
const PROMPTS: Record<Exclude<NamingRequest['kind'], 'gift-code'>, MenuKey> = { player: 'namePlayer', rival: 'nameRival', pokemon: 'namePokemon', box: 'nameBox', tablet: 'nameTablet', 'dex-search': 'nameDexSearch' };
/** Mystery Gift's gift code prompt, per game language (our addition: the ROM has no such prompt). */
export const GIFT_CODE_PROMPT: Readonly<Record<number, string>> = { [ENGLISH]: 'Gift code?', [GERMAN]: 'Geschenkcode?' };

/**
 * `autoLowercase` is the OpenSinnoh option (not Platinum's): the first character of an empty name typed on the
 * capitals page moves the keyboard to the lowercase page, once. Never for a gift code (case-insensitive, typed as printed).
 */
export function namingScreen(ctx: NamingContext, request: NamingRequest, done: (name: string | null) => Step, autoLowercase: () => boolean = () => false): Screen {
  const t = ctx.text;
  const language = gameLanguage(ctx.registries);
  const keys = keyboardPages(language);
  let text = request.kind === 'box' ? request.initial : '';
  let page = 0;
  let row = 0;
  let col = 0;
  const se = (n: number) => menuSe(ctx, n);
  const length = () => [...text].length;
  /** Enters a character; false when the name is full. */
  const enter = (c: string): boolean => {
    if (length() >= request.maxLength) return false;
    const first = text === '';
    text += c;
    if (first && page === 0 && request.kind !== 'gift-code' && autoLowercase()) page = 1;
    if (length() >= request.maxLength) [row, col] = [-1, OK];
    return true;
  };
  const del = () => {
    if (!text) return;
    text = [...text].slice(0, -1).join('');
    se(SE_CONFIRM);
  };
  const toPage = (p: number) => {
    if (p === page) return;
    page = p;
    se(SE_PAGE);
  };
  const finish = (): Step => {
    se(SE_OK);
    const name = finishName(text);
    return done(name === request.initial ? null : name);
  };
  const press = (): Step => {
    if (row >= 0) {
      if (enter(keys[page]![row]![col]!)) se(SE_KEY);
      return;
    }
    if (col < 3) toPage(col);
    else if (col === BACK) del();
    else return finish();
    return;
  };
  const move = (b: Button) => {
    if (b === 'left' || b === 'right') {
      const n = row < 0 ? HOME : COLS;
      col = (col + (b === 'left' ? -1 : 1) + n) % n;
      return;
    }
    const next = row + (b === 'up' ? -1 : 1);
    const wrapped = next < -1 ? ROWS - 1 : next >= ROWS ? -1 : next;
    if (row >= 0 && wrapped < 0) col = HOME_OF_COL[col]!;
    else if (row < 0 && wrapped >= 0) col = HOME_OF_COL.indexOf(col);
    row = wrapped;
  };
  const species = request.pokemon ? ctx.registries.species.get(request.pokemon.species) : undefined;
  return {
    view(): NamingView {
      return {
        app: 'naming',
        kind: request.kind,
        prompt: request.kind === 'gift-code' ? forLanguage(language, GIFT_CODE_PROMPT) : t.t(PROMPTS[request.kind], species?.name ?? ''),
        gender: request.gender,
        pokemon: request.pokemon,
        text,
        maxLength: request.maxLength,
        pages: keys.map((p) => p[0]!.slice(0, 3).join('')),
        page,
        keys: keys[page]!.map((r) => [...r]),
        cursor: { row, col },
        back: t.t('nameBack'),
        ok: t.t('nameOk'),
      };
    },
    input(i: Input): Step {
      if ('tap' in i) {
        if (i.tap.startsWith('type:')) {
          let entered = false;
          for (const c of typedChars(i.tap.slice(5), language)) entered = enter(c) || entered;
          if (entered) se(SE_KEY);
          return;
        }
        if (i.tap === 'del' || i.tap === 'back') return void del();
        if (i.tap === 'ok') return finish();
        const p = tapIndex(i.tap, 'page');
        if (p !== null && p >= 0 && p < keys.length) return void toPage(p);
        const m = /^key:(\d):(\d+)$/.exec(i.tap);
        if (m && Number(m[1]) < ROWS && Number(m[2]) < COLS) {
          [row, col] = [Number(m[1]), Number(m[2])];
          return press();
        }
        return;
      }
      const b = i.button;
      if (b === 'up' || b === 'down' || b === 'left' || b === 'right') {
        move(b);
        se(SE_CONFIRM);
      } else if (b === 'a') return press();
      else if (b === 'b') del();
      else if (b === 'select') toPage((page + 1) % keys.length);
      else if (b === 'start') {
        [row, col] = [-1, OK];
        se(SE_CONFIRM);
      }
      return;
    },
  };
}
