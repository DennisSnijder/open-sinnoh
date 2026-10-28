/**
 * The battle scene (single screen): the DS top screen drawn from a `BattleView` on a 2D canvas at a whole
 * number of device pixels per DS pixel, composed as one screen:
 * - Wide screens: the scene and the command card's band under the player's healthboxes (LANDSCAPE_CARD) fill
 *   the view's height at the largest whole-pixel scale that fits, resting on the view's bottom, the sky
 *   extending upward; sideways the backdrop's 512 px map wraps, as the DS BG layer does.
 * - Phones in portrait: the largest whole-pixel scale that fits the width; the scene and the command card's
 *   place under it (PORTRAIT_CARD) rest on the view's bottom as one composition, the sky extending upward,
 *   and the scene keeps its textbox (the card shows only the choice).
 * Positions are the decomp's (docs/decisions.md: 2D art import): platforms, battlers, healthboxes and the textbox
 * keep their DS relations at any size. While the card shows a prompt it replaces the textbox.
 *
 * Packs without battle art (the fixture) get a plain backdrop, plain platforms and a placeholder battler:
 * the scene still shows the battle's state. A pack that has the art never gets them: `preload` loads the
 * battle's art during the encounter cut-in (the app holds the game on the black screen until it is in,
 * as the DS loads during the encounter flash), and until it is in the scene stays black.
 */
import type { Id } from '@opensinnoh/core';
import { dexOf, type AnimBattlerView, type AnimBgMonView, type AnimPicture, type AnimSpriteView, type AssetRef, type AssetSource, type BattlerView, type BattleView, type LoadedFont, type PokemonFace, type PokemonSpriteForm, type Registries, type Ui2dSheet } from '@opensinnoh/contracts';
import { barColor, gaugeCells } from '@opensinnoh/battle/formulas';
import { drawText, levelMark } from '@opensinnoh/text';
import { plainText } from '@opensinnoh/menus';
import { capFlash, reduceFlashing } from '@opensinnoh/render/flash';
import { applyBattlerTransform, battlerTransform, css555, drawBgMon, fadeImage, mosaicImage, ParticleTextures } from './anim/draw.ts';

export const SCENE = { width: 256, height: 192 } as const;

/** A BGR555 colour closer to white than to a colour (its mean channel above 70 %): fading toward it is a flash. */
const isBright555 = (c: number): boolean => ((c & 31) + ((c >> 5) & 31) + ((c >> 10) & 31)) / 93 > 0.7;
/** Phones in portrait: the command card's place under the scene, in DS px (a gap, then the card). */
export const PORTRAIT_CARD = { gap: 4, height: 160 } as const;
/**
 * Landscape (a window or a scene filling the view): the command card's band in DS px, under the player's
 * healthboxes so they stay in view (the DS keeps them on the main screen while the touch screen shows the
 * commands): singles under the player's box (y 100–140), doubles under both boxes and their 1 px bob. The
 * scene and the band are one composition, `top + height` DS px tall.
 */
export const LANDSCAPE_CARD = { single: { top: 140, height: 84 }, double: { top: 150, height: 84 } } as const;
/** Window mode: at least this many CSS px of field around the framed scene. */
const WINDOW_MARGIN = 32;
/** Window mode: the smallest scale (CSS px per DS px) worth a window; below it the scene fills the view. */
const WINDOW_MIN_SCALE = 3;
/** Window mode: the scene takes at most about this share of the view's height (×3 at 1080p, ×4 at 1440p). */
const WINDOW_HEIGHT_SHARE = 0.55;
/** The field around the window: darkened by this much. */
const WINDOW_DIM = 0.55;

/**
 * Window mode's scale (CSS px per DS px), or 0 when the scene should fill the view (portrait, phones in
 * landscape, small laptops): landscape views where a ×3 scene fits with the margin get a window, capped
 * at the larger of ×3 and the scale that keeps the scene near WINDOW_HEIGHT_SHARE of the height.
 */
export function panelScale(width: number, height: number, portrait: boolean): number {
  if (portrait) return 0;
  const fit = Math.min(Math.floor((width - 2 * WINDOW_MARGIN) / SCENE.width), Math.floor((height - 2 * WINDOW_MARGIN) / SCENE.height));
  if (fit < WINDOW_MIN_SCALE) return 0;
  return Math.min(fit, Math.max(WINDOW_MIN_SCALE, Math.floor((height * WINDOW_HEIGHT_SHARE) / SCENE.height)));
}

/** Battler centres and healthbox anchors in DS px (decomp battle_display.c, healthbox.c). */
const POS = {
  enemy: { x: 192, y: 50, healthbox: { x: 58, y: 36 } },
  player: { x: 64, y: 112, healthbox: { x: 192, y: 116 } },
} as const;
/**
 * Doubles: the four battlers' centres and healthbox anchors by DS battler id, from docs/research/double-battles.md
 * §4 (decomp gBattlerEncounterX/gEncounterCoords, healthbox.c HEALTHBOX_*_OFFSET_*_SLOT_*). Trainers that stand at
 * their battlers' spots (two enemy trainers, every trainer of a 2vs2) use the same centres.
 */
const DOUBLES_POS = [
  { x: 40, y: 112, healthbox: { x: 192, y: 103 } },
  { x: 216, y: 50, healthbox: { x: 64, y: 16 } },
  { x: 80, y: 120, healthbox: { x: 198, y: 132 } },
  { x: 176, y: 42, healthbox: { x: 58, y: 45 } },
] as const;
/**
 * Where the trainers stand (decomp BattleDisplay_InitTaskSetTrainerEncounter: 2vs2, or TAG for the enemy trainers,
 * use the battler's slot; otherwise the side's solo spot): two enemy trainers at enemies 1 and 2, the player and an
 * AI partner at players 1 and 2; a lone trainer (singles, a double trainer, the player against a pair) solo.
 */
function trainerSpots(topology: BattleView['topology']): Record<'enemy' | 'enemy2' | 'player' | 'partner', { x: number; y: number }> {
  const pair = topology === 'trainer-pair' || topology === 'ai-partner';
  return { enemy: pair ? DOUBLES_POS[1] : POS.enemy, enemy2: DOUBLES_POS[3], player: topology === 'ai-partner' ? DOUBLES_POS[0] : POS.player, partner: DOUBLES_POS[2] };
}
/**
 * The acting battler's healthbox bobs while the player picks its command, move or target (decomp Healthbox_Activate:
 * Healthbox_Task_Bob, 20° a frame, y = sin × 1.5 truncated), so a double shows whose turn it is. Doubles only here:
 * the singles scene stays as it was.
 */
function actorBob(view: BattleView, battler: number): number {
  const p = view.prompt;
  if (!p || (p.kind !== 'command' && p.kind !== 'fight' && p.kind !== 'target') || p.actor !== battler) return 0;
  return Math.trunc(Math.sin((((view.tick * 20) % 360) * Math.PI) / 180) * 1.5);
}
/** Draw order on a side: the back slot first (the enemy's second, the player's first). */
const drawOrder = (side: BattlerView['side'], battlers: readonly BattlerView[]) => battlers.filter((b) => b.side === side).sort((a, b) => (side === 'enemy' ? b.position - a.position : a.position - b.position));
/**
 * Healthbox parts in the sheet's own pixels (decomp healthbox.c VRAM transfers, mapped to the 128×64 cell). The
 * player's doubles boxes (healthbox_player_doubles, HEALTHBOX_TYPE_PLAYER_SLOT_*) toggle the gauge and HP numbers
 * and have no EXP bar; the enemy's doubles boxes are the solo enemy box.
 */
