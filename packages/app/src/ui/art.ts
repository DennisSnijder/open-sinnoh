/**
 * ROM 2D art in the DOM UI (the importer's ui2d records): Pokémon icons, item icons, window frames and the
 * healthbox parts, drawn whole-pixel on the dot grid (`image-rendering: pixelated`). A pack without a
 * picture (the fixture has no Pokémon icons or healthbox parts) gets our own placeholder, drawn the same size.
 */
import type { AssetRef, AssetSource, Registries, Ui2dSheet } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { speciesPlaceholder } from './icons.ts';

/** POKEICON_ANIM_* (pokemon_icon.h): the icon animation by HP (decomp CalcMemberIconAnim). */
export const ICON_ANIM = { fainted: 0, hpMax: 1, hpGreen: 2, hpYellow: 3, hpRed: 4, statused: 5 } as const;
/** HP bar width in px (decomp HealthBar_PixelCount with 48) and its colour thresholds (HealthBar_Color). */
export const HP_BAR_PIXELS = 48;

export function hpPixels(hp: number, max: number): number {
  if (hp <= 0) return 0;
  return Math.max(1, Math.floor((hp * HP_BAR_PIXELS) / max));
}

/** Decomp HealthBar_Color over 48 px: full, green (> 24), yellow (> 9), red. */
export function hpColor(hp: number, max: number): 'max' | 'green' | 'yellow' | 'red' {
  if (hp === max) return 'max';
  const px = hpPixels(hp, max);
  return px > 24 ? 'green' : px > 9 ? 'yellow' : 'red';
}

export class Art {
  private readonly urls = new Map<string, Promise<string>>();
  private readonly images = new Map<string, Promise<HTMLImageElement>>();
  private readonly edges = new Map<string, Promise<{ top: string; bottom: string; left: (string | null)[]; right: (string | null)[] }>>();

  constructor(
    private readonly assets: () => AssetSource,
    private readonly registries: () => Registries,
  ) {}

  /** An asset's bytes (sound data the UI reads: the Pokédex cry page's wave and sequence). */
  async bytes(ref: AssetRef): Promise<Uint8Array> {
    return new Uint8Array(await (await this.assets().get(ref)).arrayBuffer());
  }

  url(ref: AssetRef): Promise<string> {
    let u = this.urls.get(ref);
    if (!u) this.urls.set(ref, (u = this.assets().get(ref).then((blob) => URL.createObjectURL(blob))));
    return u;
  }

