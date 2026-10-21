/**
 * `fielddata/tornworld/tw_arc_attr.narc`: one terrain grid per support, raw u16 cells indexed
 * `vertical + horizontal × tilesVertical` (decomp GetCurrentFloatingPlatformTileAttributesRelative).
 * Bit 15 blocks movement, the low byte is the tile behaviour; bits 8–14 are not read by overlay 9.
 *
 * A support's grid axes depend on its kind (decomp GetCurrentFloatingPlatformTileAttributes):
 * vertical = X − startX on a floor, sizeY − (Y − startY) on a west wall, Y − startY on an east wall and
 * sizeX − (X − startX) on a ceiling; horizontal = Z − startZ on all four. The flat axis has size 0.
 */
import { DistortionFormatError, type DwSupport } from './tw-arc.ts';

export const ATTR_COLLISION = 0x8000;
export const ATTR_BEHAVIOR = 0xff;
/** The bits overlay 9 never reads. */
export const ATTR_UNREAD = 0x7f00;

export function readAttrGrid(bytes: Uint8Array, support: DwSupport, where: string): Uint16Array {
  const { tilesVertical: v, tilesHorizontal: h, bounds: b, kind } = support;
  if (bytes.length !== v * h * 2) throw new DistortionFormatError(`${where}: ${bytes.length} bytes for a ${v}×${h} grid`);
  const wall = kind === 'west-wall' || kind === 'east-wall';
  const flat = wall ? b.sizeX : b.sizeY;
  const vertical = wall ? b.sizeY : b.sizeX;
  if (flat !== 0) throw new DistortionFormatError(`${where}: a ${kind} with ${wall ? 'X' : 'Y'} size ${flat}`);
  if (vertical < 0 || vertical >= v || b.sizeZ < 0 || b.sizeZ >= h) throw new DistortionFormatError(`${where}: bounds ${vertical}×${b.sizeZ} do not fit the ${v}×${h} grid`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Uint16Array.from({ length: v * h }, (_, i) => view.getUint16(i * 2, true));
}
