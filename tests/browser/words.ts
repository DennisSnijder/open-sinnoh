/**
 * The words a spec expects, looked up rather than written out, so a check holds on every supported ROM: the parts of a
 * message that do not change with its slots.
 */

/** A message's longest run of its own words: `fill` builds it with every slot a line break, then it is split at those and its own breaks. */
export function fixedPart(fill: (...slots: string[]) => string): string {
  return fill(...Array<string>(8).fill('\n'))
    .split('\n')
    .map((s) => s.trim())
    .reduce((a, b) => (b.length > a.length ? b : a));
}
