import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { prerender, siteTokensCss } from './prerender.ts';

const TOKENS = 'virtual:os-tokens.css';

/** The design system's art and tokens become markup and CSS at build time (prerender.ts): no JavaScript draws them. */
function prerenderPage(): Plugin {
  return {
    name: 'site-prerender',
    resolveId: (id) => (id === TOKENS ? `\0${TOKENS}` : null),
    load: (id) => (id === `\0${TOKENS}` ? siteTokensCss() : null),
    transformIndexHtml: { order: 'pre', handler: (html) => prerender(html) },
  };
}

/** Ships the repository's THIRD_PARTY_NOTICES.md (the fonts' licences) as `third-party-notices.txt`, as the game's build does. */
function thirdPartyNotices(): Plugin {
  return {
    name: 'site-third-party-notices',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'third-party-notices.txt', source: readFileSync(join(import.meta.dirname, '../THIRD_PARTY_NOTICES.md'), 'utf8') });
    },
  };
}

// opensinnoh.com: a static page in site/, built on @opensinnoh/ui (site/README.md).
export default defineConfig({
  root: import.meta.dirname,
  plugins: [prerenderPage(), thirdPartyNotices()],
  // The analytics events' version: the deployed commit (Vercel), as the game's.
  define: { 'import.meta.env.VITE_OPENSINNOH_RELEASE': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev') },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true, assetsInlineLimit: 0 },
  server: { port: 5180 },
  preview: { port: 5181 },
});
