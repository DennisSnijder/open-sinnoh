/**
 * The seal script commands (docs/research/seals.md §4.4; decomp scrcmd.c ScrCmd_CountSealOccurence, ScrCmd_GiveOrTakeSeal,
 * ScrCmd_OpenSealCapsuleEditor, ScrCmd_CountUniqueSealsInSealCase; scrcmd_shop.c ScrCmd_PokeMartSeal). The rules are
 * services' (seals.ts); the editor and the seal mart are menu apps the script waits on.
 */
import type { Arg } from '@opensinnoh/core';
import { giveOrTakeSeal, sealsOwned, sealTables, uniqueSeals } from '@opensinnoh/services';
import type { Handler, Runner, Thread } from './runner.ts';

export function sealHandlers(r: Runner): Record<string, Handler> {
  const val = (t: Thread, a: Arg | undefined) => r.val(t, a);
  const dest = (t: Thread, a: Arg | undefined, v: number) => r.setVar(t, r.ref(a, 'var'), v);
  return {
    /** SealCase_CountSealOccurrenceAnywhere: the seals owned (loose and on capsules). */
    count_seal_occurence: (t, _c, a) => (dest(t, a[1], sealsOwned(r.state.sealCase, val(t, a[0]))), 'continue'),
    /** GiveOrTakeSeal: the quantity is read as a u16 and passed as an s16; refused changes are ignored, as the DS does. */
    give_or_take_seal: (t, _c, a) => {
      const q = (val(t, a[1]) << 16) >> 16;
      giveOrTakeSeal(r.state.sealCase, val(t, a[0]), q);
      return 'continue';
    },
    /** CapsuleMenu_StartFieldTask: the editor runs and the script waits until it ends. */
    open_seal_capsule_editor: (_t, c) => r.openApp(c, { app: 'capsule-editor' }, () => {}),
    /** Shop_Start(MART_TYPE_SEAL) with SunyshoreMarketDailyStocks[martID]; the greeting stays in the mart's box. */
    poke_mart_seal: (t, c, a) => {
      const seals = val(t, a[0]);
      if (!sealTables(r.registries).marts[seals]) throw new Error(`poke_mart_seal: no seal mart ${seals}`);
      const greeting = r.ui.message ? r.ui.message.printer.text() : null;
      r.ui.message = null;
      return r.openApp(c, { app: 'mart', seals, greeting }, () => {});
    },
    count_unique_seals_in_seal_case: (t, _c, a) => (dest(t, a[0], uniqueSeals(r.state.sealCase)), 'continue'),
  };
}
