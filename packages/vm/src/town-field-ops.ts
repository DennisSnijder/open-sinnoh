/**
 * Field commands of the town extras (decomp scrcmd.c): the Vs. Seeker's task (ScrCmd_StartVsSeeker, the world's
 * vs-seeker.ts), Dr. Footstep's reading (ScrCmd_GetPartyMonFootprintType, overlay005/footprint_type.c), the Solaceon
 * Ruins' Unown messages (ScrCmd_MessageUnown) and the Vista Lighthouse binoculars (ScrCmd_UseVistaLighthouseBinoculars).
 */
import { FIELD_VARS, readSystemVar } from '@opensinnoh/core';
import type { Handler, Runner } from './runner.ts';
import { TextPrinter, toPrintOps } from '@opensinnoh/text';

/** VS_SEEKER_USE_RESULT_NO_BATTERY; the battery's full charge (VS_SEEKER_MAX_BATTERY). */
const NO_BATTERY = 1;
const MAX_BATTERY = 100;
/** SPECIES_GIRATINA: the Origin Forme (form 1) leaves no print (FootprintType_SpeciesHasPrint). */
const SPECIES_GIRATINA = 487;

export function townFieldHandlers(r: Runner): Record<string, Handler> {
  return {
    /**
     * VsSeeker_Start: the task runs and the script waits; the result goes to the var. Without battery the template's
     * slot 0 holds the charge still missing (StringTemplate_SetNumber, as many digits as it has).
     */
    start_vs_seeker: (t, c, a) => {
      const dest = r.ref(a[0], 'var');
      r.field.startVsSeeker();
      return r.pause(c, () => {
        const result = r.field.vsSeekerResult();
        if (result === null) return false;
        if (result === NO_BATTERY) t.slots[0] = String(MAX_BATTERY - readSystemVar(r.registries, r.state, FIELD_VARS.battery));
        r.setVar(t, dest, result);
        return true;
      });
    },
    /** FootprintType_SpeciesHasPrint and FootprintType_GetTypeFromSpecies of a party Pokémon (eggs too, as on the DS). */
    get_party_mon_footprint_type: (t, _c, a) => {
      const slot = r.val(t, a[2]);
      const mon = r.state.party[slot];
      if (!mon) throw new Error(`get_party_mon_footprint_type: no party Pokémon in slot ${slot}`);
      const species = r.registries.species.get(mon.species);
      const print = species?.footprintType;
      if (!print) throw new Error(`get_party_mon_footprint_type: ${mon.species} has no footprintType (the import reads overlay 5)`);
      const origin = species.sourceIndex === SPECIES_GIRATINA && mon.form === 1;
      r.setVar(t, r.ref(a[0], 'var'), print.hasPrint && !origin ? 1 : 0);
      r.setVar(t, r.ref(a[1], 'var'), print.type);
      return 'continue';
    },
    /** ScriptMessage_Show with FONT_UNOWN; the delay cannot be skipped. The script's own bank (the trailing int). */
    message_unown: (t, c, a) => {
      if (a[1]?.kind !== 'int') throw new Error('message_unown: no text bank operand (a map script with no known bank)');
      const id = r.bankText(a[1].value, r.val(t, a[0]));
      const rec = r.registries.texts.get(id);
      if (!rec) throw new Error(`unknown text ${id}`);
      const printer = new TextPrinter(toPrintOps(rec.text, t.slots), { speed: r.textSpeed(), canSpeedUp: false });
      r.ui.message = { printer, font: 'unown' };
      return r.pause(c, () => printer.done);
    },
    /** The binoculars' task; the script waits. */
    use_vista_lighthouse_binoculars: (_t, c) => {
      r.field.vistaBinoculars();
      return r.pause(c, () => r.field.vistaBinocularsDone());
    },
  };
}
