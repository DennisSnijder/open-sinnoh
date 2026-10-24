/**
 * Battle animations (docs/research/move-animations.md): the ROM's move and common animation scripts
 * run by the animation VM. A script plays when the VM implements everything it can reach in a singles
 * battle (`animSupport`); otherwise the battle plays the DS's generic hit instead, logged and counted.
 */
import type { BattleAnimation, Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { animSpriteSheetId } from '@opensinnoh/contracts';
import { ANIM_SPRITE_FUNCS } from './sprite-callbacks.ts';
import { ANIM_FUNCS } from './funcs.ts';
import { scriptUse } from './script.ts';
import { ANIM_OPCODES } from './vm.ts';

export { AnimVm, type AnimBattler, type AnimDeps, type AnimSound, type Side } from './vm.ts';
export { scriptUse, instructionLength, OPCODES, FUNCS, SPRITE_FUNCS } from './script.ts';
export { ANIM_FUNCS } from './funcs.ts';
export { ANIM_OPCODES } from './vm.ts';

type AnimRegistries = Pick<Registries, 'battleAnimations' | 'particleSystems' | 'battleAnimData'> & Partial<Pick<Registries, 'ui2d'>>;

/**
 * What keeps a script from playing for real: unimplemented commands, functions, sprite callbacks, missing particle
 * files. `friendlyFire`: on the path a move at the user's ally takes (JumpIfFriendlyFire's arm). `contest`: a
 * contest's path (scriptUse's).
 */
export function animSupport(anim: BattleAnimation, registries: AnimRegistries, friendlyFire = false, contest = false): string[] {
  // The unused common slots (dummy23, dummy41 …) are empty files.
  if (!anim.code.length) return ['empty script'];
  const use = scriptUse(anim.code, friendlyFire, contest);
  const missing = [
    ...[...use.opcodes].filter((o) => !ANIM_OPCODES.has(o)),
    ...[...use.funcs].filter((f) => !ANIM_FUNCS.has(f)).map((f) => `Func_${f}`),
    ...[...use.spriteFuncs].filter((f) => !ANIM_SPRITE_FUNCS.has(f)).map((f) => `SpriteFunc_${f}`),
  ];
  for (const r of use.spriteResources.values()) {
    const id = animSpriteSheetId(r);
    if (!registries.ui2d?.get(id)?.animations?.length) missing.push(`sprite/${id}`);
  }
  const particles = new Set([...registries.particleSystems.values()].filter((p) => !p.archive).map((p) => p.sourceIndex));
  for (const p of use.particles) if (!particles.has(p)) missing.push(`particles/${p}`);
  if (registries.battleAnimData.size !== 1) missing.push('battleAnimData');
  return missing;
}

/** The move's animation record, or null when the packs have none. */
export function moveAnimation(registries: AnimRegistries, move: Id): BattleAnimation | null {
  for (const a of registries.battleAnimations.values()) if (a.move === move) return a;
  return null;
}

/** A common animation by its decomp file name (`poison`, `stat_boost`, …), or null. */
export function commonAnimation(registries: AnimRegistries, name: string): BattleAnimation | null {
  for (const a of registries.battleAnimations.values()) if (a.common === name) return a;
  return null;
}

/** Coverage over the move scripts: the ones that play for real, and what the others miss. */
export function animCoverage(registries: AnimRegistries): { moves: number; real: number; missing: Map<string, number> } {
  const missing = new Map<string, number>();
  let moves = 0;
  let real = 0;
  for (const a of registries.battleAnimations.values()) {
    if (a.common !== undefined) continue;
    moves++;
    const m = animSupport(a, registries);
    if (!m.length) real++;
    for (const x of m) missing.set(x, (missing.get(x) ?? 0) + 1);
  }
  return { moves, real, missing };
}

export { ANIM_SPRITE_FUNCS } from './sprite-callbacks.ts';
export { createContestMoveAnimation, contestAnimCoverage } from './contest.ts';
