/**
 * The battle command card: the DS bottom screen as an overlay card, shown only while the battle waits
 * for a choice (docs/decisions.md: single screen; docs/research/battles.md §4). Its buttons are the ROM's touch
 * screen buttons (`ui2d/battle/buttons/*`, nine-slices): FIGHT over BAG, RUN and POKéMON; FIGHT opens
 * the four moves; a level-up with four moves known asks which to forget; YES / NO. Keys and gamepad
 * drive the battle's own cursor (`Battle.step`), which the card shows; a tap or click answers directly
 * (`battleChoose`), or opens the move list.
 *
 * The move list is the DS move-select screen: four equal buttons in a 2×2 grid (empty slots drawn
 * blank), each in its type's colours with the name on top and the type and PP (coloured as the DS does)
 * under it, and CANCEL beside them (under them when the card is `tall`).
 *
 * Over the scene (wide screens) the card covers the textbox and carries its prompt as a header, but for
 * the move lists (the DS move-select screen has none). Under the scene (`tall`, phones in portrait) the scene
 * keeps its textbox and the card has no header. The card's text and art scale is the largest crisp scale
 * (up to the caller's) at which nothing in the card overflows.
 */
import type { Id } from '@opensinnoh/core';
import type { AssetRef, AssetSource, BattleChoice, BattleMoveView, BattlePrompt, BattleView, Registries, Ui2dSheet } from '@opensinnoh/contracts';
import type { Game } from '@opensinnoh/game';
import { ppColor } from '@opensinnoh/battle/formulas';
import { el } from '../ui/core.ts';
import { Art, hpColor, ICON_ANIM } from '../ui/art.ts';
import type { Palette, PixelFont } from '../ui/pixel-font.ts';
import type { CardStrings } from './strings.ts';

export interface CardDeps {
  game(): Game;
  font(): PixelFont;
  strings(): CardStrings;
  assets: AssetSource;
  /** Presses B for one tick (the card's back button while keys opened the move list). */
  pressB(): void;
}

/** Low PP (`ppColor`): the DS's yellow, orange and red inks, deepened to read on the buttons' cream panel. */
const PP_PALETTE: Record<'yellow' | 'orange' | 'red', Palette> = {
  yellow: ['#b08000', '#f0e0a0'],
  orange: ['#d05800', '#f8c8a0'],
  red: ['#d01810', '#f8b8b0'],
};

/** The target screen's cursor on CANCEL (BattlePrompt `target`). */
const TARGET_CANCEL = 4;

export class BattleCard {
  readonly el = el('div', 'battle-card');
  private key = '';
  /** A button of the card shown answered (`chooser`). */
  private answered = false;
  private readonly pokemonArt: Art;
  private readonly loadedIcons = new Set<AssetRef>();
  private targetsKey = '';
  private readonly icons = new Map<string, HTMLCanvasElement>();
  private iconAtlas: ImageBitmap | null = null;
  /** Button art: object URL per atlas, once decoded. */
  private readonly art = new Map<AssetRef, string | null>();
  /** Art still loading (type icons, button atlases). */
  private readonly pending = new Set<AssetRef>();
  private artError: Error | null = null;
  /** The scale while building. */
  private dot = 2;
  /** The scale that fit the last layout (the prompt without its cursor, in the same box). */
  private fitted = { layout: '', dot: 0 };

  constructor(private readonly deps: CardDeps) {
    this.pokemonArt = new Art(() => deps.assets, () => deps.game().registries);
    this.el.hidden = true;
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Battle commands');
  }

