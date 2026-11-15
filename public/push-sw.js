// Powiadomienia push portalu. Dołączany do service workera PWA (workbox importScripts w
// vite.config.ts). Payload z api/notifications: { title, body, url, tag } - bez danych spraw.

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Biuro';
  const url = typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/biuro';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === 'string' ? data.body : '',
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      // Tag z linkiem: dwa powiadomienia tego samego rodzaju o różnych sprawach nie zastępują się.
      tag: typeof data.tag === 'string' ? `${data.tag}:${url}` : undefined,
      data: { url },
      lang: 'pl',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/biuro', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && 'focus' in client) {
          return client
            .focus()
            .then((focused) => (focused && 'navigate' in focused ? focused.navigate(target.href) : focused))
            // Okno poza kontrolą tego service workera (np. po twardym odświeżeniu) nie da się przekierować.
            .catch(() => self.clients.openWindow(target.href));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
