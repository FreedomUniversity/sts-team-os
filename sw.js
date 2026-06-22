// Bussola (STS) — Service Worker
// Shell NETWORK-FIRST: online prende sempre l'ultima versione; offline ripiega sulla cache.
// I dati Supabase non passano mai dalla cache.
const CACHE = 'sts-v22';
const SHELL = ['./','./index.html','./styles.css','./app.js','./vendor/supabase.umd.js','./manifest.webmanifest','./logo-96.png','./logo-192.png','./logo-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(()=>{}))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // mai cache per Supabase (auth/dati sempre freschi)
  if (url.hostname.endsWith('supabase.co')) return;
  if (e.request.method !== 'GET') return;
  // shell same-origin: NETWORK-FIRST con fallback alla cache (offline)
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request)
        .then(r => { const cl = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); return r; })
        .catch(() => caches.match(e.request))
    );
  }
});
