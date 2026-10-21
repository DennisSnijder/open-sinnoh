import { availableParallelism, totalmem } from 'node:os';

/** Native Playwright shard syntax; also used by the build and test workers via the environment. */
export function browserShard(args: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => arg === '--shard' || arg.startsWith('--shard='));
  if (index < 0) return undefined;
  const value = args[index] === '--shard' ? args[index + 1] : args[index]!.slice('--shard='.length);
  if (!value || !/^[1-9]\d*\/[1-9]\d*$/.test(value)) throw new Error('--shard must be current/total (positive integers)');
  const [current, total] = value.split('/').map(Number) as [number, number];
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(total) || current > total) throw new Error('--shard current must be <= total (safe integers)');
  return `${current}-of-${total}`;
}

export function browserWorkers(cores: number, memoryBytes: number, override?: string): number {
  if (override !== undefined) {
    const workers = Number(override);
    if (!/^[1-9]\d*$/.test(override) || !Number.isSafeInteger(workers)) throw new Error('OPENSINNOH_TEST_WORKERS must be a positive integer');
    return workers;
  }
  // The six-CPU sample favored modest oversubscription (docs/browser-tests.md).
  // Allow 4 workers per 3 CPUs, leaving 2 GiB for the build/OS,
  // then budget 2 GiB per worker (browser, ROM seed and Node worker together).
  return Math.max(1, Math.min(Math.floor(cores * 4 / 3), Math.floor((memoryBytes / 2 ** 30 - 2) / 2)));
}

export function machineBrowserWorkers(): number {
  const constrained = process.constrainedMemory();
  return browserWorkers(availableParallelism(), Math.min(totalmem(), constrained || Infinity), process.env.OPENSINNOH_TEST_WORKERS);
}

export function browserArtifacts(): string {
  return process.env.OPENSINNOH_TEST_SHARD ? `test-artifacts/shard-${process.env.OPENSINNOH_TEST_SHARD}` : 'test-artifacts';
}
