/** What the player reads when a save file cannot be used (Options › Data › Import save). */
import { NewerSaveError, NotASaveError, PackMismatchError, SaveError } from '@opensinnoh/game';

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
    const parts = ['This save was made with a different set of packs.'];
    if (missing.length) parts.push(`It needs ${list(missing)}, which ${missing.length > 1 ? 'are' : 'is'} not loaded: turn that mod on, or import the ROM it was made with.`);
    if (otherVersion.length) parts.push(`It was made with another version of ${list(otherVersion.map(idOf))} (the save has ${list(otherVersion)}).`);
    if (without.length) parts.push(`It was made without ${list(without)}: turn ${without.length > 1 ? 'those mods' : 'that mod'} off, then import it again.`);
    return parts.join(' ');
  }
  if (e instanceof SaveError) return `This save file is damaged or incomplete (${e.message.replace(/^invalid save: /, '')}). Your current save was not changed.`;
  throw e;
}
