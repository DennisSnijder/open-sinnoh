import type { ActiveMove } from '@pkmn/sim';

/** SetMultiHit: Skill Link fixes only variable counts, not Triple Kick's per-kick accuracy. */
export const skilllink = {
  inherit: true,
  onModifyMove(move: ActiveMove) {
    if (Array.isArray(move.multihit)) move.multihit = move.multihit[1];
  },
};
