// Offline cache. Bump CACHE when you change any file below, or the
// old copy keeps being served.
const CACHE = "gym-plan-v20260903-1";
const ASSETS = [
  "./",
  "index.html",
  "styles.css",
  "manifest.json",
  "src/app.js",
  "src/plan.js",
  "src/store.js",
  "src/session.js",
  "src/timer.js",
  "src/today.js",
  "src/history.js",
  "src/summary.js",
  "src/settings.js",
  "public/icon-180.png",
  "public/icon-192.png",
  "public/icon-512.png",
  "public/img/abwheel.jpg",
  "public/img/bands.jpg",
  "public/img/bench.jpg",
  "public/img/cable.jpg",
  "public/img/dbrack.jpg",
  "public/img/ez.jpg",
  "public/img/fly.jpg",
  "public/img/latpull.jpg",
  "public/img/legs.jpg",
  "public/img/press.jpg",
  "public/img/pullup.jpg",
  "public/img/rack.jpg",
  "public/img/rope.jpg",
  "public/img/smith.jpg"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll fails the whole install if any single file 404s; take them
    // one at a time so a missing image never blocks the app going offline.
    await Promise.all(ASSETS.map(u => c.add(u).catch(err => console.warn("skip", u, err))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Cache first: at the gym the phone is often on a dead wifi that resolves
// but never answers, and waiting on the network there means waiting forever.
// Fresh copies are picked up in the background for next launch.
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // let fonts go straight to the network

  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => null);

    if (cached) { network; return cached; }
    const res = await network;
    if (res) return res;
    // Offline and never cached: for a page request fall back to the shell.
    if (req.mode === "navigate") return (await caches.match("index.html")) || Response.error();
    return Response.error();
  })());
});
