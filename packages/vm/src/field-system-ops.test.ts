import { describe, expect, it } from 'vitest';
import { FIELD_VARS as V, parseIR, readSystemVar, systemFlag, writeSystemVar } from '@opensinnoh/core';
import { fieldPack, f } from '../../../tests/fixtures/field-systems.ts';
import { loadGamePacks } from '../../game/src/packs.ts';
import { Driver, newState, testMon } from './test-support.ts';

function drive(commands: string) {
  const pack = fieldPack();
  Object.assign(pack.scripts.labels, parseIR(`fixture:FIELD_TEST::\n${commands}\nend`).labels);
  const { registries: reg, labels } = loadGamePacks([pack]);
  const s = newState();
  s.party.push(testMon(reg, 'fixture:SPECIES_MOSSLET', 8));
  s.objects.push({ zone: f('TOWN'), localId: 70, x: 40, z: 15, y: 0, facing: 'down', movementType: 49 });
  const d = new Driver(reg, labels, s);
  return { d, reg, s, run: () => { d.vm.start({ label: f('FIELD_TEST'), zone: f('TOWN'), source: 'object', lastTalked: 70 }); d.until(() => !d.vm.running()); } };
}

describe('native field-system script commands', () => {
  it('initializes and reads daily values and the size record; all commands are real', () => {
    const { d, reg, s, run } = drive(`
init_size_contest_record
randomize_jubilife_lottery
get_jubilife_lottery_trainer_id var(fixture:FIELD_16435)
init_daily_random_level
get_daily_random_level var(fixture:FIELD_16436)
calc_size_contest_result var(fixture:FIELD_16445), 0
buffer_size_contest_record 0, 1, 1
buffer_party_pokemon_size 2, 3, 0
update_size_contest_record 0
calc_size_contest_result var(fixture:FIELD_16437), 0
`);
    run();
    expect(s.vars[f('FIELD_16435')]).toBe(readSystemVar(reg, s, V.lotteryLow));
    expect(s.vars[f('FIELD_16436')]).toBe(readSystemVar(reg, s, V.level));
    expect(s.vars[f('FIELD_16437')]).toBe(1);
    expect([...d.log.keys.keys()].filter((x) => /init_|lottery|daily|buffer_|rematch/.test(x))).toEqual([]);
  });
  it('reads rematch selection on the talked-to spin; writes an explicit exit without warping', () => {
    const { s, reg, d, run } = drive(`get_rematch_trainer_id 700, var(fixture:FIELD_16435)\nscr_cmd_2b5 700, 9, 12`);
    s.flags[systemFlag(reg, 2432)] = true;
    run();
    expect(s.vars[f('FIELD_16435')]).toBe(701);
    expect(s.escapeLocation).toEqual({ zone: f('ROOM'), x: 9, z: 12, facing: 'down' });
    expect(d.field.calls.filter((c) => c.startsWith('warp'))).toEqual([]);
  });
  it('lottery reads party and box results through all three destinations', () => {
    const { s, reg, run } = drive(`check_for_jubilife_lottery_winner var(fixture:FIELD_16435), var(fixture:FIELD_16436), var(fixture:FIELD_16445), 45678`);
    s.party[0]!.otId = 45678;
    writeSystemVar(reg, s, V.size, 33280);
    run();
    expect([s.vars[f('FIELD_16435')] ?? 0, s.vars[f('FIELD_16436')] ?? 0, s.vars[f('FIELD_16445')] ?? 0]).toEqual([0, 5, 0]);
  });
});
