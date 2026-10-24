/** The Jubilife TV gallery's script commands on a fake field (no ROM). */
import { describe, expect, it } from 'vitest';
import { parseIR, type Id } from '@opensinnoh/core';
import type { DressUpPhoto, Registries } from '@opensinnoh/contracts';
import { Driver, loadFixture, newState } from './test-support.ts';

const fixture = loadFixture();
const registries = (() => {
  const out = Object.fromEntries(Object.entries(fixture.registries).map(([k, m]) => [k, new Map(m as Map<Id, unknown>)])) as Record<string, Map<Id, unknown>>;
  for (const [i, n] of ['A', 'B'].entries()) out.vars!.set(`test:VAR_${n}` as Id, { id: `test:VAR_${n}`, sourceIndex: 0x4100 + i, initial: 0, scope: 'saved' });
  return out as unknown as Registries;
})();
const photo: DressUpPhoto = {
  mon: { species: 'fixture:SPECIES_EMBERKIT' as Id, form: 0, pid: 1, otId: 2, nickname: null, x: 128, y: 96 },
  trainerName: 'Ari',
  trainerGender: 'male',
  dressUp: { accessories: [], monPriority: -1, backdrop: 0 },
  title: null,
};

function run(body: string, edit: (d: Driver) => void = () => {}, during: (d: Driver) => void = () => {}) {
  const ir = `test:Script::\n${body
    .trim()
    .split('\n')
    .map((l) => `  ${l.trim()}`)
    .join('\n')}\n  end\n`;
  const labels = new Map([...fixture.labels, ...Object.entries(parseIR(ir).labels).map(([id, commands]) => [id as Id, { pack: 'test', commands }] as const)]);
  const d = new Driver(registries, labels, newState());
  edit(d);
  d.vm.start({ label: 'test:Script' as Id, zone: 'fixture:TOWN', source: 'test' });
  during(d);
  d.until(() => !d.vm.running());
  const v = (n: string) => d.state.vars[`test:VAR_${n}` as Id] ?? 0;
  return { d, v };
}
const withPhoto = (d: Driver) => (d.state.dressUpPhotos[0] = structuredClone(photo));

describe('the Jubilife TV gallery (scrcmd.c)', () => {
  it('dress_up_photo_has_data: 1 for a filled slot, else 0', () => {
    expect(run('dress_up_photo_has_data 0, var(test:VAR_A)').v('A')).toBe(0);
    expect(run('dress_up_photo_has_data 0, var(test:VAR_A)\ndress_up_photo_has_data 1, var(test:VAR_B)', withPhoto).v('A')).toBe(1);
    expect(run('dress_up_photo_has_data 1, var(test:VAR_B)', withPhoto).v('B')).toBe(0);
  });

  it('show_dress_up_photo: an empty slot sets 1 and opens nothing; a photo sets 0 and opens the viewer', () => {
    expect(run('show_dress_up_photo 3, var(test:VAR_A)').v('A')).toBe(1);
    const { v } = run('show_dress_up_photo 0, var(test:VAR_A)', withPhoto, (d) => {
      d.tick();
      expect(d.vm.view().app).toEqual({ app: 'gallery-photo', slot: 0 });
      d.vm.appDone({ app: 'gallery-photo' });
    });
    expect(v('A')).toBe(0);
  });

  it('scr_cmd_0a6 opens the dress-up on the party slot (the help the first time); the var says whether it saved', () => {
    for (const saved of [true, false]) {
      const { v } = run('scr_cmd_0a6 2, var(test:VAR_A), 1', () => {}, (d) => {
        d.tick();
        expect(d.vm.view().app).toEqual({ app: 'gallery-dress-up', slot: 2, first: true });
        d.vm.appDone({ app: 'gallery-dress-up', saved });
      });
      expect(v('A')).toBe(saved ? 1 : 0);
    }
  });

  it('set_dress_up_photo_title sets slot 0\'s word; without a photo it fails', () => {
    expect(run('set_dress_up_photo_title 1177', withPhoto).d.state.dressUpPhotos[0]!.title).toBe(1177);
    expect(() => run('set_dress_up_photo_title 1177')).toThrow(/no photo in slot 0/);
  });
});
