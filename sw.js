/* Service Worker – macht das Auftragsbuch offline verfügbar.
   Die Version bei jeder Änderung hochzählen, damit alte Dateien weichen. */
var CACHE = 'auftragsbuch-v4';
var ASSETS = [
  './', './index.html', './app.css', './app.js', './manifest.json',
  './daten/martin-arbeitszeit.json',
  './icon.svg', './icon-180.png', './icon-192.png', './icon-512.png', './icon-512-maskable.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; })
          .map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

/* Aus dem Cache antworten, im Hintergrund erneuern: offline schnell,
   und eine neue Fassung liegt beim nächsten Start bereit. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(e.request).then(function (hit) {
      var net = fetch(e.request).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
