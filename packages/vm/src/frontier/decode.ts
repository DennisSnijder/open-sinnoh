/**
 * fr_script bytecode → Script IR (decomp overlay104 frontier_script_context.c, frscrcmd.c). The file layout is the
 * field's (u32 rel entries, 0xFD13), the opcodes are the frontier's own table (`frontier-commands.json`), and the IR
 * is the field's: labels of straight-line command runs, `label(...)` branch targets, `movement(...)` lists.
 *
 * - Ops are the frontier's names (`fr_message`, `fr_call_battle_tower_function`, `fr_cmd_22`).
 * - Operands that the decomp reads with FrontierScriptContext_GetVar or TryGetVarPointer stay raw ints: the frontier's
 *   vars are 0x8000–0x8013 of the running frontier (contexts and the script manager), resolved at run time as the decomp
 *   does. System vars (Set/GetSystemVar) are field vars, `var(...)`; messages are `text(...)` of the scene's bank.
 * - The inline tables of FrontierScrCmd_22/24/2A/2C are flattened into the command's int args, row after row, without
 *   their 0xFD13 terminator (actor rows of a link player's graphics, 0xEEEF, carry one more byte).
 * - `fr_change_script scene, entry` gets the target scene's entry label as a third arg (`sceneEntry`).
 *
 * Label ids: `platinum:<FileLabel>/<i>` for entries, `/off_<hex>` for other targets, `/mv_<hex>` for movements, where
 * FileLabel is `frontierFileLabelName(file)`.
 */
import type { Arg, Command, Id, ScriptIR } from '@opensinnoh/core';
import type { Movement } from '@opensinnoh/contracts';
import { CONDITIONS } from '../commands.ts';
import { scriptEntries, ScriptDecodeError } from '../decode/decode.ts';
import { FRONTIER_COMMANDS, FRONTIER_MOVEMENT_ACTIONS, FRONTIER_SCRIPT_FILES, FRONTIER_TABLE, frontierFileLabelName, type FrontierCommandSpec } from './commands.ts';

export interface FrontierDecodeNames {
  text?(bank: number, index: number): Id | undefined;
  var?(varId: number): Id | undefined;
}

export interface DecodedFrontierFile {
  ir: ScriptIR;
  movements: Movement[];
  entries: Id[];
  instructions: number;
  opcodes: Map<number, number>;
}

