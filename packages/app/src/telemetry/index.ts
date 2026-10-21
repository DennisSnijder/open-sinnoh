/**
 * Telemetry: error reports (a Sentry adapter, lazy, opt-in). Anonymous usage analytics are separate
 * (analytics.ts). Provider-agnostic: the app calls `captureError` and `breadcrumb`; an
 * adapter only receives what this module hands it, and every report is scrubbed (scrub.ts) before it leaves.
 *
 * Reports are sent only when the build has a DSN (`VITE_SENTRY_DSN`, set on Vercel) and the player allowed them
 * (the setup's question, or "Error reports" in Options; settings.ts). Until the player answers, nothing is sent. Local dev, tests and forks have no DSN and send
 * nothing; the crash screen's report text works without one.
 */
import { scrubText, scrubUrl } from './scrub.ts';
import { readReports, storeReports } from './settings.ts';

export interface Crumb {
  /** Seconds since the epoch (Sentry's unit). */
  timestamp: number;
  /** Always `app.<area>`: only our own breadcrumbs are kept (scrub.ts). */
  category: string;
  message: string;
  data?: Record<string, string | number | boolean>;
}

/** What one error report carries besides the error (tags are short ids and versions, context the rest). */
export interface Report {
  where: string;
  fatal: boolean;
  tags: Record<string, string>;
  context: Record<string, string | number | boolean>;
  breadcrumbs: Crumb[];
}

/** A report backend (Sentry now). It scrubs with `secrets()` in its last step before sending. */
export interface TelemetryAdapter {
  capture(error: Error, report: Report): void;
  /** An anonymous summary (`name`: `perf`), sent as an info event with the static tags. */
  summary(name: string, data: Record<string, string | number | boolean>, tags: Record<string, string>): void;
}

export interface AdapterConfig {
  dsn: string;
  release: string;
  environment: string;
  /** Checked again just before an event is sent (the toggle applies to queued events too). */
  enabled(): boolean;
  /** The running game's player, rival, nickname and box name strings: removed from every report. */
  secrets(): string[];
}

export interface TelemetryConfig {
  /** The report endpoint; undefined: nothing is ever sent. */
  dsn: string | undefined;
  release: string;
  environment: string;
  /** Loads the adapter (default: the Sentry chunk). */
  loadAdapter?: () => Promise<(config: AdapterConfig) => TelemetryAdapter>;
}

/** Breadcrumbs kept for the next report (the newest last). */
const MAX_CRUMBS = 30;
/** Reports sent per page load at most (a broken frame must not send one a frame). */
const MAX_REPORTS = 20;
/** Errors captured before the adapter is loaded, kept for it. */
const MAX_QUEUED = 10;

let config: TelemetryConfig | null = null;
let reportsOn = false;
let adapter: TelemetryAdapter | null = null;
let loading: Promise<void> | null = null;
let queue: { error: Error; report: Report }[] = [];
let sent = 0;
const seen = new Set<string>();
const summaries = new Set<string>();
const crumbs: Crumb[] = [];
const tags: Record<string, string> = {};
type ContextSource = () => Record<string, string | number | boolean | undefined>;
const contextSources: ContextSource[] = [];
let secretsSource: () => string[] = () => [];

/** True when reports leave the browser: a DSN in the build and the player's setting on. */
export function reportsSending(): boolean {
  return !!config?.dsn && reportsOn;
}

/** The player's "Error reports" setting. */
export function reportsEnabled(): boolean {
  return reportsOn;
}

/** Turns reports on or off (stored on this device) and applies at once; returns a storage error, or null. */
export function setReportsEnabled(on: boolean): string | null {
  reportsOn = on;
  if (!on) queue = [];
  else void ensureAdapter();
  breadcrumb('settings', `error reports ${on ? 'on' : 'off'}`);
  return storeReports(on);
}

/** Static report tags: versions, the ROM's SHA-1 (`rom`), the mode the app runs in. */
export function setTag(key: string, value: string): void {
  tags[key] = value;
}

/** Context read when a report is made: the browser basics (main.ts), what the game is doing (zone, mode, loop stats). */
export function addContextSource(source: ContextSource): void {
  contextSources.push(source);
}

/** The strings of the running game every report must not contain (names and nicknames). */
export function setSecretsSource(source: () => string[]): void {
  secretsSource = source;
}

export function secrets(): string[] {
  return secretsSource();
}

/** One of our breadcrumbs (`app.<category>`): ids and codes, never game text. */
export function breadcrumb(category: string, message: string, data?: Crumb['data']): void {
  crumbs.push({ timestamp: Date.now() / 1000, category: `app.${category}`, message, ...(data ? { data } : {}) });
  if (crumbs.length > MAX_CRUMBS) crumbs.shift();
}

/** The VM names the failing command in its errors (`script <label>[<pc>] <op>: …`, packages/vm runner.ts). */
export function vmFrame(message: string): { script: string; op: string } | null {
  const m = /script (\S+?)\[(\d+)\] (\w+):/.exec(message);
  return m ? { script: m[1]!, op: m[3]! } : null;
}

