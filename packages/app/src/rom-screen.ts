/**
 * The ROM page: the first thing a visitor sees, on the OpenSinnoh UI design system (@opensinnoh/ui), carrying on
 * from the landing page (the Beta eyebrow, the animated wordmark, the pitch on the dot-grid field). It shows before
 * any ROM exists, so it uses no ROM art. One window with two views:
 * - the picker: one drop zone for the Platinum ROM (the whole page takes a drop), errors as a banner on top;
 * - the session, once a file is picked: the import's progress (compact), the first-run setup (first-run.ts) while it
 *   runs, the add-on's import if one was picked, and Start playing, enabled once the game is ready. It never starts
 *   on its own.
 * A re-import (the engine was updated, or the stored data is incomplete) shows a calm info banner above the window.
 * main.ts runs the imports; this module builds the DOM (into `#rom`) and updates it. Ids are the page's test hooks.
 */
import { banner, button, filePicker, h, icon, progress, snapPixels, titleTab, wordmark as brandWordmark } from '@opensinnoh/ui';
import { canInstall, onInstallChange, promptInstall } from './platform.ts';
import './rom-screen.css';

const $ = (id: string) => document.getElementById(id)!;

export interface RomScreenDeps {
  /** A file from the picker (or dropped on the page). */
  onFile(file: File): void;
  /** Start playing. */
  onStart(): void;
}

/** The first run's three stages, as the landing page's "How it works" names them. */
const RAIL = ['Your ROM', 'Setup', 'Play'] as const;

