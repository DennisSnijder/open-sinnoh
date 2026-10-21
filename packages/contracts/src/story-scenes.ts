import type { Id } from '@opensinnoh/core';
import type { ShipScene } from './boat.ts';
import type { Vec3 } from './runtime.ts';

/** ROM-local scene resources. Member keys describe provenance, not redistributed asset payloads. */
export interface SpearPillarAssets {
  models: Record<string, ShipScene>;
  backgrounds: Record<string, Id>;
  messages: Id[];
}
export interface StoryActor {
  key: string;
  asset: string;
  tick: number;
  position: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  alpha?: number;
}
/** A temporary presentation; never a progression flag or a serialized native task. */
export interface StorySceneView {
  kind: 'spear-field' | 'spear-app' | 'dw-warp';
  phase: string;
  tick: number;
  actors: StoryActor[];
  camera?: ShipScene['camera'];
  brightness: number;
  background?: string;
  feedback?: boolean;
  scanline?: number;
}
