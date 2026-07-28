// Service worker „finansowej" — offline-ready (app shell w cache, API zawsze z sieci).
// Po każdym deployu podbij CACHE_VERSION (RUNBOOK) — stary cache zostanie usunięty.
const CACHE_VERSION = 'finansowa-v37';
const SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-512.png',
  '/styles.css', '/css/wpis.css', '/css/historia.css', '/css/raporty.css',
  '/css/kategorie.css', '/css/paragon.css',
  '/main.js',
  '/js/core.js', '/js/kwota.js', '/js/kategorie.js', '/js/wpis.js', '/js/historia.js',
  '/js/import.js', '/js/raporty.js', '/js/admin.js', '/js/paleta.js',
  '/js/przydzial.js', '/css/przydzial.css', '/css/sygnal.css',
  '/glass.js', '/glass-mapa.js', '/theme.js', '/typografia.js', '/css/logowanie.css',
  // UWAGA: fontów sf-pro-*.woff2 celowo NIE ma w SHELL — leżą tylko na serwerze
  // (poza gitem, kwestia licencji Apple), a addAll wywala instalację SW przy 404.
  // Cache'ują się runtime'owo przy pierwszym pobraniu (fetch handler niżej).
  // Archivo i Plex Mono to inna sprawa: są na OFL, leżą W REPO, więc wchodzą do
  // shella normalnie — wnętrze ma wyglądać tak samo offline.
  '/fonts/archivo-var.woff2', '/fonts/plex-mono-400.woff2',
  '/fonts/plex-mono-500.woff2', '/fonts/plex-mono-600.woff2',
  '/js/paragon.js', '/js/paragon-edit.js', '/js/paragon-poz.js', '/js/paragon-lista.js',
  '/js/paragon-plik.js',
  // Plansza powitalna: ładowana importem dynamicznym, ale w SHELL musi być, bo
  // grana jest zaraz po powrocie z logowania — także przy słabej sieci.
  '/witaj.js', '/witaj-kucyk.js', '/witaj-konfetti.js', '/css/witaj.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;               // POST/PATCH/DELETE — zawsze sieć (kolejka jest w core.js)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return; // API nigdy z cache
  // app shell: cache-first z odświeżeniem w tle; nawigacja offline -> index.html
  e.respondWith(
    caches.match(e.request, { ignoreSearch: e.request.mode === 'navigate' }).then((hit) => {
      const net = fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit || (e.request.mode === 'navigate' ? caches.match('/index.html') : undefined));
      return hit || net;
    })
  );
});
