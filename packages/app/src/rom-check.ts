/** ROM file boundary: size bounds and whole-file SHA1 against the supported list. */
import { readHeader, sha1Hex, SUPPORTED_ROMS, type SupportedRom } from '@opensinnoh/nds';
import { S } from './strings/index.ts';

const MIN_ROM_BYTES = 0x200;
const MAX_ROM_BYTES = 512 * 1024 * 1024;
const SUPPORTED_NAMES = Object.values(SUPPORTED_ROMS)
  .map((r) => r.name)
  .join(', ');

/** Cheap check before reading the file into memory. Returns an error message or null. */
export function checkRomSize(size: number): string | null {
  if (size < MIN_ROM_BYTES) return S.rom.tooSmall(size);
  if (size > MAX_ROM_BYTES) return S.rom.tooLarge(Math.round(size / 1048576));
  return null;
}

export type RomCheck = { ok: true; sha1: string; rom: SupportedRom } | { ok: false; sha1: string; message: string };

export async function verifyRom(bytes: Uint8Array): Promise<RomCheck> {
  const sizeError = checkRomSize(bytes.byteLength);
  const sha1 = await sha1Hex(bytes);
  if (sizeError) return { ok: false, sha1, message: sizeError };
  const rom = SUPPORTED_ROMS[sha1];
  if (rom) return { ok: true, sha1, rom };
  const header = readHeader(bytes);
  const code = /^[A-Z0-9]{4}$/.test(header.gameCode) ? S.rom.gameCode(header.gameCode, header.version) : '';
  return { ok: false, sha1, message: S.rom.notSupported(code, SUPPORTED_NAMES) };
}
