/**
 * "Restart to update": a new version of OpenSinnoh has installed and waits (platform.ts). It is offered at the
 * title and on the ROM page, never in the middle of play (the game keeps running the version it started with);
 * in the game Options › Data has the same action. An OpenSinnoh toast on the design system, with one action.
 */
import { button, h, icon, snapPixels } from '@opensinnoh/ui';
import { applyUpdate, onUpdateWaiting } from './platform.ts';
import { S } from './strings/index.ts';
import { captureError } from './telemetry/index.ts';

let waiting = false;
let playing = false;
let toast: HTMLElement | null = null;

function show(): void {
  if (toast) return;
  const restart = button(S.update.restart, {
    variant: 'primary',
    onClick: () => {
      restart.setAttribute('aria-disabled', 'true');
      applyUpdate().catch((e: Error) => {
        captureError(e, 'update');
        restart.removeAttribute('aria-disabled');
        message.textContent = S.update.failed(e.message);
      });
    },
  });
  const message = h('span', '', S.update.ready);
  const slot = h('div', 'update-slot os', h('div', 'os-win os-toast update-toast in', icon('reset'), message, restart));
  slot.id = 'update-toast';
  slot.setAttribute('role', 'status');
  document.body.append(slot);
  toast = slot;
  void document.fonts.ready.then(() => snapPixels(slot));
}

function sync(): void {
  if (waiting && !playing) show();
  else if (toast) {
    toast.remove();
    toast = null;
  }
}

/** Starts watching for a waiting version. */
export function watchForUpdate(): void {
  onUpdateWaiting(() => {
    waiting = true;
    sync();
  });
}

/** The game is being played (no toast now) or is at the title or the ROM page (the toast may show). */
export function setPlaying(on: boolean): void {
  playing = on;
  sync();
}
