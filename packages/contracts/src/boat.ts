import type { Id } from '@opensinnoh/core';
import type { AssetRef } from './records.ts';
import type { Vec3 } from './runtime.ts';

/** A standalone ship scene, imported from the player's ROM. All channels play once and hold. */
export interface ShipScene {
  /** Each animation channel loops at its own length (the DW warp application). */
  loop?: boolean;
  model: Id;
  visibility?: boolean[][];
  clip: string;
  frames: number;
  camera: { position: Vec3; target: Vec3; fovY: number; near: number; far: number };
  srt: { frames: number; materials: { material: string; scaleS: number | number[]; scaleT: number | number[]; rotation: [number, number]; rotationFrames?: [number, number][]; translateS: number | number[]; translateT: number | number[] }[] }[];
  colors: { frames: number; materials: { material: string; diffuse: number | number[]; ambient: number | number[]; specular: number | number[]; emission: number | number[]; alpha: number | number[] }[] }[];
  patterns: { frames: number; materials: { material: string; keys: { frame: number; image: AssetRef }[] }[] }[];
}

/** Presentation only; neither rendering nor loading changes the boat task's timing. */
export interface ShipSceneView { direction: number; tick: number; frames: number }
