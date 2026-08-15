/* Service Worker – macht das Auftragsbuch offline verfügbar.
   Die Version bei jeder Änderung hochzählen, damit alte Dateien weichen. */
var CACHE = 'auftragsbuch-v10';
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

/* Programmdateien: erst das Netz, Cache nur als Rückfall.
   Andersherum („erst Cache“) bekäme man nach einer Änderung immer noch
   einmal die alte Fassung zu sehen – genau das soll nicht passieren.
   Symbole ändern sich praktisch nie und dürfen aus dem Cache kommen. */
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  var merken = function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return res;
  };

  if (/\.(png|svg|ico|webp)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then(function (hit) {
        return hit || fetch(e.request).then(merken);
      })
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then(merken).catch(function () {
      return caches.match(e.request).then(function (hit) {
        if (hit) return hit;
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      });
    })
  );
});
