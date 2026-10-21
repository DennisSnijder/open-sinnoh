/**
 * The AI bytecode's instruction set (decomp `AICMD_*`, in opcode order) and a decoder.
 *
 * Operand kinds: `v` a value, `j` a jump, `t` a table. A jump is relative to the end of its own word
 * (the DS adds it to the cursor after reading it); every jump is the last operand. A table operand is
 * relative to the end of the instruction (`table - . - 2` words in aicmd.inc) and points at a list of
 * words ended by -1 (TABLE_END).
 */
export const OPCODES = [
  { name: 'IfRandomLessThan', args: 'vj' },
  { name: 'IfRandomGreaterThan', args: 'vj' },
  { name: 'IfRandomEqualTo', args: 'vj' },
  { name: 'IfRandomNotEqualTo', args: 'vj' },
  { name: 'AddToMoveScore', args: 'v' },
  { name: 'IfHPPercentLessThan', args: 'vvj' },
  { name: 'IfHPPercentGreaterThan', args: 'vvj' },
  { name: 'IfHPPercentEqualTo', args: 'vvj' },
  { name: 'IfHPPercentNotEqualTo', args: 'vvj' },
  { name: 'IfStatus', args: 'vvj' },
  { name: 'IfNotStatus', args: 'vvj' },
  { name: 'IfVolatileStatus', args: 'vvj' },
  { name: 'IfNotVolatileStatus', args: 'vvj' },
  { name: 'IfMoveEffect', args: 'vvj' },
  { name: 'IfNotMoveEffect', args: 'vvj' },
  { name: 'IfSideCondition', args: 'vvj' },
  { name: 'IfNotSideCondition', args: 'vvj' },
  { name: 'IfLoadedLessThan', args: 'vj' },
  { name: 'IfLoadedGreaterThan', args: 'vj' },
  { name: 'IfLoadedEqualTo', args: 'vj' },
  { name: 'IfLoadedNotEqualTo', args: 'vj' },
  { name: 'IfLoadedMask', args: 'vj' },
  { name: 'IfLoadedNotMask', args: 'vj' },
  { name: 'IfMoveEqualTo', args: 'vj' },
  { name: 'IfMoveNotEqualTo', args: 'vj' },
  { name: 'IfLoadedInTable', args: 'tj' },
  { name: 'IfLoadedNotInTable', args: 'tj' },
  { name: 'IfAttackerHasDamagingMoves', args: 'j' },
  { name: 'IfAttackerHasNoDamagingMoves', args: 'j' },
  { name: 'LoadTurnCount', args: '' },
  { name: 'LoadTypeFrom', args: 'v' },
  { name: 'LoadMovePower', args: '' },
  { name: 'FlagMoveDamageScore', args: 'v' },
  { name: 'LoadBattlerPreviousMove', args: 'v' },
  { name: 'IfTempEqualTo', args: 'vj' },
  { name: 'IfTempNotEqualTo', args: 'vj' },
  { name: 'IfSpeedCompareEqualTo', args: 'vj' },
  { name: 'IfSpeedCompareNotEqualTo', args: 'vj' },
  { name: 'CountAlivePartyBattlers', args: 'v' },
  { name: 'LoadCurrentMove', args: '' },
  { name: 'LoadCurrentMoveEffect', args: '' },
  { name: 'LoadBattlerAbility', args: 'v' },
  { name: 'CalcMaxEffectiveness', args: '' },
  { name: 'IfMoveEffectivenessEquals', args: 'vj' },
  { name: 'IfPartyMemberStatus', args: 'vvj' },
  { name: 'IfPartyMemberNotStatus', args: 'vvj' },
  { name: 'LoadCurrentWeather', args: '' },
  { name: 'IfCurrentMoveEffectEqualTo', args: 'vj' },
  { name: 'IfCurrentMoveEffectNotEqualTo', args: 'vj' },
  { name: 'IfStatStageLessThan', args: 'vvvj' },
  { name: 'IfStatStageGreaterThan', args: 'vvvj' },
  { name: 'IfStatStageEqualTo', args: 'vvvj' },
  { name: 'IfStatStageNotEqualTo', args: 'vvvj' },
  { name: 'IfCurrentMoveKills', args: 'vj' },
  { name: 'IfCurrentMoveDoesNotKill', args: 'vj' },
  { name: 'IfMoveKnown', args: 'vvj' },
  { name: 'IfMoveNotKnown', args: 'vvj' },
  { name: 'IfMoveEffectKnown', args: 'vvj' },
  { name: 'IfMoveEffectNotKnown', args: 'vvj' },
  { name: 'IfBattlerUnderEffect', args: 'vvj' },
  { name: 'IfCurrentMoveMatchesEffect', args: 'vj' },
  { name: 'Escape', args: '' },
  { name: 'Dummy3E', args: 'v' },
  { name: 'Dummy3F', args: '' },
  { name: 'LoadHeldItem', args: 'v' },
  { name: 'LoadHeldItemEffect', args: 'v' },
  { name: 'LoadGender', args: 'v' },
  { name: 'LoadIsFirstTurnInBattle', args: 'v' },
  { name: 'LoadStockpileCount', args: 'v' },
  { name: 'LoadBattleType', args: '' },
  { name: 'LoadRecycleItem', args: 'v' },
  { name: 'LoadTypeOfLoadedMove', args: '' },
  { name: 'LoadPowerOfLoadedMove', args: '' },
  { name: 'LoadEffectOfLoadedMove', args: '' },
  { name: 'LoadProtectChain', args: 'v' },
  { name: 'PushAndGoTo', args: 'j' },
  { name: 'GoTo', args: 'j' },
  { name: 'PopOrEnd', args: '' },
  { name: 'IfLevel', args: 'vj' },
  { name: 'IfTargetIsTaunted', args: 'j' },
  { name: 'IfTargetIsNotTaunted', args: 'j' },
  { name: 'IfTargetIsPartner', args: 'j' },
  { name: 'FlagBattlerIsType', args: 'vv' },
  { name: 'CheckBattlerAbility', args: 'vv' },
  { name: 'IfActivatedFlashFire', args: 'vj' },
  { name: 'IfHeldItemEqualTo', args: 'vvj' },
  { name: 'IfFieldConditionsMask', args: 'vj' },
  { name: 'LoadSpikesLayers', args: 'vv' },
  { name: 'IfAnyPartyMemberIsWounded', args: 'vj' },
  { name: 'IfAnyPartyMemberUsedPP', args: 'vj' },
  { name: 'LoadFlingPower', args: 'v' },
  { name: 'LoadCurrentMovePP', args: '' },
  { name: 'IfCanUseLastResort', args: 'vj' },
  { name: 'LoadCurrentMoveClass', args: '' },
  { name: 'LoadDefenderLastUsedMoveClass', args: '' },
  { name: 'LoadBattlerSpeedRank', args: 'v' },
  { name: 'LoadBattlerTurnCount', args: 'v' },
  { name: 'IfPartyMemberDealsMoreDamage', args: 'vj' },
  { name: 'IfHasSuperEffectiveMove', args: 'j' },
  { name: 'IfBattlerDealsMoreDamage', args: 'vvj' },
  { name: 'SumPositiveStatStages', args: 'v' },
  { name: 'DiffStatStages', args: 'vv' },
  { name: 'IfBattlerHasHigherStat', args: 'vvj' },
  { name: 'IfBattlerHasLowerStat', args: 'vvj' },
  { name: 'IfBattlerHasEqualStat', args: 'vvj' },
  { name: 'CheckIfHighestDamageWithPartner', args: 'v' },
  { name: 'IfBattlerFainted', args: 'vj' },
  { name: 'IfBattlerNotFainted', args: 'vj' },
  { name: 'LoadAbility', args: 'v' },
] as const satisfies readonly { name: string; args: string }[];

