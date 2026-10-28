/**
 * Commands reachable offline outside the story path, and the link ones that answer "no connection" (no ROM): the
 * Underground counters, the Bad Egg check, the party form revert, the PC nickname, the trainer appearance, the
 * frontier's link commands.
 */
import { describe, expect, it } from 'vitest';
import { parseIR, type Arg, type Id } from '@opensinnoh/core';
import { giveItem, itemCount, takeItem, type Registries, type RegistryTypes } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState, TestLog, testMon } from './test-support.ts';
import { M1B_BANKS } from './m1b-ops.ts';
import { appearanceTrainerClass, calculateAppearance, newGameAppearance } from './appearance-ops.ts';
import { FRONTIER_LINK_OPS, frontierHandlers } from './frontier/ops.ts';
import { classifyFrontierOps } from './frontier/coverage.ts';
import { EASY_CHAT_BANKS } from '@opensinnoh/services';
import type { FrontierContext, FrontierRunner } from './frontier/runner.ts';

const fixture = loadFixture();
type Recs = { [K in keyof RegistryTypes]?: RegistryTypes[K][] };

function bank(sourceIndex: number, name: string, texts: string[]): Recs {
  const ids = texts.map((_, i) => `test:${name}_${i}` as Id);
  return { textBanks: [{ id: `test:${name}` as Id, sourceIndex, messages: ids }], texts: texts.map((text, i) => ({ id: ids[i]!, text })) };
}

