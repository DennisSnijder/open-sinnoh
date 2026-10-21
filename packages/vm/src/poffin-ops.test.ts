/** The Poffin script commands on a fake field (no ROM): Poffins, the Fashion Case, Amity Square. */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { POFFIN_CASE_SIZE, type AmitySquareTables, type Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState } from './test-support.ts';

const fixture = loadFixture();
/** Original tables: two pools (Mosslet's and the rest's) and four gifts, the first two items. */
const amity: AmitySquareTables = {
  stepVar: 'test:VAR_STEPS' as Id,
  finds: [
    { species: ['fixture:SPECIES_EMBERKIT' as Id], accessories: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
    { species: ['fixture:SPECIES_MOSSLET' as Id], accessories: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7] },
  ],
  gifts: [149, 150, 20, 21],
  itemGifts: 2,
};
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const [i, n] of ['A', 'B', 'C', 'STEPS'].entries()) out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' });
  const ng = out.newGame!.get('fixture:NEW_GAME' as Id) as object;
  out.newGame!.set('fixture:NEW_GAME' as Id, { ...ng, amitySquare: amity });
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
  d.until(() => !d.vm.running());
  const v = (n: string) => d.state.vars[`test:VAR_${n}` as Id] ?? 0;
  return { d, v };
}

describe('Poffins (scrcmd.c)', () => {
  it('check_can_cook_poffin: 1 without a berry, 2 with a full case, else 0', () => {
    const berry = (d: Driver) => (d.state.bag.berries = [{ item: 'fixture:ITEM_TONIC' as Id, count: 1 }]);
    expect(run('check_can_cook_poffin var(test:VAR_A)').v('A')).toBe(1);
    expect(run('check_can_cook_poffin var(test:VAR_A)', berry).v('A')).toBe(0);
    const full = (d: Driver) => {
      berry(d);
      d.state.poffins = Array.from({ length: POFFIN_CASE_SIZE }, () => ({ type: 0, flavors: [1, 0, 0, 0, 0], smoothness: 20 }));
    };
    expect(run('check_can_cook_poffin var(test:VAR_A)', full).v('A')).toBe(2);
  });

  it('give_poffin makes one from flavours (the type to the var) and counts the free slots', () => {
    const { d, v } = run('give_poffin var(test:VAR_A), 0, 32, 32, 0, 0, 20\nget_empty_poffin_case_slot_count var(test:VAR_B)\ncheck_has_empty_poffin_case_slot var(test:VAR_C)');
    expect(d.state.poffins).toEqual([{ type: 7, flavors: [0, 32, 32, 0, 0], smoothness: 20 }]);
    expect([v('A'), v('B'), v('C')]).toEqual([7, POFFIN_CASE_SIZE - 1, 1]);
  });
});

describe('the Fashion Case (scrcmd.c)', () => {
  it('adds, fits and removes accessories; adds and checks backdrops', () => {
    const { d, v } = run('add_accessory 3, 8\ncan_fit_accessory 3, 2, var(test:VAR_A)\nremove_accessory 3, 1\nadd_contest_backdrop 4\ncheck_backdrop 4, var(test:VAR_B)\ncheck_backdrop 5, var(test:VAR_C)');
    expect(d.state.fashionCase.accessories[3]).toBe(7);
    expect(d.state.fashionCase.backdrops).toEqual([4]);
    expect([v('A'), v('B'), v('C')]).toEqual([0, 1, 0]);
  });
});

describe('Amity Square (scrcmd_amity_square.c)', () => {
  it("the step count, the follower's find from its pool (the first pool for the rest) and the man's gifts", () => {
    const { v } = run('get_amity_square_step_count var(test:VAR_A)\nclear_amity_square_step_count\nget_amity_square_step_count var(test:VAR_B)', (d) => (d.state.vars['test:VAR_STEPS' as Id] = 205));
    expect([v('A'), v('B')]).toEqual([205, 0]);
    expect(run('calc_amity_square_found_accessory var(test:VAR_A), 1').v('A')).toBe(7);
    expect(run('calc_amity_square_found_accessory var(test:VAR_A), 3').v('A')).toBe(1);
    const gift = (n: number) => run(`check_amity_square_man_gift_is_accessory ${n}, var(test:VAR_A)\nget_amity_square_berry_or_accessory_id_from_man ${n}, var(test:VAR_B)`).v;
    expect([gift(1)('A'), gift(1)('B'), gift(2)('A'), gift(2)('B')]).toEqual([0, 150, 1, 20]);
    expect(run('calc_amity_square_berry_and_accessory_man_option_id var(test:VAR_A)').v('A')).toBeLessThan(4);
  });
});
