/**
 * The Pokétch commands (docs/research/poketch.md): decomp scrcmd.c ScrCmd_EnablePoketch,
 * CheckPoketchEnabled, RegisterPoketchApp, CheckPoketchAppRegistered, HidePoketch and ShowPoketch, over
 * `GameState.poketch` (decomp Poketch) and FLAG_POKETCH_HIDDEN (SystemFlag_Set/ClearPoketchHidden).
 */
import type { Arg, Id } from '@opensinnoh/core';
import { POKETCH_APPS, poketchAppId, registerPoketchApp } from '@opensinnoh/contracts';
import type { Handler, Runner, Thread } from './runner.ts';

/** Decomp FLAG_POKETCH_HIDDEN. */
const FLAG_POKETCH_HIDDEN = 2428;

/** The app of a decomp PoketchAppID (the base pack's ids). */
export function poketchApp(n: number): Id {
  const name = POKETCH_APPS[n];
  if (!name) throw new Error(`bad Pokétch app ${n}`);
  return poketchAppId('platinum', name);
}

export function m3bPoketchHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  const hidden = (value: boolean): Handler => () => (r.setFlag(r.source('flags', FLAG_POKETCH_HIDDEN)!, value), 'continue');
  return {
    // Decomp FieldSystem_EnablePoketch: a field task turns the Pokétch on; the script waits a tick for it.
    enable_poketch: () => ((r.state.poketch.enabled = true), 'yield'),
    check_poketch_enabled: (t, _c, a) => (dest(t, a[0], r.state.poketch.enabled ? 1 : 0), 'continue'),
    register_poketch_app: (t, _c, a) => (registerPoketchApp(r.state.poketch, poketchApp(val(t, a[0]))), 'continue'),
    check_poketch_app_registered: (t, _c, a) => (dest(t, a[1], r.state.poketch.apps.includes(poketchApp(val(t, a[0]))) ? 1 : 0), 'continue'),
    hide_poketch: hidden(true),
    show_poketch: hidden(false),
  };
}
