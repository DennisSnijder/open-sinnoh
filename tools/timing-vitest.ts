import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter, TestCase, TestModule } from 'vitest/node';

type Hook = Parameters<NonNullable<Reporter['onHookStart']>>[0];

/** Opt-in timing only; hook intervals include reporter delivery latency. */
export default class TimingReporter implements Reporter {
  private starts = new Map<string, number>();
  private rows: object[] = [];
  private key(hook: Hook): string { return `${hook.entity.id}:${hook.name}`; }
  onHookStart(hook: Hook): void { this.starts.set(this.key(hook), performance.now()); }
  onHookEnd(hook: Hook): void {
    const key = this.key(hook);
    this.rows.push({ kind: 'hook', name: `${hook.entity.type === 'module' ? hook.entity.relativeModuleId : hook.entity.module.relativeModuleId} > ${hook.entity.type === 'module' ? '' : hook.entity.fullName + ' > '}${hook.name}`, ms: performance.now() - this.starts.get(key)! });
    this.starts.delete(key);
  }
  onTestCaseResult(test: TestCase): void {
    this.rows.push({ kind: 'test', name: `${test.module.relativeModuleId} > ${test.fullName}`, ms: test.diagnostic()?.duration ?? 0, state: test.result().state });
  }
  onTestModuleEnd(mod: TestModule): void {
    const d = mod.diagnostic();
    this.rows.push({ kind: 'file', name: mod.relativeModuleId, ms: d.duration, collectMs: d.collectDuration, setupMs: d.setupDuration, prepareMs: d.prepareDuration, worker: d.workerId, slot: d.concurrencyId, state: mod.state() });
  }
  onTestRunEnd(): void {
    const dir = process.env.OPENSINNOH_TIMING_DIR!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'vitest.json'), JSON.stringify(this.rows, null, 2));
  }
}
