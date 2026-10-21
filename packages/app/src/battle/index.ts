/**
 * The battle in the app: the scene canvas over the field and the command card, both driven by the
 * running battle's `BattleView` (packages/battle owns all timing; this only draws). The encounter
 * transition cuts up the field view; then, on big landscape views, the battle is a framed window over the
 * dimmed field (which keeps being drawn, frozen); elsewhere the scene fills the view and the field is not
 * drawn under it, and after the battle the field comes back out of black.
 */
import { isShiny } from '@opensinnoh/core';
import type { AssetSource, BattleSetup, BattleView } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';
import type { Layout } from '../layout.ts';
import type { PixelFont } from '../ui/pixel-font.ts';
import type { CardStrings } from './strings.ts';
import { BattleCard } from './card.ts';
import { BattleScene, PORTRAIT_CARD, SCENE } from './scene.ts';
import './battle.css';

/**
 * Landscape: the card is a band under the player's healthboxes (LANDSCAPE_CARD), the scene and band one
 * composition, so the healthboxes stay in view while a choice is open. Phones in portrait: the card sits under
 * the scene (PORTRAIT_CARD), the scene keeping its textbox.
 */
/** Ticks the field takes to come back out of black after a battle that filled the view. */
const RETURN_TICKS = 8;

export interface BattleUi {
  /** True while the battle scene covers the whole field (skip the field render). Asked before the field renders. */
  covers(): boolean;
  /** Per rendered frame, after the field rendered (when it was not covered). */
  frame(): void;
  layout(layout: Layout): void;
  /** Images of the battle on screen still loading. */
  loading(): boolean;
  /**
   * The game should not tick: the encounter cut-in has left the screen black and the battle's art is not in
   * yet (the DS loads it during the encounter flash). Only the wall-clock loop holds; replays never do.
   */
  holding(): boolean;
  /** What the hold waits for (the art not in yet), for the hold watchdog's error. */
  holdReason(): string;
  /** Where the scene is (for tests). */
  scene(): BattleSceneInfo;
}

/**
 * The scene's rect in CSS px of the page, its device px per DS px, whether it is a window over the field,
 * and how many placeholder draws it has made (packs without art; 0 for a pack that has the art).
 */
export interface BattleSceneInfo {
  rect: { x: number; y: number; width: number; height: number };
  scale: number;
  windowed: boolean;
  placeholders: number;
  healthboxes: { battler: number; rect: BattleSceneInfo['rect']; hpDisplay: 'bar' | 'numbers' | 'both' }[];
}

