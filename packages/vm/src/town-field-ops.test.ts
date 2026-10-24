/** The town extras' field commands on synthetic IR and records with a fake field (no ROM). */
import { describe, expect, it } from 'vitest';
import { FIELD_VARS, parseIR, type Id } from '@opensinnoh/core';
import type { Registries, Species } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';

const fixture = loadFixture();
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  const mosslet = out.species!.get('fixture:SPECIES_MOSSLET' as Id) as Species;
  out.species!.set(mosslet.id, { ...mosslet, footprintType: { type: 3, hasPrint: true } });
  // An Origin-capable stand-in: SPECIES_GIRATINA's number.
  out.species!.set('test:GIRATINA' as Id, { ...mosslet, id: 'test:GIRATINA', sourceIndex: 487, footprintType: { type: 2, hasPrint: true } });
  for (const [n, index, scope] of [['PRINT', 0x8000, 'temp'], ['TYPE', 0x8001, 'temp'], ['RESULT', 0x800c, 'temp'], ['BATTERY', FIELD_VARS.battery, 'saved'], ['OUT', 0x4100, 'saved'], ['OUT2', 0x4101, 'saved']] as const)
    out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: index, initial: 0, scope });
  out.texts!.set('test:Unown_Text' as Id, { id: 'test:Unown_Text', text: 'ABC' });
  out.texts!.set('test:Missing_Text' as Id, { id: 'test:Missing_Text', text: 'Missing {var 0}.' });
  out.textBanks!.set('test:BANK' as Id, { id: 'test:BANK', sourceIndex: 900, messages: ['test:Unown_Text'] });
  return out as unknown as Registries;
})();

function run(body: string, edit: (d: Driver) => void = () => {}) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(registries, labels, newState());
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test' });
  return d;
}
const v = (d: Driver, n: string) => d.state.vars[`test:VAR_${n}` as Id] ?? 0;

describe('town field commands', () => {
  it('get_party_mon_footprint_type: the species reading, with no print for the Origin Forme (FootprintType_SpeciesHasPrint)', () => {
    const read = (species: string, form = 0) => {
      // The temps are copied to saved vars to read them after the script.
      const d = run('get_party_mon_footprint_type var(test:VAR_PRINT), var(test:VAR_TYPE), 0\nset_var_from_var var(test:VAR_OUT), var(test:VAR_PRINT)\nset_var_from_var var(test:VAR_OUT2), var(test:VAR_TYPE)', (d) => {
        d.state.party.push({ ...testMon(registries, species, 10), form });
      });
      d.until(() => !d.vm.running());
      return [v(d, 'OUT'), v(d, 'OUT2')];
    };
    expect(read('fixture:SPECIES_MOSSLET')).toEqual([1, 3]);
    expect(read('test:GIRATINA')).toEqual([1, 2]);
    expect(read('test:GIRATINA', 1)).toEqual([0, 2]);
    expect(() => read('fixture:SPECIES_EMBERKIT')).toThrow(/no footprintType/);
  });

  it('message_unown prints the bank message in the Unown font and waits for it', () => {
    const d = run('message_unown 0, 900\nwait_ab_press\nclose_message');
    d.until(() => d.vm.view().message?.text === 'ABC');
    expect(d.vm.view().message?.font).toBe('unown');
    // The last character's delay runs out, then the script goes on to wait_ab_press.
    for (let i = 0; i < 10; i++) d.tick();
    expect(d.vm.running()).toBe(true);
    d.press('a');
    d.until(() => !d.vm.running());
  });

  it('start_vs_seeker waits for the task, writes its result and, without battery, the charge missing into slot 0', () => {
    const d = run('start_vs_seeker var(test:VAR_RESULT)\nset_var_from_var var(test:VAR_OUT), var(test:VAR_RESULT)\nmessage text(test:Missing_Text)\nwait_ab_press', (d) => {
      d.field.seekerResult = null;
      d.state.vars['test:VAR_BATTERY' as Id] = 63;
    });
    for (let i = 0; i < 5; i++) d.tick();
    expect(d.vm.running()).toBe(true);
    expect(d.field.calls).toEqual(['startVsSeeker']);
    d.field.seekerResult = 1;
    d.until(() => d.vm.view().message?.waitingForInput === true || d.vm.view().message?.text === 'Missing 37.');
    expect(v(d, 'OUT')).toBe(1);
    d.until(() => d.vm.view().message?.text === 'Missing 37.');
  });

  it('use_vista_lighthouse_binoculars starts the task and waits until it is done', () => {
    const d = run('use_vista_lighthouse_binoculars');
    d.until(() => !d.vm.running());
    expect(d.field.calls).toEqual(['vistaBinoculars']);
  });
});
