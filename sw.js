// Service Worker for Finance Tracker PWA
const CACHE_NAME = 'finance-tracker-v2';
const urlsToCache = [
  '/finance-tracker/',
  '/finance-tracker/index.html',
  '/finance-tracker/login.html',
  '/finance-tracker/portfolio.html',
  '/finance-tracker/finance.html',
  '/finance-tracker/firebase-config.js',
  '/finance-tracker/manifest.json',
  '/finance-tracker/icons/icon-192.png',
  '/finance-tracker/icons/icon-512.png'
];

// Install - cache files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.log('⚠️ Cache failed:', err);
      })
  );
  self.skipWaiting();
});

// Activate - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch - network first, fallback to cache
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Clone and cache successful responses
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseClone);
            });
        }
        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request);
      })
  );
});
