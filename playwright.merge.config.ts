import { defineConfig } from '@playwright/test';

// No browser executable or ROM needed on the merging host. Explicit root also permits cross-OS reports.
export default defineConfig({
  testDir: './tests/browser',
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'test-artifacts/playwright-merged.json' }],
  ],
});
