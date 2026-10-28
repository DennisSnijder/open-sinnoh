import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NitroFs } from './rom.ts';
import { readNarc } from './narc.ts';
import { decodeMessageBank } from './message.ts';
import { sha1Hex } from './sha1.ts';
import { SUPPORTED_ROMS } from './supported-roms.ts';

const romPath = process.env.OPENSINNOH_NDS_ROM;

describe.skipIf(!romPath)('real ROM (OPENSINNOH_NDS_ROM)', () => {
  let rom: Uint8Array;
  beforeAll(() => { rom = new Uint8Array(readFileSync(romPath!)); });

  it('is a supported ROM', async () => {
    expect(SUPPORTED_ROMS[await sha1Hex(rom)]).toBeDefined();
  });

  it('walks NitroFS and decodes every message bank', async () => {
    const fs = new NitroFs(rom);
    expect(fs.header.gameCode).toBe(SUPPORTED_ROMS[await sha1Hex(rom)]!.gameCode);
    expect(fs.listPaths().length).toBeGreaterThan(300);
    const banks = readNarc(fs.file('/msgdata/pl_msg.narc'));
    expect(banks.length).toBe(724);
    for (const bank of banks) {
      for (const msg of decodeMessageBank(bank)) {
        if (msg.length) expect(msg[msg.length - 1]).toBe(0xffff);
      }
    }
  });
});
