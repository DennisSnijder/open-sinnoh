/**
 * The command card's labels from the base pack's texts (docs/decisions.md): the DS bottom screen's words are
 * in the battle strings bank. A pack that lacks one fails when the card is first used.
 */
import type { Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { plainText } from '@opensinnoh/menus';

export const CARD_TEXT = {
  battleFight: 'BattleStrings_Text_Fight',
  battleBag: 'BattleStrings_Text_Bag',
  battlePokemon: 'BattleStrings_Text_Pokemon',
  battleRun: 'BattleStrings_Text_Run',
  battleBall: 'BattleStrings_Text_Ball',
  battleBait: 'BattleStrings_Text_Bait',
  battleMud: 'BattleStrings_Text_Mud',
  battleCancel: 'BattleStrings_Text_Cancel',
  battlePp: 'BattleParty_Text_MovePPLabel',
  battleYes: 'OptionsMenu_Text_ConfirmDialogYes',
  battleNo: 'OptionsMenu_Text_ConfirmDialogNo',
} as const;

export type CardKey = keyof typeof CARD_TEXT;

export class CardStrings {
  constructor(
    private readonly registries: Pick<Registries, 'texts' | 'newGame'>,
  ) {
    const missing = Object.values(CARD_TEXT).filter((n) => !registries.texts.has(this.id(n)));
    if (missing.length) throw new Error(`battle card: the packs have no text for ${missing.map((n) => this.id(n)).join(', ')}`);
  }

  private id(name: string): Id {
    const record = [...this.registries.newGame.keys()][0]!;
    return `${record.slice(0, record.indexOf(':'))}:${name}` as Id;
  }

  t(key: CardKey): string {
    return plainText(this.registries.texts.get(this.id(CARD_TEXT[key]))!.text);
  }
}
