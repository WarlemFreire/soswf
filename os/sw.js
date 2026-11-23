// sw.js — cache-first do app: casa sem sinal, subsolo e telhado nao podem
// travar o registro de uma etapa.
const VERSAO = "soswf-os-v1";
const ARQUIVOS = [
  "./", "./index.html", "./manifest.webmanifest", "./css/os.css",
  "./js/app.js", "./js/calculos.js", "./js/camera.js", "./js/db.js",
  "./js/motor.js", "./js/roteiros.js", "./js/sync.js", "./js/ui.js",
];
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()))
);
self.addEventListener("activate", (e) =>
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cacheado) => {
      const rede = fetch(req)
        .then((r) => {
          if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
          return r;
        })
        .catch(() => cacheado);
      return cacheado || rede;
    })
  );
});