  image(ref: AssetRef): Promise<HTMLImageElement> {
    let p = this.images.get(ref);
    if (!p)
      this.images.set(
        ref,
        (p = this.url(ref).then(
          (src) =>
            new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = () => reject(new Error(`ui: cannot decode ${ref}`));
              img.src = src;
            }),
        )),
      );
    return p;
  }

  /** An element whose background is the asset (set once it loads); sized by CSS. */
  background(el: HTMLElement, ref: AssetRef): HTMLElement {
    void this.url(ref).then((src) => (el.style.backgroundImage = `url("${src}")`));
    return el;
  }

  sheet(path: string): Ui2dSheet | undefined {
    const ns = [...this.registries().newGame.keys()][0]!.split(':')[0]!;
    return this.registries().ui2d.get(`${ns}:ui2d/${path}` as Id);
  }

  /**
   * A Pokémon's party icon (two 32×32 frames, top first), animated with the shared icon animation
   * (`ui2d/pokemon/icon_frames`, POKEICON_ANIM_*): CSS steps between the frames at the NANR's speed.
   */
  pokemonIcon(species: Id, form: number, anim: number, egg: boolean): HTMLElement {
    const reg = this.registries();
    if (egg) form = species.endsWith(':SPECIES_MANAPHY') ? 1 : 0;
    // Eggs use the egg record's icon (decomp PokeIconSpriteIndex: ICON_EGG).
    const sprites = reg.pokemonSprites.get(egg ? (`${species.split(':')[0]}:SPECIES_EGG` as Id) : species);
    const box = document.createElement('span');
    box.className = 'mon-icon-box';
    box.setAttribute('aria-hidden', 'true');
    if (!sprites) {
      box.append(speciesPlaceholder(species));
      return box;
    }
    const icon = document.createElement('span');
    icon.className = 'mon-icon-sprite';
    this.background(icon, (sprites.forms[form] ?? sprites.forms[0]!).icon);
    const seq = this.sheet('pokemon/icon_frames')?.animations?.[anim];
    if (seq && seq.frames.length > 1) {
      const flips = seq.frames.some((f) => f.cell === 1);
      const ticks = seq.frames.reduce((n, f) => n + f.ticks, 0);
      icon.style.setProperty('--icon-period', `${(ticks / 30).toFixed(3)}s`);
      icon.classList.add(flips ? 'icon-flip' : 'icon-shake');
    }
    box.append(icon);
    return box;
  }

  /** A 32×32 item icon (1 CSS px per DS px in lists, `big` = one dot per DS px). */
  itemIcon(item: Id, big = false): HTMLElement {
    const rec = this.registries().items.get(item);
    if (!rec) throw new Error(`ui: unknown item ${item}`);
    const el = document.createElement('span');
    el.className = big ? 'item-icon big' : 'item-icon';
    el.setAttribute('aria-hidden', 'true');
    return this.background(el, rec.icon);
  }

  /**
   * Draws cells of a sheet (by name, or by index) left to right on a canvas (one DS px = `scale` CSS px,
   * whole device pixels). Returns null when the pack has no such sheet.
   */
  cells(path: string, names: (string | number)[], scale: number): HTMLCanvasElement | null {
    const sheet = this.sheet(path);
    if (!sheet || (names.some((n) => typeof n === 'string') && !sheet.names)) return null;
    const cells = names.map((n) => {
      const i = typeof n === 'number' ? n : sheet.names!.indexOf(n);
      if (i < 0 || !sheet.cells[i]) throw new Error(`ui: sheet ${path} has no cell ${n}`);
      return sheet.cells[i]!;
    });
    const width = cells.reduce((w, c) => w + c.w, 0);
    const height = Math.max(...cells.map((c) => c.h));
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.round(scale * dpr));
    const canvas = document.createElement('canvas');
    canvas.width = width * k;
    canvas.height = height * k;
    canvas.style.width = `${(width * k) / dpr}px`;
    canvas.style.height = `${(height * k) / dpr}px`;
    canvas.setAttribute('aria-hidden', 'true');
    void this.image(sheet.atlas).then((img) => {
      const g = canvas.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      let x = 0;
      for (const c of cells) {
        g.drawImage(img, c.x, c.y, c.w, c.h, x * k, 0, c.w * k, c.h * k);
        x += c.w;
      }
    });
    return canvas;
  }

  /**
   * A one-cell sheet (a BG image: wallpapers, the naming screen) as an element background, sized by CSS in
   * dots (`--w`, `--h` are set to its DS size). Null when the pack has no such sheet.
   */
  picture(el: HTMLElement, path: string): HTMLElement | null {
    const sheet = this.sheet(path);
    if (!sheet) return null;
    const cell = sheet.cells[0]!;
    el.style.setProperty('--w', String(cell.w));
    el.style.setProperty('--h', String(cell.h));
    el.classList.add('rom-picture');
    return this.background(el, sheet.atlas);
  }

  /**
   * The most common opaque colours of the top and bottom opaque rows of a screen's pictures as they are seen
   * (CSS colours): the backdrop above and below a DS screen shown full screen on a phone, so the screen runs on
   * to the phone's edges. `spec` lists the pictures back to front, separated by spaces, each `path[#cell][@y]`:
   * a sheet, its cell by name (default the first) and its DS y on the screen (default 0); e.g. the naming
   * screen's keys over its background, `naming/bg naming/keys_0@80`. The first one sets the size. `left`, `right`:
   * each row's colour in the edge column (null where it is not opaque).
   */
  edgeColors(spec: string): Promise<{ top: string; bottom: string; left: (string | null)[]; right: (string | null)[] }> {
    let p = this.edges.get(spec);
    if (p) return p;
    const layers = spec.split(' ').map((layer) => {
      const [, path, name, y] = /^([^#@]+)(?:#([^@]+))?(?:@(\d+))?$/.exec(layer) ?? [];
      const sheet = path ? this.sheet(path) : undefined;
      if (!sheet) throw new Error(`ui: no sheet for the backdrop ${layer}`);
      const cell = sheet.cells[name === undefined ? 0 : (sheet.names?.indexOf(name) ?? -1)];
      if (!cell) throw new Error(`ui: backdrop ${layer}: no such cell`);
      return { atlas: sheet.atlas, cell, y: Number(y ?? 0) };
    });
    const { w, h } = layers[0]!.cell;
    p = Promise.all(layers.map((l) => this.image(l.atlas))).then((images) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d', { willReadFrequently: true })!;
      layers.forEach(({ cell: c, y }, i) => g.drawImage(images[i]!, c.x, c.y, c.w, c.h, 0, y, c.w, c.h));
      const px = g.getImageData(0, 0, w, h).data;
      const row = (y: number): string | null => {
        const counts = new Map<number, number>();
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4;
          if (px[i + 3]! < 255) continue;
          const rgb = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!;
          counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
        }
        return counts.size ? `#${[...counts].sort((a, b) => b[1] - a[1])[0]![0].toString(16).padStart(6, '0')}` : null;
      };
      // The outermost rows with opaque pixels (a panel picture may leave its edge rows clear).
      const first = (ys: number[]) => {
        for (const y of ys) {
          const c = row(y);
          if (c) return c;
        }
        throw new Error(`ui: ${spec} has no opaque pixel`);
      };
      const ys = Array.from({ length: h }, (_, i) => i);
      // Each row's colour at the screen's left and right edges (a striped backdrop runs on sideways in its own stripes).
      const at = (x: number, y: number) => {
        const i = (y * w + x) * 4;
        return px[i + 3]! === 255 ? `#${((px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!).toString(16).padStart(6, '0')}` : null;
      };
      return { top: first(ys), bottom: first([...ys].reverse()), left: ys.map((y) => at(0, y)), right: ys.map((y) => at(w - 1, y)) };
    });
    this.edges.set(spec, p);
    return p;
  }

  /**
   * A Pokémon's front picture (pokemonSprites: frame 0 of the front face, 80×80 DS px, the female face
   * where it differs, the shiny atlas), or null when the pack has none.
   */
  pokemonFront(species: Id, form: number, shiny: boolean, female: boolean, scale: number, egg: boolean): HTMLCanvasElement | null {
    // BoxPokemon_BuildSpriteTemplate hides the hatchling; only Manaphy has distinct egg art.
    if (egg) {
      form = species.endsWith(':SPECIES_MANAPHY') ? 1 : 0;
      species = `${species.split(':')[0]}:SPECIES_EGG` as Id;
    }
    const sprites = this.registries().pokemonSprites.get(species);
    const f = sprites?.forms[form] ?? sprites?.forms[0];
    if (!f) return null;
    const face = (female && f.frontFemale) || f.front;
    const dpr = devicePixelRatio || 1;
    const k = Math.max(1, Math.round(scale * dpr));
    const canvas = document.createElement('canvas');
    canvas.width = 80 * k;
    canvas.height = 80 * k;
    canvas.style.width = `${(80 * k) / dpr}px`;
    canvas.style.height = `${(80 * k) / dpr}px`;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.className = 'mon-front';
    void this.image(shiny ? f.shinyAtlas : f.atlas).then((img) => {
      const g = canvas.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      g.drawImage(img, 0, face.y, 80, 80, 0, 0, 80 * k, 80 * k);
    });
    return canvas;
  }

  /** A type's (or move category's) icon from `battle/type_icons` (32×16), null without the sheet. */
  typeIcon(type: Id | 'physical' | 'special' | 'status', scale: number): HTMLCanvasElement | null {
    const name = type.includes(':') ? type.slice(type.indexOf(':') + 1).replace(/^TYPE_/, '').toLowerCase() : type;
    const sheet = this.sheet('battle/type_icons');
    if (!sheet?.names?.includes(name)) return null;
    return this.cells('battle/type_icons', [name], scale);
  }

  /** CSS border-image from a nine-slice window frame sheet (`windows/standard_field`, `windows/message_box_NN`); false when absent. */
  frame(el: HTMLElement, path: string): boolean {
    const sheet = this.sheet(path);
    if (!sheet?.nineSlice) return false;
    const [l, t, r, b] = sheet.nineSlice;
    el.classList.add('rom-frame');
    el.style.setProperty('--slice', `${t} ${r} ${b} ${l}`);
    el.style.setProperty('--slice-w', `calc(var(--dot) * ${t}) calc(var(--dot) * ${r}) calc(var(--dot) * ${b}) calc(var(--dot) * ${l})`);
    void this.url(sheet.atlas).then((src) => el.style.setProperty('--frame-src', `url("${src}")`));
    return true;
  }
}
