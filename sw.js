// בבלי: the app works offline for whatever was opened before.
// Pages and code: network first (updates arrive at once), cache when offline.
// Text files of the tractates: from the cache at once, refreshed in the background.
const C = "babli-v1";
self.addEventListener("install", e => { self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", e => {
  const r = e.request; if (r.method !== "GET") return;
  const u = new URL(r.url);
  const same = u.origin === location.origin;
  const isData = same && /\.json$/.test(u.pathname) && !/manifest/.test(u.pathname);
  const isStatic = /(^|\.)gstatic\.com$|fonts\.googleapis\.com$/.test(u.hostname) || (same && /\.(ttf|png)$/.test(u.pathname));
  if (isData || isStatic) {
    e.respondWith(caches.open(C).then(async c => {
      const hit = await c.match(r);
      const net = fetch(r).then(res => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  } else if (same) {
    e.respondWith(fetch(r).then(res => { if (res.ok) caches.open(C).then(c => c.put(r, res.clone())); return res; })
      .catch(() => caches.match(r).then(x => x || caches.match("./"))));
  }
});
