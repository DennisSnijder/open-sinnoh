/**
 * Save storage: IndexedDB slots (browser) and JSON file export/import. Stored saves are validated by
 * `game.load` like any other untrusted input.
 */
import type { SaveEnvelope } from '@opensinnoh/contracts';
import { NotASaveError } from './save.ts';

const STORE = 'saves';

export interface SaveSlot {
  slot: string;
  savedAt: string;
  player: string;
}

/** The browser has no room for the save. The slot still holds the previous save. */
export class SaveStorageFullError extends Error {
  constructor(cause: unknown) {
    super('Your browser is out of storage space, so this save was not written. Your previous save is kept. Free some space on your device, then save again.', { cause });
  }
}

export class IndexedDbSaveStore {
  private db: Promise<IDBDatabase> | undefined;
  /** The open connection, once the open has resolved. */
  private handle: IDBDatabase | undefined;

  constructor(
    private readonly name = 'lantern-nds', // legacy name (the app passes `lantern-nds-saves`)
    private readonly factory: IDBFactory = globalThis.indexedDB,
  ) {}

  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve((this.handle = req.result));
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    }));
  }

  /** Closes the connection (the page is going away); a later call opens it again. */
  close(): void {
    this.handle?.close();
    this.handle = undefined;
    this.db = undefined;
  }

  /** Runs one request in a transaction and resolves after the transaction commits. */
  private async run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  /** Writes the slot in one transaction: a failure (a full disk included) leaves the old save as it was. */
  async put(slot: string, save: SaveEnvelope): Promise<void> {
    try {
      await this.run('readwrite', (s) => s.put(saveToJson(save), slot));
    } catch (e) {
      if (e instanceof DOMException && e.name === 'QuotaExceededError') throw new SaveStorageFullError(e);
      throw e;
    }
  }

  /** The stored JSON text (pass it to `saveFromJson` and `game.load`), or undefined. */
  async get(slot: string): Promise<string | undefined> {
    return (await this.run('readonly', (s) => s.get(slot))) as string | undefined;
  }

  async list(): Promise<SaveSlot[]> {
    const keys = (await this.run('readonly', (s) => s.getAllKeys())) as string[];
    const out: SaveSlot[] = [];
    for (const slot of keys.sort()) {
      const text = await this.get(slot);
      if (text === undefined) continue; // removed since getAllKeys
      const env = saveFromJson(text) as { savedAt?: unknown; state?: { names?: { player?: unknown } } } | null;
      const savedAt = env?.savedAt;
      const player = env?.state?.names?.player;
      if (typeof savedAt !== 'string' || typeof player !== 'string') throw new Error(`save slot "${slot}" is malformed (no savedAt or player name)`);
      out.push({ slot, savedAt, player });
    }
    return out;
  }

  async remove(slot: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(slot));
  }
}

export function saveToJson(save: SaveEnvelope): string {
  return JSON.stringify(save, null, 1) + '\n';
}

/** Parses an imported save file; shape and ids are checked by `game.load`. */
export function saveFromJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new NotASaveError(`This file is not an OpenSinnoh save (it is not JSON: ${(e as Error).message}).`, { cause: e });
  }
}

export function saveFileName(save: SaveEnvelope): string {
  const stamp = save.savedAt.replace(/[^0-9T]/g, '').slice(0, 15);
  return `opensinnoh-${save.state.names.player.replace(/[^\p{L}\p{N}_-]/gu, '') || 'save'}-${stamp}.json`;
}
