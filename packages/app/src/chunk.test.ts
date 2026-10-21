import { describe, expect, it, vi } from 'vitest';
import { isChunkError, loadChunk } from './chunk.ts';

const stale = () => new TypeError('Failed to fetch dynamically imported module: https://x/assets/game-view-abc.js');

describe('loadChunk', () => {
  it('retries a failed chunk load once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(stale()).mockResolvedValueOnce('ok');
    await expect(loadChunk(load)).resolves.toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('passes the second failure on (the crash screen offers a reload)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(stale());
    await expect(loadChunk(load)).rejects.toSatisfy(isChunkError);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not retry other errors', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('boom'));
    await expect(loadChunk(load)).rejects.toThrow('boom');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
