/**
 * Privacy scrubbing for error reports (README "Privacy", docs/decisions.md "Error reports"). Everything a
 * report carries passes through here, the Sentry event in `beforeSend` and the crash screen's "Copy details"
 * text alike. Never sent: ROM bytes, saves, the names of the player's files and their paths, screenshots,
 * the player's, rival's and Pokémon's names, game text from the ROM. Errors we throw carry ids and codes;
 * whatever else reaches a message is cut down here:
 *   - `secrets` (the player, rival, nickname and box name strings of the running game) become `[name]`;
 *   - quoted literals (the way game text gets into a message) become `"[text]"`;
 *   - file names with a user file's extension become `[file]`, local paths and file/content URLs `[path]`;
 *   - every string is cut to `MAX_TEXT` characters.
 * URLs keep their origin and path; the query keeps only the `QUERY_KEEP` debug flags, the hash is dropped.
 */
import type { Breadcrumb, Event, Exception, StackFrame } from '@sentry/browser';

/** The longest string kept in a report (messages, exception values, breadcrumb data). */
export const MAX_TEXT = 400;
/** Query keys kept in report URLs (debug flags and modes, never user data). */
export const QUERY_KEEP: readonly string[] = ['time', 'clock', 'replay', 'title', 'reimport'];
/** Breadcrumbs we record ourselves; any other (console, clicks, fetch, navigation) is dropped. */
export const BREADCRUMB_PREFIX = 'app.';

/**
 * A file a player picks or exports (ROMs, saves, archives), back to the last quote, colon, slash or line
 * break (names have spaces: "Pokemon - Platinum (USA).nds"), at most 80 characters.
 */
const USER_FILE = /[^"'`/\\:\n]{0,80}\.(?:nds|srl|sav|dsv|duc|json|zip|7z|rar)\b/gi;
const PATHS = [/\b(?:file|content|blob):\/\/?[^\s"'`)]+/gi, /\b[A-Za-z]:\\[^\s"'`]+/g, /\\\\[^\s"'`]+/g, /(?<![\w.])\/(?:Users|home|private|var|tmp|mnt|media|storage|sdcard|data|Volumes)\/[^\s"'`]*/g];
/** Quoted literals: "…", “…”, ‘…’, «…», `…`, and '…' only where a quote cannot be an apostrophe. */
const QUOTED = [/"[^"\n]*"/g, /“[^”\n]*”/g, /‘[^’\n]*’/g, /«[^»\n]*»/g, /`[^`\n]*`/g, /(?<=^|[\s([{:=,])'[^'\n]*'(?=$|[\s)\]}.,:;!?])/g];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One string, scrubbed and cut to `MAX_TEXT`. Secrets of one character are left (they would eat the message, and identify no one). */
export function scrubText(text: string, secrets: readonly string[] = []): string {
  let out = text;
  const names = [...new Set(secrets.filter((s) => s.length >= 2))].sort((a, b) => b.length - a.length);
  if (names.length) out = out.replace(new RegExp(names.map(escape).join('|'), 'g'), '[name]');
  for (const re of PATHS) out = out.replace(re, '[path]');
  out = out.replace(USER_FILE, (m) => `${/^\s*/.exec(m)![0]}[file]`);
  for (const re of QUOTED) out = out.replace(re, (m) => (m === '"[text]"' ? m : '"[text]"'));
  return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT - 1)}…` : out;
}

/** A URL with its origin and path, and only the `QUERY_KEEP` query keys (no hash). Not a URL: scrubbed as text. */
export function scrubUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return scrubText(url);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return '[path]';
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams) if (QUERY_KEEP.includes(k)) kept.append(k, v.slice(0, 32));
  const query = kept.toString();
  return `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
}

/** Every string in a JSON-like value, scrubbed (depth-limited: deeper values are dropped). */
export function scrubValue(value: unknown, secrets: readonly string[], depth = 4): unknown {
  if (typeof value === 'string') return scrubText(value, secrets);
  if (value === null || typeof value !== 'object') return value;
  if (depth === 0) return '[dropped]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubValue(v, secrets, depth - 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubValue(v, secrets, depth - 1)]));
}

function scrubFrame(f: StackFrame): StackFrame {
  // Only where the code is: no source lines and no local variables.
  const out: StackFrame = {};
  if (f.filename !== undefined) out.filename = scrubUrl(f.filename);
  if (f.abs_path !== undefined) out.abs_path = scrubUrl(f.abs_path);
  if (f.function !== undefined) out.function = f.function.slice(0, 120);
  for (const k of ['lineno', 'colno', 'in_app'] as const) if (f[k] !== undefined) (out as Record<string, unknown>)[k] = f[k];
  return out;
}

function scrubException(e: Exception, secrets: readonly string[]): Exception {
  const out: Exception = { ...e };
  if (e.value !== undefined) out.value = scrubText(e.value, secrets);
  if (e.stacktrace?.frames) out.stacktrace = { frames: e.stacktrace.frames.map(scrubFrame) };
  return out;
}

export function scrubBreadcrumbs(crumbs: readonly Breadcrumb[], secrets: readonly string[]): Breadcrumb[] {
  return crumbs
    .filter((b) => b.category?.startsWith(BREADCRUMB_PREFIX))
    .map((b) => ({
      ...(b.timestamp !== undefined ? { timestamp: b.timestamp } : {}),
      category: b.category!,
      ...(b.level ? { level: b.level } : {}),
      ...(b.message !== undefined ? { message: scrubText(b.message, secrets) } : {}),
      ...(b.data ? { data: scrubValue(b.data, secrets) as Record<string, unknown> } : {}),
    }));
}

/**
 * A report event as it may leave the browser: messages and exception values scrubbed, frames without
 * source or variables, our breadcrumbs only, the request reduced to the scrubbed URL and the user agent,
 * no user, no attachments' worth of data (`extra` and contexts are scrubbed strings).
 */
export function scrubEvent<E extends Event>(event: E, secrets: readonly string[]): E {
  const out: E = { ...event };
  if (event.message !== undefined) out.message = scrubText(event.message, secrets);
  if (event.logentry) out.logentry = { ...(event.logentry.message !== undefined ? { message: scrubText(event.logentry.message, secrets) } : {}) };
  if (event.exception?.values) out.exception = { values: event.exception.values.map((e) => scrubException(e, secrets)) };
  if (event.breadcrumbs) out.breadcrumbs = scrubBreadcrumbs(event.breadcrumbs, secrets);
  if (event.request) {
    const ua = event.request.headers?.['User-Agent'];
    out.request = { ...(event.request.url ? { url: scrubUrl(event.request.url) } : {}), ...(ua ? { headers: { 'User-Agent': ua } } : {}) };
  }
  if (event.transaction !== undefined) out.transaction = scrubUrl(event.transaction);
  if (event.extra) out.extra = scrubValue(event.extra, secrets) as Record<string, unknown>;
  if (event.contexts) out.contexts = scrubValue(event.contexts, secrets) as E['contexts'];
  if (event.tags) out.tags = scrubValue(event.tags, secrets) as E['tags'];
  delete out.user;
  delete out.server_name;
  return out;
}
