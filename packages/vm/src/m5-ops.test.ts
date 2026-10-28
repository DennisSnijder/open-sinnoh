/** The M5 commands on synthetic IR, synthetic records and a fake field (no ROM). */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { Registries, Zone } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState } from './test-support.ts';
import { WEATHER_GALACTIC_FOG } from './m5-ops.ts';

const fixture = loadFixture();
const town = fixture.registries.zones.get('fixture:TOWN' as Id)!;
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  out.weathers!.set('test:OVERWORLD_WEATHER_26' as Id, { id: 'test:OVERWORLD_WEATHER_26', sourceIndex: WEATHER_GALACTIC_FOG, name: '26' });
  const spawn = (n: number, id: string): Zone => ({ ...town, id: id as Id, blackOut: { spawn: n, x: 8, z: 6, label: town.mapScripts.onLoad ?? ('fixture:Nothing' as Id) } });
  for (const z of [spawn(2, 'test:SANDGEM_POKECENTER'), spawn(9, 'test:ETERNA_POKECENTER')]) out.zones!.set(z.id, z);
  out.species!.set('test:UNOWN' as Id, { id: 'test:UNOWN', sourceIndex: 201, name: 'UNOWN' });
  for (const [i, n] of ['DARKRAI', 'SHAYMIN', 'ARCEUS', 'ROTOM', 'RESULT'].entries())
    out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: n === 'RESULT' ? 0x8000 : 0x4043 + i, initial: 0, scope: n === 'RESULT' ? 'temp' : 'saved' });
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

