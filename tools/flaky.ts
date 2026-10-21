import { flaky } from './maintenance/flaky.ts';
try {
  process.exitCode = await flaky(process.argv.slice(2));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
