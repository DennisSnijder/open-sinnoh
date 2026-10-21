/**
 * The SSEQ command set (docs/research/audio.md §2): opcode → argument layout, and a static scan that
 * walks every reachable command of a sequence (the importer's check that a sequence is playable, and
 * whether it loops forever).
 */

export type ArgType = 'u8' | 's8' | 'u16' | 's16' | 'u24' | 'var';

/** Argument layout per command. A note (0x00–0x7F) is velocity u8 + duration varlen. */
export const COMMANDS: Record<number, { name: string; args: ArgType[] }> = {
  0x80: { name: 'wait', args: ['var'] },
  0x81: { name: 'program', args: ['var'] },
  0x93: { name: 'open-track', args: ['u8', 'u24'] },
  0x94: { name: 'jump', args: ['u24'] },
  0x95: { name: 'call', args: ['u24'] },
  0xb0: { name: 'var-set', args: ['u8', 's16'] },
  0xb1: { name: 'var-add', args: ['u8', 's16'] },
  0xb2: { name: 'var-sub', args: ['u8', 's16'] },
  0xb3: { name: 'var-mul', args: ['u8', 's16'] },
  0xb4: { name: 'var-div', args: ['u8', 's16'] },
  0xb5: { name: 'var-shift', args: ['u8', 's16'] },
  0xb6: { name: 'var-rand', args: ['u8', 's16'] },
  0xb8: { name: 'var-eq', args: ['u8', 's16'] },
  0xb9: { name: 'var-ge', args: ['u8', 's16'] },
  0xba: { name: 'var-gt', args: ['u8', 's16'] },
  0xbb: { name: 'var-le', args: ['u8', 's16'] },
  0xbc: { name: 'var-lt', args: ['u8', 's16'] },
  0xbd: { name: 'var-ne', args: ['u8', 's16'] },
  0xc0: { name: 'pan', args: ['u8'] },
  0xc1: { name: 'volume', args: ['u8'] },
  0xc2: { name: 'master-volume', args: ['u8'] },
  0xc3: { name: 'transpose', args: ['s8'] },
  0xc4: { name: 'pitch-bend', args: ['s8'] },
  0xc5: { name: 'bend-range', args: ['u8'] },
  0xc6: { name: 'priority', args: ['u8'] },
  0xc7: { name: 'note-wait', args: ['u8'] },
  0xc8: { name: 'tie', args: ['u8'] },
  0xc9: { name: 'portamento-key', args: ['u8'] },
  0xca: { name: 'mod-depth', args: ['u8'] },
  0xcb: { name: 'mod-speed', args: ['u8'] },
  0xcc: { name: 'mod-type', args: ['u8'] },
  0xcd: { name: 'mod-range', args: ['u8'] },
  0xce: { name: 'portamento', args: ['u8'] },
  0xcf: { name: 'portamento-time', args: ['u8'] },
  0xd0: { name: 'attack', args: ['u8'] },
  0xd1: { name: 'decay', args: ['u8'] },
  0xd2: { name: 'sustain', args: ['u8'] },
  0xd3: { name: 'release', args: ['u8'] },
  0xd4: { name: 'loop-start', args: ['u8'] },
  0xd5: { name: 'expression', args: ['u8'] },
  0xd6: { name: 'print-var', args: ['u8'] },
  0xe0: { name: 'mod-delay', args: ['u16'] },
  0xe1: { name: 'tempo', args: ['u16'] },
  0xe3: { name: 'sweep-pitch', args: ['s16'] },
  0xfc: { name: 'loop-end', args: [] },
  0xfd: { name: 'return', args: [] },
  0xfe: { name: 'allocate-tracks', args: ['u16'] },
  0xff: { name: 'end', args: [] },
};

export const PREFIX_RANDOM = 0xa0;
export const PREFIX_VAR = 0xa1;
export const PREFIX_IF = 0xa2;

