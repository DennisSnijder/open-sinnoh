# opensinnoh.com

The landing page: one static page built with Vite on OpenSinnoh UI (`@opensinnoh/ui`). The game itself is
`play.opensinnoh.com` (the app at the repository root).

```sh
pnpm site:dev      # http://localhost:5180
pnpm site:build    # site/dist
pnpm site:preview  # the build, http://localhost:5181
```

- `index.html` is the page. `<!--wordmark-->`, `<!--logo:N-->` and `<!--icon:name-->` are filled at build time by
  `prerender.ts`, which runs the design system's own `wordmark`, `logo` and `icon` builders (`<!--discord-->` is Discord's
  logo mark, kept there as a third-party mark, not in the pixel icon set); the token sheet and the
  device bezels come from `tokensCss` and `nineSlice` as the CSS module `virtual:os-tokens.css`.
- `src/site.css` lays the page out; colours, frames, buttons, title tabs and rows are the design system's.
- `src/main.ts` is the only script (about 2 kB gzip): the theme pick, the gameplay video's play and pause, the
  whole-pixel snap, and `src/analytics.ts`: anonymous, cookieless visit counting with PostHog EU (the page view,
  Play now, Discord; only on opensinnoh.com, nothing under Do Not Track or Global Privacy Control).
- `public/`: the favicons and the link card (a gameplay frame, see Screenshots), written by `pnpm brand:assets` (`tools/brand-assets.ts`).
- Checked by `tests/browser/site.spec.ts` (`pnpm test:browser tests/browser/site.spec.ts --project=desktop`). In WebKit at a
  phone size: `pnpm exec playwright install webkit` once, then `OPENSINNOH_TEST_WEBKIT=1 pnpm test:browser tests/browser/site.spec.ts --project=site-webkit`.

## Screenshots

The page shows a few screenshots of the game. This is the one exception to the rule against screenshots of ROM
content in the repository (`docs/decisions.md`, 2026-10-18, "Landing page may show game screenshots"). They were
captured from OpenSinnoh running on legally dumped ROMs, compressed for the web, and live only here in
`site/shots/`. No extracted asset files, no audio, no ROM data, never a ROM.

Captured 2026-10-18 (`phone.webp` again on 2026-10-18 for the centred Select and Start: a fresh game warped to Jubilife City 172,765 with a level 12 Piplup, two steps right) with temporary Playwright specs against the browser-test build, in replay mode (seed 1, clock
12:00), the HUD buttons hidden on the desktop captures. Desktop stills are 1280 × 720 at DPR 2, cropped where noted and
scaled down to WebP (quality 82). "Add-on" means the HeartGold (US) follower import.

| File | Source scene | Capture |
|---|---|---|
| `montage.webm` (1.31 MB), `montage.mp4` (1.46 MB) | The hero walk montage, 14.3 s, 9 hard cuts, no audio (cuts below) | 1280 × 720, one frame per game tick, 30 fps |
| `montage-poster.webp` | The montage's frame 12: Charizard following in Twinleaf Town | desktop, 2560 → 1280 |
| `phone.webp` | Jubilife City on a phone, Piplup following, the touch controls | phone 390 × 844 DPR 3, → 390 wide |
| `addon-charizard.webp` | Charizard following across a Jubilife City crossroads (add-on), the add-on card | desktop, crop 1920 × 1080, → 640 wide |
| `spear-pillar.webp` | Spear Pillar: Giratina's shadow over Dialga and Palkia (story replay `m5-spear-pillar-barry`) | desktop, → 640 wide |
| `distortion.webp` | Distortion World B1F | desktop, → 640 wide |
| `battle.webp` | The battle with Giratina (replay `dw-giratina-room`) | desktop, crop 1600 × 900, → 640 wide |
| `league.webp` | The Pokémon League's entrance | desktop, → 640 wide |

The montage's cuts, in order (the last cuts back to the first when it loops):

| # | Time | Place | Follower |
|---|---|---|---|
| 1 | 0.0–1.8 s | Twinleaf Town, walking left | Charizard (add-on) |
| 2 | 1.8–3.4 s | Route 201, through the tall grass | Piplup (Platinum's own) |
| 3 | 3.4–5.0 s | Jubilife City, down the street | Giratina, Origin Forme (add-on) |
| 4 | 5.0–6.6 s | Hearthome City plaza | Shiny Gyarados (add-on) |
| 5 | 6.6–8.2 s | Route 216 in falling snow | Female Pikachu (add-on) |
| 6 | 8.2–9.6 s | Mt. Coronet 1F | Lucario (add-on) |
| 7 | 9.6–11.4 s | Distortion World B1F, the camera swings and the player jumps onto a wall | none (no followers there) |
| 8 | 11.4–12.9 s | The battle with Giratina (replay `dw-giratina-room`) | (battle) |
| 9 | 12.9–14.3 s | The Pokémon League's plaza | Garchomp (add-on) |

`public/og-image.png`, the link card, is `montage-poster.webp` at ×1 (cropped to 1200 × 630 from x 0, y 76) under our
wordmark, Beta badge and line, written by `pnpm brand:assets` (it needs `pngquant`: `brew install pngquant`). The
favicons are our own art, not game content. The app's card (`public/og-image.png` at the repository root) stays brand
only.

## Deploying on Vercel

The page is its own Vercel project, separate from the game's.

1. **New project.** In Vercel, Add New → Project, and import the repository.
2. **Root Directory:** `site`. Keep "Include files outside the root directory in the Build Step" on: the page
   imports `packages/ui`.
3. **Build settings** (also in `site/vercel.json`, so the defaults are right):
   - Framework preset: Vite
   - Install command: `pnpm install --frozen-lockfile`
   - Build command: `pnpm build`
   - Output directory: `dist`
   - Node.js version: 24.x (from `site/package.json`)
4. **Optional, fewer builds:** Settings → Git → Ignored Build Step, "Run my custom command":
   `git diff --quiet HEAD^ HEAD -- site packages/ui pnpm-lock.yaml` (builds only when the page or the design
   system changed).
5. **Domains.** In the project, Settings → Domains:
   - add `opensinnoh.com` (production);
   - add `www.opensinnoh.com` and set it to redirect to `opensinnoh.com` (308).

   The DNS records stay as Vercel shows them (an A record for the apex, a CNAME for `www`).
6. **Check:** open `https://opensinnoh.com`, follow "Play now" to `https://play.opensinnoh.com`, and paste the
   URL into a link preview (the card is `https://opensinnoh.com/og-image.png`).
