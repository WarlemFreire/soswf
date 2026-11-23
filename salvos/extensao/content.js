// Guarda os posts recebidos e controla a rolagem lenta da página de Salvos.
(function () {
  let posts = {};         // code -> post
  let carregado = false;
  let rodando = false;
  let meta = 50;
  let semNovidade = 0;
  let timer = null;
  let selo = null;

  const aleatorio = (min, max) => min + Math.random() * (max - min);
  const total = () => Object.keys(posts).length;

  chrome.storage.local.get(["posts"], (r) => {
    posts = Object.assign(r.posts || {}, posts);
    carregado = true;
    atualizarSelo();
  });

  let gravarPendente = null;
  function gravar() {
    clearTimeout(gravarPendente);
    gravarPendente = setTimeout(() => chrome.storage.local.set({ posts }), 800);
  }

  window.addEventListener("message", (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__salvos !== "posts") return;
    let novos = 0;
    for (const p of ev.data.posts) {
      if (!p || !p.code) continue;
      if (!posts[p.code]) novos++;
      // atualiza sempre: links de imagem do Instagram expiram, o mais novo vale mais
      posts[p.code] = Object.assign({}, posts[p.code], p);
    }
    if (novos) semNovidade = 0;
    gravar();
    atualizarSelo();
  });

  function atualizarSelo(msgExtra) {
    if (!document.body) return;
    if (!selo) {
      selo = document.createElement("div");
      selo.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:999999;background:#111;color:#fff;" +
        "font:13px system-ui;padding:8px 12px;border-radius:8px;opacity:.9;pointer-events:none";
      document.body.appendChild(selo);
    }
    selo.style.display = location.pathname.includes("/saved/") || rodando ? "block" : "none";
    selo.textContent =
      "Salvos coletados: " + total() + (rodando ? " / meta " + meta + " – rolando…" : "") +
      (msgExtra ? " – " + msgExtra : "");
  }

  function instagramReclamou() {
    const t = (document.body && document.body.innerText) || "";
    return /Tente novamente mais tarde|Try Again Later|restringimos determinadas atividades|We restrict certain activity|Suspeitamos de comportamento automatizado|automated behavior/i.test(t);
  }

  function parar(motivo) {
    rodando = false;
    clearTimeout(timer);
    atualizarSelo(motivo);
    chrome.storage.local.set({ status: motivo || "parado" });
  }

  let passos = 0;
  function passo() {
    if (!rodando) return;
    if (instagramReclamou()) return parar("Instagram mostrou aviso. Parei. Espere algumas horas.");
    if (total() >= meta) return parar("meta atingida");

    const noFim = window.innerHeight + window.scrollY >= document.body.scrollHeight - 50;
    semNovidade++;
    if (noFim && semNovidade > 12) return parar("chegou ao fim da lista");

    window.scrollBy({ top: aleatorio(350, 900), behavior: "smooth" });
    passos++;
    // de vez em quando sobe um pouco, como gente faz
    if (Math.random() < 0.08) setTimeout(() => window.scrollBy({ top: -aleatorio(100, 300), behavior: "smooth" }), 800);

    let espera = aleatorio(2500, 6000);
    if (passos % Math.round(aleatorio(12, 20)) === 0) espera = aleatorio(20000, 60000); // pausa longa
    atualizarSelo();
    timer = setTimeout(passo, espera);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, responder) => {
    if (msg.cmd === "iniciar") {
      if (!location.pathname.includes("/saved/")) {
        responder({ ok: false, erro: "Abra primeiro a página de Salvos (Perfil → Salvos → Todas as publicações)." });
        return;
      }
      meta = Math.max(1, parseInt(msg.meta, 10) || 50);
      rodando = true;
      semNovidade = 0;
      chrome.storage.local.set({ status: "rodando" });
      passo();
      responder({ ok: true });
    } else if (msg.cmd === "parar") {
      parar("parado por você");
      responder({ ok: true });
    } else if (msg.cmd === "estado") {
      responder({ ok: true, total: total(), rodando, carregado });
    }
    return true;
  });

  document.addEventListener("DOMContentLoaded", () => atualizarSelo());
})();
