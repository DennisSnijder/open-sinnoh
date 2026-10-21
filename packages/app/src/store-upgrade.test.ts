import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from './store.ts';

describe('the import database upgrade', () => {
  it('version 2 drops the unused saves store and keeps the imports', async () => {
    // Its own database factory: test files share a worker (isolate: false), and store.test.ts makes a version 2 one.
    vi.stubGlobal('indexedDB', new IDBFactory());
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('lantern-nds', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('imports', { keyPath: 'key' });
        req.result.createObjectStore('files');
        req.result.createObjectStore('saves');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect([...old.objectStoreNames]).toContain('saves');
    old.close();
    const db = await openDb();
    expect([...db.objectStoreNames].sort()).toEqual(['files', 'imports']);
    db.close();
    vi.unstubAllGlobals();
  });
});
