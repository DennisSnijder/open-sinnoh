/**
 * Lazy chunks (the game, the battle engine). A failed chunk load is retried once: a dropped connection
 * recovers. A tab left open across a deploy asks for files of the old build, which are gone, so the retry
 * fails too and the error goes on to the crash screen, which offers a reload (OPEN-SINNOH-2).
 */
export function isChunkError(e: unknown): boolean {
  return e instanceof Error && /dynamically imported module|Importing a module script failed|error loading dynamically imported/i.test(e.message);
}

export function loadChunk<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((e: unknown) => {
    if (!isChunkError(e)) throw e;
    console.warn('chunk load failed, retrying once:', (e as Error).message);
    return load();
  });
}
