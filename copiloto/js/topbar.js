// topbar.js — a faixa de identidade: quem é, como está a semana no bolso e se a
// ofensiva está acesa. Fica fora das telas porque acompanha todas elas.
//
// Some no modo dirigindo: ali a tela existe para ser lida de relance a 60
// por hora, e avatar não ajuda ninguém a decidir se aceita a corrida.
//
// O subtítulo já foi "Nível 7 · 1,2k XP". Virou a média dos últimos 7 dias
// porque nível e XP não mudavam decisão nenhuma, e a média muda: ela diz, sem
// abrir aba, se esta semana está acima ou abaixo do normal.

import { el, trocar } from "./ui.js";
import { cfg } from "./config.js";
import * as store from "./store.js";
import * as M from "./metrics.js";
import { ofensiva } from "./ofensiva.js";
import { abrirPerfil } from "./tela-perfil.js";

const JANELA_DIAS = 7;

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
  ultimo = { of: ofensiva(dias), semana: mediaRecente(dias) };
  desenhar(ultimo);
}

/** O que a topbar já sabe, para a tela de perfil não recalcular tudo de novo. */
export function ultimoProgresso() {
  return ultimo;
}

/**
 * Média por dia trabalhado na última semana.
 *
 * Usa o líquido só quando TODOS os dias da janela têm líquido; senão declara
 * bruto. Média que mistura dia com custo lançado e dia sem custo não é nem
 * bruto nem líquido — é um número que não descreve nada.
 */
function mediaRecente(dias, agora = Date.now()) {
  const corte = M.chaveData(agora - JANELA_DIAS * 86400000);
  const janela = (dias || []).filter((d) => d.data > corte);
  if (!janela.length) return null;

  const todosComLiquido = janela.every((d) => d.temLiquido);
  const soma = janela.reduce((t, d) => t + (todosComLiquido ? d.liquido : d.saldo), 0);
  return { valor: soma / janela.length, liquido: todosComLiquido, dias: janela.length };
}

function desenhar(dados) {
  const proprio = (cfg("nome") || "").trim();
  const nome = proprio || "Motorista";
  const of = dados?.of;

  trocar(raiz, 
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
        el("span", { class: "topbar__media" }, textoDaMedia(dados))
      )
    ),
    el(
      "div",
      { class: `topbar__ofensiva ${of?.viva ? "" : "topbar__ofensiva--apagada"}`.trim(), title: "Ofensiva" },
      el("span", { "aria-hidden": "true" }, of?.viva ? "🔥" : "🕯️"),
      el("strong", {}, String(of?.atual ?? 0))
    )
  );
}

function textoDaMedia(dados) {
  if (!dados) return "carregando…";
  const s = dados.semana;
  // Sem dia nenhum na janela não existe média: travessão, nunca zero.
  if (!s) return "7 dias · —";
  return `7 dias · ${M.formatarReais(s.valor)}/dia ${s.liquido ? "líquido" : "bruto"}`;
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