const registries = (() => {
  const out: Record<string, Map<Id, unknown>> = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)]));
  const classes = Array.from({ length: 90 }, (_, i) => `Class ${i}`);
  const parts: Recs[] = [
    bank(M1B_BANKS.trainerClassNames, 'CLASSES', classes),
    bank(M1B_BANKS.trainerClassNamesWithArticles, 'CLASSES_ARTICLE', classes.map((c) => `a ${c}`)),
    // The Easy Chat banks (one word each), the tough words three.
    ...EASY_CHAT_BANKS.map((b): Recs => {
      const words = b === 'TEXT_BANK_TOUGH_WORDS' ? ['ALPHA', 'BETA', 'GAMMA'] : [b];
      const ids = words.map((_, i) => `fixture:${b}_${i}` as Id);
      return { textBanks: [{ id: `fixture:${b}` as Id, messages: ids }], texts: words.map((text, i) => ({ id: ids[i]!, text })) };
    }),
    {
      texts: [
        { id: 'test:Out' as Id, text: '{var 0}|{var 1}|{var 2}|{var 3}' },
        { id: 'test:Out2' as Id, text: '{var 0}|{var 1}' },
        { id: 'test:Out1' as Id, text: '{var 0}' },
      ],
      vars: [
        ...[0, 1, 2, 3].map((i) => ({ id: `test:VAR_OUT_${i}` as Id, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' as const })),
        // VAR_UNDERGROUND_FOSSILS_UNEARTHED, _TRAPS_SET, _TALK_COUNTER, _ITEMS_GIVEN_AWAY.
        ...[['FOSSILS', 0x4047], ['TRAPS', 0x4048], ['TALKS', 0x4049], ['GIFTS', 0x4054]].map(([n, i]) => ({ id: `test:VAR_UG_${n}` as Id, sourceIndex: i as number, initial: 0, scope: 'saved' as const })),
      ],
    },
  ];
  for (const p of parts) for (const [k, recs] of Object.entries(p)) for (const r of recs as { id: Id }[]) out[k]!.set(r.id, r);
  // Giratina (decomp SPECIES_GIRATINA 487) with an Origin form; the Griseous Orb (ITEM_GRISEOUS_ORB 112).
  const base = fixture.registries.species.get('fixture:SPECIES_MOSSLET' as Id) as object;
  out.species!.set('test:SPECIES_GIRATINA' as Id, { ...base, id: 'test:SPECIES_GIRATINA', sourceIndex: 487, forms: [{ ...base, form: 1, name: 'ORIGIN' }] });
  out.items!.set('test:ITEM_GRISEOUS_ORB' as Id, { ...(fixture.registries.items.get('fixture:ITEM_TONIC' as Id) as object), id: 'test:ITEM_GRISEOUS_ORB', sourceIndex: 112 });
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

describe('Underground counters (decomp ScrCmd_GetUnderground*)', () => {
  it('read their system vars', () => {
    const d = run(
      `get_underground_fossils_unearthed var(test:VAR_OUT_0)
       get_underground_traps_set var(test:VAR_OUT_1)
       get_underground_talk_counter var(test:VAR_OUT_2)
       get_underground_items_given_away var(test:VAR_OUT_3)`,
      (d) => Object.assign(d.state.vars, { 'test:VAR_UG_FOSSILS': 7, 'test:VAR_UG_TRAPS': 3, 'test:VAR_UG_TALKS': 2, 'test:VAR_UG_GIFTS': 1 }),
    );
    d.until(() => !d.vm.running());
    expect([0, 1, 2, 3].map((i) => v(d, `OUT_${i}`))).toEqual([7, 3, 2, 1]);
  });
});

describe('party checks', () => {
  it('check_party_has_bad_egg: no party Egg fails a checksum', () => {
    const d = run('set_var_from_value var(test:VAR_UG_FOSSILS), 5\ncheck_party_has_bad_egg var(test:VAR_UG_FOSSILS)', (d) => {
      const egg = testMon(registries, 'fixture:SPECIES_MOSSLET', 1);
      egg.isEgg = true;
      d.state.party = [egg];
    });
    d.until(() => !d.vm.running());
    expect(v(d, 'OUT_0')).toBe(0);
  });

  it('try_revert_party_pokemon_forms: the Orbs go back to the bag together, then every form reverts; a full bag changes nothing', () => {
    const orb = 'test:ITEM_GRISEOUS_ORB' as Id;
    const party = (d: Driver) => {
      const holders = [0, 1].map(() => Object.assign(testMon(registries, 'test:SPECIES_GIRATINA', 47), { heldItem: orb }));
      d.state.party = [...holders, testMon(registries, 'fixture:SPECIES_EMBERKIT', 10)];
    };
    const script = 'set_party_giratina_form 1\ntry_revert_party_pokemon_forms var(test:VAR_OUT_0)';
    const ok = run(script, party);
    ok.until(() => !ok.vm.running());
    expect(v(ok, 'OUT_0')).toBe(0);
    expect(ok.state.party.map((m) => [m.form, m.heldItem])).toEqual([[0, null], [0, null], [0, null]]);
    expect(itemCount(ok.state, orb)).toBe(2);

    // Room for one Orb only: Bag_TryAddItem of both fails, the var reads 0xFF and the party is untouched.
    const full = run(script, (d) => {
      party(d);
      while (giveItem(d.state, registries, orb, 1));
      takeItem(d.state, orb, 1);
    });
    full.until(() => !full.vm.running());
    expect(v(full, 'OUT_0')).toBe(0xff);
    expect(full.state.party.map((m) => [m.form, m.heldItem])).toEqual([[1, orb], [1, orb], [0, null]]);
  });
});

describe('text buffers', () => {
  it('buffer_mon_nickname_from_pc reads box * 30 + slot; buffer_trainer_class_name reads the class names', () => {
    const d = run('buffer_mon_nickname_from_pc 0, 31\nbuffer_trainer_class_name 1, 24\nmessage text(test:Out2)\nwait_button', (d) => {
      d.state.boxes = [0, 1].map((i) => ({ name: `Box ${i + 1}`, wallpaper: 0, slots: Array.from({ length: 30 }, () => null) }));
      d.state.boxes[1]!.slots[1] = Object.assign(testMon(registries, 'fixture:SPECIES_DRIPLING', 5), { nickname: 'Drip' });
    });
    d.readMessage('Drip|Class 24');
    d.until(() => !d.vm.running());
  });
});

describe('trainer appearance (decomp appearance.c)', () => {
  it('offers the trainer id row of the shuffle table, picks one, and buffers its class', () => {
    const d = run(
      `load_trainer_appearances
       message text(test:Out)
       wait_button
       get_trainer_info_trainer_class 2, var(test:VAR_OUT_0)
       calculate_trainer_info_appearance 2, var(test:VAR_OUT_1)
       set_trainer_info_appearance var(test:VAR_OUT_1)
       buffer_trainer_class_from_appearance 0
       message text(test:Out)
       wait_button`,
      (d) => {
        d.state.gender = 'male';
        d.state.trainerId = 0x12340003; // row 3: ROUGHNECK, SCHOOL_KID_M, BLACK_BELT, RICH_BOY
      },
    );
    d.readMessage('Class 57|Class 60|Class 14|Class 32');
    d.readMessage('a Class 14|Class 60|Class 14|Class 32');
    d.until(() => !d.vm.running());
    expect([v(d, 'OUT_0'), v(d, 'OUT_1'), d.state.appearance]).toEqual([14, 51, 51]);
  });

  it('without a saved appearance it is the new game one (variant 0); an index of the other gender is entry 0', () => {
    const s = { ...newState(), gender: 'female' as const, trainerId: 3 };
    expect(newGameAppearance(s)).toBe(14); // ACE_TRAINER_F
    expect(appearanceTrainerClass(s, newGameAppearance(s))).toBe(25);
    expect(appearanceTrainerClass(s, 3)).toBe(60); // SCHOOL_KID_M's index is male: GetAppearanceIndex returns 0
    expect(() => calculateAppearance(s, 4)).toThrow('variant 4');
    const d = run('buffer_trainer_class_from_appearance 0\nmessage text(test:Out1)\nwait_button', (d) => Object.assign(d.state, { gender: 'female', trainerId: 3 }));
    d.readMessage('a Class 25');
  });
});

describe('tough words (decomp easy_chat_words.c)', () => {
  const script = 'check_all_tough_words_unlocked var(test:VAR_OUT_0)\ntry_buffer_and_unlock_random_tough_word var(test:VAR_OUT_1), 0\nmessage text(test:Out1)\nwait_button';

  it('a locked word is drawn among the locked ones, unlocked and buffered; its bank entry is the result', () => {
    const d = run(script, (d) => (d.state.unlockedToughWords = 0b010));
    d.readMessage(/^(ALPHA|GAMMA)$/);
    d.until(() => !d.vm.running());
    expect(v(d, 'OUT_0')).toBe(0);
    const entry = v(d, 'OUT_1');
    expect([0, 2]).toContain(entry);
    expect(d.state.unlockedToughWords).toBe(0b010 | (1 << entry));
  });

  it('with every word unlocked the check is TRUE and the draw gives -1 without buffering', () => {
    const d = run('check_all_tough_words_unlocked var(test:VAR_OUT_0)\ntry_buffer_and_unlock_random_tough_word var(test:VAR_OUT_1), 0', (d) => (d.state.unlockedToughWords = 0b111));
    d.until(() => !d.vm.running());
    expect([v(d, 'OUT_0'), v(d, 'OUT_1')]).toEqual([1, 0xffff]);
    expect(d.state.unlockedToughWords).toBe(0b111);
  });
});

describe('group connection (no record-mixing group)', () => {
  // VAR_OUT_0 is var 0x4100 (16640): the action's extra operands are raw numbers.
  it('no entry is valid, the names buffer empty and the naming screen reads as left empty', () => {
    const d = run('set_var_from_value var(test:VAR_OUT_0), 9\ndo_group_connection_action 0, 1, 16640\nset_var_from_value var(test:VAR_OUT_1), 9\ndo_group_connection_action 4, 16641\ndo_group_connection_action 2, 1, 0\ndo_group_connection_action 3, 1, 1\nmessage text(test:Out2)\nwait_button');
    d.readMessage('|');
    d.until(() => !d.vm.running());
    expect([v(d, 'OUT_0'), v(d, 'OUT_1')]).toEqual([0, 1]);
    expect(d.log.keys.has('stub:do_group_connection_action')).toBe(true);
  });

  it('joining or making a group, which need one, fail loudly', () => {
    expect(() => run('do_group_connection_action 6').until(() => false)).toThrow(/action 6 needs a group/);
  });
});

describe('link commands (no connection)', () => {
  it('clear_received_temp_data_all_players is a real no-op; the frontier link commands are logged stand-ins writing 0', () => {
    const d = run('clear_received_temp_data_all_players');
    d.until(() => !d.vm.running());
    expect([...d.log.keys.keys()]).toEqual([]);

    const status = new Map(classifyFrontierOps().map((c) => [c.op, c.status]));
    expect(status.get('fr_clear_received_temp_data_all_players')).toBe('implemented');
    for (const op of FRONTIER_LINK_OPS) expect(status.get(op), op).toBe('stubbed');

    const log = new TestLog();
    const set: [number, number][] = [];
    const f = { r: { log }, slots: ['Old'], int: (a: Arg | undefined) => (a as { value: number }).value, set: (_c: FrontierContext, a: Arg | undefined, value: number) => void set.push([(a as { value: number }).value, value]) } as unknown as FrontierRunner;
    const h = frontierHandlers();
    const int = (value: number): Arg => ({ kind: 'int', value });
    expect(h.fr_clear_received_temp_data_all_players!(f, {} as FrontierContext, [])).toBe('continue');
    expect(h.fr_battle_hall_send_comm_message!(f, {} as FrontierContext, [int(7), int(0), int(0x8008)])).toBe('continue');
    expect(h.fr_get_selected_party_menu_slots!(f, {} as FrontierContext, [int(0x8002), int(0x8005)])).toBe('continue');
    expect(h.fr_buffer_partner_name!(f, {} as FrontierContext, [int(0)])).toBe('continue');
    expect(set).toEqual([[0x8008, 0], [0x8002, 0], [0x8005, 0]]);
    expect((f as unknown as { slots: string[] }).slots[0]).toBe('');
    expect([...log.keys.keys()]).toEqual(['frontier:fr_battle_hall_send_comm_message', 'frontier:fr_get_selected_party_menu_slots', 'frontier:fr_buffer_partner_name']);
  });
});