const u8 = (b: Uint8Array, o: number) => {
  if (o >= b.length) throw new ScriptDecodeError(`read past end at 0x${o.toString(16)}`);
  return b[o]!;
};
const u16 = (b: Uint8Array, o: number) => u8(b, o) | (u8(b, o + 1) << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
const s32 = (b: Uint8Array, o: number) => u32(b, o) | 0;
const hex = (n: number) => n.toString(16);

interface Raw {
  spec: FrontierCommandSpec;
  offset: number;
  next: number;
  values: { type: string; kind?: string; value: number }[];
}

function decodeAt(bytes: Uint8Array, offset: number): Raw {
  const opcode = u16(bytes, offset);
  const spec = FRONTIER_COMMANDS[opcode];
  if (!spec) throw new ScriptDecodeError(`unknown frontier opcode 0x${hex(opcode)} at 0x${hex(offset)}`);
  let o = offset + 2;
  const values: Raw['values'] = [];
  for (const op of spec.operands) {
    let value: number;
    if (op.type === 'u8') value = u8(bytes, o++);
    else if (op.type === 'u16') {
      value = u16(bytes, o);
      o += 2;
    } else if (op.type === 'u32') {
      value = u32(bytes, o);
      o += 4;
    } else {
      value = o + 4 + s32(bytes, o);
      o += 4;
      if (value < 0 || value >= bytes.length) throw new ScriptDecodeError(`${spec.name} at 0x${hex(offset)}: target 0x${hex(value)} outside the file`);
    }
    values.push({ type: op.type, ...(op.kind ? { kind: op.kind } : {}), value });
  }
  return { spec, offset, next: o, values };
}

/** An inline table's rows, flattened (decomp FrontierScrCmd_22/24/2A/2C read them until a 0xFD13 first field). */
export function decodeFrontierTable(bytes: Uint8Array, offset: number, kind: NonNullable<FrontierCommandSpec['table']>): number[] {
  const out: number[] = [];
  let o = offset;
  const half = () => {
    const v = u16(bytes, o);
    o += 2;
    return v;
  };
  const byte = () => u8(bytes, o++);
  for (;;) {
    const first = half();
    if (first === FRONTIER_TABLE.end) return out;
    if (kind === 'objects') out.push(first, byte());
    else if (kind === 'actors') {
      const gfx = half();
      out.push(first, gfx, byte(), half(), half(), byte(), byte());
      if (gfx === FRONTIER_TABLE.linkPlayers) out.push(byte());
    } else if (kind === 'sprite-resources') out.push(first);
    else out.push(first, half(), half(), half(), byte(), byte());
  }
}

/** Movement list: {u16 action, u16 count} until 0xFD13 (decomp FrontierAnimCmd). */
export function decodeFrontierMovement(bytes: Uint8Array, offset: number, where: string): Movement['steps'] {
  const steps: Movement['steps'] = [];
  for (let o = offset; ; o += 4) {
    const action = u16(bytes, o);
    if (action === FRONTIER_TABLE.end) return steps;
    const name = FRONTIER_MOVEMENT_ACTIONS[action];
    if (!name) throw new ScriptDecodeError(`${where}: unknown frontier movement action ${action}`);
    steps.push({ op: `fr_${name}`, count: u16(bytes, o + 2) });
  }
}

const TERMINATORS = new Set(['fr_end', 'fr_exit_frontier', 'fr_go_to', 'fr_return', 'fr_change_script']);
const BRANCHES = new Set(['fr_go_to', 'fr_go_to_if', 'fr_call', 'fr_call_if']);

/** Decodes one fr_script member with its scene's text bank. `sceneEntry` labels a ChangeScript target. */
export function decodeFrontierFile(bytes: Uint8Array, opts: { member: number; textBank: number; sceneEntry: (scene: number, entry: number) => Id; names?: FrontierDecodeNames }): DecodedFrontierFile {
  const file = FRONTIER_SCRIPT_FILES[opts.member];
  if (file === undefined) throw new ScriptDecodeError(`no fr_script member ${opts.member}`);
  const names = opts.names ?? {};
  const where = (o: number) => `${file} @0x${hex(o)}`;
  const fname = frontierFileLabelName(file);
  const entryOffsets = scriptEntries(bytes);
  const entries = entryOffsets.map((_, i): Id => `platinum:${fname}/${i}`);

  const starts = new Set(entryOffsets);
  const movementOffsets = new Set<number>();
  const decoded = new Map<number, Raw>();
  const work = [...entryOffsets];
  while (work.length) {
    let o = work.pop()!;
    for (;;) {
      if (decoded.has(o)) break;
      let raw: Raw;
      try {
        raw = decodeAt(bytes, o);
      } catch (e) {
        throw new ScriptDecodeError(`${where(o)}: ${(e as Error).message}`);
      }
      decoded.set(o, raw);
      for (const v of raw.values) {
        if (v.type !== 'rel') continue;
        if (v.kind === 'movement') movementOffsets.add(v.value);
        else if (v.kind === 'code' && BRANCHES.has(raw.spec.name)) {
          if (!starts.has(v.value)) {
            starts.add(v.value);
            work.push(v.value);
          }
        } else if (v.kind !== 'table') throw new ScriptDecodeError(`${where(o)}: unexpected pointer operand in ${raw.spec.name}`);
      }
      if (TERMINATORS.has(raw.spec.name)) break;
      o = raw.next;
    }
  }

  const labelAt = new Map<number, Id>();
  entryOffsets.forEach((o, i) => labelAt.has(o) || labelAt.set(o, entries[i]!));
  for (const o of [...starts].sort((a, b) => a - b)) if (!labelAt.has(o)) labelAt.set(o, `platinum:${fname}/off_${hex(o)}`);
  const movementId = (o: number): Id => `platinum:${fname}/mv_${hex(o)}`;

  const toArgs = (raw: Raw): Arg[] => {
    const name = raw.spec.name;
    const args: Arg[] = [];
    raw.values.forEach((v, i) => {
      if (v.type === 'rel') {
        if (v.kind === 'movement') args.push({ kind: 'movement', id: movementId(v.value) });
        else if (v.kind === 'table') for (const n of decodeFrontierTable(bytes, v.value, raw.spec.table!)) args.push({ kind: 'int', value: n });
        else args.push({ kind: 'label', id: labelAt.get(v.value)! });
        return;
      }
      if (i === 0 && (name === 'fr_go_to_if' || name === 'fr_call_if')) {
        const c = CONDITIONS[v.value];
        if (!c) throw new ScriptDecodeError(`${where(raw.offset)}: bad condition ${v.value}`);
        args.push({ kind: 'string', value: c });
        return;
      }
      if (v.kind === 'msg') {
        args.push({ kind: 'text', id: names.text?.(opts.textBank, v.value) ?? `platinum:text/${opts.textBank}/${v.value}` });
        return;
      }
      if (v.kind === 'sysvar') {
        args.push({ kind: 'var', id: names.var?.(v.value) ?? `platinum:var/${v.value}` });
        return;
      }
      args.push({ kind: 'int', value: v.value });
    });
    if (name === 'fr_change_script') {
      const [scene, entry] = raw.values.map((v) => v.value) as [number, number];
      if (scene >= 0x8000 || entry >= 0x8000) throw new ScriptDecodeError(`${where(raw.offset)}: fr_change_script by a var`);
      args.push({ kind: 'label', id: opts.sceneEntry(scene, entry) });
    }
    return args;
  };

  const labels: Record<Id, Command[]> = {};
  const opcodes = new Map<number, number>();
  for (const [start, id] of [...labelAt].sort((a, b) => a[0] - b[0])) {
    const cmds: Command[] = [];
    let o = start;
    for (;;) {
      if (o !== start && labelAt.has(o)) {
        cmds.push({ op: 'fr_go_to', args: [{ kind: 'label', id: labelAt.get(o)! }] });
        break;
      }
      const raw = decoded.get(o) ?? decodeAt(bytes, o);
      opcodes.set(raw.spec.opcode, (opcodes.get(raw.spec.opcode) ?? 0) + 1);
      cmds.push({ op: raw.spec.name, args: toArgs(raw) });
      if (TERMINATORS.has(raw.spec.name)) break;
      o = raw.next;
    }
    labels[id] = cmds;
  }
  entryOffsets.forEach((o, i) => {
    const id = entries[i]!;
    if (labelAt.get(o) !== id) labels[id] = [{ op: 'fr_go_to', args: [{ kind: 'label', id: labelAt.get(o)! }] }];
  });
  const movements = [...movementOffsets].sort((a, b) => a - b).map((o) => ({ id: movementId(o), steps: decodeFrontierMovement(bytes, o, where(o)) }));
  return { ir: { labels }, movements, entries, instructions: [...opcodes.values()].reduce((a, b) => a + b, 0), opcodes };
}

/** One row of the scene table the decoder needs: the scene's script file and text bank. */
export interface FrontierSceneScript {
  member: number;
  textBank: number;
}

/**
 * Decodes the fr_script members the scenes use (each with its scene's bank; a member two scenes share must have one
 * bank). Members no scene uses (the unused binaries) are skipped.
 */
export function decodeFrontierScripts(input: { members: readonly Uint8Array[]; scenes: readonly (FrontierSceneScript | null)[]; names?: FrontierDecodeNames }): { ir: ScriptIR; movements: Movement[]; files: number; instructions: number; opcodes: Map<number, number> } {
  const banks = new Map<number, number>();
  input.scenes.forEach((s, i) => {
    if (!s) return;
    const prev = banks.get(s.member);
    if (prev !== undefined && prev !== s.textBank) throw new ScriptDecodeError(`fr_script member ${s.member}: scene ${i} reads bank ${s.textBank}, another scene ${prev}`);
    banks.set(s.member, s.textBank);
  });
  const sceneEntry = (scene: number, entry: number): Id => {
    const s = input.scenes[scene];
    if (!s) throw new ScriptDecodeError(`ChangeScript to scene ${scene}, which has no script`);
    return `platinum:${frontierFileLabelName(FRONTIER_SCRIPT_FILES[s.member]!)}/${entry}`;
  };
  const labels: Record<Id, Command[]> = {};
  const movements: Movement[] = [];
  const opcodes = new Map<number, number>();
  let files = 0;
  let instructions = 0;
  for (const [member, textBank] of [...banks].sort((a, b) => a[0] - b[0])) {
    const bytes = input.members[member];
    if (!bytes) throw new ScriptDecodeError(`fr_script has no member ${member}`);
    const d = decodeFrontierFile(bytes, { member, textBank, sceneEntry, ...(input.names ? { names: input.names } : {}) });
    for (const [id, cmds] of Object.entries(d.ir.labels)) {
      if (labels[id as Id]) throw new ScriptDecodeError(`duplicate label ${id}`);
      labels[id as Id] = cmds;
    }
    movements.push(...d.movements);
    for (const [k, n] of d.opcodes) opcodes.set(k, (opcodes.get(k) ?? 0) + n);
    files++;
    instructions += d.instructions;
  }
  return { ir: { labels }, movements, files, instructions, opcodes };
}
