# OpenSinnoh UI v0.7

The design system for OpenSinnoh's own screens (Options, the onboarding setup, data and mods, the crash and
update screens, the ROM page, later mod tooling) and for opensinnoh.com. v0.7 is the Distortion merge: the
Distortion look laid over v0.6's rules (`docs/decisions.md`, 2026-10-18). This page is the implementation spec.

Code: `packages/ui` (`@opensinnoh/ui`). Gallery: `?ui-gallery` in a dev build (`packages/app/src/ui-gallery.ts`),
checked by `tests/browser/ui-gallery.spec.ts`. Website: `site/` (opensinnoh.com), which renders the builders at build
time (`site/prerender.ts`) and adds only its layout and the device bezels.

## The screen's owner

- **Whatever the game draws stays the game's.** The field message box, battle text, the game's menus, the title
  main menu and every screen that recreates the DS (battle, bag, party, summary, Pokédex, PC, naming, the intro)
  are drawn by the engine from the ROM's art and font. This system never targets them: no `os-` class, no token,
  no web font there (Pokemon DP Pro or otherwise).
- **OpenSinnoh's own screens** (Options, the setup, the crash and update screens, the ROM page) use this system
  throughout, their dialogs included, even when opened mid-game.

## Tokens

- One source: `packages/ui/src/tokens.json`. `tokens.ts` generates the CSS custom properties
  (`installUi()` adds them to the page): `--os-<token>`, dark on `:root`, light under
  `prefers-color-scheme: light` and `[data-theme="light"]`; `data-theme` on any element forces its subtree.
  Never write a colour literal in a component.
- **Dark follows the system, with an override:** Options › Device › Theme (Auto, Dark, Light), stored in
  `lantern-nds:theme` (`setThemeMode`; the key keeps its pre-rename name). Dark is the Distortion look (dark face, near-black rim, teal ring, gold);
  light is warm paper that keeps the rim, the ring and an amber accent.
- Groups: base (bg, field, dot, ink, muted, ink-off, line), window (face, face-alt, halo, rim, ring, inner, edge,
  ink-shadow, shadow, sel, sel-line, accent, on-accent, action, on-action, scrim), state (danger, ok), tones, and
  HP, effectiveness, type and status. Derived per theme: the window frames (`--os-frame-<name>`), the button skins
  (`--os-ctl`, `-hover`, `-down`, `-primary`, `-primary-down`, `-danger`, `-danger-down`, `-off`), the title-tab
  skins (`--os-tab-<tone>`) and the banner fill.
- **Colour by meaning only.** A tone answers "what is this window about": world, team, items, system, danger.
  A tone appears only on a title tab. Gold (`accent`) is the ▶ cursor, the chosen value, focus and the active tab;
  teal (`action`) fills the primary button; danger is destructive actions and errors only. HP, type, status and
  effectiveness colours appear only in their own bars and chips, always with words or numbers.

## Units, pixels and type

- **Dot:** one dot is 2 CSS px. Lengths are named in dots (`--os-d1` = 2 px … `--os-d16` = 32 px). Spacing is
  4, 8, 12, 16, 24, 32, 48, 64 px; exceptions 2 (one dot: rims, hairlines, the focus ring), 10 (the Distortion
  border) and 44 (touch target).
- **Whole pixels:** frames, tabs, icons and controls land on whole CSS pixels. Windows centre with
  `round(down, …, 1px)` and snap their size to 2 px; `snapPixels(root)` moves any fractional remainder with
  `translate` after layout (it waits for opening animations).
- **Type:**
  - Pixelify Sans 500 at 20/24 is the pixel face: titles, tabs, row labels, values, buttons, message-style text.
    Titles are 32/40 (`pixelTitle`), the wordmark and landing headline 700 at 64/72 and 40/48. Titles are live
    text (selectable, read aloud, scaled with zoom). On a window face pixel text carries the 1-dot shadow
    (`--os-tsd`). Ligatures are off: Pixelify's "fi" reads as an A.
  - Silkscreen 16/20 is for numbers, counts and steps (`.os-num`, counters, badges).
  - Figtree is the reading face: 14/20 body, 16/24 lead, 12/16 small. JetBrains Mono 12/16 for crash details and
    hashes.
- **Fonts are self-hosted** from `@fontsource` (latin subsets), no CDN. Pixelify Sans (Stefie Justprince),
  Silkscreen (Jason Kottke), Figtree (Erik Kennedy) and JetBrains Mono (JetBrains) are all under the SIL Open Font
  License 1.1 (OFL): free to use, bundle and ship with the app and the website; the font files are not sold on
  their own and keep their licence and copyright notices (in the `@fontsource` packages).

