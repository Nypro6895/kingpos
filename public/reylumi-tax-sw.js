// The root script can cover the exact /tax start URL as well as /tax/*.
// All financial data stays online and behind the current server access checks.
self.addEventListener("install",()=>self.skipWaiting());
self.addEventListener("activate",event=>event.waitUntil(self.clients.claim()));
self.addEventListener("fetch",event=>event.respondWith(fetch(event.request)));
