/**
 * `pnpm check`: lint, typecheck and the unit tests (with the pack replays), in parallel. Each step's
 * output is printed whole when it ends; the exit code is non-zero if any step failed.
 * Lint and typecheck keep caches in the gitignored `.opensinnoh-cache/` (see the package.json scripts).
 */
import { spawn } from 'node:child_process';

const STEPS = ['lint', 'typecheck', 'test'];
const started = Date.now();

const run = (step: string) =>
  new Promise<boolean>((resolve) => {
    const t0 = Date.now();
    const args = ['-s', step];
    // These files have no runnable cases without a ROM (keep rom.test.ts's original-byte tests).
    // CLI --exclude adds to Vitest's configured excludes; direct ROM-file runs still skip cleanly.
    if (step === 'test' && !process.env.OPENSINNOH_NDS_ROM && !process.env.OPENSINNOH_HGSS_ROM) args.push('--exclude', '**/*.rom.test.ts');
    const child = spawn('pnpm', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.stdout.isTTY ? { ...process.env, FORCE_COLOR: '1' } : process.env });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (out += d));
    child.on('close', (code) => {
      const ok = code === 0;
      process.stdout.write(`\n── ${step}: ${ok ? 'ok' : `FAILED (exit ${code})`} in ${((Date.now() - t0) / 1000).toFixed(1)} s\n${out.trimEnd() ? out.trimEnd() + '\n' : ''}`);
      resolve(ok);
    });
  });

const results = await Promise.all(STEPS.map(run));
const failed = STEPS.filter((_, i) => !results[i]);
process.stdout.write(`\ncheck: ${failed.length ? `FAILED: ${failed.join(', ')}` : 'ok'} in ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
process.exit(failed.length ? 1 : 0);
