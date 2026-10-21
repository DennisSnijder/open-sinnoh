/**
 * The scene's words (pure, unit-tested). The DS asks with bank 360 entries 1–3 ("{COLOR 3}Tiny Leaf
 * Pokémon TURTWIG{COLOR 0}!\nWill you take this Pokémon?"), one per slot, each naming the species it was
 * written for. Mods move species between slots, so the ask for a slot is the entry that names the species
 * now there; when none does, it is the species' name and the slot entry's question line.
 */
import { parseTextMarkup } from '@opensinnoh/contracts';

/** A run of characters in one message colour (0 = the default ink; n = palette colours 1 + 2n, 2 + 2n). */
export interface Run {
  text: string;
  color: number;
}

/** Markup → lines of colour runs; other control codes ({clear}, {var}, …) are not shown. */
export function colourLines(markup: string): Run[][] {
  const lines: Run[][] = [[]];
  let color = 0;
  for (const t of parseTextMarkup(markup)) {
    if (t.kind === 'newline') lines.push([]);
    else if (t.kind === 'color') color = t.value;
    else if (t.kind === 'chars') lines[lines.length - 1]!.push({ text: t.value, color });
  }
  return lines;
}

export const plain = (markup: string): string =>
  colourLines(markup)
    .map((l) => l.map((r) => r.text).join(''))
    .join('\n');

/**
 * The ask for `slot`: `asks` are the bank's entries 1–3 (markup), `name` the species' name now there.
 */
export function askMarkup(asks: readonly string[], slot: number, name: string): string {
  const word = new RegExp(`(?<!\\p{L})${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\p{L})`, 'iu');
  const own = asks.find((a) => word.test(plain(a).split('\n')[0]!));
  if (own) return own;
  const question = asks[slot]?.split('\n').slice(1).join('\n');
  if (question === undefined) throw new Error(`starter scene: no ask message for slot ${slot}`);
  return `${name}!\n${question}`;
}
