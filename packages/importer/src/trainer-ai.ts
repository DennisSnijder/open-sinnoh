import type { AiScript } from '@opensinnoh/contracts';
import { asId } from '@opensinnoh/core';
import { Reader } from '@opensinnoh/nds';
import type { Names } from './names.ts';

/** Decomp `AI_FLAG_*` names by bit (generated/ai_flags.txt, a mask enum: bit i is the i-th name after NONE). */
export const AI_FLAG_NAMES = [
  'AI_FLAG_BASIC',
  'AI_FLAG_EVAL_ATTACK',
  'AI_FLAG_EXPERT',
  'AI_FLAG_SETUP_FIRST_TURN',
  'AI_FLAG_RISKY',
  'AI_FLAG_PRIORITIZE_EXTREMES',
  'AI_FLAG_BATON_PASS',
  'AI_FLAG_TAG_STRATEGY',
  'AI_FLAG_CHECK_HP',
  'AI_FLAG_WEATHER',
  'AI_FLAG_HARRASSMENT',
  ...Array.from({ length: 18 }, (_, i) => `AI_FLAG_UNUSED_${i + 11}`),
  'AI_FLAG_ROAMING_POKEMON',
  'AI_FLAG_SAFARI',
  'AI_FLAG_CATCH_TUTORIAL',
];

/** The SHA1-checked overlay bytes the AI record is built from. */
export interface TrainerAiTables {
  /** gTrainerAITable: the 32-entry flag table, then the bytecode. */
  script: Uint8Array;
  noDamageCalcEffects: Uint8Array;
  altPowerEffects: Uint8Array;
  weightToPower: Uint8Array;
}

/** u16 list ended by 0xFFFF (decomp trainer_ai.c tables). */
function u16List(bytes: Uint8Array): number[] {
  const r = new Reader(bytes);
  const out: number[] = [];
  for (let o = 0; ; o += 2) {
    const v = r.u16(o);
    if (v === 0xffff) return out;
    out.push(v);
  }
}

/**
 * The trainer AI record. The flag table holds word distances from its own start (decomp `LabelDistance`),
 * so the table and the code are one word array, as the DS reads them (`aiScriptTemp[thinkingBitShift]`).
 */
export function readTrainerAi(t: TrainerAiTables, names: Names): AiScript {
  const r = new Reader(t.script);
  const code = Array.from({ length: t.script.length / 4 }, (_, i) => r.i32(i * 4));
  const flags = AI_FLAG_NAMES.map((name, bit) => ({ name, entry: code[bit]! }));
  const w = new Reader(t.weightToPower);
  const weightToPower: [number, number][] = [];
  for (let o = 0; w.u16(o) !== 0xffff; o += 4) weightToPower.push([w.u16(o), w.u16(o + 2)]);
  return {
    id: asId('platinum:TRAINER_AI'),
    code,
    flags,
    noDamageCalcEffects: u16List(t.noDamageCalcEffects),
    altPowerEffects: u16List(t.altPowerEffects),
    weightToPower,
    battleEffects: names.file.battleEffects.map((_, i) => names.battleEffect(i)),
    holdEffects: names.file.holdEffects.map((n, i) => {
      if (!n) throw new Error(`names: hold effect ${i} has no name`);
      return n.replace(/^HOLD_EFFECT_/, '');
    }),
  };
}
