/* Cache offline: l'app deve funzionare anche in cucina senza rete. */
const V = 'dieta-v2';
const ASSETS = ['./', './index.html', './style.css', './app.js',
                './data/dieta.json', './manifest.json',
                './icons/icon-180.png', './icons/icon-192.png',
                './icons/icon-512.png', './icons/maskable-512.png'];

self.addEventListener('install', e => {
  // cache.addAll e' atomico: un solo 404 farebbe fallire l'installazione
  // intera e l'app resterebbe senza offline, senza dirlo a nessuno.
  // Meglio mettere in cache quello che c'e' e sopravvivere al resto.
  e.waitUntil(caches.open(V)
    .then(c => Promise.all(ASSETS.map(a => c.add(a).catch(() => null))))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  // rete-prima per i dati, cache-prima per il guscio
  if (r.url.includes('dieta.json')) {
    e.respondWith(fetch(r).then(res => {
      const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); return res;
    }).catch(() => caches.match(r)));
  } else {
    e.respondWith(caches.match(r).then(hit => hit || fetch(r).catch(() =>
      caches.match('./index.html'))));
  }
});
