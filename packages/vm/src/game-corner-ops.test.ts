/**
 * The Game Corner's script ops (game-corner-ops.ts) on the fixture pack: the coin window and coin commands (coins.c's
 * rules), the prizes, the bonus streak check, the slot launcher and what it writes back, the guitarist's Hidden Power
 * type, and the list menu that remembers its place (show_list_menu_remember_cursor).
 */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { SLOT, type NewGame, type Registries, type SlotTables } from '@opensinnoh/contracts';
import { slotMode } from '@opensinnoh/services';
import { Driver, loadFixture, newState, testMon } from './test-support.ts';

const fixture = loadFixture();
const STREAK = 'test:VAR_STREAK' as Id;
/** Original tables: only what the ops read is meaningful. */
const SLOTS = {
  modes: [5, 4, 3, 2, 1, 0, 5, 4, 3, 2, 1, 0],
  prizes: [
    { item: 'fixture:ITEM_TONIC' as Id, price: 120 },
    { item: 'fixture:ITEM_STILL_STONE' as Id, price: 900 },
  ],
  streakVar: STREAK,
} as unknown as SlotTables;

const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  ['A', 'B', 'C', 'D', 'STREAK'].forEach((n, i) => out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' }));
  out.texts!.set('platinum:pl_msg_00000361_00197' as Id, { id: 'platinum:pl_msg_00000361_00197', text: '{var 0} Coins' });
  out.texts!.set('test:Entry' as Id, { id: 'test:Entry', text: 'Row {var 0}' });
  // The list menus' bank (TEXT_BANK_MENU_ENTRIES, pl_msg 361): message 0 for the test's rows.
  out.textBanks!.set('test:BANK_MENU' as Id, { id: 'test:BANK_MENU', sourceIndex: 361, messages: ['test:Entry'] });
  const ng = out.newGame!.get('fixture:NEW_GAME' as Id) as NewGame;
  out.newGame!.set(ng.id, { ...ng, slots: SLOTS });
  return out as unknown as Registries;
})();

function driver(ir: string): Driver {
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  return new Driver(registries, labels, newState());
}
const run = (d: Driver) => {
  d.vm.start({ label: 'test:Run' as Id, zone: 'fixture:TOWN', source: 'test' });
  d.until(() => !d.vm.running());
};
const vars = (d: Driver, ...names: string[]) => names.map((n) => d.state.vars[`test:VAR_${n}` as Id] ?? 0);

