// topbar.js — a faixa de identidade: quem é, em que nível está e se a
// ofensiva está acesa. Fica fora das telas porque acompanha todas elas.
//
// Some no modo dirigindo: ali a tela existe para ser lida de relance a 60
// por hora, e avatar não ajuda ninguém a decidir se aceita a corrida.

import { el } from "./ui.js";
import { cfg } from "./config.js";
import * as store from "./store.js";
import * as C from "./conquistas.js";
import { progresso, formatarXp } from "./progresso.js";
import { db } from "./db.js";
import { abrirPerfil } from "./tela-perfil.js";

let raiz = null;
let pendente = null;
let ultimo = null;

export function montarTopbar(elemento) {
  raiz = elemento;
  desenhar(null);
  store.assinar(agendar);
  document.addEventListener("copiloto:perfil", () => atualizarTopbar());
  atualizarTopbar();
}

/**
 * Recalcular custa uma varredura do banco inteiro, e `assinar` dispara a cada
 * registro. Agrupar em um quadro evita refazer tudo três vezes por toque.
 */
function agendar() {
  clearTimeout(pendente);
  pendente = setTimeout(atualizarTopbar, 250);
}

export async function atualizarTopbar() {
  if (!raiz) return;
  if (cfg("modoDirigindo")) {
    raiz.hidden = true;
    return;
  }
  raiz.hidden = false;

  const resumos = await store.historico();
  const dias = store.agruparPorDia(resumos);
  const corridas = await db.todos("corridas");
  const custos = await db.todos("custos");
  const est = C.estatisticas({ dias, historico: resumos, corridas, custos });
  const avaliadas = C.avaliar(est);

  ultimo = { of: C.ofensiva(dias), ...progresso(avaliadas, est), est, avaliadas };
  desenhar(ultimo);
}

/** O que a topbar já sabe, para a tela de perfil não recalcular tudo de novo. */
export function ultimoProgresso() {
  return ultimo;
}

function desenhar(dados) {
  const proprio = (cfg("nome") || "").trim();
  const nome = proprio || "Motorista";
  const nivel = dados?.nivel;
  const of = dados?.of;

  raiz.replaceChildren(
    el(
      "button",
      { type: "button", class: "topbar__eu", onClick: () => abrirPerfil(), "aria-label": "Seu perfil" },
      // Sem nome salvo, o monograma sairia "MO" de "Motorista" — iniciais de
      // ninguém. Melhor o carrinho até ele se apresentar.
      avatar(proprio),
      el(
        "span",
        { class: "topbar__texto" },
        el("strong", { class: "topbar__nome" }, nome),
        el(
          "span",
          { class: "topbar__nivel" },
          nivel ? `Nível ${nivel.nivel} · ${formatarXp(nivel.xp)} XP` : "carregando…"
        )
      )
    ),
    el(
      "div",
      { class: `topbar__ofensiva ${of?.viva ? "" : "topbar__ofensiva--apagada"}`.trim(), title: "Ofensiva" },
      el("span", { "aria-hidden": "true" }, of?.viva ? "🔥" : "🕯️"),
      el("strong", {}, String(of?.atual ?? 0))
    ),
    el(
      "div",
      { class: "topbar__barra", role: "progressbar", "aria-label": "Progresso do nível" },
      el("div", { class: "topbar__marca", style: { width: `${Math.round((nivel?.progresso ?? 0) * 100)}%` } })
    )
  );
}

/** Sem foto, as iniciais. Melhor um monograma do que um boneco genérico. */
function avatar(nome) {
  const foto = cfg("avatar");
  if (foto) return el("img", { class: "avatar avatar--foto", src: foto, alt: "" });
  return el("span", { class: "avatar", "aria-hidden": "true" }, iniciais(nome));
}

export function iniciais(nome) {
  const partes = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return "🚕";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}
