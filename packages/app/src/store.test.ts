import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { batchedReader, checkImport, deleteImport, ImportIncompleteError, importKey, listImports, openDb, PACK_DATA_PATH, putFiles, putMeta, StorageAbortedError, type ImportMeta } from './store.ts';

const bytes = (n: number) => new Uint8Array(n).fill(7);
const metaFor = (key: string, files: number, size: number): ImportMeta => ({ key, romSha1: 'abc', romName: 'Test ROM', importerVersion: 'v', files, bytes: size, importedAt: 'now' });

async function importPack(db: IDBDatabase, key: string, extra: [string, Uint8Array][]): Promise<ImportMeta> {
  const written = await putFiles(db, key, [[PACK_DATA_PATH, bytes(10)], ...extra]);
  const meta = { ...metaFor(key, written.files, written.bytes) };
  await putMeta(db, meta);
  return meta;
}

describe('import integrity', () => {
  it('a complete import passes, and so does one for a key that shares a prefix with another', async () => {
    const db = await openDb();
    const a = await importPack(db, importKey('a', 'v'), [['models/1.gltf', bytes(100)]]);
    await importPack(db, importKey('a', 'v2'), [['models/1.gltf', bytes(5)]]);
    await checkImport(db, a);
    db.close();
  });

  it('a missing file, a different size or no pack data is an incomplete import', async () => {
    const db = await openDb();
    const key = importKey('b', 'v');
    const meta = await importPack(db, key, [['models/1.gltf', bytes(100)], ['models/2.gltf', bytes(50)]]);
    await expect(checkImport(db, { ...meta, files: meta.files + 1 })).rejects.toThrow(ImportIncompleteError);
    await expect(checkImport(db, { ...meta, files: meta.files + 1 })).rejects.toThrow(/2 of 4 files|3 of 4 files/);
    await expect(checkImport(db, { ...meta, bytes: meta.bytes + 1 })).rejects.toThrow(/bytes/);
    // The pack data row is gone but the count still matches another file.
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete([key, PACK_DATA_PATH]);
    tx.objectStore('files').put(new Blob([bytes(10)]), [key, 'zzz']);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    await expect(checkImport(db, meta)).rejects.toThrow(/no pack data/);
    db.close();
  });

  it('a deleted import is gone from the list and the store', async () => {
    const db = await openDb();
    const meta = await importPack(db, importKey('c', 'v'), []);
    await deleteImport(db, meta.key);
    expect((await listImports(db)).find((m) => m.key === meta.key)).toBeUndefined();
    await expect(checkImport(db, meta)).rejects.toThrow(ImportIncompleteError);
    db.close();
  });

  it('checks every size once, stores the mark, and then only counts the files', async () => {
    const db = await openDb();
    const key = importKey('d', 'v');
    // As the import worker (and every import before the mark) leaves it: no `checked`.
    const meta = await importPack(db, key, [['models/1.gltf', bytes(100)], ['models/2.gltf', bytes(50)]]);
    expect(meta.checked).toBeUndefined();
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const fileReads = () => getAll.mock.contexts.filter((store) => (store as IDBObjectStore).name === 'files').length;
    const checked = await checkImport(db, meta);
    expect(checked).toEqual({ ...meta, checked: true });
    expect(fileReads()).toBe(1);
    // The stored row carries the mark: the next start reads no Blob handles.
    const stored = (await listImports(db)).find((m) => m.key === key)!;
    expect(stored.checked).toBe(true);
    expect(await checkImport(db, stored)).toBe(stored);
    expect(fileReads()).toBe(1);
    getAll.mockRestore();
    // A marked import that lost a file, or its pack data, still fails.
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').delete([key, 'models/2.gltf']);
    await new Promise((resolve) => (tx.oncomplete = resolve));
    await expect(checkImport(db, stored)).rejects.toThrow('2 of 3 files');
    const swap = db.transaction('files', 'readwrite');
    swap.objectStore('files').delete([key, PACK_DATA_PATH]);
    swap.objectStore('files').put(new Blob([bytes(10)]), [key, 'zzz']);
    swap.objectStore('files').put(new Blob([bytes(10)]), [key, 'zzzz']);
    await new Promise((resolve) => (swap.oncomplete = resolve));
    await expect(checkImport(db, stored)).rejects.toThrow('no pack data');
    db.close();
  });

  it('an unmarked import whose sizes do not add up fails and stays unmarked', async () => {
    const db = await openDb();
    const meta = await importPack(db, importKey('e', 'v'), [['models/1.gltf', bytes(100)]]);
    await putMeta(db, { ...meta, bytes: meta.bytes + 1 });
    await expect(checkImport(db, { ...meta, bytes: meta.bytes + 1 })).rejects.toThrow(`${meta.bytes} of ${meta.bytes + 1} bytes`);
    expect((await listImports(db)).find((m) => m.key === meta.key)!.checked).toBeUndefined();
    db.close();
  });

  it('a write the browser aborts is a StorageAbortedError; failing to store the mark does not stop the start', async () => {
    const db = await openDb();
    const meta = await importPack(db, importKey('f', 'v'), [['models/1.gltf', bytes(100)]]);
    // Safari suspending the page: the transaction aborts with no failed request.
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore) {
      this.transaction.abort();
      return {} as IDBRequest<IDBValidKey>;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(putMeta(db, meta)).rejects.toThrow(StorageAbortedError);
    expect(await checkImport(db, meta)).toEqual({ ...meta, checked: true });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not store the import's check: .*aborted by the browser/));
    put.mockRestore();
    warn.mockRestore();
    expect((await listImports(db)).find((m) => m.key === meta.key)!.checked).toBeUndefined();
    db.close();
  });
});

describe('batched reads', () => {
  it('reads asked for in one task share one transaction, each with its own result', async () => {
    const db = await openDb();
    const key = importKey('f', 'v');
    await putFiles(db, key, [['a.png', bytes(1)], ['b.png', bytes(2)], ['c.png', bytes(3)]]);
    const read = batchedReader(db);
    const transaction = vi.spyOn(db, 'transaction');
    const first = await Promise.all([read(key, 'a.png'), read(key, 'b.png'), read(key, 'missing.png'), read(key, 'c.png')]);
    expect(first.map((b) => b?.size)).toEqual([1, 2, undefined, 3]);
    expect(transaction).toHaveBeenCalledTimes(1);
    // A later task's reads: a transaction of their own.
    expect((await read(key, 'b.png'))!.size).toBe(2);
    expect(transaction).toHaveBeenCalledTimes(2);
    transaction.mockRestore();
    db.close();
  });

  it('a read on a closed database fails, and so does every read of its batch', async () => {
    const db = await openDb();
    const read = batchedReader(db);
    db.close();
    const results = await Promise.allSettled([read('k', 'a.png'), read('k', 'b.png')]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
  });
});
