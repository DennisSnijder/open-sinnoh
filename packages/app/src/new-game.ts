/**
 * New-game settings (the naming screen's names and gender), stored per device. Player input and the
 * stored copy are both validated here: DS names are 1–7 characters, and every character must be one the
 * message font can draw.
 */
import type { NewGameOptions } from '@opensinnoh/game';

export const NAME_MAX = 7;
const KEY = 'lantern-nds:new-game'; // pre-rename name, kept: players' stored data uses it

/** Player-facing error for unusable new-game settings. */
export class NewGameSettingsError extends Error {}

function checkName(label: string, value: unknown, fontChars: string): string {
  if (typeof value !== 'string') throw new NewGameSettingsError(`${label} is missing.`);
  const chars = [...value];
  if (chars.length < 1 || chars.length > NAME_MAX) throw new NewGameSettingsError(`${label} must be 1 to ${NAME_MAX} characters.`);
  const bad = [...new Set(chars.filter((c) => !fontChars.includes(c)))];
  if (bad.length) throw new NewGameSettingsError(`${label} uses characters the game cannot show: ${bad.join(' ')}`);
  return value;
}

/** Validates settings from the form or from storage against the message font's characters. */
export function checkNewGame(input: unknown, fontChars: string): NewGameOptions {
  const o = (input ?? {}) as { names?: { player?: unknown; rival?: unknown }; gender?: unknown };
  const player = checkName('Your name', o.names?.player, fontChars);
  const rival = checkName("Your rival's name", o.names?.rival, fontChars);
  if (o.gender !== 'male' && o.gender !== 'female') throw new NewGameSettingsError('Pick a gender.');
  return { names: { player, rival }, gender: o.gender };
}

/** The stored settings (unvalidated JSON), or null when none are stored. Throws when storage is unavailable or the entry is not JSON. */
export function readNewGame(): unknown {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch (e) {
    throw new NewGameSettingsError(`This browser blocks storage: ${(e as Error).message}`);
  }
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new NewGameSettingsError('The stored new-game settings are corrupt.');
  }
}

export function storeNewGame(settings: NewGameOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) {
    throw new NewGameSettingsError(`Could not store the settings: ${(e as Error).message}`);
  }
}
