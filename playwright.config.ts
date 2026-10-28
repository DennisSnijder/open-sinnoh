import { defineConfig, devices } from '@playwright/test';
import { browserExecutable } from './tools/browser.ts';
import { browserArtifacts, browserShard, machineBrowserWorkers } from './tools/browser-options.ts';

const MENU_SPECS = /(menus|fit|options)\.rom\.spec\.ts$/;
const SHARD = browserShard(process.argv) ?? process.env.OPENSINNOH_TEST_SHARD;
// Inherited by the preview build, PWA specs and timing reporter, including native --shard runs.
if (SHARD) process.env.OPENSINNOH_TEST_SHARD = SHARD;
const ARTIFACTS = browserArtifacts();
const PORT = Number(process.env.OPENSINNOH_TEST_PORT ?? (SHARD ? 4173 + Number(SHARD.split('-')[0]) : 4173));
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('OPENSINNOH_TEST_PORT must be a port (1–65535)');
const PHONE_SPECS = /(menus|fit|options|safe-area-scenes|frontier)\.rom\.spec\.ts$/;
// The landing page (site/) is a separate static build on its own port; its spec sets its own viewports, so it runs once.
const SITE_PORT = Number(process.env.OPENSINNOH_SITE_PORT ?? PORT + 10);
const SITE_SPEC = /site\.spec\.ts$/;
process.env.OPENSINNOH_SITE_PORT = String(SITE_PORT); // read by site.spec.ts in the workers

export default defineConfig({
  testDir: './tests/browser',
  // With OPENSINNOH_NDS_ROM: the ROM import once per run, cached on disk across runs (tests/rom.ts).
  globalSetup: './tests/browser/setup.ts',
  // Independent fixture tests fill all workers; ROM specs with shared pages explicitly stay serial.
  fullyParallel: true,
  workers: machineBrowserWorkers(),
  // Software GL on a machine shared with other runs: the 30 s default timed out phone UI tests mid-way.
  timeout: 60_000,
  reporter: [['list'], ['json', { outputFile: `${ARTIFACTS}/playwright.json` }], ['blob', { outputDir: `${ARTIFACTS}/blob-report` }], ...(process.env.OPENSINNOH_TIMING_DIR ? [['./tools/timing-playwright.ts'] as [string]] : [])],
  outputDir: `${ARTIFACTS}/playwright`,
  // English whatever the machine's language: without an imported game the app speaks the browser's (packages/app/src/strings).
  use: { baseURL: `http://127.0.0.1:${PORT}`, browserName: 'chromium', locale: 'en-US', launchOptions: { executablePath: browserExecutable(), args: process.env.OPENSINNOH_TEST_HARDWARE_GPU === '1' ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'phone', testIgnore: SITE_SPEC, use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 } },
    // Big screens: menu fit checks. Landscape phones also cover the remaining scenes with notch insets.
    { name: 'mid', testMatch: MENU_SPECS, use: { viewport: { width: 1000, height: 750 }, deviceScaleFactor: 2 } },
    { name: 'fhd', testMatch: MENU_SPECS, use: { viewport: { width: 1920, height: 1080 } } },
    { name: 'big', testMatch: MENU_SPECS, use: { viewport: { width: 2560, height: 1440 } } },
    { name: 'phone-small', testMatch: MENU_SPECS, use: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 } },
    { name: 'landscape', testMatch: PHONE_SPECS, use: { viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 } },
    // The landing page in WebKit at an iPhone size, opt-in: needs `pnpm exec playwright install webkit`.
    ...(process.env.OPENSINNOH_TEST_WEBKIT === '1' ? [{ name: 'site-webkit', testMatch: SITE_SPEC, use: { ...devices['iPhone 14'], browserName: 'webkit' as const, launchOptions: {} } }] : []),
    // A tablet in both orientations (an iPad Air: 820×1180 at DPR 2): touch controls on a big screen.
    { name: 'tablet', testMatch: MENU_SPECS, use: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'tablet-landscape', testMatch: MENU_SPECS, use: { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ],
  webServer: [
    {
      command: `pnpm exec tsx tools/browser-server.ts ${PORT}`,
      timeout: 120_000,
      url: `http://127.0.0.1:${PORT}/__opensinnoh/packs.json`,
      reuseExistingServer: false,
    },
    {
      command: `pnpm exec vite build --config site/vite.config.ts --logLevel warn && pnpm exec vite preview --config site/vite.config.ts --host 127.0.0.1 --port ${SITE_PORT} --strictPort`,
      timeout: 120_000,
      url: `http://127.0.0.1:${SITE_PORT}/`,
      reuseExistingServer: false,
    },
  ],
});
