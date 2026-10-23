/**
 * The acting round's tables (docs/research/contests.md §7), read from the ROM's code: arm9 Unk_020F568C (per contest
 * effect: the move menu's two lines, the base appeal and the outcome lines per variant) and overlay 17's
 * Unk_ov17_02253AF8 (effect classes), Unk_ov17_022539C8 (the voltage by contest and move type),
 * sActingCompetitionMessages, Unk_ov17_02253C30 (the NPC AI's rules) and Unk_ov17_022534B8 (the move buttons'
 * palettes). Strictly checked: a value out of its range fails the import.
 */
import { CONTEST_TYPES, type ContestActingMessage, type ContestActingTables, type ContestAiRule, type ContestEffect } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { Reader } from '@opensinnoh/nds';

/** CONTEST_EFFECT_MAX. */
export const CONTEST_EFFECTS = 24;
/** UnkStruct_020F568C: u16 line one, u16 line two, s8 appeal, then five {u16 message, u8 argument mode}. */
export const EFFECT_SIZE = 26;
/** UnkStruct_ov17_02253AF8: a handler pointer, u8 class, u8 unk_05, two pad bytes. */
export const EFFECT_CLASS_SIZE = 8;
/** ACTING_COMPETITION_MESSAGE_MAX; each {u16 message, u8 argument mode, u8 instant}. */
export const ACTING_MESSAGES = 47;
/** Unk_ov17_02253C30: {u8 slot, u8 condition, u8 target, s8 judge mode, s16 weights[4]}. */
export const AI_RULES = 165;
export const AI_RULE_SIZE = 12;
/** The AI's conditions (Unk_ov17_02253BBC: index 0 is NULL). */
const AI_CONDITIONS = 29;
/** The argument modes ov17_0224290C knows (0–28). */
const ARG_MODES = 29;
/** The move buttons' palettes: five of 16 BGR555 colours. */
export const BUTTON_PALETTES = 5;
const NONE = 0xffff;

export interface ActingTableBytes {
  effects: Uint8Array;
  classes: Uint8Array;
  typeMatch: Uint8Array;
  messages: Uint8Array;
  rules: Uint8Array;
  palettes: Uint8Array;
}

export interface ActingContext {
  /** TEXT_BANK_CONTEST_EFFECTS, TEXT_BANK_CONTEST_ACTING_COMPETITION and TEXT_BANK_CONTEST_TEXT message ids, with their counts. */
  effectText: (n: number) => Id;
  outcomeText: (n: number) => Id;
  contestText: (n: number) => Id;
  counts: { effects: number; outcomes: number; contest: number };
}

const s8 = (b: number) => (b << 24) >> 24;

export function readActingTables(b: ActingTableBytes, ctx: ActingContext): ContestActingTables {
  const text = (n: number, count: number, of: (n: number) => Id, what: string): Id => {
    if (n >= count) throw new Error(`contest acting: ${what} message ${n} is past the bank's ${count}`);
    return of(n);
  };
  const args = (a: number, what: string): number => {
    if (a >= ARG_MODES) throw new Error(`contest acting: ${what} argument mode ${a}`);
    return a;
  };
  const er = new Reader(b.effects);
  const cr = new Reader(b.classes);
  const effects = Array.from({ length: CONTEST_EFFECTS }, (_, e): ContestEffect => {
    const o = e * EFFECT_SIZE;
    const messages = Array.from({ length: 5 }, (_, v): ContestActingMessage | null => {
      const id = er.u16(o + 6 + v * 4);
      if (id === NONE) return null;
      return { text: text(id, ctx.counts.outcomes, ctx.outcomeText, `effect ${e} variant ${v}`), args: args(er.u8(o + 8 + v * 4), `effect ${e}`) };
    });
    const cls = cr.u8(e * EFFECT_CLASS_SIZE + 4);
    if (cls !== 3 && cls !== 5 && cls !== 6) throw new Error(`contest acting: effect ${e} has class ${cls}`);
    const announce = cr.u8(e * EFFECT_CLASS_SIZE + 5);
    if (announce !== 0 && announce !== 0xff) throw new Error(`contest acting: effect ${e} unk_05 ${announce}`);
    if (announce === 0 && !messages[4]) throw new Error(`contest acting: effect ${e} is announced without a variant 4 line`);
    return {
      description: [text(er.u16(o), ctx.counts.effects, ctx.effectText, `effect ${e} line one`), text(er.u16(o + 2), ctx.counts.effects, ctx.effectText, `effect ${e} line two`)],
      appeal: s8(er.u8(o + 4)),
      class: cls,
      announce: announce === 0,
      messages,
    };
  });
  const types = CONTEST_TYPES.length;
  if (b.typeMatch.length !== types * types) throw new Error(`contest acting: the type table has ${b.typeMatch.length} bytes`);
  const typeMatch = Array.from({ length: types }, (_, c) =>
    Array.from({ length: types }, (_, m) => {
      const v = s8(b.typeMatch[c * types + m]!);
      if (v !== 10 && v !== 0 && v !== -10) throw new Error(`contest acting: type match ${c},${m} is ${v}`);
      return v;
    }),
  );
  const mr = new Reader(b.messages);
  const messages = Array.from({ length: ACTING_MESSAGES }, (_, i): ContestActingMessage => {
    const instant = mr.u8(i * 4 + 3);
    if (instant > 1) throw new Error(`contest acting: message ${i} instant flag ${instant}`);
    return { text: text(mr.u16(i * 4), ctx.counts.contest, ctx.contestText, `acting message ${i}`), args: args(mr.u8(i * 4 + 2), `acting message ${i}`), ...(instant ? { instant: true } : {}) };
  });
  const rr = new Reader(b.rules);
  const rules = Array.from({ length: AI_RULES }, (_, i): ContestAiRule => {
    const o = i * AI_RULE_SIZE;
    const rule = { slot: rr.u8(o), condition: rr.u8(o + 1), target: rr.u8(o + 2), judges: s8(rr.u8(o + 3)), weights: [0, 1, 2, 3].map((k) => (rr.u16(o + 4 + k * 2) << 16) >> 16) };
    if (rule.slot < 1 || rule.slot > 4) throw new Error(`contest acting: AI rule ${i} slot ${rule.slot}`);
    if (rule.condition < 1 || rule.condition >= AI_CONDITIONS) throw new Error(`contest acting: AI rule ${i} condition ${rule.condition}`);
    if (rule.target >= CONTEST_EFFECTS && rule.target !== 240 && rule.target !== 241) throw new Error(`contest acting: AI rule ${i} target ${rule.target}`);
    if (rule.judges < 0 || rule.judges > 3) throw new Error(`contest acting: AI rule ${i} judge mode ${rule.judges}`);
    return rule;
  });
  const pr = new Reader(b.palettes);
  const buttonPalettes = Array.from({ length: BUTTON_PALETTES }, (_, p) => Array.from({ length: 16 }, (_, c) => pr.u16((p * 16 + c) * 2)));
  return { effects, typeMatch, messages, rules, buttonPalettes };
}