  /**
   * Per frame, after the card was placed: shows the prompt (rebuilt only when it or the card's box changes).
   * `maxDot` is the largest scale; `tall`: the card is under the scene (phones in portrait).
   */
  update(view: BattleView | null, maxDot: number, tall: boolean): void {
    // The battle's menu apps (bag, party, naming, the Pokédex entry) draw themselves: no card meanwhile.
    const open = view?.prompt ?? null;
    const prompt = open?.kind === 'bag' || open?.kind === 'party' || open?.kind === 'naming' || open?.kind === 'pokedex' ? null : open;
    if (view) {
      this.loadArt();
      this.loadPokemonIcons(view);
    }
    this.targetsKey = prompt?.kind === 'target' ? JSON.stringify(view!.battlers.map(({ battler, species, form, hp, maxHp, status, name, gender }) => ({ battler, species, form, hp, maxHp, status, name, gender }))) : '';
    if (!prompt) {
      if (!this.el.hidden) {
        this.el.hidden = true;
        this.el.replaceChildren();
        this.key = '';
      }
      return;
    }
    this.el.classList.toggle('is-tall', tall);
    const mode = prompt.kind;
    const message = view?.message?.text ?? '';
    // The moves, the target screen and the move to forget fill the band: no header (the DS screens have none).
    const head = !tall && mode !== 'fight' && mode !== 'learn' && mode !== 'target';
    this.show(mode, head ? message : '', prompt, maxDot, () => (head ? [el('div', 'bc-head', this.label(message)), this.build(prompt, view!)] : [this.build(prompt, view!)]));
  }

  /**
   * Shows the card's content (`build`, at `this.dot`) unless it is already shown, at the largest scale at
   * which nothing overflows (whole device-pixel scales; the smallest when none fits).
   */
  private show(mode: string, message: string, prompt: BattlePrompt, maxDot: number, build: () => Node[]): void {
    this.el.hidden = false;
    const dpr = devicePixelRatio || 1;
    const cursor = 'cursor' in prompt ? prompt.cursor : -1;
    const st = this.el.style;
    const box = `${this.el.className}|${st.left},${st.top},${st.width},${st.height},${st.bottom},${st.maxHeight}|${dpr}|${maxDot}|${this.iconAtlas ? 1 : 0}`;
    const layout = `${mode}|${box}|${message}|${this.targetsKey}|${JSON.stringify('cursor' in prompt ? { ...prompt, cursor: 0 } : prompt)}`;
    if (`${layout}|${cursor}` === this.key) return;
    this.key = `${layout}|${cursor}`;
    this.answered = false;
    this.el.dataset.kind = mode;
    const maxPixel = Math.max(1, Math.floor(maxDot * dpr));
    const minPixel = Math.min(maxPixel, Math.max(1, Math.ceil(dpr)));
    const crisp = Array.from({ length: maxPixel - minPixel + 1 }, (_, i) => (maxPixel - i) / dpr);
    const dots = this.fitted.layout === layout ? [this.fitted.dot] : crisp;
    for (const dot of dots) {
      this.dot = dot;
      this.el.style.setProperty('--dot', `${dot}px`);
      this.el.replaceChildren(...build());
      if (this.fits()) break;
    }
    this.fitted = { layout, dot: this.dot };
  }

  /**
   * The buttons' way to answer: once per card shown. The battle takes the answer at its next tick, so a second click
   * before then (a double click) is ignored rather than answered twice.
   */
  private chooser(): { battleChoose(choice: BattleChoice): void } {
    const game = this.deps.game();
    return {
      battleChoose: (choice) => {
        if (this.answered) return;
        this.answered = true;
        game.battleChoose(choice);
      },
    };
  }

  /** Nothing in the card overflows its box: the card, its rows and grids, and every button. */
  private fits(): boolean {
    return [this.el, ...this.el.querySelectorAll<HTMLElement>('.bc-head, .bc-command, .bc-row, .bc-moves, .bc-targets, .bc-yesno, .bc-button')].every(
      (e) => e.scrollHeight <= e.clientHeight + 1 && e.scrollWidth <= e.clientWidth + 1,
    );
  }

