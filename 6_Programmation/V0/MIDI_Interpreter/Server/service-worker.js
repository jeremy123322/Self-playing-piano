const cacheName = 'klann-robot-cache-v1';
const filesToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/nipplejs.min.js',
  '/heig_vd_logo.png',
  '/icon-192.png',
  '/icon-512.png'
];

// Install service worker
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(cacheName).then((cache) => cache.addAll(filesToCache))
  );
});

// Fetch resources
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
