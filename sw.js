// RunQuest — service worker : cache-first pour le shell, réseau pour le reste.
const CACHE = 'runquest-v5';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './vendor/chart.umd.min.js',
  './js/app.js',
  './js/utils.js',
  './js/db.js',
  './js/parsers.js',
  './js/data-import.js',
  './js/program-data.js',
  './js/analytics.js',
  './js/analysis-text.js',
  './js/gamification.js',
  './js/reschedule.js',
  './js/strava.js',
  './js/charts.js',
  './js/views/dashboard.js',
  './js/views/program.js',
  './js/views/activities.js',
  './js/views/stats.js',
  './js/views/progress.js',
  './js/views/settings.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // jamais de cache pour Strava (OAuth + API)
  if (url.origin !== location.origin) return;
  // navigation avec ?code= (callback OAuth) : toujours réseau puis fallback
  e.respondWith(
    caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then(cached =>
      cached || fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      })
    ).catch(() => caches.match('./index.html'))
  );
});
