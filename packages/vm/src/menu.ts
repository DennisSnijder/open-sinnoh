/**
 * Scripted multichoice and list menus (decomp overlay005/field_menu.c FieldMenuManager, menu.c Menu,
 * list_menu.c ListMenu; behaviour only). The VM owns the box; the app draws `MenuView` and maps taps.
 *
 * - Anchors are in tiles (8 px). The window is as wide as the widest entry + 12 px (cursor margin), rounded
 *   up to whole tiles; each row is 16 px. Right/bottom anchoring moves the anchor left/up by the window size.
 * - Input starts 3 ticks after the menu opens (sysTaskDelay). A picks the entry's index value, B cancels
 *   (MENU_CANCEL) when allowed, otherwise B does nothing.
 * - Single-column menus wrap around with 4 or more entries; multi-column menus never wrap and are
 *   column-major. List menus show at most 8 rows, scroll with the cursor and page with left/right.
 */
import { hitMenu, MENU_TEXT_X, type InputFrame, type MenuView } from '@opensinnoh/contracts';

/** Values written to the menu's result var (decomp list_menu.h, constants/menu.h as u16). */
export const MENU_RESULT = { pending: 0xeeee, cancel: 0xfffe, header: 0xfffd } as const;
/** Entry index that marks a list header (decomp LIST_MENU_BUILDER_HEADER); headers cannot be selected. */
export const LIST_HEADER = 0xfa;
/** Alt-text id meaning "none" (decomp LIST_MENU_ENTRY_NO_ALT_TEXT). */
export const NO_ALT_TEXT = 0xff;
export const LIST_MAX_ROWS = 8;
const LOOP_MIN_ENTRIES = 4;
const INPUT_DELAY_TICKS = 3;
const TILE = 8;
const ROW_TILES = 2;

export interface MenuEntry {
  text: string;
  /** Value written to the result var when picked (MENU_RESULT.header for list headers). */
  index: number;
  /** List menus: message shown in the message box while the cursor is on this entry. */
  altText?: number;
}

export type MenuKind = 'single' | 'multi' | 'list';

export class ScriptMenu {
  readonly entries: MenuEntry[] = [];
  anchorRight = false;
  anchorBottom = false;
  private kind: MenuKind = 'single';
  private columns = 1;
  private cursor: number;
  private top = 0;
  private delay = INPUT_DELAY_TICKS;
  private geometry: { x: number; y: number; width: number; rows: number } | null = null;
  /** FieldMenuManager_ShowListMenuWithCursorPosition: the list starts at a remembered offset and cursor row. */
  private remembered = false;

  constructor(
    private readonly anchor: { x: number; y: number },
    initialCursor: number,
    readonly canCancel: boolean,
    /** Text bank of the entries (pl_msg number). */
    readonly bank: number,
  ) {
    this.cursor = initialCursor;
  }

  add(entry: MenuEntry): void {
    if (this.geometry) throw new Error('menu: entry added after the menu was shown');
    this.entries.push(entry);
  }

  /**
   * Decomp FieldMenuManager_ShowListMenuWithCursorPosition: the list opens scrolled to `offset` with the cursor on row
   * `row` of the window (ListMenu_New(…, listOffset, cursorPos)); the anchors are not moved by the right/bottom sides.
   */
  remember(offset: number, row: number): void {
    this.top = offset;
    this.cursor = offset + row;
    this.remembered = true;
  }

  /** The list's scroll offset and the cursor's row in the window (what ListMenuCursorCallback writes back). */
  listPosition(): { offset: number; row: number } {
    return { offset: this.top, row: this.cursor - this.top };
  }

