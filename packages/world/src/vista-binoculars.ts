/**
 * The Vista Lighthouse binoculars (decomp src/binoculars_vista_lighthouse.c Task_UseVistaLighthouseBinoculars): the
 * screen fades out, a temporary map change (no warp flags) takes the hidden player to the Pokémon League (847, 561,
 * facing south) with the Pokétch hidden, and the camera looks up at the League from the sea; the circle fade opens
 * (KASYA) and stays until A or B, then closes (KASYA). The player is back where they stood, facing north, and the
 * screen fades in. Independent implementation.
 */
import type { Camera, Facing } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { LOOKOUT_FADE, type LookoutView } from './great-marsh-lookout.ts';

/** SEQ_SE_DP_KASYA. */
const SE_KASYA = 1657;
/** Where the binoculars look from (Location_Set(MAP_HEADER_POKEMON_LEAGUE, -1, 847, 561, DIR_SOUTH)). */
const VIEW = { x: 847, z: 561, facing: 'down' as Facing };
/**
 * VistaLighthouseBinoculars_SetCamera: FOV index 0x8C0 (FX32_CONST(0.547)), distance 248.1074, the target, angles
 * 0x823 and 0x520 (FX32_CONST(0.5086), FX32_CONST(0.3203125)) as binary angles, clipping 12 to 1564.
 */
const idx = (fx: number) => Math.round(fx * 4096);
const deg = (i: number) => (((i << 16) >> 16) * 360) / 65536;
export const BINOCULARS_CAMERA: { camera: Camera; target: [number, number, number] } = {
  camera: {
    id: 'opensinnoh:camera/vista-lighthouse-binoculars' as Id,
    distance: 248.1074,
    angle: [deg(idx(0.5086)), deg(idx(0.3203125)), 0],
    projection: 'perspective',
    fovY: 2 * deg(idx(0.547)),
    near: 12,
    far: 1564,
  },
  target: [13573.1399, 350.8571, 9178.2534],
};

export interface BinocularsHost {
  /** The brightness fade (both screens) and its end. */
  fade(kind: 'in' | 'out', frames: number): void;
  fadeDone(): boolean;
  /** FieldTask_ChangeMapByLocation with SetTemporaryMapChange: the map loads at once, no warp flags, no fade. */
  changeMap(zone: Id, x: number, z: number, facing: Facing): void;
  /** MAP_HEADER_POKEMON_LEAGUE. */
  readonly league: Id;
  /** Where the player stands now (MAP_HEADER_VISTA_LIGHTHOUSE in the script; the task returns to that header). */
  readonly home: { zone: Id; x: number; z: number };
  hidePlayer(hidden: boolean): void;
  hidePoketch(hidden: boolean): void;
  /** The binoculars' camera, or null for the map's own. */
  setCamera(camera: typeof BINOCULARS_CAMERA | null): void;
  pressedAB(): boolean;
  playSe(source: number): void;
}

export class VistaBinoculars {
  private state = 0;
  private iris: { from: number; to: number; t: number } | null = null;
  private irisValue: number | null = null;

  constructor(private readonly h: BinocularsHost) {}

  view(): LookoutView {
    return { pokemon: null, iris: this.irisValue };
  }

  /** One tick; true once the task is over. */
  step(): boolean {
    const h = this.h;
    if (this.iris) {
      // The circle fade is a called task: the binoculars' task waits for it.
      const i = this.iris;
      i.t++;
      this.irisValue = i.from + ((i.to - i.from) * Math.min(i.t, LOOKOUT_FADE)) / LOOKOUT_FADE;
      if (i.t < LOOKOUT_FADE) return false;
      this.iris = null;
    }
    switch (this.state) {
      case 0:
        h.fade('out', LOOKOUT_FADE);
        this.state = 1;
        return false;
      case 1:
        if (!h.fadeDone()) return false;
        h.hidePoketch(true);
        h.changeMap(h.league, VIEW.x, VIEW.z, VIEW.facing);
        this.state = 4;
        return false;
      case 4:
        h.hidePlayer(true);
        h.setCamera(BINOCULARS_CAMERA);
        h.playSe(SE_KASYA);
        this.irisValue = 0;
        this.iris = { from: 0, to: 1, t: 0 };
        this.state = 5;
        return false;
      case 5:
        if (!h.pressedAB()) return false;
        h.playSe(SE_KASYA);
        this.iris = { from: 1, to: 0, t: 0 };
        this.state = 8;
        return false;
      case 8:
        h.hidePoketch(false);
        h.setCamera(null);
        h.changeMap(h.home.zone, h.home.x, h.home.z, 'up');
        this.state = 10;
        return false;
      case 10:
        h.hidePlayer(false);
        this.irisValue = null;
        h.fade('in', LOOKOUT_FADE);
        this.state = 11;
        return false;
      case 11:
        return h.fadeDone();
    }
    throw new Error(`vista binoculars: state ${this.state}`);
  }
}
