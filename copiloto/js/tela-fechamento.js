// tela-fechamento.js — resumo do dia. A Fase 2 acrescenta custos reais de
// abastecimento; aqui o liquido ainda é estimado pelo custo por km configurado.

import { el, abrirFolha } from "./ui.js";
import { Teclado } from "./keypad.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { configAtual } from "./config.js";
import { vibrar, falar, mostrarToast } from "./feedback.js";
import { tsvPlanilha, copiarParaAreaDeTransferencia } from "./export.js";

export function abrirFechamento() {
  const jornada = store.jornadaAtiva();
  if (!jornada) return;
  vibrar();

  const teclado = new Teclado({ modo: "inteiro", aoMudar: () => atualizar() });

  const visor = el("div", { class: "visor visor--odometro" }, "—");
  const aviso = el("p", { class: "folha__ajuda" }, "");
  const observacoes = el("textarea", {
    class: "campo-texto",
    rows: 3,
    placeholder: "O que aconteceu hoje? (opcional)",
  });

  function atualizar() {
    visor.textContent = teclado.exibicao;
    const km = (teclado.valor ?? 0) - jornada.odometroInicio;
    aviso.textContent =
      teclado.valor == null || km < 0
        ? "Digite o odômetro do painel agora."
        : `${km.toLocaleString("pt-BR")} km rodados hoje.`;
  }
  atualizar();

  let folha;
  folha = abrirFolha({
    titulo: "Encerrar jornada",
    classe: "folha--alta",
    conteudo: [
      el(
        "p",
        { class: "folha__ajuda" },
        `Odômetro final, olhando o painel. Abertura foi ${jornada.odometroInicio?.toLocaleString("pt-BR") ?? "—"} km.`
      ),
      visor,
      aviso,
      teclado.el,
      observacoes,
    ],
    rodape: [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            const fechada = await store.fecharJornada({
              odometroFim: teclado.valor,
              observacoes: observacoes.value.trim(),
            });
            folha.fechar();
            vibrar([40, 60, 40]);
            mostrarResumo(fechada);
          },
        },
        "FECHAR O DIA"
      ),
    ],
  });
}

