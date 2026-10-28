import { describe, expect, it } from 'vitest';
import { satisfies } from './versions.ts';
import { parseIR, printIR } from './ir.ts';
import { jsonEqual, parseReplay, parseStateArg, parseStatePath, readStatePath, resolveStateArg, UNTIL_MAX } from './replay.ts';
import { loadPacks, PackError, type PackData } from './packs.ts';

describe('versions', () => {
  it('matches ranges', () => {
    expect(satisfies('1.2.3', '^1.0.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
    expect(satisfies('0.1.5', '^0.1.0')).toBe(true);
    expect(satisfies('0.2.0', '^0.1.0')).toBe(false);
    expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfies('1.0.0', '>=0.5.0 <1.0.0 || 1.0.0')).toBe(true);
    expect(() => satisfies('1.0.0', 'latest')).toThrow();
  });
});

describe('IR', () => {
  const text = `# demo
fixture:GREETING::
  lock_all
  message text(fixture:WELCOME)
  set_var_from_value var(fixture:VISITS), 1
  end

fixture:OTHER::
  go_to label(fixture:GREETING)
`;
  it('round-trips through the printer', () => {
    const ir = parseIR(text);
    expect(ir.labels['fixture:GREETING']).toHaveLength(4);
    expect(parseIR(printIR(ir))).toEqual(ir);
  });
  it('reports line numbers', () => {
    expect(() => parseIR('fixture:A::\n  bad-op 1')).toThrow(/ir:2/);
    expect(() => parseIR('  end')).toThrow(/outside a label/);
  });
});

describe('replay', () => {
  it('parses actions and rejects bad lines', () => {
    const lines = parseReplay('0 press a\n4 touch 10 20 # tap\n4 untouch\n9 assert flag fixture:X true\n9 assert position fixture:ROOM 3 4\n9 assert message closed\n');
    expect(lines.lines.map((l) => l.action.type)).toEqual(['press', 'touch', 'untouch', 'assert', 'assert', 'assert']);
    expect(() => parseReplay('5 press a\n4 press b')).toThrow(/line 2/);
    expect(() => parseReplay('0 press z')).toThrow(/line 1/);
  });

  it('parses text asserts by literal and by text id, page and slot values', () => {
    expect(parseReplay('0 assert text "Hi\\nthere"\n0 assert text fixture:Text_Hi 1 0=3 2=ab\n').lines.map((l) => l.action)).toEqual([
      { type: 'assert', what: 'text', text: 'Hi\nthere' },
      { type: 'assert', what: 'text-id', id: 'fixture:Text_Hi', page: 1, vars: { 0: '3', 2: 'ab' } },
    ]);
    expect(() => parseReplay('0 assert text fixture:Text_Hi x')).toThrow(/line 1/);
    expect(() => parseReplay('0 assert text fixture:Text_Hi 0 var=3')).toThrow(/line 1/);
  });

  it('parses facing asserts for the player and objects', () => {
    expect(parseReplay('0 assert facing player up\n0 assert facing 2 left\n').lines.map((l) => l.action)).toEqual([
      { type: 'assert', what: 'facing', target: 'player', facing: 'up' },
      { type: 'assert', what: 'facing', target: 2, facing: 'left' },
    ]);
    expect(() => parseReplay('0 assert facing player north')).toThrow(/line 1/);
    expect(() => parseReplay('0 assert facing rival up')).toThrow(/line 1/);
  });

  it('parses relative ticks and until idle; absolute ticks after until idle are refused', () => {
    const r = parseReplay('0 press a\n+1 release a\nuntil idle\n+3 press up\n+0 until idle 90\n');
    expect(r.lines.map((l) => [l.at, l.action.type])).toEqual([
      [{ tick: 0 }, 'press'],
      [{ after: 1 }, 'release'],
      [{ after: 0 }, 'until'],
      [{ after: 3 }, 'press'],
      [{ after: 0 }, 'until'],
    ]);
    expect(r.lines[2]!.action).toEqual({ type: 'until', until: { kind: 'idle' }, max: UNTIL_MAX });
    expect(r.lines[4]!.action).toEqual({ type: 'until', until: { kind: 'idle' }, max: 90 });
    expect(() => parseReplay('until idle\n40 press a')).toThrow(/line 2: absolute tick 40 after an "until"/);
    expect(() => parseReplay('advance text\n40 press a')).toThrow(/line 2: absolute tick 40 after an "until"/);
    expect(() => parseReplay('10 press a\n+5 release a\n12 press b')).toThrow(/line 3: tick 12 goes backwards/);
    expect(() => parseReplay('until idle 0')).toThrow(/line 1/);
  });

  it('parses the until conditions, advance text and the battle log asserts', () => {
    const r = parseReplay(
      [
        'until message',
        'until yesno 40',
        'until menu',
        'until choice 5',
        'until position 12 -3',
        'until position 12 30 600',
        'until state vars["fixture:V"] 2',
        'until state player {"x": 1, "z": 2} 90',
        'until state battles [] ',
        'until wild fixture:SPECIES_SKYLET',
        'until wild fixture:SPECIES_SKYLET 900',
        'until wild fixture:SPECIES_SKYLET left right',
        'until wild fixture:SPECIES_SKYLET up down 20000',
        'advance text',
        '+0 advance text 300',
        'advance message',
        '+0 advance message 300',
        '+0 tap word:fixture:Words_Text_Everyone',
        '+0 assert battle trainer fixture:TRAINER_A won',
        '+0 assert battle wild * fled',
        '+0 assert battles scripted 2',
      ].join('\n'),
    );
    expect(r.lines.map((l) => l.action)).toEqual([
      { type: 'until', until: { kind: 'message' }, max: UNTIL_MAX },
      { type: 'until', until: { kind: 'yesno' }, max: 40 },
      { type: 'until', until: { kind: 'menu' }, max: UNTIL_MAX },
      { type: 'until', until: { kind: 'choice' }, max: 5 },
      { type: 'until', until: { kind: 'position', x: 12, z: -3 }, max: UNTIL_MAX },
      { type: 'until', until: { kind: 'position', x: 12, z: 30 }, max: 600 },
      { type: 'until', until: { kind: 'state', path: ['vars', 'fixture:V'], source: 'vars["fixture:V"]', value: 2 }, max: UNTIL_MAX },
      { type: 'until', until: { kind: 'state', path: ['player'], source: 'player', value: { x: 1, z: 2 } }, max: 90 },
      { type: 'until', until: { kind: 'state', path: ['battles'], source: 'battles', value: [] }, max: UNTIL_MAX },
      { type: 'until', until: { kind: 'wild', species: 'fixture:SPECIES_SKYLET' }, max: UNTIL_MAX },
      { type: 'until', until: { kind: 'wild', species: 'fixture:SPECIES_SKYLET' }, max: 900 },
      { type: 'until', until: { kind: 'wild', species: 'fixture:SPECIES_SKYLET', walk: ['left', 'right'] }, max: UNTIL_MAX },
      { type: 'until', until: { kind: 'wild', species: 'fixture:SPECIES_SKYLET', walk: ['up', 'down'] }, max: 20000 },
      { type: 'advance-text', max: UNTIL_MAX },
      { type: 'advance-text', max: 300 },
      { type: 'advance-text', max: UNTIL_MAX, close: true },
      { type: 'advance-text', max: 300, close: true },
      { type: 'tap', id: 'word:fixture:Words_Text_Everyone' },
      { type: 'assert', what: 'battle', kind: 'trainer', match: 'fixture:TRAINER_A', result: 'won' },
      { type: 'assert', what: 'battle', kind: 'wild', match: null, result: 'fled' },
      { type: 'assert', what: 'battles', kind: 'scripted', count: 2 },
    ]);
    for (const bad of ['until talk', 'until message 0', 'until position 1', 'until state vars nope', 'until wild', 'until wild SKYLET', 'until wild fixture:SPECIES_SKYLET left', 'until wild fixture:SPECIES_SKYLET left north', 'advance texts', 'advance message 300 400', 'assert battle gym fixture:A won', 'assert battle trainer fixture:A draw', 'assert battles wild -1']) {
      expect(() => parseReplay(bad), bad).toThrow(/line 1/);
    }
  });

  it('parses doubles battle lines: the acting battler, a move target, a topology assert', () => {
    const r = parseReplay(['+0 battle 1 move 2 target 3', '+0 battle 2 move 1', '+0 battle move 4 target 0', '+0 battle 2 switch 3', '+0 battle 1 run', '+0 battle 1 item fixture:ITEM_TONIC 1', '+0 assert battle trainer fixture:TRAINER_A won ai-partner'].join('\n'));
    expect(r.lines.map((l) => l.action)).toEqual([
      { type: 'battle', choice: { kind: 'move', slot: 1, target: 3, battler: 0 } },
      { type: 'battle', choice: { kind: 'move', slot: 0, battler: 2 } },
      { type: 'battle', choice: { kind: 'move', slot: 3, target: 0 } },
      { type: 'battle', choice: { kind: 'switch', slot: 2, battler: 2 } },
      { type: 'battle', choice: { kind: 'run', battler: 0 } },
      { type: 'battle', choice: { kind: 'item', item: 'fixture:ITEM_TONIC', target: 0, battler: 0 } },
      { type: 'assert', what: 'battle', kind: 'trainer', match: 'fixture:TRAINER_A', result: 'won', topology: 'ai-partner' },
    ]);
    for (const bad of ['+0 battle 3 move 1', '+0 battle 1 move 1 target 4', '+0 battle 1 move 1 at 2', '+0 battle 1 keep', '+0 assert battle trainer fixture:A won quad']) {
      expect(() => parseReplay(bad), bad).toThrow(/line 1/);
    }
  });

  it('parses from, setup lines (before any timed line) and assert state', () => {
    const r = parseReplay(
      [
        '# chained',
        'from cp1.replay',
        'set flag fixture:F true',
        'set var fixture:V 3',
        'give item fixture:ITEM_X',
        'give item fixture:ITEM_Y 2',
        'give badge fixture:BADGE_A',
        'party 0 fixture:SPECIES_A 12 fixture:MOVE_CUT fixture:MOVE_SURF',
        'warp fixture:ROOM 3 4',
        '0 assert state pokedex.obtained true',
        '+2 assert state battles[0].trainers ["fixture:T1", "fixture:T2"]',
        '+0 assert state items["fixture:ITEM_X"] 1',
        '+0 assert state party[1].nickname fixture:Text_Name',
      ].join('\n'),
    );
    expect(r.from).toEqual({ line: 2, file: 'cp1.replay' });
    expect(r.setup.map((s) => s.setup)).toEqual([
      { type: 'flag', id: 'fixture:F', value: true },
      { type: 'var', id: 'fixture:V', value: 3 },
      { type: 'item', id: 'fixture:ITEM_X', count: 1 },
      { type: 'item', id: 'fixture:ITEM_Y', count: 2 },
      { type: 'badge', id: 'fixture:BADGE_A' },
      { type: 'party', slot: 0, species: 'fixture:SPECIES_A', level: 12, moves: ['fixture:MOVE_CUT', 'fixture:MOVE_SURF'] },
      { type: 'warp', zone: 'fixture:ROOM', x: 3, z: 4 },
    ]);
    expect(r.lines.map((l) => l.action)).toEqual([
      { type: 'assert', what: 'state', path: ['pokedex', 'obtained'], source: 'pokedex.obtained', value: true },
      { type: 'assert', what: 'state', path: ['battles', 0, 'trainers'], source: 'battles[0].trainers', value: ['fixture:T1', 'fixture:T2'] },
      { type: 'assert', what: 'state', path: ['items', 'fixture:ITEM_X'], source: 'items["fixture:ITEM_X"]', value: 1 },
      { type: 'assert', what: 'state', path: ['party', 1, 'nickname'], source: 'party[1].nickname', value: null, name: 'fixture:Text_Name' },
    ]);
    expect(() => parseReplay('0 press a\nfrom x.replay')).toThrow(/line 2: "from <replay>" must be the first line/);
    expect(() => parseReplay('0 press a\nwarp fixture:ROOM 1 2')).toThrow(/line 2: setup lines must come before/);
    expect(() => parseReplay('party 0 fixture:A 101')).toThrow(/line 1/);
    expect(() => parseReplay('give item fixture:A 0')).toThrow(/line 1/);
    expect(() => parseReplay('0 assert state badges [oops')).toThrow(/line 1/);
    expect(() => parseReplay('0 assert state .badges []')).toThrow(/line 1/);
  });

  it('parses player and date setup lines and the field move action (0.8)', () => {
    const r = parseReplay(['player cycle 1', 'player cycle', 'player walk', 'date 2024-02-29', '0 field move 2 fixture:MOVE_DEFOG'].join('\n'));
    expect(r.setup.map((s) => s.setup)).toEqual([
      { type: 'player', state: 'cycle', gear: 1 },
      { type: 'player', state: 'cycle', gear: 0 },
      { type: 'player', state: 'walk' },
      { type: 'clock', date: '2024-02-29' },
    ]);
    expect(r.lines.map((l) => l.action)).toEqual([{ type: 'field-move', slot: 2, move: 'fixture:MOVE_DEFOG' }]);
    for (const bad of ['player cycle 2', 'player surf', 'player walk 1', 'date 2023-02-29', 'date 2024-1-01', '0 field move 6 fixture:M', '0 field move 0 DEFOG', '0 field move 0']) {
      expect(() => parseReplay(bad), bad).toThrow(/line 1/);
    }
  });

  it('parses the clock lines: setup and timed (0.14)', () => {
    const r = parseReplay(['date 2024-02-29 21:30', 'time 04:00', '0 time 23:59', '+5 date 2025-01-01', '+1 date 2025-01-01 00:00'].join('\n'));
    expect(r.setup.map((s) => s.setup)).toEqual([
      { type: 'clock', date: '2024-02-29', time: '21:30' },
      { type: 'clock', time: '04:00' },
    ]);
    expect(r.lines.map((l) => l.action)).toEqual([
      { type: 'clock', time: '23:59' },
      { type: 'clock', date: '2025-01-01' },
      { type: 'clock', date: '2025-01-01', time: '00:00' },
    ]);
    for (const bad of ['time 24:00', 'time 9:00', 'time 12:60', 'time', 'date 2024-02-29 25:00', 'date 2024-02-29 12:00 x', '0 time 1200']) {
      expect(() => parseReplay(bad), bad).toThrow(/line 1/);
    }
  });

  it('parses warp with a facing and the reload action', () => {
    const r = parseReplay(['warp fixture:TOWN 3 4 left', 'warp fixture:TOWN 3 4', '0 reload'].join('\n'));
    expect(r.setup.map((s) => s.setup)).toEqual([
      { type: 'warp', zone: 'fixture:TOWN', x: 3, z: 4, facing: 'left' },
      { type: 'warp', zone: 'fixture:TOWN', x: 3, z: 4 },
    ]);
    expect(r.lines.map((l) => l.action)).toEqual([{ type: 'reload' }]);
    for (const bad of ['warp fixture:TOWN 3 4 west', 'warp fixture:TOWN 3 4 up 1', '0 reload now']) expect(() => parseReplay(bad), bad).toThrow(/line 1/);
  });

  it('state arguments: until position takes {path} and {path|k=v,…}, resolved against the state', () => {
    const r = parseReplay('until position {mapFeatures.correctDoor|0=4,1=8,2=12} 4\nuntil position 3 {player.z} 9\n');
    expect(r.lines[0]!.action).toEqual({
      type: 'until',
      until: { kind: 'position', x: 0, z: 4 },
      max: 1800,
      read: { x: { path: ['mapFeatures', 'correctDoor'], source: 'mapFeatures.correctDoor', map: { 0: 4, 1: 8, 2: 12 } } },
    });
    expect(r.lines[1]!.action).toEqual({ type: 'until', until: { kind: 'position', x: 3, z: 0 }, max: 9, read: { z: { path: ['player', 'z'], source: 'player.z' } } });
    for (const bad of ['until position {} 4', 'until position {a|1} 4', 'until position {a|1=2,1=3} 4', 'until position {a..b} 4', 'until state {a} 1']) expect(() => parseReplay(bad), bad).toThrow(/line 1/);
    const arg = parseStateArg('{mapFeatures.correctDoor|0=4,1=8}')!;
    expect(resolveStateArg(arg, { mapFeatures: { correctDoor: 1 } })).toBe(8);
    expect(resolveStateArg(parseStateArg('{a[1]}')!, { a: [0, 7] })).toBe(7);
    expect(() => resolveStateArg(arg, { mapFeatures: null })).toThrow(/\{mapFeatures.correctDoor\}: no such state/);
    expect(() => resolveStateArg(arg, { mapFeatures: { correctDoor: '1' } })).toThrow(/not a number: "1"/);
    expect(() => resolveStateArg(arg, { mapFeatures: { correctDoor: 2 } })).toThrow(/2 is not one of 0, 1/);
  });

  it('state paths: ids as keys, indexes, quoted keys; JSON equality ignores key order', () => {
    expect(parseStatePath('items.platinum:ITEM_PARCEL')).toEqual(['items', 'platinum:ITEM_PARCEL']);
    expect(parseStatePath('a[1]["b.c"].d')).toEqual(['a', 1, 'b.c', 'd']);
    expect(parseStatePath('a..b')).toBeNull();
    expect(parseStatePath('[0]')).toBeNull();
    expect(readStatePath({ a: [{ b: 2 }] }, ['a', 0, 'b'])).toBe(2);
    expect(readStatePath({ a: 1 }, ['a', 'b'])).toBeUndefined();
    // `[field=value]` picks the first array element with that field.
    expect(parseStatePath('objects[localId=24].x')).toEqual(['objects', { field: 'localId', equals: 24 }, 'x']);
    expect(parseStatePath('battles[kind="wild"]')).toEqual(['battles', { field: 'kind', equals: 'wild' }]);
    const objects = { objects: [{ localId: 3, x: 1 }, { localId: 24, x: 182 }, { localId: 24, x: 9 }] };
    expect(readStatePath(objects, ['objects', { field: 'localId', equals: 24 }, 'x'])).toBe(182);
    expect(readStatePath(objects, ['objects', { field: 'localId', equals: 5 }, 'x'])).toBeUndefined();
    expect(readStatePath({ objects: {} }, ['objects', { field: 'localId', equals: 24 }])).toBeUndefined();
    expect(jsonEqual({ a: 1, b: [1, { c: null }] }, { b: [1, { c: null }], a: 1 })).toBe(true);
    expect(jsonEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(false);
  });
});

function pack(id: string, extra: Partial<PackData> = {}, deps: Record<string, string> = {}): PackData {
  return {
    manifest: { id, name: id, version: '0.1.0', engine: '^0.1.0', dependencies: deps, loadAfter: [] },
    registries: {},
    scripts: { labels: {} },
    patches: [],
    remove: [],
    provenance: 'original',
    ...extra,
  };
}

describe('packs', () => {
  const base = pack('base', {
    registries: { species: [{ id: 'base:MOSS', name: 'Moss', hp: 40 }] },
    scripts: parseIR('base:HELLO::\n  end\n'),
  });
  const mod = pack(
    'mod',
    {
      patches: [{ registry: 'species', id: 'base:MOSS', operations: [{ op: 'replace', path: '/name', value: 'Fern' }] }],
      scripts: parseIR('base:HELLO::\n  nop\n  end\n'),
    },
    { base: '^0.1.0' },
  );
  const noValidate = () => {};

  it('patches and overrides, and disabling restores vanilla', () => {
    const withMod = loadPacks([mod, base], '0.1.0', noValidate);
    expect(withMod.order.map((p) => p.id)).toEqual(['base', 'mod']);
    expect(withMod.registries.species?.get('base:MOSS')?.name).toBe('Fern');
    expect(withMod.overrides).toEqual([{ label: 'base:HELLO', previousPack: 'base', pack: 'mod' }]);
    const vanilla = loadPacks([base], '0.1.0', noValidate);
    expect(vanilla.registries.species?.get('base:MOSS')?.name).toBe('Moss');
    expect(base.registries.species?.[0]?.name).toBe('Moss');
  });

  it('fails loudly on missing deps, bad patches and invalid records', () => {
    expect(() => loadPacks([mod], '0.1.0', noValidate)).toThrow(/missing pack base/);
    const bad = pack('bad', { patches: [{ registry: 'species', id: 'base:NOPE', operations: [] }] }, { base: '*' });
    expect(() => loadPacks([base, bad], '0.1.0', noValidate)).toThrow(PackError);
    expect(() =>
      loadPacks([base], '0.1.0', () => {
        throw new Error('hp too low');
      }),
    ).toThrow(/species base:MOSS: hp too low/);
    expect(() => loadPacks([base], '0.2.0', noValidate)).toThrow(/needs engine/);
  });
});
