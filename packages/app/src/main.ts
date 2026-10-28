/**
 * Entry. URL modes:
 *   (none)          imported base pack from IndexedDB, or the ROM picker when there is none
 *   ?packs=a,b      packs from the opensinnoh dev server (`pnpm dev` = `opensinnoh dev packs/fixture packs/demo-mod`; no ROM needed)
 *   ?replay         wall clock off, `window.openSinnohGame` bridge on (combine with ?packs=fixture)
 *   ?reimport       show the ROM picker even when an import exists
 *   ?title          show the title screen with ?packs= too (it is skipped there and in replay mode)
 *   ?ui-gallery     dev builds: every OpenSinnoh UI component and state in both themes (ui-gallery.ts)
 *   ?clock=yyyy-mm-ddThh:mm, ?time=hh:mm
 *                   QA: the game clock starts there and runs on (normal play reads the device's local
 *                   time; replay mode freezes it at 2009-03-22 12:00, set by the replay's date/time lines)
 */
import './style.css';
import { CONTRACTS_VERSION } from '@opensinnoh/contracts';
import { installUi, setUiWords } from '@opensinnoh/ui';
import { clockOverride, deviceClock } from './clock.ts';
import { startFlashing } from './flashing.ts';
import { ADDON_VERSION, IMPORTER_VERSION } from './importer.ts';
import type { ImportMessage, ImportRequest } from './import-worker.ts';
import { captureInstallPrompt, formatBytes, importSpaceProblem, installSafeAreaHook, registerServiceWorker, requestPersistence, showIosHint, storageSummary } from './platform.ts';
import { isChunkError, loadChunk } from './chunk.ts';
import { checkRomSize } from './rom-check.ts';
import { checkImport, deleteImport, ImportIncompleteError, listImports, openDb, type ImportMeta } from './store.ts';
import { crash } from './telemetry/crash.ts';
import { IMPORT_SECONDS_KEY } from './telemetry/perf.ts';
import { durationBucket, initAnalytics, track } from './telemetry/analytics.ts';
import { buildRomScreen, clearRomError, hideBaseJob, mountWizard, setAddonJob, setImportDone, setImportProgress, setStart, showAddonError, showRomError, showRomNote, showRomNotice, showRomStep } from './rom-screen.ts';
import { FirstRun, pendingSteps } from './first-run.ts';
import type { SetupQuestion } from './title/setup-questions.ts';
import { splashDone, splashPhase } from './splash.ts';
import { installTouchGuards } from './touch.ts';
import { watchForUpdate } from './update-toast.ts';
import { addContextSource, breadcrumb, captureError, initTelemetry, installGlobalHandlers, setTag } from './telemetry/index.ts';
import { chooseLanguage, language, S, setLanguage, type Language } from './strings/index.ts';
import { readKeyboardLayout } from './controls.ts';

// Error reports (telemetry/): only with a DSN in the build (Vercel's VITE_SENTRY_DSN) and the player's setting on.
initTelemetry({
  // Dev builds (tests) may point reports at a local route; production builds read only the build's DSN.
  dsn: import.meta.env.VITE_SENTRY_DSN || (import.meta.env.DEV ? (window as { openSinnohTestDsn?: string }).openSinnohTestDsn : undefined),
  release: import.meta.env.VITE_OPENSINNOH_RELEASE,
  environment: import.meta.env.VITE_OPENSINNOH_ENV,
});
// OpenSinnoh UI (Options and our own screens): tokens, the theme override, fonts and the input density.
installUi();

