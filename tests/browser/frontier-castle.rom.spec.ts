/**
 * The Battle Castle in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): sys-castle-single through
 * `window.openSinnohGame` (frontier-facility.ts). The party pick is the order mode of the party screen; the opponent's
 * and the player's apps are their DS screens from the ROM's art (the three Pokémon and EXIT as buttons, the rental
 * list as rows) inside the screen; the battle is on the BATTLE_CASTLE backdrop. The challenge's menu is in the
 * corridor (FRONTIER_SCENE_CASTLE_CORRIDOR), before and after the battle; the corridor and the battle room are the
 * scenes drawn, each in its frame.
 */
import { expect } from '@playwright/test';
import type { PartyView } from '@opensinnoh/contracts';
import { screenProblems } from './fit.ts';
import { frame } from './frontier-scene.ts';
import { appView, dsAppDrawn, facilityBattle, facilityRoom, facilitySpec } from './frontier-facility.ts';
import { settle } from './settle.ts';

const CORRIDOR = 11;
const ROOM = 12;

facilitySpec(
  'sys-castle-single',
  'test-artifacts/frontier-castle',
  {
    'castle-party': async (page, name) => {
      const v = (await appView(page)) as PartyView | null;
      expect(v?.mode, name).toBe('order');
      await page.waitForSelector('.party-order-button', { timeout: 20_000 });
      await settle(page);
      expect(await screenProblems(page), name).toEqual([]);
    },
    'castle-corridor': async (page, name) => {
      await frame(page);
      expect((await page.evaluate(() => window.openSinnohGame!.snapshot().view.frontier))?.scene, name).toBe(CORRIDOR);
    },
    'castle-room': (page, name) => facilityRoom(page, name, CORRIDOR),
    'castle-opponent': (page, name) => dsAppDrawn(page, name, 'castle', '.frontier-tap', 4),
    'castle-self': (page, name) => dsAppDrawn(page, name, 'castle', '.frontier-tap', 4),
    'castle-rental': (page, name) => dsAppDrawn(page, name, 'castle', '.frontier-row', 6),
    'castle-battle': (page, name) => facilityBattle(page, name, 'CASTLE'),
    'castle-after': (page, name) => facilityRoom(page, name, CORRIDOR),
  },
  [CORRIDOR, ROOM],
);
