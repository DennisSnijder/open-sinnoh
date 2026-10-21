/**
 * Anonymous visit counting for opensinnoh.com (docs/decisions.md): PostHog EU Cloud in cookieless mode,
 * three events (the page view, Play now, Discord). No SDK: one `fetch` per event to the capture API with PostHog's
 * cookieless sentinel as the distinct id, so PostHog counts daily visitors with its rotating server-side hash.
 * Nothing is stored in the browser, nothing is queued (offline: dropped), Do Not Track and Global Privacy Control
 * send nothing. Only on opensinnoh.com itself; the browser spec opts in with `window.openSinnohTestAnalytics`.
 */

const ENDPOINT = 'https://eu.i.posthog.com/i/v0/e/';
const KEY = 'phc_nt86bScPDMTWrGxzRg6TirzTKa6CHprPKNnU2sCo4Yqt';
const HOSTS = ['opensinnoh.com', 'www.opensinnoh.com'];

type LandingEvent = '$pageview' | 'play_now_click' | 'discord_click';

function enabled(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true || !nav.onLine) return false;
  return HOSTS.includes(location.hostname) || (window as { openSinnohTestAnalytics?: boolean }).openSinnohTestAnalytics === true;
}

export function track(event: LandingEvent): void {
  if (!enabled()) return;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const screenMin = Math.min(screen.width, screen.height);
  const properties = {
    site: 'landing',
    version: import.meta.env.VITE_OPENSINNOH_RELEASE.slice(0, 7),
    device: !coarse ? 'desktop' : screenMin < 600 ? 'phone' : 'tablet',
    viewport: innerWidth < 600 ? 'small' : innerWidth < 1200 ? 'medium' : 'large',
    // PostHog's cookieless mode: the server hashes the IP with these (and a daily salt); no person profile.
    $cookieless_mode: true,
    $process_person_profile: false,
    $host: location.host,
    $raw_user_agent: navigator.userAgent,
    $timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    ...(event === '$pageview' ? { $current_url: location.origin + location.pathname, $pathname: location.pathname } : {}),
  };
  const body = JSON.stringify({ api_key: KEY, event, distinct_id: '$posthog_cookieless', properties });
  fetch(ENDPOINT, { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true, credentials: 'omit' }).catch(() => {
    // Offline or blocked: dropped.
  });
}

/** The page view, then a click on any Play or Discord link. */
export function installAnalytics(): void {
  track('$pageview');
  document.addEventListener('click', (e) => {
    const a = (e.target as Element).closest?.('a[href]') as HTMLAnchorElement | null;
    if (a?.hostname === 'play.opensinnoh.com') track('play_now_click');
    else if (a?.hostname === 'discord.gg') track('discord_click');
  });
}