export type OpName = (typeof OPCODES)[number]['name'];
export const OP = Object.fromEntries(OPCODES.map((o, i) => [o.name, i])) as Record<OpName, number>;

/** Instructions after which execution does not fall through (GoTo jumps, PopOrEnd returns, Escape ends). */
const NO_FALLTHROUGH = new Set<number>([OP.GoTo, OP.PopOrEnd, OP.Escape]);

export interface Instruction {
  at: number;
  op: number;
  name: string;
  /** Operands as read; jumps and tables resolved to absolute word indexes in `targets`/`table`. */
  args: number[];
  target?: number;
  table?: number;
}

export interface Decoded {
  /** Reachable instructions by word index. */
  instructions: Map<number, Instruction>;
  /** Table starts and their entries. */
  tables: Map<number, number[]>;
  /** Problems: unknown opcodes, jumps or tables outside the code, unterminated tables. */
  errors: string[];
}

/** Decode everything reachable from `entries` (each flag's entry point). */
export function decodeAiScript(code: readonly number[], entries: readonly number[]): Decoded {
  const instructions = new Map<number, Instruction>();
  const tables = new Map<number, number[]>();
  const errors: string[] = [];
  const todo = [...entries];
  while (todo.length) {
    let at = todo.pop()!;
    while (!instructions.has(at)) {
      if (at < 0 || at >= code.length) {
        errors.push(`word ${at}: outside the script (${code.length} words)`);
        break;
      }
      const op = code[at]!;
      const spec = OPCODES[op] as { name: string; args: string } | undefined;
      if (!spec) {
        errors.push(`word ${at}: unknown opcode ${op}`);
        break;
      }
      const end = at + 1 + spec.args.length;
      if (end > code.length) {
        errors.push(`word ${at}: ${spec.name} runs past the end`);
        break;
      }
      const args = code.slice(at + 1, end);
      const ins: Instruction = { at, op, name: spec.name, args };
      [...spec.args].forEach((kind, k) => {
        const word = at + 1 + k;
        if (kind === 'j') {
          ins.target = word + 1 + args[k]!;
          todo.push(ins.target);
        } else if (kind === 't') {
          const start = end + args[k]!;
          ins.table = start;
          if (!tables.has(start)) {
            const entries: number[] = [];
            let i = start;
            for (; i < code.length && code[i] !== -1; i++) entries.push(code[i]!);
            if (i >= code.length) errors.push(`word ${at}: table at ${start} has no end`);
            tables.set(start, entries);
          }
        }
      });
      instructions.set(at, ins);
      if (NO_FALLTHROUGH.has(op)) break;
      at = end;
    }
  }
  return { instructions, tables, errors };
}