  /** A button drawn with the ROM button `art` (`battle/buttons/<art>`). */
  private button(cls: string, art: string, cursor: boolean, ...content: Node[]): HTMLButtonElement {
    const b = el('button', `bc-button ${cls}${cursor ? ' is-cursor' : ''}`, ...content);
    b.type = 'button';
    this.frame(b, art);
    return b;
  }

  /** The nine-slice of `battle/buttons/<name>` as the element's border image, at the card's scale. */
  private frame(e: HTMLElement, name: string): void {
    const sheet = this.sheet(`battle/buttons/${name}`);
    const [l, t, r, b] = sheet.nineSlice!;
    e.style.setProperty('--slice', `${t} ${r} ${b} ${l}`);
    e.style.setProperty('--slice-w', `calc(var(--dot) * ${t}) calc(var(--dot) * ${r}) calc(var(--dot) * ${b}) calc(var(--dot) * ${l})`);
    const url = this.art.get(sheet.atlas);
    if (url) e.style.setProperty('--art', `url("${url}")`);
  }

  private sheet(path: string): Ui2dSheet {
    const reg: Registries = this.deps.game().registries;
    const ns = [...reg.newGame.keys()][0]!.split(':')[0]!;
    const sheet = reg.ui2d.get(`${ns}:ui2d/${path}` as Id);
    if (!sheet) throw new Error(`battle card: the packs have no ui2d sheet ${path}`);
    return sheet;
  }

  /** CANCEL in the move list: back to the commands (one B press when keys opened the list). */
  private back(p: BattlePrompt): HTMLButtonElement {
    const back = this.button('bc-back', 'cancel', false, this.label(this.deps.strings().t('battleCancel')));
    back.addEventListener('click', () => {
      if (p.kind === 'fight') this.deps.pressB();
      this.key = '';
    });
    return back;
  }

  /**
   * The doubles target screen (BattlePrompt `target`) as the DS draws it (decomp battle_subscreen.c target select, on
   * the ROM's buttons `battle/buttons/target_<id>`): enemy 2 and enemy 1 over player 1 and player 2, CANCEL beside them
   * (under them when tall). A battler the move can aim at shows its name and gender (BattleStrings 962/963) and is
   * the target; any other slot is the blank button. A group (spread, self) lights its battlers together, joined by
   * the screen's link bars (BattleSubscreen_DrawTargetSelectBg), and any of them confirms it.
   */
  private targetScreen(p: Extract<BattlePrompt, { kind: 'target' }>, view: BattleView): HTMLElement {
    const game = this.chooser();
    const aim = p.move.aim;
    if (!aim) throw new Error(`battle card: ${p.move.name} has no targets to choose from`);
    const root = el('div', `bc-targets${aim.group ? ' is-group' : ''}`);
    const lit = (b: number) => aim.targets.includes(b) && (aim.group ? p.cursor !== TARGET_CANCEL : p.cursor === b);
    for (const b of [3, 1, 0, 2]) {
      const target = aim.targets.includes(b) ? view.battlers.find((x) => x.battler === b) : undefined;
      const sign = target?.gender === 'male' ? '♂' : target?.gender === 'female' ? '♀' : '';
      const name: Node[] = target ? [this.label(`${target.name}${sign}`, b & 1 ? 'light' : 'ink')] : [];
      // BattleSubscreen_DrawTargetSelect: only eligible opponents have icons (slots 3/5).
      if (target && (b & 1)) {
        const anim = !target.hp ? ICON_ANIM.fainted : target.status !== 'none' ? ICON_ANIM.statused : ({ max: ICON_ANIM.hpMax, green: ICON_ANIM.hpGreen, yellow: ICON_ANIM.hpYellow, red: ICON_ANIM.hpRed }[hpColor(target.hp, target.maxHp)]);
        name.push(this.pokemonArt.pokemonIcon(target.species, target.form, anim, false));
      }
      const button = this.button(`bc-target bc-t${b}`, target ? `target_${b}` : `target_${b}_empty`, lit(b), ...name);
      button.dataset.battler = String(b);
      button.disabled = !target;
      if (target) {
        button.setAttribute('aria-label', target.name);
        button.addEventListener('click', () => game.battleChoose(aim.group ? { kind: 'move', slot: p.slot } : { kind: 'move', slot: p.slot, target: b }));
      }
      root.append(button);
    }
    // The link bars between grouped buttons: player 1 with player 2 and enemy 2, enemy 1 with player 2 and enemy 2.
    if (aim.group) {
      for (const [a, b] of [
        [0, 2],
        [0, 3],
        [1, 2],
        [1, 3],
      ] as const) {
        if (!aim.targets.includes(a) || !aim.targets.includes(b)) continue;
        const link = el('div', `bc-link bc-link-${Math.min(a, b)}${Math.max(a, b)}`);
        const url = this.art.get(this.sheet('battle/buttons/target_link').atlas);
        if (url) link.style.setProperty('--art', `url("${url}")`);
        root.append(link);
      }
    }
    const cancel = this.button('bc-back', 'cancel', p.cursor === TARGET_CANCEL, this.label(this.deps.strings().t('battleCancel')));
    cancel.addEventListener('click', () => game.battleChoose({ kind: 'cancel' }));
    root.append(cancel);
    return root;
  }

