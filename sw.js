// STS Performance OS — Service Worker (cache-first shell, network per i dati Supabase)
const CACHE = 'sts-v6';
const SHELL = ['./','./index.html','./styles.css','./app.js','./vendor/supabase.umd.js','./manifest.webmanifest','./logo-96.png','./logo-192.png','./logo-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(()=>{}))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // mai cache per Supabase (auth/dati sempre freschi)
  if (url.hostname.endsWith('supabase.co')) return;
  if (e.request.method !== 'GET') return;
  // shell same-origin: cache-first con aggiornamento in background
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then(cached => {
        const net = fetch(e.request).then(r => { const cl = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); return r; }).catch(()=>cached);
        return cached || net;
      })
    );
  }
});
