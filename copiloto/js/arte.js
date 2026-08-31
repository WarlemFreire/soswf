// arte.js — os desenhos do app, em SVG escrito à mão.
//
// Nada de imagem externa nem biblioteca: o app tem que abrir dentro de um
// túnel, e um PNG por medalha seriam 225 arquivos. Vetor inline custa alguns
// kB, escala em qualquer tela e acompanha o tema sozinho.

import { patenteDe } from "./conquistas.js";

/** O metal de cada patente. Quem decide a patente é o catálogo. */
const PATENTES = [
  { nome: "Bronze", a: "#f5c08a", m: "#c07a35", b: "#7d4416", fita1: "#8f3d3d", fita2: "#68292a" },
  { nome: "Prata", a: "#ffffff", m: "#c3cfdb", b: "#7d8b9a", fita1: "#3f5a75", fita2: "#2a3f55" },
  { nome: "Ouro", a: "#fff3c4", m: "#f0c249", b: "#a97614", fita1: "#8d5c1c", fita2: "#653f11" },
  { nome: "Platina", a: "#dcfff7", m: "#6fded0", b: "#218b78", fita1: "#1d6b5e", fita2: "#124a41" },
  { nome: "Diamante", a: "#f3e8ff", m: "#b98ef0", b: "#6a37bd", fita1: "#4a2b86", fita2: "#311c5e" },
];

/** Os gradientes ficam num SVG oculto e são referenciados por id na página. */
export function defsDeArte() {
  const caixa = document.createElement("div");
  caixa.className = "arte-defs";
  caixa.setAttribute("aria-hidden", "true");
  const metais = PATENTES.map(
    (p, i) => `
    <linearGradient id="metal-${i + 1}" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="${p.a}" />
      <stop offset="0.45" stop-color="${p.m}" />
      <stop offset="1" stop-color="${p.b}" />
    </linearGradient>`
  ).join("");
  caixa.innerHTML = `<svg width="0" height="0" focusable="false"><defs>${metais}
    <linearGradient id="metal-0" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#8b98a7" /><stop offset="1" stop-color="#39434f" />
    </linearGradient>
  </defs></svg>`;
  return caixa;
}

function comoNo(markup) {
  const caixa = document.createElement("div");
  caixa.innerHTML = markup.trim();
  return caixa.firstElementChild;
}

/**
 * A medalha: fita, serrilha, disco e o símbolo da família no meio.
 *
 * Presa, ela vira silhueta de chumbo com o anel de progresso em volta — dá
 * para ver o que falta sem precisar ler número nenhum.
 */
export function arteMedalha(medalha, { tamanho = 86, anel = true } = {}) {
  const patente = medalha.patente || patenteDe(medalha);
  const cores = PATENTES[patente - 1];
  const ganha = medalha.conquistada;
  const metal = ganha ? `metal-${patente}` : "metal-0";
  const fita1 = ganha ? cores.fita1 : "#39434f";
  const fita2 = ganha ? cores.fita2 : "#2a333d";

  const volta = 2 * Math.PI * 39;
  const progresso = anel && !ganha && medalha.progresso > 0
    ? `<circle cx="50" cy="72" r="39" fill="none" stroke="var(--serie-1)" stroke-width="5"
         stroke-linecap="round" stroke-dasharray="${volta.toFixed(1)}"
         stroke-dashoffset="${(volta * (1 - medalha.progresso)).toFixed(1)}"
         transform="rotate(-90 50 72)" />`
    : "";

  return comoNo(`
<svg viewBox="0 0 100 118" width="${tamanho}" height="${Math.round(tamanho * 1.18)}"
     class="medalha ${ganha ? "medalha--ganha" : "medalha--presa"}" role="img"
     aria-label="${escapar(medalha.nome)}${ganha ? "" : " (ainda não conquistada)"}">
  <path d="M22 0 L22 32 L50 52 L50 14 Z" fill="${fita1}" />
  <path d="M78 0 L78 32 L50 52 L50 14 Z" fill="${fita2}" />
  ${progresso}
  <circle cx="50" cy="72" r="33" fill="none" stroke="url(#${metal})" stroke-width="7"
          stroke-dasharray="5.5 4" />
  <circle cx="50" cy="72" r="30" fill="url(#${metal})" />
  <circle cx="50" cy="72" r="23.5" fill="rgba(0,0,0,0.22)" />
  <circle cx="50" cy="72" r="23.5" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="1.2" />
  <path d="M31 60 A 30 30 0 0 1 58 44" fill="none" stroke="rgba(255,255,255,0.4)"
        stroke-width="3" stroke-linecap="round" opacity="${ganha ? 0.7 : 0.15}" />
  ${simbolo(medalha, ganha)}
</svg>`);
}

/** A taça dos recordes. */
export function arteTrofeu({ tamanho = 54 } = {}) {
  return comoNo(`
<svg viewBox="0 0 100 100" width="${tamanho}" height="${tamanho}" class="trofeu" aria-hidden="true">
  <path d="M25 20 H12 v9 a21 21 0 0 0 19 20" fill="none" stroke="url(#metal-3)" stroke-width="6" />
  <path d="M75 20 H88 v9 a21 21 0 0 1 -19 20" fill="none" stroke="url(#metal-3)" stroke-width="6" />
  <path d="M24 12 h52 v25 a26 26 0 0 1 -52 0 z" fill="url(#metal-3)" />
  <path d="M33 18 v18 a17 17 0 0 0 9 15" fill="none" stroke="rgba(255,255,255,0.45)"
        stroke-width="3.5" stroke-linecap="round" />
  <rect x="45" y="61" width="10" height="13" fill="url(#metal-3)" />
  <rect x="33" y="74" width="34" height="8" rx="3" fill="url(#metal-3)" />
  <rect x="26" y="82" width="48" height="10" rx="4" fill="url(#metal-3)" />
</svg>`);
}

/**
 * Sete famílias de dia da semana com o mesmo emoji de calendário viram sete
 * medalhas iguais. Quando a família tem um glifo curto, ele desenha melhor
 * que qualquer figurinha: "SEG", "03h", "UBER".
 */
function simbolo(medalha, ganha) {
  const opacidade = ganha ? 1 : 0.45;
  if (!medalha.glifo) {
    return `<text x="50" y="73.5" text-anchor="middle" dominant-baseline="central"
        font-size="25" opacity="${opacidade}">${escapar(medalha.icone)}</text>`;
  }
  const n = medalha.glifo.length;
  const corpo = n <= 2 ? 19 : n === 3 ? 15 : n === 4 ? 12 : 10;
  return `<text x="50" y="73" text-anchor="middle" dominant-baseline="central"
        font-size="${corpo}" font-weight="800" letter-spacing="0.5"
        fill="rgba(255,255,255,0.92)" opacity="${opacidade}">${escapar(medalha.glifo)}</text>`;
}

function escapar(texto) {
  return String(texto).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}
