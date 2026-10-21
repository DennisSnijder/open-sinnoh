/** The gym commands on synthetic IR and a fake field (no ROM). */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { GymTables, NewGame, Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState } from './test-support.ts';

const fixture = loadFixture();
const text = [...fixture.registries.texts.values()].find((t) => !t.text.includes('{'))!.id;
const registries = (() => {
  const out = { ...fixture.registries } as Registries;
  const ng = [...fixture.registries.newGame.values()][0]!;
  out.newGame = new Map([[ng.id, { ...ng, gyms: { eterna: { message: text } } as unknown as GymTables } as NewGame]]);
  return out;
})();

function run(body: string, edit: (d: Driver) => void = () => {}, regs = registries) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(regs, labels, newState());
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test' });
  return d;
}

describe('gym commands', () => {
  it('init_persisted_map_features_for_* select their slot and continue (decomp returns FALSE)', () => {
    const d = run('init_persisted_map_features_for_eterna_gym\ninit_persisted_map_features_for_hearthome_gym\ninit_persisted_map_features_for_veilstone_gym');
    d.tick();
    expect(d.vm.running()).toBe(false);
    expect(d.field.calls).toEqual(['initMapFeatures eterna-gym', 'initMapFeatures hearthome-gym', 'initMapFeatures veilstone-gym']);
  });

  it('advance_eterna_gym_clock waits on the clock task; at the leader state it yields one frame', () => {
    const d = run('advance_eterna_gym_clock', (dr) => void (dr.field.clockPlan = { before: 20, message: false, after: 0 }));
    const ticks = d.until(() => !d.vm.running());
    // The start tick, the task's 20 steps, then the end.
    expect(ticks).toBe(22);
    expect(d.vm.view().message).toBeNull();
    const leader = run('advance_eterna_gym_clock', (dr) => void (dr.field.clockAdvances = false));
    leader.tick();
    expect(leader.vm.running()).toBe(true);
    leader.tick();
    expect(leader.vm.running()).toBe(false);
  });

  it('prints the fountain message, waits for a new A or B after it has printed, closes it and lets the task finish', () => {
    const d = run('advance_eterna_gym_clock', (dr) => void (dr.field.clockPlan = { before: 5, message: true, after: 10 }));
    d.until(() => d.vm.view().message?.waitingForInput === true);
    for (let i = 0; i < 50; i++) d.tick();
    expect(d.field.calls).not.toContain('eternaGymClockContinue');
    expect(d.vm.running()).toBe(true);
    d.press('b');
    expect(d.field.calls).toContain('eternaGymClockContinue');
    expect(d.vm.view().message).toBeNull();
    expect(d.until(() => !d.vm.running())).toBeGreaterThanOrEqual(9);
  });

  it('press_sunyshore_gym_button plays SEQ_SE_DP_GAGAGA by its SDAT name; a pack without it logs the miss', () => {
    const blip = registries.sequences.get('fixture:SEQ_SE_BLIP' as Id)!;
    const gagaga = { ...blip, id: 'platinum:SEQ_SE_DP_GAGAGA' as Id };
    const d = run('press_sunyshore_gym_button 0', undefined, { ...registries, sequences: new Map([...registries.sequences, [gagaga.id, gagaga]]) });
    d.until(() => !d.vm.running());
    expect(d.audio.played).toEqual(['se platinum:SEQ_SE_DP_GAGAGA']);
    const missing = run('press_sunyshore_gym_button 0');
    missing.until(() => !missing.vm.running());
    expect(missing.audio.played).toEqual([]);
    expect(missing.log.keys.get('audio:sequence-missing')).toBe(1);
  });

  it('press_pastoria_gym_button runs the water task and waits for it; init selects the Pastoria slot', () => {
    const d = run('init_persisted_map_features_for_pastoria_gym\npress_pastoria_gym_button', (dr) => void (dr.field.buttonTicks = 40));
    const ticks = d.until(() => !d.vm.running());
    expect(d.field.calls).toEqual(['initMapFeatures pastoria-gym', 'pressPastoriaGymButton']);
    expect(ticks).toBeGreaterThanOrEqual(40);
  });

  it('scr_cmd_29f 0: 16 cycles of +2, 0, −2, 0 on the camera, the restore, then a callback that frees it', () => {
    const d = run('scr_cmd_29f 0');
    d.until(() => !d.vm.running());
    expect(d.field.shakes.slice(0, 4)).toEqual([2, 0, -2, -0]);
    expect(d.field.shakes).toHaveLength(16 * 4 + 1);
    expect(d.field.shakes.at(-1)).toBe(0);
  });

  it('scr_cmd_29f 1: 24 cycles from 4, each losing an eighth (fx32), between the BGM fades and two 16-callback waits', () => {
    const d = run('scr_cmd_29f 1');
    d.until(() => !d.vm.running());
    const peaks = d.field.shakes.filter((_, i) => i % 4 === 0);
    expect(peaks.slice(0, 3)).toEqual([4, 4 - 0.5, (16384 - 2048 - Math.trunc(14336 / 8)) / 4096]);
    expect(d.field.shakes).toHaveLength(24 * 4 + 1);
  });
});

