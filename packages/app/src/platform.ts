/** Browser platform bits: storage persistence and estimate, service worker and updates, install prompt, iOS install hint. */
import { standalone } from './phone.ts';
import { S } from './strings/index.ts';

export function formatBytes(n: number): string {
  const fixed = (x: number, digits: number) => x.toFixed(digits).replace('.', S.decimal);
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${fixed(n / 1048576, 1)} MB`;
  return `${fixed(n / 1073741824, 2)} GB`;
}

/** An import refuses to start with less free space than this (the base pack is about 120 MB, and the browser needs room to work). */
export const MIN_FREE_BYTES = 250 * 1024 * 1024;

/**
 * Whether there is room to import: the browser's free space (quota minus usage) plus `reclaimable`, the bytes
 * of an import this one replaces. A message for the player when there is not, or null. A browser without
 * `estimate()` gets no check (a full disk still fails the write, with its own message).
 */
export async function importSpaceProblem(reclaimable = 0): Promise<string | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const free = quota - usage + reclaimable;
  if (free >= MIN_FREE_BYTES) return null;
  return S.storage.notEnough(MIN_FREE_BYTES / 1048576, formatBytes(Math.max(0, free)));
}

/** Asks the browser to keep this site's data (the import and the saves) when space runs low. True when it does. */
export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return (await navigator.storage.persisted()) || navigator.storage.persist();
}

/** What Options › Data shows about the browser's storage: what is used, and whether the browser may clear it. */
export interface StorageStatus {
  /** Null where the browser cannot persist at all (no `navigator.storage.persist`). */
  persistent: boolean | null;
  usage: number;
  quota: number;
}

export async function storageStatus(): Promise<StorageStatus> {
  const persistent = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  const { usage = 0, quota = 0 } = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  return { persistent, usage, quota };
}

/** Two lines (the Options description window): whether the browser keeps the data, and how much is used. */
export function storageLine({ persistent, usage, quota }: StorageStatus): string {
  const used = quota > 0 ? S.storage.usedOf(formatBytes(usage), formatBytes(quota)) : S.storage.used(formatBytes(usage));
  if (persistent === null) return S.storage.cannotPromise(used);
  return persistent ? S.storage.kept(used) : S.storage.mayClear(used);
}

export async function storageSummary(): Promise<string> {
  if (!navigator.storage?.estimate) return S.storage.noEstimate;
  const { persistent, usage, quota } = await storageStatus();
  return S.storage.summary(formatBytes(Math.max(0, quota - usage)), MIN_FREE_BYTES / 1048576, persistent ? S.storage.persistent : S.storage.notPersistent);
}

/**
 * The service worker (public/sw.js; production builds, and the browser-test build when a spec asks with `?sw`): the
 * whole build is cached at install, so the game starts offline after one visit. A new version installs and then
 * waits: it never replaces the code of a running session. `updateWaiting()` says one is ready, and `applyUpdate()`
 * (the "Restart to update" action) lets it take over and reloads.
 */
let registration: ServiceWorkerRegistration | null = null;
const updateListeners = new Set<() => void>();

export function registerServiceWorker(): void {
  const enabled = import.meta.env.PROD || (import.meta.env.OPENSINNOH_SW && new URLSearchParams(location.search).has('sw'));
  if (!enabled || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(
    (reg) => {
      registration = reg;
      const announce = () => {
        if (updateWaiting()) for (const cb of updateListeners) cb();
      };
      announce();
      reg.addEventListener('updatefound', () => {
        const next = reg.installing;
        next?.addEventListener('statechange', () => next.state === 'installed' && announce());
      });
      // A phone keeps the page for days without navigating: look for a new version when it comes back.
      document.addEventListener('visibilitychange', () => {
        // Offline is not an error here: the check is tried again at the next visit.
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    },
    (e: Error) => console.error('service worker registration failed', e),
  );
}

/** A new version is installed and waiting for the restart (there is a running version to wait behind). */
export function updateWaiting(): boolean {
  return !!registration?.waiting && !!registration.active;
}

/** Calls `cb` when a new version has finished installing and now waits (also once now if one already does). */
export function onUpdateWaiting(cb: () => void): void {
  updateListeners.add(cb);
  if (updateWaiting()) cb();
}

/**
 * Lets the waiting version take over, then reloads into it. With none waiting any more, it has taken over already
 * (an earlier click whose activation is under way, or a restart in another tab): the reload is all that is left.
 */
export async function applyUpdate(): Promise<void> {
  const next = registration?.waiting;
  if (next)
    await new Promise<void>((resolve) => {
      // Redundant: a newer version replaced it while it waited; the reload starts the one that is active.
      next.addEventListener('statechange', () => (next.state === 'activated' || next.state === 'redundant') && resolve());
      next.postMessage('skip-waiting');
    });
  location.reload();
}

/** The browser's install prompt (Chromium, Android): kept until the player asks for it. Safari installs from its Share menu. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installEvent: InstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

export function captureInstallPrompt(): void {
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallPromptEvent;
    for (const cb of installListeners) cb();
  });
  addEventListener('appinstalled', () => {
    installEvent = null;
    for (const cb of installListeners) cb();
  });
}

export const canInstall = (): boolean => installEvent !== null && !standalone();

/** Calls `cb` when the install prompt becomes available or goes away. */
export function onInstallChange(cb: () => void): void {
  installListeners.add(cb);
}

/** Shows the browser's install prompt; the result line for the player. */
export async function promptInstall(): Promise<string> {
  const e = installEvent;
  if (!e) throw new Error('the browser has no install prompt to show');
  // A prompt can be shown once per event.
  installEvent = null;
  for (const cb of installListeners) cb();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted' ? S.storage.installed : S.storage.notInstalled;
}

declare global {
  interface Window {
    /** Dev and test builds: sets the safe-area insets (Playwright cannot emulate `env()`); null restores the device's. */
    openSinnohSafeArea?: (insets: { top: number; right: number; bottom: number; left: number } | null) => void;
  }
}

/** Dev and test builds: the safe-area hook (the `--sa*` variables every screen reads, style.css and os.css). */
export function installSafeAreaHook(): void {
  window.openSinnohSafeArea = (insets) => {
    const root = document.documentElement.style;
    const sides = ['top', 'right', 'bottom', 'left'] as const;
    const vars = ['--sat', '--sar', '--sab', '--sal'];
    sides.forEach((side, i) => (insets ? root.setProperty(vars[i]!, `${insets[side]}px`) : root.removeProperty(vars[i]!)));
    // The layout reads them on a resize.
    dispatchEvent(new Event('resize'));
  };
}

const HINT_KEY = 'lantern-nds:ios-hint-dismissed'; // pre-rename name, kept: players' stored data uses it

export function showIosHint(): void {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
  if (!ios || standalone()) return;
  try {
    if (localStorage.getItem(HINT_KEY)) return;
  } catch {
    // Storage blocked: show the hint every time.
  }
  const hint = document.getElementById('ios-hint')!;
  hint.hidden = false;
  document.getElementById('ios-hint-close')!.addEventListener('click', () => {
    hint.hidden = true;
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Not remembered; harmless.
    }
  });
}
