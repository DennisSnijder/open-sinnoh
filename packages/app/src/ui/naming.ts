/**
 * The naming keyboard as one DS screen (a board at the UI unit): the naming screen's striped background with
 * its entry box (the icon, the prompt and the entry), the page row with BACK and OK, and the key panel of the
 * current page, its keys on the keyboard window's 16 × 19 cells. Phones show the whole screen at the width's unit
 * (never cropped through its windows). Physical typing goes through a hidden text field.
 */
import type { NamingView } from '@opensinnoh/contracts';
import { ICON_ANIM } from './art.ts';
import { stop, type DrawContext } from './apps.ts';
import { at, board, boardContext, DS_HEIGHT, DS_WIDTH } from './board.ts';
import { el } from './core.ts';
import { animCell, sprite } from './sprites.ts';
import { S } from '../strings/index.ts';

/** The entry box of naming/bg (its interior) and what goes in it. */
const ICON = { x: 20, y: 8, size: 32 };
/** The icon OBJ's position (NamingScreen_InitIconSprite). */
const SPRITE = { x: 24, y: 8 };
const PROMPT = { x: 60, y: 6 };
const ENTRY = { x: 60, y: 24, cell: 12 };
/** The page row: ABC, abc, ,.: then BACK and OK (DS px). */
const PAGE_ROW = { y: 52, height: 20, buttons: [[12, 44], [58, 44], [104, 44], [150, 46], [198, 46]] as const };
/**
 * The key panel (naming/keys_N, 256 × 112) where its BG sits (NamingScreen_InitializeCharsPosition: offset −11, −80;
 * its last 11 columns, past the screen, are clear), and the keyboard window on it (NamingScreen_InitWindows: tiles
 * (2, 1)) whose 13 × 5 cells are 16 × 19 px (NamingScreen_InitializeCharsGraphics). A key's glyph is centred in its
 * cell's width, rounded down, and printed 4 px down (NamingScreen_PrintChars).
 */
const PANEL = { x: 11, y: 80, height: 112, keysX: 16, keysY: 8, keyW: 16, keyH: 19, glyphY: 4 };

export function naming(outer: DrawContext, v: NamingView): HTMLElement {
  const d = boardContext(outer);

  const screen = board(`naming-board naming-sheet naming-${v.kind}`, DS_WIDTH, DS_HEIGHT);
  if (d.art.picture(screen, 'naming/bg')) screen.dataset.backdrop = 'naming/bg';

  // The player's, the rival's and the tablet's icons are the screen's own OBJ (decomp NamingScreen_InitIconSprite: the
  // boy 48, the girl 49, Barry 51, the Shaymin tablet 55; its first frame, at (24, 8)); packs without it (the fixture) get stand-ins.
  const person = v.kind === 'rival' ? 51 : v.kind === 'player' ? (v.gender === 'female' ? 49 : 48) : v.kind === 'tablet' ? 55 : null;
  const cell = person === null ? null : animCell(d, 'naming/sprites', person);
  if (cell !== null) screen.append(sprite(d, 'naming/sprites', cell, SPRITE.x, SPRITE.y, `naming-icon naming-icon-${v.kind}`)!);
  else {
    const icon =
      v.pokemon ? d.art.pokemonIcon(v.pokemon.species, v.pokemon.form, ICON_ANIM.hpMax, false)
      : v.kind === 'box' ? el('span', 'naming-box-icon')
      : v.kind === 'rival' ? el('span', 'card-portrait rival')
      : (d.art.picture(el('span', 'naming-portrait'), `trainer_case/portrait_${v.gender}`) ?? el('span', `card-portrait ${v.gender}`));
    screen.append(at(el('span', `naming-icon naming-icon-${v.kind}`, icon), ICON.x, ICON.y, ICON.size, ICON.size));
  }
  screen.append(at(el('div', 'naming-prompt', d.text(v.prompt)), PROMPT.x, PROMPT.y));
  // The entry: the typed characters, then an underscore per free slot (decomp the text cursors).
  const chars = [...v.text];
  const entry = at(el('div', 'naming-entry'), ENTRY.x, ENTRY.y);
  for (let i = 0; i < v.maxLength; i++) entry.append(el('span', `naming-cell${i === chars.length ? ' next' : ''}`, d.text(chars[i] ?? ' ')));
  // A real text field takes physical typing (it is visually hidden; the pixel entry shows its text).
  const input = el('input', 'naming-input sr-only');
  Object.assign(input, { value: v.text, maxLength: v.maxLength, autocomplete: 'off', spellcheck: false });
  input.setAttribute('aria-label', v.prompt);
  input.dataset.typing = '';
  screen.append(entry, input);

  const home = (i: number, node: HTMLElement) => {
    const [bx, bw] = PAGE_ROW.buttons[i]!;
    return at(node, bx, PAGE_ROW.y, bw, PAGE_ROW.height);
  };
  v.pages.forEach((p, i) => screen.append(home(i, stop(d, `page:${i}`, [d.text(p, i === v.page ? 'light' : 'ink')], `naming-page${i === v.page ? ' on' : ''}`, v.cursor.row === -1 && v.cursor.col === i))));
  screen.append(
    home(3, stop(d, 'del', [d.text(v.back)], 'naming-back', v.cursor.row === -1 && v.cursor.col === 3)),
    home(4, stop(d, 'ok', [d.text(v.ok, 'light')], 'naming-ok', v.cursor.row === -1 && v.cursor.col === 4)),
  );

  const keys = at(el('div', `naming-keys page-${v.page}`), PANEL.x, PANEL.y, DS_WIDTH - PANEL.x, PANEL.height);
  // The backdrop's colours are the screen's as seen, the keys over the stripes (the panel's last row is clear, so
  // the stripes are the bottom edge); its split is the panel's top.
  if (d.art.picture(keys, `naming/keys_${v.page}`) && screen.dataset.backdrop) {
    screen.dataset.backdrop = `naming/bg naming/keys_${v.page}@${PANEL.y}`;
    keys.dataset.backdropSplit = '';
  }
  const ink = d.art.sheet(`naming/keys_${v.page}`)?.textColors?.[0];
  const glyph = (c: string) => {
    const g = d.text(c, ink ? [ink.fg, ink.shadow] : 'ink', 'px naming-glyph');
    g.style.setProperty('--glyph-x', String(Math.floor((PANEL.keyW - d.measure(c)) / 2)));
    g.style.setProperty('--glyph-y', String(PANEL.glyphY));
    return g;
  };
  v.keys.forEach((row, r) =>
    row.forEach((c, k) => {
      const key = at(stop(d, `key:${r}:${k}`, c === ' ' ? [] : [glyph(c)], `naming-key${c === ' ' ? ' space' : ''}`, v.cursor.row === r && v.cursor.col === k), PANEL.keysX + k * PANEL.keyW, PANEL.keysY + r * PANEL.keyH, PANEL.keyW, PANEL.keyH);
      key.setAttribute('aria-label', c === ' ' ? S.aria.space : c);
      keys.append(key);
    }),
  );
  screen.append(keys);
  return screen;
}