## Frames

- **Distortion** (default): a 1-dot halo, a 1-dot near-black rim, a 2-dot teal ring, a 1-dot inner line, then the
  face; corners cut by one dot. **Slim**: halo and rim only (the description box, toasts). **Drop**: Distortion with
  a hard 2-dot shadow down and right. **Control**: buttons and title tabs, fixed (a 1-dot edge, and on buttons a
  1-dot shade that a press takes away).
- `.os-win` is Distortion; `data-frame` on a window or `data-os-frame` on an ancestor picks another. The player
  picks with Options › Device › Windows (`lantern-nds:ui-frame`, `setFrameMode`; a pre-rename key); the game's FRAME option is the
  ROM's message box and is separate.
- The window's name is a **title tab** on its top edge, filled with its tone (`titleTab`). Sections inside a window
  are split by 2-px dividers, never nested frames. Below a 480-px container (`.os-screen`) a panel goes full bleed,
  drops its frame, and its tab becomes the top bar.
- **The field** (`.os-field`): a quiet dot grid behind our windows when no game is drawn (the setup, the ROM page).

## Brand

The mark and the wordmark (`docs/decisions.md`, 2026-10-18) are original pixel art
in `packages/ui/src/brand.ts` (rect lists, the one source), drawn by `logo` and `wordmark` in `components.ts` as
inline SVG.

- **Mark or wordmark, never the two side by side.** Where the whole name shows (the title screen, the ROM
  page, the setup, the link card), the wordmark stands alone; where there is no room for it (favicons, app icons,
  small spots), the mark alone. There is no lockup.
