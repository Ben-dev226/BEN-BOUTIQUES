/* Service worker : pages en réseau d'abord (repli hors-ligne), images en cache. Jamais l'API ni l'admin. */
const V = 'fq-v1';
const SHELL = ['assets/css/shop.css', 'assets/js/core.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== location.origin) return;
  if (/\/(api|admin)\//.test(u.pathname) || /\/suivi/.test(u.pathname)) return;
  if (/\/uploads\//.test(u.pathname)) {            // images : cache d'abord
    e.respondWith(caches.open(V).then(async c => { const hit = await c.match(req); if (hit) return hit; const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }));
    return;
  }
  if (req.mode === 'navigate') {                    // pages : réseau, repli cache
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then(r => r || new Response('<meta charset=utf-8><body style="font:16px sans-serif;padding:2rem"><h1>Hors connexion</h1><p>Reconnectez-vous pour parcourir la boutique.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => { const net = fetch(req).then(r => { if (r.ok) caches.open(V).then(c => c.put(req, r.clone())); return r; }).catch(() => hit); return hit || net; }));
});
