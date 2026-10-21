import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { defineConfig, type Plugin, type PluginOption } from 'vite';
import { devCheckpoints } from './tools/dev-checkpoints.ts';
import { splash } from './tools/splash.ts';

/**
 * Trims @pkmn/sim to what gen 4 battles use (docs/research/battles.md §1.2): learnsets and legality are
 * team validation only, the text tables only descriptions, Pokémon GO data unused, and the gen 1–3, BDSP
 * and Legends mods are not gen 4's ancestors (gen4 → gen5 → … → gen9). Their modules become empty tables;
 * a stubbed mod keeps its generation number so the dex still loads it (it then inherits the base data).
 * Showdown's format list goes too: our battles build their own formats (packages/battle sim/dex.ts).
 */
function trimBattleSim(): Plugin {
  const sim = /@pkmn\/sim\/build\/esm\/data\/(.+)\.mjs$/;
  const empty: [RegExp, string][] = [
    [/^(mods\/[^/]+\/)?learnsets$/, 'export const Learnsets = {};'],
    [/^(mods\/[^/]+\/)?legality$/, 'export const Legality = {};'],
    [/^pokemongo$/, 'export const PokemonGoData = {};'],
    [/^text\/abilities$/, 'export const AbilitiesText = {};'],
    [/^text\/items$/, 'export const ItemsText = {};'],
    [/^text\/moves$/, 'export const MovesText = {};'],
    [/^text\/default$/, 'export const DefaultText = {};'],
  ];
  const mods: Record<string, number> = { gen1: 1, gen2: 2, gen3: 3, gen8bdsp: 8, gen8legends: 8 };
  return {
    name: 'opensinnoh-trim-battle-sim',
    enforce: 'pre',
    load(id) {
      if (/@pkmn\/sim\/build\/esm\/config\/formats\.mjs$/.test(id.replace(/\\/g, '/'))) return 'export const Formats = [];';
      const m = sim.exec(id.replace(/\\/g, '/'));
      if (!m) return null;
      const path = m[1]!;
      for (const [re, code] of empty) if (re.test(path)) return code;
      const mod = /^mods\/([^/]+)\/index$/.exec(path)?.[1];
      if (mod && mods[mod]) return `export const Scripts = { gen: ${mods[mod]} };`;
      return null;
    },
  };
}

/**
 * Writes the build's file list into the built `sw.js` (public/sw.js has a placeholder): the service worker caches
 * all of it at install, so the game starts offline after one visit. The id is a hash of the names and contents,
 * so a changed build is a changed service worker, which the browser then installs as an update. Source maps, the
 * store screenshots and the link card (og-image.png, for link previews) stay out.
 */
function precache(): Plugin {
  let outDir = '';
  return {
    name: 'opensinnoh-precache',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle: {
      order: 'post',
      handler() {
        const swPath = join(outDir, 'sw.js');
        const files: string[] = [];
        const walk = (dir: string) => {
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, e.name);
            if (e.isDirectory()) walk(path);
            else files.push(relative(outDir, path).split('\\').join('/'));
          }
        };
        walk(outDir);
        const shell = files.filter((f) => f !== 'sw.js' && f !== 'og-image.png' && !f.endsWith('.map') && !f.startsWith('screenshots/')).sort();
        const hash = createHash('sha1');
        for (const f of shell) hash.update(f).update(readFileSync(join(outDir, f)));
        const urls = shell.map((f) => (f === 'index.html' ? '/' : `/${f}`));
        const build = JSON.stringify({ id: hash.digest('hex').slice(0, 16), urls });
        const sw = readFileSync(swPath, 'utf8');
        if (!sw.includes('/*__BUILD__*/ null')) throw new Error('sw.js has no /*__BUILD__*/ placeholder to fill');
        writeFileSync(swPath, sw.replace('/*__BUILD__*/ null', () => build));
      },
    },
  };
}

/** Ships THIRD_PARTY_NOTICES.md as `third-party-notices.txt`: the licences of the bundled code and fonts. */
function thirdPartyNotices(): Plugin {
  return {
    name: 'opensinnoh-third-party-notices',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: readFileSync(join(import.meta.dirname, 'THIRD_PARTY_NOTICES.md'), 'utf8') });
    },
  };
}

/**
 * Error reports (packages/app/src/telemetry): the release is the commit Vercel builds, the environment
 * Vercel's (production or preview). Source maps are made only to upload them to Sentry, and only when all
 * of SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set (Vercel env vars, read here at build time,
 * never shipped): then they are 'hidden' (no sourceMappingURL in the bundle) and deleted from dist after
 * the upload. Without them there are no maps and no upload.
 */
const release = process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev';
const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT } = process.env;
const uploadMaps = !!(SENTRY_AUTH_TOKEN && SENTRY_ORG && SENTRY_PROJECT);
const sentryMaps: PluginOption[] = uploadMaps
  ? [(await import('@sentry/vite-plugin')).sentryVitePlugin({ authToken: SENTRY_AUTH_TOKEN, org: SENTRY_ORG, project: SENTRY_PROJECT, release: { name: release }, sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.map'] }, telemetry: false })]
  : [];

// The app lives in packages/app; index.html and public/ sit at the root. Workers are ES modules.
export default defineConfig({
  plugins: [trimBattleSim(), devCheckpoints(), splash(),thirdPartyNotices(), precache(), ...sentryMaps],
  worker: { format: 'es' },
  // The report chunk loads only on demand: pre-bundled in dev so loading it never re-optimizes (and reloads) the page.
  optimizeDeps: { include: ['@sentry/browser'] },
  build: { target: 'es2022', sourcemap: uploadMaps ? 'hidden' : false },
  define: {
    'import.meta.env.VITE_OPENSINNOH_RELEASE': JSON.stringify(release),
    'import.meta.env.VITE_OPENSINNOH_ENV': JSON.stringify(process.env.VERCEL_ENV ?? 'development'),
    // Only the browser-test build turns this on (vite.browser.config.ts).
    'import.meta.env.OPENSINNOH_SW': 'false',
  },
});
