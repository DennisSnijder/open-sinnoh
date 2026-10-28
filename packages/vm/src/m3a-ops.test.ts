/** Script ops that open apps: the PC boxes, the naming screen and the party pick wait on the app and read its result. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';
import { MONEY_WINDOW } from './m3a-ops.ts';

const fixture = loadFixture();
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  ['A', 'B', 'C', 'D'].forEach((n, i) => out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' }));
  out.texts!.set('test:Text_Buffer' as Id, { id: 'test:Text_Buffer', text: '{var 0}' });
  // The money window's bank (pl_msg 543): #18 the label, #19 the amount.
  const money = Array.from({ length: 20 }, (_, i) => `test:Money_${i}` as Id);
  out.textBanks!.set('test:BANK_MONEY' as Id, { id: 'test:BANK_MONEY', sourceIndex: MONEY_WINDOW.bank, messages: money });
  out.texts!.set(money[18]!, { id: money[18], text: 'Cash' });
  out.texts!.set(money[19]!, { id: money[19], text: '${var 0}' });
  out.texts!.set('test:Text_Long' as Id, { id: 'test:Text_Long', text: 'A long line printed at once.' });
  return out as unknown as Registries;
})();

function driver(ir: string): Driver {
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  return new Driver(registries, labels, newState());
}

describe('the field money window (decomp FieldMenu_CreateMoneyWindow)', () => {
  it('show_money opens it at the tile position, update_money_display reprints the amount, hide_money closes it', () => {
    const d = driver(`
test:Money::
  show_money 1, 1
  wait_time 1, var(test:VAR_A)
  remove_money 2900
  update_money_display
  wait_time 1, var(test:VAR_A)
  hide_money
  wait_time 1, var(test:VAR_A)
  end
`);
    d.state.money = 3000;
    d.vm.start({ label: 'test:Money' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().moneyWindow).toEqual({ x: 8, y: 8, width: 80, height: 32, label: 'Cash', amount: '$  3000' });
    d.until(() => d.vm.view().moneyWindow?.amount === '$   100');
    d.until(() => !d.vm.view().moneyWindow);
    d.until(() => !d.vm.running());
    expect(d.log.keys.size).toBe(0);
    const bad = driver('test:Hide::\n  hide_money\n  end\n');
    bad.vm.start({ label: 'test:Hide' as Id, zone: 'fixture:TOWN', source: 'test' });
    expect(() => bad.tick()).toThrow(/money window is not shown/);
  });
});

describe('the PC animation (decomp CommonScript_PCBootUpAnimation / _PCShutDownAnimation)', () => {
  it('load_pc_animation names the tag; boot-up and shut-down play the PC clips; an unloaded tag throws', () => {
    const d = driver('test:Pc::\n  load_pc_animation 3\n  play_pc_boot_up_animation 3\n  wait_for_animation 3\n  play_pc_shut_down_animation 3\n  wait_for_animation 3\n  unload_animation 3\n  end\n');
    d.vm.start({ label: 'test:Pc' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.until(() => !d.vm.running());
    expect(d.field.calls.filter((c) => c.startsWith('playPc'))).toEqual(['playPcAnimation pc-on', 'playPcAnimation pc-off']);
    expect(d.log.keys.size).toBe(0);
    const bad = driver('test:Bad::\n  play_pc_boot_up_animation 3\n  end\n');
    bad.vm.start({ label: 'test:Bad' as Id, zone: 'fixture:TOWN', source: 'test' });
    expect(() => bad.tick()).toThrow(/PC animation tag 3 not loaded/);
  });
});

describe('message_instant (decomp ScriptMessage_ShowInstant)', () => {
  it('prints the whole message on its first tick and goes on without waiting', () => {
    const d = driver('test:Instant::\n  message_instant text(test:Text_Long)\n  wait_time 5, var(test:VAR_A)\n  end\n');
    d.vm.start({ label: 'test:Instant' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().message).toEqual({ text: 'A long line printed at once.', waitingForInput: false });
    expect(d.log.keys.size).toBe(0);
  });
});

describe('apps opened by scripts', () => {
  it('open_pokemon_storage waits on the PC boxes in its mode', () => {
    const d = driver('test:Pc::\n  open_pokemon_storage 2\n  end\n');
    d.vm.start({ label: 'test:Pc' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().app).toEqual({ app: 'storage', mode: 'move' });
    expect(d.vm.running()).toBe(true);
    d.vm.appDone({ app: 'storage' });
    d.until(() => !d.vm.running());
  });

  it('open_pokemon_naming_screen sets the nickname (var 0) or leaves it (var 1)', () => {
    const d = driver('test:Nick::\n  open_pokemon_naming_screen 0, var(test:VAR_A)\n  end\n');
    d.state.party.push(testMon(registries, 'fixture:SPECIES_MOSSLET', 5));
    const run = (name: string | null) => {
      d.vm.start({ label: 'test:Nick' as Id, zone: 'fixture:TOWN', source: 'test' });
      d.tick();
      expect(d.vm.view().app).toMatchObject({ app: 'naming', kind: 'pokemon', maxLength: 10, pokemon: { species: 'fixture:SPECIES_MOSSLET' } });
      d.vm.appDone({ app: 'naming', name });
      d.until(() => !d.vm.running());
      return d.state.vars['test:VAR_A' as Id] ?? 0;
    };
    expect(run('Mossy')).toBe(0);
    expect(d.state.party[0]!.nickname).toBe('Mossy');
    expect(run(null)).toBe(1);
    expect(d.state.party[0]!.nickname).toBe('Mossy');
    expect(run('Mosslet')).toBe(0);
    expect(d.state.party[0]!.nickname).toBeNull();
  });

  it('notice: a field message outside any script, with its slots, closed by A, B or the d-pad once printed', () => {
    const d = driver('test:Nothing::\n  end\n');
    d.vm.notice('fixture:CommonStrings_Text_CantDoThatRightNow' as Id, ['Ari']);
    expect(d.vm.running()).toBe(true);
    expect(() => d.vm.start({ label: 'test:Nothing' as Id, zone: 'fixture:TOWN', source: 'test' })).toThrow(/already running/);
    d.until(() => d.vm.view().message?.waitingForInput === true);
    expect(d.vm.view().message!.text).toBe('Ari, this is not\nthe time for that.');
    d.press('left');
    expect(d.vm.running()).toBe(false);
    expect(d.vm.view().message).toBeNull();
  });

  it('ask: a field question outside any script: the message, then YES/NO (B is NO); the answer runs once it closes', () => {
    const d = driver('test:Nothing::\n  end\n');
    const answers: boolean[] = [];
    d.vm.ask('fixture:CommonStrings_Text_CantDoThatRightNow' as Id, ['Ari'], (yes) => void answers.push(yes));
    expect(d.vm.running()).toBe(true);
    d.until(() => d.vm.view().yesNo !== null);
    expect(d.vm.view()).toMatchObject({ message: { text: 'Ari, this is not\nthe time for that.' }, yesNo: { cursor: 0 } });
    d.press('down');
    expect(d.vm.view().yesNo).toEqual({ yes: 'YES', no: 'NO', cursor: 1 });
    d.press('a');
    expect(answers).toEqual([false]);
    expect([d.vm.running(), d.vm.view().message, d.vm.view().yesNo]).toEqual([false, null, null]);
    // The answer may print a notice of its own.
    d.vm.ask('fixture:CommonStrings_Text_CantDoThatRightNow' as Id, ['Ari'], (yes) => d.vm.notice('fixture:CommonStrings_Text_CantDoThatRightNow' as Id, [String(yes)]));
    d.until(() => d.vm.view().yesNo !== null);
    d.press('a');
    expect(d.vm.running()).toBe(true);
    d.until(() => d.vm.view().message?.waitingForInput === true);
    expect(d.vm.view().message!.text).toBe('true, this is not\nthe time for that.');
  });

  it('select_move_tutor_pokemon waits on the party pick; get_selected_party_slot reads it (255 when cancelled)', () => {
    const d = driver('test:Pick::\n  select_move_tutor_pokemon\n  get_selected_party_slot var(test:VAR_A)\n  end\n');
    const run = (slot: number | null) => {
      d.vm.start({ label: 'test:Pick' as Id, zone: 'fixture:TOWN', source: 'test' });
      d.tick();
      expect(d.vm.view().app).toEqual({ app: 'party', mode: 'select' });
      d.vm.appDone({ app: 'party', slot });
      d.until(() => !d.vm.running());
      return d.state.vars['test:VAR_A' as Id];
    };
    expect(run(1)).toBe(1);
    expect(run(null)).toBe(255);
    // Without a party menu before it, the script is wrong: it fails loudly.
    const lone = driver('test:Lone::\n  get_selected_party_slot var(test:VAR_A)\n  end\n');
    lone.vm.start({ label: 'test:Lone' as Id, zone: 'fixture:TOWN', source: 'test' });
    expect(() => lone.until(() => !lone.vm.running())).toThrow(/no party menu ran/);
  });

  it('open_party_menu_for_trade picks like the tutor pick (PARTY_MENU_MODE_NPC_TRADE)', () => {
    const d = driver('test:Trade::\n  open_party_menu_for_trade\n  get_selected_party_slot var(test:VAR_A)\n  end\n');
    d.vm.start({ label: 'test:Trade' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().app).toEqual({ app: 'party', mode: 'trade' });
    d.vm.appDone({ app: 'party', slot: 2 });
    d.until(() => !d.vm.running());
    expect(d.state.vars['test:VAR_A' as Id]).toBe(2);
  });
});

describe('party ribbons (decomp scrcmd_party.c)', () => {
  it('set_party_mon_ribbon, get_party_mon_ribbon, count_party_ribbons (non-eggs, distinct ids), buffer_ribbon_name', () => {
    const ir = [
      'test:Ribbons::',
      '  set_party_mon_ribbon 0, 5',
      '  set_party_mon_ribbon 0, 2',
      '  set_party_mon_ribbon 0, 5',
      '  set_party_mon_ribbon 1, 2',
      '  set_party_mon_ribbon 2, 9',
      '  get_party_mon_ribbon var(test:VAR_A), 0, 5',
      '  get_party_mon_ribbon var(test:VAR_B), 1, 5',
      '  count_party_ribbons var(test:VAR_C)',
      '  count_party_mon_ribbons_unused var(test:VAR_D), 0',
      '  buffer_ribbon_name 0, 2',
      '  message text(test:Text_Buffer)',
      '  end',
      '',
    ].join('\n');
    const d = driver(ir);
    d.state.party.push(testMon(registries, 'fixture:SPECIES_MOSSLET', 5), testMon(registries, 'fixture:SPECIES_MOSSLET', 5), { ...testMon(registries, 'fixture:SPECIES_MOSSLET', 5), isEgg: true });
    d.vm.start({ label: 'test:Ribbons' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().message?.text === 'Calm Sash');
    expect(d.state.party.map((m) => m.ribbons)).toEqual([[2, 5], [2], [9]]);
    const v = (n: string) => d.state.vars[`test:VAR_${n}` as Id] ?? 0;
    expect([v('A'), v('B'), v('C'), v('D')]).toEqual([1, 0, 2, 2]);
  });
});

describe('trainer score, card level, Pokédex completion', () => {
  const species = ['MOSSLET', 'EMBERKIT', 'DRIPLING', 'SKYLET', 'BURROWBIT', 'MOSSGROVE'].map((s) => `fixture:SPECIES_${s}` as Id);
  const run = (d: Driver, label: string) => {
    d.vm.start({ label: label as Id, zone: 'fixture:TOWN', source: 'test' });
    d.until(() => !d.vm.running());
    return d.state.vars['test:VAR_A' as Id] ?? 0;
  };

  it('increment_trainer_score(2) add the event (the gyms: BADGE_EARNED 23; the fixture scores event e as e + 1); give_pokemon scores a first catch', () => {
    const d = driver('test:Score::\n  increment_trainer_score2 23\n  increment_trainer_score 4\n  end\ntest:Give::\n  give_pokemon 1, 5, 0, var(test:VAR_A)\n  end\n');
    run(d, 'test:Score');
    expect(d.state.records.score).toBe(24 + 5);
    run(d, 'test:Give');
    expect(d.state.records.score).toBe(29 + 23); // CAUGHT_SPECIES (22)
    run(d, 'test:Give');
    expect(d.state.records.score).toBe(52);
  });

  it('get_trainer_card_level and the dex completion checks', () => {
    const d = driver(
      'test:Level::\n  get_trainer_card_level var(test:VAR_A)\n  end\ntest:Local::\n  check_local_dex_completed var(test:VAR_A)\n  end\ntest:National::\n  check_national_dex_completed var(test:VAR_A)\n  end\n',
    );
    expect(run(d, 'test:Level')).toBe(0);
    expect(run(d, 'test:Local')).toBe(0);
    expect(run(d, 'test:National')).toBe(0);
    d.state.flags['fixture:FLAG_GAME_COMPLETED' as Id] = true;
    d.state.pokedex.seen.push(...species);
    d.state.pokedex.caught.push(...species);
    expect(run(d, 'test:Local')).toBe(1);
    expect(run(d, 'test:National')).toBe(1);
    expect(run(d, 'test:Level')).toBe(2);
  });

  it('start_signature_app waits on the signature app', () => {
    const d = driver('test:Sign::\n  start_signature_app\n  end\n');
    d.vm.start({ label: 'test:Sign' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().app).toEqual({ app: 'signature' });
    d.vm.appDone({ app: 'signature' });
    d.until(() => !d.vm.running());
  });

  it('load_pokedex_rating rates the Sinnoh seen count and the national caught count by the DS thresholds', () => {
    const names = ['RowanPokemonSeenUpTo15', 'OakPokemonCaughtUnder40'];
    const ids = names.map((n) => `platinum:PokedexRatings_Text_${n}` as Id);
    const regs = { ...registries, textBanks: new Map([...registries.textBanks, ['test:RATINGS' as Id, { id: 'test:RATINGS' as Id, sourceIndex: 383, messages: ids }]]) } as Registries;
    const ir = 'test:Rate::\n  load_pokedex_rating 0, var(test:VAR_A)\n  end\ntest:RateN::\n  load_pokedex_rating 1, var(test:VAR_A)\n  end\n';
    const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
    const d = new Driver(regs, labels, newState());
    // The thresholds are the DS's fixed numbers (15 … 200, 40 … 481) before any completion check, so the
    // fixture's complete dex (5 Sinnoh, 6 national) rates as the lowest.
    d.state.pokedex.seen.push(...species);
    d.state.pokedex.caught.push(...species);
    expect(run(d, 'test:Rate')).toBe(0);
    expect(run(d, 'test:RateN')).toBe(1);
  });
});

describe('Pokémon Center repeat-interaction prevention', () => {
  it('turns away only after the completed healing conversation, before another A can talk again', () => {
    const d = driver('test:Heal::\n  play_pokecenter_healing_animation 1\n  heal_party\n  wait_time 3, var(test:VAR_A)\n  release_all\n  end\n');
    d.state.player.facing = 'up';
    d.vm.start({ label: 'test:Heal', zone: 'fixture:TOWN', source: 'object', lastTalked: 3 });
    d.tick();
    expect(d.field.calls).not.toContain('turnPlayer down');
    d.until(() => !d.vm.running());
    expect(d.field.calls.at(-1)).toBe('turnPlayer down');
  });

  it('does not turn for a plain heal_party (home, blackout or other scripts)', () => {
    const d = driver('test:Heal::\n  heal_party\n  end\n');
    d.vm.start({ label: 'test:Heal', zone: 'fixture:TOWN', source: 'object', lastTalked: 3 });
    d.until(() => !d.vm.running());
    expect(d.field.calls.some(c => c.startsWith('turnPlayer'))).toBe(false);
  });
});