- **Mark:** "OS" (gold O, paper S) in a Distortion window with a gold title tab, on a 32-px grid; at 32, 64, 96 px …
  Below 32 px, the 16-px Window cut (same letters and colours, a teal title strip). Its halo follows the background
  (`--os-halo`); every other colour is a fixed token (the `brand` group adds the tab's shade and the strip).
- **Wordmark:** our pixel "OpenSinnoh" (58 × 11 at ×1, cap 8, 2-px stems) with the O and the S in gold, the ink and
  its 1-pixel shadow from the theme. Never typed in a font. Over art it takes the dark theme (`data-theme="dark"`)
  and, if it needs a backing, the `scrim` token faded out at the edges.
- **Clear space:** the mark 4 mark pixels all round, the wordmark 2 glyph pixels. **Minimum:** the 16-px mark; the
  wordmark ×1.
- **Scaling:** whole scales only, nearest neighbour. Never blur, rotate, outline or recolour outside the tokens.
- **Motion:** stepped on the 30 Hz frame, plain CSS `steps()` (`.os-brand.anim`), nothing per frame; reduced motion
  shows the static frame. The mark: 48 frames (the window opens from the middle out, the ring and face follow, the
  tab pops up, the O then the S type in row by row, a gold cursor blinks), then a quiet idle (the cursor blinks
  three times every 6 s). The wordmark: 32 frames, the gold O and S land first, then the other letters type in left
  to right (`WORDMARK_LETTERS`). The wordmark's intro plays on the title screen, the ROM page and as the setup starts.
- **Where:** the website, the app shell and our own screens (the ROM page, the setup), and the title screen's overlay
  (ours: it replaces the game's logo over the game's scene, with PRESS START in Pixelify Sans) and the credits' closing
  card (static). **Never inside a screen the game draws.**
- **The splash** (index.html, before any script): the wordmark ×4 over a busy `.os-prog` that names the start's
  phase, on `bg`; it fades out over the title's fade in.
- **Static files:** `pnpm brand:assets` (`tools/brand-assets.ts`) writes the favicons (16-px cut, 32, an SVG that
  holds both), the Apple touch icon, the manifest icons (192, 512, a maskable 512 inside the safe circle) and the
  1200 × 630 link card (the wordmark over the tagline) into `public/`; the site's card (`site/public`) puts the wordmark,
  the Beta badge and one line over a gameplay frame from `site/shots` (the landing page's screenshot exception). Rerun it when the art changes; the files are
  committed.

## Icons

47 original 16 × 16 icons in `packages/ui/src/icons.ts`, each with its meaning (`m`): solid silhouettes with
1-pixel cut-outs, `currentColor`, ×1 or ×2. Ink or muted only, never a tone; the ▶ `cursor` is the accent.
The clock has an open face and hands, the coin an edge-on rim and inset stamp, and Normal a hollow diamond, so their silhouettes differ at 16 px.
Always beside a label; an icon-only button has an accessible name and a tooltip. Use an icon only for its meaning.

## Components (`packages/ui/src/components.ts`)

| Component | Use | Don't |
|---|---|---|
| `button` | one primary (teal) per window; verbs; `danger` (danger text) or `solid-danger` only for destructive actions, which confirm; disabled stays focusable and says why | two primaries; danger without a confirm |
| `iconButton` | repeated, well-known actions, with a tooltip | unique actions; essential info in the tooltip |
| `toggle` | on/off that applies at once; the value is written next to it | settings that need a Save |
| `pick` | a few short values, all inline; the chosen one in gold with a 1-dot underline | long lists |
| `cycle` | ◀ value ▶ for 2 to 5 short values (the value in gold) | long names (use `select`) |
| `slider` | levels of 10 steps or fewer, as cells, number shown | fine-grained values |
| `textInput` | label above, help or error below; validate on blur and submit | placeholder as label |
| `select` | long or unknown-length lists, ≤ 6 rows visible; a modal bottom sheet below a 480-px container, a popover above it | fewer than 3 options |
| `tabs` | underline tabs on our screens, ≤ 5; edge fades and 44-px scroll arrows when they overflow; focus reveals its tab | nested tabs |
| `row` | the ▶, label, description, one control; the cursor row (`is-cursor` or focus) | several focus stops in a row |
| `choices` | the answers to one question, all visible, each with a line under it (the setup) | more than 4 answers; settings that stay (use a row) |
| `filePicker` | a file from the device: `drop` the big target with a dotted border (`.over` while a file is dragged over the page), `quiet` a secondary pick | a hidden input with a fake button |
| `titleTab` | one per window: its name on the top edge in the tone, an on-tone icon, an optional end (a step count); `bar` across the top (a sheet) | tone on icons, frames or text |
| `pixelTitle` | a live pixel title: 32 (screens), 40 and 64 (wordmark) | big pixel text by font size elsewhere |
| `typeText` | message-style text typed at the game's Text speed (3, 2, 1 frames a character), instant with reduced motion; the whole text is there for assistive tech at once | essential text that only exists typed |
| `footer`, `backButton` | the footer of a full screen: Back, with a line (a result) or nothing | key hints or key caps (not part of the system) |
| `toast`, `showToast` | success and neutral results, one at a time | errors; stacking |
| `banner` | errors, inline at the top of the window body: what happened, what is safe, one action; `tone: 'info'` for a calm notice (why this screen, what is safe), in the ring's teal | toasts for errors; danger for a notice |
| `dialog`, `sheet` | confirming destructive actions (opens on the safe answer); secondary flows on a phone | more than 2 actions |
| `progress` | cells and a percentage, or a busy block, always with words | spinners |

## Selection, density, phone and motion

- **One selection model.** The cursor row is a `sel` fill, a 1-dot `sel-line` and the gold ▶. The chosen value is
  gold with an underline, tabs are gold with a 2-dot bar. No state relies on colour alone.
- **Density** is global (`:root[data-density]`): a key or gamepad switches to d-pad (36 to 40-px controls, 44-px
  rows, descriptions in the description box), a touch to touch (44-px controls, 64-px rows, descriptions inline;
  the box shows only a result, `is-status`). A mouse never switches.
- **No key hints.** Screens show no key caps or key lists: the cursor and real controls say what to do.
- **Focus.** One mark per place. A screen's cursor (the ▶ row, the tab fill and underline, an outlined button) is
  the mark; focus that follows the cursor draws no second ring. Any other control gets the 2-px gold ring with a
  2-px offset, never clipped; on a sheet's title bar, an on-tone backing keeps the ring at 3:1.
- **Phone:** the breakpoint is a 480-px container, not the viewport. Dots stay 2 px (no fractional dots).
- **Motion** steps on the game's 30 Hz frame (`--os-f`, 33.3 ms): windows open in 4 frames (`.os-enter`), sheets
  in 6, toasts 6 in, 80 held, 4 out; a press drops a button one dot. Hover and cursor moves are instant. Reduced
  motion makes everything instant and nothing loops.

## Review checklist

Contrast ≥ 4.5 for text (3 for parts) in both themes; touch targets ≥ 44 px on touch; visible focus (the cursor's
mark or the ring, never both, never clipped); pixel art on whole pixels; tones by meaning only; no restyled ROM
window or game text.
