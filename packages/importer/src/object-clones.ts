import type { Matrix, Zone } from '@opensinnoh/contracts';

/**
 * Some borders use script-0 stand-ins instead of the explicit script-FFFF clone encoding (Route 204).
 * Their local ids differ. Match only an unscripted event outside its own zone to the scripted event on
 * the owning matrix cell, with the same sprite and tile. Record the source clone identity so the
 * world carries it across and the renderer never previews a second copy.
 */
export function resolveUnscriptedClones(zones: readonly Pick<Zone, 'id' | 'matrix' | 'events'>[], matrices: readonly Pick<Matrix, 'id' | 'width' | 'height' | 'zones'>[]): void {
  const byId = new Map(zones.map(z => [z.id, z]));
  const maps = new Map(matrices.map(m => [m.id, m]));
  for (const zone of zones) {
    const matrix = maps.get(zone.matrix)!;
    if (!matrix.zones) continue;
    for (const event of zone.events.objects) {
      if (event.label || event.cloneOf || event.hideFlag || event.trainer || event.trainerType !== 0 || typeof event.sprite !== 'string') continue;
      const x = Math.floor(event.x / 32);
      const z = Math.floor(event.z / 32);
      if (x < 0 || x >= matrix.width || z < 0 || z >= matrix.height) continue;
      const home = matrix.zones[z * matrix.width + x];
      if (!home || home === zone.id) continue;
      const source = byId.get(home)!;
      if (source.matrix !== zone.matrix) continue;
      const matches = source.events.objects.filter(o => o.label && !o.cloneOf && !o.hideFlag && o.sprite === event.sprite && o.x === event.x && o.z === event.z);
      if (matches.length > 1) throw new Error(`${zone.id}: ambiguous unscripted object ${event.localId} in ${home}`);
      if (matches.length === 0) continue;
      event.cloneOf = home;
      event.cloneLocalId = matches[0]!.localId;
    }
  }
}