/** OpenSinnoh's own words in `lang` (strings/): the tables, the components' words and index.html's static parts. */
function applyLanguage(lang: Language): void {
  setLanguage(lang);
  setUiWords(S.ui);
  document.documentElement.lang = lang;
  const label = (selector: string, text: string) => document.querySelector(selector)!.setAttribute('aria-label', text);
  label('#main-canvas', S.page.fieldView);
  label('#battle-canvas', S.page.battle);
  label('#panel-canvas', S.page.touchPanel);
  for (const d of ['up', 'down', 'left', 'right'] as const) label(`#dpad [data-button="${d}"]`, S.page[d]);
  label('#ios-hint-close', S.page.dismiss);
  document.querySelector('#ios-hint span')!.textContent = S.page.iosHint;
  // The splash is gone once the first screen is up (a later call finds no Reload).
  const reload = document.querySelector('#splash-hint button');
  if (reload) reload.textContent = S.page.reload;
}
// The browser's language until the stored game's is known (`start`).
applyLanguage(chooseLanguage(undefined, navigator.languages));
// Key names in Options › Controls by the keyboard's layout, where the browser tells it (controls.ts).
readKeyboardLayout();
startFlashing();
// The browser's install prompt can come before anything asks for it: keep it (platform.ts). Test builds get the safe-area hook.
captureInstallPrompt();
if (import.meta.env.DEV) installSafeAreaHook();
setTag('importer', IMPORTER_VERSION);
setTag('contracts', CONTRACTS_VERSION);
addContextSource(() => ({ viewport: `${innerWidth}x${innerHeight}`, dpr: devicePixelRatio || 1, touch: matchMedia('(pointer: coarse)').matches }));
installGlobalHandlers();
// iPhone: no loupe, callout or page zoom on the game's surfaces (touch.ts).
installTouchGuards();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const replay = params.has('replay');
/** The title screen opens every launch of the imported game; replays and dev packs skip it unless asked. */
const title = !replay && (!params.has('packs') || params.has('title'));
/** The game clock: the device's (or a `?clock=`/`?time=` start); none in replay mode (frozen in the game). */
const clock = replay ? undefined : deviceClock(clockOverride(params));
// Anonymous analytics (telemetry/analytics.ts): only in the production deployment, never in replays; dev builds (the browser spec) opt in.
initAnalytics({
  enabled: !replay && (import.meta.env.VITE_OPENSINNOH_ENV === 'production' || (import.meta.env.DEV && (window as { openSinnohTestAnalytics?: boolean }).openSinnohTestAnalytics === true)),
  version: import.meta.env.VITE_OPENSINNOH_RELEASE.slice(0, 7),
});

/** The ROM screen (rom-screen.ts): the picker or the session (the imports and the first-run setup). Never shown with the title. */
function show(screen: 'picker' | 'importing'): void {
  buildRomScreen({ onFile: (file) => void pickBase(file), onStart: goHome });
  showRomStep(screen);
  splashDone();
}

/** Shows an error on the picker: a file's (with a retry hint) unless `heading` names another failure. */
function fail(message: string, sha1?: string, heading?: string): void {
  show('picker');
  showRomError(message, sha1, heading);
}

function goHome(): void {
  location.replace(location.pathname);
}

/** An import that did not happen: the message is the player's (a wrong file, no room); `heading` names a failure that is not the file's. */
class ImportFailure extends Error {
  constructor(
    message: string,
    readonly sha1?: string,
    readonly heading?: string,
  ) {
    super(message);
  }
}

/** The checks before an import starts (before the file is read): its size, and room for it. */
async function preflight(file: File, addon: boolean): Promise<ImportFailure | null> {
  const sizeError = checkRomSize(file.size);
  if (sizeError) return new ImportFailure(sizeError);
  // The old imports go first: the space they free counts, and the new import does not write over their removal.
  await staleRemoved;
  // Room first: a full disk should not be found out 100 MB into the import. An import this one replaces gives its space back.
  const space = await importSpaceProblem(await replacedBytes(addon));
  return space ? new ImportFailure(space, undefined, S.rom.notEnoughStorage) : null;
}

/**
 * One import in the worker. `addon`: the file came from the add-on's picker (the worker refuses any other ROM then);
 * a HeartGold/SoulSilver ROM from the Platinum picker imports as the add-on too (the result's `addon` says so).
 * Resolves with the stored import, once the older one of its kind is gone; rejects with an ImportFailure.
 */
function runImport(file: File, addon: boolean, onProgress: (stage: string, value: number | null) => void): Promise<ImportMeta> {
  breadcrumb('import', 'start');
  track('rom_import_start', { addon });
  onProgress(S.rom.readingFile, null);
  const worker = new Worker(new URL('./import-worker.ts', import.meta.url), { type: 'module' });
  return new Promise<ImportMeta>((resolve, reject) => {
    worker.onerror = (e) => {
      worker.terminate();
      captureError(new Error(`import worker: ${e.message || 'crashed'}`), 'import');
      reject(new ImportFailure(e.message || S.rom.workerCrashed, undefined, S.rom.importFailedHeading));
    };
    worker.onmessage = (e: MessageEvent<ImportMessage>) => {
      const m = e.data;
      if (m.type === 'progress') return onProgress(m.stage, m.total > 0 && m.done > 0 ? m.done / m.total : null);
      worker.terminate();
      if (m.type === 'error') {
        // A rejected file (wrong ROM, too small) is the player's to fix; a thrown importer error is a bug.
        if (m.thrown !== undefined) captureError(Object.assign(new Error(m.message), { stack: m.thrown }), 'import', { extra: m.sha1 ? { rom: m.sha1 } : {} });
        return reject(new ImportFailure(m.message, m.sha1));
      }
      resolve(finishImport(m.meta, m.ms));
    };
    // The File, not its bytes: the worker reads it (once whole for the SHA-1, then a range at a time).
    worker.postMessage({ rom: file, addon, language: language() } satisfies ImportRequest);
  });
}

