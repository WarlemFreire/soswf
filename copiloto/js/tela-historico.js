// tela-historico.js — lista dos dias e o marcador de progresso rumo à Analise.

import { el, limpar } from "./ui.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { db } from "./db.js";
import { mostrarResumo } from "./tela-fechamento.js";
import { abrirCorrida } from "./tela-corrida.js";


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

  raiz.append(cabecalho(fechadas, store.agruparPorDia(fechadas)));
  raiz.append(await filaDePendentes());
  raiz.append(
    el(
      "button",
      { type: "button", class: "botao botao--secundario historico__lancar", onClick: () => abrirCorrida() },
      "✎ Lançar corrida"
    )
  );
  for (const resumo of resumos) raiz.append(cartao(resumo));
}

/**
 * As corridas cronometradas que ficaram sem valor.
 *
 * O botão "Depois" só é honesto se existir um "depois". Sem esta fila, marcar
 * a corrida e adiar o valor viraria um jeito silencioso de perder o dado.
 */
async function filaDePendentes() {
  const pendentes = M.corridasPendentes(await db.todos("corridas"));
  if (!pendentes.length) return el("div");

  return el(
    "section",
    { class: "pendentes" },
    el(
      "h2",
      { class: "secao__titulo" },
      `${pendentes.length} ${pendentes.length === 1 ? "corrida sem valor" : "corridas sem valor"}`
    ),
    el(
      "div",
      { class: "pendentes__lista" },
      ...pendentes.slice(-8).reverse().map((c) =>
        el(
          "button",
          { type: "button", class: "pendentes__item", onClick: () => abrirCorrida({ pendente: c }) },
          el("span", { class: "pendentes__hora" }, M.formatarHora(c.timestamp)),
          el(
            "span",
            { class: "pendentes__medido" },
            [
              c.duracaoMin != null ? `${String(c.duracaoMin).replace(".", ",")} min` : null,
              c.km != null ? `≈ ${String(c.km).replace(".", ",")} km` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "cronometrada"
          ),
          el("span", { class: "pendentes__acao" }, "lançar valor")
        )
      )
    )
  );
}

function cabecalho(fechadas, dias) {
  const bruto = fechadas.reduce((s, r) => s + r.saldo, 0);
  const km = fechadas.reduce((s, r) => s + r.km, 0);
  const comLiquido = fechadas.filter((r) => r.liquido != null);
  const liquido = comLiquido.reduce((s, r) => s + r.liquido, 0);
  const corridas = fechadas.reduce((s, r) => s + r.corridas.length, 0);

  const partes = [`R$ ${M.formatarReais(bruto, { comCentavos: false })} brutos`];
  if (comLiquido.length) partes.push(`R$ ${M.formatarReais(liquido, { comCentavos: false })} líquidos`);
  if (km > 0) partes.push(`${km.toFixed(0)} km`);
  if (corridas) partes.push(`${corridas} corridas`);

  return el(
    "section",
    { class: "historico__topo" },
    el(
      "div",
      { class: "historico__numero" },
      el("strong", {}, String(dias.length)),
      dias.length === 1 ? " dia" : " dias",
      fechadas.length > dias.length ? ` · ${fechadas.length} jornadas` : ""
    ),
    el("div", { class: "historico__totais" }, partes.join(" · "))
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
      el("span", {}, resumo.km > 0 ? `${resumo.km.toFixed(0)} km` : "sem odômetro"),
      el("span", {}, resumo.msAtivo == null ? "—" : M.formatarDuracao(resumo.msAtivo)),
      resumo.corridas.length ? el("span", {}, `${resumo.corridas.length} corridas`) : null
    ),
    aberta ? el("div", { class: "cartao__aviso" }, "em andamento") : null,
    resumo.importada ? el("div", { class: "cartao__aviso cartao__aviso--importado" }, "importado da planilha") : null
  );
}
