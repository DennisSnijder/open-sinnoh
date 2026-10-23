/**
 * The Battle Arcade in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): sys-arcade-single through
 * `window.openSinnohGame` (frontier-facility.ts). The party pick is the order mode of the party screen; the game board
 * is its DS screen from the ROM's art (the STOP button as a button) inside the screen, the button live while the
 * cursor runs; the battle is on the BATTLE_ARCADE backdrop; the battle room is drawn after it; the corridor and the
 * battle room are the scenes drawn, each in its frame.
 */
import { expect } from '@playwright/test';
import type { ArcadeView, PartyView } from '@opensinnoh/contracts';
import { screenProblems } from './fit.ts';
import { frame } from './frontier-scene.ts';
import { appView, dsAppDrawn, facilityBattle, facilityRoom, facilitySpec } from './frontier-facility.ts';
import { settle } from './settle.ts';

const CORRIDOR = 15;
const ROOM = 16;

facilitySpec(
  'sys-arcade-single',
  'test-artifacts/frontier-arcade',
  {
    'arcade-party': async (page, name) => {
      const v = (await appView(page)) as PartyView | null;
      expect(v?.mode, name).toBe('order');
      await page.waitForSelector('.party-order-button', { timeout: 20_000 });
      await settle(page);
      expect(await screenProblems(page), name).toEqual([]);
    },
    'arcade-corridor': async (page, name) => {
      await frame(page);
      expect((await page.evaluate(() => window.openSinnohGame!.snapshot().view.frontier))?.scene, name).toBe(CORRIDOR);
    },
    'arcade-board': (page, name) => dsAppDrawn(page, name, 'arcade', '.frontier-stop', 1),
    'arcade-roulette': async (page, name) => {
      await dsAppDrawn(page, name, 'arcade', '.frontier-stop', 1);
      expect(((await appView(page)) as ArcadeView).button, name).toBe(0);
      await expect(page.locator('.frontier-stop'), name).toBeEnabled();
    },
    'arcade-effect': (page, name) => facilityRoom(page, name, ROOM),
    'arcade-battle': (page, name) => facilityBattle(page, name, 'ARCADE'),
    'arcade-after': (page, name) => facilityRoom(page, name, ROOM),
  },
  [CORRIDOR, ROOM],
);
