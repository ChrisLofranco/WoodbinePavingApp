/* service-worker.js — cache the app shell so the Calculator works offline.
 * Map tiles, geocoding, and routing require a live connection and are not
 * cached (they always try the network).
 */
var CACHE = 'woodbine-paving-v5';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './js/app.js',
  './js/calculator.js',
  './js/route.js',
  './manifest.json',
  './assets/woodbine-logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // Cache best-effort: a single failed asset shouldn't break install.
      return Promise.allSettled(SHELL.map(function (u) { return c.add(u); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // Never cache live map/route/geocode calls — always go to the network.
  var isLiveService =
    /maps\.googleapis\.com/.test(url.host) ||
    /maps\.gstatic\.com/.test(url.host) ||
    /photon\.komoot\.io/.test(url.host);
  if (isLiveService) return; // let the browser handle it normally

  // App shell + same-origin: cache-first, fall back to network.
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        }).catch(function () { return caches.match('./index.html'); });
      })
    );
    return;
  }

  // Other cross-origin GETs: try cache, then network, then cache it.
  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () { return hit; });
    })
  );
});