  /**
   * Lays the window out (decomp FieldMenuManager_Show*). `measure` = text width in px. `width` (tiles) is
   * FieldMenuManager_ShowListMenuWithWidth's: the given width, and the anchors are not applied.
   */
  show(kind: MenuKind, measure: (s: string) => number, columns = 1, width?: number): void {
    if (!this.entries.length) throw new Error('menu: shown with no entries');
    if (columns < 1) throw new Error(`menu: ${columns} columns`);
    this.kind = kind;
    this.columns = kind === 'multi' ? columns : 1;
    if (width !== undefined && (kind !== 'list' || width < 1)) throw new Error(`menu: a set width ${width} on a ${kind} menu`);
    const widthTiles = width ?? Math.ceil((Math.max(...this.entries.map((e) => measure(e.text))) + MENU_TEXT_X) / TILE);
    const rows = kind === 'list' ? Math.min(this.entries.length, LIST_MAX_ROWS) : Math.ceil(this.entries.length / this.columns);
    let x = this.anchor.x;
    let y = this.anchor.y;
    // Multi-column menus ignore the right/bottom anchors (decomp FieldMenuManager_ShowMultiColumnMenu).
    if (kind !== 'multi' && !this.remembered && width === undefined) {
      if (this.anchorRight) x -= widthTiles;
      if (this.anchorBottom) y -= rows * ROW_TILES;
    }
    this.geometry = { x: x * TILE, y: y * TILE, width: widthTiles * TILE, rows };
    if (this.cursor >= this.entries.length) throw new Error(`menu: initial cursor ${this.cursor} past ${this.entries.length} entries`);
    this.scrollToCursor();
  }

  get shown(): boolean {
    return this.geometry !== null;
  }

  get current(): MenuEntry {
    return this.entries[this.cursor]!;
  }

  view(): MenuView {
    const g = this.geometry;
    if (!g) throw new Error('menu: not shown');
    return { entries: this.entries.map((e) => e.text), cursor: this.cursor, columns: this.columns, rows: g.rows, top: this.top, x: g.x, y: g.y, width: g.width };
  }

  /**
   * One tick of input. Returns the result to write (an entry's index or MENU_RESULT.cancel), or null while
   * nothing is chosen. `freshTouch` is a main-screen tap that started this tick.
   */
  step(input: InputFrame, freshTouch: { x: number; y: number } | null): number | null {
    if (this.delay > 0) {
      this.delay--;
      return null;
    }
    const pressed = (b: InputFrame['pressed'][number]) => input.pressed.includes(b);
    if (freshTouch) {
      const i = hitMenu(this.view(), freshTouch);
      if (i >= 0 && this.entries[i]!.index !== MENU_RESULT.header) {
        this.cursor = i;
        return this.entries[i]!.index;
      }
    }
    if (pressed('a')) return this.current.index;
    if (pressed('b')) return this.canCancel ? MENU_RESULT.cancel : null;
    if (this.kind === 'list') {
      if (pressed('up')) this.moveList(-1);
      else if (pressed('down')) this.moveList(1);
      else if (pressed('left')) this.moveList(-LIST_MAX_ROWS);
      else if (pressed('right')) this.moveList(LIST_MAX_ROWS);
      return null;
    }
    const dir = (['up', 'down', 'left', 'right'] as const).find((b) => pressed(b));
    if (dir) this.moveGrid(dir);
    return null;
  }

  /** Decomp menu.c TryMovingCursor (column-major grid, ySize = rows). */
  private moveGrid(dir: 'up' | 'down' | 'left' | 'right'): void {
    const rows = this.geometry!.rows;
    const cols = this.columns;
    const loop = this.kind === 'single' && this.entries.length >= LOOP_MIN_ENTRIES;
    const c = this.cursor;
    let next: number;
    if (dir === 'up' || dir === 'down') {
      if (rows <= 1) return;
      if (dir === 'up') next = c % rows === 0 ? (loop ? c + rows - 1 : -1) : c - 1;
      else next = c % rows === rows - 1 ? (loop ? c - (rows - 1) : -1) : c + 1;
    } else {
      if (cols <= 1) return;
      if (dir === 'left') next = c < rows ? (loop ? c + rows * (cols - 1) : -1) : c - rows;
      else next = c >= rows * (cols - 1) ? (loop ? c % rows : -1) : c + rows;
    }
    // A slot past the last entry (uneven columns) holds no choice.
    if (next < 0 || next >= this.entries.length || this.entries[next]!.index === MENU_RESULT.header) return;
    this.cursor = next;
  }

  private moveList(delta: number): void {
    let next = Math.max(0, Math.min(this.entries.length - 1, this.cursor + delta));
    const step = delta < 0 ? -1 : 1;
    while (next >= 0 && next < this.entries.length && this.entries[next]!.index === MENU_RESULT.header) next += step;
    if (next < 0 || next >= this.entries.length) return;
    this.cursor = next;
    this.scrollToCursor();
  }

  private scrollToCursor(): void {
    if (this.kind !== 'list') return;
    const rows = this.geometry!.rows;
    if (this.cursor < this.top) this.top = this.cursor;
    else if (this.cursor >= this.top + rows) this.top = this.cursor - rows + 1;
  }
}
