/**
 * In-game UI: draws the open menu app's `AppView` (the models live in packages/menus and run in
 * the game, so replays drive them headless), the HUD buttons and the Pokétch card. See docs/ui/design.md.
 * The game view calls `input` once per tick before stepping the game (the Pokétch and Pokédex wheel sample frames),
 * `layout` on resize and `frame` once per rendered frame.
 */
import type { Button } from '@opensinnoh/core';
import type { AppView, AssetSource, InputFrame, LoadedFont } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';
import type { Layout } from '../layout.ts';
import { controls } from '../input.ts';
import { drawApp, type DrawContext } from './apps.ts';
import { dexInput } from './dex.ts';
import { Art } from './art.ts';
import { el } from './core.ts';
import { focusKey, focusTarget, isolatePrompt, menuKey, restoreMenuFocus, scrollToCursor } from './focus.ts';
import { widenRowHits } from './hits.ts';
import { snapPixels } from '@opensinnoh/ui';
import { icon } from './icons.ts';
import { PixelFont } from './pixel-font.ts';
import { OptionsScreen } from './options-screen.ts';
import { PoketchCard } from './poketch.ts';
import type { AppSettings } from './settings.ts';
import { UiStrings } from './strings.ts';
import { Announcer, announceFrame, liveRegion } from './announce.ts';
import './ui.css';
import './apps.css';
import './apps-m3a.css';
import './naming.css';
import { S } from '../strings/index.ts';

export interface UiDeps {
  /** The #game element; the UI adds its own layer. */
  root: HTMLElement;
  game(): Game;
  font(): LoadedFont;
  assets(): AssetSource;
  /** A button press for one tick (the HUD's menu button is X; Escape is B). */
  pulse(button: Button): void;
  /** A tap on the open app (InputFrame.tap). */
  tap(id: string): void;
  /** The field's tile under a page point (the renderer's `tileAt`), or null. */
  fieldTile?(clientX: number, clientY: number): { x: number; z: number } | null;
  /** The device's message box frame option (0–19). */
  frame(): number;
  /** The app's own settings (volume, zoom, fast-forward speed, error reports, the data actions), shown in OPTIONS. */
  settings(): AppSettings;
  /** Fast-forward on and off (the HUD button on touch screens); null in replay mode. */
  fastForward: { toggle(): void; active(): boolean } | null;
  /** Page fullscreen (the HUD button), where the browser has it and the app is not installed; null otherwise. */
  fullscreen: { toggle(): void; active(): boolean } | null;
  /** Replay/test mode: the Pokétch clock is frozen so screenshots are stable. */
  replay: boolean;
}

export interface InGameUi {
  /**
   * One tick of input: the frame the game steps with. While the Pokétch card is shown its touches join the
   * frame (as panel touches), L/R become its side button and touch mode (Y) takes the d-pad and A.
   */
  input(frame: InputFrame): InputFrame;
  layout(layout: Layout): void;
  /** Per rendered frame: the open app's view, HUD state and the Pokétch redraw. */
  frame(): void;
  /** Opens the start menu (X for one tick) when the field takes it. */
  openStartMenu(): void;
  togglePoketch(): boolean;
  /** Shows a short player-facing notice (a failed save write). */
  notice(message: string): void;
  /** Shows a brief neutral note (the zoom after a shortcut); a newer one replaces it. */
  toast(message: string): void;
  /**
   * `fractionalFits`: views drawn at a fractional scale because no whole-device-pixel scale fitted (each logged
   * once per app). It stays 0 in every supported viewport; the fit spec checks it.
   */
  readonly state: { readonly menu: string | null; readonly poketch: boolean; readonly fractionalFits: number };
}


/** A script or one of its boxes owns the screen: menus are unavailable (not just mid-step). */
export function scriptBusy(game: Game): boolean {
  const v = game.scripts.view();
  return game.scripts.running() || v.panel.kind !== 'idle' || !!v.message || !!v.yesNo || !!v.menu;
}

/** The field accepts the Pokétch now: no script, no app, the world between steps. */
export function fieldIdle(game: Game): boolean {
  return game.canSave() && !scriptBusy(game);
}

/** The margin around a sheet on wide screens (CSS px). */
const SHEET_MARGIN = 16;

/** Keys that steer the on-screen keyboard while the naming screen's text field has focus. */
const TYPING_KEYS: Readonly<Record<string, Button>> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * The naming screen takes physical typing: its hidden text field holds focus on devices
 * with a fine pointer (no soft keyboard popping up on phones), characters become `type:<text>` taps,
 * Backspace deletes and Enter is OK; arrows still move the on-screen cursor.
 */
