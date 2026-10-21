---
name: opensinnoh-ui
description: The OpenSinnoh UI design system (v0.7, the Distortion look). Use when building or changing any OpenSinnoh-owned screen or UI (Options, the onboarding setup, data and mods, crash screens, mod tooling, any new DOM screen or control in packages/app) or doing website and brand work for opensinnoh.com. Not for screens that recreate the DS (battle, bag, party, summary, Pokédex, PC, naming, the intro) or anything the ROM draws.
---

# OpenSinnoh UI

Spec: `docs/design-system.md`. Code: `packages/ui` (`@opensinnoh/ui`).

## Where things are

- Tokens: `packages/ui/src/tokens.json` (the only source); `tokens.ts` generates `--os-*` custom properties,
  dot units, frames, button and title-tab skins for dark and light. `installUi()` (called in
  `packages/app/src/main.ts`) adds them, the theme (`lantern-nds:theme`) and frame (`lantern-nds:ui-frame`)
  overrides and the input density.
- CSS: `packages/ui/src/os.css`. Every class is `os-` prefixed; wrap a screen in `.os` (base type and colour)
  and `.os-screen` (the 480-px phone container).
- Icons: `packages/ui/src/icons.ts`, `icon(name, 16 | 32, label?)`; each has its meaning in `m`.
- Brand: `packages/ui/src/brand.ts` (the mark and wordmark as rect lists); `logo(size, { animate })` and
  `wordmark(scale, { animate })` in components.ts; static files from `pnpm brand:assets`. Rules: docs/design-system.md
  › Brand: **mark or wordmark, never the two side by side** (the wordmark where the full name shows, the mark where
  there is no room); whole scales, 16-px cut below 32, clear space (mark 4 mark px, wordmark 2 glyph px), never
  inside a game-drawn screen.
- Components: `packages/ui/src/components.ts` (button, iconButton, toggle, pick, cycle, slider, textInput,
  select, tabs, row, choices, filePicker, titleTab, pixelTitle, typeText, footer, backButton, toast, banner,
  dialog, sheet, progress).
- Users: Options (`packages/app/src/ui/options-screen.ts`, `options.css`; its in-layer frame `.ui-os` is in
  `ui/ui.css`), the setup (`title/setup.ts`), the crash and update screens (`telemetry/crash.ts`) and the ROM page
  (`rom-screen.ts`; no ROM art there, it shows before any import). Gallery: `?ui-gallery`
  (`packages/app/src/ui-gallery.ts`, spec `tests/browser/ui-gallery.spec.ts`). Add a new component to the
  gallery in both themes.

## Rules

- **The screen's owner picks the style.** Never restyle a ROM-drawn window, the title main menu or the game's
  text; gameplay text uses the ROM font, never a web font (Pokemon DP Pro included). Pixelify Sans, Silkscreen,
  Figtree and JetBrains Mono are for OpenSinnoh's own screens and the website only.
- **Colour by meaning only**, always through `--os-*` tokens, never a literal. Tones (world, team, items,
  system, danger) only on a title tab; gold (`accent`) for the ▶, the chosen value, focus and the active tab;
  teal (`action`) for the primary button; danger for destructive actions and errors.
- **Whole pixels.** One dot is 2 px (`--os-d1` … `--os-d16`); spacing on the 4-px scale (exceptions 2, 10, 44).
  Centre with `round()`, run `snapPixels(root)` after a redraw.
- **Retro, but readable.** Pixelify Sans 20/24 for titles, tabs, labels, values and buttons (titles 32 with
  `pixelTitle`, live text; the 1-dot shadow on window faces; ligatures off); Silkscreen for numbers; Figtree for
  descriptions and help.
- **Distortion frame by default** (Slim, Drop by the player's pick); each window is named by a `titleTab` on its
  top edge, which becomes the top bar below 480 px. One selection model: the sel fill, a 1-dot line and the ▶.
  Message-style text types at the game's Text speed (`typeText`).
- **Dark follows the system, with an override** (`setThemeMode`). Check both themes.
- **Real controls.** Buttons, switches, tabs and sliders with accessible names; the cursor is focus or
  `is-cursor`; disabled stays focusable (`aria-disabled`) and says why. Errors are banners, never toasts.
  Destructive actions confirm in a dialog that opens on the safe answer.
- **No key hints.** No key caps or key lists anywhere; the footer is Back with a line (or nothing).
- **One focus mark.** Focus that follows the cursor draws no ring on top of the cursor's mark; tabs show focus with the
  gold label, the cursor fill and a 2-dot underline, never a box ring; other rings have an offset and never clip.
- Screens that redraw their DOM on every change (the app's idiom) add `.os-enter` only on the first draw.

## Pre-merge review

- [ ] Text contrast ≥ 4.5 (parts ≥ 3) in dark and light (the gallery spec computes it in the page).
- [ ] Touch targets ≥ 44 × 44 px in touch density, at phone width.
- [ ] Visible focus on every control (the cursor's mark or the ring, never both, never clipped); keyboard and pad
  reach everything.
- [ ] Frames, icons and pixel text on whole pixels (snap pass run).
- [ ] Tone used for meaning only; no colour literals; danger only for destructive actions.
- [ ] No ROM window, ROM-art screen or game text restyled; no ROM font on our screens.
- [ ] `pnpm test:browser tests/browser/ui-gallery.spec.ts` and the touched screen's specs pass.
