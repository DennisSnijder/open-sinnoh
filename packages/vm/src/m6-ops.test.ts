/** The M6 commands on synthetic IR, the fixture's records and a fake field (no ROM). */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import { Driver, loadFixture, newState } from './test-support.ts';
import type { Registries } from '@opensinnoh/contracts';
import { BATTLEGROUND_GYM_LEADERS, BATTLEGROUND_STAT_TRAINERS, BATTLEGROUND_TRAINER_NONE, POKEMON_PREVIEW, RUINS_STATE_ACTIVATED_ALL_DOTS, TURNBACK } from './m6-ops.ts';

const fixture = loadFixture();
const town = fixture.registries.zones.get('fixture:TOWN' as Id)!;
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const n of [TURNBACK.entrance, TURNBACK.pillarRoom, TURNBACK.giratinaRoom, ...TURNBACK.rooms]) out.zones!.set(`test:ZONE_${n}` as Id, { ...town, id: `test:ZONE_${n}`, sourceIndex: n });
  for (const [i, n] of ['A', 'B', 'C', 'D', 'P', 'R'].entries()) out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' });
  // A receptionist's bank: messages 0–2 by the number of banned species seen; Mewtwo and Dialga from the banlist.
  out.textBanks!.set('test:BANK' as Id, { id: 'test:BANK', sourceIndex: 900, messages: ['test:T0', 'test:T1', 'test:T2'] });
  out.texts!.set('test:T0' as Id, { id: 'test:T0', text: 'Bring {var 0}.' });
  out.texts!.set('test:T1' as Id, { id: 'test:T1', text: 'Bring {var 0}. No {var 1}.' });
  out.texts!.set('test:T2' as Id, { id: 'test:T2', text: 'Bring {var 0}. No {var 1} or {var 2}.' });
  const base = fixture.registries.species.get('fixture:SPECIES_MOSSLET' as Id) as object;
  for (const [n, name] of [[150, 'MEWTWO'], [483, 'DIALGA']] as const) out.species!.set(`test:SPECIES_${name}` as Id, { ...base, id: `test:SPECIES_${name}`, sourceIndex: n, name });
  out.sequences!.set('test:SEQ_SE_PL_JUMP2' as Id, { ...([...fixture.registries.sequences.values()][0] as object), id: 'test:SEQ_SE_PL_JUMP2', sourceIndex: 1487 });
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

