const $ = (id) => document.getElementById(id);
const msg = (t) => ($("msg").textContent = t || "");

function abaAtual(cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (abas) => cb(abas[0]));
}

function atualizar() {
  chrome.storage.local.get(["posts", "status"], (r) => {
    $("total").textContent = Object.keys(r.posts || {}).length;
    if (r.status && r.status !== "rodando") msg("Último estado: " + r.status);
  });
}

$("iniciar").onclick = () => {
  abaAtual((aba) => {
    if (!aba || !/^https:\/\/www\.instagram\.com\//.test(aba.url || "")) {
      return msg("Abra o Instagram nesta aba: Perfil → Salvos → Todas as publicações.");
    }
    chrome.tabs.sendMessage(aba.id, { cmd: "iniciar", meta: $("meta").value }, (r) => {
      if (chrome.runtime.lastError) return msg("Recarregue a página do Instagram (F5) e tente de novo.");
      msg(r && r.ok ? "Rolando devagar. Pode deixar a aba aberta e ir fazer outra coisa." : (r && r.erro) || "Erro.");
    });
  });
};

$("parar").onclick = () => {
  abaAtual((aba) => aba && chrome.tabs.sendMessage(aba.id, { cmd: "parar" }, () => { void chrome.runtime.lastError; msg("Parado."); }));
};

$("exportar").onclick = () => {
  chrome.storage.local.get(["posts"], (r) => {
    const lista = Object.values(r.posts || {});
    if (!lista.length) return msg("Ainda não há nada coletado.");
    const blob = new Blob([JSON.stringify({ origem: "instagram", gerado_em: new Date().toISOString(), posts: lista }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "salvos.json";
    a.click();
    msg(lista.length + " posts exportados. Envie esse arquivo para a pasta 'salvos' do seu Google Drive.");
  });
};

$("limpar").onclick = () => {
  if (!confirm("Apagar tudo que foi coletado até agora?")) return;
  chrome.storage.local.set({ posts: {}, status: "" }, () => { atualizar(); msg("Apagado. Recarregue a página do Instagram."); });
};

atualizar();
setInterval(atualizar, 2000);
