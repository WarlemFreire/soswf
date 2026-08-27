// sw.js — cache-first do app inteiro. O motorista trabalha em tunel, garagem e
// area sem sinal; o app nao pode depender de rede em momento nenhum.

const VERSAO = "copiloto-v6";

const ARQUIVOS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/copiloto.css",
  "./js/app.js",
  "./js/config.js",
  "./js/db.js",
  "./js/export.js",
  "./js/feedback.js",
  "./js/geo.js",
  "./js/keypad.js",
  "./js/metrics.js",
  "./js/store.js",
  "./js/tela-agora.js",
  "./js/tela-config.js",
  "./js/tela-corrida.js",
  "./js/tela-custo.js",
  "./js/tela-fechamento.js",
  "./js/tela-historico.js",
  "./js/tela-registro.js",
  "./js/ui.js",
  "./icons/icone-192.png",
  "./icons/icone-512.png",
  "./icons/icone-mascara-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches.open(VERSAO).then((cache) => cache.addAll(ARQUIVOS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => c !== VERSAO).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (evento) => {
  const requisicao = evento.request;
  if (requisicao.method !== "GET") return;
  if (new URL(requisicao.url).origin !== self.location.origin) return;

  evento.respondWith(
    caches.match(requisicao, { ignoreSearch: true }).then((cacheado) => {
      if (cacheado) {
        // Atualiza em segundo plano sem segurar a resposta.
        fetch(requisicao)
          .then((resposta) => {
            if (resposta.ok) caches.open(VERSAO).then((cache) => cache.put(requisicao, resposta));
          })
          .catch(() => {});
        return cacheado;
      }
      return fetch(requisicao)
        .then((resposta) => {
          if (resposta.ok) {
            const copia = resposta.clone();
            caches.open(VERSAO).then((cache) => cache.put(requisicao, copia));
          }
          return resposta;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
