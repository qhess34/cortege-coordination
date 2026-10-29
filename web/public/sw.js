// Service worker de l'application terrain : installation sur l'écran d'accueil et démarrage rapide.
// Les données (/api) ne sont jamais mises en cache : elles viennent toujours du serveur (le mode hors ligne avec
// file d'actions relève d'une phase ultérieure). Les pages passent d'abord par le réseau, le cache ne sert qu'en
// secours ; les fichiers compilés (/assets, noms versionnés) sont servis depuis le cache.
const CACHE = 'cortege-v2';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icone.svg'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  // Liens d'invitation et de connexion : jamais en cache (le jeton est dans l'adresse).
  if (url.pathname.startsWith('/rejoindre/') || url.pathname.startsWith('/connexion/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(CACHE).then((c) => c.put('/', copy));
      return res;
    }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
  }
});
