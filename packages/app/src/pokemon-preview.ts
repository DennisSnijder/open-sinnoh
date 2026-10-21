/**
 * Draws the picture of the field's Pokémon preview (`ScriptView.pokemonPreview`, decomp DrawPokemonPreview) on the
 * overlay canvas, inside the frame `drawScriptOverlay` drew: frame 0 of the front face (form 0, not shiny, the
 * female face where it differs), in the same bottom-centred 256×192 DS frame. The atlas loads on first use; until
 * it has, the window shows empty. A pack without the species' pictures draws only the frame.
 */
import type { AssetRef, AssetSource, Registries, ScriptView } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

export function createPreviewDrawer(assets: AssetSource, registries: () => Registries) {
  const images = new Map<AssetRef, ImageBitmap | null>();
  return (ctx: CanvasRenderingContext2D, preview: ScriptView['pokemonPreview'], scale: number) => {
    if (!preview) return;
    const form = registries().pokemonSprites.get(preview.species)?.forms[0];
    if (!form) return;
    if (!images.has(form.atlas)) {
      images.set(form.atlas, null);
      void assets
        .get(form.atlas)
        .then((blob) => createImageBitmap(blob))
        .then((img) => images.set(form.atlas, img));
    }
    const img = images.get(form.atlas);
    if (!img) return;
    const face = (preview.female && form.frontFemale) || form.front;
    const ox = Math.floor((ctx.canvas.width / scale - 256) / 2);
    const oy = Math.floor(ctx.canvas.height / scale - 192);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, face.y, 80, 80, (ox + preview.x) * scale, (oy + preview.y) * scale, preview.width * scale, preview.height * scale);
    ctx.restore();
  };
}

/** The binoculars' picture: 80×80 centred on the DS main screen (great_marsh_lookout_sprite.c: OBJ at 128, 96). */
const LOOKOUT_PICTURE = { x: 128 - 40, y: 96 - 40, width: 80, height: 80 } as const;

/**
 * Draws the gate binoculars' view (`World.lookoutView`, decomp Task_GreatMarshLookout) over the field: the Pokémon in
 * the screen's centre, then the circle fade (FADE_TYPE_CIRCLE_IN/OUT on the main screen) as black outside a circle
 * about the DS screen's centre, its radius from 0 to the overlay's farthest corner.
 */
export function createLookoutDrawer(assets: AssetSource, registries: () => Registries) {
  const picture = createPreviewDrawer(assets, registries);
  return (ctx: CanvasRenderingContext2D, view: { pokemon: { species: Id; female: boolean } | null; iris: number | null } | null, scale: number) => {
    if (!view) return;
    if (view.pokemon) picture(ctx, { ...LOOKOUT_PICTURE, ...view.pokemon }, scale);
    if (view.iris === null) return;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const cx = (Math.floor((w / scale - 256) / 2) + 128) * scale;
    const cy = (Math.floor(h / scale - 192) + 96) * scale;
    const far = Math.max(Math.hypot(cx, cy), Math.hypot(w - cx, cy), Math.hypot(cx, h - cy), Math.hypot(w - cx, h - cy));
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.arc(cx, cy, far * view.iris, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.restore();
  };
}
