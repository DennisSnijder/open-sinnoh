/**
 * The Battle Factory in the app on the real ROM (OPENSINNOH_NDS_ROM; desktop and phone): sys-factory-single through
 * `window.openSinnohGame` (frontier-facility.ts). The rental app is its DS screen from the ROM's art (the conveyor,
 * the panel, the six balls as buttons) inside the screen; the battle is on the BATTLE_FACTORY backdrop; the battle
 * room (scene 4) is drawn after it; the corridor (3) and the battle room are the scenes drawn, each in its frame.
 */
import { dsAppDrawn, facilityBattle, facilityRoom, facilitySpec } from './frontier-facility.ts';

facilitySpec(
  'sys-factory-single',
  'test-artifacts/frontier-factory',
  {
    'factory-rent': (page, name) => dsAppDrawn(page, name, 'factory', '.frontier-ball', 6),
    'factory-battle': (page, name) => facilityBattle(page, name, 'FACTORY'),
    'factory-corridor': (page, name) => facilityRoom(page, name, 3),
  },
  [3, 4],
);
