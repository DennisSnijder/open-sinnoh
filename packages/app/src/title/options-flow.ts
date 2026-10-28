/**
 * OPTIONS from the title: the same screen the game's start menu opens (ui/options-screen.ts), over the same
 * headless model (packages/menus `createOptions`, here on the device's options since no game state is open) and
 * the same DOM structure as the in-game layer (`.ui-layer > .ui-host > .ui-frame.ui-os`). Keys and
 * the pad drive it through the title's input; taps send `settings:` ids. Closing (B, CLOSE) calls `close`.
 */
import type { AppHost, AppModel, AssetSource, InputFrame, OptionsView, Registries, StubLog } from '@opensinnoh/contracts';
import { createOptions } from '@opensinnoh/menus';
import { snapPixels } from '@opensinnoh/ui';
import { uiScales } from '../layout.ts';
import type { DrawContext } from '../ui/apps.ts';
import { Art } from '../ui/art.ts';
import { scrollToCursor } from '../ui/focus.ts';
import { OptionsScreen } from '../ui/options-screen.ts';
import type { PixelFont } from '../ui/pixel-font.ts';
import type { AppSettings } from '../ui/settings.ts';
import { S } from '../strings/index.ts';
import '../ui/ui.css';
import '../ui/apps.css';

export interface OptionsFlowDeps {
  registries: Registries;
  assets: AssetSource;
  font: PixelFont;
  /** The device's options (text speed and the modern options apply here; the saved ones are listed muted). */
  host: Pick<AppHost, 'options' | 'setOption'>;
  log: StubLog;
  /** The app's settings and data actions (the same the game's OPTIONS shows). */
  settings(): AppSettings;
  /** A tap on the screen for the next frame. */
  tap(id: string): void;
  /** Leaves the screen. */
  close(): void;
}

export class OptionsFlow {
  readonly root: HTMLElement;
  private readonly model: AppModel;
  private readonly screen: OptionsScreen;
  private readonly art: Art;
  private drawn: string | null = null;

  constructor(private readonly deps: OptionsFlowDeps) {
    this.root = document.createElement('div');
    this.root.className = 'ui-layer tm-options-flow';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', S.title.options);
    this.model = createOptions(deps.registries, deps.host, deps.log);
    // The title's keys are the DS's own: BUTTON MODE belongs to a game's save.
    this.screen = new OptionsScreen({ where: 'title', settings: deps.settings, tap: deps.tap, buttonMode: () => 0 });
    this.art = new Art(() => deps.assets, () => deps.registries);
    this.draw();
  }

  /** One 30 Hz tick. */
  tick(frame: InputFrame): void {
    const view = this.model.view() as OptionsView;
    if (this.model.step(this.screen.input(frame, view))) return this.deps.close();
    this.draw();
  }

  private draw(): void {
    const view = this.model.view() as OptionsView;
    // The title's box (the game area, clear of the touch controls), not the window; the window's until it is on the page.
    const box = { width: this.root.parentElement?.clientWidth || innerWidth, height: this.root.parentElement?.clientHeight || innerHeight };
    const { unit, dot, compact } = uiScales(box.width, box.height, devicePixelRatio || 1, box.height > box.width);
    const key = `${box.width}x${box.height}|${unit}|${dot}|${compact}|${this.screen.key(view)}|${JSON.stringify(view)}`;
    if (key === this.drawn) return;
    const first = this.drawn === null;
    this.drawn = key;
    const font = this.deps.font;
    this.root.dataset.mode = compact ? 'compact' : 'wide';
    this.root.style.setProperty('--dot', `${dot}px`);
    this.root.style.setProperty('--unit', `${unit}px`);
    const d: DrawContext = {
      text: (s, palette = 'ink', className, k = dot) => font.label(s, palette, k, className),
      flow: (s, lines, palette = 'ink', k = dot) => font.flow(s, palette, k, lines),
      measure: (s) => font.measure(s),
      tap: (id) => this.deps.tap(id),
      art: this.art,
      registries: this.deps.registries,
      frame: 0,
      scale: dot,
      unit,
      compact,
      options: this.screen,
      size: box,
    };
    const screen = this.screen.draw(d, view);
    screen.dataset.screen = 'options';
    screen.classList.add('ui-screen');
    screen.tabIndex = -1;
    const scrim = document.createElement('div');
    scrim.className = 'ui-scrim';
    const frame = document.createElement('div');
    // The window opens once (the system's animation), not on every redraw.
    frame.className = `ui-frame ui-os${first ? ' ui-enter' : ''}`;
    frame.append(screen);
    const host = document.createElement('div');
    host.className = 'ui-host';
    host.append(scrim, frame);
    this.root.replaceChildren(host);
    snapPixels(screen);
    scrollToCursor(screen);
  }
}
