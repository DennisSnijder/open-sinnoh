/**
 * The crash screen: when an error stops the game (the loop threw, a watchdog fired) the player sees what
 * happened, can copy a scrubbed report for the developer and reload. A tab left open across a deploy gets the
 * "OpenSinnoh was updated" screen instead (not an error: no danger, just Reload). OpenSinnoh's own screens, on
 * the design system (@opensinnoh/ui): one window over a scrim, full bleed on a phone. Works without a DSN: it
 * only reads the report text (index.ts `reportText`). The first crash wins; later ones only report.
 */
import { banner, button, h, snapPixels, titleTab } from '@opensinnoh/ui';
import { isChunkError } from '../chunk.ts';
import { splashDone } from '../splash.ts';
import { ImportIncompleteError } from '../store.ts';
import { captureError, reportText, reportsSending } from './index.ts';
import './crash.css';

export interface CrashOptions {
  /** Shown as a quieter third action (the imported game's re-import), or omitted. */
  secondary?: { label: string; run(): void };
}

let shown: HTMLElement | null = null;

/** Reports `err` as fatal and shows the crash screen. `where`: `loop`, `watchdog`, … */
export function crash(err: unknown, where: string, opts: CrashOptions = {}): void {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error);
  const report = captureError(error, where, { fatal: true });
  if (shown) return;
  const text = reportText(error, report);

  // A tab left open across a deploy asks the server for files of the old build, which are gone.
  const updated = isChunkError(error);
  const head = titleTab(updated ? 'OpenSinnoh was updated' : 'Something went wrong', { icon: updated ? 'reset' : 'warn', tone: updated ? 'system' : 'danger', id: 'crash-title' });
  // A file of the imported game is missing from the browser's storage: importing the ROM again repairs it.
  const damaged = error instanceof ImportIncompleteError;
  const body = updated
    ? h('p', 'crash-text', 'A new version came out while this page was open. Reload to continue; progress since your last save may be lost.')
    : damaged
      ? banner('Your imported game data is incomplete.', 'Import your ROM again to repair it. Your saves are kept; progress since your last save may be lost.')
      : banner('The game stopped because of an error.', 'Progress since your last save may be lost.');
  body.id = 'crash-text';
  // The window is the alert; its error line is not announced a second time.
  body.removeAttribute('role');
  const sentNote = h('p', 'crash-note', reportsSending() ? 'An anonymous error report goes to the developer. To add your own words, copy the details.' : 'Copy the details to tell the developer what happened.');
  const pre = h('pre', 'crash-report', text);
  pre.tabIndex = 0;
  const details = h('details', 'crash-details', h('summary', '', 'Show details'), pre);

  const status = h('p', 'crash-status');
  status.setAttribute('role', 'status');
  const copy = button('Copy details', {
    icon: 'copy',
    onClick: () =>
      void navigator.clipboard.writeText(text).then(
        () => (status.textContent = 'Copied. Paste it in your message to the developer.'),
        () => {
          // No clipboard (permissions, an old browser): show the text selected for a manual copy.
          details.open = true;
          getSelection()?.selectAllChildren(pre);
          status.textContent = 'Select the details above and copy them.';
        },
      ),
  });
  copy.classList.add('crash-copy');
  const reload = button('Reload', { icon: 'reset', ...(damaged && opts.secondary ? {} : { variant: 'primary' as const }), onClick: () => location.reload() });
  reload.classList.add('crash-reload');
  const actions = h('div', 'crash-actions', reload, copy);
  if (opts.secondary) {
    const s = button(opts.secondary.label, { icon: 'import', ...(damaged ? { variant: 'primary' as const } : {}), onClick: () => opts.secondary!.run() });
    s.classList.add('crash-secondary');
    actions.append(s);
  }
  const card = h('div', 'os-win crash-card os-enter', head, h('div', 'crash-body', body, sentNote, actions, status, details));
  const box = h('section', 'os os-screen crash', card);
  box.setAttribute('role', 'alertdialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'crash-title');
  box.setAttribute('aria-describedby', 'crash-text');
  document.body.append(box);
  // A start that failed: the crash screen replaces the splash.
  splashDone();
  shown = box;
  reload.focus();
  snapPixels(box);
}
