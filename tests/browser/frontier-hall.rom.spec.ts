/**
 * The Battle Hall in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): sys-hall-single through
 * `window.openSinnohGame` (frontier-facility.ts). The party pick is the order mode of the party screen; the type board
 * is its DS screen from the ROM's art (the 20 cells as buttons) inside the screen; the battle is on the BATTLE_HALL
 * backdrop; the battle room (scene 10) is drawn after it; the corridor (9) and the battle room are the scenes drawn,
 * each in its frame.
 */
import { expect } from '@playwright/test';
import type { PartyView } from '@opensinnoh/contracts';
import { screenProblems } from './fit.ts';
import { frame } from './frontier-scene.ts';
import { appView, dsAppDrawn, facilityBattle, facilityRoom, facilitySpec } from './frontier-facility.ts';
import { settle } from './settle.ts';

facilitySpec(
  'sys-hall-single',
  'test-artifacts/frontier-hall',
  {
    'hall-party': async (page, name) => {
      const v = (await appView(page)) as PartyView | null;
      expect(v?.mode, name).toBe('order');
      await page.waitForSelector('.party-order-button', { timeout: 20_000 });
      await settle(page);
      expect(await screenProblems(page), name).toEqual([]);
    },
    'hall-corridor': async (page, name) => {
      await frame(page);
      expect((await page.evaluate(() => window.openSinnohGame!.snapshot().view.frontier))?.scene, name).toBe(9);
    },
    'hall-board': (page, name) => dsAppDrawn(page, name, 'hall-board', '.frontier-cell', 20),
    'hall-battle': (page, name) => facilityBattle(page, name, 'HALL'),
    'hall-room': (page, name) => facilityRoom(page, name, 10),
  },
  [9, 10],
);
