import { describe, expect, it } from 'vitest';
import type { PackData, RegistryRecord } from '@opensinnoh/core';
import { checkReferences, loadGamePacks } from './packs.ts';
import { readPack } from '../test/packs.ts';

/** Fixture pack with one record replaced by `edit(record)`. */
function withRecord(registry: string, id: string, edit: (r: Record<string, unknown>) => void): PackData {
  const pack = structuredClone(readPack('fixture'));
  const r = pack.registries[registry]!.find((x) => x.id === id)! as unknown as Record<string, unknown>;
  edit(r);
  return pack;
}

const load = (pack: PackData) => () => loadGamePacks([pack]);

describe('record validators', () => {
  it('accept the fixture and demo-mod packs', () => {
    expect(() => loadGamePacks([readPack('fixture')])).not.toThrow();
    const game = loadGamePacks([readPack('fixture'), readPack('demo-mod')]);
    expect(game.registries.species.get('fixture:SPECIES_DRIPLING')).toMatchObject({ name: 'Rainlet', starterSlot: 0 });
    expect(game.labels.get('fixture:Town_Guide')!.pack).toBe('demo-mod');
    expect(game.loaded.overrides).toEqual([{ label: 'fixture:Town_Guide', previousPack: 'fixture', pack: 'demo-mod' }]);
  });

  it('name the registry, record id and field', () => {
    expect(load(withRecord('zones', 'fixture:ROOM', (r) => delete r.camera))).toThrow('zones fixture:ROOM: camera: missing (expected an id (cameras))');
    expect(load(withRecord('zones', 'fixture:ROOM', (r) => (r.colour = 'red')))).toThrow('zones fixture:ROOM: colour: unknown field');
    expect(load(withRecord('zones', 'fixture:ROOM', (r) => ((r.events as { objects: { sprite: unknown }[] }).objects[0]!.sprite = 'helper')))).toThrow(
      /zones fixture:ROOM: events\.objects\[0\]\.sprite: expected an id \(sprites\) or an object/,
    );
    expect(load(withRecord('zones', 'fixture:TOWN', (r) => (r.mapType = 'village')))).toThrow(/zones fixture:TOWN: mapType: expected one of "town"/);
    expect(load(withRecord('flags', 'fixture:FLAG_HIDE_GUIDE', (r) => (r.initial = 0)))).toThrow('flags fixture:FLAG_HIDE_GUIDE: initial: expected a boolean, got 0');
    expect(load(withRecord('vars', 'fixture:VAR_SCENE', (r) => (r.initial = 1.5)))).toThrow(/vars fixture:VAR_SCENE: initial: expected an integer >= 0 <= 65535/);
    expect(load(withRecord('species', 'fixture:SPECIES_MOSSLET', (r) => (r.starterSlot = 3)))).toThrow(/species fixture:SPECIES_MOSSLET: starterSlot/);
    expect(load(withRecord('texts', 'fixture:Text_TvShow', (r) => (r.text = 'bad {tag}')))).toThrow(/texts fixture:Text_TvShow: \(root\): text markup: unknown tag \{tag\}/);
  });

  it('run cross-field checks', () => {
    expect(load(withRecord('matrices', 'fixture:MATRIX_TOWN', (r) => (r.width = 3)))).toThrow(/matrices fixture:MATRIX_TOWN: .*chunks has 2 cells, expected width\*height = 3/);
    expect(load(withRecord('chunks', 'fixture:CHUNK_ROOM', (r) => (r.tiles as number[]).pop()))).toThrow(/tiles has 1023 entries, expected 1024/);
    expect(load(withRecord('sprites', 'fixture:SPRITE_HERO', (r) => delete (r.animations as Record<string, unknown>)['walk-up']))).toThrow(/animations\.walk-up is required/);
    expect(load(withRecord('sprites', 'fixture:SPRITE_HERO', (r) => (r.frameCount = 4)))).toThrow(/uses frame 4, but frameCount is 4/);
    expect(load(withRecord('lights', 'fixture:LIGHT_LAMP', (r) => (r.lights as unknown[]).pop()))).toThrow(/lights fixture:LIGHT_LAMP: .*lights has 3 entries, expected 4/);
    expect(load(withRecord('lights', 'fixture:LIGHT_LAMP', (r) => (r.ambient = [0, 2, 0])))).toThrow(/ambient has a component outside 0\.\.1/);
    const refs = checkReferences(loadGamePacks([withRecord('areas', 'fixture:AREA_INDOOR', (r) => (r.light = 'fixture:NO_LIGHT'))]));
    expect(refs).toContainEqual({ severity: 'error', location: 'areas fixture:AREA_INDOOR light', message: 'unknown lights fixture:NO_LIGHT' });
  });

  it('accept model-object sprites (model id or null) and check their model ref', () => {
    const asModel = (model: unknown) =>
      withRecord('sprites', 'fixture:SPRITE_HERO', (r) => {
        for (const k of Object.keys(r)) if (k !== 'id' && k !== 'sourceIndex') delete r[k];
        r.model = model;
      });
    expect(load(asModel(null))).not.toThrow();
    expect(load(asModel(7))).toThrow(/sprites fixture:SPRITE_HERO: model: expected an id \(models\), got 7/);
    const refs = checkReferences(loadGamePacks([asModel('fixture:NO_SUCH_MODEL')]));
    expect(refs).toContainEqual({ severity: 'error', location: 'sprites fixture:SPRITE_HERO model', message: 'unknown models fixture:NO_SUCH_MODEL' });
  });

  it('reject unknown registries and bad patches', () => {
    const pack = structuredClone(readPack('fixture'));
    pack.registries.pokemon = [{ id: 'fixture:X' } as RegistryRecord];
    expect(load(pack)).toThrow('fixture: unknown registry "pokemon"');
    const mod = structuredClone(readPack('demo-mod'));
    mod.patches[0]!.operations.push({ op: 'replace', path: '/starterSlot', value: 'zero' });
    expect(() => loadGamePacks([readPack('fixture'), mod])).toThrow(/species fixture:SPECIES_DRIPLING: starterSlot: expected an integer/);
  });
});

describe('reference check', () => {
  it('reports dangling refs and unreachable labels', () => {
    const diags = checkReferences(loadGamePacks([readPack('fixture')]));
    expect(diags).toEqual([]);

    const pack = structuredClone(readPack('fixture'));
    pack.scripts.labels['fixture:Orphan'] = [{ op: 'message', args: [{ kind: 'text', id: 'fixture:Text_Nope' }] }];
    const more = checkReferences(loadGamePacks([pack]), (ref) => ref !== 'fixture:sprites/guide.png');
    expect(more).toContainEqual({ severity: 'error', location: 'label fixture:Orphan #0 message', message: 'unknown texts fixture:Text_Nope' });
    expect(more).toContainEqual({ severity: 'warning', location: 'label fixture:Orphan', message: 'unreachable: no record or reachable label refers to it' });
    expect(more).toContainEqual({ severity: 'error', location: 'sprites fixture:SPRITE_GUIDE atlas', message: 'missing asset fixture:sprites/guide.png' });
  });
});
