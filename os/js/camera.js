// camera.js — foto SO pela camera do app, com data, hora e GPS carimbados na
// imagem e gravados junto. Nao existe caminho para escolher da galeria: foto
// reaproveitada de outro servico e exatamente a fraude que isso fecha.

import { el } from "./ui.js";

const LADO_MAX = 1600; // px no lado maior: legivel para ler manometro, ~250 KB
const QUALIDADE = 0.72;

function pegarGps() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, precisao: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  });
}

function carimbo(ctx, w, h, linhas) {
  const tam = Math.max(14, Math.round(w / 45));
  ctx.font = `600 ${tam}px system-ui, sans-serif`;
  const alt = (tam + 6) * linhas.length + 10;
  ctx.fillStyle = "rgba(0,0,0,.62)";
  ctx.fillRect(0, h - alt, w, alt);
  ctx.fillStyle = "#fff";
  linhas.forEach((t, i) => ctx.fillText(t, 10, h - alt + (tam + 6) * (i + 1)));
}

function formatarData(ts) {
  return new Date(ts).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

/**
 * Abre a camera em tela cheia. Resolve com { blob, ts, gps } ou null se
 * cancelado. Lanca erro se nao houver camera/permissao — e NAO oferece galeria.
 */
export async function tirarFoto({ titulo, osRotulo }) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Este navegador não dá acesso à câmera. Use o app instalado (HTTPS).");
  }
  const gpsPromise = pegarGps(); // comeca ja: o fix chega enquanto enquadra
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    audio: false,
  });

  return new Promise((resolve) => {
    const video = el("video", { class: "camera__video", autoplay: true, playsInline: true, muted: true });
    video.srcObject = stream;
    const status = el("div", { class: "camera__status" }, "Localizando GPS…");
    let gps = null;
    gpsPromise.then((g) => {
      gps = g;
      status.textContent = g ? `GPS ±${g.precisao} m` : "Sem GPS (a foto fica marcada)";
    });

    const fechar = (resultado) => {
      stream.getTracks().forEach((t) => t.stop());
      tela.remove();
      resolve(resultado);
    };

    const disparar = el("button", {
      class: "camera__disparo",
      type: "button",
      "aria-label": "Tirar foto",
      async onclick() {
        disparar.disabled = true;
        const ts = Date.now();
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const escala = Math.min(1, LADO_MAX / Math.max(vw, vh));
        const w = Math.round(vw * escala);
        const h = Math.round(vh * escala);
        const canvas = el("canvas", { width: w, height: h });
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);
        carimbo(ctx, w, h, [
          `SOS WF · ${osRotulo} · ${titulo}`,
          `${formatarData(ts)} · ${gps ? `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)} ±${gps.precisao}m` : "sem GPS"}`,
        ]);
        canvas.toBlob((blob) => fechar({ blob, ts, gps }), "image/jpeg", QUALIDADE);
      },
    });

    const tela = el(
      "div",
      { class: "camera", role: "dialog", "aria-label": titulo },
      el("div", { class: "camera__topo" }, el("strong", {}, titulo), status),
      video,
      el(
        "div",
        { class: "camera__pe" },
        el("button", { class: "botao botao--fantasma", type: "button", onclick: () => fechar(null) }, "Cancelar"),
        disparar,
        el("span", { style: { width: "88px" } })
      )
    );
    document.body.append(tela);
  });
}
