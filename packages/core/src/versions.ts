/**
 * Minimal semver: exact `1.2.3`, `*`, `x`, comparators (`>=1.0.0 <2.0.0`), `^`, `~`, and `||`.
 * Anything else throws (pack manifests are a boundary).
 */
type V = [number, number, number];

function parse(v: string): V {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
  if (!m) throw new Error(`invalid version "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cmp(a: V, b: V): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function satisfiesComparator(v: V, c: string): boolean {
  if (c === '*' || c === 'x') return true;
  if (c.startsWith('^')) {
    const b = parse(c.slice(1));
    const upper: V = b[0] > 0 ? [b[0] + 1, 0, 0] : b[1] > 0 ? [0, b[1] + 1, 0] : [0, 0, b[2] + 1];
    return cmp(v, b) >= 0 && cmp(v, upper) < 0;
  }
  if (c.startsWith('~')) {
    const b = parse(c.slice(1));
    return cmp(v, b) >= 0 && cmp(v, [b[0], b[1] + 1, 0]) < 0;
  }
  const m = /^(>=|<=|>|<|=)?(.+)$/.exec(c);
  if (!m) throw new Error(`invalid version range "${c}"`);
  const d = cmp(v, parse(m[2] as string));
  switch (m[1]) {
    case '>=':
      return d >= 0;
    case '<=':
      return d <= 0;
    case '>':
      return d > 0;
    case '<':
      return d < 0;
    default:
      return d === 0;
  }
}

export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  return range.split('||').some((alt) => {
    const parts = alt.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) throw new Error(`invalid version range "${range}"`);
    return parts.every((c) => satisfiesComparator(v, c));
  });
}