describe('coins (decomp scrcmd_coins.c over coins.c)', () => {
  it('the coin window shows the coins right-aligned in 5 digits; update_coin_display reprints; hide_coins closes it', () => {
    const d = driver('test:Run::\n  show_coins 20, 2\n  wait_time 1, var(test:VAR_A)\n  add_coins 50\n  update_coin_display\n  wait_time 1, var(test:VAR_A)\n  hide_coins\n  wait_time 1, var(test:VAR_A)\n  end\n');
    d.state.coins = 7;
    d.vm.start({ label: 'test:Run' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.tick();
    expect(d.vm.view().coinWindow).toEqual({ x: 160, y: 16, width: 80, height: 16, text: '    7 Coins' });
    d.until(() => d.vm.view().coinWindow?.text === '   57 Coins');
    d.until(() => !d.vm.view().coinWindow);
    const bad = driver('test:Run::\n  update_coin_display\n  end\n');
    bad.vm.start({ label: 'test:Run' as Id, zone: 'fixture:TOWN', source: 'test' });
    expect(() => bad.tick()).toThrow(/coin window is not shown/);
  });

  it('adds up to the cap (nothing at the cap), subtracts only what there is, and checks', () => {
    const d = driver(`test:Run::
  add_coins 30
  get_coins_amount var(test:VAR_A)
  subtract_coins_from_value 40
  get_coins_amount var(test:VAR_B)
  set_var_from_value var(test:VAR_D), 25
  subtract_coins_from_var var(test:VAR_D)
  has_coins_from_value var(test:VAR_C), 6
  has_coins_from_var var(test:VAR_D), var(test:VAR_D)
  end
`);
    run(d);
    expect(vars(d, 'A', 'B', 'C', 'D')).toEqual([30, 30, 0, 0]);
    expect(d.state.coins).toBe(5);
    const full = driver('test:Run::\n  add_coins 900\n  check_can_add_coins var(test:VAR_A), 1\n  end\n');
    full.state.coins = SLOT.maxCoins - 100;
    run(full);
    expect(full.state.coins).toBe(SLOT.maxCoins);
    expect(vars(full, 'A')).toEqual([0]);
    const can = driver('test:Run::\n  check_can_add_coins var(test:VAR_A), 100\n  check_can_add_coins var(test:VAR_B), 101\n  end\n');
    can.state.coins = SLOT.maxCoins - 100;
    run(can);
    expect(vars(can, 'A', 'B')).toEqual([1, 0]);
  });
});

describe('the Game Corner and the Prize Exchange', () => {
  it('get_game_corner_prize_data gives the prize\'s item number and price; check_bonus_round_streak wants 10', () => {
    const d = driver('test:Run::\n  get_game_corner_prize_data 1, var(test:VAR_A), var(test:VAR_B)\n  check_bonus_round_streak var(test:VAR_C)\n  end\n');
    d.state.vars[STREAK] = 9;
    run(d);
    expect(vars(d, 'A', 'B', 'C')).toEqual([5, 900, 0]);
    const ten = driver('test:Run::\n  check_bonus_round_streak var(test:VAR_C)\n  end\n');
    ten.state.vars[STREAK] = 10;
    run(ten);
    expect(vars(ten, 'C')).toEqual([1]);
    const bad = driver('test:Run::\n  get_game_corner_prize_data 2, var(test:VAR_A), var(test:VAR_B)\n  end\n');
    bad.vm.start({ label: 'test:Run' as Id, zone: 'fixture:TOWN', source: 'test' });
    expect(() => bad.tick()).toThrow(/no prize 2/);
  });

  it('scr_cmd_267 opens the machine in the day\'s mode with a seed from the main stream, then takes the coins, the rounds and a better streak', () => {
    const d = driver('test:Run::\n  set_var_from_value var(test:VAR_A), 4\n  scr_cmd_267 var(test:VAR_A)\n  end\n');
    d.state.coins = 300;
    d.state.gameTime.dailyRandom = 0x1234;
    d.state.vars[STREAK] = 2;
    d.vm.start({ label: 'test:Run' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().app !== null);
    expect(d.vm.view().app).toMatchObject({ app: 'slots', machine: 4, mode: slotMode(SLOTS, 0x1234, 4) });
    expect(d.state.records.score).toBeGreaterThan(0);
    d.vm.appDone({ app: 'slots', coins: 1450, streak: 3, rounds: 4 });
    d.until(() => !d.vm.running());
    expect(d.state.coins).toBe(1450);
    expect(d.state.vars[STREAK]).toBe(3);
    expect(d.state.records.counts[14]).toBe(4);
    // Winning 1000 coins or more would make a Records-program TV segment: logged as a stub.
    expect(d.log.keys.has('tv:game-corner')).toBe(true);
    const lower = driver('test:Run::\n  scr_cmd_267 0\n  end\n');
    lower.state.vars[STREAK] = 9;
    lower.vm.start({ label: 'test:Run' as Id, zone: 'fixture:TOWN', source: 'test' });
    lower.until(() => lower.vm.view().app !== null);
    lower.vm.appDone({ app: 'slots', coins: 0, streak: 3, rounds: 3 });
    lower.until(() => !lower.vm.running());
    expect(lower.state.vars[STREAK]).toBe(9);
    expect(lower.log.keys.has('tv:game-corner')).toBe(false);
  });

  it('calc_hidden_power_type: the IVs\' low bits pick the type (skipping ???); some species never learn it', () => {
    const d = driver('test:Run::\n  calc_hidden_power_type 0, var(test:VAR_A)\n  calc_hidden_power_type 1, var(test:VAR_B)\n  calc_hidden_power_type 2, var(test:VAR_C)\n  end\n');
    const all = (v: number) => ({ hp: v, attack: v, defense: v, speed: v, spAttack: v, spDefense: v });
    const a = testMon(registries, 'fixture:SPECIES_MOSSLET', 10);
    a.ivs = all(31);
    const b = testMon(registries, 'fixture:SPECIES_MOSSLET', 10);
    b.ivs = { ...all(30), hp: 31, speed: 31 };
    const c = { ...testMon(registries, 'fixture:SPECIES_MOSSLET', 10), species: 'test:SPECIES_DITTO' as Id };
    d.state.party = [a, b, c];
    run(d);
    // 63 → 15 · 63 / 63 + 1 = 16, past TYPE_MYSTERY (9): 17. HP and Speed: 0b1001 = 9 → 9 · 15 / 63 + 1 = 3.
    expect(vars(d, 'A', 'B', 'C')).toEqual([17, 3, 0xffff]);
  });
});

describe('show_list_menu_remember_cursor (decomp FieldMenuManager_ShowListMenuWithCursorPosition)', () => {
  it('opens at the vars\' offset and row and writes them back as the cursor moves', () => {
    const entries = Array.from({ length: 12 }, (_, i) => `  set_var_from_value var(test:VAR_D), ${i}\n  buffer_var_padding_digits 0, var(test:VAR_D), 1, 2\n  add_list_menu_entry 0, 255, ${i}`).join('\n');
    const d = driver(`test:Run::
  init_global_text_list_menu 1, 1, 0, 1, var(test:VAR_A)
${entries}
  show_list_menu_remember_cursor var(test:VAR_B), var(test:VAR_C)
  end
`);
    d.state.vars['test:VAR_B' as Id] = 3;
    d.state.vars['test:VAR_C' as Id] = 6;
    d.vm.start({ label: 'test:Run' as Id, zone: 'fixture:TOWN', source: 'test' });
    d.until(() => d.vm.view().menu !== null);
    expect(d.vm.view().menu).toMatchObject({ top: 3, cursor: 9 });
    for (let i = 0; i < 4; i++) d.tick();
    d.press('down');
    d.tick();
    expect(d.vm.view().menu).toMatchObject({ top: 3, cursor: 10 });
    expect(vars(d, 'B', 'C')).toEqual([3, 7]);
    d.press('down');
    d.tick();
    expect(vars(d, 'B', 'C')).toEqual([4, 7]);
    d.press('a');
    d.until(() => !d.vm.running());
    expect(vars(d, 'A')).toEqual([11]);
  });
});
