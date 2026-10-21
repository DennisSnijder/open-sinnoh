/**
 * Title and main-menu labels: Platinum message names (decomp TEXT_BANK_MAIN_MENU_OPTIONS) looked up in
 * the base pack's namespace, like the in-game UI (ui/strings.ts). The fixture carries original strings
 * under the same names. A missing one fails when the title opens.
 */
import type { Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { plainText } from '../ui/strings.ts';

export const TITLE_TEXT = {
  continue: 'MainMenuOptions_Text_Continue',
  newGame: 'MainMenuOptions_Text_NewGame',
  mysteryGift: 'MainMenuOptions_Text_MysteryGift',
  player: 'MainMenuOptions_Text_Player',
  time: 'MainMenuOptions_Text_Time',
  badges: 'MainMenuOptions_Text_Badges',
  pokedex: 'MainMenuOptions_Text_Pokedex',
  /** {var 0} = player name. */
  playerName: 'MainMenuOptions_Text_PlayerName',
  /** {var 0} = hours, {var 1} = minutes. */
  playTime: 'MainMenuOptions_Text_PlayTime',
  /** {var 0} = badge count. */
  badgeCount: 'MainMenuOptions_Text_BadgeCount',
  dashes: 'TrainerCard_Text_TwoDashes',
  /** The start menu's OPTIONS, for the main menu's Options window (the DS lists Nintendo WFC settings there). */
  options: 'StartMenu_Text_Options',
} as const;

export type TitleKey = keyof typeof TITLE_TEXT;

export class TitleStrings {
  constructor(
    private readonly texts: Registries['texts'],
    private readonly ns: string,
  ) {
    const missing = Object.values(TITLE_TEXT).filter((n) => !texts.has(this.id(n)));
    if (missing.length) throw new Error(`title: the ${ns} pack has no text for ${missing.map((n) => this.id(n)).join(', ')}`);
  }

  private id(name: string): Id {
    return `${this.ns}:${name}` as Id;
  }

  t(key: TitleKey, ...slots: string[]): string {
    return plainText(this.texts.get(this.id(TITLE_TEXT[key]))!.text, slots);
  }
}