/** Builds the screen into `#rom` (once). */
export function buildRomScreen(deps: RomScreenDeps): void {
  const root = $('rom');
  if (root.firstChild) return;

  // The brand, as on the landing page's hero.
  const kick = h('p', 'rom-kick', h('span', 'os-bdg', 'Beta'), 'Playable in your browser');
  const mark = h('h1', 'rom-wordmark', brandWordmark(5, { label: 'OpenSinnoh', animate: true }));
  mark.id = 'rom-wordmark';
  const brand = h(
    'header',
    'rom-brand',
    kick,
    mark,
    h('p', 'rom-pitch', 'Pokémon Platinum, rebuilt from the ground up.'),
    h('p', 'rom-runs', 'Runs right in your browser. No emulator, no download.'),
    h('p', 'rom-tagline', 'Your ROM stays yours: it is read on this device. Nothing is uploaded.'),
  );

  // The rail: where the first run is (the picker, the setup, play).
  const rail = h('ol', 'rom-rail', ...RAIL.map((name, i) => h('li', '', h('span', 'os-num', `0${i + 1}`), h('span', 'rn', name), icon('check'))));
  rail.id = 'rom-rail';
  rail.setAttribute('aria-label', 'Getting started');

  // The picker.
  const need = h('p', 'rom-need', 'You need ', h('strong', '', 'Pokémon Platinum (US)'), ' as an ', h('code', '', '.nds'), ' file, made from your own cartridge.');
  need.id = 'rom-need';
  const drop = filePicker('Choose your Platinum ROM', { hint: 'or drop it anywhere on this page', accept: '.nds,application/octet-stream', id: 'rom-input', describedBy: 'rom-need', icon: 'file', onFile: (f) => deps.onFile(f) });
  drop.id = 'drop';
  const error = h('div', 'rom-error');
  error.id = 'picker-error';
  error.hidden = true;
  const note = h('p', 'rom-note');
  note.id = 'picker-note';
  note.setAttribute('role', 'status');
  note.hidden = true;
  // Where the browser offers it (Chromium, Android): the app installs before the import, and keeps the game on the device.
  const installNote = h('p', 'rom-status');
  installNote.setAttribute('role', 'status');
  const install = button('Install the app', {
    icon: 'import',
    onClick: () => void promptInstall().then((line) => (installNote.textContent = line), (e: Error) => (installNote.textContent = e.message)),
  });
  const installRow = h('div', 'rom-install', h('p', 'rom-need', 'Install OpenSinnoh to play full screen and offline.'), install, installNote);
  installRow.id = 'install-row';
  installRow.hidden = !canInstall();
  onInstallChange(() => (installRow.hidden = !canInstall()));
  const picker = h('section', 'rom-step', h('div', 'rom-body', error, note, drop, need), installRow);
  picker.id = 'picker';
  picker.setAttribute('aria-label', 'Choose your ROM');
  picker.hidden = true;

  // The session: the imports, the setup, Start playing.
  const stage = h('p', 'rom-stage', 'Reading file…');
  stage.id = 'import-stage';
  stage.setAttribute('role', 'status');
  const bar = progress('Importing', null);
  bar.id = 'import-progress';
  const baseJob = h('div', 'rom-job', bar, stage);
  baseJob.id = 'base-job';
  const addonStage = h('p', 'rom-stage');
  addonStage.id = 'addon-stage';
  addonStage.setAttribute('role', 'status');
  const addonBar = progress('HeartGold or SoulSilver', null);
  addonBar.id = 'addon-progress';
  const addonJob = h('div', 'rom-job', addonBar, addonStage);
  addonJob.id = 'addon-job';
  addonJob.hidden = true;
  const addonError = h('div', 'rom-error');
  addonError.id = 'addon-error';
  addonError.hidden = true;
  const wizard = h('div', 'rom-wizard');
  wizard.id = 'wizard-slot';
  const startWhy = h('p', 'rom-why');
  startWhy.id = 'start-why';
  startWhy.setAttribute('aria-live', 'polite');
  const start = h('div', 'rom-start', startButton('Your game is still importing.', deps.onStart), startWhy);
  start.id = 'start-row';
  const importing = h(
    'section',
    'rom-step',
    h('div', 'rom-body', h('div', 'rom-jobs', baseJob, addonJob), addonError, wizard),
    start,
  );
  importing.id = 'importing';
  importing.setAttribute('aria-label', 'Setting up your game');
  importing.hidden = true;

  const notice = h('div', 'rom-notice');
  notice.id = 'rom-notice';
  notice.hidden = true;
  const storage = h('p', '');
  storage.id = 'picker-storage';
  root.append(
    h(
      'div',
      'rom-panel',
      brand,
      h('div', 'rom-main', notice, h('div', 'os-win rom-win', tab('picker'), rail, picker, importing)),
      h('footer', 'rom-foot', h('p', '', 'Unofficial fan project, not affiliated with Nintendo, Game Freak or The Pokémon Company.'), h('p', '', 'Error reports are off until you allow them.'), storage),
    ),
  );
  startHandler = deps.onStart;
}

/** Start playing's action (the button is rebuilt when it becomes ready). */
let startHandler: () => void;

function startButton(why: string | null, onStart: () => void): HTMLButtonElement {
  const b = button('Start playing', { variant: 'primary', big: true, disabled: why, onClick: onStart });
  b.append(icon('right'));
  b.id = 'start-playing';
  return b;
}

/** The window's title tab: what the window is about now. */
function tab(step: 'picker' | 'importing'): HTMLElement {
  const t = step === 'picker' ? titleTab('Your game', { icon: 'file', tone: 'system' }) : titleTab('Setting up your game', { icon: 'disk', tone: 'system' });
  t.id = 'rom-tab';
  return t;
}

/** Shows the picker or the session (the imports and the setup). */
export function showRomStep(step: 'picker' | 'importing'): void {
  $('rom').hidden = false;
  $('rom').dataset.step = step;
  $('picker').hidden = step !== 'picker';
  $('importing').hidden = step !== 'importing';
  $('rom-tab').replaceWith(tab(step));
  rail(step === 'picker' ? 0 : 1);
  void document.fonts.ready.then(() => snapPixels($('rom')));
}

/** The rail's current stage (0 your ROM, 1 setup, 2 play); the ones before it are done. */
function rail(at: number): void {
  $('rom-rail')
    .querySelectorAll('li')
    .forEach((li, i) => {
      li.classList.toggle('done', i < at);
      li.classList.toggle('now', i === at);
      if (i === at) li.setAttribute('aria-current', 'step');
      else li.removeAttribute('aria-current');
    });
}

