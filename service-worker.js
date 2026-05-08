// Tiny shell-cache service worker so the page loads instantly even offline.
// API calls always go to the network so weather data stays fresh.

const CACHE_NAME = 'weather-shell-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/180.png',
  './icons/192.png',
  './icons/512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Always pull live data for API + image hosts.
  if (url.hostname === 'api.weather.gov' || url.hostname.includes('unsplash')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
