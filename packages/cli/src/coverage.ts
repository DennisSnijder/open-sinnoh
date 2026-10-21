/**
 * `opensinnoh coverage <pack> [--zones <regex>]`: which script ops the pack can reach, and how the VM handles
 * each (real, stub, unknown). Reachability starts at the zones' map scripts and their object, bg and coord
 * event labels, and follows every `label(...)` argument. Without `--zones` the roots are ROM-wide: also
 * the tile behaviours' scripts (interact and field move), the new-game scripts, and every script entry
 * (a label that is not an internal branch target `…/off_<hex>`): common scripts and field-move tasks are
 * entered by script id, not from a zone. It fails when an op tagged
 * `real: M1b` (or P, M3a, M3b, M2a, clock) in the VM's classification is not implemented, and reports
 * the M5 chunks' progress: their tagged ops done and the stubs left on each path.
 * Frontier scenes are reached through `launch_battle_frontier_scene`'s entry label; their `fr_*` commands are the
 * frontier VM's (`classifyFrontierOps`) and get their own line (`frontier`).
 */
import type { Id } from '@opensinnoh/core';
import type { Labels, Registries } from '@opensinnoh/contracts';
import { loadGamePacks } from '@opensinnoh/game';
import { classifyFrontierOps, classifyOps, m5Progress, type M5Progress } from '@opensinnoh/vm';
import { loadWorkspace } from './workspace.ts';

export type OpKind = 'real' | 'stub' | 'unknown';
export interface OpClass {
  kind: OpKind;
  /** The milestone that owns a stub (from the VM's classification), when known. */
  milestone?: string;
}

/** Classification from the VM's own export: implemented = real, stubbed = stub, the rest unknown. */
let byOp: Map<string, OpClass> | null = null;
export function classifyOp(op: string): OpClass {
  byOp ??= new Map([
    ...classifyOps().map((c) => [c.op, c.status === 'implemented' ? { kind: 'real' } : c.status === 'stubbed' ? { kind: 'stub', ...(c.milestone ? { milestone: c.milestone } : {}) } : { kind: 'unknown' }] as const),
    ...classifyFrontierOps().map((c) => [c.op, { kind: c.status === 'implemented' ? 'real' : c.status === 'stubbed' ? 'stub' : 'unknown' }] as const),
  ] as [string, OpClass][]);
  return byOp.get(op) ?? { kind: 'unknown' };
}

export interface CoverageResult {
  pack: string;
  zones: { matched: number; regex: string | null };
  /** `zones`: labels reachable from the zones alone; the rest are the ROM-wide extra roots (0 with `--zones`). */
  roots: { zones: number; behaviors: number; newGame: number; entries: number };
  labels: number;
  ops: { distinct: number; instances: number; real: number; stub: number; unknown: number };
  /** Uses (instances) of each kind. */
  uses: { real: number; stub: number; unknown: number };
  byOp: { op: string; uses: number; kind: OpKind; milestone?: string }[];
  /** Ops tagged real (M1b, P, M3a, M3b, M2a, clock) that the VM does not implement, as `op (tag)` (the verb fails when any). */
  realMissing: string[];
  /** Per M5 chunk: the story path's stubs and the chunk's tagged ops done (progress, not a failure). */
  m5: M5Progress[];
  /** The frontier VM's share of `byOp` (its `fr_*` commands): distinct ops and uses by kind. */
  frontier: { distinct: number; real: number; stub: number; unknown: number; uses: { real: number; stub: number; unknown: number } };
}

/** Internal branch targets (contracts "Names": `platinum:<FileName>/off_<hex>`) are not entries. */
const INTERNAL = /\/off_[0-9a-f]+$/;

/** ROM-wide root labels besides the zones': tile behaviour scripts, new-game scripts, script entries. */
export function romRoots(registries: Registries, labels: Labels): { behaviors: Id[]; newGame: Id[]; entries: Id[] } {
  const behaviors = [...registries.tileBehaviors.values()].flatMap((b) => [b.interact?.label, b.fieldMove?.label].filter((l): l is Id => !!l));
  const newGame = [...registries.newGame.values()].flatMap((n) => [n.label, n.trainerApproach].filter((l): l is Id => !!l));
  return { behaviors, newGame, entries: [...labels.keys()].filter((id) => !INTERNAL.test(id)) };
}

/** Labels reachable from the given zones (map scripts and events) and extra roots, then label args transitively. */
export function reachableLabels(registries: Registries, labels: Labels, zones: Iterable<Id>, extra: Iterable<Id> = []): Set<Id> {
  const seen = new Set<Id>();
  const queue: Id[] = [];
  const add = (id: Id | undefined) => {
    if (id && !seen.has(id) && labels.has(id)) {
      seen.add(id);
      queue.push(id);
    }
  };
  for (const id of extra) add(id);
  for (const zoneId of zones) {
    const z = registries.zones.get(zoneId)!;
    add(z.mapScripts.onLoad);
    add(z.mapScripts.onTransition);
    add(z.mapScripts.onResume);
    for (const row of z.mapScripts.onFrame) add(row.label);
    for (const o of z.events.objects) add(o.label);
    for (const b of z.events.bgs) add(b.label);
    for (const c of z.events.coords) add(c.label);
  }
  while (queue.length) {
    for (const cmd of labels.get(queue.pop()!)!.commands) for (const a of cmd.args) if (a.kind === 'label') add(a.id);
  }
  return seen;
}

