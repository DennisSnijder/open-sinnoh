/** The battle commands on a fake field (no ROM): requests, results and the blackout. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { BattleOutcome, Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState } from './test-support.ts';

const fixture = loadFixture();
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const n of ['A', 'B']) out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + n.charCodeAt(0), initial: 0, scope: 'saved' });
  out.vars!.set('test:VAR_PARTNER' as Id, { id: 'test:VAR_PARTNER', sourceIndex: 0x403f, initial: 0, scope: 'saved' });
  out.texts!.set('test:Text_Lucas' as Id, { id: 'test:Text_Lucas', text: 'Lou' });
  out.texts!.set('test:Text_Dawn' as Id, { id: 'test:Text_Dawn', text: 'Dee' });
  out.species!.set('test:SPECIES_BIDOOF' as Id, { ...(fixture.registries.species.get('fixture:SPECIES_BURROWBIT' as Id) as object), id: 'test:SPECIES_BIDOOF', sourceIndex: 399 });
  out.textBanks!.set('test:TEXT_BANK_COUNTERPART_NAMES' as Id, { id: 'test:TEXT_BANK_COUNTERPART_NAMES', sourceIndex: 553, messages: ['test:Text_Lucas', 'test:Text_Dawn'] });
  return out as unknown as Registries;
})();

function run(body: string, outcome: BattleOutcome = 'won', edit: (d: Driver) => void = () => {}) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(registries, labels, newState());
  d.field.nextOutcome = outcome;
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test' });
  d.until(() => !d.vm.running());
  return { d, a: d.state.vars['test:VAR_A' as Id] ?? 0, b: d.state.vars['test:VAR_B' as Id] ?? 0 };
}

describe('battle commands', () => {
  it('a single trainer battle starts a real battle; check_won/lost_battle read its result (decomp CheckPlayerWon/LostBattle)', () => {
    const won = run('start_trainer_battle 2, 0\ncheck_won_battle var(test:VAR_A)\ncheck_lost_battle var(test:VAR_B)');
    expect(won.d.field.battles).toEqual([{ kind: 'trainer', trainers: ['fixture:TRAINER_HIKER'], wild: [] }]);
    expect([won.a, won.b]).toEqual([1, 0]);
    expect(won.d.battles).toEqual([]); // the game logs real battles, not the VM
    const lost = run('start_trainer_battle 2, 0\ncheck_won_battle var(test:VAR_A)\ncheck_lost_battle var(test:VAR_B)', 'lost');
    expect([lost.a, lost.b]).toEqual([0, 1]);
    const fled = run('start_trainer_battle 2, 0\ncheck_won_battle var(test:VAR_A)\ncheck_lost_battle var(test:VAR_B)', 'fled');
    expect([fled.a, fled.b]).toEqual([1, 1]);
  });

  it('check_did_not_capture: 0 after a capture, 1 otherwise (decomp CheckPlayerDidNotCaptureWildMon)', () => {
    const script = 'start_catching_tutorial\ncheck_did_not_capture var(test:VAR_A)';
    const starter = (dr: Driver) => {
      dr.state.vars['fixture:VAR_PLAYER_STARTER' as Id] = 3;
    };
    expect(run(script, 'caught', starter).a).toBe(0);
    for (const o of ['won', 'fled', 'lost'] as const) expect(run(script, o, starter).a, o).toBe(1);
  });

  it('ordinary doubles (a double trainer, the same trainer twice: 3) and two trainers without a partner (19) are real battles (decomp Encounter_NewVsTrainer)', () => {
    const { d, a } = run('start_trainer_battle 3, 0\ncheck_won_battle var(test:VAR_A)\nstart_trainer_battle 2, 4\nstart_trainer_battle 5, 5\nstart_trainer_battle 3, 3');
    expect(a).toBe(1);
    expect(d.field.battles).toEqual([
      { kind: 'trainer', trainers: ['fixture:TRAINER_TWINS'], wild: [], topology: 'double' },
      { kind: 'trainer', trainers: ['fixture:TRAINER_HIKER', 'fixture:TRAINER_CAMPER'], wild: [], topology: 'trainer-pair' },
      { kind: 'trainer', trainers: ['fixture:TRAINER_PICNICKER'], wild: [], topology: 'double' },
      { kind: 'trainer', trainers: ['fixture:TRAINER_TWINS'], wild: [], topology: 'double' },
    ]);
    expect(d.battles).toEqual([]);
    expect(d.log.keys.get('stub:double-battle')).toBeUndefined();
    // A walking partner joins only two distinct enemies: beside a double trainer it stays out (type 3).
    const walking = run('start_trainer_battle 3, 3', 'won', (dr) => {
      dr.state.hasPartner = true;
      dr.state.vars['test:VAR_PARTNER' as Id] = 9;
    });
    expect(walking.d.field.battles).toEqual([{ kind: 'trainer', trainers: ['fixture:TRAINER_TWINS'], wild: [], topology: 'double' }]);
  });

  it('a tag battle (partner, two enemies) and a trainer battle with a walking partner are real ai-partner battles (type 75)', () => {
    const tag = run('start_tag_battle 9, 7, 8\ncheck_won_battle var(test:VAR_A)', 'lost');
    expect(tag.d.field.battles).toEqual([{ kind: 'trainer', trainers: ['fixture:TRAINER_PAIR_A', 'fixture:TRAINER_PAIR_B'], wild: [], topology: 'ai-partner', partner: 'fixture:TRAINER_PARTNER' }]);
    expect(tag.a).toBe(0);
    expect(tag.d.log.keys.get('stub:double-battle')).toBeUndefined();
    // Decomp ScrCmd_StartTrainerBattle: the has-partner flag and VAR_PARTNER_TRAINER_ID (0x403F) name the partner.
    const walking = run('start_trainer_battle 7, 8', 'won', (dr) => {
      dr.state.hasPartner = true;
      dr.state.vars['test:VAR_PARTNER' as Id] = 9;
    });
    expect(walking.d.field.battles).toEqual([{ kind: 'trainer', trainers: ['fixture:TRAINER_PAIR_A', 'fixture:TRAINER_PAIR_B'], wild: [], topology: 'ai-partner', partner: 'fixture:TRAINER_PARTNER' }]);
  });

  it('the first battle and the catching tutorial (the counterpart with the starter before the player’s)', () => {
    const { d } = run('start_first_battle 1\nstart_catching_tutorial', 'won', (dr) => {
      dr.state.vars['fixture:VAR_PLAYER_STARTER' as Id] = 3; // Dripling, slot 2: the counterpart has Emberkit
    });
    expect(d.field.battles).toEqual([
      { kind: 'first', trainers: ['fixture:TRAINER_RIVAL_FIRST'], wild: [] },
      { kind: 'tutorial', trainers: [], wild: [{ species: 'test:SPECIES_BIDOOF', level: 2 }], counterpart: { name: 'Dee', gender: 'female', species: 'fixture:SPECIES_EMBERKIT' } },
    ]);
  });

  it('check_won_battle without a battle fails loudly; black_out_from_battle asks the game to black out', () => {
    expect(() => run('check_won_battle var(test:VAR_A)')).toThrow(/no battle has run/);
    const { d } = run('start_trainer_battle 2, 0\nblack_out_from_battle', 'lost');
    expect(d.field.calls).toContain('blackOut');
  });
});
