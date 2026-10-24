import type { AudioHost, FlySceneView } from '@opensinnoh/contracts';
import type { Pokemon } from '@opensinnoh/core';
import { FlyCutIn } from './fly.ts';

/**
 * hm_cut_in.c sCutInTaskFuncs (`FlyCutIn` without Fly's states): HMCutIn_Done on the 59th tick, the cry on the 36th
 * (HMCutIn_SlideMonToCenter); the field move's task sees it finished on that tick.
 */
export const HM_CUT_IN_TICKS = 59;

const flyOnly = (name: string) => () => {
  throw new Error(`the HM cut-in called Fly's ${name}`);
};

export class HmCutIn {
  private readonly scene: FlyCutIn;
  constructor(
    readonly mon: Pokemon,
    audio: AudioHost,
  ) {
    this.scene = new FlyCutIn({ cry: () => audio.playCry(mon.species, mon.form), se: flyOnly('se'), fadeOut: flyOnly('fadeOut'), fadeIn: flyOnly('fadeIn'), fadeDone: flyOnly('fadeDone'), hidePlayer: flyOnly('hidePlayer') }, false);
  }

  /** One 30 Hz tick; true once the cut-in has finished. */
  step(): boolean {
    this.scene.tick();
    return this.scene.finished;
  }

  view(gender: 'male' | 'female', mon: Pick<NonNullable<FlySceneView['mon']>, 'species' | 'form' | 'shiny' | 'female'>): FlySceneView | null {
    return this.scene.finished ? null : this.scene.view(gender, mon);
  }
}