const HEALTHBOX = {
  player: { name: [24, 16], level: [88, 16], gauge: [72, 32], status: [32, 32], hp: [64, 40], maxHp: [96, 40], exp: [24, 48] },
  playerDoubles: { name: [16, 16], level: [80, 16], gauge: [64, 32], status: [24, 32] },
  enemy: { name: [8, 16], level: [72, 16], gauge: [56, 32], status: [16, 32], caught: [8, 32] },
} as const;
/**
 * The numbers (decomp HealthBox_DrawLevelNumber / DrawCurrentHP / DrawMaxHP): 8 px per digit from the
 * `healthbox/digits` glyphs. The level starts right after the "Lv" glyph, 4 rows down (the decomp writes
 * the glyph's rows into the lower half of one tile row and the upper half of the next); current HP is
 * right-aligned in 3 digits before the box's "/", max HP left-aligned after it.
 */
const NUMBERS = {
  player: { level: [104, 20], hp: [64, 40], maxHp: [96, 40] },
  playerDoubles: { level: [96, 20] },
  enemy: { level: [88, 20] },
} as const;
/** The textbox: window (2, 19), 27×4 tiles, in the message frame the FRAME option picks (decomp BattleSystem_GetOptionsFrame). */
const TEXTBOX = { x: 16, y: 152, width: 216, height: 32 };
const messageFrame = (frame: number) => `ui2d/windows/message_box_${String(frame).padStart(2, '0')}`;

type Img = ImageBitmap;

export class BattleScene {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly images = new Map<AssetRef, Img | null>();
  private pending = 0;
  private scale = 1;
  private origin = { x: 0, y: 0 };
  /** The scene's rect in CSS px within the canvas (for the command card's placement). */
  rect = { x: 0, y: 0, width: 0, height: 0 };
  private readonly scratch = document.createElement('canvas');
  private portrait = false;
  /** Window mode: the scene's CSS px per DS px (0: the scene fills the view). */
  private panel = 0;
  /** The scene has been fully shown (its intro fade ended): a later fade is the exit. */
  private opened = false;
  /** The battle on screen has two battlers a side (`setDoubles`, before each frame's layout). */
  private doubles = false;
  /** The art the battle on screen opens with (`preload`); the scene stays black until all of it is in. */
  private need: AssetRef[] = [];
  /** An image that failed to load: the next draw throws (no silent fallback). */
  private failed: Error | null = null;
  /** Placeholder draws (packs without art), for tests: a pack with the art must never draw one. */
  placeholders = 0;
  /** Last drawn healthbox bounds in DS pixels, for structural browser checks. */
  healthboxes: { battler: number; x: number; y: number; width: number; height: number; hpDisplay: 'bar' | 'numbers' | 'both' }[] = [];
  /** Move animations' particle textures, tinted and tiled as drawn. */
  private readonly particles = new ParticleTextures((id) => this.sheet(id));
  /** The battlers of the view being drawn (a swapped picture takes its gender and shininess from its battler). */
  private battlers: BattlerView[] = [];
  /** A second scratch canvas: BG2's picture. */
  private readonly bgMonCanvas = document.createElement('canvas');

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly deps: { registries: () => Registries; assets: AssetSource; font: () => LoadedFont; frame: () => number },
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Images still loading for the battle on screen. */
  loading(): boolean {
    return this.pending > 0;
  }

