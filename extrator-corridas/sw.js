// sw.js — duas funcoes.
//
// 1. Cache do app inteiro, pra abrir sem internet (o OCR do Tesseract é o
//    unico pedaço que precisa de rede, e so na primeira vez).
// 2. Alvo de compartilhamento: da galeria o motorista marca todos os prints,
//    toca em Compartilhar e escolhe o Extrator. O Android manda tudo aqui num
//    POST, a gente guarda e devolve pra pagina ja com os prints na mao - sem
//    ter que procurar arquivo nenhum.

const VERSAO = "extrator-v1";
const CAIXA_COMPARTILHADO = "extrator-compartilhado";

const ARQUIVOS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/extrator.css",
  "./js/app.js",
  "./js/ocr.js",
  "./js/parser.js",
  "./icons/icone-192.png",
  "./icons/icone-512.png",
];

self.addEventListener("install", (evento) => {
  evento.waitUntil(
    caches
      .open(VERSAO)
      .then((cache) => cache.addAll(ARQUIVOS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((chaves) =>
        Promise.all(
          chaves
            .filter((c) => c !== VERSAO && c !== CAIXA_COMPARTILHADO)
            .map((c) => caches.delete(c)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Guarda o que veio do compartilhamento e manda a pagina abrir ja lendo. */
async function receberCompartilhado(requisicao) {
  const dados = await requisicao.formData();
  const arquivos = dados.getAll("prints").filter((a) => a && a.size);
  const cache = await caches.open(CAIXA_COMPARTILHADO);

  for (const chave of await cache.keys()) await cache.delete(chave);
  await Promise.all(
    arquivos.map((arquivo, i) =>
      cache.put(
        new Request(`./__compartilhado/${String(i).padStart(3, "0")}`),
        new Response(arquivo, {
          headers: {
            "content-type": arquivo.type || "application/octet-stream",
            "x-nome": encodeURIComponent(arquivo.name || `print-${i}.png`),
          },
        }),
      ),
    ),
  );
  return Response.redirect(`./?compartilhado=${arquivos.length}`, 303);
}

self.addEventListener("fetch", (evento) => {
  const url = new URL(evento.request.url);

  if (evento.request.method === "POST" && url.pathname.endsWith("/compartilhar")) {
    evento.respondWith(receberCompartilhado(evento.request));
    return;
  }
  if (evento.request.method !== "GET") return;
  if (url.pathname.includes("/__compartilhado/")) return;

  evento.respondWith(
    caches.match(evento.request).then((achado) => achado || fetch(evento.request)),
  );
});
