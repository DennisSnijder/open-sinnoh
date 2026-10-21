import { describe, expect, it } from 'vitest';
import { readAreaLight, templateAt } from './formats/area-light.ts';
import { readCameraTable } from './formats/camera.ts';
import { readObjectGfxTable, readScriptEntryOffsets, readTrainerHeader, readTrainerMessages, readTrainerParty } from './formats/data.ts';
import { readCommonMart, readEggMoves, readEvolutions, readGrowthTable, readItem, readItemList, readLearnset, readMove, readNatureAffinities, readPersonal } from './formats/pokemon.ts';
import { readEncounters } from './formats/encounters.ts';
import { readZoneEvents } from './formats/events.ts';
import { readInitScripts } from './formats/init-scripts.ts';
import { readAreaData, readBdhc, readLandData, readMapMatrix } from './formats/map.ts';
import { decodeText, packCompressed, unpackCompressed } from './formats/text.ts';
import { readZoneHeaders } from './formats/zone-headers.ts';
import { Names, type NamesFile } from './names.ts';

/** Little-endian byte writer for original fixtures. */
class W {
  private out: number[] = [];
  u8(...v: number[]) {
    for (const x of v) this.out.push(x & 0xff);
    return this;
  }
  u16(...v: number[]) {
    for (const x of v) this.u8(x, x >> 8);
    return this;
  }
  u32(...v: number[]) {
    for (const x of v) this.u16(x & 0xffff, (x >>> 16) & 0xffff);
    return this;
  }
  fx(...v: number[]) {
    return this.u32(...v.map((x) => Math.round(x * 4096) >>> 0));
  }
  ascii(s: string) {
    return this.u8(...[...s].map((c) => c.charCodeAt(0)));
  }
  bytes(b: Uint8Array) {
    return this.u8(...b);
  }
  get length() {
    return this.out.length;
  }
  done() {
    return new Uint8Array(this.out);
  }
}

describe('zone headers', () => {
  it('reads fields and the packed flag word', () => {
    const rec = new W().u8(20, 3).u16(129, 1056, 986, 558, 1000, 1001, 0xffff, 394).u8(7, 2, 1, 4).u16(4 | (5 << 7) | 0x2000 | 0x8000);
    const [z] = readZoneHeaders(new W().bytes(rec.done()).bytes(rec.done()).done(), 2);
    expect(z).toMatchObject({ area: 20, matrix: 129, scripts: 1056, initScripts: 986, textBank: 558, encounters: null, events: 394, camera: 4, mapType: 4, battleBg: 5, bike: false, running: true, fly: true });
    expect(() => readZoneHeaders(rec.done(), 2)).toThrow(/expected 48/);
  });
});

describe('maps', () => {
  it('reads a matrix with zone and altitude sections', () => {
    const m = readMapMatrix(new W().u8(2, 1, 1, 1, 3).ascii('abc').u16(7, 8).u8(0, 5).u16(12, 0xffff).done());
    expect(m).toEqual({ width: 2, height: 1, name: 'abc', zones: [7, 8], altitudes: [0, 5], chunks: [12, null] });
    expect(() => readMapMatrix(new W().u8(1, 1, 0, 0, 0).u16(1, 2).done())).toThrow(/trailing/);
  });

  const bdhc = () =>
    new W()
      .ascii('BDHC')
      .u16(2, 1, 1, 1, 1, 1)
      .fx(-256, -256, 256, 256)
      .fx(0, 1, 0)
      .fx(-8)
      .u16(0, 1, 0, 0)
      .fx(-256)
      .u16(1, 0)
      .u16(0)
      .done();

  it('reads BDHC terrain and rejects bad indexes', () => {
    expect(readBdhc(bdhc())).toEqual({
      points: [
        [-256, -256],
        [256, 256],
      ],
      normals: [[0, 1, 0]],
      constants: [-8],
      plates: [{ p1: 0, p2: 1, normal: 0, constant: 0 }],
      strips: [{ z: -256, count: 1, start: 0 }],
      accessList: [0],
    });
    const bad = bdhc();
    bad[bad.length - 2] = 3; // access list → plate 3
    expect(() => readBdhc(bad)).toThrow(/access list/);
  });

  it('splits land data into tiles, props, model and terrain', () => {
    const model = new W().ascii('BMD0').u32(0).done();
    const prop = new W().u32(5).fx(16, 0, -32).fx(0, 0, 0).fx(1, 1, 1).u32(0, 0).done();
    const terrain = bdhc();
    const w = new W().u32(0x800, 48, model.length, terrain.length);
    for (let i = 0; i < 1024; i++) w.u16(i === 33 ? 0x8001 : 0);
    const land = readLandData(w.bytes(prop).bytes(model).bytes(terrain).done());
    expect(land.tiles[33]).toBe(0x8001);
    expect(land.props).toEqual([{ model: 5, position: [16, 0, -32], rotation: [0, 0, 0], scale: [1, 1, 1] }]);
    expect(land.model.length).toBe(8);
    expect(land.terrain.plates).toHaveLength(1);
  });

  it('reads area data', () => {
    expect(readAreaData(new W().u16(16, 20, 3, 1).done())).toEqual({ propSet: 16, mapTextureSet: 20, light: 1 });
  });
});

