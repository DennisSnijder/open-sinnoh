import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NitroFs } from './rom.ts';
import { readNarc } from './narc.ts';
import { sha1Hex } from './sha1.ts';
import { HGSS_ROMS, SUPPORTED_ROMS } from './supported-roms.ts';

const romPath = process.env.OPENSINNOH_HGSS_ROM;
const sha1 = (b: Uint8Array) => createHash('sha1').update(b).digest('hex');

/** HeartGold/SoulSilver's executables and archives (OPENSINNOH_HGSS_ROM; docs/research/hgss-import.md §1 measurements). */
describe.skipIf(!romPath)('HGSS ROM (OPENSINNOH_HGSS_ROM)', () => {
  let rom: Uint8Array;
  beforeAll(() => { rom = new Uint8Array(readFileSync(romPath!)); });

  it('is a pinned HGSS identity and not a base game', async () => {
    const hash = await sha1Hex(rom);
    const id = HGSS_ROMS[hash];
    expect(id).toBeDefined();
    expect(SUPPORTED_ROMS[hash]).toBeUndefined();
    const fs = new NitroFs(rom);
    expect(fs.header.gameCode).toBe(id!.gameCode);
    expect(fs.header.version).toBe(0);
  });

  it('decompresses the ARM9 to the measured length, with the follower lookup tables where measured', () => {
    const fs = new NitroFs(rom);
    const arm9 = fs.arm9Code();
    expect(arm9.length).toBe(0x111ef8);
    // sModelIndexLUT (494 u16), sFormMaxLUT and sFemaleFlagLUT (493 u16 each): the regions' SHA-1s.
    expect(sha1(arm9.subarray(0xff088, 0xff088 + 494 * 2))).toBe('b0fff4bae3bcd841615513edf4a3e0771fb9b5f4');
    expect(sha1(arm9.subarray(0xfe8d4, 0xfe8d4 + 493 * 2))).toBe('fb9b318f5706c838c4e551ac7e5351ff1127de03');
    expect(sha1(arm9.subarray(0xfecae, 0xfecae + 493 * 2))).toBe('0cf18f786e0a80a472f5b5c81644261a026c75df');
  });

  it('decompresses every overlay to its table size (127 of 129 compressed)', () => {
    const fs = new NitroFs(rom);
    const overlays = fs.overlays();
    expect(overlays).toHaveLength(129);
    expect(overlays.filter((o) => o.compressed)).toHaveLength(127);
    for (const o of overlays) expect(fs.overlayCode(o.id).length).toBe(o.ramSize);
  });

  it('holds the follower archives: mmodel 863 members, follower parameters 566', () => {
    const fs = new NitroFs(rom);
    expect(readNarc(fs.file('/a/0/8/1'))).toHaveLength(863);
    expect(readNarc(fs.file('/a/1/4/1'))).toHaveLength(566);
  });
});
