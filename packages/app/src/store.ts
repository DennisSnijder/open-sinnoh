/**
 * IndexedDB storage (main thread and the import worker).
 * - `imports`: one meta row per imported pack (the base, and the optional HGSS follower add-on with
 *   `addon` set), keyed `romSha1:importerVersion`. Written last, so an interrupted import never looks complete.
 * - `files`: the base pack as Blobs keyed [key, path]: its PackData JSON at PACK_DATA_PATH and its
 *   assets (models, textures, fonts) at their pack paths.
 * Saves are not here: they live in packages/game's IndexedDbSaveStore, database `lantern-nds-saves`. (Version 1 of this
 * database had an unused `saves` store; version 2 drops it.)
 */
const DB_NAME = 'lantern-nds'; // pre-rename name, kept: players' stored data uses it
const DB_VERSION = 2;

/** The stored import is missing files or does not match its meta row. The message is for the player; the fix is to import the ROM again. */
export class ImportIncompleteError extends Error {
  constructor(
    /** What is missing or wrong, for the ROM page's re-import notice. */
    readonly detail: string,
  ) {
    super(`Your imported game data is incomplete (${detail}). Import your ROM again to repair it; your saves are kept.`);
  }
}

/**
 * The browser aborted a write with no failed request to blame: Safari does this when the page is suspended (sent to the
 * background, the phone locked) or closed, and a full device can show this way too.
 */
export class StorageAbortedError extends Error {
  override readonly name = 'StorageAbortedError';
  constructor() {
    super('IndexedDB transaction aborted by the browser (the page was suspended or closed, or storage is full)');
  }
}

export interface ImportMeta {
  key: string;
  romSha1: string;
  romName: string;
  importerVersion: string;
  files: number;
  bytes: number;
  importedAt: string;
  /** An add-on pack (the HGSS follower art), not a base game; absent for the base import. */
  addon?: 'hgss-followers';
  /**
   * Every file's size was checked against `bytes` once (`checkImport`): by the import worker as it finishes, or on the
   * first start of an import stored before this field. Later starts count the files only.
   */
  checked?: true;
}

/** Where the imported PackData JSON is stored (not a valid asset path). */
export const PACK_DATA_PATH = '@pack-data.json';

export const importKey = (romSha1: string, importerVersion: string): string => `${romSha1}:${importerVersion}`;

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new StorageAbortedError());
  });
}

export function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = (e) => {
    const db = req.result;
    if (e.oldVersion < 1) {
      db.createObjectStore('imports', { keyPath: 'key' });
      db.createObjectStore('files');
    } else if (e.oldVersion < 2) db.deleteObjectStore('saves');
  };
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      // A newer version of the app upgrading the database asks this connection to step aside.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onblocked = () => reject(new Error('OpenSinnoh is open in another tab and blocks a storage update. Close the other tabs and reload.'));
  });
}

export async function listImports(db: IDBDatabase): Promise<ImportMeta[]> {
  return done(db.transaction('imports').objectStore('imports').getAll() as IDBRequest<ImportMeta[]>);
}

const MIME: Record<string, string> = { json: 'application/json', gltf: 'model/gltf+json', png: 'image/png', ir: 'text/plain' };
const mimeOf = (path: string) => MIME[path.slice(path.lastIndexOf('.') + 1)] ?? 'application/octet-stream';

/** Writes files in batches (one transaction each) so a large pack does not sit in one huge transaction. */
export async function putFiles(db: IDBDatabase, key: string, files: Iterable<[string, Uint8Array]>, batchBytes = 16 * 1024 * 1024): Promise<{ files: number; bytes: number }> {
  let count = 0;
  let bytes = 0;
  let batch: [string, Uint8Array][] = [];
  let batchSize = 0;
  const flush = async () => {
    if (!batch.length) return;
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    for (const [path, data] of batch) store.put(new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeOf(path) }), [key, path]);
    await committed(tx);
    batch = [];
    batchSize = 0;
  };
  for (const entry of files) {
    batch.push(entry);
    batchSize += entry[1].byteLength;
    count++;
    bytes += entry[1].byteLength;
    if (batchSize >= batchBytes) await flush();
  }
  await flush();
  return { files: count, bytes };
}

