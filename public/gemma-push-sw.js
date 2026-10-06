self.addEventListener("push", (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "Gemma",
      body: event.data ? event.data.text() : "Hai un aggiornamento.",
    };
  }

  const title = payload.title || "Gemma";
  const options = {
    body: payload.body || "Hai un aggiornamento sulla tua segnalazione.",
    tag: payload.tag || "gemma-ticket",
    data: {
      url: payload.url || "/cliente",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification?.data?.url || "/cliente",
    self.location.origin,
  ).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.startsWith(self.location.origin)) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    }),
  );
});
