/** One build per Playwright run, then Vite's static preview server with the pack middleware. */
import { build, preview } from 'vite';

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('browser-server needs a port (1–65535)');
const config = { configFile: 'vite.browser.config.ts', mode: 'browser-test' };
const started = performance.now();
await build(config);
process.stdout.write(`browser build: ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port, strictPort: true } });
server.printUrls();
