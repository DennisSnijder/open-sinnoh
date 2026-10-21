import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COOKIELESS_ID, durationBucket, HEARTBEAT_S, initAnalytics, playWatcher, POSTHOG_ENDPOINT, POSTHOG_KEY, track, viewportClass } from './analytics.ts';

const COMMON = ['site', 'version', 'device', 'installed', 'viewport', '$cookieless_mode', '$process_person_profile', '$host', '$raw_user_agent', '$timezone'];

let sent: { url: string; init: RequestInit }[];
let storageTouched: string[];

/** A storage or cookie jar that records any access. */
const watched = (name: string) =>
  new Proxy(
    {},
    {
      get: (_t, k) => {
        storageTouched.push(`${name}.${String(k)}`);
        return () => null;
      },
      set: (_t, k) => {
        storageTouched.push(`${name}.${String(k)}=`);
        return true;
      },
    },
  );

function browser(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean; onLine?: boolean } = {}): void {
  vi.stubGlobal('navigator', { userAgent: 'TestBrowser/1', doNotTrack: null, onLine: true, ...nav });
  vi.stubGlobal('location', { host: 'play.opensinnoh.com', hostname: 'play.opensinnoh.com' });
  vi.stubGlobal('screen', { width: 390, height: 844 });
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
  vi.stubGlobal('localStorage', watched('localStorage'));
  vi.stubGlobal('sessionStorage', watched('sessionStorage'));
  vi.stubGlobal('indexedDB', watched('indexedDB'));
  vi.stubGlobal('document', watched('document'));
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return Promise.resolve(new Response(''));
  });
}

const events = () => sent.map((s) => JSON.parse(s.init.body as string) as { api_key: string; event: string; distinct_id: string; properties: Record<string, unknown> });

beforeEach(() => {
  sent = [];
  storageTouched = [];
  initAnalytics({ enabled: true, version: 'abc1234' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  initAnalytics({ enabled: false, version: 'dev' });
});

describe('track', () => {
  it('sends a cookieless event with the allowed properties only, touching no storage', () => {
    browser();
    track('rom_import_done', { duration: '10-20s', addon: false, sha1: 'deadbeef', name: 'Kai' } as never);
    track('milestone', { badges: 3, hall_of_fame: 0, zone: 'x' } as never);
    track('app_open', { anything: 1 } as never);
    expect(sent.map((s) => s.url)).toEqual([POSTHOG_ENDPOINT, POSTHOG_ENDPOINT, POSTHOG_ENDPOINT]);
    expect(sent[0]!.init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'omit' });
    const [done, milestone, open] = events();
    expect(done).toMatchObject({ api_key: POSTHOG_KEY, event: 'rom_import_done', distinct_id: COOKIELESS_ID });
    expect(Object.keys(done!.properties).sort()).toEqual([...COMMON, 'duration', 'addon'].sort());
    expect(done!.properties).toMatchObject({ duration: '10-20s', addon: false, site: 'game', version: 'abc1234', device: 'phone', installed: false, viewport: 'small', $cookieless_mode: true, $process_person_profile: false });
    expect(Object.keys(milestone!.properties).sort()).toEqual([...COMMON, 'badges', 'hall_of_fame'].sort());
    expect(Object.keys(open!.properties).sort()).toEqual([...COMMON].sort());
    expect(storageTouched).toEqual([]);
  });

  it('sends nothing under Do Not Track, Global Privacy Control, offline or when disabled', () => {
    for (const nav of [{ doNotTrack: '1' }, { globalPrivacyControl: true }, { onLine: false }]) {
      browser(nav);
      track('app_open');
      vi.unstubAllGlobals();
    }
    browser();
    initAnalytics({ enabled: false, version: 'abc1234' });
    track('app_open');
    expect(sent).toEqual([]);
    expect(storageTouched).toEqual([]);
  });

  it('drops a failed request silently', async () => {
    browser();
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    expect(() => track('app_open')).not.toThrow();
    await Promise.resolve();
  });
});

describe('classes', () => {
  it('buckets import times and viewports coarsely', () => {
    expect([5_000, 15_400, 25_000, 60_000, 200_000].map(durationBucket)).toEqual(['<10s', '10-20s', '20-40s', '40-80s', '80s+']);
    expect([360, 820, 1920].map(viewportClass)).toEqual(['small', 'medium', 'large']);
  });
});

describe('playWatcher', () => {
  it('sends a heartbeat per 5 minutes of visible, ticking play and milestones on change', () => {
    browser();
    let ticks = 0;
    let visible = true;
    let state: { badges: string[]; hallOfFame: { total: number } } | null = null;
    const w = playWatcher({ playing: () => state, ticks: () => ticks, visible: () => visible });
    const seconds = (n: number, tick = true) => {
      for (let i = 0; i < n; i++) {
        if (tick) ticks += 30;
        w.second();
      }
    };
    seconds(600); // At the title: nothing.
    state = { badges: ['coal'], hallOfFame: { total: 0 } }; // Continue: a baseline, no milestone.
    seconds(HEARTBEAT_S - 1);
    visible = false;
    seconds(100);
    visible = true;
    seconds(50, false); // Not ticking (a stopped loop).
    expect(events().map((e) => e.event)).toEqual([]);
    seconds(1);
    expect(events().map((e) => e.event)).toEqual(['play_heartbeat']);
    state.badges.push('forest');
    seconds(1);
    state.hallOfFame.total = 1;
    seconds(1);
    state = { badges: [], hallOfFame: { total: 0 } }; // A new game: a new baseline.
    seconds(1);
    expect(events().slice(1).map((e) => [e.event, e.properties.badges, e.properties.hall_of_fame])).toEqual([
      ['milestone', 2, 0],
      ['milestone', 2, 1],
    ]);
  });
});
