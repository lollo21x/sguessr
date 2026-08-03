/* Service worker minimale per installare la PWA offline (shell). */
const CACHE = 'songguesser-v2'
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './songs.js',
  './manifest.json',
  './favicon.png',
  './favicon-32.png',
  './favicon-48.png',
  './pwa-192.png',
  './pwa-512.png',
  './apple-touch-icon.png',
  './icon-1024.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          try {
            const url = new URL(req.url)
            if (url.origin === self.location.origin && res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
          } catch (_) {}
          return res
        })
        .catch(() => cached)
      return cached || fresh
    }),
  )
})
