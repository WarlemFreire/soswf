// Extrai posts de qualquer JSON que o Instagram manda para a página.
// Não depende do formato exato da resposta: percorre o objeto e pega tudo
// que tem cara de "media" (tem shortcode e imagens). Assim sobrevive a
// mudanças de endpoint (REST /api/v1/feed/saved/ ou GraphQL).
(function (root) {
  function melhorImagem(m) {
    const c = m && m.image_versions2 && m.image_versions2.candidates;
    if (!Array.isArray(c) || !c.length) return null;
    return c.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a)).url || null;
  }

  function melhorVideo(m) {
    const v = m && m.video_versions;
    if (!Array.isArray(v) || !v.length) return null;
    return v.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a)).url || null;
  }

  function tipoDe(m) {
    if (m.media_type === 8 || Array.isArray(m.carousel_media)) return "carrossel";
    if (m.media_type === 2 || m.video_versions) return m.product_type === "clips" ? "reel" : "video";
    return "foto";
  }

  function normalizar(m) {
    const slides = Array.isArray(m.carousel_media) && m.carousel_media.length ? m.carousel_media : [m];
    const imagens = [], videos = [], alt = [];
    for (const s of slides) {
      const img = melhorImagem(s);
      if (img) imagens.push(img);
      const vid = melhorVideo(s);
      if (vid) videos.push(vid);
      if (s.accessibility_caption) alt.push(s.accessibility_caption);
    }
    if (!alt.length && m.accessibility_caption) alt.push(m.accessibility_caption);
    const autor = (m.user && m.user.username) || (m.owner && m.owner.username) || "";
    const legenda =
      (m.caption && typeof m.caption === "object" && m.caption.text) ||
      (typeof m.caption === "string" ? m.caption : "") || "";
    return {
      code: m.code,
      url: "https://www.instagram.com/p/" + m.code + "/",
      tipo: tipoDe(m),
      autor,
      legenda,
      data: m.taken_at ? new Date(m.taken_at * 1000).toISOString() : null,
      alt,
      imagens,
      videos,
      salvo_confirmado: m.has_viewer_saved === true,
      coletado_em: new Date().toISOString(),
    };
  }

  function pareceMedia(o) {
    return (
      o && typeof o === "object" && typeof o.code === "string" && o.code.length >= 5 &&
      (o.image_versions2 || Array.isArray(o.carousel_media)) &&
      // slides de carrossel também têm code às vezes; o post-pai tem "user"/"owner"
      (o.user || o.owner)
    );
  }

  // Retorna lista de posts normalizados encontrados em `dados`.
  function extrairPosts(dados) {
    const achados = new Map();
    const pilha = [dados];
    const vistos = new Set();
    while (pilha.length) {
      const o = pilha.pop();
      if (!o || typeof o !== "object" || vistos.has(o)) continue;
      vistos.add(o);
      if (pareceMedia(o)) {
        if (!achados.has(o.code)) achados.set(o.code, normalizar(o));
        continue; // não desce nos slides do carrossel
      }
      for (const k in o) {
        const v = o[k];
        if (v && typeof v === "object") pilha.push(v);
      }
    }
    return [...achados.values()];
  }

  root.__salvosExtrairPosts = extrairPosts;
  if (typeof module !== "undefined") module.exports = { extrairPosts };
})(typeof window !== "undefined" ? window : globalThis);