export function mountBattle(deps: {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The field view's canvas (the transition draws it cut up). */
  field: HTMLCanvasElement;
  game(): Game;
  assets: AssetSource;
  font(): import('@opensinnoh/contracts').LoadedFont;
  pixelFont(): PixelFont;
  strings(): CardStrings;
  pressB(): void;
}): BattleUi {
  const scene = new BattleScene(deps.canvas, { registries: () => deps.game().registries, assets: deps.assets, font: deps.font, frame: () => deps.game().state.options.frame });
  const card = new BattleCard({ game: deps.game, font: deps.pixelFont, strings: deps.strings, assets: deps.assets, pressB: deps.pressB });
  deps.root.append(card.el);
  let layout: Layout | null = null;
  let shown = false;

  const placeCard = () => {
    if (!layout) return;
    const r = scene.rect;
    // The scene composes to the edges of its view: the part clear of the notch and the home indicator.
    const main = layout.safe;
    const k = r.width / SCENE.width;
    const s = card.el.style;
    card.el.classList.toggle('is-band', layout.mode !== 'portrait');
    s.bottom = '';
    s.maxHeight = '';
    if (layout.mode === 'portrait') {
      s.left = `${main.x + r.x}px`;
      s.width = `${r.width}px`;
      s.top = `${main.y + r.y + r.height + PORTRAIT_CARD.gap * k}px`;
      s.height = `${PORTRAIT_CARD.height * k}px`;
    } else {
      // A window spans its width; a scene filling the view, the view's width between the touch controls.
      const band = scene.cardBand;
      const inset = scene.windowed || !layout.controls ? 0 : layout.room.left;
      s.left = `${scene.windowed ? main.x + r.x : main.x + inset}px`;
      s.width = `${scene.windowed ? r.width : main.width - 2 * inset}px`;
      s.top = `${main.y + r.y + band.top * k}px`;
      s.height = `${band.height * k}px`;
    }
  };

  /** After a battle that filled the view: the tick it ended (the field fades in from black). */
  let ended: number | null = null;
  const view = (): BattleView | null => deps.game().battle?.view() ?? null;
  /** The battle whose art `scene.preload` is loading. */
  let preloaded: BattleSetup | null = null;
  /** From the battle's first view: its art and every Pokémon that can come out (both parties). */
  const preload = (v: BattleView) => {
    const game = deps.game();
    const setup = game.battleSetup();
    if (!setup || setup === preloaded) return;
    preloaded = setup;
    const reg = game.registries;
    // The enemy trainers and an AI partner (its party and its back picture).
    const trainers = [...setup.trainers, ...(setup.partner ? [setup.partner] : [])].map((id) => reg.trainers.get(id)!);
    const own = setup.kind === 'tutorial' ? [] : game.state.party.filter((m) => !m.isEgg).map((m) => ({ species: m.species, form: m.form, shiny: isShiny(m.otId, m.pid) }));
    // A frontier battle's trainers are its own (contracts `FrontierBattle`): their parties and classes.
    const frontier = setup.frontier ? [...setup.frontier.trainers, ...(setup.frontier.partner ? [setup.frontier.partner] : [])] : [];
    const foes = [...trainers.flatMap((t) => t.party), ...frontier.flatMap((t) => t.party)].map((m) => ({ species: m.species, form: m.form ?? 0, shiny: isShiny(m.otId, m.pid) }));
    const shown = v.battlers.map((b) => ({ species: b.species, form: b.form, shiny: b.shiny }));
    const classes = [...trainers.map((t) => t.class), ...frontier.map((t) => t.class), ...(v.trainer ? [v.trainer.class] : [])];
    scene.preload(v, [...shown, ...own, ...foes], classes);
  };
  const show = (on: boolean) => {
    if (on === shown) return;
    shown = on;
    deps.canvas.hidden = !on;
  };

  return {
    covers() {
      const v = view();
      return v !== null && v.transition === null && !scene.windowed;
    },
    frame() {
      const game = deps.game();
      const v = view();
      if (v) scene.setDoubles(v.topology !== 'single');
      // The card is placed first: it fits its text to its box.
      placeCard();
      card.update(v, scene.windowed ? (scene.rect.width / SCENE.width >= 4 ? 3 : 2) : Math.min(window.innerWidth, window.innerHeight) >= 900 ? 3 : 2, layout?.mode === 'portrait');
      if (!v) {
        if (shown && !scene.windowed && ended === null) ended = game.state.tick;
        const left = ended === null ? 0 : RETURN_TICKS - (game.state.tick - ended);
        if (left > 0) scene.blackout(left / RETURN_TICKS);
        else {
          ended = null;
          show(false);
        }
        return;
      }
      ended = null;
      show(true);
      preload(v);
      scene.draw(v, deps.field);
    },
    layout(next) {
      layout = next;
      const m = next.safe;
      Object.assign(deps.canvas.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.width}px`, height: `${m.height}px` });
      scene.resize(m.width, m.height, devicePixelRatio || 1, next.mode === 'portrait');
      placeCard();
    },
    loading: () => shown && (scene.loading() || card.loading()),
    holding() {
      const v = view();
      return !!v?.transition && v.transition.close >= 1 && preloaded === deps.game().battleSetup() && (!scene.ready() || card.loading());
    },
    holdReason: () => [...scene.missing(), ...card.loadingArt()].join(', ') || 'nothing',
    scene: () => {
      const m = layout?.safe ?? { x: 0, y: 0 };
      const r = scene.rect;
      const k = r.width / SCENE.width;
      return {
        rect: { x: m.x + r.x, y: m.y + r.y, width: r.width, height: r.height },
        scale: Math.round(k * (devicePixelRatio || 1)),
        windowed: scene.windowed,
        placeholders: scene.placeholders,
        healthboxes: scene.healthboxes.map((b) => ({
          battler: b.battler,
          hpDisplay: b.hpDisplay,
          rect: { x: m.x + r.x + b.x * k, y: m.y + r.y + b.y * k, width: b.width * k, height: b.height * k },
        })),
      };
    },
  };
}
