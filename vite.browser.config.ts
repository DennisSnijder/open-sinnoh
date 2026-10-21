import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vite';
import app from './vite.config.ts';
import { openSinnohPacksPlugin } from './packages/cli/src/plugin.ts';
import { browserArtifacts } from './tools/browser-options.ts';

// Browser-only entries replace source URLs used by renderer probes and ROM seeding. They share the
// app's built chunks, so tests exercise the same modules; none enter the public production build.
export default mergeConfig(app, defineConfig({
  plugins: [openSinnohPacksPlugin(['packs/fixture', 'packs/demo-mod'])],
  // The app sees a dev build, as under the dev server: the dev-only hooks the specs use (the debug panel,
  // the recorder, the test report DSN) stay in, and the production service worker stays out unless a spec opts in
  // with `?sw` (the offline and update specs).
  define: { 'import.meta.env.DEV': 'true', 'import.meta.env.PROD': 'false', 'import.meta.env.OPENSINNOH_SW': 'true' },
  build: {
    outDir: `${browserArtifacts()}/browser-build`,
    emptyOutDir: true,
    rolldownOptions: {
      preserveEntrySignatures: 'strict',
      input: {
        app: 'index.html',
        '__test/three': fileURLToPath(import.meta.resolve('three')),
        '__test/cards': 'packages/render/src/cards.ts',
        '__test/billboard': 'packages/render/src/billboard.ts',
        '__test/ceilings': 'packages/render/src/ceilings.ts',
        '__test/store': 'packages/app/src/store.ts',
        '__test/pack-source': 'packages/app/src/pack-source.ts',
        '__test/renderer': 'packages/render/src/renderer.ts',
        '__test/distortion': 'packages/render/src/distortion/index.ts',
        '__test/world': 'packages/world/src/index.ts',
      },
      output: { entryFileNames: '[name].js' },
    },
  },
}));
