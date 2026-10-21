/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The error report endpoint (Vercel env var); unset in dev, tests and forks: nothing is sent. */
  readonly VITE_SENTRY_DSN?: string;
  /** The build's commit (VERCEL_GIT_COMMIT_SHA, or `dev`), set by vite.config.ts. */
  readonly VITE_OPENSINNOH_RELEASE: string;
  /** production, preview or development (VERCEL_ENV), set by vite.config.ts. */
  readonly VITE_OPENSINNOH_ENV: string;
  /** The browser-test build only: the service worker registers when the URL has `?sw` (vite.browser.config.ts). */
  readonly OPENSINNOH_SW?: boolean;
}
