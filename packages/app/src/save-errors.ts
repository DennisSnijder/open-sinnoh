/** What the player reads when a save file cannot be used (Options › Data › Import save). */
import { NewerSaveError, NotASaveError, PackMismatchError, SaveError } from '@opensinnoh/game';
import { S } from './strings/index.ts';

const idOf = (pack: string) => pack.slice(0, pack.lastIndexOf('@'));
const list = (packs: readonly string[]) => packs.join(', ');

/** The message for an error `game.load` or `saveFromJson` threw for a save file. Errors that are not about the file are rethrown. */
export function saveImportMessage(e: unknown): string {
  if (e instanceof NotASaveError || e instanceof NewerSaveError) return e.message;
  if (e instanceof PackMismatchError) {
    const extraIds = new Set(e.extra.map(idOf));
    const neededIds = new Set(e.needed.map(idOf));
    const otherVersion = e.needed.filter((p) => extraIds.has(idOf(p)));
    const missing = e.needed.filter((p) => !extraIds.has(idOf(p)));
    const without = e.extra.filter((p) => !neededIds.has(idOf(p)));
    const parts = [S.saveErrors.otherPacks];
    if (missing.length) parts.push(S.saveErrors.needs(list(missing), missing.length > 1));
    if (otherVersion.length) parts.push(S.saveErrors.otherVersion(list(otherVersion.map(idOf)), list(otherVersion)));
    if (without.length) parts.push(S.saveErrors.without(list(without), without.length > 1));
    return parts.join(' ');
  }
  if (e instanceof SaveError) return S.saveErrors.damaged(e.message.replace(/^invalid save: /, ''));
  throw e;
}
