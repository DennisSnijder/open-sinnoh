/**
 * Anonymous usage analytics (docs/decisions.md): PostHog EU Cloud in cookieless mode, events only.
 * No SDK (posthog-js is about 100 kB gzip): one `fetch` per event to the capture API, with PostHog's cookieless
 * sentinel as the distinct id, so PostHog counts daily visitors with its own rotating server-side hash. Nothing is
 * stored in the browser (no cookie, no storage, no id of ours), nothing is queued: an event offline or a failed
 * request is dropped. Do Not Track and Global Privacy Control send nothing. Error reports (index.ts) are separate
 * and opt-in.
 *
 * Only in the production deployment (`initAnalytics`' `enabled`: Vercel's production environment, main.ts): dev,
 * tests, replays and previews send nothing, unless a dev build sets `window.openSinnohTestAnalytics` (the browser spec).
 */
import { deviceClass } from './perf.ts';

export const POSTHOG_ENDPOINT = 'https://eu.i.posthog.com/i/v0/e/';
/** The project's public key (docs/decisions.md). */
export const POSTHOG_KEY = 'phc_nt86bScPDMTWrGxzRg6TirzTKa6CHprPKNnU2sCo4Yqt';
/** PostHog's distinct id for cookieless events (posthog-js COOKIELESS_SENTINEL_VALUE). */
export const COOKIELESS_ID = '$posthog_cookieless';

/** Every game event and the only properties it may carry (besides the common ones); any other property is dropped. */
const EVENTS = {
  app_open: [],
  rom_import_start: ['addon'],
  rom_import_done: ['duration', 'addon'],
  game_new: [],
  game_continue: [],
  hgss_addon_enabled: [],
  play_heartbeat: [],
  milestone: ['badges', 'hall_of_fame'],
} as const satisfies Record<string, readonly string[]>;

export type GameEvent = keyof typeof EVENTS;
type Value = string | number | boolean;

let enabled = false;
let version = 'dev';

/** Starts analytics: `enabled` only in the production build outside replays (main.ts). */
export function initAnalytics(opts: { enabled: boolean; version: string }): void {
  enabled = opts.enabled;
  version = opts.version;
}

/** Do Not Track or Global Privacy Control is on: nothing is sent. */
export function privacySignal(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  const dnt = nav.doNotTrack ?? (globalThis as { doNotTrack?: string }).doNotTrack ?? nav.msDoNotTrack;
  return dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true;
}

export function viewportClass(width: number): 'small' | 'medium' | 'large' {
  return width < 600 ? 'small' : width < 1200 ? 'medium' : 'large';
}

/** An import's seconds as a coarse bucket (never the exact time). */
export function durationBucket(ms: number): string {
  const s = ms / 1000;
  return s < 10 ? '<10s' : s < 20 ? '10-20s' : s < 40 ? '20-40s' : s < 80 ? '40-80s' : '80s+';
}

/** The event as PostHog's capture API takes it: the allowed properties, the common ones and the cookieless flags. */
export function payload(event: GameEvent, props: Record<string, Value> = {}): Record<string, unknown> {
  const allowed: readonly string[] = EVENTS[event];
  const own = Object.fromEntries(Object.entries(props).filter(([k]) => allowed.includes(k)));
  return {
    api_key: POSTHOG_KEY,
    event,
    distinct_id: COOKIELESS_ID,
    properties: {
      ...own,
      site: 'game',
      version,
      device: deviceClass(matchMedia('(pointer: coarse)').matches, Math.min(screen.width, screen.height)),
      installed: matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
      viewport: viewportClass(innerWidth),
      // PostHog's cookieless mode: the server hashes the IP with these (and a daily salt); no person profile.
      $cookieless_mode: true,
      $process_person_profile: false,
      $host: location.host,
      $raw_user_agent: navigator.userAgent,
      $timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

/** Sends one event, or nothing (disabled, DNT/GPC, offline). Never throws, never retries. */
export function track(event: GameEvent, props?: Record<string, Value>): void {
  if (!enabled || privacySignal() || !navigator.onLine) return;
  fetch(POSTHOG_ENDPOINT, { method: 'POST', body: JSON.stringify(payload(event, props)), headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' }).catch(() => {
    // Offline or blocked: dropped.
  });
}

/** Seconds of active play per `play_heartbeat`. */
export const HEARTBEAT_S = 300;

export interface PlayDeps {
  /** The state of the game being played (a new object after a load or a reset), or null at the title. */
  playing(): { badges: readonly unknown[]; hallOfFame: { total: number } } | null;
  /** Game ticks so far: a second counts as play only when the loop ticked (not paused, not crashed). */
  ticks(): number;
  visible(): boolean;
}

/**
 * Called once a second: a `play_heartbeat` per HEARTBEAT_S seconds of visible, ticking play, and a `milestone`
 * when the badge or Hall of Fame count changes while playing (a loaded or new game sets the baseline).
 */
export function playWatcher(deps: PlayDeps): { second(): void } {
  let active = 0;
  let lastTicks = deps.ticks();
  let state: object | null = null;
  let progress = '';
  return {
    second() {
      const ticks = deps.ticks();
      const ticked = ticks !== lastTicks;
      lastTicks = ticks;
      const s = deps.playing();
      if (!s) return;
      const badges = s.badges.length;
      const hallOfFame = s.hallOfFame.total;
      const now = `${badges}/${hallOfFame}`;
      if (s !== state) state = s;
      else if (now !== progress) track('milestone', { badges, hall_of_fame: hallOfFame });
      progress = now;
      if (ticked && deps.visible() && ++active % HEARTBEAT_S === 0) track('play_heartbeat');
    },
  };
}
