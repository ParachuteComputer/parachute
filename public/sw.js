// Parachute has no service worker. This file is here for the browsers that still hold one: the older hosted app
// (parachute-app) registered a worker at this address, which kept its own copy of that app and answered every page
// load from it. A browser checks this address for a newer worker; finding this one, it installs it, and this one
// takes itself out, drops what the older one kept, and loads each open page again from the network.
// (Without it the address would answer with the app's page, the check would fail, and the older app would stay.)
self.addEventListener("install", () => { self.skipWaiting(); });
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.registration.unregister();
    for (const name of await self.caches.keys()) await self.caches.delete(name);
    for (const client of await self.clients.matchAll({ type: "window" })) client.navigate(client.url).catch(() => {});
  })());
});