describe('M5 commands', () => {
  it('wait_ab_pad_press ends on A, B or the d-pad, never turns the player, and ignores X (decomp ScriptContext_CheckABPadPress)', () => {
    for (const b of ['a', 'b', 'up', 'down', 'left', 'right'] as const) {
      const d = run('wait_ab_pad_press');
      d.tick();
      d.press('x');
      d.press('select');
      expect(d.vm.running(), b).toBe(true);
      d.press(b);
      d.until(() => !d.vm.running());
      expect(d.field.calls, b).toEqual([]);
      expect([...d.log.keys.keys()]).toEqual([]);
    }
  });

  it('wait_ab_pad_press after a message: the script waits for A or B (no arrow) until the press', () => {
    const d = run(`
      message text(fixture:Text_HelperAgain)
      wait_ab_pad_press
      close_message`);
    d.until(() => d.vm.view().waitsForAB === true);
    expect(d.vm.view().message?.waitingForInput).toBe(false);
    d.press('a');
    d.until(() => !d.vm.running());
    expect(d.vm.view().message).toBeNull();
  });

  it('check_distribution_event: TRUE only when the event var holds its magic number (decomp SystemVars_CheckDistributionEvent)', () => {
    const result = (edit: (d: Driver) => void, event = 2) => {
      const d = run(`check_distribution_event ${event}, var(test:VAR_RESULT)\nset_var_from_var var(test:VAR_DARKRAI), var(test:VAR_RESULT)`, edit);
      d.until(() => !d.vm.running());
      return d.state.vars['test:VAR_DARKRAI' as Id] ?? 0;
    };
    expect(result(() => {})).toBe(0);
    expect(result((d) => (d.state.vars['test:VAR_ARCEUS' as Id] = 0x1123))).toBe(1);
    expect(result((d) => (d.state.vars['test:VAR_ARCEUS' as Id] = 0x1209))).toBe(0); // Darkrai's number in Arceus's var
    expect(result((d) => (d.state.vars['test:VAR_ROTOM' as Id] = 0x1103), 3)).toBe(1);
    expect(() => result(() => {}, 4)).toThrow(/bad event 4/);
  });

  it('start_library_tv waits on the library TV app (ReturnToField after it)', () => {
    const d = run('start_library_tv\nreturn_to_field');
    d.tick();
    expect(d.vm.view().app).toEqual({ app: 'library-tv' });
    d.tick();
    expect(d.vm.running()).toBe(true);
    d.vm.appDone({ app: 'library-tv' });
    d.until(() => !d.vm.running());
    expect([...d.log.keys.keys()]).toEqual([]);
  });

  it('the Eterna statue scene ops (32D, 32E, 331, 332) run immediately and touch nothing (no unknown heights in our world)', () => {
    const d = run('scr_cmd_32d\nscr_cmd_331\nscr_cmd_32e\nscr_cmd_332');
    const before = structuredClone(d.state);
    d.tick();
    expect(d.vm.running()).toBe(false); // all four return FALSE: one tick runs them and `end`
    expect(d.field.calls).toEqual([]);
    expect(d.state).toEqual(before);
    expect([...d.log.keys.keys()]).toEqual([]);
  });

  it('scr_cmd_2cd switches the weather to effect 26 and yields once (decomp returns TRUE)', () => {
    const d = run('scr_cmd_2cd');
    d.tick();
    expect(d.field.calls).toEqual(['setWeather test:OVERWORLD_WEATHER_26']);
    expect(d.state.weather).toBe('test:OVERWORLD_WEATHER_26');
    expect(d.vm.running()).toBe(true);
    d.tick();
    expect(d.vm.running()).toBe(false);
    expect([...d.log.keys.keys()]).toEqual([]);
  });

  it('set_black_out_warp_id makes the zone of that spawn the blackout destination, from a value or a var', () => {
    const d = run('set_black_out_warp_id 9');
    d.until(() => !d.vm.running());
    expect(d.state.blackOut).toBe('test:ETERNA_POKECENTER');
    const v = run('set_var_from_value var(fixture:VAR_SCENE), 2\nset_black_out_warp_id var(fixture:VAR_SCENE)', (dr) => void (dr.state.blackOut = 'test:ETERNA_POKECENTER' as Id));
    v.until(() => !v.vm.running());
    expect(v.state.blackOut).toBe('test:SANDGEM_POKECENTER');
    expect([...v.log.keys.keys()]).toEqual([]);
  });

  it('set_black_out_warp_id fails loudly on a spawn that is no blackout spawn', () => {
    const d = run('set_black_out_warp_id 19');
    expect(() => d.until(() => !d.vm.running())).toThrow(/no blackout spawn 19/);
  });

  it('scr_cmd_2b6 clears pass-through with 1 and sets it otherwise (decomp sub_02062D80), local id by value or var', () => {
    const d = run('scr_cmd_2b6 9, 1\nscr_cmd_2b6 9, 0\nset_var_from_value var(fixture:VAR_SCENE), 4\nscr_cmd_2b6 var(fixture:VAR_SCENE), 1');
    d.tick();
    expect(d.vm.running()).toBe(false); // FALSE: one tick runs them all
    expect(d.field.calls).toEqual(['setObjectPassThrough 9 false', 'setObjectPassThrough 9 true', 'setObjectPassThrough 4 false']);
    expect([...d.log.keys.keys()]).toEqual([]);
  });

  it('get_unown_forms_seen_count counts the Unown forms the Pokédex recorded, not their genders or other species', () => {
    const d = run('get_unown_forms_seen_count var(fixture:VAR_SCENE)', (dr) => {
      dr.state.pokedex.forms['test:UNOWN' as Id] = [
        { form: 0, gender: 'none' },
        { form: 25, gender: 'none' },
        { form: 3, gender: 'none' },
      ];
      dr.state.pokedex.forms['fixture:SPECIES_OTHER' as Id] = [{ form: 1, gender: 'male' }];
    });
    d.tick();
    expect(d.state.vars['fixture:VAR_SCENE' as Id]).toBe(3);
    const none = run('set_var_from_value var(fixture:VAR_SCENE), 9\nget_unown_forms_seen_count var(fixture:VAR_SCENE)');
    none.tick();
    expect(none.state.vars['fixture:VAR_SCENE' as Id] ?? 0).toBe(0); // was 9: written back to its initial 0
    expect([...d.log.keys.keys(), ...none.log.keys.keys()]).toEqual([]);
  });

  it('try_set_unused_collected_orb_flag changes nothing (Platinum never reads the flag) and logs nothing', () => {
    const d = run('try_set_unused_collected_orb_flag 135\ntry_set_unused_collected_orb_flag 1');
    const before = structuredClone(d.state);
    d.tick();
    expect(d.vm.running()).toBe(false);
    expect(d.state).toEqual(before);
    expect(d.field.calls).toEqual([]);
    expect([...d.log.keys.keys()]).toEqual([]);
  });
});
