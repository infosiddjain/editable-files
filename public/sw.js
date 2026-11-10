// Offline support for EasyDocs: keeps the app and its file libraries available without internet.
const CACHE = 'easydocs-v1';
const PRECACHE = [
  '/', '/manifest.webmanifest',
  '/vendor/pdf.min.js', '/vendor/pdf.worker.min.js', '/vendor/pdf-lib.min.js', '/vendor/mammoth.browser.min.js',
  '/vendor/xlsx.full.min.js', '/vendor/docx.umd.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
// Network first (so new versions show up), cached copy when offline.
// Next.js page chunks get cached the first time they load.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request, { ignoreSearch: true }).then((r) => r || (e.request.mode === 'navigate' ? caches.match('/') : undefined))
      )
  );
});