describe('zone events', () => {
  it('reads the four sections', () => {
    const w = new W()
      .u32(1)
      .u16(1, 0)
      .u32(5, 4, 0)
      .u16(4, 0)
      .u32(1)
      .u16(0, 148, 16, 0, 371, 0, 2, 0, 0, 0, 0, 0, 10, 4)
      .fx(0)
      .u32(1)
      .u16(8, 4, 414, 1)
      .u32(0)
      .u32(1)
      .u16(7, 4, 5, 1, 1, 0, 0, 0x40a5);
    const ev = readZoneEvents(w.done());
    expect(ev.bgs).toEqual([{ script: 1, type: 0, x: 5, z: 4, y: 0, facing: 4 }]);
    expect(ev.objects[0]).toMatchObject({ localId: 0, gfx: 148, hiddenFlag: 371, dir: 2, x: 10, z: 4 });
    expect(ev.warps).toEqual([{ x: 8, z: 4, destZone: 414, destWarp: 1 }]);
    expect(ev.coords).toEqual([{ script: 7, x: 4, z: 5, width: 1, length: 1, y: 0, value: 0, var: 0x40a5 }]);
    expect(() => readZoneEvents(new W().u32(2).done())).toThrow(/outside/);
  });
});

describe('init scripts', () => {
  it('reads fixed entries and the frame table', () => {
    // type 2 (transition) script 5; type 1 frame table at end-of-field + 1 (after the end byte); table; pad
    const bytes = new W().u8(2).u16(5, 0).u8(1).u32(1).u8(0).u16(0x40f9, 0, 3, 0).u8(0).done();
    expect(readInitScripts(bytes)).toEqual({ onTransition: 5, onFrame: [{ var: 0x40f9, value: 0, script: 3 }] });
    expect(() => readInitScripts(new W().u8(9).done())).toThrow(/unknown entry type 9/);
  });
});

describe('camera table', () => {
  it('converts binary angles, fx32 and projection', () => {
    const w = new W().fx(512).u16(0xd602, 0, 0, 0).u8(1, 0).u16(0x0280).fx(150, 1735);
    const [c] = readCameraTable(w.done(), 1);
    expect(c?.distance).toBe(512);
    expect(c?.angle[0]).toBeCloseTo(-59.05, 2);
    expect(c?.projection).toBe('orthographic');
    expect(c?.fovYHalf).toBeCloseTo(3.516, 3);
    expect(c?.far).toBe(1735);
  });
});

