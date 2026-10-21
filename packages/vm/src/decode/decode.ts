/**
 * scr_seq bytecode → Script IR (docs/research/scripts-and-opening.md §1–2, docs/contracts.md).
 *
 * Script file: u32 rel[n] (entry i = 4i + 4 + rel[i]), optional u16 0xFD13, then code and movement data.
 * The decoder walks code by recursive descent from the entry points. Every entry and every branch target
 * becomes an IR label; straight-line code that runs into another label ends with a synthetic `go_to`.
 *
 * Label ids: entries use `names.entry` or `platinum:<FileName>/<i>` (i = 0-based entry index); internal
 * targets are `platinum:<FileName>/off_<hex>` (file offset). Movement lists are `platinum:<FileName>/mv_<hex>`.
 */
import type { Arg, Command, Id, ScriptIR } from '@opensinnoh/core';
import type { Movement } from '@opensinnoh/contracts';
import { COMMANDS, CONDITIONS, DUMMY_SCRIPT, LOCAL_BANK_OPS, MOVEMENT_ACTIONS, SCRIPT_FILES, SCRIPT_RANGES, fileLabelName, memberKind, type CommandSpec } from '../commands.ts';

/** Readable names (the importer's names table). Every function may return undefined → positional fallback. */
export interface ScriptNames {
  /** `file` is the decomp file name (`scripts_twinleaf_town`), `index` the 0-based entry index. */
  entry?(file: string, index: number): Id | undefined;
  text?(bank: number, index: number): Id | undefined;
  flag?(flag: number): Id | undefined;
  var?(varId: number): Id | undefined;
  /**
   * The entry label of a Battle Frontier scene's script (FRONTIER_SCENE_*): `launch_battle_frontier_scene` gets it as a
   * trailing `label(...)` arg, so the frontier's scripts are reachable from the field (coverage, overrides).
   */
  frontierScene?(scene: number): Id | undefined;
}

export const fallbackNames = {
  entry: (file: string, index: number): Id => `platinum:${fileLabelName(file)}/${index}`,
  text: (bank: number, index: number): Id => `platinum:text/${bank}/${index}`,
  flag: (flag: number): Id => `platinum:flag/${flag}`,
  var: (varId: number): Id => `platinum:var/${varId}`,
};

export class ScriptDecodeError extends Error {}

export interface DecodedFile {
  ir: ScriptIR;
  movements: Movement[];
  /** Labels of the entries, in table order. */
  entries: Id[];
  instructions: number;
  /** Opcode → number of decoded instructions. */
  opcodes: Map<number, number>;
}

interface Ctx {
  member: number;
  file: string;
  textBank: number | null;
  /** True for the current map's file (script ids 1–1999 resolve into it). */
  isMapFile: boolean;
  names: ScriptNames;
}

