// Ancien service worker retiré : il causait des blocages de mise à jour
// (une version de l'app pouvait rester figée en cache indéfiniment).
// Ce script se désinstalle lui-même et nettoie tout cache existant,
// puis ne rend plus jamais aucune version en cache.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((name) => caches.delete(name)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: "window" });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});