export async function mostrarResumo(jornada) {
  const resumos = await store.historico();
  const atual = resumos.find((r) => r.jornada.id === jornada.id);
  if (!atual) return;

  // A comparação com 7 e 30 dias é por DIA, não por jornada: com duas jornadas
  // no mesmo dia, comparar jornada com jornada faria o dia parecer metade.
  const dias = store.agruparPorDia(resumos);
  const hoje = dias.find((d) => d.data === jornada.data);
  const outros = dias.filter((d) => d.data !== jornada.data);
  const config = configAtual();
  const custos = M.custosEstimados(atual.km, config, store.energiaKm());

  const comparar = (campo, valor, casas = 2) => {
    const m7 = store.media(outros, 7, campo);
    const m30 = store.media(outros, 30, campo);
    if (m7 == null && m30 == null) return el("span", { class: "comparacao" }, "primeiro dia registrado");
    const seta = (media) => {
      if (media == null || valor == null) return "—";
      const dif = valor - media;
      const simbolo = dif > 0 ? "▲" : dif < 0 ? "▼" : "=";
      return `${simbolo} ${Math.abs(dif).toFixed(casas).replace(".", ",")}`;
    };
    return el(
      "span",
      { class: "comparacao" },
      `7d ${seta(m7)}`,
      el("span", { class: "comparacao__sep" }, "·"),
      `30d ${seta(m30)}`
    );
  };

  const linha = (rotulo, valor, extra) =>
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, rotulo),
      el("span", { class: "resumo__valor" }, valor),
      extra || null
    );

  const pct = (ms) => (atual.msRua > 0 && ms != null ? `${Math.round((ms / atual.msRua) * 100)}%` : "—");

  falar(
    `Dia fechado. Bruto ${Math.round(atual.saldo)} reais, ` +
      `líquido estimado ${Math.round(atual.liquido)} reais.`
  );

  abrirFolha({
    titulo: `Resumo · ${M.formatarData(jornada.horaInicio)}`,
    classe: "folha--alta",
    conteudo: [
      el(
        "div",
        { class: "resumo__destaque" },
        el("div", { class: "resumo__destaque-rotulo" }, atual.liquido == null ? "Bruto do dia" : "Líquido estimado"),
        el("div", { class: "resumo__destaque-valor" }, `R$ ${M.formatarReais(atual.liquido ?? atual.saldo)}`),
        el("div", { class: "resumo__destaque-nota" }, `bruto R$ ${M.formatarReais(atual.saldo)}`)
      ),

      el("h3", { class: "resumo__secao" }, "Por plataforma"),
      ...["uber", "99", "indrive"]
        .filter((id) => atual.fontes[id]?.valor > 0)
        .map((id) => linha(id === "99" ? "99" : id === "uber" ? "Uber" : "inDrive", `R$ ${M.formatarReais(atual.fontes[id].valor)}`)),
      atual.fontes.avulso.valor > 0 ? linha("Avulso", `R$ ${M.formatarReais(atual.fontes.avulso.valor)}`) : null,

      el("h3", { class: "resumo__secao" }, custos.medido ? "Custos (energia medida)" : "Custos estimados"),
      linha(
        "Energia",
        `R$ ${M.formatarReais(custos.energia)}`,
        el("span", { class: "comparacao" }, `${M.formatarReais(custos.energiaKm)}/km ${custos.medido ? "medido" : "semente"}`)
      ),
      linha("Desgaste", `R$ ${M.formatarReais(custos.desgaste)}`, el("span", { class: "comparacao" }, `${M.formatarReais(custos.desgasteKm)}/km`)),
      linha("Total", `R$ ${M.formatarReais(custos.total)}`),
      // Gastos lançados hoje aparecem separados: o custo por km é uma média de
      // longo prazo, não o desembolso do dia.
      atual.gastoReal > 0
        ? linha(
            "Pago hoje",
            `R$ ${M.formatarReais(atual.gastoReal)}`,
            el("span", { class: "comparacao" }, `${atual.custos.length} lançamento${atual.custos.length > 1 ? "s" : ""}`)
          )
        : null,

      el("h3", { class: "resumo__secao" }, "Tempo e distância"),
      linha("Tempo de rua", atual.msRua == null ? "—" : M.formatarDuracao(atual.msRua)),
      linha("Tempo ativo", atual.msAtivo == null ? "—" : M.formatarDuracao(atual.msAtivo), el("span", { class: "comparacao" }, pct(atual.msAtivo))),
      linha("Tempo parado", atual.msPausado == null ? "—" : M.formatarDuracao(atual.msPausado), el("span", { class: "comparacao" }, pct(atual.msPausado))),
      linha("Distância", `${atual.km.toFixed(1).replace(".", ",")} km`),

      el("h3", { class: "resumo__secao" }, "Rendimento"),
      linha("R$/hora", atual.reaisPorHora == null ? "—" : M.formatarReais(atual.reaisPorHora), comparar("reaisPorHora", atual.reaisPorHora)),
      linha("R$/km", atual.reaisPorKm == null ? "—" : M.formatarReais(atual.reaisPorKm), comparar("reaisPorKm", atual.reaisPorKm)),
      linha("Bruto", `R$ ${M.formatarReais(atual.saldo)}`, comparar("saldo", atual.saldo, 0)),

      hoje && hoje.jornadas.length > 1
        ? el(
            "p",
            { class: "folha__ajuda" },
            `Segunda jornada de hoje. No dia: R$ ${M.formatarReais(hoje.saldo)} em ` +
              `${M.formatarDuracao(hoje.msAtivo)} de tempo ativo.`
          )
        : null,

      blocoPlanilha(atual, hoje),

      el(
        "button",
        { type: "button", class: "botao botao--texto", onClick: () => abrirCorrecao(jornada) },
        "Corrigir esta jornada"
      ),

      jornada.observacoes ? el("p", { class: "resumo__obs" }, jornada.observacoes) : null,
    ],
  });
}

/**
 * O que levar deste dia para a planilha. Copiar/colar tabulado é o caminho
 * menos sofrido no celular — baixar CSV e importar no Sheets pelo telefone é
 * um martírio.
 */
