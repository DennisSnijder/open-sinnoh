import type { GameState, MapFeatures, Registries } from '@opensinnoh/contracts';
import { SunyshoreGym } from './sunyshore.ts';
import { EternaGym } from './eterna.ts';
import { HearthomeGym } from './hearthome.ts';
import { VeilstoneGym } from './veilstone.ts';
import { PastoriaGym } from './pastoria.ts';
import { CanalaveGym } from './canalave.ts';
import { GreatMarshTram } from './great-marsh.ts';
import { newGameRecord } from '@opensinnoh/contracts';
import { gymTables, type FeatureHost, type MapFeature } from './feature.ts';
import { DistortionWorld } from '../distortion/feature.ts';
import { Villa } from '../villa.ts';

export { SunyshoreGym } from './sunyshore.ts';
export { EternaGym, type EternaClockTask } from './eterna.ts';
export { HearthomeGym } from './hearthome.ts';
export { VeilstoneGym } from './veilstone.ts';
export { PastoriaGym } from './pastoria.ts';
export { CanalaveGym } from './canalave.ts';
export { GreatMarshTram } from './great-marsh.ts';
export { FEATURE_EFFECT_KEYS, type FeatureHost, type MapFeature } from './feature.ts';

/** Decomp PersistedMapFeatures_InitFor*Gym (from onTransition): the slot is selected and cleared. */
export function initMapFeatures(state: GameState, registries: Registries, kind: MapFeatures['kind']): void {
  switch (kind) {
    case 'sunyshore-gym':
      throw new Error('Sunyshore initialization requires a room id');
    case 'eterna-gym':
      state.mapFeatures = { kind, clock: 0 };
      return;
    case 'hearthome-gym':
      state.mapFeatures = { kind, initialized: false, correctDoor: 0, clueX: 0, clueZ: 0 };
      return;
    case 'veilstone-gym':
      state.mapFeatures = { kind, initialized: false, bags: [], stacks: [] };
      return;
    case 'pastoria-gym':
      // PersistedMapFeatures_InitForPastoriaGym: green (the middle water).
      state.mapFeatures = { kind, pressedButton: 1 };
      return;
    case 'canalave-gym': {
      // PersistedMapFeatures_InitForCanalaveGym: each bit from sCanalaveGymPlatformsStartInPositionB.
      const starts = gymTables(registries).canalave.startInB;
      state.mapFeatures = { kind, platformStates: starts.reduce((bits, b, i) => (b ? bits | (1 << i) : bits), 0) };
      return;
    }
    case 'great-marsh':
      // PersistedMapFeatures_InitForGreatMarsh: only when the slot is not the marsh's already (a connection keeps it).
      if (state.mapFeatures?.kind !== kind) state.mapFeatures = { kind, tram: 2 };
      return;
    case 'villa':
      state.mapFeatures = { kind };
      return;
    case 'distortion-world':
      // PersistedMapFeatures_InitForDistortionWorld: cleared, not valid until the room's first load fills it.
      state.mapFeatures = { kind, valid: false, hiddenGhostGroups: 0, support: null, cameraAngle: [0, 0, 0], platformFlags: 0, puzzleFlags: 0, movingDir: state.player.facing, platforms: [] };
      return;
  }
}

/** Decomp DynamicMapFeatures_Init: the runtime feature of the saved slot, or null. */
export function createMapFeature(host: FeatureHost): MapFeature | null {
  const kind = host.state.mapFeatures?.kind;
  if (kind === 'sunyshore-gym') return new SunyshoreGym(host);
  if (kind === 'eterna-gym') return new EternaGym(host);
  if (kind === 'hearthome-gym') return new HearthomeGym(host);
  if (kind === 'veilstone-gym') return new VeilstoneGym(host);
  if (kind === 'pastoria-gym') return new PastoriaGym(host);
  if (kind === 'canalave-gym') return new CanalaveGym(host);
  if (kind === 'distortion-world') return new DistortionWorld(host);
  if (kind === 'villa') return new Villa(host);
  if (kind === 'great-marsh') return new GreatMarshTram(host, newGameRecord(host.reg).greatMarsh?.tram ?? null);
  return null;
}
