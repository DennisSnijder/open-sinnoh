import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { SaveEnvelope } from '@opensinnoh/contracts';
import { NotASaveError } from './save.ts';
import { IndexedDbSaveStore, SaveStorageFullError, saveFileName, saveFromJson, saveToJson } from './storage.ts';

const save = { format: 'lantern-nds-save', version: 1, savedAt: '2026-10-14T08:00:00.000Z', state: { names: { player: 'Ari', rival: 'Bo' } } } as unknown as SaveEnvelope;

describe('save storage', () => {
  it('puts, lists, gets and removes slots in IndexedDB', async () => {
    const store = new IndexedDbSaveStore('opensinnoh-test');
    await store.put('slot-1', save);
    expect(await store.list()).toEqual([{ slot: 'slot-1', savedAt: save.savedAt, player: 'Ari' }]);
    expect(saveFromJson((await store.get('slot-1'))!)).toEqual(save);
    await store.remove('slot-1');
    expect(await store.get('slot-1')).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it('a malformed row fails the listing loudly', async () => {
    const store = new IndexedDbSaveStore('opensinnoh-test-bad');
    await store.put('bad', { ...save, state: {} } as unknown as SaveEnvelope);
    await expect(store.list()).rejects.toThrow('save slot "bad" is malformed');
  });

  it('exports and imports JSON files', () => {
    expect(saveFromJson(saveToJson(save))).toEqual(save);
    expect(saveFileName(save)).toBe('opensinnoh-Ari-20261014T080000.json');
    expect(() => saveFromJson('{oops')).toThrow(/not an OpenSinnoh save \(it is not JSON/);
    expect(() => saveFromJson('{oops')).toThrow(NotASaveError);
  });

  it('a full disk says so and leaves the old slot as it was', async () => {
    const store = new IndexedDbSaveStore('opensinnoh-test-quota');
    await store.put('main', save);
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('no room', 'QuotaExceededError');
    });
    const newer = { ...save, savedAt: '2026-10-15T08:00:00.000Z' };
    await expect(store.put('main', newer)).rejects.toThrow(SaveStorageFullError);
    await expect(store.put('main', newer)).rejects.toThrow(/previous save is kept/);
    put.mockRestore();
    expect(saveFromJson((await store.get('main'))!)).toEqual(save);
    await store.put('main', newer);
    expect(saveFromJson((await store.get('main'))!)).toEqual(newer);
  });

  it('any other write failure is not turned into the full-disk message', async () => {
    const store = new IndexedDbSaveStore('opensinnoh-test-other');
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('closed', 'InvalidStateError');
    });
    await expect(store.put('main', save)).rejects.not.toThrow(SaveStorageFullError);
    put.mockRestore();
  });
});
