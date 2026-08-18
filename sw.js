self.addEventListener('install', (event) => {
  console.log('[Service Worker] Instalado');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activado');
  return self.clients.claim();
});

// Interceptar peticiones para que la web funcione como PWA
self.addEventListener('fetch', (event) => {
  // Por ahora dejamos pasar todo al servidor directamente (Network falling back to cache logic se puede añadir después)
  event.respondWith(fetch(event.request));
});

// Escuchar eventos Push (Notificaciones)
self.addEventListener('push', function(event) {
  if (event.data) {
    const data = event.data.json();
    const options = {
      body: data.body,
      icon: data.icon || 'https://via.placeholder.com/192x192/8a2be2/ffffff?text=H',
      vibrate: [200, 100, 200],
      data: {
        url: data.url || '/chat.html'
      }
    };
    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
  }
});

// Al hacer clic en la notificación
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url)
  );
});
