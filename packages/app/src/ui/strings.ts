/**
 * App-side labels from the base pack's texts (docs/decisions.md): the Pokétch app names. The menu apps get
 * their labels from packages/menus (their views carry plain strings). A pack that lacks a name fails at
 * mount.
 */
import { POKETCH_APPS, poketchAppIndex, type Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';
import { plainText } from '@opensinnoh/menus';

export { plainText, POKETCH_APPS, poketchAppIndex };

const appNameMessage = (i: number) => `pl_msg_00000457_${String(i).padStart(5, '0')}`;

export class UiStrings {
  private readonly texts: Registries['texts'];

  /** `ns`: the base pack's namespace (the newGame record's). Checks that every Pokétch app name exists. */
  constructor(
    registries: Pick<Registries, 'texts'>,
    readonly ns: string,
  ) {
    this.texts = registries.texts;
    const missing = POKETCH_APPS.map((_, i) => appNameMessage(i)).filter((n) => !this.texts.has(this.id(n)));
    if (missing.length) throw new Error(`ui: the ${ns} pack has no text for ${missing.map((n) => this.id(n)).join(', ')}`);
  }

  private id(name: string): Id {
    return `${this.ns}:${name}` as Id;
  }

  poketchApp(id: Id): string {
    return plainText(this.texts.get(this.id(appNameMessage(poketchAppIndex(id))))!.text);
  }
}
