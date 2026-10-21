/**
 * A tiny assembler for synthetic AI scripts in tests (our own bytes; no ROM code). Same layout as the
 * ROM: a 32-word flag table, then the code. Jumps and tables take label names.
 */
import type { AiScript } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { OP, OPCODES, type OpName } from '../opcodes.ts';

type Operand = number | string;

export class Asm {
  private readonly words: (number | { label: string; kind: 'j' | 't'; end: number })[] = [];
  private readonly labels = new Map<string, number>();
  private readonly flagLabels: (string | null)[] = Array(32).fill(null);

  constructor() {
    for (let i = 0; i < 32; i++) this.words.push(0);
  }

  /** Bit `bit`'s routine starts at `label`; unset flags point at an implicit `PopOrEnd`. */
  flag(bit: number, label: string): this {
    this.flagLabels[bit] = label;
    return this;
  }

  label(name: string): this {
    if (this.labels.has(name)) throw new Error(`asm: label ${name} twice`);
    this.labels.set(name, this.words.length);
    return this;
  }

  op(name: OpName, ...operands: Operand[]): this {
    const spec = OPCODES[OP[name]]!;
    if (operands.length !== spec.args.length) throw new Error(`asm: ${name} takes ${spec.args.length} operands`);
    const end = this.words.length + 1 + operands.length;
    this.words.push(OP[name]);
    [...spec.args].forEach((kind, k) => {
      const v = operands[k]!;
      if (kind === 'v') {
        if (typeof v !== 'number') throw new Error(`asm: ${name} operand ${k} must be a number`);
        this.words.push(v);
      } else {
        if (typeof v !== 'string') throw new Error(`asm: ${name} operand ${k} must be a label`);
        this.words.push({ label: v, kind: kind as 'j' | 't', end: kind === 'j' ? this.words.length + 1 : end });
      }
    });
    return this;
  }

  /** A table of values ended by TABLE_END (-1). */
  table(name: string, values: number[]): this {
    this.label(name);
    for (const v of values) this.words.push(v);
    this.words.push(-1);
    return this;
  }

  build(): AiScript {
    this.label('__end');
    this.words.push(OP.PopOrEnd);
    const at = (l: string) => {
      const w = this.labels.get(l);
      if (w === undefined) throw new Error(`asm: no label ${l}`);
      return w;
    };
    this.flagLabels.forEach((l, bit) => (this.words[bit] = at(l ?? '__end')));
    const code = this.words.map((w) => (typeof w === 'number' ? w : at(w.label) - w.end));
    return {
      id: 'test:TRAINER_AI' as Id,
      code,
      flags: this.flagLabels.map((_, bit) => ({ name: `AI_FLAG_TEST_${bit}`, entry: code[bit]! })),
      noDamageCalcEffects: [7],
      altPowerEffects: [41],
      weightToPower: [
        [100, 20],
        [250, 40],
        [500, 60],
        [1000, 80],
        [2000, 100],
      ],
      battleEffects: [],
      holdEffects: [],
    };
  }
}
