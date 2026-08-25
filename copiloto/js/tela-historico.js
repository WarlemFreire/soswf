// tela-historico.js — lista dos dias e o marcador de progresso rumo à Analise.

import { el, limpar } from "./ui.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { mostrarResumo } from "./tela-fechamento.js";

export async function montarHistorico(raiz) {
  limpar(raiz);
  const resumos = await store.historico();
  const fechadas = resumos.filter((r) => r.jornada.status === "fechada");

  if (!resumos.length) {
    raiz.append(
      el("div", { class: "vazio" }, el("p", { class: "vazio__texto" }, "Nenhuma jornada registrada ainda."))
    );
    return;
  }

  raiz.append(cabecalho(fechadas));
  for (const resumo of resumos) raiz.append(cartao(resumo));
}

function cabecalho(fechadas) {
  const bruto = fechadas.reduce((s, r) => s + r.saldo, 0);
  const km = fechadas.reduce((s, r) => s + r.km, 0);
  const liquido = fechadas.reduce((s, r) => s + r.liquido, 0);

  return el(
    "section",
    { class: "historico__topo" },
    el("div", { class: "historico__numero" }, el("strong", {}, String(fechadas.length)), " dias fechados"),
    el(
      "div",
      { class: "historico__totais" },
      `R$ ${M.formatarReais(bruto, { comCentavos: false })} brutos · ` +
        `R$ ${M.formatarReais(liquido, { comCentavos: false })} líquidos · ` +
        `${km.toFixed(0)} km`
    )
  );
}

function cartao(resumo) {
  const j = resumo.jornada;
  const aberta = j.status === "aberta";
  const diaSemana = new Date(j.horaInicio).toLocaleDateString("pt-BR", { weekday: "short" });

  return el(
    "button",
    {
      type: "button",
      class: `cartao ${aberta ? "cartao--aberta" : ""}`.trim(),
      onClick: () => mostrarResumo(j),
    },
    el(
      "div",
      { class: "cartao__topo" },
      el("span", { class: "cartao__data" }, `${M.formatarData(j.horaInicio)} · ${diaSemana}`),
      el("span", { class: "cartao__bruto" }, `R$ ${M.formatarReais(resumo.saldo, { comCentavos: false })}`)
    ),
    el(
      "div",
      { class: "cartao__linha" },
      el("span", {}, resumo.reaisPorHora == null ? "—" : `${resumo.reaisPorHora.toFixed(0)} R$/h`),
      el("span", {}, resumo.reaisPorKm == null ? "—" : `${resumo.reaisPorKm.toFixed(2).replace(".", ",")} R$/km`),
      el("span", {}, `${resumo.km.toFixed(0)} km`),
      el("span", {}, M.formatarDuracao(resumo.msAtivo))
    ),
    aberta ? el("div", { class: "cartao__aviso" }, "em andamento") : null
  );
}

/* -------------------------------------------------------------- analise */

// A Fase 4 traz os dashboards. Ate la, esta tela mostra honestamente quanto
// dado ja existe e o que cada analise vai precisar — serve de termometro.
const ANALISES = [
  { nome: "Rendimento por faixa horária", precisa: 10 },
  { nome: "Rendimento por dia da semana", precisa: 14 },
  { nome: "Heatmap hora × dia da semana", precisa: 30 },
  { nome: "Ranking por zona / bairro", precisa: 20 },
  { nome: "Corrida longa compensa?", precisa: 20 },
  { nome: "Impacto das pausas", precisa: 15 },
  { nome: "Correlação com clima e trânsito", precisa: 30 },
  { nome: "Consumo real e custo por km", precisa: 4 },
];

export async function montarAnalise(raiz) {
  limpar(raiz);
  const resumos = await store.historico();
  const dias = resumos.filter((r) => r.jornada.status === "fechada").length;
  const checkpoints = resumos.reduce((s, r) => s + r.registros.length, 0);

  raiz.append(
    el(
      "section",
      { class: "analise__topo" },
      el("h2", { class: "secao__titulo" }, "Análise"),
      el(
        "p",
        { class: "folha__ajuda" },
        "Os dashboards chegam na Fase 4, construídos sobre os seus dados reais — " +
          "não sobre suposições. Abaixo, o quanto já foi acumulado."
      ),
      el(
        "div",
        { class: "analise__contadores" },
        el("div", { class: "analise__contador" }, el("strong", {}, String(dias)), el("span", {}, "dias")),
        el("div", { class: "analise__contador" }, el("strong", {}, String(checkpoints)), el("span", {}, "checkpoints"))
      )
    )
  );

  for (const item of ANALISES) {
    const pronto = Math.min(100, Math.round((dias / item.precisa) * 100));
    raiz.append(
      el(
        "div",
        { class: "progresso" },
        el(
          "div",
          { class: "progresso__topo" },
          el("span", {}, item.nome),
          el("span", { class: "progresso__contagem" }, `${Math.min(dias, item.precisa)}/${item.precisa} dias`)
        ),
        el("div", { class: "progresso__trilha" }, el("div", { class: "progresso__barra", style: { width: `${pronto}%` } }))
      )
    );
  }
}
