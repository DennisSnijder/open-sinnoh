/**
 * Import worker: receives the picked ROM file, verifies it, runs the importer (packages/importer importPlatinum)
 * and writes the base pack (PackData JSON + assets) straight into IndexedDB, so the pack never crosses back to the page.
 *
 * Memory (the import's peak is budgeted, tools/perf-budgets.json; iOS kills tabs over it): the whole file is read once for its
 * SHA-1 and let go, and the importer then reads the file a range at a time. Holding the 134 MB image through the
 * run, and stringifying the 25 MB pack JSON whole, set the old peak (719 MB).
 */
import { HGSS_ROMS, type HashedRom } from '@opensinnoh/nds';
import { ADDON_VERSION, IMPORTER_VERSION, runAddonImporter, runImporter } from './importer.ts';
import { jsonBytes } from './json-bytes.ts';
import { verifyRom } from './rom-check.ts';
import { S, setLanguage, type Language } from './strings/index.ts';
import { checkImport, deleteImport, importKey, openDb, PACK_DATA_PATH, putFiles, putMeta, StorageAbortedError, type ImportMeta } from './store.ts';

/** `addon`: the file was given as the optional HeartGold/SoulSilver ROM (anything else is refused then); `language`: the page's, for the messages. */
export type ImportRequest = { rom: File; addon?: boolean; language: Language };
export type ImportMessage =
  | { type: 'progress'; stage: string; done: number; total: number }
  /** `thrown`: the stack of an error the importer threw (a bug, reported); absent for a rejected file. */
  | { type: 'error'; message: string; sha1?: string; thrown?: string }
  | { type: 'done'; meta: ImportMeta; ms: number };

const post = (m: ImportMessage) => (self as unknown as Worker).postMessage(m);

/** Workers only (not in the DOM lib). */
declare const FileReaderSync: new () => { readAsArrayBuffer(blob: Blob): ArrayBuffer };

/** The picked file, read a range at a time (synchronously: the importers are), with its SHA-1. */
function romFile(file: File, sha1: string): HashedRom {
  const reader = new FileReaderSync();
  return { size: file.size, sha1, read: (start, end) => new Uint8Array(reader.readAsArrayBuffer(file.slice(start, end))) };
}

self.onmessage = async (e: MessageEvent<ImportRequest>) => {
  const started = performance.now();
  let sha1: string | undefined;
  let db: IDBDatabase | undefined;
  let key: string | undefined;
  setLanguage(e.data.language);
  try {
    post({ type: 'progress', stage: S.rom.verifying, done: 0, total: 1 });
    const check = await verifyRom(new Uint8Array(await e.data.rom.arrayBuffer()));
    sha1 = check.sha1;
    // The optional HeartGold/SoulSilver ROM is told apart by its SHA-1 (dropped anywhere, or on its own picker).
    const addon = !!HGSS_ROMS[sha1];
    if (e.data.addon && !addon) return post({ type: 'error', message: S.rom.notHgss(Object.values(HGSS_ROMS).map((r) => r.name).join(S.rom.or)), sha1 });
    if (!check.ok && !addon) return post({ type: 'error', message: check.message, sha1 });
    const progress = (p: { stage: string; done: number; total: number }) => post({ type: 'progress', ...p });
    const rom = romFile(e.data.rom, sha1);
    const { pack, assets, romName } = addon ? await runAddonImporter(rom, progress) : { ...(await runImporter(rom, progress)), romName: check.ok ? check.rom.name : '' };
    // Each asset is let go once its batch is written: holding every asset to the end set the import's memory peak.
    function* files(): Generator<[string, Uint8Array]> {
      yield [PACK_DATA_PATH, jsonBytes(pack)];
      for (const entry of assets) {
        assets.delete(entry[0]);
        yield entry;
      }
    }
    post({ type: 'progress', stage: S.rom.saving, done: 0, total: 1 });
    db = await openDb();
    const version = addon ? ADDON_VERSION : IMPORTER_VERSION;
    key = importKey(sha1, version);
    await deleteImport(db, key); // re-import of the same ROM: never leave a half-overwritten pack marked complete
    const written = await putFiles(db, key, files());
    const meta: ImportMeta = { key, romSha1: sha1, romName, importerVersion: version, ...written, importedAt: new Date().toISOString(), ...(addon ? { addon: 'hgss-followers' as const } : {}) };
    await putMeta(db, meta);
    // The full check (every size) once, here: later starts only count the files. A failure is a bug, reported as one.
    const checked = await checkImport(db, meta);
    db.close();
    post({ type: 'done', meta: checked, ms: Math.round(performance.now() - started) });
  } catch (err) {
    // A half-written pack has no meta row, so it is never offered, but it still takes room: remove it.
    if (db && key) await deleteImport(db, key).catch((e: Error) => console.error(`could not remove the partial import: ${e.message}`));
    db?.close();
    if ((err as Error).name === 'QuotaExceededError') return post({ type: 'error', message: S.rom.quota, ...(sha1 ? { sha1 } : {}) });
    // Still reported: the cause (the page suspended, or a full device) is not known for sure.
    const message = err instanceof StorageAbortedError ? S.rom.storageAborted : S.rom.importFailed((err as Error).message);
    post({ type: 'error', message, thrown: (err as Error).stack ?? '', ...(sha1 ? { sha1 } : {}) });
  }
};