export function wireTyping(input: HTMLInputElement, deps: Pick<UiDeps, 'tap' | 'pulse'>): void {
  input.addEventListener('beforeinput', (e) => {
    e.preventDefault();
    if (e.inputType.startsWith('insert') && e.data) deps.tap(`type:${e.data}`);
  });
  input.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const dir = TYPING_KEYS[e.key];
    if (e.key === 'Backspace') deps.tap('del');
    else if (e.key === 'Enter') deps.tap('ok');
    else if (dir) deps.pulse(dir);
    else return;
    e.preventDefault();
  });
  if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
}

export function mountUi(deps: UiDeps): InGameUi {
  const layer = el('div', 'ui-layer');
  const host = el('div', 'ui-host');
  host.hidden = true;
  let scale = 2;
  let unit = 3;
  let size = { width: 0, height: 0 };
  let followCursor = false;
  let focusedSetting: string | null = null;
  let returnFocus: HTMLElement | null = null;
  const menuFocus = new Map<string, string | null>();
  const background = [...deps.root.children].filter((e): e is HTMLElement => e instanceof HTMLElement && !e.matches('.controls'));
  /** The part of the view menu screens use (Layout.room): the view less the landscape controls' columns and the portrait HUD row. */
  let roomInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  const stringsCache = new WeakMap<Game, UiStrings>();
  const fontCache = new WeakMap<LoadedFont, PixelFont>();
  const strings = () => {
    const game = deps.game();
    let s = stringsCache.get(game);
    if (!s) stringsCache.set(game, (s = new UiStrings(game.registries, [...game.registries.newGame.keys()][0]!.split(':')[0]!)));
    return s;
  };
  const font = () => {
    const f = deps.font();
    let p = fontCache.get(f);
    if (!p) fontCache.set(f, (p = new PixelFont(f)));
    return p;
  };
  const art = new Art(deps.assets, () => deps.game().registries);
  const options = new OptionsScreen({ where: 'game', settings: deps.settings, tap: deps.tap, buttonMode: () => deps.game().state.options.buttonMode });
  const poketch = new PoketchCard({ game: deps.game, strings, font, art, close: () => poketch.show(false) });
  /** Screen readers: the canvas-drawn message pages and cursor rows, as text (announce.ts). */
  const live = liveRegion();
  const announcer = new Announcer(live.say);

  const hudButton = (name: 'watch' | 'menu' | 'fast' | 'fullscreen', label: string, onClick: () => void) => {
    const b = el('button', `hud-button hud-${name}`, icon(name));
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  };
  const watchButton = hudButton('watch', S.aria.hud.watch, () => api.togglePoketch());
  const menuButton = hudButton('menu', S.aria.hud.menu, () => api.openStartMenu());
  // Fast-forward on touch screens (keyboards and pads hold Tab or the trigger): a toggle, usable mid-event.
  const fastButton = hudButton('fast', S.aria.hud.fast, () => deps.fastForward!.toggle());
  fastButton.hidden = true;
  const fullscreenButton = hudButton('fullscreen', S.aria.hud.fullscreen, () => deps.fullscreen!.toggle());
  fullscreenButton.hidden = !deps.fullscreen;
  fullscreenButton.setAttribute('aria-pressed', 'false');
  document.addEventListener('fullscreenchange', () => fullscreenButton.setAttribute('aria-pressed', String(!!deps.fullscreen?.active())));
  const notices = el('div', 'ui-notices');
  notices.setAttribute('role', 'alert');
  const hud = el('div', 'ui-hud', fastButton, fullscreenButton, watchButton, menuButton);
  const toast = el('p', 'ui-toast');
  toast.setAttribute('role', 'status');
  toast.hidden = true;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  layer.append(hud, poketch.el, host, notices, toast, live.el);
  deps.root.append(layer);
  host.addEventListener('focusin', e => {
    const row = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('.options-row[data-setting]') : null;
    focusedSetting = row && !row.classList.contains('is-cursor') ? row.dataset.tap! : null;
  });
  host.addEventListener('keydown', e => {
    const screen = host.querySelector<HTMLElement>('[data-screen]');
    if (screen) menuKey(e, screen);
    const row = e.target instanceof HTMLElement && !e.target.matches('input, select, textarea') ? e.target.closest<HTMLElement>('.options-row[data-setting]') : null;
    // Consume an explicit browser focus change once. Later rapid game presses must not reselect
    // an old DOM row while the next animation frame is still waiting to draw the new cursor.
    if (!e.defaultPrevented && row && focusedSetting === row.dataset.tap && controls.keyMap()[e.code] && e.code !== 'Space' && e.code !== 'Enter') {
      deps.tap(focusedSetting);
      focusedSetting = null;
    }
  });

  // P toggles the Pokétch; Escape is B in menus (web habit), also from a focused range or button.
  // Text fields keep Escape (an IME cancels its composition with it) and P.
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.isComposing) return;
    const typing = e.target instanceof HTMLElement && e.target.closest('textarea, select, input:not([type="range"])');
    if (e.code === 'Escape' && deps.game().app() && !typing && !(e.target instanceof HTMLElement && e.target.closest('dialog'))) {
      e.preventDefault();
      deps.pulse('b');
      return;
    }
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, dialog')) return;
    if (e.code === 'KeyP') {
      e.preventDefault();
      api.togglePoketch();
    }
  });

  /** The drawn view (JSON) and its kind; the DOM is rebuilt only when the view changes. */
  let drawn: string | null = '';
  let drawnApp: string | null = null;
  /**
   * The dot and DS unit the open app is drawn at: the layout's, or smaller when its sheet does not fit the
   * view (a sheet never scrolls or clips; it drops to the next whole-device-pixel scale, and as a last
   * resort to a fractional fit). Each view starts again from the layout's scales, so a page that fits is never
   * drawn small because another page of the app did not (a patched view, the Pokédex list, keeps its scale).
   */
  let fitted: { app: string; dot: number; unit: number } | null = null;
  /** Fractional last-resort fits so far, and the apps already logged (once each). */
  let fractionalFits = 0;
  const fractionalLogged = new Set<string>();
  /**
   * The space a sheet may take: the room (the view less the controls and the HUD row), less a margin on wide
   * screens. A DS screen (a `.board` or a `.ds-screen` of boards, at the unit layout.ts already fits to the
   * room) may take the whole room, and steps its unit down (not the dot) when a composition of boards is too big.
   */
  const roomSize = () => ({ width: size.width - roomInsets.left - roomInsets.right, height: size.height - roomInsets.top - roomInsets.bottom });
  const room = (root: HTMLElement) => {
    const r = roomSize();
    return layer.dataset.mode === 'compact' || root.matches('.ds-screen, .board') ? r : { width: r.width - 2 * SHEET_MARGIN, height: r.height - 2 * SHEET_MARGIN };
  };

  /** Phones (portrait, or landscape with the side controls) show a DS screen full screen. */
  const phone = () => layer.dataset.mode === 'compact' || layer.dataset.controls === 'side';
  const build = (view: AppView, dot: number, u: number, entering: boolean) => {
    const ctx: DrawContext = { text: (s, palette = 'ink', className, k = dot) => font().label(s, palette, k, className), flow: (s, lines, palette = 'ink', k = dot) => font().flow(s, palette, k, lines), measure: (s) => font().measure(s), paint: (g, s, palette, x, y) => font().draw(g, s, palette, x, y), tap: deps.tap, ...(deps.fieldTile ? { fieldTile: deps.fieldTile } : {}), art, registries: deps.game().registries, frame: deps.frame(), scale: dot, unit: u, compact: layer.dataset.mode === 'compact', options, size: roomSize(), gender: deps.game().state.gender, sound: () => ({ tick: deps.game().state.tick, cryTicks: deps.game().sound.cryTicks() }) };
    const { kind, root } = drawApp(ctx, view);
    // A view that patches itself in place (the Pokédex list keeps its rows and scroll position).
    if (root.isConnected) return null;
    root.dataset.screen = view.app;
    root.classList.add('ui-screen');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.tabIndex = -1;
    isolatePrompt(root);
    if (!root.hasAttribute('aria-label')) root.setAttribute('aria-label', root.querySelector('h2')?.textContent ?? ('title' in view ? view.title : view.app));
    const frame = el('div', `ui-frame ui-${kind}${entering ? ' ui-enter' : ''}`, root);
    frame.style.setProperty('--dot', `${dot}px`);
    frame.style.setProperty('--unit', `${u}px`);
    // The mart's menu is over the field; its buy screen, like the scenes, is a DS screen of its own.
    if (kind === 'scene' || (kind === 'mart' && !(phone() && root.matches('.mart-screen')))) host.replaceChildren(frame);
    else {
      const scrim = el('div', 'ui-scrim');
      scrim.addEventListener('click', () => deps.tap('back'));
      // Phones (portrait, or landscape with the side controls) show a DS screen full screen: an opaque backdrop in
      // the colours of the screen's edges, no field around it.
      if (phone() && root.matches('.board, .ds-screen')) {
        scrim.classList.add('opaque');
        paintBackdrop(scrim, root);
      }
      host.replaceChildren(scrim, frame);
    }
    return { kind, root };
  };

  /**
   * A phone's opaque backdrop in the colours of the screen's edges: above the art's boundary its top row's colour,
   * below it its bottom row's. The boundary is the top of the element marked `data-backdrop-split` (the naming keys,
   * a stacked pair's touch screen), else the screen's centre. Repainted when a screen patched in place changes its
   * picture (the Ball Capsule editor's phases).
   */
  const paintBackdrop = (scrim: HTMLElement, root: HTMLElement) => {
    const backdrop = root.dataset.backdrop;
    // `data-backdrop-bottom`: a screen whose bottom is another picture (a stacked pair's touch screen).
    const spec = backdrop ? `${backdrop}|${root.dataset.backdropBottom ?? backdrop}` : '';
    if (scrim.dataset.painted === spec) return;
    scrim.dataset.painted = spec;
    if (!backdrop) return;
    void Promise.all([art.edgeColors(backdrop), art.edgeColors(root.dataset.backdropBottom ?? backdrop)]).then(([{ top }, { bottom }]) => {
      if (scrim.dataset.painted !== spec) return;
      // Layout positions in the host (offsets ignore the entry animation's transform).
      const y = (node: HTMLElement) => {
        let at = 0;
        for (let n: HTMLElement | null = node; n && n !== host; n = n.offsetParent as HTMLElement | null) at += n.offsetTop;
        return at;
      };
      const mark = root.querySelector<HTMLElement>('[data-backdrop-split]');
      const split = `${mark ? y(mark) : y(root) + root.offsetHeight / 2}px`;
      scrim.style.background = `linear-gradient(${top} 0 ${split}, ${bottom} ${split} 100%)`;
    });
  };

  const draw = (view: AppView | null) => {
    const key = view ? `${scale}|${unit}|${deps.frame()}|${view.app === 'options' ? options.key(view) : ''}|${JSON.stringify(view)}` : '';
    if (key === drawn) return;
    const entering = view !== null && view.app !== drawnApp;
    const oldRoot = host.querySelector<HTMLElement>('[data-screen]');
    const oldFocus = oldRoot?.contains(document.activeElement) ? focusKey(document.activeElement) : null;
    const oldCursor = focusKey(oldRoot ? focusTarget(oldRoot) : null);
    if (drawnApp) menuFocus.set(drawnApp, oldFocus);
    if (view && !drawnApp) {
      // Opened from the field's keys (nothing focused): closing leaves focus nowhere, so Space/Enter stay the game's.
      returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
      for (const e of [...background, hud, poketch.el]) e.inert = true;
    }
    drawn = key;
    drawnApp = view?.app ?? null;
    // The start menu's objective (drawn beside the menu, not focusable) is read out once as the menu opens.
    if (entering && view.app === 'start-menu' && view.objective) live.say(`${view.objective.title}: ${view.objective.text}`);
    host.hidden = !view;
    if (!view) {
      host.replaceChildren();
      fitted = null;
      for (const e of [...background, hud, poketch.el]) e.inert = false;
      returnFocus?.focus({ preventScroll: true });
      return;
    }
    fitted = { app: view.app, dot: scale, unit };
    let built = build(view, fitted.dot, fitted.unit, entering);
    if (!built) {
      const root = host.querySelector<HTMLElement>('[data-screen]')!;
      const scrim = host.querySelector<HTMLElement>('.ui-scrim.opaque');
      if (scrim) paintBackdrop(scrim, root);
      if (followCursor && oldCursor !== focusKey(focusTarget(root))) restoreMenuFocus(root, oldFocus, true);
      followCursor = false;
      return;
    }
    if (built.kind === 'sheet') {
      const dpr = devicePixelRatio || 1;
      const over = (r: HTMLElement) => {
        const space = room(r);
        return r.offsetWidth > space.width + 0.5 || r.offsetHeight > space.height + 0.5;
      };
      // Generic sheets are sized by the dot, DS screens by the unit (which fits by construction unless a
      // screen composes more than one DS screen). The next whole-device-pixel scale down, to one device
      // pixel, then once a fractional fit as the last resort.
      let fractional = false;
      while (over(built.root) && !fractional) {
        const space = room(built.root);
        const ds = built.root.matches('.ds-screen, .board');
        const v = ds ? fitted.unit : fitted.dot;
        const steps = Math.round(v * dpr);
        let next: number;
        if (steps >= 2 && Math.abs(v * dpr - steps) < 1e-6) next = (steps - 1) / dpr;
        else {
          // Not a silent fallback: counted (InGameUi.state.fractionalFits) and logged once per app.
          fractional = true;
          fractionalFits++;
          if (!fractionalLogged.has(view.app)) {
            fractionalLogged.add(view.app);
            console.warn(`ui: ${view.app} does not fit ${space.width}×${space.height} at a whole device pixel scale; drawn at a fractional fit`);
          }
          next = v * Math.min(space.width / built.root.offsetWidth, space.height / built.root.offsetHeight);
        }
        if (ds) fitted.unit = next;
        else fitted.dot = next;
        built = build(view, fitted.dot, fitted.unit, entering)!;
      }
    }
    const root = built.root;
    widenRowHits(root);
    if (built.kind === 'os') snapPixels(root);
    scrollToCursor(root);
    const typing = root.querySelector<HTMLInputElement>('input[data-typing]');
    if (typing) wireTyping(typing, deps);
    else restoreMenuFocus(root, entering ? menuFocus.get(view.app) ?? null : oldFocus, !entering && followCursor && oldCursor !== focusKey(focusTarget(root)));
    followCursor = false;
  };

  const api: InGameUi = {
    get state() {
      return { menu: deps.game().app()?.app ?? null, poketch: poketch.shown, fractionalFits };
    },
    input(frame) {
      if (frame.held.length || frame.pressed.length) followCursor = true;
      const game = deps.game();
      if (poketch.shown && (scriptBusy(game) || game.app() || !game.poketch())) poketch.show(false);
      const view = game.app();
      // OPTIONS keeps its own page and cursor (options-screen.ts): it takes the d-pad, A, L/R and its taps.
      const taken = options.input(dexInput(frame, view?.app === 'pokedex' && view.screen === 'list'), view?.app === 'options' ? view : null);
      return poketch.shown ? poketch.input(taken) : taken;
    },
    openStartMenu() {
      poketch.show(false);
      deps.pulse('x');
    },
    togglePoketch() {
      if (poketch.shown) {
        poketch.show(false);
        return true;
      }
      const game = deps.game();
      if (game.app() || !game.poketch() || scriptBusy(game)) return false;
      poketch.show(true);
      return true;
    },
    notice(message) {
      const n = el('p', 'ui-notice', message);
      notices.append(n);
      setTimeout(() => n.remove(), 8000);
    },
    toast(message) {
      toast.textContent = message;
      toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => (toast.hidden = true), 1200);
    },
    layout(l) {
      layer.style.left = `${l.main.x}px`;
      layer.style.top = `${l.main.y}px`;
      layer.style.width = `${l.main.width}px`;
      layer.style.height = `${l.main.height}px`;
      size = { width: l.main.width, height: l.main.height };
      roomInsets = l.room;
      for (const side of ['top', 'right', 'bottom', 'left'] as const) layer.style.setProperty(`--room-${side}`, `${l.room[side]}px`);
      // Landscape touch controls take the side columns; the HUD moves above the d-pad.
      layer.dataset.controls = l.controls && l.mode === 'landscape' ? 'side' : l.controls ? 'strip' : 'none';
      fastButton.hidden = !l.controls || !deps.fastForward;
      const compact = l.ui.compact;
      scale = l.ui.dot;
      unit = l.ui.unit;
      layer.dataset.mode = compact ? 'compact' : 'wide';
      layer.style.setProperty('--dot', `${scale}px`);
      layer.style.setProperty('--unit', `${unit}px`);
      // Whole device pixels per DS pixel, capped at 512 × 384 CSS px on big screens.
      // Keep the whole card (including its close button) between the landscape touch controls.
      poketch.size(compact ? l.main.width - 16 : Math.min(512, l.main.width * 0.45, l.main.width - l.room.left - l.room.right - 32), compact ? l.main.height * 0.45 : Math.min(384, l.main.height * 0.55));
      drawn = null;
      fitted = null;
    },
    frame() {
      const game = deps.game();
      const view = game.app();
      draw(view);
      announceFrame(announcer, game, deps.root.querySelector('.battle-card:not([hidden]) .bc-button.is-cursor')?.textContent?.trim() || null, performance.now());
      // Only a script makes the menus unavailable; walking does not (presses are queued), so the HUD doesn't flicker per step.
      const busy = scriptBusy(game);
      hud.classList.toggle('busy', busy || !!view);
      menuButton.disabled = busy;
      watchButton.hidden = !game.poketch();
      if (deps.fastForward) {
        const on = deps.fastForward.active();
        fastButton.classList.toggle('on', on);
        fastButton.setAttribute('aria-pressed', String(on));
      }
      if (poketch.shown && (busy || view)) poketch.show(false);
      poketch.frame();
    },
  };
  return api;
}
