/* Service worker PWA — network-first per JS/CSS/HTML così progresso e catalogo restano aggiornati */
const CACHE = 'songguesser-v2.3'
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

function isShellRequest(url) {
  const path = url.pathname
  return (
    path.endsWith('.js') ||
    path.endsWith('.css') ||
    path.endsWith('.html') ||
    path.endsWith('/') ||
    path.endsWith('/index.html') ||
    /\/sw\.js$/.test(path)
  )
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  let url
  try {
    url = new URL(req.url)
  } catch (_) {
    return
  }

  // Solo same-origin
  if (url.origin !== self.location.origin) return

  // app.js / songs.js / style / html: SEMPRE rete prima (poi cache offline)
  // Evita che la PWA resti bloccata su codice vecchio senza persistenza
  if (isShellRequest(url)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html'))),
    )
    return
  }

  // Icone/static: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {})
          }
          return res
        })
        .catch(() => cached)
      return cached || fresh
    }),
  )
})
