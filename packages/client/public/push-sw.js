/* Web Push for the installed app; loaded by the generated service worker (workbox importScripts). */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // not JSON: show the defaults
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Arcane Academies', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only paths of this app are opened (e.g. /?room=CODE joins the room).
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin + '/';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((w) => 'navigate' in w);
      if (win) {
        await win.focus();
        return win.navigate(url);
      }
      return self.clients.openWindow(url);
    })(),
  );
});
