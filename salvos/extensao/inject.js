// Roda dentro da página do Instagram. Não faz nenhuma requisição própria:
// só lê as respostas que o próprio Instagram já recebe enquanto a página rola.
(function () {
  const extrair = window.__salvosExtrairPosts;
  if (!extrair || window.__salvosInjetado) return;
  window.__salvosInjetado = true;

  const naPaginaDeSalvos = () => location.pathname.includes("/saved/");

  function processarTexto(texto, origem) {
    if (!naPaginaDeSalvos() || !texto || texto.length < 50) return;
    if (texto.indexOf('"code"') === -1) return;
    const origemSalvos = /saved/i.test(origem) || /feed__saved|saved__posts|saved_media|saved_collection/i.test(texto);
    // algumas respostas vêm com prefixo anti-JSON ou várias linhas de JSON
    const limpo = texto.replace(/^for \(;;\);/, "");
    const blocos = [];
    try {
      blocos.push(JSON.parse(limpo));
    } catch (_) {
      for (const linha of limpo.split("\n")) {
        try { blocos.push(JSON.parse(linha)); } catch (_) {}
      }
    }
    for (const b of blocos) {
      const posts = extrair(b).filter((p) => p.salvo_confirmado || origemSalvos);
      if (posts.length) window.postMessage({ __salvos: "posts", posts }, location.origin);
    }
  }

  // fetch
  const fetchOriginal = window.fetch;
  window.fetch = async function (...args) {
    const resp = await fetchOriginal.apply(this, args);
    try {
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      if (/\/api\/|graphql/.test(url)) {
        resp.clone().text().then((t) => processarTexto(t, url)).catch(() => {});
      }
    } catch (_) {}
    return resp;
  };

  // XMLHttpRequest
  const abrir = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url, ...resto) {
    this.__salvosUrl = String(url || "");
    return abrir.call(this, metodo, url, ...resto);
  };
  const enviar = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (/\/api\/|graphql/.test(this.__salvosUrl || "")) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") processarTexto(this.responseText, this.__salvosUrl);
          else if (this.responseType === "json" && this.response) processarTexto(JSON.stringify(this.response), this.__salvosUrl);
        } catch (_) {}
      });
    }
    return enviar.apply(this, args);
  };

  // Primeira leva de posts costuma vir embutida no HTML da página.
  function varrerScriptsEmbutidos() {
    document.querySelectorAll('script[type="application/json"]').forEach((s) => {
      if (s.__salvosLido) return;
      s.__salvosLido = true;
      processarTexto(s.textContent, "embutido");
    });
  }
  document.addEventListener("DOMContentLoaded", varrerScriptsEmbutidos);
  setInterval(varrerScriptsEmbutidos, 3000);
})();