async function finishImport(meta: ImportMeta, ms: number): Promise<ImportMeta> {
  if (!meta.addon) {
    try {
      sessionStorage.setItem(IMPORT_SECONDS_KEY, String(Math.round(ms / 100) / 10));
    } catch {
      // Blocked storage: the performance summary goes without the import time.
    }
  }
  track('rom_import_done', { duration: durationBucket(ms), addon: !!meta.addon });
  if (meta.addon) track('hgss_addon_enabled');
  console.info(`import done in ${ms} ms: ${meta.files} files, ${formatBytes(meta.bytes)}${meta.addon ? ` (${meta.addon})` : ''}`);
  await requestPersistence();
  const db = await openDb();
  // One base and at most one add-on: a new import replaces the older one of its kind.
  for (const other of await listImports(db)) if (other.key !== meta.key && !!other.addon === !!meta.addon) await deleteImport(db, other.key);
  db.close();
  return meta;
}

/**
 * The imports from an older importer, removed once the page is up (deleting 14,600 files held the ROM page for 1.8 s).
 * A failure is reported; the next import of that kind removes them again (`finishImport`).
 */
let staleRemoved: Promise<void> = Promise.resolve();
function removeStale(db: IDBDatabase, stale: readonly ImportMeta[]): void {
  if (!stale.length) return;
  staleRemoved = (async () => {
    for (const m of stale) await deleteImport(db, m.key);
  })().catch((e: Error) => {
    console.error(`could not remove the old imported game: ${e.message}`);
    captureError(e, 'start');
  });
}

/** The bytes of the stored import (base or add-on) that a new import of that kind replaces. */
async function replacedBytes(addon: boolean): Promise<number> {
  const db = await openDb();
  try {
    return (await listImports(db)).filter((m) => !!m.addon === addon).reduce((sum, m) => sum + m.bytes, 0);
  } finally {
    db.close();
  }
}

/**
 * The session: what runs and what is ready. Start playing waits for the base game (stored now or earlier) and for an
 * add-on import that is running; the setup's open questions do not hold it (the title asks them).
 */
const session = {
  /** A base game is stored (a returning player adding the add-on, or this session's import is done). */
  baseReady: false,
  baseRunning: false,
  /** The add-on's file, waiting for the base import to finish. */
  addonQueued: null as File | null,
  addonRunning: false,
  /** The first-run setup, when this session asks one. */
  wizard: null as FirstRun | null,
};

/** Start playing's state, from the session's; the keyboard goes to it once nothing is left to answer. */
function updateStart(): void {
  const why = session.baseRunning || !session.baseReady ? S.rom.stillImporting : session.addonRunning || session.addonQueued ? S.rom.addonStillImporting : null;
  setStart(why, !why && (!session.wizard || session.wizard.finished));
}

/** A ROM from the Platinum picker (or dropped on the page): the session, the first-run setup, the import. */
async function pickBase(file: File): Promise<void> {
  if (session.baseRunning) return;
  clearRomError();
  const problem = await preflight(file, false);
  if (problem) return fail(problem.message, problem.sha1, problem.heading);
  show('importing');
  startWizard();
  session.baseRunning = true;
  updateStart();
  try {
    const meta = await runImport(file, false, setImportProgress);
    session.baseRunning = false;
    if (meta.addon) {
      // A HeartGold/SoulSilver ROM on the Platinum picker: kept as the add-on; the game still needs Platinum.
      show('picker');
      showRomNote(S.rom.addedNeedPlatinum(meta.romName));
      return;
    }
    session.baseReady = true;
    setImportDone();
    if (session.addonQueued) void importAddon(session.addonQueued);
    updateStart();
  } catch (e) {
    session.baseRunning = false;
    if (!(e instanceof ImportFailure)) throw e;
    // Back to the picker; the setup's answers so far are kept (each is stored at once).
    fail(e.message, e.sha1, e.heading);
  }
}

