/** Playwright global setup: the shared ROM import (tests/rom.ts), slice and full, once per run; nothing without OPENSINNOH_NDS_ROM. */
import { prepareRomCache } from '../rom.ts';

export default async function setup(): Promise<void> {
  await prepareRomCache({ full: true });
}