/** The calm notice above the window: why the ROM page is back (a re-import), and that the save is safe. */
export function showRomNotice(title: string, text: string): void {
  const slot = $('rom-notice');
  slot.replaceChildren(banner(title, text, { tone: 'info' }));
  slot.hidden = false;
}

/** An error at the top of the picker's window: a file's (its SHA-1, and a way to pick another) unless `heading` names another failure. */
export function showRomError(message: string, sha1?: string, heading?: string): void {
  const text: (Node | string)[] = [message];
  if (sha1) text.push(' SHA-1 of your file: ', h('code', '', sha1), '.');
  if (!heading) text.push(' Choose another file to try again.');
  const input = $('rom-input');
  const box = $('picker-error');
  box.replaceChildren(banner(heading ?? 'That file could not be used.', text, heading ? {} : { action: button('Choose another file', { icon: 'import', onClick: () => input.click() }) }));
  box.hidden = false;
  input.focus();
}

export function clearRomError(): void {
  $('picker-error').hidden = true;
}

/** A line under the picker's title (the add-on was updated, …). */
export function showRomNote(text: string): void {
  const note = $('picker-note');
  note.hidden = false;
  note.textContent = text;
}

/** The setup's DOM goes in the session, under the imports. */
export function mountWizard(el: HTMLElement): void {
  $('wizard-slot').replaceChildren(el);
}

/** Hides the base import's row (a session that only imports the add-on). */
export function hideBaseJob(): void {
  $('base-job').hidden = true;
}

/** The base import's stage and progress (0 to 1, or null while its length is unknown). */
export function setImportProgress(stage: string, value: number | null): void {
  $('import-stage').textContent = stage;
  const bar = progress('Importing', value === null ? null : value * 100);
  bar.id = 'import-progress';
  $('import-progress').replaceWith(bar);
}

/** The base import is done. */
export function setImportDone(): void {
  const bar = progress('Ready', 100);
  bar.id = 'import-progress';
  $('import-progress').replaceWith(bar);
  $('base-job').classList.add('done');
  $('import-stage').replaceChildren(icon('check'), 'Pokémon Platinum is imported.');
}

/** The add-on's row: waiting for the base import, importing (stage, progress), or added. */
export function setAddonJob(state: { stage: string; value: number | null; done?: boolean }): void {
  const job = $('addon-job');
  job.hidden = false;
  job.classList.toggle('done', !!state.done);
  const bar = progress(state.done ? 'Added' : 'HeartGold or SoulSilver', state.done ? 100 : state.value === null ? null : state.value * 100);
  bar.id = 'addon-progress';
  $('addon-progress').replaceWith(bar);
  $('addon-stage').replaceChildren(...(state.done ? [icon('check')] : []), state.stage);
  $('addon-error').hidden = true;
}

/** The add-on's import failed: the row goes, a banner says why and offers another file. The base game is unaffected. */
export function showAddonError(message: string, sha1: string | undefined, pickAgain: () => void): void {
  $('addon-job').hidden = true;
  const text: (Node | string)[] = [message];
  if (sha1) text.push(' SHA-1 of your file: ', h('code', '', sha1), '.');
  text.push(' You can still play, and add it later in Options.');
  const box = $('addon-error');
  box.replaceChildren(banner('That HeartGold or SoulSilver file could not be used.', text, { action: button('Choose another file', { icon: 'import', onClick: pickAgain }) }));
  box.hidden = false;
}

/**
 * Start playing: `why` it is not ready yet (it stays focusable and says so), or null once it is. `focus` moves the
 * keyboard to it (when nothing else is left to answer).
 */
export function setStart(why: string | null, focus: boolean): void {
  const old = $('start-playing');
  const had = document.activeElement === old;
  const b = startButton(why, startHandler);
  old.replaceWith(b);
  $('start-why').textContent = why ?? 'Your game is ready.';
  if (!why) rail(2);
  if (had || focus) b.focus({ preventScroll: !focus });
  snapPixels($('start-row'));
}
