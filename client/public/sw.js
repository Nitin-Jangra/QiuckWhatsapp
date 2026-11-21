// Minimal service worker: makes the app installable and loads the shell fast.
// Chats, QR codes and media are never cached (always live from the server).
const CACHE = 'wacrm-shell-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/media')) return;

  // Page loads: network first with timeout, fall back to the cached shell when slow or offline
  if (req.mode === 'navigate') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    e.respondWith(
      fetch(req, { signal: controller.signal })
        .then((res) => {
          clearTimeout(timer);
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
  // Built assets have hashed names: cache first
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }))
    );
  }
});
