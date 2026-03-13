/* BikeNav Service Worker — offline caching */
const CACHE_NAME = 'bikenav-v2';
const ASSETS = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/routing.js',
    '/bluetooth.js',
    '/map_renderer.js',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    const url = e.request.url;
    // Network-first for external APIs (OSRM, tiles)
    if (url.includes('router.project-osrm.org') ||
        url.includes('tile.openstreetmap.org') ||
        url.includes('unpkg.com')) {
        e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    } else {
        // Cache-first for local assets
        e.respondWith(
            caches.match(e.request).then(cached => cached || fetch(e.request))
        );
    }
});
