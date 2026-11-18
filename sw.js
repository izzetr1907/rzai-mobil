/* rzAI Mobil service worker: uygulama kabugunu onbellege alir -> internetsiz acilir.
   Model dosyalari (huggingface / github) WebLLM tarafindan Cache API'de ayrica saklanir. */
const CACHE = "rzai-mobil-v1.0.1";
const SHELL = ["./", "index.html", "style.css", "app.js", "worker.js", "manifest.webmanifest",
  "vendor/web-llm.js", "vendor/marked.min.js", "vendor/purify.min.js", "vendor/highlight.min.js", "vendor/github-dark.min.css",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png", "icons/icon-maskable-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("rzai-mobil-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // model indirmelerine karisma
  // once onbellek (internetsiz calisir), arkada guncelle
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(e.request, {ignoreSearch: true});
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || (e.request.mode === "navigate" ? c.match("index.html") : Response.error());
  }));
});
