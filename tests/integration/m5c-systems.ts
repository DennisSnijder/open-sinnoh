import type { PackData } from '@opensinnoh/core';
import type { Zone } from '@opensinnoh/contracts';

/** A system test's constructed start at the native continuation (not a new CP15 trigger in the game). */
export function m5cSystemPack(pack: PackData): PackData {
  const out = structuredClone(pack);
  const zone = (out.registries.zones as unknown as Zone[]).find((z) => z.id === 'platinum:MAP_HEADER_SPEAR_PILLAR')!;
  zone.mapScripts.onFrame.push({ var: 'platinum:VAR_SPEAR_PILLAR_STATE', value: 2, label: 'platinum:SpearPillar_Cyrus' });
  return out;
}

