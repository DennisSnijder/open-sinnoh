import type { Prop } from '@opensinnoh/contracts';

/** DoorAnimation_GetSoundEffectType: prop-model identities from map_prop_models.order (reference facts). */
const SLIDING = new Set([70, 75, 298, 427, 456, 484]);
export function doorSounds(model: number): NonNullable<Prop['doorSounds']> {
  if (model === 442) return { open: 1492, close: 0 };
  return SLIDING.has(model) ? { open: 1544, close: 0 } : { open: 1541, close: 1543 };
}
