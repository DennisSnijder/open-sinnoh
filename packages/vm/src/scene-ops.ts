import { newGameRecord } from '@opensinnoh/contracts';
import { SpearFieldEffects } from './spear-field.ts';
import { SpearPillarApplication } from './spear-app.ts';
/**
 * Story scene commands (docs/research/story-scenes.md): `scr_cmd_29f`, the explosion's camera shake (decomp
 * ScrCmd_29F → ov6_0223E384 / ov6_0223E4EC, overlay006 ov6_0223E140.c). A nested field task: the script waits.
 */
import type { Id } from '@opensinnoh/core';
import type { Handler, Runner } from './runner.ts';

/** SEQ_SE_DP_CLIMAX09 (the shake's start) and SEQ_SE_DP_FW089 (the explosion; stopped as 1628 by number). */
const SEQ_CLIMAX09 = 1749;
const SEQ_FW089 = 1628;
const FX = 4096;
/** The delays around the nonzero mode's shake, in callbacks. */
const DELAY = 16;

/**
 * ov6_0223FE9C: a cycle is four callbacks over a one-step interpolation (+amplitude, back to 0, −amplitude,
 * back to 0); after `cycles` cycles the camera is restored, then the shake reports done. Amplitude in fx32.
 */
class Shake {
  state = 0;
  private count = 0;
  constructor(
    public delta: number,
    public cycles: number,
  ) {}

  /** One callback; returns the camera's x offset (world units). */
  step(): number {
    // ov6_0223FD18 over one step: the full delta at count 1, nothing at 0.
    const at = () => this.delta * this.count;
    switch (this.state) {
      case 0:
        this.count++;
        this.state = 1;
        return at() / FX;
      case 1:
        this.count--;
        this.state = 2;
        return at() / FX;
      case 2:
        this.count++;
        this.state = 3;
        return -at() / FX;
      case 3:
        this.count--;
        if (--this.cycles > 0) this.state = 0;
        else this.state = 4;
        return -at() / FX;
      case 4:
        this.state = 5;
        return 0;
      default:
        return 0;
    }
  }

  done(): boolean {
    return this.state === 5;
  }
}

export function sceneHandlers(r: Runner): Record<string, Handler> {
  const seq = (n: number): Id | null => {
    const id = r.source('sequences', n, false);
    if (!id) r.log.stub('audio:sequence-missing', `no sequence with sourceIndex ${n} in the packs: not played`);
    return id ?? null;
  };
  const se = (n: number) => {
    const id = seq(n);
    if (id) r.audio.playSe(id);
  };
  let effect: SpearFieldEffects | null = null;
  let update: (() => void) | null = null;
  const dispose = () => {
    if (update) r.backgroundTasks.delete(update);
    effect = null; update = null; r.field.setStoryScene(null);
  };
  const data = () => {
    const d = newGameRecord(r.registries).spearPillar;
    if (!d) throw new Error('Spear Pillar scene assets missing');
    return d;
  };
  return {
    scr_cmd_20d: (t, _c, a) => {
      const mode = r.int(a[0]);
      let result = 0;
      if (mode === 1 || mode === 6) {
        if (!effect) throw new Error('Spear Pillar: poll without a live effect');
        if (effect.done()) { result = 1; dispose(); }
      } else if (mode === 0 || mode === 4) {
        if (effect) throw new Error('Spear Pillar: effect already live');
        effect = new SpearFieldEffects(r, data(), mode);
        const zone = r.field.player().zone;
        update = () => { if (r.field.player().zone !== zone) dispose(); else effect!.step(); };
        r.backgroundTasks.add(update);
      } else if (mode === 5) {
        if (!effect || effect.mode !== 4) throw new Error('Spear Pillar: guardian finish without its controller');
        effect.finishGuardians();
      } else {
        r.log.stub(`spear-field:mode-${mode}`, 'non-story camera/ring selector is not implemented');
      }
      r.setVar(t, r.ref(a[1], 'var'), result);
      return 'yield';
    },
    scr_cmd_2fb: (t, c) => {
      const app = new SpearPillarApplication(r, t, data());
      return r.pause(c, () => app.step());
    },
    scr_cmd_18c: (t, _c, a) => {
      const facing = (['up', 'down', 'left', 'right'] as const)[r.val(t, a[1])];
      if (!facing) throw new Error('scr_cmd_18c: invalid direction');
      r.field.faceObject(r.val(t, a[0]), facing);
      return 'continue';
    },
    // SDAT resources are resident/lazy in-engine; selecting this sound scene starts no sequence.
    set_sub_scene63: () => 'yield',

    init_lake_guardian_containment_units: () => {
      const flag = [...r.registries.flags.values()].find(f => f.id.endsWith(':FLAG_FREED_GALACTIC_HQ_POKEMON'));
      if (!flag) throw new Error('containment: freed flag missing');
      r.field.initContainmentUnits(r.getFlag(flag.id));
      return 'continue';
    },
    deactivate_lake_guardian_containment_units: (_t, c) => {
      r.field.deactivateContainmentUnits();
      return r.pause(c, () => r.field.containmentUnitsDone());
    },
    /**
     * ScrCmd_29F (a var): 0 shakes 2 units for 16 cycles; otherwise the BGM fades out (1), 16 callbacks pass,
     * FW089 plays, the camera shakes 4 units for 24 cycles losing an eighth (FX_Div) after each, FW089 stops,
     * 16 callbacks pass and the BGM fades back in (16). The shake's setup plays CLIMAX09.
     */
    scr_cmd_29f: (t, c, a) => {
      const mode = r.val(t, a[0]);
      const shake = mode === 0 ? new Shake(2 * FX, 16) : new Shake(4 * FX, 24);
      se(SEQ_CLIMAX09);
      if (mode === 0) {
        return r.pause(c, () => {
          // ov6_0223E33C: the shake until done, then a callback that frees it.
          if (shake.done()) return true;
          r.field.shakeCamera(shake.step());
          return false;
        });
      }
      let state = 0;
      let delay = 0;
      let cycles = shake.cycles;
      return r.pause(c, () => {
        switch (state) {
          case 0:
            r.audio.fadeOutBgm(0, 1);
            state = 1;
            return false;
          case 1:
            if (!r.audio.fadeActive()) {
              state = 2;
              delay = DELAY;
            }
            return false;
          case 2:
            if (--delay <= 0) {
              state = 3;
              se(SEQ_FW089);
            }
            return false;
          case 3: {
            r.field.shakeCamera(shake.step());
            // ov6_0223E3D8: when a cycle ends the amplitude loses FX_Div(amplitude, 8).
            if (shake.cycles !== cycles) {
              cycles = shake.cycles;
              shake.delta -= Math.trunc(shake.delta / 8);
            }
            if (shake.done()) {
              const fw = seq(SEQ_FW089);
              if (fw) r.audio.stopSe(fw);
              state = 4;
              delay = DELAY;
            }
            return false;
          }
          case 4:
            if (--delay <= 0) state = 5;
            return false;
          case 5:
            r.audio.fadeInBgm(DELAY);
            state = 6;
            return false;
          case 6:
            if (!r.audio.fadeActive()) state = 7;
            return false;
          default:
            return true;
        }
      });
    },
  };
}
