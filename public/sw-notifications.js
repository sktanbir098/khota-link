self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId =
    event.notification.data && event.notification.data.chatId
      ? event.notification.data.chatId
      : null;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          if (chatId) {
            client.postMessage({ type: 'OPEN_CHAT', chatId });
          }
          return;
        }
      }
      if (self.clients.openWindow) {
        const targetUrl = chatId ? `/?chat=${encodeURIComponent(chatId)}` : '/';
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
