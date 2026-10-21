import { checkReferences, loadGamePacks, type Diagnostic } from '@opensinnoh/game';
import type { LabelOverride } from '@opensinnoh/core';
import { assetExists, loadWorkspace } from './workspace.ts';

export interface CheckResult {
  pack: string;
  ok: boolean;
  loadOrder: { id: string; version: string }[];
  overrides: LabelOverride[];
  diagnostics: Diagnostic[];
}

/** Loads the pack with its dependencies, validates every record, and checks references. */
export function checkPack(packDir: string, dependencies: Record<string, string> = {}): CheckResult {
  let pack = packDir;
  try {
    const ws = loadWorkspace(packDir, dependencies);
    pack = ws.pack;
    const game = loadGamePacks(ws.packs);
    const diagnostics = checkReferences(game, (ref) => assetExists(ws, ref));
    return { pack, ok: !diagnostics.some((d) => d.severity === 'error'), loadOrder: game.loaded.order, overrides: game.loaded.overrides, diagnostics };
  } catch (e) {
    return { pack, ok: false, loadOrder: [], overrides: [], diagnostics: [{ severity: 'error', location: packDir, message: (e as Error).message }] };
  }
}

export function checkSummary(r: CheckResult): string {
  const count = (s: Diagnostic['severity']) => r.diagnostics.filter((d) => d.severity === s).length;
  return `${r.pack}: ${r.ok ? 'ok' : 'FAILED'} (${count('error')} errors, ${count('warning')} warnings, ${r.loadOrder.length} packs, ${r.overrides.length} label overrides)`;
}