  /** Sizes the canvas (CSS px of the main view) and places the scene (see the header). */
  resize(width: number, height: number, dpr: number, portrait: boolean): void {
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));
    this.size = { width, height, dpr, portrait };
    this.layoutScene();
  }

  /** The battle on screen has two battlers a side (or not): places the scene again when that changes. */
  setDoubles(doubles: boolean): void {
    if (doubles === this.doubles) return;
    this.doubles = doubles;
    this.layoutScene();
  }

  /** Landscape: the command card's band (LANDSCAPE_CARD) for the battle on screen. */
  get cardBand(): { top: number; height: number } {
    return LANDSCAPE_CARD[this.doubles ? 'double' : 'single'];
  }

  /** The view `resize` gave, kept to place the scene again when the battle's topology changes the allowed crop. */
  private size = { width: 1, height: 1, dpr: 1, portrait: false };

  private layoutScene(): void {
    const { width, height, dpr, portrait } = this.size;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const fitW = Math.max(1, Math.floor(W / SCENE.width));
    const band = this.cardBand;
    const composedHeight = portrait ? SCENE.height : band.top + band.height;
    this.panel = panelScale(width, height, portrait);
    if (portrait) this.scale = fitW;
    // Landscape: the window's scale or, filling the view, the width's, at most the one at which the scene and
    // the card's band fit the height.
    else this.scale = Math.max(1, Math.min(this.panel ? Math.floor(this.panel * dpr) : fitW, Math.floor(H / composedHeight)));
    const w = SCENE.width * this.scale;
    const h = SCENE.height * this.scale;
    const stack = h + (PORTRAIT_CARD.gap + PORTRAIT_CARD.height) * this.scale;
    this.origin = { x: Math.floor((W - w) / 2), y: this.panel ? Math.floor((H - composedHeight * this.scale) / 2) : portrait ? Math.max(0, H - stack) : H - composedHeight * this.scale };
    this.rect = { x: this.origin.x / dpr, y: this.origin.y / dpr, width: w / dpr, height: h / dpr };
    this.portrait = portrait;
  }

  /** The battle is a framed window over the (dimmed) field: the field shows around it. */
  get windowed(): boolean {
    return this.panel > 0;
  }

  private image(ref: AssetRef): Img | null {
    if (this.images.has(ref)) return this.images.get(ref)!;
    this.images.set(ref, null);
    this.pending++;
    void this.deps.assets
      .get(ref)
      .then((blob) => createImageBitmap(blob))
      .then((img) => this.images.set(ref, img))
      .catch((e: unknown) => {
        this.failed = new Error(`battle scene: cannot load ${ref}: ${(e as Error).message}`, { cause: e });
      })
      .finally(() => this.pending--);
    return null;
  }

  /**
   * Starts loading the art a battle opens with: the backdrop and platforms, the healthboxes, digits and
   * textbox, both trainers, and every Pokémon that can come out (`mons`: the player's party and the foe's).
   * The art of later moments (move animations, balls) still loads when first drawn.
   */
  preload(view: BattleView, mons: { species: Id; form: number; shiny: boolean }[], trainers: Id[]): void {
    const reg = this.deps.registries();
    const sheet = (id: Id | undefined) => (id && reg.ui2d.get(id)?.atlas) || null;
    const bg = view.background ? reg.battleBackgrounds.get(view.background) : undefined;
    const terrain = view.terrain ? reg.battleTerrains.get(view.terrain) : undefined;
    const refs: (AssetRef | null)[] = [
      bg?.[view.time] ?? null,
      sheet(terrain?.enemy[view.time]),
      sheet(terrain?.player[view.time]),
      ...['enemy', view.kind === 'safari' ? 'safari' : view.topology === 'single' ? 'player_singles' : 'player_doubles', 'parts', 'digits'].map((n) => sheet(this.ns(`ui2d/battle/healthbox/${n}`))),
      sheet(this.ns(messageFrame(this.deps.frame()))),
      ...trainers.flatMap((c) => [sheet(reg.trainerSprites.get(c)?.front), sheet(reg.trainerSprites.get(c)?.back)]),
      ...mons.map((m) => {
        const sprites = reg.pokemonSprites.get(m.species);
        const form = sprites?.forms[m.form] ?? sprites?.forms[0];
        return form ? (m.shiny ? form.shinyAtlas : form.atlas) : null;
      }),
    ];
    this.need = [...new Set(refs.filter((r): r is AssetRef => r !== null))];
    for (const r of this.need) this.image(r);
  }

  /** The preloaded art is in (throws if an image failed to load). */
  ready(): boolean {
    if (this.failed) throw this.failed;
    return this.need.every((r) => this.images.get(r));
  }

  /** The preloaded art not in yet (for the hold watchdog's error). */
  missing(): AssetRef[] {
    return this.need.filter((r) => !this.images.get(r));
  }

  private sheet(id: Id | null | undefined): { sheet: Ui2dSheet; img: Img } | null {
    if (!id) return null;
    const sheet = this.deps.registries().ui2d.get(id);
    if (!sheet) throw new Error(`battle scene: no ui2d sheet ${id}`);
    const img = this.image(sheet.atlas);
    return img ? { sheet, img } : null;
  }

  /** A sheet cell with its origin at DS (x, y). */
  private cell(s: { sheet: Ui2dSheet; img: Img } | null, n: number, x: number, y: number): void {
    const c = s?.sheet.cells[n];
    if (!s || !c) return;
    this.blit(s.img, c.x, c.y, c.w, c.h, x - c.ox, y - c.oy);
  }

  private part(name: string, x: number, y: number): void {
    const s = this.sheet(this.ns('ui2d/battle/healthbox/parts'));
    if (!s) return;
    const i = s.sheet.names?.indexOf(name) ?? -1;
    if (i < 0) throw new Error(`battle scene: no healthbox part ${name}`);
    this.cell(s, i, x, y);
  }

  private ns(path: string): Id {
    const id = [...this.deps.registries().newGame.keys()][0]!;
    return `${id.slice(0, id.indexOf(':'))}:${path}` as Id;
  }

  /** Draws an image region at DS px (x, y) at the scene scale. */
  private blit(img: CanvasImageSource, sx: number, sy: number, w: number, h: number, x: number, y: number, scale = 1): void {
    const k = this.scale;
    this.ctx.drawImage(img, sx, sy, w, h, this.origin.x + Math.round(x * k), this.origin.y + Math.round(y * k), Math.round(w * k * scale), Math.round(h * k * scale));
  }

  private fill(color: string, x: number, y: number, w: number, h: number): void {
    const k = this.scale;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(this.origin.x + x * k, this.origin.y + y * k, w * k, h * k);
  }

  /** Draws the battle; `field` is the field view's canvas, just rendered this frame (the transition cuts it up). */
  draw(view: BattleView, field: CanvasImageSource): void {
    const { ctx, canvas } = this;
    this.healthboxes = [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (view.transition) {
      this.opened = false;
      this.drawTransition(view, field);
      return;
    }
    if (!this.ready()) {
      // The art is still loading (the app holds the game here): black, as the cut-in left the screen.
      this.layer('source-over', '#000', 1);
      return;
    }
    if (view.fade === 0) this.opened = true;
    if (this.panel) {
      this.drawFrame();
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.origin.x, this.origin.y, SCENE.width * this.scale, SCENE.height * this.scale);
      ctx.clip();
    }
    this.battlers = view.battlers;
    this.drawBackdrop(view);
    this.drawPlatforms(view);
    // BG2's picture under the 3D layer (its priority equal: the 3D layer wins), over the backdrop.
    if (view.anim?.bgMon && !view.anim.bgMon.front) this.drawBgMon(view.anim.bgMon);
    // Trainers: a lone one at its side's solo spot; two enemy trainers and every trainer of a 2vs2 at their battlers'
    // spots (decomp BattleDisplay_InitTaskSetTrainerEncounter), the back slot drawn first.
    const spots = trainerSpots(view.topology);
    if (view.enemyTrainer2) this.drawEnemyTrainer(view.enemyTrainer2, spots.enemy2);
    if (view.enemyTrainer) this.drawEnemyTrainer(view.enemyTrainer, spots.enemy);
    for (const b of drawOrder('enemy', view.battlers)) this.drawBattler(b, battlerTransform(view.anim, b.battler));
    if (view.trainer) this.drawTrainer(view.trainer, spots.player);
    if (view.partnerTrainer) this.drawTrainer(view.partnerTrainer, spots.partner);
    for (const b of drawOrder('player', view.battlers)) this.drawBattler(b, battlerTransform(view.anim, b.battler));
    if (view.anim?.bgMon?.front) this.drawBgMon(view.anim.bgMon);
    // The send-out effect's particles (a capsule's seals or the ball's burst), like an animation's.
    // Kept to the scene: seals at the capsule's rim reach past its bottom edge, where the phone layout has no frame.
    if (view.sendOut) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(this.origin.x, this.origin.y, SCENE.width * this.scale, SCENE.height * this.scale);
      ctx.clip();
      this.particles.draw(ctx, view.sendOut, this.origin, this.scale);
      ctx.restore();
    }
    if (view.anim) {
      // The move animation's sprite copies, then its particles, over the battlers and under the healthboxes.
      if (view.anim.curtain) {
        ctx.fillStyle = '#000';
        ctx.fillRect(this.origin.x, this.origin.y, 256 * this.scale, view.anim.curtain.top * this.scale);
        ctx.fillRect(this.origin.x, this.origin.y + (192 - view.anim.curtain.bottom) * this.scale, 256 * this.scale, view.anim.curtain.bottom * this.scale);
      }
      for (const c of view.anim.sprites) {
        const b = view.battlers.find((v) => v.battler === c.battler);
        if (c.kind === 'pokemon' && b) this.drawBattler(b, null, c);
        else if (c.kind === 'cell') this.drawAnimCell(c);
      }
      if (view.anim.overlay) this.drawOverlay(view, view.anim.overlay);
      this.particles.draw(ctx, view.anim.particles, this.origin, this.scale);
    }
    for (const b of view.battlers) if (b.healthbox.visible) this.drawHealthbox(b, this.doubles ? actorBob(view, b.battler) : 0);
    if (view.safari?.healthbox.visible) this.drawSafariHealthbox(view.safari);
    // The ball is an OBJ above the healthboxes (its arc passes the enemy's box).
    if (view.ball) this.drawBall(view.ball);
    // The card covers the textbox while it shows a choice, but in portrait, where it sits under the scene.
    if (!view.prompt || this.portrait) this.drawTextbox(view);
    if (this.panel) {
      ctx.restore();
      // The exit fades the window out over the field, then the dim lifts; the intro comes out of black.
      const exit = this.opened ? view.fade : 0;
      this.layer('destination-out', '#000', exit);
      this.layer('destination-over', '#080c14', WINDOW_DIM * (1 - exit));
      if (!this.opened) this.layer('source-over', '#000', view.fade);
    } else this.layer('source-over', '#000', view.fade);
  }

  /** Only black at `alpha` over the field (the field coming back after a battle that filled the view). */
  blackout(alpha: number): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.layer('source-over', '#000', alpha);
  }

  /** Fills the whole canvas with `color` at `alpha` in a composite mode. */
  private layer(mode: GlobalCompositeOperation, color: string, alpha: number): void {
    if (alpha <= 0) return;
    const { ctx, canvas } = this;
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Window mode: the scene's frame (the command card's two slate rings) and its hard drop shadow, 1 DS px each. */
  private drawFrame(): void {
    const { ctx } = this;
    const d = this.scale;
    const { x, y } = this.origin;
    const w = SCENE.width * d;
    const h = SCENE.height * d;
    ctx.fillStyle = 'rgb(8 12 20 / 0.45)';
    ctx.fillRect(x - 2 * d, y + 2 * d, w + 4 * d, h + 2 * d);
    ctx.fillStyle = '#10141c';
    ctx.fillRect(x - 2 * d, y - 2 * d, w + 4 * d, h + 4 * d);
    ctx.fillStyle = '#4a5670';
    ctx.fillRect(x - d, y - d, w + 2 * d, h + 2 * d);
  }

  /**
   * The wild encounter's cut-in over the field (decomp EncounterEffect_Grass_LowerLevel / HigherLevel): two
   * master-brightness flashes (to black, or to white when the foe's level is higher than the lead's), then
   * the screen slice: bands of rows (5 DS px, 2 when higher) shift sideways in alternate directions, a short
   * shudder out and back, then apart off the screen, leaving black. The DS also pulls the field camera back
   * and in meanwhile (not done here, nor the water, cave and trainer cut-ins).
   */
  private drawTransition(view: BattleView, field: CanvasImageSource): void {
    const t = view.transition!;
    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;
    const level = (side: BattlerView['side']) => view.battlers.find((b) => b.side === side)?.level ?? 0;
    const higher = level('enemy') > level('player');
    if (t.close > 0) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      const dx = sliceOffset(t.close * SLICE.frames, higher) * (W / SCENE.width);
      const band = (higher ? SLICE.higherRows : SLICE.lowerRows) * (H / SCENE.height);
      for (let i = 0; i * band < H; i++) {
        const y = Math.round(i * band);
        const h = Math.round((i + 1) * band) - y;
        ctx.drawImage(field, 0, y, W, h, i % 2 ? dx : -dx, y, W, h);
      }
    }
    // Reduce flashing caps the white one (render/flash.ts).
    if (t.flash > 0) this.layer('source-over', higher ? '#fff' : '#000', higher ? capFlash(t.flash) : t.flash);
  }

  private drawBackdrop(view: BattleView): void {
    const { ctx } = this;
    // A move animation's BG shake scrolls the backdrop layer; its palette fade blends it toward a colour.
    const bgFx = view.anim?.bg;
    ctx.save();
    if (bgFx?.grayscale) ctx.filter = 'grayscale(1)';
    if (bgFx && (bgFx.dx || bgFx.dy)) ctx.translate(-bgFx.dx * this.scale, -bgFx.dy * this.scale);
    this.drawBackdropLayer(view);
    ctx.restore();
    // A move animation's flash of the backdrop toward a bright colour is capped by Reduce flashing.
    if (bgFx?.fade) this.layer('source-over', css555(bgFx.fade.color), isBright555(bgFx.fade.color) ? capFlash(bgFx.fade.amount / 16) : bgFx.fade.amount / 16);
    if (bgFx?.effect) this.drawSwitchedBg(bgFx.effect);
    if (bgFx?.custom) this.drawCustomBg(bgFx.custom);
  }

  /** A background loaded into BG2 (Surf's and Muddy Water's waves): the cell at the 512×512 layer's top-left, wrapping, at its weight. */
  private drawCustomBg(c: NonNullable<NonNullable<BattleView['anim']>['bg']['custom']>): void {
    const s = this.sheet(c.sheet);
    const cell = s?.sheet.cells[c.cell];
    if (!s || !cell || c.alpha <= 0) return;
    const { ctx, canvas } = this;
    const k = this.scale;
    const mod = (v: number, m: number) => ((v % m) + m) % m;
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.beginPath();
    ctx.rect(0, this.origin.y, canvas.width, SCENE.height * k);
    ctx.clip();
    const top = mod(-c.dy, 512);
    const left = mod(-c.dx, 512);
    for (const y of [top, top - 512])
      for (let x = left - Math.ceil((left + this.origin.x / k) / 512) * 512; this.origin.x + x * k < canvas.width; x += 512)
        ctx.drawImage(s.img, cell.x, cell.y, cell.w, cell.h, this.origin.x + x * k, this.origin.y + y * k, cell.w * k, cell.h * k);
    ctx.restore();
  }

  /** BG2 holding a battler's picture (LoadPokemonSpriteIntoBg). */
  private drawBgMon(m: AnimBgMonView): void {
    const look = this.look(m.picture);
    if (!look) return;
    const c = this.bgMonCanvas;
    c.width = 80;
    c.height = 80;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(look.img, 0, look.face.y, 80, 80, 0, 0, 80, 80);
    fadeImage(g, 80, 80, m.fade);
    drawBgMon(this.ctx, c, m, this.origin, this.scale);
  }

  /**
   * A battler's picture: its form, face and atlas (the battler's gender and shininess when it is on the field: those it
   * shows, its `look` after Transform).
   */
  private picture(p: AnimPicture): { form: PokemonSpriteForm | undefined; face: PokemonFace | undefined; img: Img | null } {
    const v = this.battlers.find((x) => x.battler === p.battler);
    const b = v?.look ?? v;
    const sprites = this.deps.registries().pokemonSprites.get(p.species);
    const form = sprites?.forms[p.form] ?? sprites?.forms[0];
    const name = p.back ? 'back' : 'front';
    const face = (b?.gender === 'female' && form?.[`${name}Female`]) || form?.[name];
    const img = form ? this.image(b?.shiny ? form.shinyAtlas : form.atlas) : null;
    return { form, face: face || undefined, img };
  }

  private look(p: AnimPicture): { img: Img; face: PokemonFace } | null {
    const { face, img } = this.picture(p);
    return img && face ? { img, face } : null;
  }

  /** The stat change pattern seen through a battler's silhouette (decomp: BG2 inside the OBJ window of its sprite copy). */
  private drawOverlay(view: BattleView, o: NonNullable<NonNullable<BattleView['anim']>['overlay']>): void {
    const b = view.battlers.find((v) => v.battler === o.mask);
    const s = this.sheet(o.sheet);
    const look = b?.look ?? b;
    const sprites = look ? this.deps.registries().pokemonSprites.get(look.species) : undefined;
    const form = sprites?.forms[look!.form] ?? sprites?.forms[0];
    const face = b && look && ((look.gender === 'female' && form?.[b.side === 'enemy' ? 'frontFemale' : 'backFemale']) || form?.[b.side === 'enemy' ? 'front' : 'back']);
    const img = look && form ? this.image(look.shiny ? form.shinyAtlas : form.atlas) : null;
    const cell = s?.sheet.cells[0];
    if (!b?.visible || !s || !cell || !img || !face) return;
    const g = this.scratchCtx(80, 80);
    g.drawImage(img, 0, face.y, 80, 80, 0, 0, 80, 80);
    g.globalCompositeOperation = 'source-in';
    const pos = this.place(b);
    const left = pos.x + b.dx - 40;
    const top = pos.y + face.yOffset - 40;
    // The pattern is a BG layer: screen position (x, y) shows its pixel (x + dx, y + dy), wrapping.
    for (let y = -((((top + o.dy) % cell.h) + cell.h) % cell.h); y < 80; y += cell.h)
      for (let x = -((((left + o.dx) % cell.w) + cell.w) % cell.w); x < 80; x += cell.w) g.drawImage(s.img, cell.x, cell.y, cell.w, cell.h, x, y, cell.w, cell.h);
    this.ctx.save();
    this.ctx.globalAlpha = o.alpha;
    this.blit(this.scratch, 0, 0, 80, 80, left, top + b.dy);
    this.ctx.restore();
  }

  /**
   * A background a move switched in (decomp BattleBgSwitch): its image over the backdrop at its weight, scrolled
   * (the 256 or 512 px map wraps sideways like the backdrop's), row by row when an HBlank wave moves it, with its
   * palette fade.
   */
  private drawSwitchedBg(e: NonNullable<NonNullable<BattleView['anim']>['bg']['effect']>): void {
    const s = this.sheet(e.sheet);
    const cell = s?.sheet.cells[e.cell];
    if (!s || !cell || e.alpha <= 0) return;
    const { ctx, canvas } = this;
    const k = this.scale;
    const g = this.scratchCtx(cell.w, cell.h);
    g.drawImage(s.img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
    fadeImage(g, cell.w, cell.h, e.fade);
    const img = this.scratch;
    const h = Math.min(cell.h, 192);
    ctx.save();
    ctx.globalAlpha = e.alpha;
    const rows = e.rows ?? [];
    const bands: [number, number, number][] = rows.length ? rows.map((dx, y) => [y, 1, dx]) : [[0, h, 0]];
    for (const [y, rh, rx] of bands) {
      const sy = (((y + e.dy) % cell.h) + cell.h) % cell.h;
      const shift = (((e.dx + rx) % cell.w) + cell.w) % cell.w;
      const x0 = this.origin.x - shift * k;
      for (let x = x0 - Math.ceil(x0 / (cell.w * k)) * cell.w * k; x < canvas.width; x += cell.w * k) ctx.drawImage(img, 0, sy, cell.w, Math.min(rh, cell.h - sy), x, this.origin.y + y * k, cell.w * k, Math.min(rh, cell.h - sy) * k);
    }
    ctx.restore();
  }

  private drawBackdropLayer(view: BattleView): void {
    const { ctx, canvas } = this;
    const bg = view.background ? this.deps.registries().battleBackgrounds.get(view.background) : undefined;
    if (view.background && !bg) throw new Error(`battle scene: no battle background ${view.background}`);
    if (!bg) {
      // No art: a plain sky over a plain field.
      this.placeholders++;
      ctx.fillStyle = '#9cc8e8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#88c070';
      ctx.fillRect(0, this.origin.y + 96 * this.scale, canvas.width, canvas.height);
      return;
    }
    const img = this.image(bg[view.time]);
    if (!img) return;
    const k = this.scale;
    const { x: ox, y: oy } = this.origin;
    const h = SCENE.height * k;
    // Wider screens see more of the 512 px BG map, which wraps horizontally as the DS BG layer does.
    const mapW = img.width;
    for (let x = ox - Math.ceil(ox / (mapW * k)) * mapW * k; x < canvas.width; x += mapW * k) ctx.drawImage(img, 0, 0, mapW, SCENE.height, x, oy, mapW * k, h);
    // Above the scene its top row repeats (sky), below it its bottom row.
    if (oy > 0) ctx.drawImage(canvas, 0, oy, canvas.width, 1, 0, 0, canvas.width, oy);
    if (oy + h < canvas.height) ctx.drawImage(canvas, 0, oy + h - 1, canvas.width, 1, 0, oy + h, canvas.width, canvas.height - oy - h);
  }

  private drawPlatforms(view: BattleView): void {
    const terrain = view.terrain ? this.deps.registries().battleTerrains.get(view.terrain) : undefined;
    if (view.terrain && !terrain) throw new Error(`battle scene: no battle terrain ${view.terrain}`);
    const sides = [
      { p: terrain?.enemy, dx: view.platforms.enemyDx, x: 192, y: 88 },
      { p: terrain?.player, dx: view.platforms.playerDx, x: 64, y: 136 },
    ];
    for (const { p, dx, x, y } of sides) {
      if (p) this.cell(this.sheet(p[view.time]), 0, p.x + dx, p.y);
      else {
        this.placeholders++;
        this.ctx.fillStyle = '#6aa056';
        const k = this.scale;
        this.ctx.beginPath();
        this.ctx.ellipse(this.origin.x + (x + dx) * k, this.origin.y + y * k, 56 * k, 12 * k, 0, 0, Math.PI * 2);
        this.ctx.fill();
      }
    }
  }

  /** An opposing trainer's front sprite (its first cell) on its spot, slid by `dx`. */
  private drawEnemyTrainer(t: NonNullable<BattleView['enemyTrainer']>, at: { x: number; y: number }): void {
    const s = this.sheet(this.deps.registries().trainerSprites.get(t.class)?.front);
    if (s) this.cell(s, 0, at.x + t.dx, at.y);
  }

  /** A trainer's back sprite (the player's, an AI partner's) on its spot: its throw frame while it throws. */
  private drawTrainer(t: NonNullable<BattleView['trainer']>, at: { x: number; y: number }): void {
    const record = this.deps.registries().trainerSprites.get(t.class);
    const s = this.sheet(record?.back);
    if (!s) return;
    let cell = 0;
    const anim = s.sheet.animations?.[1];
    if (t.throwTick !== null && anim) {
      let left = t.throwTick;
      cell = anim.frames[anim.frames.length - 1]!.cell;
      for (const f of anim.frames) {
        if (left < f.ticks) {
          cell = f.cell;
          break;
        }
        left -= f.ticks;
      }
    }
    this.cell(s, cell, at.x + t.dx, at.y);
  }

  /**
   * The thrown ball: the ROM's `battle/ball_throws/<ball>` cells (decomp ov12_02235E94: spinning, then the
   * opening), tilted for the shakes; a plain ball for balls without art (the fixture, mods).
   */
  private drawBall(ball: NonNullable<BattleView['ball']>): void {
    const name = ball.throw ?? ball.item.slice(ball.item.indexOf(':') + 1).replace(/^ITEM_/, '').toLowerCase();
    const id = this.ns(`ui2d/battle/ball_throws/${name}`);
    const s = this.deps.registries().ui2d.has(id) ? this.sheet(id) : null;
    const k = this.scale;
    const { ctx } = this;
    ctx.save();
    // The DS rotates the ball's affine OAM about its centre, the cell origin.
    ctx.translate(this.origin.x + ball.x * k, this.origin.y + ball.y * k);
    ctx.rotate(ball.tilt * Math.PI * 2);
    ctx.globalAlpha = ball.alpha;
    const anim = s?.sheet.animations?.[ball.anim];
    if (s && anim) {
      // The frame at `tick` (looping animations wrap; forward ones hold the last frame).
      const total = anim.frames.reduce((n, f) => n + f.ticks, 0);
      let left = anim.mode === 'loop' ? ball.tick % total : ball.tick;
      let frame = anim.frames[anim.frames.length - 1]!;
      for (const f of anim.frames) {
        if (left < f.ticks) {
          frame = f;
          break;
        }
        left -= f.ticks;
      }
      const c = s.sheet.cells[frame.cell]!;
      // Darkened (the DS fades the ball's palette toward black) on a copy of the cell.
      const g = this.scratchCtx(c.w, c.h);
      g.drawImage(s.img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
      if (ball.shade > 0) {
        g.globalCompositeOperation = 'source-atop';
        g.globalAlpha = ball.shade;
        g.fillStyle = '#000';
        g.fillRect(0, 0, c.w, c.h);
      }
      ctx.drawImage(this.scratch, 0, 0, c.w, c.h, -c.ox * k, -c.oy * k, c.w * k, c.h * k);
    } else if (!s) {
      ctx.fillStyle = '#e04838';
      ctx.beginPath();
      ctx.arc(0, 0, 6 * k, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#f8f8f0';
      ctx.beginPath();
      ctx.arc(0, 0, 6 * k, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#383838';
      ctx.fillRect(-6 * k, -k / 2, 12 * k, k);
    }
    ctx.restore();
    if (ball.stars !== null) this.drawStars(name, ball.x, ball.y, ball.stars);
  }

  /** The scratch canvas cleared at w×h, its context reset. */
  private scratchCtx(w: number, h: number): CanvasRenderingContext2D {
    const c = this.scratch;
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    return g;
  }

  /**
   * The caught ball's stars, `tick` ticks after they came out at DS (x, y): the ROM emitter (see STARS)
   * run once per tick with its texture from `battle/ball_stars/<ball>`, tinted by its colour curve; a plain
   * star where the pack has no texture. A faithful simple version of the SPL particle (move animations run SPA files).
   */
  private drawStars(ball: string, x: number, y: number, tick: number): void {
    const id = this.ns(`ui2d/battle/ball_stars/${ball}`);
    const s = this.deps.registries().ui2d.has(id) ? this.sheet(id) : null;
    const k = this.scale;
    const { ctx } = this;
    // The particles step once a game frame (30 Hz, like the rest of the battle): a tick is a frame.
    for (const p of starParticles(tick)) {
      ctx.save();
      ctx.translate(this.origin.x + (x + p.x) * k, this.origin.y + (y + p.y) * k);
      ctx.rotate(p.angle);
      ctx.globalAlpha = p.alpha;
      const size = STARS.size * k;
      if (s) {
        const c = s.sheet.cells[0]!;
        const g = this.scratchCtx(c.w, c.h);
        g.drawImage(s.img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = p.color;
        g.fillRect(0, 0, c.w, c.h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(s.img, c.x, c.y, c.w, c.h, 0, 0, c.w, c.h);
        ctx.drawImage(this.scratch, 0, 0, c.w, c.h, -size / 2, -size / 2, size, size);
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const r = (i % 2 ? 0.2 : 0.5) * size;
          ctx.lineTo(Math.sin((i * Math.PI) / 4) * r, -Math.cos((i * Math.PI) / 4) * r);
        }
        ctx.fill();
      }
      ctx.restore();
    }
  }

  /**
   * A battler's sprite: its place, the battle's offsets (slides, faint drop, hit shake) and the move
   * animation's changes (`anim`: offset, scale and rotation about the sprite's centre, palette fade,
   * translucency, hiding). `copy` draws one of the animation's copies of the sprite instead, offset by it.
   */
  private drawBattler(b: BattlerView, anim: AnimBattlerView | null, copy?: AnimSpriteView): void {
    if (!b.visible) return;
    const t: AnimBattlerView | null = copy ? { battler: b.battler, dx: copy.x, dy: copy.y, scaleX: copy.scaleX, scaleY: copy.scaleY, rotation: copy.rotation, pivotX: 0, pivotY: 0, hidden: false, fade: copy.fade, alpha: copy.alpha } : anim;
    const pos = this.place(b);
    // Another battler's picture in its place (Transform, Role Play), at that picture's height.
    const look = b.look ?? b;
    const picture = (copy ? copy.picture : anim?.picture) ?? { battler: b.battler, species: look.species, form: look.form, back: b.side !== 'enemy' };
    const { form, face, img } = this.picture(picture);
    const mosaic = copy?.mosaic ?? 0;
    const k = this.scale;
    const cx = pos.x + b.dx + (t?.dx ?? 0);
    const top = pos.y + (face?.yOffset ?? 0) - 40 + (t?.dy ?? 0);
    const { ctx } = this;
    ctx.save();
    if (!applyBattlerTransform(ctx, t, { x: this.origin.x + cx * k, y: this.origin.y + (top + 40) * k, k })) {
      ctx.restore();
      return;
    }
    if (t?.cropBottom) {
      ctx.beginPath();
      ctx.rect(this.origin.x + (cx - 40) * k, this.origin.y + top * k, 80 * k, (80 - t.cropBottom) * k);
      ctx.clip();
    }
    if (t?.partial) {
      ctx.beginPath();
      ctx.rect(this.origin.x + (cx - 40 + t.partial.x) * k, this.origin.y + (top + t.partial.y) * k, t.partial.w * k, t.partial.h * k);
      ctx.clip();
    }
    // Fainting: the sprite sinks behind its own baseline (an animation's scaled sprite is not clipped).
    if (b.introShade === undefined && (!t || b.clip)) {
      ctx.beginPath();
      ctx.rect(this.origin.x + (cx - 40) * k, this.origin.y + top * k, 80 * k, 80 * k);
      ctx.clip();
    }
    if (!form || !face) {
      // No art: a placeholder disc.
      this.placeholders++;
      ctx.fillStyle = b.flash ? '#fff' : b.side === 'enemy' ? '#c06040' : '#4060c0';
      ctx.beginPath();
      ctx.arc(this.origin.x + cx * k, this.origin.y + (top + 52 + b.dy) * k, 24 * k * b.scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (img) {
      const s = b.scale;
      const x = cx - 40 * s;
      const y = top + 80 - 80 * s + b.dy;
      if (b.flash || t?.fade || b.introShade !== undefined || mosaic > 1) {
        const c = this.scratch;
        c.width = 80;
        c.height = 80;
        const g = c.getContext('2d')!;
        g.clearRect(0, 0, 80, 80);
        g.drawImage(img, 0, face.y, 80, 80, 0, 0, 80, 80);
        if (b.flash) {
          g.globalCompositeOperation = 'source-in';
          g.fillStyle = '#fff';
          g.fillRect(0, 0, 80, 80);
          g.globalCompositeOperation = 'source-over';
        } else fadeImage(g, 80, 80, b.introShade !== undefined ? { color: 0, amount: b.introShade * 16 } : (t?.fade ?? null));
        mosaicImage(g, 80, 80, mosaic);
        // Reduce flashing: the white flash is laid over the Pokémon at a capped alpha instead of replacing it.
        const alpha = ctx.globalAlpha;
        if (b.flash && reduceFlashing()) {
          this.blit(img, 0, face.y, 80, 80, x, y, s);
          ctx.globalAlpha = alpha * capFlash(1);
        }
        this.blit(c, 0, 0, 80, 80, x, y, s);
        ctx.globalAlpha = alpha;
      } else this.blit(img, 0, face.y, 80, 80, x, y, s);
    }
    ctx.restore();
  }

  /** Generic OAM cell with the NCER origin and NANR/callback transform resolved by the VM. */
  private drawAnimCell(sprite: AnimSpriteView): void {
    const s = this.sheet(sprite.sheet);
    if (!s) return;
    const cell = s.sheet.cells[sprite.cell!];
    if (!cell) throw new Error(`battle animation: missing cell ${sprite.cell} in ${sprite.sheet}`);
    const { ctx } = this;
    const k = this.scale;
    ctx.save();
    ctx.translate(this.origin.x + sprite.x * k, this.origin.y + sprite.y * k);
    ctx.rotate(sprite.rotation * 2 * Math.PI);
    ctx.scale(sprite.scaleX * k, sprite.scaleY * k);
    ctx.globalAlpha = sprite.alpha;
    if (sprite.fade) {
      const g = this.scratchCtx(cell.w, cell.h);
      g.drawImage(s.img, cell.x, cell.y, cell.w, cell.h, 0, 0, cell.w, cell.h);
      fadeImage(g, cell.w, cell.h, sprite.fade);
      ctx.drawImage(this.scratch, -cell.ox, -cell.oy);
    } else ctx.drawImage(s.img, cell.x, cell.y, cell.w, cell.h, -cell.ox, -cell.oy, cell.w, cell.h);
    ctx.restore();
  }

  /** A battler's place: its side's singles spot, or in doubles its battler's spot. */
  private place(b: BattlerView): { x: number; y: number; healthbox: { x: number; y: number } } {
    return this.doubles ? DOUBLES_POS[b.battler]! : POS[b.side];
  }

  private drawHealthbox(b: BattlerView, bob: number): void {
    const at0 = this.place(b).healthbox;
    const anchor = { x: at0.x, y: at0.y + bob };
    const doublesBox = this.doubles && b.side === 'player';
    const s = this.sheet(this.ns(`ui2d/battle/healthbox/${b.side === 'enemy' ? 'enemy' : doublesBox ? 'player_doubles' : 'player_singles'}`));
    const ax = anchor.x + b.healthbox.dx;
    if (!this.deps.registries().ui2d.has(this.ns('ui2d/battle/healthbox/parts'))) {
      this.placeholders++;
      this.drawPlainHealthbox(b, ax, anchor.y);
      return;
    }
    if (!s) return;
    const c = s.sheet.cells[0]!;
    this.healthboxes.push({
      battler: b.battler, x: ax - c.ox, y: anchor.y - 16, width: c.w,
      height: doublesBox || b.side === 'enemy' ? 32 : 40,
      hpDisplay: doublesBox ? b.healthbox.numbers ? 'numbers' : 'bar' : b.side === 'player' ? 'both' : 'bar',
    });
    // The sheet's own pixel (px, py) lands at DS (ax − ox + px, ay − oy + py).
    const at = (p: readonly [number, number]): [number, number] => [ax - c.ox + p[0], anchor.y - c.oy + p[1]];
    this.cell(s, 0, ax, anchor.y);
    if (b.side === 'player' && !doublesBox) {
      // The DS box runs off the right screen edge; beyond it (wide screens) its left frame, mirrored, closes it.
      const [x0, y0] = at([c.w, 0]);
      const k = this.scale;
      const ctx = this.ctx;
      ctx.save();
      ctx.translate(this.origin.x + (x0 + 8) * k, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(s.img, c.x + 18, c.y, 8, c.h, 0, this.origin.y + y0 * k, 8 * k, c.h * k);
      ctx.restore();
    }
    const L = HEALTHBOX[doublesBox ? 'playerDoubles' : b.side];
    const [nx, ny] = at(L.name);
    this.text(b.name, nx, ny, ['#f8f8f8', '#383838']);
    const [lx, ly] = at(L.level);
    const g = b.gender === 'male' ? 'male' : b.gender === 'female' ? 'female' : 'genderless';
    this.part(`level_${g}_top_0`, lx, ly);
    this.part(`level_${g}_top_1`, lx + 8, ly);
    this.part(`level_${g}_bottom_0`, lx, ly + 8);
    this.part(`level_${g}_bottom_1`, lx + 8, ly + 8);
    const N = NUMBERS[doublesBox ? 'playerDoubles' : b.side];
    this.numbers(String(b.level), ...at(N.level));
    const hp = gaugeCells(b.maxHp, b.hp, 6);
    const color = barColor(hp.pixels);
    const [gx, gy] = at(L.gauge);
    if (doublesBox && b.healthbox.numbers) {
      // healthbox.c's C00/C60/C80 and 4E0/CE0 transfers in this 128×64 cell.
      // Clear the gauge with its own fill tile before the transparent digit glyphs.
      for (let i = 0; i < 7; i++) this.part('status_healthy_0', gx + i * 8, gy);
      this.part('numbers_left', gx - 8, gy);
      this.part('numbers_right', gx + 56, gy);
      this.numbers(String(b.hp).padStart(3, ' '), gx, gy);
      this.part('slash', gx + 24, gy);
      this.numbers(String(b.maxHp), gx + 32, gy);
    } else hp.fill.forEach((n, i) => this.part(`hp_${color}_fill_${n}`, gx + i * 8, gy));
    if (b.status !== 'none') {
      const [sx, sy] = at(L.status);
      const st = b.status === 'toxic' ? 'poison' : b.status;
      for (let i = 0; i < 3; i++) this.part(`status_${st}_${i}`, sx + i * 8, sy);
    }
    if (b.side === 'enemy' && b.caught) {
      const [cx, cy] = at(HEALTHBOX.enemy.caught);
      this.part('caught_indicator', cx, cy);
    }
    if (b.side === 'player' && !doublesBox) {
      const P = HEALTHBOX.player;
      const [hx, hy] = at(NUMBERS.player.hp);
      this.numbers(String(b.hp).padStart(3, ' '), hx, hy);
      this.numbers(String(b.maxHp), ...at(NUMBERS.player.maxHp));
      if (b.exp) {
        const e = gaugeCells(b.exp.span, b.exp.into, 12);
        const [ex, ey] = at(P.exp);
        e.fill.forEach((n, i) => this.part(`exp_fill_${b.exp!.span ? n : 0}`, ex + i * 8, ey));
      }
    }
  }

  /**
   * The Safari healthbox (decomp HEALTHBOX_TYPE_SAFARI_ZONE, healthbox_safari): at the player's box's place, "SAFARI
   * BALLS" (HealthBox_DrawBallCount, VRAM 0x240: the sheet's 16, 16) over "Left: N" (HealthBox_DrawBallsLeftMessage,
   * 0x440: 16, 32; the count space-padded to 2 digits), both in the name's colours. It never bobs (Healthbox_Activate).
   */
  private drawSafariHealthbox(safari: NonNullable<BattleView['safari']>): void {
    const s = this.sheet(this.ns('ui2d/battle/healthbox/safari'));
    if (!s) return;
    const c = s.sheet.cells[0]!;
    const ax = POS.player.healthbox.x + safari.healthbox.dx;
    const ay = POS.player.healthbox.y;
    this.cell(s, 0, ax, ay);
    const text = (name: string, slots: string[] = []) => {
      const t = this.deps.registries().texts.get(this.ns(`BattleStrings_Text_${name}`));
      if (!t) throw new Error(`battle scene: the packs have no text BattleStrings_Text_${name}`);
      return plainText(t.text, slots);
    };
    const ink: [string, string] = ['#f8f8f8', '#383838'];
    this.text(text('SafariBalls'), ax - c.ox + 16, ay - c.oy + 16, ink);
    this.text(text('SafariBallsLeft', [String(safari.balls).padStart(2, ' ')]), ax - c.ox + 16, ay - c.oy + 32, ink);
  }

  /** Packs without the healthbox art: a plain box with the same contents. */
  private drawPlainHealthbox(b: BattlerView, ax: number, ay: number): void {
    const x = b.side === 'enemy' ? ax - 56 : ax - 40;
    const y = ay - 20;
    const w = b.side === 'enemy' ? 112 : 104;
    this.fill('#384050', x, y, w, b.side === 'player' ? 40 : 30);
    this.fill('#e8e8d8', x + 2, y + 2, w - 4, (b.side === 'player' ? 40 : 30) - 4);
    this.text(b.name, x + 6, y + 2, ['#383838', '#c8c8c0']);
    this.text(`${levelMark(dexOf(this.deps.registries()).language)}${b.level}`, x + w - 34, y + 2, ['#383838', '#c8c8c0']);
    const hp = gaugeCells(b.maxHp, b.hp, 6);
    const doublesBox = this.doubles && b.side === 'player';
    if (!doublesBox || !b.healthbox.numbers) {
      this.fill('#383838', x + w - 56, y + 20, 50, 4);
      this.fill({ green: '#40c040', yellow: '#e0c020', red: '#e04030' }[barColor(hp.pixels)], x + w - 55, y + 21, hp.pixels, 2);
    }
    if (b.side === 'player' && (!doublesBox || b.healthbox.numbers)) this.text(`${b.hp}/${b.maxHp}`, x + w - 48, y + (doublesBox ? 20 : 24), ['#383838', '#c8c8c0']);
  }

  /** Healthbox numbers at DS (x, y), 8 px per character; spaces are left blank. */
  private numbers(s: string, x: number, y: number): void {
    const sheet = this.sheet(this.ns('ui2d/battle/healthbox/digits'));
    if (!sheet) return;
    [...s].forEach((ch, i) => {
      if (ch === ' ') return;
      const n = sheet.sheet.names!.indexOf(ch);
      if (n < 0) throw new Error(`battle scene: no healthbox digit ${ch}`);
      this.cell(sheet, n, x + i * 8, y);
    });
  }

  /** One line of the message font at DS (x, y), recoloured to fg / shadow. */
  private text(s: string, x: number, y: number, colors: [string, string]): void {
    const font = tinted(this.deps.font(), colors);
    drawText(this.ctx, font, s, this.origin.x + x * this.scale, this.origin.y + y * this.scale, this.scale);
  }

  private drawTextbox(view: BattleView): void {
    const frame = this.deps.registries().ui2d.get(this.ns(messageFrame(this.deps.frame())));
    const r = TEXTBOX;
    if (frame?.nineSlice) {
      const img = this.image(frame.atlas);
      if (img) this.nineSlice(img, frame, r.x, r.y, r.width, r.height);
    } else {
      this.fill('#484850', r.x - 6, r.y - 6, r.width + 12, r.height + 12);
      this.fill('#f8f8f8', r.x - 3, r.y - 3, r.width + 6, r.height + 6);
    }
    const m = view.message;
    if (!m) return;
    m.text.split('\n').slice(0, 2).forEach((line, i) => this.text(line, r.x, r.y + i * 16, ['#484848', '#d0d0c8']));
  }

  /** The window frame around an interior rect: corners, repeated edges, and the centre as the fill. */
  private nineSlice(img: Img, s: Ui2dSheet, x: number, y: number, w: number, h: number): void {
    const [l, t, r, b] = s.nineSlice!;
    const c = s.cells[0]!;
    const cw = c.w - l - r;
    const ch = c.h - t - b;
    const X = x - l;
    const Y = y - t;
    const W = w + l + r;
    const H = h + t + b;
    // Rows: top band, middle (repeated), bottom band; each band's columns the same way.
    const rows: [number, number, number, number][] = [[c.y, t, Y, t]];
    for (let yy = 0; yy < h; yy += ch) rows.push([c.y + t, Math.min(ch, h - yy), Y + t + yy, Math.min(ch, h - yy)]);
    rows.push([c.y + c.h - b, b, Y + H - b, b]);
    for (const [sy, sh, dy] of rows) {
      this.blit(img, c.x, sy, l, sh, X, dy);
      for (let xx = 0; xx < w; xx += cw) this.blit(img, c.x + l, sy, Math.min(cw, w - xx), sh, X + l + xx, dy);
      this.blit(img, c.x + c.w - r, sy, r, sh, X + W - r, dy);
    }
  }
}

/**
 * The caught stars' emitter (ball_particle.narc catch_<ball>.spa, the same in every ball; the importer checks
 * it): 3 particles evenly on a 0.0745-unit circle around the axis (0, 0.989, 0.147), shot 0.093 units/frame
 * outward and 0.242 along the axis, gravity 0.0178 units/frame² down, air resistance 123/128, 19 frames each,
 * billboards 2 × 0.356 units wide with a random spin of up to ±1340/65536 turn per frame; alpha 1 → 31 by 30 %
 * of the life, back to 1 from 70 %; colour white → BGR555 0x4fff (pale yellow) at 50 % → white, between 20 %
 * and 80 %. The battle camera shows 172/4096 units per DS px (ov12_02236648); depth is dropped.
 */
const STARS = (() => {
  const px = 4096 / 172;
  return { count: 3, radius: (305 / 4096) * px, out: (381 / 4096) * px, up: (990 / 4096) * px, gravity: (73 / 4096) * px, air: 123 / 128, life: 19, size: 2 * (1457 / 4096) * px, tilt: [0.989, 0.147] as const, spin: [0.013, -0.019, 0.007] };
})();

/** The stars `f` DS frames after they came out, relative to the ball (DS px, y down). */
function starParticles(f: number): { x: number; y: number; angle: number; alpha: number; color: string }[] {
  if (f >= STARS.life) return [];
  const t = f / STARS.life;
  const alpha = (t < 0.3 ? 1 + (30 * t) / 0.3 : t > 0.7 ? 31 - (30 * (t - 0.7)) / 0.3 : 31) / 31;
  const mix = t < 0.2 || t > 0.8 ? 0 : t < 0.5 ? (t - 0.2) / 0.3 : (0.8 - t) / 0.3;
  const color = `rgb(255 255 ${Math.round(255 - (255 - 156) * mix)})`;
  const [ay, az] = STARS.tilt;
  return Array.from({ length: STARS.count }, (_, i) => {
    // On the circle around the axis: its x and the in-plane direction perpendicular to x and the axis.
    const phi = (i * 2 * Math.PI) / STARS.count;
    const dir = { x: Math.cos(phi), y: -az * Math.sin(phi) };
    let x = dir.x * STARS.radius;
    let y = dir.y * STARS.radius;
    let vx = dir.x * STARS.out;
    let vy = dir.y * STARS.out + ay * STARS.up;
    for (let n = 0; n < f; n++) {
      vy -= STARS.gravity;
      vx *= STARS.air;
      vy *= STARS.air;
      x += vx;
      y += vy;
    }
    return { x, y: -y, angle: (i / STARS.count + f * STARS.spin[i]!) * 2 * Math.PI, alpha, color };
  });
}

/** The screen slice (encounter_effect_core.c GRASS_*): DS frames, rows per band, and its two quadratic moves. */
const SLICE = { frames: 13, lowerRows: 5, higherRows: 2, first: { frames: 7, speed: -12 }, second: { frames: 6, speed: 30, to: 255 } };

/** The slice's sideways offset in DS px, `f` DS frames in (QuadraticInterpolationTaskFX32: x0 + v0·s + a·s²/2, ending at the target). */
function sliceOffset(f: number, higher: boolean): number {
  const quad = (s: number, from: number, to: number, speed: number, steps: number) => {
    const a = (2 * (to - from - speed * steps)) / (steps * steps);
    return from + speed * s + (a * s * s) / 2;
  };
  const rest = higher ? -3 : -2;
  const { first, second } = SLICE;
  return Math.floor(f <= first.frames ? quad(f, 0, rest, first.speed, first.frames) : quad(Math.min(f - first.frames, second.frames), rest, second.to, second.speed, second.frames));
}

const tintCache = new WeakMap<LoadedFont, Map<string, LoadedFont>>();

/** The font atlas recoloured (its dark ink → fg, its light shadow → shadow). */
function tinted(font: LoadedFont, [fg, shadow]: [string, string]): LoadedFont {
  let byFont = tintCache.get(font);
  if (!byFont) tintCache.set(font, (byFont = new Map()));
  const key = `${fg}/${shadow}`;
  const hit = byFont.get(key);
  if (hit) return hit;
  const src = font.image as ImageBitmap;
  const c = document.createElement('canvas');
  c.width = src.width;
  c.height = src.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [f, s] = [rgb(fg), rgb(shadow)];
  for (let i = 0; i < img.data.length; i += 4) {
    if (!img.data[i + 3]) continue;
    const col = img.data[i]! < 140 ? f : s;
    img.data.set(col, i);
  }
  g.putImageData(img, 0, 0);
  const out = { ...font, image: c };
  byFont.set(key, out);
  return out;
}
