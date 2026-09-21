const CACHE_PREFIX = 'calendar-todo-';
const CACHE_NAME = `${CACHE_PREFIX}v19`;
const APP_SHELL = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './style.css?v=19',
    './script.js?v=19',
    './supabase.js',
    './font-settings.js',
    './pwa.js',
    './manifest.json',
    './assets/favicon.png',
    './assets/calendar-icon.png',
    './assets/icon-192.png',
    './assets/icon-512.png',
    './온글잎 콘콘체.ttf',
    './온글잎 긍정.ttf'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(APP_SHELL))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(
                names
                    .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
                    .map(name => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Supabase and every other cross-origin request must remain network-only.
    if (request.method !== 'GET' || url.origin !== self.location.origin) return;

    // Fresh HTML must not run with cached old event handlers or styles.
    if (request.mode === 'navigate' || ['script', 'style'].includes(request.destination)) {
        event.respondWith(
            fetch(request, { cache: 'no-cache' })
                .then(response => {
                    if (response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(async () => {
                    const cached = await caches.match(request);
                    if (cached) return cached;
                    if (request.mode === 'navigate') {
                        return await caches.match('./index.html') || await caches.match('./');
                    }
                    return Response.error();
                })
        );
        return;
    }

    event.respondWith(
        caches.match(request).then(cached => (
            cached || fetch(request).then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                }
                return response;
            })
        ))
    );
});
