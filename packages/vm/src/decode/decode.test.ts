import { describe, expect, it } from 'vitest';
import { parseIR, printIR } from '@opensinnoh/core';
import { decodeInitScripts, decodeScriptFile, resolveScriptId, scriptEntries } from './decode.ts';
import { COMMAND_BY_NAME, SCRIPT_FILES } from '../commands.ts';

/** Tiny assembler for synthetic bytecode (our own writer; no ROM bytes). */
class Asm {
  bytes: number[] = [];
  private fixups: { at: number; label: string }[] = [];
  labels = new Map<string, number>();
  label(name: string) {
    this.labels.set(name, this.bytes.length);
    return this;
  }
  u8(v: number) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v: number) {
    return this.u8(v).u8(v >> 8);
  }
  rel(label: string) {
    this.fixups.push({ at: this.bytes.length, label });
    return this.u16(0).u16(0);
  }
  op(name: string) {
    const c = COMMAND_BY_NAME.get(name);
    if (!c) throw new Error(name);
    return this.u16(c.opcode);
  }
  build(): Uint8Array {
    const out = new Uint8Array(this.bytes);
    const v = new DataView(out.buffer);
    for (const f of this.fixups) v.setInt32(f.at, this.labels.get(f.label)! - (f.at + 4), true);
    return out;
  }
}

const MEMBER = SCRIPT_FILES.indexOf('scripts_twinleaf_town');

describe('decodeScriptFile (synthetic)', () => {
  const a = new Asm()
    .rel('A')
    .rel('B')
    .rel('A') // a second entry sharing the first entry's code
    .u16(0xfd13)
    .label('A')
    .op('set_var_from_value').u16(0x4000).u16(1)
    .op('compare_var_to_value').u16(0x4000).u16(1)
    .op('go_to_if').u8(1).rel('C')
    .op('message').u8(3)
    .label('D')
    .op('add_var').u16(0x8000).u16(0x4001) // var-or-value ≥ 0x4000 → var
    .op('add_var').u16(0x8000).u16(5) // literal
    .op('end')
    .label('B')
    .op('call_common_script').u16(2003)
    .op('set_flag').u16(371)
    .op('apply_movement').u16(0xff).rel('MV')
    .op('end')
    .label('C')
    .op('call').rel('D')
    .op('go_to').rel('B')
    .u16(0) // padding
    .label('MV')
    .u16(3).u16(1) // face_east
    .u16(15).u16(2) // walk_normal_east ×2
    .u16(0xfe).u16(0);
  const bytes = a.build();
  const d = decodeScriptFile(bytes, { member: MEMBER, textBank: 554, isMapFile: true });

  it('reads the entry table up to 0xFD13', () => {
    expect(scriptEntries(bytes)).toEqual([a.labels.get('A'), a.labels.get('B'), a.labels.get('A')]);
  });

  it('produces labels, refs and movements', () => {
    expect(printIR(d.ir)).toBe(
      [
        'platinum:TwinleafTown/0::',
        '  set_var_from_value var(platinum:var/16384), 1',
        '  compare_var_to_value var(platinum:var/16384), 1',
        '  go_to_if "eq", label(platinum:TwinleafTown/off_44)',
        '  message text(platinum:text/554/3)',
        '  go_to label(platinum:TwinleafTown/off_24)',
        '',
        'platinum:TwinleafTown/off_24::',
        '  add_var var(platinum:var/32768), var(platinum:var/16385)',
        '  add_var var(platinum:var/32768), 5',
        '  end',
        '',
        'platinum:TwinleafTown/1::',
        '  call_common_script label(platinum:Common/3)',
        '  set_flag flag(platinum:flag/371)',
        '  apply_movement 255, movement(platinum:TwinleafTown/mv_52)',
        '  end',
        '',
        'platinum:TwinleafTown/off_44::',
        '  call label(platinum:TwinleafTown/off_24)',
        '  go_to label(platinum:TwinleafTown/1)',
        '',
        'platinum:TwinleafTown/2::',
        '  go_to label(platinum:TwinleafTown/0)',
        '',
      ].join('\n'),
    );
    expect(d.movements).toEqual([{ id: 'platinum:TwinleafTown/mv_52', steps: [{ op: 'face_east', count: 1 }, { op: 'walk_normal_east', count: 2 }] }]);
    expect(parseIR(printIR(d.ir))).toEqual(d.ir);
  });

  it('uses names when given', () => {
    const named = decodeScriptFile(bytes, {
      member: MEMBER,
      textBank: 554,
      isMapFile: true,
      names: { entry: (f, i) => (f === 'scripts_twinleaf_town' && i === 0 ? 'platinum:TwinleafTown_Start' : undefined), var: (v) => (v === 0x4000 ? 'platinum:VAR_MAP_LOCAL_0' : undefined) },
    });
    expect(Object.keys(named.ir.labels)[0]).toBe('platinum:TwinleafTown_Start');
    expect(named.ir.labels['platinum:TwinleafTown_Start']![0]!.args[0]).toEqual({ kind: 'var', id: 'platinum:VAR_MAP_LOCAL_0' });
  });

  it('fails loudly on bad bytes', () => {
    expect(() => decodeScriptFile(new Uint8Array([0, 0, 0, 0, 0xff, 0xff]), { member: MEMBER, textBank: 1, isMapFile: true })).toThrow(/unknown opcode/);
  });
});

describe('script ids and level scripts', () => {
  it('resolves global ranges', () => {
    expect(resolveScriptId(2003, null)).toMatchObject({ member: SCRIPT_FILES.indexOf('scripts_common'), entry: 3, textBank: 213 });
    expect(resolveScriptId(9700, null)).toMatchObject({ member: SCRIPT_FILES.indexOf('scripts_follower_partners'), entry: 0 });
    expect(resolveScriptId(5, MEMBER)).toEqual({ member: MEMBER, entry: 4, textBank: null });
    expect(() => resolveScriptId(5, null)).toThrow();
  });

  it('decodes an init table (fixed entries + frame table, first-byte-zero terminator)', () => {
    const a = new Asm()
      .u8(2).u16(1).u16(0) // ON_TRANSITION → script 1
      .u8(1).rel('T') // ON_FRAME_TABLE
      .u8(4).u16(3).u16(0) // ON_LOAD → script 3
      .u8(0)
      .label('T')
      .u16(0x40f9).u16(0).u16(3)
      .u16(0x40a5).u16(0x4001).u16(7)
      .u16(0x4100).u16(0).u16(9) // low byte 0: the engine stops here
      .u16(0);
    const d = decodeInitScripts(a.build(), MEMBER);
    expect(d).toEqual({
      onTransition: 'platinum:TwinleafTown/0',
      onLoad: 'platinum:TwinleafTown/2',
      onFrame: [
        { var: 'platinum:var/16633', value: 0, label: 'platinum:TwinleafTown/2' },
        { var: 'platinum:var/16549', value: { var: 'platinum:var/16385' }, label: 'platinum:TwinleafTown/6' },
      ],
    });
  });
});
