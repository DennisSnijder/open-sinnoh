/** Vitest global setup: no importer module graph unless this run uses a ROM. */
export default async function setup(): Promise<void> {
  if (!process.env.OPENSINNOH_NDS_ROM) return;
  const { prepareRomCache } = await import('./rom.ts');
  await prepareRomCache();
}
