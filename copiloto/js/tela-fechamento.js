// tela-fechamento.js — fechamento, resumo do dia e correção de jornadas
// anteriores (odômetro e dinheiro).

import { el, limpar, abrirFolha } from "./ui.js";
import { Teclado } from "./keypad.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { cfg, configAtual, PLATAFORMAS } from "./config.js";
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
        { type: "button", class: "botao botao--texto", onClick: () => abrirCorrecao(atual.jornada) },
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
 * Correção de jornada já encerrada — odômetro e dinheiro.
 *
 * O dinheiro se corrige pelos dois extremos: onde a jornada partiu (a linha de
 * base) e onde ela terminou. O ganho é a diferença, e ele aparece na tela
 * enquanto se digita, para que o número certo seja visível antes de salvar.
 */
export async function abrirCorrecao(jornada) {
  vibrar();
  const contorno = await store.contornoDaJornada(jornada.id);
  if (!contorno) return;

  const plataformas = PLATAFORMAS.filter(
    (p) =>
      cfg("plataformasAtivas").includes(p.id) ||
      contorno.fontesFim[p.id]?.valor > 0 ||
      jornada.saldoInicial?.[p.id] > 0
  );

  const valores = {
    odometroInicio: jornada.odometroInicio,
    odometroFim: jornada.odometroFim,
  };
  for (const p of plataformas) {
    valores[`base_${p.id}`] = jornada.saldoInicial?.[p.id] ?? null;
    valores[`fim_${p.id}`] = contorno.fontesFim[p.id]?.valor || null;
  }

  const campos = [
    { id: "odometroInicio", nome: "Odô abertura", modo: "inteiro", grupo: "Odômetro" },
    { id: "odometroFim", nome: "Odô fechamento", modo: "inteiro", grupo: "Odômetro" },
    ...plataformas.map((p) => ({ id: `base_${p.id}`, nome: p.nome, modo: "dinheiro", grupo: "Saldo ao ABRIR" })),
    ...plataformas.map((p) => ({ id: `fim_${p.id}`, nome: p.nome, modo: "dinheiro", grupo: "Saldo ao FECHAR" })),
  ];

  let campo = plataformas.length ? `fim_${plataformas[0].id}` : "odometroFim";

  const teclados = Object.fromEntries(
    campos.map((c) => [c.id, new Teclado({ modo: c.modo, aoMudar: aoDigitar })])
  );

  const visor = el("div", { class: "visor" }, "—");
  const legenda = el("div", { class: "visor__legenda" }, "");
  const caixaTeclado = el("div", { class: "corrida__teclado" });
  const resultado = el("div", { class: "custo__resumo" });
  const observacoes = el("textarea", {
    class: "campo-texto",
    rows: 2,
    placeholder: "Observação",
    value: jornada.observacoes || "",
  });

  const grupos = el("div", { class: "correcao__grupos" });
  const botoes = new Map();
  for (const nome of ["Odômetro", "Saldo ao ABRIR", "Saldo ao FECHAR"]) {
    const doGrupo = campos.filter((c) => c.grupo === nome);
    if (!doGrupo.length) continue;
    const linha = el("div", { class: "chips chips--alvos" });
    for (const c of doGrupo) {
      const botao = el(
        "button",
        { type: "button", class: "chip", onClick: () => selecionar(c.id) },
        c.nome
      );
      botoes.set(c.id, botao);
      linha.append(botao);
    }
    grupos.append(el("div", { class: "correcao__grupo" }, el("span", { class: "correcao__rotulo" }, nome), linha));
  }

  let folha;
  folha = abrirFolha({
    titulo: `Corrigir ${M.formatarData(jornada.horaInicio)}`,
    classe: "folha--alta",
    conteudo: [
      el(
        "p",
        { class: "folha__ajuda" },
        "Os valores das plataformas são o TOTAL do dia que elas mostravam em cada momento — " +
          "não o que a jornada rendeu. O ganho aparece calculado abaixo."
      ),
      grupos,
      visor,
      legenda,
      caixaTeclado,
      resultado,
      observacoes,
    ],
    rodape: [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: salvar,
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
    for (const [chave, botao] of botoes) botao.classList.toggle("chip--ativo", chave === id);
    atualizar();
  }

  function aoDigitar() {
    valores[campo] = teclados[campo].valor;
    atualizar();
  }

  function atualizar() {
    const def = campos.find((c) => c.id === campo);
    visor.textContent = teclados[campo].valor == null ? "—" : teclados[campo].exibicao;
    visor.classList.toggle("visor--odometro", def?.modo === "inteiro");
    legenda.textContent =
      def?.grupo === "Odômetro"
        ? "Número do painel"
        : `${def.grupo === "Saldo ao ABRIR" ? "Total do dia na" : "Total do dia na"} ${def.nome} ${
            def.grupo === "Saldo ao ABRIR" ? "quando esta jornada começou" : "quando esta jornada terminou"
          }`;
    pintarResultado();
  }

  function pintarResultado() {
    limpar(resultado);
    let ganho = 0;
    for (const p of plataformas) {
      const base = valores[`base_${p.id}`] || 0;
      const fim = valores[`fim_${p.id}`];
      if (fim != null) ganho += fim - base;
    }
    const km =
      valores.odometroFim != null && valores.odometroInicio != null
        ? valores.odometroFim - valores.odometroInicio
        : null;

    resultado.append(
      el(
        "div",
        { class: "custo__resumo-linha custo-resumo__total" },
        `Esta jornada rendeu R$ ${M.formatarReais(ganho)}`
      )
    );
    if (km != null) {
      resultado.append(
        el("div", { class: "custo__resumo-linha" }, `${km.toLocaleString("pt-BR")} km${km > 0 ? ` · R$ ${M.formatarReais(ganho / km)}/km` : ""}`)
      );
    }

    // Se a jornada seguinte parte de um valor que não bate mais com este
    // fechamento, o dia fica contraditório — melhor dizer na hora.
    const proxima = contorno.proxima;
    if (proxima) {
      const divergentes = plataformas.filter((p) => {
        const fim = valores[`fim_${p.id}`];
        const baseProxima = proxima.saldoInicial?.[p.id];
        return fim != null && baseProxima != null && Math.abs(fim - baseProxima) > 0.005;
      });
      if (divergentes.length) {
        resultado.append(
          el(
            "div",
            { class: "custo__resumo-linha folha__ajuda--alerta" },
            `A jornada seguinte parte de outro valor em ${divergentes.map((p) => p.nome).join(", ")}. ` +
              "Corrija ela também para o dia fechar."
          )
        );
      }
    }
  }

  async function salvar() {
    valores[campo] = teclados[campo].valor;

    const saldoInicial = {};
    const saldosFinais = {};
    for (const p of plataformas) {
      if (valores[`base_${p.id}`] > 0) saldoInicial[p.id] = valores[`base_${p.id}`];
      if (valores[`fim_${p.id}`] != null) saldosFinais[p.id] = valores[`fim_${p.id}`];
    }

    await store.corrigirJornada(jornada.id, {
      odometroInicio: valores.odometroInicio,
      odometroFim: valores.odometroFim,
      saldoInicial,
      observacoes: observacoes.value.trim(),
    });
    await store.corrigirSaldoJornada(jornada.id, saldosFinais);

    const depois = await store.contornoDaJornada(jornada.id);
    folha.fechar();
    vibrar(40);
    mostrarToast({
      titulo: `Jornada corrigida · R$ ${M.formatarReais(depois.ganho, { comCentavos: false })}`,
      detalhe: `Dia em R$ ${M.formatarReais(depois.saldoDia, { comCentavos: false })}`,
      duracao: 6000,
    });
  }
}