describe('text', () => {
  const chars = new Map([
    [0x0121, 'A'],
    [0x0122, 'B'],
    [0x01de, ' '],
    [0x0101, '{'],
  ]);
  it('maps chars and control codes to OpenSinnoh markup', () => {
    const codes = [0x121, 0xe000, 0x122, 0x25bc, 0xfffe, 0x0103, 2, 0, 0, 0xfffe, 0xff00, 1, 3, 0x101, 0x25bd, 0xfffe, 0x0207, 0, 0xffff];
    expect(decodeText(codes, chars)).toBe('A\nB{clear}{var 0}{color 3}{{{scroll}{raw 0207}');
    const stats = { unknownChars: new Map<number, number>() };
    expect(decodeText([0x999, 0xffff], chars, stats)).toBe('{raw 0999}');
    expect(stats.unknownChars.get(0x999)).toBe(1);
    expect(() => decodeText([0x121], chars)).toThrow(/missing end/);
    expect(() => decodeText([0xfffe, 0xff00, 5, 0xffff], chars)).toThrow(/past the end/);
  });
  it('round-trips compressed (0xF100) strings', () => {
    for (const s of [[0x121], [0x121, 0x122, 0x1de, 0x121, 0x122], [1, 2, 3, 4, 5]]) {
      const packed = packCompressed(s);
      expect(unpackCompressed([...packed, 0xffff], 1)).toEqual(s);
    }
    expect(decodeText([...packCompressed([0x121, 0x1de, 0x122]), 0xffff], chars)).toBe('A B');
    // When the packed chars fill whole units, the 0xFFFF end code supplies the terminator.
    const whole = packCompressed([1, 2, 3, 4, 5]); // 45 bits = 3 whole units, then the terminator unit
    expect(whole).toHaveLength(5);
    expect(unpackCompressed([...whole.slice(0, 4), 0xffff], 1)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('small ROM tables', () => {
  it('reads script entry offsets up to 0xFD13 or the first code byte', () => {
    expect(readScriptEntryOffsets(new W().u32(6, 2).u16(0xfd13).u16(2).u16(2).done())).toEqual([10, 10]);
    expect(readScriptEntryOffsets(new W().u32(0).u16(2).done())).toEqual([4]);
    expect(() => readScriptEntryOffsets(new W().u32(100).done())).toThrow(/outside/);
  });
  it('reads trainers and the object gfx table', () => {
    const header = readTrainerHeader(new W().u8(1, 63, 0, 1).u16(17, 0, 0, 0).u32(7, 2).done());
    expect(header).toEqual({ monDataType: 1, trainerClass: 63, partySize: 1, items: [17, 0, 0, 0], aiMask: 7, battleType: 2 });
    // trtbl: trainer 4 has types 0 and 2 (entries 1, 2); trainer 7 has type 1 (entry 3); trainer 5 none.
    const trtbl = new W().u16(1, 0, 4, 0, 4, 2, 7, 1).done();
    const trtblofs = new W().u16(0, 0, 0, 0, 4, 0, 0, 12).done();
    expect([...readTrainerMessages(trtbl, trtblofs, 4)]).toEqual([
      [0, 1],
      [2, 2],
    ]);
    expect([...readTrainerMessages(trtbl, trtblofs, 7)]).toEqual([[1, 3]]);
    expect(readTrainerMessages(trtbl, trtblofs, 5).size).toBe(0);
    expect(readTrainerParty(new W().u16(30, 5, 390 | (1 << 10), 1, 2, 3, 0, 9).done(), header)).toEqual([{ ivScale: 30, level: 5, species: 390, form: 1, moves: [1, 2, 3, 0], ballSeal: 9 }]);
    const withItem = { ...header, monDataType: 3, partySize: 2 };
    const party = readTrainerParty(new W().u16(0, 7, 1, 44, 33, 0, 0, 0, 0).u16(255, 9, 2, 0, 10, 11, 12, 13, 0).done(), withItem);
    expect(party.map((m) => [m.ivScale, m.level, m.species, m.item, m.moves])).toEqual([
      [0, 7, 1, 44, [33, 0, 0, 0]],
      [255, 9, 2, 0, [10, 11, 12, 13]],
    ]);
    expect([...readObjectGfxTable(new W().u32(0, 90, 97, 91, 0xffff, 0).done())]).toEqual([
      [0, 90],
      [97, 91],
    ]);
  });
});

describe('encounters', () => {
  it('reads a 424-byte pl_enc_data member', () => {
    const w = new W().u32(20);
    for (let i = 0; i < 12; i++) w.u8(2 + i, 0, 0, 0).u32(10 + i);
    w.u32(30, 31, 32, 0, 0, 34, 40, 41, 42, 43); // swarm, day, night, radar
    w.u32(0, 0, 0, 0, 0, 0); // form rates, Unown table
    w.u32(50, 51, 0, 0, 0, 0, 0, 0, 0, 0); // dual slots
    for (const rate of [10, 0, 25, 50, 75]) {
      w.u32(rate);
      for (let i = 0; i < 5; i++) w.u8(30 + i, 20 + i, 0, 0).u32(rate ? 100 + rate + i : 0);
    }
    const e = readEncounters(w.done());
    expect(e.landRate).toBe(20);
    expect(e.land[11]).toEqual({ species: 21, minLevel: 13, maxLevel: 13 });
    expect(e.replacements).toMatchObject({ swarm: [30, 31], day: [32, 0], night: [0, 34], radar: [40, 41, 42, 43], dualSlotRuby: [50, 51] });
    expect(e.surf.slots[4]).toEqual({ species: 114, minLevel: 24, maxLevel: 34 });
    expect([e.oldRod.rate, e.goodRod.rate, e.superRod.rate]).toEqual([25, 50, 75]);
    expect(e.superRod.slots[0]!.species).toBe(175);
    expect(() => readEncounters(new Uint8Array(420))).toThrow(/expected 424/);
  });
});

describe('names', () => {
  const file: NamesFile = {
    source: 'test',
    zones: ['MAP_HEADER_A'],
    cameras: [],
    weathers: [[14, ['OVERWORLD_WEATHER_FOG']]],
    pockets: [],
    species: [null, 'SPECIES_X'],
    items: [],
    trainers: [],
    trainerClasses: [],
    trainerMessageTypes: [],
    encounters: [],
    tileBehaviors: [],
    movementActions: [],
    objectGfx: [],
    flags: [[1, ['FLAG_ONE', 'FLAG_TWO']]],
    vars: [[0x4000, ['VAR_A']]],
    scriptRanges: [
      { base: 2000, file: 1, bank: 0 },
      { base: 9600, file: 2, bank: 0 },
    ],
    textBanks: [{ bank: 'TEXT_BANK_T', prefix: 'T_Text_', messages: ['Hi', null] }],
    scripts: [
      { file: 'scripts_a', prefix: 'A_', entries: ['Talk', null] },
      { file: 'scripts_common', prefix: '', entries: ['CommonScript_X'] },
      { file: 'scripts_init_new_game', prefix: '', entries: ['InitNewGame'] },
    ],
    moves: [null, 'MOVE_A'],
    abilities: [],
    natures: [],
    types: [],
    eggGroups: [],
    expRates: [],
    evolutionMethods: [],
    moveClasses: [],
    moveRanges: [],
    moveFlags: [],
    battleEffects: [],
    holdEffects: [],
    martSpecialties: [],
    dataForms: [],
  };
  const n = new Names(file);
  it('uses decomp names and falls back to kind/index', () => {
    expect([n.zone(0), n.zone(3), n.flag(2), n.flag(9), n.var(0x4000), n.species(0), n.species(1)]).toEqual([
      'platinum:MAP_HEADER_A',
      'platinum:zone/3',
      'platinum:FLAG_TWO',
      'platinum:flag/9',
      'platinum:VAR_A',
      'platinum:species/0',
      'platinum:SPECIES_X',
    ]);
    expect([n.text(0, 0), n.text(0, 1)]).toEqual(['platinum:T_Text_Hi', 'platinum:text/0/1']);
    expect([n.weather(14), n.weather(24)]).toEqual(['platinum:OVERWORLD_WEATHER_FOG', 'platinum:weather/24']);
  });
  it('resolves script ids by range', () => {
    expect(n.scriptLabel(0, 0)).toBeUndefined();
    expect(n.scriptLabel(1, 0)).toBe('platinum:A_Talk');
    expect(n.scriptLabel(2, 0)).toBe('platinum:scripts_a/1');
    expect(n.scriptLabel(2000, 0)).toBe('platinum:CommonScript_X');
    expect(n.scriptLabel(9600, 0)).toBe('platinum:InitNewGame');
    expect(n.scriptRef(9601, 0)).toEqual({ file: 2, entry: 1 });
  });
});

describe('area light (original data)', () => {
  const template = (end: number, sun: number) =>
    [`${end},`, `1,${sun},${sun},9,100,-4000,9000,`, '0,0,0,0,0,0,0,', '1,3,5,7,0,0,4096,', '0,9,9,9,0,0,0,', '20,21,22,', '5,6,7,', '1,2,3,', '0,0,31,', ''].join('\r\n');
  const file = new TextEncoder().encode([template(3000, 10), template(30000, 20), template(43200, 30), 'EOF'].join('\r\n'));
  it('parses templates, clamps directions and marks off lights', () => {
    const ts = readAreaLight(file);
    expect(ts.map((t) => t.endTime)).toEqual([3000, 30000, 43200]);
    expect(ts[1]).toEqual({
      endTime: 30000,
      lights: [{ color: [20, 20, 9], direction: [100, -4000, 4096] }, null, { color: [3, 5, 7], direction: [0, 0, 4096] }, null],
      diffuse: [20, 21, 22],
      ambient: [5, 6, 7],
      specular: [1, 2, 3],
      emission: [0, 0, 31],
    });
  });
  it('picks the template active at a time of day', () => {
    const ts = readAreaLight(file);
    expect(templateAt(ts, 0).endTime).toBe(3000);
    expect(templateAt(ts, 12 * 3600).endTime).toBe(30000);
    expect(templateAt(ts, 23 * 3600).endTime).toBe(43200);
    expect(templateAt(ts.slice(0, 1), 12 * 3600).endTime).toBe(3000);
  });
  it('rejects a file without EOF', () => {
    expect(() => readAreaLight(new TextEncoder().encode(template(1, 1)))).toThrow(/area light/);
  });
});

describe('Pokémon data formats (synthetic bytes)', () => {
  it('reads a 44-byte personal member: stats, types, EV yield bits, abilities and TM bits', () => {
    const w = new W().u8(45, 49, 49, 45, 65, 65, 12, 3, 45, 64).u16(0b01_00_00_00_00_10).u16(10, 11).u8(31, 20, 70, 3, 1, 7, 65, 0, 0, 0x83).u16(0);
    w.u32(1 | (1 << 31), 0, 1 << 3, 0);
    const p = readPersonal(w.done(), 100);
    expect(p.baseStats).toEqual([45, 49, 49, 45, 65, 65]);
    expect(p.types).toEqual([12, 3]);
    expect(p.evYield).toEqual([2, 0, 0, 0, 0, 1]);
    expect(p.heldItems).toEqual([10, 11]);
    expect([p.genderRatio, p.hatchCycles, p.baseFriendship, p.expRate]).toEqual([31, 20, 70, 3]);
    expect([p.eggGroups, p.abilities, p.color, p.flip]).toEqual([[1, 7], [65, 0], 3, true]);
    expect(p.tms).toEqual([0, 31, 67]);
    expect(() => readPersonal(w.done(), 60)).toThrow(/TM\/HM bit 67/);
    expect(() => readPersonal(new Uint8Array(40), 100)).toThrow(/expected 44/);
  });

  it('reads evolutions, learnsets and growth tables', () => {
    const evo = new W().u16(4, 16, 2, 7, 82, 3);
    for (let i = 0; i < 5; i++) evo.u16(0, 0, 0);
    expect(readEvolutions(evo.u16(0).done())).toEqual([
      { method: 4, param: 16, target: 2 },
      { method: 7, param: 82, target: 3 },
    ]);
    expect(readLearnset(new W().u16((1 << 9) | 33, (13 << 9) | 77, 0xffff, 0).done())).toEqual([
      { level: 1, move: 33 },
      { level: 13, move: 77 },
    ]);
    const growth = readGrowthTable(new W().u32(...Array.from({ length: 101 }, (_, l) => l ** 3)).done());
    expect([growth[0], growth[10], growth[100]]).toEqual([0, 1000, 1000000]);
  });

  it('reads a move, an item with a party use, egg moves, natures and marts', () => {
    expect(readMove(new W().u16(257).u8(1, 95, 11, 100, 15, 0).u16(8).u8(0xff, 0b110010, 17, 1, 0, 0).done())).toEqual({
      effect: 257,
      class: 1,
      power: 95,
      type: 11,
      accuracy: 100,
      pp: 15,
      effectChance: 0,
      range: 8,
      priority: -1,
      flags: 0b110010,
      contest: { effect: 17, type: 1 },
    });
    // Price 300, hold effect 0 (param 20), fling 30, natural gift power 0 / type 31, field pocket 1, battle pocket 4,
    // field use 1, battle use 2, party use: heal sleep + hp restore, attack +2, hp EV -10, 20 HP, friendship 1/2/3.
    const item = new W().u16(300).u8(0, 20, 0, 0, 30, 0).u16(31 | (1 << 7) | (4 << 11)).u8(1, 2, 1, 0);
    item.u8(0b0000_0001, 2 << 4, 0, 0, 0, 0b0000_0100, 0).u8(0xf6, 0, 0, 0, 0, 0, 20, 0, 1, 2, 3, 0, 0);
    const it = readItem(item.done());
    expect([it.price, it.holdParam, it.flingPower, it.naturalGiftType, it.pocket, it.battlePocket, it.fieldUse, it.battleUse]).toEqual([300, 20, 30, 31, 1, 4, 1, 2]);
    expect(it.partyUse).toEqual({ flags: ['healSleep', 'hpRestore'], stages: { attack: 2 }, evs: [-10, 0, 0, 0, 0, 0], hp: 20, pp: 0, friendship: [1, 2, 3] });
    expect(readItem(new Uint8Array(34)).partyUse).toBeUndefined();
    expect([...readEggMoves(new W().u16(20001, 5, 6, 20004, 7, 0xffff).done())]).toEqual([
      [1, [5, 6]],
      [4, [7]],
    ]);
    expect(() => readEggMoves(new W().u16(5, 0xffff).done())).toThrow(/before the first species/);
    expect(readNatureAffinities(new Uint8Array([0, 0, 0, 0, 0, 1, 0xff, 0, 0, 0]), 2)).toEqual([
      [0, 0, 0, 0, 0],
      [1, -1, 0, 0, 0],
    ]);
    expect(readCommonMart(new W().u16(4, 1, 3, 3).done())).toEqual([
      { item: 4, level: 1 },
      { item: 3, level: 3 },
    ]);
    expect(readItemList(new W().u16(9, 1, 2, 0xffff).done(), 2)).toEqual([1, 2]);
  });
});