function buildReport(error: Error, where: string, fatal: boolean, extra: Record<string, string | number | boolean | undefined>): Report {
  const context: Report['context'] = {};
  for (const source of [...contextSources.map((f) => f()), extra]) for (const [k, v] of Object.entries(source)) if (v !== undefined) context[k] = v;
  const vm = vmFrame(error.message);
  if (vm) Object.assign(context, vm);
  return {
    where,
    fatal,
    tags: { ...tags, where, ...(vm ? { script: vm.script, op: vm.op } : {}), ...(typeof context.mode === 'string' ? { mode: context.mode } : {}) },
    context,
    breadcrumbs: crumbs.map((c) => ({ ...c })),
  };
}

function ensureAdapter(): Promise<void> {
  if (!config?.dsn || !reportsOn) return Promise.resolve();
  const { dsn, release, environment } = config;
  loading ??= (config.loadAdapter ?? (() => import('./sentry.ts').then((m) => m.createSentryAdapter)))()
    .then((create) => {
      adapter = create({ dsn, release, environment, enabled: reportsSending, secrets });
      const pending = queue;
      queue = [];
      for (const q of pending) adapter.capture(q.error, q.report);
    })
    .catch((e: unknown) => {
      // The report chunk did not load (offline, blocked): the game goes on, reports stay off for this visit.
      loading = null;
      console.warn('error reports unavailable:', e);
    });
  return loading;
}

/**
 * Reports an error (each distinct one once per page load, at most `MAX_REPORTS`). `where` names the path
 * (`loop`, `import`, `audio.worklet`, `window.error`, …); `extra` adds ids and codes to the context.
 * Returns the report, also when nothing is sent.
 */
export function captureError(err: unknown, where: string, opts: { fatal?: boolean; extra?: Record<string, string | number | boolean | undefined> } = {}): Report {
  const error = err instanceof Error ? err : new Error(typeof err === 'string' ? err : `non-error thrown: ${Object.prototype.toString.call(err)}`);
  const report = buildReport(error, where, opts.fatal ?? false, opts.extra ?? {});
  breadcrumb('error', `${where}: ${error.name}`);
  const key = `${where}|${error.name}|${error.message}`;
  if (!reportsSending() || seen.has(key) || sent >= MAX_REPORTS) return report;
  seen.add(key);
  sent++;
  if (adapter) adapter.capture(error, report);
  else if (queue.length < MAX_QUEUED) {
    queue.push({ error, report });
    void ensureAdapter();
  }
  return report;
}

/** Sends an anonymous summary once per page load, only while reports are sent (telemetry/perf.ts). */
export function sendSummary(name: string, data: Record<string, string | number | boolean>): void {
  if (!reportsSending() || summaries.has(name)) return;
  summaries.add(name);
  breadcrumb('summary', name);
  void ensureAdapter().then(() => adapter?.summary(name, data, { ...tags }));
}

/** The report as text the player can copy for the developer (scrubbed like a sent report). */
export function reportText(error: Error, report: Report): string {
  const s = secrets();
  const lines = (error.stack ?? '').split('\n');
  // V8 starts the stack with the message (already shown); query strings (dev cache busters) are dropped.
  if (lines[0]?.startsWith(error.name)) lines.shift();
  const stack = lines
    .filter((l) => l.trim())
    .slice(0, 12)
    .map((l) => scrubText(l.trim().replace(/(https?:\/\/[^\s?#)]+)[?#][^\s:)]*/g, '$1'), s));
  return [
    'OpenSinnoh error report',
    `release: ${config?.release ?? 'dev'} (${config?.environment ?? 'development'})`,
    `time: ${new Date().toISOString()}`,
    `url: ${scrubUrl(location.href)}`,
    `browser: ${navigator.userAgent}`,
    ...Object.entries(report.tags).map(([k, v]) => `${k}: ${scrubText(v, s)}`),
    ...Object.entries(report.context).map(([k, v]) => `${k}: ${typeof v === 'string' ? scrubText(v, s) : v}`),
    `error: ${error.name}: ${scrubText(error.message, s)}`,
    ...stack.map((l) => `  ${l}`),
    'recent:',
    ...report.breadcrumbs.slice(-10).map((c) => `  ${new Date(c.timestamp * 1000).toISOString().slice(11, 19)} ${c.category} ${scrubText(c.message, s)}`),
  ].join('\n');
}

/** Starts telemetry with the build's config and the player's stored setting. */
export function initTelemetry(next: TelemetryConfig): void {
  config = next;
  reportsOn = readReports();
}

/**
 * Reports uncaught errors and unhandled rejections (they do not stop the game; the game loop's own
 * failures go through `crash`), and loads the reporter once the page has settled, off the startup path.
 */
export function installGlobalHandlers(): void {
  addEventListener('error', (e) => captureError(e.error ?? e.message, 'window.error'));
  addEventListener('unhandledrejection', (e) => captureError(e.reason, 'unhandledrejection'));
  if (reportsSending()) setTimeout(() => void ensureAdapter(), 5000);
}

/** Tests: back to a fresh module state. */
export function resetTelemetryForTests(): void {
  config = null;
  reportsOn = false;
  adapter = null;
  loading = null;
  queue = [];
  sent = 0;
  seen.clear();
  summaries.clear();
  crumbs.length = 0;
  for (const k of Object.keys(tags)) delete tags[k];
  contextSources.length = 0;
  secretsSource = () => [];
}
