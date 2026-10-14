// Network first so updates show up right away; fall back to the cache offline.
// The Supabase client library (from jsdelivr) is cached too so sync code loads offline;
// Supabase API calls themselves are never cached.
const CACHE = 'hour-log-v3';
const CDN = 'cdn.jsdelivr.net';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'store.js',
  'config.js',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || (url.origin !== location.origin && url.host !== CDN)) return;
  event.respondWith(
    // no-cache: always revalidate with the server (a cheap 304 when unchanged), so the
    // browser's HTTP cache can't hand back an outdated app file. CDN URLs are pinned
    // to a version, so they can come straight from the HTTP cache.
    fetch(request, url.host === CDN ? {} : { cache: 'no-cache' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')),
      ),
  );
});
