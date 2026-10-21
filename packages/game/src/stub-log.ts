import type { StubLog } from '@opensinnoh/contracts';

/** Logs each stub key once (through `sink`) and counts every use, for coverage reports. */
export class CountingStubLog implements StubLog {
  readonly counts = new Map<string, number>();

  constructor(private readonly sink: (line: string) => void = (line) => console.warn(line)) {}

  stub(key: string, detail?: string): void {
    const n = this.counts.get(key) ?? 0;
    if (n === 0) this.sink(`[stub] ${key}${detail ? `: ${detail}` : ''}`);
    this.counts.set(key, n + 1);
  }

  /** Sorted `{key, count}` list. */
  report(): { key: string; count: number }[] {
    return [...this.counts].map(([key, count]) => ({ key, count })).sort((a, b) => a.key.localeCompare(b.key));
  }
}
