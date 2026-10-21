/**
 * Battle coverage the status reports count. Move animations: a move plays its ROM script on the animation
 * VM (`real`) when the VM implements everything the script can reach in a singles battle; otherwise the
 * DS's generic hit (`generic`, logged when it plays). See `anim/index.ts` `animSupport`.
 */
import type { Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { animSupport, moveAnimation } from './anim/index.ts';

export type MoveAnimation = 'real' | 'generic';

/** How each move of the packs animates. */
export function moveAnimations(registries: Registries): Map<Id, MoveAnimation> {
  return new Map(
    [...registries.moves.keys()].map((id) => {
      const anim = moveAnimation(registries, id);
      return [id, anim && !animSupport(anim, registries).length ? 'real' : 'generic'] as const;
    }),
  );
}