/** The add-on's file (the setup's question, or Options): imported now, or after the base import. */
function pickAddon(file: File): void {
  if (session.baseReady) return void importAddon(file);
  session.addonQueued = file;
  setAddonJob({ stage: S.rom.waitingForPlatinum, value: 0 });
  updateStart();
}

async function importAddon(file: File): Promise<void> {
  session.addonQueued = null;
  session.addonRunning = true;
  updateStart();
  const failed = (e: ImportFailure) => showAddonError(e.heading ? `${e.heading}. ${e.message}` : e.message, e.sha1, () => void pickFile().then((f) => f && pickAddon(f)));
  try {
    const problem = await preflight(file, true);
    if (problem) return failed(problem);
    setAddonJob({ stage: S.rom.readingFile, value: null });
    const meta = await runImport(file, true, (stage, value) => setAddonJob({ stage, value }));
    setAddonJob({ stage: S.rom.addonDone(meta.romName), value: 1, done: true });
  } catch (e) {
    if (!(e instanceof ImportFailure)) throw e;
    failed(e);
  } finally {
    session.addonRunning = false;
    updateStart();
  }
}

/** The system's file dialog for one ROM file (null when cancelled). */
function pickFile(): Promise<File | null> {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.nds,application/octet-stream' });
  return new Promise((resolve) => {
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** The setup's questions still open on this device, set at boot (none: the session asks nothing). */
let wizardQuestions: readonly SetupQuestion[] = [];

/** The first-run setup in the session, once. */
function startWizard(): void {
  if (session.wizard || !wizardQuestions.length) return;
  session.wizard = new FirstRun(wizardQuestions, { addAddon: pickAddon, done: updateStart });
  mountWizard(session.wizard.root);
}

function showPicker(o: { note?: string; notice?: { title: string; text: string } } = {}): void {
  show('picker');
  if (o.note) showRomNote(o.note);
  if (o.notice) showRomNotice(o.notice.title, o.notice.text);
  // The whole page takes the drop (and must not navigate away to the file); `depth` counts nested dragenters.
  const drop = $('drop');
  let depth = 0;
  addEventListener('dragenter', (e) => {
    e.preventDefault();
    depth++;
    drop.classList.toggle('over', !$('picker').hidden);
  });
  addEventListener('dragleave', () => {
    if (--depth === 0) drop.classList.remove('over');
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove('over');
    if ($('picker').hidden) return;
    const files = e.dataTransfer?.files;
    if (!files || files.length !== 1) return fail(S.rom.dropOne);
    void pickBase(files[0]!);
  });
  void storageSummary().then((s) => ($('picker-storage').textContent = s));
}

/** The re-import notice. Saves live in their own database (`lantern-nds-saves`, game-view.ts), which an import never touches. */
const updatedNotice = () => ({ title: S.rom.reimportUpdated, text: S.rom.saveSafe });
const incompleteNotice = (e: ImportIncompleteError) => ({ title: S.rom.reimport, text: `${S.rom.partMissing(e.detail)} ${S.rom.saveSafe}` });

/** OPTIONS > DATA and the title's setup: the game gives way to the session (no setup), which imports and then offers Start playing. */
function importFromGame(file: File, addon: boolean): void {
  for (const id of ['game', 'title']) document.getElementById(id)?.setAttribute('hidden', '');
  if (!addon) return void pickBase(file);
  show('importing');
  hideBaseJob();
  session.baseReady = true;
  pickAddon(file);
}

async function start(): Promise<void> {
  if (import.meta.env.DEV && params.has('ui-gallery')) {
    await (await import('./ui-gallery.ts')).mountGallery();
    return splashDone();
  }
  registerServiceWorker();
  watchForUpdate();
  track('app_open');
  if (!replay) showIosHint();
  const packs = params.get('packs');
  setTag('source', packs !== null ? 'dev-packs' : 'imported');
  if (replay) setTag('replay', 'true');
  if (packs !== null) {
    const [{ mountGame }, { devSource }] = await Promise.all([loadChunk(() => import('./game-view.ts')), loadChunk(() => import('./pack-source.ts'))]);
    return mountGame(await devSource(packs.split(',').filter(Boolean)), { replay, title, imported: null, ...(clock ? { clock } : {}) });
  }
  splashPhase('data');
  const db = await openDb();
  // The page is going away for good (not into the back/forward cache): close the connection so a new version can upgrade the database.
  addEventListener('pagehide', (e) => !e.persisted && db.close());
  const imports = await listImports(db);
  const stale = imports.filter((m) => m.importerVersion !== (m.addon ? ADDON_VERSION : IMPORTER_VERSION));
  let current: ImportMeta | undefined = imports.find((m) => !m.addon && m.importerVersion === IMPORTER_VERSION);
  let addon: ImportMeta | undefined = imports.find((m) => m.addon && m.importerVersion === ADDON_VERSION);
  // The stored game's language (an older import's too: its re-import notice speaks it), else the browser's.
  applyLanguage(chooseLanguage(imports.find((m) => !m.addon)?.romSha1, navigator.languages));
  // A stored game: its chunk (three.js and the engine, its own chunk so the ROM page never loads it) downloads while
  // the import is checked and read. Handled here too, so a failure seen only by a start that went to the picker is quiet.
  let viewLoaded = false;
  const view = current && !params.has('reimport') ? loadChunk(() => import('./game-view.ts')).then((m) => ((viewLoaded = true), m)) : null;
  view?.catch(() => {});
  // A partial import (an interrupted write, storage the browser trimmed) must not reach the field, where a missing file crashes it.
  let broken: { title: string; text: string } | undefined;
  if (current) {
    try {
      current = await checkImport(db, current);
    } catch (e) {
      if (!(e instanceof ImportIncompleteError)) throw e;
      breadcrumb('import', `incomplete: ${e.message}`);
      broken = incompleteNotice(e);
      current = undefined;
    }
  }
  if (addon) {
    try {
      addon = await checkImport(db, addon);
    } catch (e) {
      if (!(e instanceof ImportIncompleteError)) throw e;
      // The add-on is optional: drop the broken one (Options › Data then offers it again).
      console.warn(`dropped the incomplete follower add-on: ${e.message}`);
      breadcrumb('import', 'add-on incomplete, dropped');
      await deleteImport(db, addon.key);
      addon = undefined;
    }
  }
  if (!current || params.has('reimport')) {
    // The first-run setup asks what this device has not answered (a returning player's re-import: usually nothing).
    wizardQuestions = pendingSteps({ addon: !!addon });
    const reimport = !current && (stale.some((m) => !m.addon) || broken);
    showPicker({
      ...(reimport ? { notice: broken ?? updatedNotice() } : {}),
      ...(stale.some((m) => m.addon) ? { note: S.rom.addonUpdated } : {}),
      ...(addon ? { note: S.rom.addonPresent(addon.romName) } : {}),
    });
    return removeStale(db, stale);
  }
  const { importedSource } = await loadChunk(() => import('./pack-source.ts'));
  const source = await importedSource(db, current.key, addon?.key ?? null);
  if (!viewLoaded) splashPhase('game');
  const { mountGame } = await view!;
  setTag('rom', current.romSha1);
  if (addon) setTag('addon', addon.romSha1);
  // An older add-on's files (the base is current here) go while the game starts, not before it (and not after mountGame,
  // which resolves as the title ends: the field's first scene would wait on them).
  removeStale(db, stale);
  return mountGame(source, {
    replay,
    title,
    ...(clock ? { clock } : {}),
    imported: {
      addon: addon?.romName ?? null,
      removeAddon: async () => {
        if (addon) await deleteImport(db, addon.key);
        goHome();
      },
      // OPTIONS > DATA and the title setup's ADD NOW: the ROM screen's session (the game or the title gives way to
      // its progress, then Start playing; a refused file shows on its picker).
      importRom: importFromGame,
      addAddon: (file) => importFromGame(file, true),
      reimport: () => location.replace(`${location.pathname}?reimport`),
      remove: async () => {
        await deleteImport(db, current.key);
        if (addon) await deleteImport(db, addon.key);
        goHome();
      },
    },
  });
}

start().catch((e: Error) => {
  // A stale chunk after a deploy: the crash screen says so and offers a reload.
  if (isChunkError(e)) return crash(e, 'start');
  console.error(e);
  if (e instanceof ImportIncompleteError) {
    // Not a bug in the game: the stored import is damaged (a file went missing while the game was loading). Import again.
    captureError(e, 'start', { fatal: true });
    wizardQuestions = pendingSteps({ addon: false });
    showPicker({ notice: incompleteNotice(e) });
    return;
  }
  captureError(e, 'start', { fatal: true });
  fail(e.message, undefined, S.rom.couldNotStart);
});