  private label(text: string, palette: Palette = 'light'): HTMLSpanElement {
    return this.deps.font().label(text, palette, this.dot);
  }

  private build(p: BattlePrompt, view: BattleView): HTMLElement {
    const s = this.deps.strings();
    const game = this.chooser();
    if (p.kind === 'command') {
      const button = (i: number, cls: string, text: string, onClick: () => void, art = cls.slice(3)) => {
        const b = this.button(cls, art, p.cursor === i, this.label(text));
        b.disabled = !p.enabled[i];
        b.addEventListener('click', onClick);
        return b;
      };
      // Safari (decomp BattleSubscreen_DrawActionMenu with BATTLE_TYPE_SAFARI): BALL, BAIT and MUD on the FIGHT, BAG and
      // POKéMON buttons, RUN as ever; no Pokémon icon.
      if (view.kind === 'safari') {
        const safari = (action: 'ball' | 'bait' | 'mud') => () => game.battleChoose({ kind: 'safari', action });
        return el(
          'div',
          'bc-command',
          button(0, 'bc-fight', s.t('battleBall'), safari('ball'), 'fight'),
          el('div', 'bc-row', button(1, 'bc-bag', s.t('battleBait'), safari('bait'), 'bag'), button(3, 'bc-run', s.t('battleRun'), () => game.battleChoose({ kind: 'run' })), button(2, 'bc-pokemon', s.t('battleMud'), safari('mud'), 'pokemon')),
        );
      }
      // The second battler of a double the player commands alone: RUN is CANCEL while the first's command can be
      // taken back (decomp isWaitingForPartner: BattleStrings_Text_Cancel on the RUN button, B too).
      const run = p.canRewind
        ? button(3, 'bc-run bc-rewind', s.t('battleCancel'), () => game.battleChoose({ kind: 'cancel' }), 'run')
        : button(3, 'bc-run', s.t('battleRun'), () => game.battleChoose({ kind: 'run' }));
      return el(
        'div',
        'bc-command',
        button(0, 'bc-fight', s.t('battleFight'), () => game.battleChoose({ kind: 'fight' })),
        el(
          'div',
          'bc-row',
          button(1, 'bc-bag', s.t('battleBag'), () => game.battleChoose({ kind: 'bag' })),
          run,
          button(2, 'bc-pokemon', s.t('battlePokemon'), () => game.battleChoose({ kind: 'party' })),
        ),
      );
    }
    if (p.kind === 'target') return this.targetScreen(p, view);
    if (p.kind === 'nickname' || p.kind === 'shift' || p.kind === 'next' || p.kind === 'learn-ask' || p.kind === 'forfeit') {
      // YES and NO. "Give a nickname?": YES opens the naming screen. SHIFT style's "Will you switch your
      // Pokémon?": YES opens the party, NO keeps the Pokémon in. "Use next Pokémon?": YES opens the party, NO runs.
      // The move-learn questions ("Make it forget another move?", "Should it give up?"): `answer`.
      const [yes, no]: [() => void, () => void] =
        p.kind === 'learn-ask' || p.kind === 'forfeit'
          ? [() => game.battleChoose({ kind: 'answer', yes: true }), () => game.battleChoose({ kind: 'answer', yes: false })]
          : p.kind === 'nickname'
            ? [() => game.battleChoose({ kind: 'nickname', give: true }), () => game.battleChoose({ kind: 'nickname', give: false })]
            : p.kind === 'shift'
              ? [() => game.battleChoose({ kind: 'party' }), () => game.battleChoose({ kind: 'keep' })]
              : [() => game.battleChoose({ kind: 'party' }), () => game.battleChoose({ kind: 'run' })];
      const answer = (i: 0 | 1, art: 'yes' | 'no', text: string, onClick: () => void) => {
        const b = this.button('bc-answer', art, p.cursor === i, this.label(text));
        b.addEventListener('click', onClick);
        return b;
      };
      return el('div', 'bc-yesno', answer(0, 'yes', s.t('battleYes'), yes), answer(1, 'no', s.t('battleNo'), no));
    }
    if (p.kind !== 'fight' && p.kind !== 'learn') throw new Error(`battle card: no card for the ${p.kind} prompt`);
    if (p.kind === 'learn') {
      const root = el('div', 'bc-moves bc-learn');
      p.moves.forEach((m, i) => root.append(this.move(m, p.cursor === i, () => game.battleChoose({ kind: 'forget', slot: i }))));
      root.append(this.move(p.move, p.cursor === p.moves.length, () => game.battleChoose({ kind: 'keep' }), 'bc-new'));
      return root;
    }
    const cursor = p.kind === 'fight' ? p.cursor : -1;
    const root = el('div', 'bc-moves');
    // In a double the battle answers a move picked here with its target screen.
    p.moves.forEach((m, i) => root.append(this.move(m, cursor === i, () => game.battleChoose({ kind: 'move', slot: i }))));
    // The DS draws the slots without a move as blank buttons.
    for (let i = p.moves.length; i < 4; i++) {
      const empty = el('div', 'bc-button bc-move is-empty');
      this.frame(empty, 'move_empty');
      root.append(empty);
    }
    root.append(this.back(p));
    return root;
  }

