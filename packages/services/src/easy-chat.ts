/**
 * Easy Chat words (decomp easy_chat_words.c): a word is its index across the word banks in sTextBanks order (the
 * species, move, type and ability names, then the trainer, people, greeting, lifestyle, feelings, tough and union
 * words), as EasyChatWord_FromBankAndEntry counts them. The script vars hold these ids.
 */
import { newGameRecord, type Registries } from '@opensinnoh/contracts';
import type { Id } from '@opensinnoh/core';

/** Decomp sTextBanks. */
export const EASY_CHAT_BANKS = [
  'TEXT_BANK_SPECIES_NAME',
  'TEXT_BANK_MOVE_NAMES_UPPERCASE',
  'TEXT_BANK_POKEMON_TYPE_NAMES',
  'TEXT_BANK_ABILITY_NAMES_UPPERCASE',
  'TEXT_BANK_TRAINER_WORDS',
  'TEXT_BANK_PEOPLE_WORDS',
  'TEXT_BANK_GREETINGS',
  'TEXT_BANK_LIFESTYLE_WORDS',
  'TEXT_BANK_FEELINGS',
  'TEXT_BANK_TOUGH_WORDS',
  'TEXT_BANK_UNION_WORDS',
] as const;
export type EasyChatBank = (typeof EASY_CHAT_BANKS)[number];

/** Decomp WORD_NONE: an empty blank. */
export const WORD_NONE = 0xffff;

function bankMessages(registries: Registries, bank: EasyChatBank): readonly Id[] {
  const ns = newGameRecord(registries).id.split(':')[0]!;
  const b = registries.textBanks.get(`${ns}:${bank}` as Id);
  if (!b) throw new Error(`easy chat: the pack has no ${bank}`);
  return b.messages;
}

/** Decomp EasyChatWord_FromBankAndEntry. */
export function easyChatWord(registries: Registries, bank: EasyChatBank, entry: number): number {
  let total = 0;
  for (const b of EASY_CHAT_BANKS) {
    if (b === bank) return total + entry;
    total += bankMessages(registries, b).length;
  }
  throw new Error(`easy chat: unknown bank ${bank}`);
}

/** Decomp EasyChatWord_GetLoaderIndexAndEntry: the word's text record. */
export function easyChatWordText(registries: Registries, word: number): Id {
  let rest = word & 0xfff;
  for (const b of EASY_CHAT_BANKS) {
    const messages = bankMessages(registries, b);
    if (rest < messages.length) return messages[rest]!;
    rest -= messages.length;
  }
  throw new Error(`easy chat: no word ${word}`);
}

/** The tough words' count (decomp TEXT_BANK_TOUGH_WORDS_ENTRY_COUNT): the bank's entries, at most the 32 bits of `GameState.unlockedToughWords`. */
export function toughWordCount(registries: Registries): number {
  const n = bankMessages(registries, 'TEXT_BANK_TOUGH_WORDS').length;
  if (n > 32) throw new Error(`easy chat: ${n} tough words do not fit the 32 unlock bits`);
  return n;
}

/** Decomp EasyChatWords_IsToughWordUnlocked: the tough word at bank entry `entry` is unlocked. */
export const isToughWordUnlocked = (bits: number, entry: number): boolean => ((bits >>> entry) & 1) === 1;

/** Decomp EasyChatWords_AreAllToughWordsUnlocked. */
export function allToughWordsUnlocked(registries: Registries, bits: number): boolean {
  const n = toughWordCount(registries);
  for (let i = 0; i < n; i++) if (!isToughWordUnlocked(bits, i)) return false;
  return true;
}

/**
 * Decomp EasyChatWords_TryUnlockRandomToughWord: `random()` (LCRNG_Next) % the locked count picks among the locked
 * tough words in bank order. The new bits and the word's bank entry, or null when every word is unlocked (no draw).
 */
export function unlockRandomToughWord(registries: Registries, bits: number, random: () => number): { bits: number; entry: number } | null {
  const locked = Array.from({ length: toughWordCount(registries) }, (_, i) => i).filter((i) => !isToughWordUnlocked(bits, i));
  if (!locked.length) return null;
  const entry = locked[(random() >>> 0) % locked.length]!;
  return { bits: (bits | (1 << entry)) >>> 0, entry };
}
