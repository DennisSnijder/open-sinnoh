import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyUpdate, importSpaceProblem, MIN_FREE_BYTES, registerServiceWorker, storageLine } from './platform.ts';

const MB = 1024 * 1024;

afterEach(() => vi.unstubAllGlobals());

const browser = (usage: number, quota: number) => vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage, quota }) } });

describe('the space check before an import', () => {
  it('refuses under the threshold, counting the space a replaced import gives back', async () => {
    browser(900 * MB, 1000 * MB);
    expect(await importSpaceProblem()).toMatch(/needs about 250 MB free and this browser has 100\.0 MB/);
    expect(await importSpaceProblem(150 * MB)).toBeNull();
    browser(1000 * MB, 1000 * MB);
    expect(await importSpaceProblem()).toMatch(/has 0 KB/);
  });

  it('allows exactly the threshold, and any size where the browser cannot tell', async () => {
    browser(0, MIN_FREE_BYTES);
    expect(await importSpaceProblem()).toBeNull();
    vi.stubGlobal('navigator', { storage: {} });
    expect(await importSpaceProblem()).toBeNull();
  });
});

describe('the storage line in Options › Data', () => {
  it('says whether the browser keeps the data', () => {
    expect(storageLine({ persistent: true, usage: 120 * MB, quota: 4096 * MB })).toBe('The browser keeps your game.\n120.0 MB of 4.00 GB used.');
    expect(storageLine({ persistent: false, usage: 120 * MB, quota: 4096 * MB })).toMatch(/may clear this when space\nis low\. KEEP DATA asks it not to/);
    expect(storageLine({ persistent: null, usage: 0, quota: 0 })).toMatch(/cannot promise to keep\nyour data\. Export your save/);
  });
});

describe('Restart to update', () => {
  afterEach(() => vi.unstubAllEnvs());

  /** A registered service worker whose waiting version is `waiting`; returns the reload spy. */
  async function registered(waiting: ServiceWorker | null) {
    vi.stubEnv('PROD', true);
    const reload = vi.fn();
    vi.stubGlobal('location', { reload, search: '' });
    vi.stubGlobal('document', { addEventListener: () => {} });
    vi.stubGlobal('navigator', { serviceWorker: { register: async () => ({ waiting, active: {}, addEventListener: () => {} }) } });
    registerServiceWorker();
    await new Promise((r) => setTimeout(r, 0));
    return reload;
  }

  it('lets the waiting version take over, then reloads', async () => {
    const worker = Object.assign(new EventTarget(), {
      state: 'installed' as ServiceWorkerState,
      postMessage(m: string) {
        expect(m).toBe('skip-waiting');
        worker.state = 'activated';
        worker.dispatchEvent(new Event('statechange'));
      },
    });
    const reload = await registered(worker as unknown as ServiceWorker);
    await applyUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads when the update has taken over already (a second click, a restart in another tab)', async () => {
    const reload = await registered(null);
    await applyUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });
});