const SIZES: Record<Exclude<ArgType, 'var'>, number> = { u8: 1, s8: 1, u16: 2, s16: 2, u24: 3 };

export interface SequenceScan {
  /** Tracks opened by track 0 (track number → start offset), track 0 included. */
  tracks: Map<number, number>;
  /** An unconditional backward jump or an endless loop is reachable: the sequence never ends by itself. */
  loops: boolean;
  /** Commands seen (opcodes; notes as 0x00). */
  opcodes: Set<number>;
}

/** Walks every command reachable from the start; throws on an unknown command or a read past the end. */
export function scanSequence(data: Uint8Array): SequenceScan {
  const seen = new Set<number>();
  const opcodes = new Set<number>();
  const tracks = new Map<number, number>([[0, 0]]);
  let loops = false;
  const work: number[] = [0];
  const byte = (o: number) => {
    const b = data[o];
    if (b === undefined) throw new Error(`sequence: read past the end at 0x${o.toString(16)}`);
    return b;
  };
  const varlen = (o: number) => {
    let n = 0;
    for (let i = 0; i < 4; i++) if ((byte(o + n++) & 0x80) === 0) return n;
    throw new Error(`sequence: variable-length number at 0x${o.toString(16)} is longer than 4 bytes`);
  };
  const u24 = (o: number) => byte(o) | (byte(o + 1) << 8) | (byte(o + 2) << 16);
  while (work.length) {
    let pc = work.pop()!;
    while (!seen.has(pc)) {
      seen.add(pc);
      const at = pc;
      let cmd = byte(pc++);
      let conditional = false;
      let prefix: 'random' | 'var' | null = null;
      for (;;) {
        if (cmd === PREFIX_IF) conditional = true;
        else if (cmd === PREFIX_RANDOM) prefix = 'random';
        else if (cmd === PREFIX_VAR) prefix = 'var';
        else break;
        cmd = byte(pc++);
      }
      const last = (type: ArgType) => {
        if (prefix === 'random') pc += 4;
        else if (prefix === 'var') pc += 1;
        else pc += type === 'var' ? varlen(pc) : SIZES[type];
      };
      if (cmd < 0x80) {
        opcodes.add(0);
        pc += 1;
        last('var');
        continue;
      }
      const spec = COMMANDS[cmd];
      if (!spec) throw new Error(`sequence: unknown command 0x${cmd.toString(16)} at 0x${at.toString(16)}`);
      opcodes.add(cmd);
      const args = spec.args;
      const fixed = args.slice(0, -1);
      const values: number[] = [];
      for (const a of fixed) {
        values.push(a === 'u24' ? u24(pc) : byte(pc));
        pc += a === 'var' ? varlen(pc) : SIZES[a];
      }
      const lastArg = args[args.length - 1];
      let target = -1;
      if (lastArg !== undefined) {
        if (lastArg === 'u24' && prefix === null) target = u24(pc);
        if (cmd === 0xd4 && prefix === null && byte(pc) === 0 && !conditional) loops = true;
        last(lastArg);
      }
      if (cmd === 0x93) {
        const track = values[0]!;
        const start = u24(pc - 3);
        if (track > 15) throw new Error(`sequence: open-track ${track} at 0x${at.toString(16)}`);
        tracks.set(track, start);
        work.push(start);
      } else if (cmd === 0x94) {
        if (target < 0 || target >= data.length) throw new Error(`sequence: jump to 0x${target.toString(16)} at 0x${at.toString(16)}`);
        if (!conditional && target <= at) loops = true;
        work.push(target);
        if (!conditional) break;
      } else if (cmd === 0x95) {
        if (target < 0 || target >= data.length) throw new Error(`sequence: call to 0x${target.toString(16)} at 0x${at.toString(16)}`);
        work.push(target);
      } else if ((cmd === 0xff || cmd === 0xfd) && !conditional) {
        break;
      }
    }
  }
  return { tracks, loops, opcodes };
}
