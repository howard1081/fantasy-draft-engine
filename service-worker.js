const CACHE_NAME = 'fantasy-draft-engine-v2-20260908-planner';
const CORE_ASSETS = [
  './',
  './index.html',
  './refresh.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/icon.svg',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './src/app.js',
  './src/engine.js',
  './src/planner.js',
  './src/state.js',
  './data/players.json',
  './data/metadata.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(
        CORE_ASSETS.map((asset) => new Request(asset, { cache: 'reload' })),
      ))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    const fallback = new URL(event.request.url).pathname.endsWith('/refresh.html')
      ? './refresh.html'
      : './index.html';
    event.respondWith(
      fetch(new Request(event.request, { cache: 'reload' }))
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(fallback, copy));
          }
          return response;
        })
        .catch(() => caches.match(fallback)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cached) => cached ?? fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })),
  );
});