describe('M6 commands', () => {
  it('draw_pokemon_preview shows the framed picture and marks the species seen; remove_pokemon_preview closes it (decomp ScrCmd_DrawPokemonPreview)', () => {
    const d = run('draw_pokemon_preview 2, 1\nwait_ab_press\nremove_pokemon_preview');
    d.tick();
    expect(d.vm.view().pokemonPreview).toEqual({ ...POKEMON_PREVIEW, species: 'fixture:SPECIES_EMBERKIT', female: true });
    expect(d.state.pokedex.seen).toContain('fixture:SPECIES_EMBERKIT');
    // Only the species: FieldSystem_WriteSpeciesSeen records no form or gender.
    expect(d.state.pokedex.forms['fixture:SPECIES_EMBERKIT' as Id]).toBeUndefined();
    d.press('a');
    d.until(() => !d.vm.running());
    expect(d.vm.view().pokemonPreview).toBeUndefined();
    expect([...d.log.keys.keys()]).toEqual([]);
  });

  it('the preview of a male species uses the default face; a second draw or a remove without one fails loudly', () => {
    const d = run('draw_pokemon_preview 2, 0');
    d.until(() => !d.vm.running());
    expect(d.vm.view().pokemonPreview?.female).toBe(false);
    expect(() => run('draw_pokemon_preview 2, 0\ndraw_pokemon_preview 2, 0').until(() => false, 5)).toThrow(/already shown/);
    expect(() => run('remove_pokemon_preview').until(() => false, 5)).toThrow(/no preview/);
  });

  /** Runs init_turnback_cave with the pillars and rooms counts, the player on a tile; returns the warp edits. */
  const turnback = (pillars: number, rooms: number, x: number, z: number, before = 0) => {
    const d = run(`${'get_random var(test:VAR_A), 7\n'.repeat(before)}init_turnback_cave var(test:VAR_P), var(test:VAR_R)`, (d) => {
      d.state.vars['test:VAR_P' as Id] = pillars;
      d.state.vars['test:VAR_R' as Id] = rooms;
      d.state.player = { ...d.state.player, x, z };
    });
    d.until(() => !d.vm.running());
    return d.field.calls.filter((c) => c.startsWith('setWarpDestination'));
  };

  it('init_turnback_cave: three pillars lead to the Giratina room, 30 rooms back to the entrance; the door the player came by keeps its target (decomp ScrCmd_InitTurnbackCave)', () => {
    const doors = (zone: number, except: number) => [0, 1, 2, 3].filter((w) => w !== except).map((w) => `setWarpDestination ${w} test:ZONE_${zone}`);
    expect(turnback(3, 40, 11, 1)).toEqual(doors(TURNBACK.giratinaRoom, 0));
    expect(turnback(1, 30, 20, 11)).toEqual(doors(TURNBACK.entrance, 1));
    expect(turnback(2, 31, 11, 20)).toEqual(doors(TURNBACK.entrance, 2));
    expect(turnback(0, 30, 2, 11)).toEqual(doors(TURNBACK.entrance, 3));
    // The entrance's door from Sendoff Spring (11,16) is not one of the four: all four change.
    expect(turnback(3, 0, 11, 16)).toEqual(doors(TURNBACK.giratinaRoom, 5));
  });

  it('init_turnback_cave: otherwise the pillar room or one of the six rooms before the next pillar, the same for all doors', () => {
    const targets = new Set<string>();
    for (let before = 0; before < 40; before++)
      for (const pillars of [0, 1, 2]) {
        const calls = turnback(pillars, 5, 11, 1, before);
        expect(calls.length).toBe(3);
        const zone = Number(calls[0]!.split('_').at(-1));
        expect(new Set(calls.map((c) => c.split(' ')[2])).size).toBe(1);
        expect([TURNBACK.pillarRoom, ...TURNBACK.rooms.slice(pillars * 6, pillars * 6 + 6)]).toContain(zone);
        targets.add(`${pillars}:${zone}`);
      }
    expect(targets.size).toBeGreaterThan(12);
  });

  it('get_random_battleground_trainers: a gym leader, up to two more distinct ones, maybe a stat trainer, else NONE (decomp ScrCmd_GetRandomBattlegroundTrainers)', () => {
    const picks = new Set<string>();
    for (let before = 0; before < 60; before++) {
      const d = run(`${'get_random var(test:VAR_A), 7\n'.repeat(before)}get_random_battleground_trainers var(test:VAR_A), var(test:VAR_B), var(test:VAR_C), var(test:VAR_D)`);
      d.until(() => !d.vm.running());
      const [a, b, c, s] = ['A', 'B', 'C', 'D'].map((n) => d.state.vars[`test:VAR_${n}` as Id]!);
      expect(BATTLEGROUND_GYM_LEADERS).toContain(a);
      for (const v of [b, c]) expect([...BATTLEGROUND_GYM_LEADERS, BATTLEGROUND_TRAINER_NONE]).toContain(v);
      const leaders = [a, b, c].filter((v) => v !== BATTLEGROUND_TRAINER_NONE);
      expect(new Set(leaders).size).toBe(leaders.length);
      expect([...BATTLEGROUND_STAT_TRAINERS, BATTLEGROUND_TRAINER_NONE]).toContain(s);
      picks.add(`${leaders.length}:${s === BATTLEGROUND_TRAINER_NONE}`);
    }
    expect(picks.size).toBeGreaterThan(2);
  });

  it('activate_regi_ruins_dot: each dot tile sets its bit with the jump sound; all seven activate the ruin; other tiles change nothing', () => {
    const dots = (type: number, tiles: [number, number][], start = 0) => {
      const d = run(tiles.map(([x, z]) => `activate_regi_ruins_dot var(test:VAR_A), ${type}, ${x}, ${z}`).join('\n'), (d) => (d.state.vars['test:VAR_A' as Id] = start));
      d.until(() => !d.vm.running());
      return { value: d.state.vars['test:VAR_A' as Id], sounds: d.audio.played.filter((c) => c.includes('SEQ_SE_PL_JUMP2')).length };
    };
    expect(dots(588, [[5, 5], [6, 6]])).toEqual({ value: 0b10, sounds: 1 });
    expect(dots(588, [[4, 7], [5, 5], [5, 9], [7, 7], [9, 5], [9, 9], [10, 7]])).toEqual({ value: RUINS_STATE_ACTIVATED_ALL_DOTS, sounds: 7 });
    expect(dots(590, [[11, 7]], 0x3f)).toEqual({ value: RUINS_STATE_ACTIVATED_ALL_DOTS, sounds: 1 });
    expect(dots(592, [[5, 5], [5, 5]])).toEqual({ value: 1, sounds: 2 });
    expect(() => dots(589, [[5, 5]])).toThrow(/bad dot type 589/);
  });

  it('message_seen_banlist_species: the bank message after `start` by the banned species seen, slot 0 the number required (decomp BattleFrontier_MakeSeenBanlistSpeciesMsg)', () => {
    const text = (seen: string[]) => {
      const d = run('message_seen_banlist_species 0, 3, 0, 0, 900\nwait_ab_press', (d) => (d.state.pokedex.seen = seen as Id[]));
      for (let i = 0; i < 300; i++) d.tick();
      return d.vm.view().message?.text;
    };
    expect(text([])).toBe('Bring 3.');
    expect(text(['test:SPECIES_DIALGA'])).toBe('Bring 3. No DIALGA.');
    expect(text(['test:SPECIES_DIALGA', 'test:SPECIES_MEWTWO'])).toBe('Bring 3. No MEWTWO or DIALGA.');
  });

  it('check_should_show_ghost: TRUE when the draw (0–100) is at most the chance; above 100 counts as 100', () => {
    const ghost = (chance: number) => {
      const d = run(`check_should_show_ghost ${chance}, var(test:VAR_A)`);
      d.until(() => !d.vm.running());
      return d.state.vars['test:VAR_A' as Id];
    };
    expect(ghost(100)).toBe(1);
    expect(ghost(255)).toBe(1);
  });
});
