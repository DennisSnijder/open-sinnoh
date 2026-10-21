import type { AudioHost } from '@opensinnoh/contracts';
import type { Pokemon } from '@opensinnoh/core';

/** hm_cut_in.c: resources ready after init, cry at the sixth centre callback; one callback per 30 Hz tick. */
export const HM_CUT_IN_TICKS = 59;
export class HmCutIn {
  private tick = 0;
  constructor(private readonly mon: Pokemon, private readonly audio: AudioHost) {}
  step(): boolean {
    if (++this.tick === 36) this.audio.playCry(this.mon.species, this.mon.form);
    return this.tick === HM_CUT_IN_TICKS;
  }
}
