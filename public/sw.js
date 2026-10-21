/* global self, caches, fetch, URL, Response */
// App-shell service worker (production builds). The build's file list and a hash of their contents are written
// into BUILD at build time (vite.config.ts `precache`); the install caches all of it, so the app starts offline
// after one visit. Game data lives in IndexedDB, not here.
//
// A new version installs and then WAITS: it never takes over a running session (no skipWaiting on its own). The
// page offers "Restart to update" and sends 'skip-waiting'; closing every window also lets it activate. Until
// then a session keeps being served from its own build's cache, so a deploy cannot take its chunks away.
const BUILD = /*__BUILD__*/ null;
if (!BUILD) throw new Error('sw.js was not built: its BUILD is the placeholder');

const PREFIX = 'opensinnoh-build-';
const CACHE = PREFIX + BUILD.id;
const FILES = new Set(BUILD.urls.map((u) => new URL(u, self.location.origin).pathname));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(BUILD.urls)));
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Older builds' caches go once this one runs; the earlier network-first cache too.
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && (k.startsWith(PREFIX) || k.startsWith('lantern-nds-shell-'))).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The page itself: the cached shell, whatever the query (`?replay`, `?continue`, ...).
  if (req.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then((c) => c.match('/', { ignoreSearch: true })).then((hit) => hit ?? fetch(req)));
    return;
  }
  // The build's own files, cache first (their names carry their content hash).
  if (FILES.has(url.pathname)) event.respondWith(caches.open(CACHE).then((c) => c.match(req.url, { ignoreSearch: true })).then((hit) => hit ?? fetch(req).catch(() => Response.error())));
});
