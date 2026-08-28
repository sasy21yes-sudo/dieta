/* Cache offline: l'app deve funzionare anche in cucina senza rete. */
const V = 'dieta-v7';
const ASSETS = ['./', './index.html', './style.css', './app.js',
                './viz.css', './charts.js', './piano.js', './prodotti.js', './foto.js', './palestra.js',
                './hyrox.js', './data/palestra.json', './data/hyrox.json',
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

/*
 * Rete-prima su tutto, cache come rete di sicurezza.
 *
 * Prima il guscio era cache-prima: piu' veloce all'avvio, ma qualsiasi
 * versione nuova di app.js restava invisibile finche' non cambiava V. Si
 * finisce a guardare una copia vecchia dell'app credendo che le modifiche
 * non abbiano funzionato — ed e' esattamente quello che e' successo.
 * L'app pesa ~100 KB: il costo di ricontrollare la rete e' trascurabile,
 * il costo di mostrare codice vecchio no.
 */
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  // richieste verso altri domini (i font): lasciale gestire al browser
  if (new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r).then(res => {
      if (res && res.ok) {
        const cp = res.clone();
        caches.open(V).then(c => c.put(r, cp)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(r).then(hit =>
      hit || (r.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