function blocoPlanilha(resumo, dia) {
  // A planilha tem uma linha por dia, entao as Horas Ativas somam as jornadas.
  const corridas = dia ? dia.corridas : resumo.corridas || [];
  const msAtivo = dia?.msAtivo ?? resumo.msAtivo;
  const horas = msAtivo == null ? "—" : (msAtivo / M.HORA).toFixed(1).replace(".", ",");

  const copiar = async (texto, oQue) => {
    const deu = await copiarParaAreaDeTransferencia(texto);
    vibrar(deu ? 40 : [20, 60, 20]);
    mostrarToast({
      titulo: deu ? `${oQue} copiado` : "Não deu para copiar",
      detalhe: deu ? "Cole na primeira linha vazia da aba Corridas." : "Use a exportação em CSV nos Ajustes.",
      tom: deu ? "ok" : "alerta",
      duracao: 6000,
    });
  };

  const aviso =
    resumo.conferencia && !resumo.conferencia.fecha
      ? el(
          "p",
          { class: "folha__ajuda folha__ajuda--alerta" },
          `As corridas lançadas somam R$ ${M.formatarReais(resumo.conferencia.somado)}, ` +
            `mas o saldo do dia deu R$ ${M.formatarReais(resumo.conferencia.saldo)}. ` +
            "Provavelmente há corrida faltando no lançamento."
        )
      : null;

  return el(
    "div",
    { class: "planilha" },
    el("h3", { class: "resumo__secao" }, "Para a planilha"),
    aviso,
    el(
      "div",
      { class: "resumo__linha" },
      el("span", { class: "resumo__rotulo" }, "Horas ativas"),
      el("span", { class: "resumo__valor" }, horas),
      el(
        "button",
        { type: "button", class: "chip chip--pequeno", onClick: () => copiar(horas, "Valor") },
        "copiar"
      )
    ),
    corridas.length
      ? el(
          "button",
          {
            type: "button",
            class: "botao botao--secundario",
            onClick: () => copiar(tsvPlanilha(corridas), `${corridas.length} corridas`),
          },
          `Copiar ${corridas.length} corrida${corridas.length > 1 ? "s" : ""} do dia`
        )
      : el("p", { class: "folha__ajuda" }, "Nenhuma corrida lançada hoje — nada a levar para a aba Corridas."),
    el(
      "p",
      { class: "folha__ajuda" },
      "Cole na primeira linha vazia da aba Corridas (coluna Data). As colunas verdes e o Dashboard se recalculam sozinhos."
    )
  );
}


/**
 * Correção de jornada já encerrada. Existe porque a primeira noite de uso saiu
 * com o km errado (o odômetro vinha do GPS, que media menos da metade) e não
 * havia como consertar aquele dia depois.
 */
export function abrirCorrecao(jornada) {
  vibrar();
  const valores = {
    odometroInicio: jornada.odometroInicio,
    odometroFim: jornada.odometroFim,
  };
  let campo = "odometroFim";

  const teclados = {
    odometroInicio: new Teclado({ modo: "inteiro", aoMudar: aoDigitar }),
    odometroFim: new Teclado({ modo: "inteiro", aoMudar: aoDigitar }),
  };

  const visor = el("div", { class: "visor visor--odometro" }, "—");
  const legenda = el("div", { class: "visor__legenda" }, "");
  const caixaTeclado = el("div", { class: "corrida__teclado" });
  const observacoes = el("textarea", {
    class: "campo-texto",
    rows: 2,
    placeholder: "Observação",
    value: jornada.observacoes || "",
  });

  const linhaCampos = el("div", { class: "chips chips--alvos" });
  for (const [id, nome] of [["odometroInicio", "Abertura"], ["odometroFim", "Fechamento"]]) {
    linhaCampos.append(
      el(
        "button",
        {
          type: "button",
          class: `chip ${id === campo ? "chip--ativo" : ""}`.trim(),
          dataset: { id },
          onClick: () => selecionar(id),
        },
        nome
      )
    );
  }

  let folha;
  folha = abrirFolha({
    titulo: `Corrigir ${M.formatarData(jornada.horaInicio)}`,
    classe: "folha--alta",
    conteudo: [
      el("p", { class: "folha__ajuda" }, "Odômetro do painel. O km e tudo que depende dele são recalculados."),
      linhaCampos,
      visor,
      legenda,
      caixaTeclado,
      observacoes,
    ],
    rodape: [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            valores[campo] = teclados[campo].valor;
            await store.corrigirJornada(jornada.id, {
              odometroInicio: valores.odometroInicio,
              odometroFim: valores.odometroFim,
              observacoes: observacoes.value.trim(),
            });
            folha.fechar();
            vibrar(40);
            mostrarToast({ titulo: "Jornada corrigida", detalhe: "As métricas do dia foram recalculadas." });
          },
        },
        "SALVAR CORREÇÃO"
      ),
    ],
  });

  selecionar(campo);

  function selecionar(id) {
    valores[campo] = teclados[campo].valor;
    campo = id;
    caixaTeclado.replaceChildren(teclados[id].el);
    teclados[id].definir(valores[id] ?? null);
    for (const botao of linhaCampos.children) botao.classList.toggle("chip--ativo", botao.dataset.id === id);
    atualizar();
  }

  function aoDigitar() {
    valores[campo] = teclados[campo].valor;
    atualizar();
  }

  function atualizar() {
    visor.textContent = teclados[campo].exibicao;
    const km =
      valores.odometroFim != null && valores.odometroInicio != null
        ? valores.odometroFim - valores.odometroInicio
        : null;
    legenda.textContent =
      km == null
        ? campo === "odometroInicio"
          ? "Odômetro na abertura"
          : "Odômetro no fechamento"
        : `${km.toLocaleString("pt-BR")} km no dia`;
  }
}
