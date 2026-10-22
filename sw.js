/*
 * Service Worker: App startet auch ohne Netz.
 * Strategie "Netz zuerst": online immer die neueste Version, offline der
 * zuletzt geladene Stand. Nur eigene Dateien – Supabase läuft direkt.
 */
const CACHE = 'erledigungen-v1';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './js/settings.js',
  './js/store.js',
  './js/app.js',
  './js/vendor/supabase-2.117.2.js',
  './js/config.js',
  './js/sync.js',
  './js/settings-panel.js',
];
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const fromCache = () =>
        cache.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === 'navigate' ? cache.match('./index.html') : undefined));

      const network = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      network.catch(() => {}); // Fehler wird unten behandelt

      // Bei langsamem Netz nach kurzer Zeit auf den gespeicherten Stand ausweichen
      const timeout = new Promise((resolve) => setTimeout(resolve, NETWORK_TIMEOUT)).then(fromCache);
      try {
        const res = await Promise.race([network, timeout]);
        if (res) return res;
        return await network;
      } catch (err) {
        const hit = await fromCache();
        if (hit) return hit;
        throw err;
      }
    })()
  );
});
