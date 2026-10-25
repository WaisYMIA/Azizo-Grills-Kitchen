// Azizo Butchery & Grill — Service Worker (multi-page site)
// Bump CACHE_NAME whenever shared assets change so visitors get the update.
const CACHE_NAME = 'azizo-v321';
const CORE_ASSETS = [
  './',
  './index.html',
  './fresh-market.html',
  './ready-to-eat.html',
  './meal-planner.html',
  './budget.html',
  './budget.js',
  './event-budget.html',
  './event-budget.js',
  './eb-flag.js',
  './site-settings.json',
  './areas.html',
  './areas.js',
  './outdoor-events.html',
  './about.html',
  './reviews.html',
  './faq.html',
  './contact.html',
  './styles.css',
  './app.js',
  './pwa.js',
  './recipes.html',
  './kitchens.html',
  './kitchens.js',
  './kitchen-partners.html',
  './kk.css',
  './kk-common.js',
  './kk-config.js',
  './recipe.html',
  './recipes.js',
  './recipes.json',
  './products.json',
  './branches.json',
  './manifest.json',
  './logo.png',
  './favicon.png',
  './shopfront.jpg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS))
  );
});

// Updates wait until the visitor taps "Update now" (pwa.js sends SKIP_WAITING).
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  // Never let the service worker answer backend API calls from its own cache.
  // The whole point of the admin tool and live checkout is that a product edit
  // or an order-status change shows up immediately — if this cache-first layer
  // intercepted /api/* the way it does static assets, admin.html and the
  // storefront could briefly show stale prices, stock or order statuses even
  // though the database already has the correct, current data. Pass these
  // straight through untouched and let the browser's own (uncached) fetch
  // handle them.
  if (url.pathname.startsWith('/api/')) {
    return;
  }
  // Staff and admin screens are working tools — always fetch them fresh, never from the cache.
  if (/\/(staff|rider|admin|admin-site|kitchen-portal|kitchens-admin|kitchens-rider)(-reports|-areas|-reviews)?\.(html|js)$/.test(url.pathname)) {
    return;
  }
  // Price list and site switches change from the admin dashboard: network first, cache only as an offline fallback.
  if (/\/(products|site-settings)\.json$/.test(url.pathname)) {
    event.respondWith(fetch(request).then((r) => { if (r && r.status === 200) { const c = r.clone(); caches.open(CACHE_NAME).then((ch) => ch.put(request, c)); } return r; }).catch(() => caches.match(request)));
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