const u8 = (b: Uint8Array, o: number) => {
  if (o >= b.length) throw new ScriptDecodeError(`read past end at 0x${o.toString(16)}`);
  return b[o]!;
};
const u16 = (b: Uint8Array, o: number) => u8(b, o) | (u8(b, o + 1) << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
const s32 = (b: Uint8Array, o: number) => u32(b, o) | 0;
const hex = (n: number) => n.toString(16);

/** Entry offsets of a script file (stops at 0xFD13 or the lowest entry target, whichever comes first). */
export function scriptEntries(bytes: Uint8Array): number[] {
  const out: number[] = [];
  let lowest = bytes.length;
  for (let o = 0; o + 4 <= lowest; o += 4) {
    if (u16(bytes, o) === 0xfd13) break;
    const target = o + 4 + s32(bytes, o);
    if (target < 0 || target >= bytes.length) throw new ScriptDecodeError(`entry ${out.length} points outside the file (0x${hex(target)})`);
    out.push(target);
    lowest = Math.min(lowest, target);
  }
  return out;
}

/** Resolves a global script id to (file, entry index, text bank). Id 1–1999 needs the map file. */
export function resolveScriptId(id: number, mapMember: number | null): { member: number; entry: number; textBank: number | null } {
  if (id === 0) return { member: DUMMY_SCRIPT.member, entry: 0, textBank: DUMMY_SCRIPT.textBank };
  for (const r of SCRIPT_RANGES) if (id >= r.base) return { member: r.member, entry: id - r.base, textBank: r.textBank };
  if (mapMember === null) throw new ScriptDecodeError(`script id ${id} needs a map file`);
  return { member: mapMember, entry: id - 1, textBank: null };
}

function scriptLabel(id: number, ctx: Ctx): Id {
  const r = resolveScriptId(id, ctx.isMapFile ? ctx.member : null);
  const file = SCRIPT_FILES[r.member]!;
  return ctx.names.entry?.(file, r.entry) ?? fallbackNames.entry(file, r.entry);
}

const varRef = (v: number, ctx: Ctx): Arg => ({ kind: 'var', id: ctx.names.var?.(v) ?? fallbackNames.var(v) });

interface Raw {
  spec: CommandSpec;
  offset: number;
  next: number;
  /** Decoded operand values; rel operands hold the absolute target. */
  values: { type: string; kind?: string; value: number }[];
}

function decodeAt(bytes: Uint8Array, offset: number): Raw {
  const opcode = u16(bytes, offset);
  const spec = COMMANDS[opcode];
  if (!spec) throw new ScriptDecodeError(`unknown opcode 0x${hex(opcode)} at 0x${hex(offset)}`);
  let o = offset + 2;
  const values: Raw['values'] = [];
  const read = (type: 'u8' | 'u16' | 'u32' | 'rel', kind?: string) => {
    let value: number;
    if (type === 'u8') value = u8(bytes, o++);
    else if (type === 'u16') {
      value = u16(bytes, o);
      o += 2;
    } else if (type === 'u32') {
      value = u32(bytes, o);
      o += 4;
    } else {
      value = o + 4 + s32(bytes, o);
      o += 4;
      if (value < 0 || value >= bytes.length) throw new ScriptDecodeError(`${spec.name} at 0x${hex(offset)}: target 0x${hex(value)} outside the file`);
    }
    values.push({ type, ...(kind ? { kind } : {}), value });
    return value;
  };
  for (const op of spec.operands) read(op.type, op.kind);
  if (spec.variable) {
    const first = values[0]!.value;
    const extra =
      spec.variable === 'field_move'
        ? first === 2
          ? 1
          : 0
        : spec.variable === 'group_connection'
          ? first <= 3
            ? 2
            : first <= 5
              ? 1
              : 0
          : spec.variable === 'tv_broadcast'
            ? [1, 3, 0, 3, 2, 3, 1][first] ?? 0
            : first >= 1 && first <= 3
              ? 1
              : first === 5 || first === 6
                ? 2
                : 0;
    // Mystery Gift's extras are destination vars too (decomp MysteryGiftGive destVar1ID, destVar2ID).
    for (let i = 0; i < extra; i++) read('u16', spec.variable === 'field_move' || spec.variable === 'mystery_gift' ? 'var' : undefined);
  }
  return { spec, offset, next: o, values };
}

const TERMINATORS = new Set(['end', 'go_to', 'return']);
const BRANCHES = new Set(['go_to', 'call', 'go_to_if', 'call_if', 'go_to_if_target_trainer_defeated', 'unused_017', 'unused_018', 'unused_019']);

/** Decodes one script file (a member of scr_seq that holds code, not a level-script table). */
export function decodeScriptFile(bytes: Uint8Array, opts: { member: number; textBank: number | null; isMapFile: boolean; names?: ScriptNames }): DecodedFile {
  const file = SCRIPT_FILES[opts.member];
  if (file === undefined) throw new ScriptDecodeError(`no scr_seq member ${opts.member}`);
  const ctx: Ctx = { member: opts.member, file, textBank: opts.textBank, isMapFile: opts.isMapFile, names: opts.names ?? {} };
  const where = (o: number) => `${file} @0x${hex(o)}`;
  const fname = fileLabelName(file);
  const entryOffsets = scriptEntries(bytes);
  const entries = entryOffsets.map((_, i) => ctx.names.entry?.(file, i) ?? fallbackNames.entry(file, i));

  // Pass 1: discover label starts and movement lists.
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
      raw.values.forEach((v) => {
        if (v.type !== 'rel') return;
        if (raw.spec.name === 'apply_movement') movementOffsets.add(v.value);
        else if (BRANCHES.has(raw.spec.name)) {
          if (!starts.has(v.value)) {
            starts.add(v.value);
            work.push(v.value);
          }
        } else throw new ScriptDecodeError(`${where(o)}: unexpected pointer operand in ${raw.spec.name}`);
      });
      if (TERMINATORS.has(raw.spec.name)) break;
      o = raw.next;
    }
  }

  const labelAt = new Map<number, Id>();
  entryOffsets.forEach((o, i) => labelAt.has(o) || labelAt.set(o, entries[i]!));
  for (const o of [...starts].sort((a, b) => a - b)) if (!labelAt.has(o)) labelAt.set(o, `platinum:${fname}/off_${hex(o)}`);
  const movementId = (o: number): Id => `platinum:${fname}/mv_${hex(o)}`;

  const toArgs = (raw: Raw): Arg[] => {
    const args = operandArgs(raw);
    // The script's own text bank, for commands that pick its messages by a runtime number.
    if (LOCAL_BANK_OPS.has(raw.spec.name) && ctx.textBank !== null) args.push({ kind: 'int', value: ctx.textBank });
    if (raw.spec.name === 'launch_battle_frontier_scene' && ctx.names.frontierScene) {
      const label = ctx.names.frontierScene(raw.values[0]!.value);
      if (!label) throw new ScriptDecodeError(`${where(raw.offset)}: launch_battle_frontier_scene of scene ${raw.values[0]!.value}, which has no script`);
      args.push({ kind: 'label', id: label });
    }
    return args;
  };
  const operandArgs = (raw: Raw): Arg[] =>
    raw.values.map((v, i): Arg => {
      const name = raw.spec.name;
      if (v.type === 'rel') return name === 'apply_movement' ? { kind: 'movement', id: movementId(v.value) } : { kind: 'label', id: labelAt.get(v.value)! };
      if (i === 0 && (name === 'go_to_if' || name === 'call_if')) {
        const c = CONDITIONS[v.value];
        if (!c) throw new ScriptDecodeError(`${where(raw.offset)}: bad condition ${v.value}`);
        return { kind: 'string', value: c };
      }
      if (name === 'call_common_script') return { kind: 'label', id: scriptLabel(v.value, ctx) };
      if (v.kind === 'msg') {
        // A map file no map header uses has no known bank.
        if (ctx.textBank === null) return { kind: 'text', id: `platinum:${fname}/msg_${v.value}` };
        return { kind: 'text', id: ctx.names.text?.(ctx.textBank, v.value) ?? fallbackNames.text(ctx.textBank, v.value) };
      }
      if (v.kind === 'flag') return { kind: 'flag', id: ctx.names.flag?.(v.value) ?? fallbackNames.flag(v.value) };
      if ((v.kind === 'var' || v.kind === 'vov') && v.value >= 0x4000) return varRef(v.value, ctx);
      return { kind: 'int', value: v.value };
    });

  // Pass 2: emit labels as straight-line runs.
  const labels: Record<Id, Command[]> = {};
  const opcodes = new Map<number, number>();
  for (const [start, id] of [...labelAt].sort((a, b) => a[0] - b[0])) {
    const cmds: Command[] = [];
    let o = start;
    for (;;) {
      if (o !== start && labelAt.has(o)) {
        cmds.push({ op: 'go_to', args: [{ kind: 'label', id: labelAt.get(o)! }] });
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
  // Entries that share an offset with an earlier entry jump to it.
  entryOffsets.forEach((o, i) => {
    const id = entries[i]!;
    if (labelAt.get(o) !== id) labels[id] = [{ op: 'go_to', args: [{ kind: 'label', id: labelAt.get(o)! }] }];
  });

  const movements = [...movementOffsets].sort((a, b) => a - b).map((o) => ({ id: movementId(o), steps: decodeMovement(bytes, o, where(o)) }));
  return { ir: { labels }, movements, entries, instructions: [...opcodes.values()].reduce((a, b) => a + b, 0), opcodes };
}

/** Movement list: {u16 action, u16 count} until action 0xFE. */
export function decodeMovement(bytes: Uint8Array, offset: number, where = `@0x${hex(offset)}`): Movement['steps'] {
  const steps: Movement['steps'] = [];
  for (let o = offset; ; o += 4) {
    const action = u16(bytes, o);
    if (action === 0xfe) return steps;
    const op = MOVEMENT_ACTIONS[action];
    if (!op) throw new ScriptDecodeError(`${where}: unknown movement action ${action}`);
    steps.push({ op, count: u16(bytes, o + 2) });
  }
}

/** Level-script table, script ids resolved against the map's script file. */
export interface DecodedInitScripts {
  onLoad?: Id;
  onTransition?: Id;
  onResume?: Id;
  /** `value` is a literal or (rarely) a var compared by value. */
  onFrame: { var: Id; value: number | { var: Id }; label: Id }[];
}

export function decodeInitScripts(bytes: Uint8Array, mapMember: number, names: ScriptNames = {}): DecodedInitScripts {
  const ctx: Ctx = { member: mapMember, file: SCRIPT_FILES[mapMember]!, textBank: null, isMapFile: true, names };
  const out: DecodedInitScripts = { onFrame: [] };
  const fixed = { 2: 'onTransition', 3: 'onResume', 4: 'onLoad' } as const;
  for (let o = 0; ; o += 5) {
    const type = u8(bytes, o);
    if (type === 0) break;
    if (type === 1) {
      let t = o + 5 + s32(bytes, o + 1);
      // The engine ends the table when the row's first byte is 0 (so also on a var whose low byte is 0).
      while (u8(bytes, t) !== 0 && u16(bytes, t) !== 0) {
        const v = u16(bytes, t);
        const cmp = u16(bytes, t + 2);
        out.onFrame.push({
          var: names.var?.(v) ?? fallbackNames.var(v),
          value: cmp >= 0x4000 ? { var: names.var?.(cmp) ?? fallbackNames.var(cmp) } : cmp,
          label: scriptLabel(u16(bytes, t + 4), ctx),
        });
        t += 6;
      }
    } else if (type in fixed) {
      // The engine takes the first entry of each type.
      const key = fixed[type as 2 | 3 | 4];
      out[key] ??= scriptLabel(u16(bytes, o + 1), ctx);
    } else throw new ScriptDecodeError(`init scripts of ${ctx.file}: bad entry type ${type} at ${o}`);
  }
  return out;
}

export interface DecodeAllInput {
  /** All scr_seq members. */
  members: readonly Uint8Array[];
  /** scr_seq member → text bank of the map scripts that use it (from map headers). */
  mapTextBanks: ReadonlyMap<number, number>;
  names?: ScriptNames;
}

export interface DecodeAllResult {
  ir: ScriptIR;
  movements: Movement[];
  files: number;
  instructions: number;
  opcodes: Map<number, number>;
}

/**
 * Decodes every script-file member (map files with their map bank, global files with their range bank).
 * Level-script members are skipped here; decode them per map with `decodeInitScripts`.
 */
export function decodeScripts(input: DecodeAllInput): DecodeAllResult {
  const globalBanks = new Map<number, number>([[DUMMY_SCRIPT.member, DUMMY_SCRIPT.textBank], ...SCRIPT_RANGES.map((r) => [r.member, r.textBank] as const)]);
  const labels: Record<Id, Command[]> = {};
  const movements: Movement[] = [];
  const opcodes = new Map<number, number>();
  let files = 0;
  let instructions = 0;
  input.members.forEach((bytes, member) => {
    if (memberKind(member) !== 'script') return;
    const isMapFile = !globalBanks.has(member);
    const textBank = globalBanks.get(member) ?? input.mapTextBanks.get(member) ?? null;
    const d = decodeScriptFile(bytes, { member, textBank, isMapFile, ...(input.names ? { names: input.names } : {}) });
    for (const [id, cmds] of Object.entries(d.ir.labels)) {
      if (labels[id as Id]) throw new ScriptDecodeError(`duplicate label ${id}`);
      labels[id as Id] = cmds;
    }
    movements.push(...d.movements);
    for (const [k, n] of d.opcodes) opcodes.set(k, (opcodes.get(k) ?? 0) + n);
    files++;
    instructions += d.instructions;
  });
  return { ir: { labels }, movements, files, instructions, opcodes };
}