  private move(m: BattleMoveView, cursor: boolean, onClick: () => void, extra = ''): HTMLButtonElement {
    const s = this.deps.strings();
    const type = m.type.slice(m.type.indexOf(':') + 1).replace(/^TYPE_/, '').toLowerCase();
    const level = ppColor(m.pp, m.maxPp);
    const ppInk = level === 'normal' ? 'ink' : PP_PALETTE[level];
    const pp = el('span', 'bc-pp', this.label(s.t('battlePp'), ppInk), this.label(`${m.pp}/${m.maxPp}`, ppInk));
    pp.dataset.pp = level;
    const b = this.button(`bc-move${extra ? ` ${extra}` : ''}`, `move_${type}`, cursor, el('span', 'bc-name', this.label(m.name, 'ink')), el('span', 'bc-info', this.typeIcon(type), pp));
    // Every move can be pressed (decomp: the move list draws 0 PP in red only): the battle refuses one that can't be
    // used now with its message.
    b.setAttribute('aria-label', `${m.name}, ${type}, PP ${m.pp} of ${m.maxPp}`);
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * The type icons or button art still loading (the battle's preload holds the game on the cut-in's black
   * screen meanwhile); throws if one failed to load.
   */
  loading(): boolean {
    if (this.artError) throw this.artError;
    return this.pending.size > 0;
  }

  /** The art still loading (for the hold watchdog's error). */
  loadingArt(): AssetRef[] {
    return [...this.pending];
  }

  /** Warm the active opponents' form icons before the target screen, with the same load/error gate as the buttons. */
  private loadPokemonIcons(view: BattleView): void {
    for (const b of view.battlers) {
      if (b.side !== 'enemy') continue;
      const sprites = this.deps.game().registries.pokemonSprites.get(b.species);
      if (!sprites) continue;
      const ref = (sprites.forms[b.form] ?? sprites.forms[0]!).icon;
      if (this.loadedIcons.has(ref)) continue;
      this.loadedIcons.add(ref);
      this.pending.add(ref);
      void this.pokemonArt.image(ref)
        .catch((e: unknown) => {
          this.artError ??= new Error(`battle card: cannot load ${ref}`, { cause: e });
        })
        .finally(() => {
          this.pending.delete(ref);
          this.key = '';
        });
    }
  }

  /** Starts loading the type icon atlas and the button art once a battle shows. */
  private loadArt(): void {
    if (this.art.size) return;
    const reg: Registries = this.deps.game().registries;
    const ns = [...reg.newGame.keys()][0]!.split(':')[0]!;
    /** Counts `ref` as loading until `done` settles; a failure is kept for `loading` to throw. */
    const track = (ref: AssetRef, done: Promise<void>) => {
      this.art.set(ref, null);
      this.pending.add(ref);
      void done
        .catch((e: unknown) => {
          this.artError ??= new Error(`battle card: cannot load ${ref}: ${(e as Error).message}`, { cause: e });
        })
        .finally(() => this.pending.delete(ref));
    };
    const icons = this.sheet('battle/type_icons');
    track(
      icons.atlas,
      this.deps.assets
        .get(icons.atlas)
        .then((blob) => createImageBitmap(blob))
        .then((img) => {
          this.iconAtlas = img;
          this.key = '';
        }),
    );
    for (const [id, sheet] of reg.ui2d) {
      if (!id.startsWith(`${ns}:ui2d/battle/buttons/`) || this.art.has(sheet.atlas)) continue;
      track(
        sheet.atlas,
        this.deps.assets.get(sheet.atlas).then(async (blob) => {
          const url = URL.createObjectURL(blob);
          const img = new Image();
          img.src = url;
          await img.decode();
          this.art.set(sheet.atlas, url);
          this.key = '';
        }),
      );
    }
  }

  /** The ROM's type icon (ui2d battle/type_icons) at the card's scale; a blank of its size while loading. */
  private typeIcon(type: string): Node {
    const scale = this.dot;
    const sheet = this.sheet('battle/type_icons');
    if (!this.iconAtlas) return el('span', 'bc-icon-pending');
    const c = sheet.cells[sheet.names?.indexOf(type) ?? -1];
    if (!c) throw new Error(`battle card: no type icon ${type}`);
    const key = `${type}@${scale}@${devicePixelRatio}`;
    const cached = this.icons.get(key);
    if (cached) return copyCanvas(cached);
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.round(scale * dpr));
    const canvas = document.createElement('canvas');
    canvas.width = c.w * k;
    canvas.height = c.h * k;
    canvas.style.width = `${(c.w * k) / dpr}px`;
    canvas.style.height = `${(c.h * k) / dpr}px`;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.iconAtlas, c.x, c.y, c.w, c.h, 0, 0, c.w * k, c.h * k);
    canvas.setAttribute('aria-hidden', 'true');
    this.icons.set(key, canvas);
    return copyCanvas(canvas);
  }
}

/** A drawn copy (cloneNode copies a canvas element, not its pixels). */
function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const copy = document.createElement('canvas');
  copy.width = src.width;
  copy.height = src.height;
  copy.style.cssText = src.style.cssText;
  copy.setAttribute('aria-hidden', 'true');
  copy.getContext('2d')!.drawImage(src, 0, 0);
  return copy;
}