export async function putMeta(db: IDBDatabase, meta: ImportMeta): Promise<void> {
  const tx = db.transaction('imports', 'readwrite');
  tx.objectStore('imports').put(meta);
  await committed(tx);
}

export async function readFile(db: IDBDatabase, key: string, path: string): Promise<Blob | undefined> {
  return done(db.transaction('files').objectStore('files').get([key, path]) as IDBRequest<Blob | undefined>);
}

/**
 * `readFile` for many reads at once: the reads asked for in one task (a scene's models, then their buffers and textures)
 * share one transaction, and each resolves as its own request does, so decoding starts while the rest are read. A
 * transaction per file queued in the browser: a first visit's 130 reads took 160 ms each on average (up to 700 ms).
 */
export function batchedReader(db: IDBDatabase): (key: string, path: string) => Promise<Blob | undefined> {
  let queue: { key: string; path: string; resolve: (b: Blob | undefined) => void; reject: (e: unknown) => void }[] = [];
  // A message, not a timer: a timer in a background tab waits up to a second.
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    const batch = queue;
    queue = [];
    let store: IDBObjectStore;
    try {
      store = db.transaction('files').objectStore('files');
    } catch (e) {
      for (const r of batch) r.reject(e);
      return;
    }
    for (const r of batch) done(store.get([r.key, r.path]) as IDBRequest<Blob | undefined>).then(r.resolve, r.reject);
  };
  return (key, path) =>
    new Promise((resolve, reject) => {
      if (!queue.length) channel.port2.postMessage(null);
      queue.push({ key, path, resolve, reject });
    });
}

/** Meta first, so a half-deleted import is never offered. */
export async function deleteImport(db: IDBDatabase, key: string): Promise<void> {
  const tx = db.transaction(['imports', 'files'], 'readwrite');
  tx.objectStore('imports').delete(key);
  tx.objectStore('files').delete(IDBKeyRange.bound([key, ''], [key, '￿']));
  await committed(tx);
}

/**
 * Checks one import against its meta row and returns the row as it is now. Every start: every file is there (a count of
 * the import's keys, which reads no file) and so is the pack data. Once per import (`checked` absent: in the import
 * worker as it finishes, or on the first start of an import stored before the field): the sizes add up to `bytes` too, which reads every
 * file's Blob handle (650 ms at 4x CPU throttling for 14,600 files); passing it stores `checked` on the row.
 * Throws ImportIncompleteError for a partial or missing import.
 */
export async function checkImport(db: IDBDatabase, meta: ImportMeta): Promise<ImportMeta> {
  const range = IDBKeyRange.bound([meta.key, ''], [meta.key, '\uffff']);
  const store = db.transaction('files').objectStore('files');
  const [files, packData] = await Promise.all([done(store.count(range)), done(store.count([meta.key, PACK_DATA_PATH]))]);
  if (files !== meta.files) throw new ImportIncompleteError(`${files} of ${meta.files} files`);
  if (!packData) throw new ImportIncompleteError('no pack data');
  if (meta.checked) return meta;
  const blobs = await done(db.transaction('files').objectStore('files').getAll(range) as IDBRequest<Blob[]>);
  let bytes = 0;
  for (const b of blobs) bytes += b.size;
  if (bytes !== meta.bytes) throw new ImportIncompleteError(`${bytes} of ${meta.bytes} bytes`);
  const checked: ImportMeta = { ...meta, checked: true };
  // Only a shortcut for later starts: a device too full to store the mark still plays (the next start checks again).
  await putMeta(db, checked).catch((e: Error) => console.warn(`could not store the import's check: ${e.message}`));
  return checked;
}
