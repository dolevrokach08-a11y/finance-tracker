// Service Worker for Finance Tracker PWA
//
// Bump SHELL_CACHE on every deploy that ships changed HTML/JS — the activate
// handler purges the old cache, guaranteeing the new shell replaces any stale
// cached firebase-config.js / *.html (the "change doesn't show up live" gotcha).
//
// VENDOR_CACHE is versioned separately and deliberately survives shell bumps.
// Everything in it is fetched from a URL that names its own version (pinned CDN
// paths, /vendor/<lib>-<version>.js, /firebasejs/10.7.1/...), so a cache hit can
// never be stale — a different version is a different URL. Without this split,
// every deploy would also throw away the third-party bytes and the cache-first
// win would evaporate exactly when the user reloads to get the new code.
const SHELL_CACHE = 'finance-tracker-v38';
const VENDOR_CACHE = 'finance-tracker-vendor-v1';
const KEEP = [SHELL_CACHE, VENDOR_CACHE];

// Scope-relative, not absolute. Absolute '/finance-tracker/...' paths 404 under
// `npx vite` at the repo root, and because cache.addAll is atomic that made the
// whole precache silently empty in local dev.
const SCOPE = new URL('./', self.registration.scope).pathname;
const PRECACHE = [
  '',
  'index.html',
  'login.html',
  'mortgage.html',
  'tax-optimizer.html',
  'shared/theme.css',
  'shared-theme.css',
  'shared/user-storage.js',
  'shared/data.js',
  'shared/load-script.js',
  'shared/nav.js',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png'
].map(p => SCOPE + p);
// portfolio.html (842KB) and finance.html (648KB) are deliberately NOT precached:
// pulling 1.5MB of HTML during install competes for bandwidth with the page the
// user is actually looking at. The runtime handler caches them on first visit.

// Requests that must reach the network untouched. Firestore's long-poll channel
// and the auth endpoints break if a SW mediates them, and the CF Worker proxies
// live prices — caching any of these would serve stale money data.
const NEVER_INTERCEPT = [
  'firestore.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'workers.dev',
  'api.anthropic.com',
  'finance.yahoo.com'
];

// Cross-origin hosts whose URLs carry a version, so cache-first is safe.
// Everything else now lives under vendor/ on our own origin. jsdelivr stays for
// tesseract.js, which is loaded on demand and deliberately not self-hosted.
const CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'www.gstatic.com',   // firebasejs/10.7.1/* — version is in the path
  'cdn.jsdelivr.net'   // tesseract.js only
];

// Install - cache the shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      // Individual adds, not addAll: addAll is atomic, so one 404 discards
      // every other entry and the failure is invisible.
      Promise.allSettled(PRECACHE.map(url => cache.add(url))).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length;
        console.log('📦 Cached app shell', results.length - failed, '/', results.length, 'into', SHELL_CACHE);
        results.forEach((r, i) => { if (r.status === 'rejected') console.warn('  ✗', PRECACHE[i], String(r.reason)); });
      })
    // skipWaiting() belongs INSIDE the waitUntil chain, not beside it. Called
    // synchronously alongside it, the new worker was still installing when it
    // ran and the request was dropped — it sat in `waiting` forever while the
    // previous worker kept serving, which meant `activate` never ran and old
    // caches were never purged. Observed live: v36 installed with 14 entries
    // while v35 stayed active with 25. That silently defeats the whole
    // bump-the-cache-name deploy discipline.
    ).then(() => self.skipWaiting())
  );
});

// Activate - clean caches we no longer keep
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names => Promise.all(
      names.map(name => {
        if (!KEEP.includes(name)) {
          console.log('🗑️ Deleting old cache:', name);
          return caches.delete(name);
        }
      })
    ))
  );
  self.clients.claim();
});

function cacheFirst(request, cacheName) {
  return caches.match(request).then(hit => {
    if (hit) return hit;
    return fetch(request).then(response => {
      // Opaque responses (status 0) are what cross-origin scripts and fonts
      // without CORS look like. The old handler's `status === 200 &&
      // type === 'basic'` test rejected exactly those, which is why no CDN
      // asset was ever cached. Store them; just never inspect them.
      if (response && (response.ok || response.type === 'opaque')) {
        const copy = response.clone();
        caches.open(cacheName).then(cache => cache.put(request, copy));
      }
      return response;
    });
  });
}

function staleWhileRevalidate(request) {
  return caches.match(request).then(hit => {
    const network = fetch(request).then(response => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }).catch(() => hit);
    return hit || network;
  });
}

function networkFirstWithTimeout(request, ms) {
  return new Promise(resolve => {
    let settled = false;
    const done = res => { if (!settled) { settled = true; resolve(res); } };

    const timer = setTimeout(() => {
      caches.match(request).then(hit => { if (hit) done(hit); });
    }, ms);

    fetch(request).then(response => {
      clearTimeout(timer);
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(SHELL_CACHE).then(cache => cache.put(request, copy));
      }
      done(response);
    }).catch(() => {
      clearTimeout(timer);
      caches.match(request).then(hit => done(hit || Response.error()));
    });
  });
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return; // never mediate writes

  const url = new URL(request.url);
  if (NEVER_INTERCEPT.some(host => url.hostname.includes(host))) return;

  // HTML navigations stay network-first on purpose. All of this app's logic
  // lives inline inside the HTML, so serving a stale document means serving
  // stale application code. The timeout only decides how long we wait before
  // falling back to the cached copy, which is what makes offline work.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstWithTimeout(request, 2500));
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.includes('/vendor/')) {
      event.respondWith(cacheFirst(request, VENDOR_CACHE));
    } else {
      event.respondWith(staleWhileRevalidate(request));
    }
    return;
  }

  if (CACHEABLE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
    event.respondWith(cacheFirst(request, VENDOR_CACHE));
  }
  // anything else cross-origin: fall through to the network untouched
});