export function coverageReport(packDir: string, dependencies: Record<string, string>, zoneRegex: string | null): CoverageResult {
  const ws = loadWorkspace(packDir, dependencies);
  const { registries, labels } = loadGamePacks(ws.packs);
  const re = zoneRegex === null ? null : new RegExp(zoneRegex);
  const zones = [...registries.zones.keys()].filter((id) => !re || re.test(id));
  const rom = re ? { behaviors: [], newGame: [], entries: [] } : romRoots(registries, labels);
  const reach = reachableLabels(registries, labels, zones, [...rom.behaviors, ...rom.newGame, ...rom.entries]);
  const uses = new Map<string, number>();
  for (const id of reach) for (const cmd of labels.get(id)!.commands) uses.set(cmd.op, (uses.get(cmd.op) ?? 0) + 1);
  const byOp = [...uses]
    .map(([op, n]) => ({ op, uses: n, ...classifyOp(op) }))
    .sort((a, b) => b.uses - a.uses || a.op.localeCompare(b.op));
  const count = (k: OpKind) => byOp.filter((o) => o.kind === k);
  const sum = (k: OpKind) => count(k).reduce((n, o) => n + o.uses, 0);
  return {
    pack: ws.pack,
    zones: { matched: zones.length, regex: zoneRegex },
    roots: { zones: reachableLabels(registries, labels, zones).size, behaviors: rom.behaviors.length, newGame: rom.newGame.length, entries: rom.entries.length },
    labels: reach.size,
    ops: { distinct: byOp.length, instances: byOp.reduce((n, o) => n + o.uses, 0), real: count('real').length, stub: count('stub').length, unknown: count('unknown').length },
    uses: { real: sum('real'), stub: sum('stub'), unknown: sum('unknown') },
    byOp,
    realMissing: classifyOps()
      .filter((c) => c.real !== undefined && !/^M[56]/.test(c.real) && c.status !== 'implemented')
      .map((c) => `${c.op} (${c.real})`),
    m5: m5Progress(),
    frontier: kinds(byOp.filter((o) => o.op.startsWith('fr_'))),
  };
}

function kinds(ops: CoverageResult['byOp']): CoverageResult['frontier'] {
  const of = (k: OpKind) => ops.filter((o) => o.kind === k);
  const sum = (k: OpKind) => of(k).reduce((n, o) => n + o.uses, 0);
  return { distinct: ops.length, real: of('real').length, stub: of('stub').length, unknown: of('unknown').length, uses: { real: sum('real'), stub: sum('stub'), unknown: sum('unknown') } };
}

export function coverageSummary(r: CoverageResult): string {
  const top = r.byOp
    .filter((o) => o.kind === 'unknown')
    .slice(0, 10)
    .map((o) => `${o.op} ${o.uses}`)
    .join(', ');
  const roots = r.zones.regex === null ? ` (ROM-wide roots: ${r.roots.zones} zone labels, +${r.roots.behaviors} behaviour, +${r.roots.newGame} new-game, +${r.roots.entries} entry labels)` : '';
  const missing = r.realMissing.length ? `\n  FAIL: tagged real ops not implemented: ${r.realMissing.join(', ')}` : '';
  const m5 = r.m5
    .map((c) => {
      const left = c.missing.filter((m) => m.real).map((m) => m.op);
      const other = c.missing.filter((m) => !m.real).map((m) => m.op);
      return `\n  ${c.chunk}: ${c.realDone.length}/${c.real} tagged ops real; ${c.path - c.missing.length}/${c.path} path ops implemented${left.length ? `; to make real: ${left.join(', ')}` : ''}${other.length ? `; other owners: ${other.join(', ')}` : ''}`;
    })
    .join('');
  const f = r.frontier;
  const fr = f.distinct
    ? `\n  frontier: ${f.distinct} distinct fr ops: ${f.real} real, ${f.stub} stub, ${f.unknown} unimplemented (${f.uses.unknown} uses)${
        f.unknown ? `; unimplemented: ${r.byOp.filter((o) => o.op.startsWith('fr_') && o.kind === 'unknown').map((o) => `${o.op} ${o.uses}`).join(', ')}` : ''
      }`
    : '';
  return `${r.pack}: ${r.zones.matched} zones${r.zones.regex ? ` matching /${r.zones.regex}/` : ''}, ${r.labels} labels${roots}; ${r.ops.distinct} distinct ops (${r.ops.instances} uses): ${r.ops.real} real, ${r.ops.stub} stub, ${r.ops.unknown} unknown (${r.uses.unknown} uses)${top ? `\n  most used unknown: ${top}` : ''}${fr}${m5}${missing}`;
}
