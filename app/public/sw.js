// Notifications only: no fetch handler, application caching or offline interception.
// Resolve every asset and new window against the registration scope (/ or /claude/).
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch { payload = { title: 'ClaudeWeb', body: event.data.text() }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'ClaudeWeb', {
    body: payload.body || '',
    data: payload.data || {},
    tag: payload.data?.tag || ((payload.data?.sessionId || 'global') + ':' + (payload.data?.code || 'default')),
    renotify: true,
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const sessionId = typeof event.notification.data?.sessionId === 'string' ? event.notification.data.sessionId : null;
  const provider = event.notification.data?.provider || null;
  const urlPath = sessionId ? '/session/' + encodeURIComponent(sessionId) : '/';
  const target = new URL(urlPath.slice(1), self.registration.scope);
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientList) {
      // Never focus another WebDesktop app on the same host.
      if (client.url.startsWith(self.registration.scope)) {
        await client.focus();
        client.postMessage({ type: 'notification:navigate', sessionId, provider, urlPath });
        return;
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
