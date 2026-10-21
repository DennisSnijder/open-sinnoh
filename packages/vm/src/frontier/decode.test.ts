/** The fr_script decoder on bytes written here (original, not from the ROM): entries, branches, messages, vars. */
import { describe, expect, it } from 'vitest';
import type { Id } from '@opensinnoh/core';
import { FRONTIER_COMMAND_BY_NAME, FRONTIER_SCRIPT_FILES, frontierFileLabelName } from './commands.ts';
import { decodeFrontierFile } from './decode.ts';

/** A tiny assembler: ops by name, u8/u16 operands, `rel` to a label. */
function assemble(code: (string | number | { rel: string } | { label: string })[][]): Uint8Array {
  const out: number[] = [];
  const labels = new Map<string, number>();
  const fixups: { at: number; label: string }[] = [];
  // The entry table: one u32 (relative to the end of the field) and the 0xFD13 terminator.
  out.push(0, 0, 0, 0, 0x13, 0xfd);
  fixups.push({ at: 0, label: 'entry' });
  for (const line of code) {
    if (typeof line[0] === 'object' && 'label' in line[0]) {
      labels.set(line[0].label, out.length);
      continue;
    }
    const spec = FRONTIER_COMMAND_BY_NAME.get(line[0] as string);
    if (!spec) throw new Error(`no ${String(line[0])}`);
    out.push(spec.opcode & 0xff, spec.opcode >> 8);
    spec.operands.forEach((op, i) => {
      const v = line[i + 1]!;
      if (op.type === 'u8') out.push(v as number);
      else if (op.type === 'u16') out.push((v as number) & 0xff, (v as number) >> 8);
      else {
        fixups.push({ at: out.length, label: (v as { rel: string }).rel });
        out.push(0, 0, 0, 0);
      }
    });
  }
  for (const f of fixups) {
    const rel = labels.get(f.label)! - (f.at + 4);
    out[f.at] = rel & 0xff;
    out[f.at + 1] = (rel >> 8) & 0xff;
    out[f.at + 2] = (rel >> 16) & 0xff;
    out[f.at + 3] = (rel >> 24) & 0xff;
  }
  return Uint8Array.from(out);
}

describe('frontier script decoder', () => {
  it('splits labels at branch targets and keeps frontier vars raw, messages as texts of the scene bank', () => {
    const bytes = assemble([
      [{ label: 'entry' }],
      ['fr_add_var', 0x8008, 5],
      ['fr_compare_var_to_value', 0x8008, 5],
      ['fr_go_to_if', 1, { rel: 'yes' }],
      ['fr_exit_frontier'],
      [{ label: 'yes' }],
      ['fr_message', 3],
      ['fr_end'],
    ]);
    const member = FRONTIER_SCRIPT_FILES.findIndex((f) => /battle_tower_corridor$/.test(f));
    const name = frontierFileLabelName(FRONTIER_SCRIPT_FILES[member]!);
    const d = decodeFrontierFile(bytes, { member, textBank: 304, sceneEntry: () => 'platinum:none' as Id, names: { text: (bank, i) => `test:bank${bank}_${i}` as Id } });
    expect(d.entries).toEqual([`platinum:${name}/0`]);
    const labels = Object.entries(d.ir.labels);
    expect(labels).toHaveLength(2);
    const [entry, yes] = labels.map(([, cmds]) => cmds);
    expect(entry!.map((c) => c.op)).toEqual(['fr_add_var', 'fr_compare_var_to_value', 'fr_go_to_if', 'fr_exit_frontier']);
    expect(entry![0]!.args).toEqual([{ kind: 'int', value: 0x8008 }, { kind: 'int', value: 5 }]);
    expect(entry![2]!.args[0]).toEqual({ kind: 'string', value: 'eq' });
    expect(yes![0]).toEqual({ op: 'fr_message', args: [{ kind: 'text', id: 'test:bank304_3' }] });
    expect(d.instructions).toBe(6);
  });
});
