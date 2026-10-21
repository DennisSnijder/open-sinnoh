import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

export default class TimingReporter implements Reporter {
  private rows: object[] = [];
  onTestEnd(test: TestCase, result: TestResult): void {
    this.rows.push({ kind: 'test', name: test.titlePath().join(' > '), ms: result.duration, state: result.status });
  }
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.category === 'hook') this.rows.push({ kind: 'hook', name: `${test.titlePath().join(' > ')} > ${step.title}`, ms: step.duration });
  }
  onEnd(): void {
    const dir = process.env.OPENSINNOH_TEST_SHARD ? join(process.env.OPENSINNOH_TIMING_DIR!, `shard-${process.env.OPENSINNOH_TEST_SHARD}`) : process.env.OPENSINNOH_TIMING_DIR!;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'browser.json'), JSON.stringify(this.rows, null, 2));
  }
}
