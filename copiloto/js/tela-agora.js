// tela-agora.js — a tela que fica aberta 90% do tempo. Responde uma pergunta
// só: "como estou indo agora?".

import { el, limpar, abrirFolha, chips } from "./ui.js";
import * as M from "./metrics.js";
import * as store from "./store.js";
import { cfg, configAtual, salvarConfig, MOTIVOS_PAUSA, PLATAFORMAS } from "./config.js";
import { vibrar, falar } from "./feedback.js";
import { abrirRegistro } from "./tela-registro.js";
import { abrirCorrida, iniciarCronometro } from "./tela-corrida.js";
import { abrirFechamento } from "./tela-fechamento.js";
import { abrirCusto } from "./tela-custo.js";
import { Teclado } from "./keypad.js";

const NOME_NIVEL = { abaixo: "abaixo", piso: "piso", ideal: "ideal", otimo: "ótimo" };

export function montarAgora(raiz) {
  const desenhar = () => render(raiz);
  store.assinar(desenhar);
  // O relogio corre, entao a tela precisa do tique de 1s. Mas nao ha por que
  // redesenhar atras de uma folha aberta ou com o app em segundo plano — sao
  // 10 horas de bateria em jogo.
  setInterval(() => {
    if (document.hidden || document.querySelector(".folha-fundo")) return;
    desenhar();
  }, 1000);
  desenhar();
}

function render(raiz) {
  const jornada = store.jornadaAtiva();
  limpar(raiz);
  raiz.append(jornada ? painelAtivo() : painelParado());
}

/* ------------------------------------------------------ jornada parada */

function painelParado() {
  const base = store.saldoDoDia();
  const anteriores = store.jornadasDoDia().length;

  return el(
    "div",
    { class: "vazio" },
    el("div", { class: "vazio__marca" }, "Copiloto"),
    anteriores
      ? el(
          "div",
          { class: "vazio__resumo" },
          el("div", { class: "vazio__resumo-valor" }, `R$ ${M.formatarReais(base, { comCentavos: false })}`),
          el(
            "div",
            { class: "vazio__resumo-nota" },
            `hoje, em ${anteriores} jornada${anteriores > 1 ? "s" : ""} encerrada${anteriores > 1 ? "s" : ""}`
          )
        )
      : el("p", { class: "vazio__texto" }, "Nenhuma jornada aberta."),
    el(
      "button",
      { type: "button", class: "botao botao--primario botao--gigante", onClick: abrirNovaJornada },
      anteriores ? "ABRIR OUTRA JORNADA" : "ABRIR JORNADA"
    ),
    el("p", { class: "vazio__dica" }, "Um toque aqui, o odômetro, e você está rodando.")
  );
}

/**
 * Abertura de jornada. Quando já houve jornada hoje, pede também o saldo atual
 * de cada plataforma: a Uber não zera "ganhos de hoje" ao meio-dia, então sem
 * essa linha de base a jornada da tarde nasceria herdando o dinheiro da manhã
 * e mostrando um R$/hora que ela não produziu.
 */
async function abrirNovaJornada() {
  vibrar();
  const sugestao = await store.saldoInicialSugerido();
  const temAnterior = Object.keys(sugestao).length > 0;

  const alvos = [
    { id: "odometro", nome: "Odômetro" },
    ...(temAnterior
      ? PLATAFORMAS.filter((p) => cfg("plataformasAtivas").includes(p.id)).map((p) => ({
          id: p.id,
          nome: p.nome,
        }))
      : []),
  ];

  const valores = { odometro: null, ...sugestao };
  let alvo = "odometro";

  const visor = el("div", { class: "visor visor--odometro" }, "—");
  const legenda = el("div", { class: "visor__legenda" }, "");
  const caixaTeclado = el("div", { class: "registro__teclado" });
  const teclados = {
    odometro: new Teclado({ modo: "inteiro", aoMudar: aoDigitar }),
    ...Object.fromEntries(PLATAFORMAS.map((p) => [p.id, new Teclado({ modo: "dinheiro", aoMudar: aoDigitar })])),
  };

  const linhaAlvos = chips(alvos, { selecionado: alvo, classe: "chips--alvos", aoEscolher: selecionar });
  const botao = el(
    "button",
    { type: "button", class: "botao botao--primario botao--gigante", disabled: true, onClick: comecar },
    "COMEÇAR"
  );

  const folha = abrirFolha({
    titulo: temAnterior ? "Nova jornada de hoje" : "Odômetro agora",
    classe: "folha--alta folha--registro",
    conteudo: [
      temAnterior ? el("p", { class: "folha__ajuda" }, "Confira o saldo em que cada plataforma está agora — é a partir dele que esta jornada conta.") : null,
      alvos.length > 1 ? linhaAlvos : null,
      visor,
      legenda,
      caixaTeclado,
    ],
    rodape: [botao],
  });

  selecionar(alvo);

  function selecionar(id) {
    valores[alvo] = teclados[alvo].valor;
    alvo = id;
    caixaTeclado.replaceChildren(teclados[id].el);
    teclados[id].definir(valores[id] ?? null);
    visor.classList.toggle("visor--odometro", id === "odometro");
    atualizar();
  }

  function aoDigitar() {
    valores[alvo] = teclados[alvo].valor;
    atualizar();
  }

  function atualizar() {
    visor.textContent = teclados[alvo].exibicao;
    legenda.textContent =
      alvo === "odometro"
        ? "O número do painel. Entra duas vezes por dia: agora e no fim."
        : `Saldo atual na ${PLATAFORMAS.find((p) => p.id === alvo)?.nome} — o que já está no bolso hoje`;
    botao.disabled = !(valores.odometro > 0);
  }

  async function comecar() {
    valores[alvo] = teclados[alvo].valor;
    if (!(valores.odometro > 0)) return;

    const saldoInicial = {};
    for (const p of PLATAFORMAS) if (valores[p.id] > 0) saldoInicial[p.id] = valores[p.id];

    await store.abrirJornada({ odometroInicio: valores.odometro, saldoInicial });
    vibrar([30, 40, 30]);
    falar("Jornada aberta.");
    folha.fechar();
  }
}

/* ------------------------------------------------------ jornada ativa */

function painelAtivo() {
  const m = store.metricas();
  const pausa = store.pausaEmCurso();
  const config = configAtual();
  const dirigindo = cfg("modoDirigindo");

  const raiz = el("div", { class: `agora ${pausa ? "agora--pausado" : ""}`.trim() });
  raiz.append(blocoSaldo(m, pausa));

  if (dirigindo) {
    raiz.append(el("div", { class: "metricas metricas--reduzida" }, tileHora(m)));
    raiz.append(blocoAcoes(pausa, true));
    return raiz;
  }

  raiz.append(el("div", { class: "metricas" }, tileHora(m), tileKm(m), tileTempo(m)));
  raiz.append(medidorKm(m, config));
  raiz.append(barraMeta(m));
  raiz.append(linhaProjecao(m));
  raiz.append(blocoAcoes(pausa, false));
  raiz.append(rodapeDados(m, config));
  return raiz;
}

function blocoSaldo(m, pausa) {
  if (pausa) {
    const motivo = MOTIVOS_PAUSA.find((x) => x.id === pausa.motivo);
    return el(
      "section",
      { class: "saldo saldo--pausa" },
      el("div", { class: "saldo__rotulo" }, `Em pausa · ${motivo?.nome || pausa.motivo}`),
      el("div", { class: "cronometro" }, M.formatarDuracao(Date.now() - pausa.horaInicio)),
      el("div", { class: "saldo__nota" }, `Relógio parado. Saldo R$ ${M.formatarReais(m.saldo)}`)
    );
  }
  return el(
    "section",
    { class: "saldo" },
    el("div", { class: "saldo__rotulo" }, "Saldo do dia"),
    el(
      "div",
      { class: "saldo__valor" },
      el("span", { class: "saldo__cifrao" }, "R$"),
      M.formatarReais(m.saldo, { comCentavos: false })
    ),
    m.base > 0
      ? el(
          "div",
          { class: "saldo__nota" },
          `${M.formatarReais(m.base, { comCentavos: false })} ao abrir ` +
            `+ ${M.formatarReais(m.ganho, { comCentavos: false })} nesta jornada`
        )
      : null
  );
}

/**
 * O número grande é o do bloco, não o do dia. A cor é o que se lê de relance, e
 * ela precisa dizer "como estou agora" — a média acumulada do dia, na oitava
 * hora, já está quase toda decidida pelo passado. O dia continua visível na
 * linha de baixo, e a barra de meta logo abaixo é onde ele realmente importa.
 */
function tile(rotulo, { valorBloco, nivelBloco, valorDia, nivelDia, casas, sufixoDia }) {
  const temBloco = valorBloco != null;
  const grande = temBloco ? valorBloco : valorDia;
  const nivel = temBloco ? nivelBloco : nivelDia;

  return el(
    "div",
    { class: `tile tile--${nivel || "neutro"}` },
    el("div", { class: "tile__rotulo" }, rotulo),
    el("div", { class: "tile__valor" }, grande == null ? "—" : grande.toFixed(casas).replace(".", ",")),
    el("div", { class: "tile__nivel" }, temBloco ? `bloco · ${NOME_NIVEL[nivel] || ""}`.trim() : "dia"),
    el(
      "div",
      { class: `tile__dia ${temBloco ? "" : "tile__dia--fraco"}`.trim() },
      temBloco
        ? `dia ${valorDia == null ? "—" : valorDia.toFixed(casas).replace(".", ",")}${sufixoDia || ""}`
        : "bloco —"
    )
  );
}

function tileHora(m) {
  return tile("R$/hora", {
    valorBloco: m.bloco?.reaisPorHora ?? null,
    nivelBloco: m.bloco?.nivelHora,
    valorDia: m.reaisPorHora,
    nivelDia: m.nivelHora,
    casas: 0,
  });
}

function tileKm(m) {
  return tile("R$/km", {
    valorBloco: m.bloco?.reaisPorKm ?? null,
    nivelBloco: m.bloco?.nivelKm,
    valorDia: m.reaisPorKm,
    nivelDia: m.nivelKm,
    casas: 2,
  });
}

function tileTempo(m) {
  return el(
    "div",
    { class: "tile tile--neutro" },
    el("div", { class: "tile__rotulo" }, "Ativo"),
    el("div", { class: "tile__valor" }, M.formatarDuracao(m.msAtivo)),
    el("div", { class: "tile__nivel" }, `rua ${M.formatarDuracao(m.msRua)}`),
    el(
      "div",
      { class: "tile__dia tile__dia--fraco" },
      m.bloco ? `bloco ${M.formatarDuracao(m.bloco.msAtivo)}` : "—"
    )
  );
}

/**
 * Medidor do R$/km com as tres faixas do periodo e a linha de break-even —
 * o unico numero do app que nao é opiniao: abaixo dele o dia dá prejuízo.
 */
function medidorKm(m, config) {
  const custos = M.custosEstimados(1, config, store.energiaKm());
  const agulha = m.bloco?.reaisPorKm ?? m.reaisPorKm;
  const teto = Math.max(m.faixaKm.otimo * 1.25, (agulha ?? 0) * 1.1, custos.totalKm * 1.5);
  const piso = custos.totalKm * 0.6;
  const faixa = teto - piso;
  const pct = (v) => `${Math.min(100, Math.max(0, ((v - piso) / faixa) * 100))}%`;
  const largura = (v) => `${Math.min(100, Math.max(0, (v / faixa) * 100))}%`;

  const trilha = el(
    "div",
    { class: "medidor__trilha" },
    el("div", { class: "medidor__zona medidor__zona--abaixo", style: { width: pct(m.faixaKm.piso) } }),
    el("div", { class: "medidor__zona medidor__zona--piso", style: { width: largura(m.faixaKm.ideal - m.faixaKm.piso) } }),
    el("div", { class: "medidor__zona medidor__zona--ideal", style: { width: largura(m.faixaKm.otimo - m.faixaKm.ideal) } }),
    el("div", { class: "medidor__zona medidor__zona--otimo", style: { flex: "1" } }),
    el("div", {
      class: "medidor__breakeven",
      style: { left: pct(custos.totalKm) },
      title: `Custo real R$ ${M.formatarReais(custos.totalKm)}/km`,
    }),
    agulha != null ? el("div", { class: "medidor__agulha", style: { left: pct(agulha) } }) : null
  );

  return el(
    "section",
    { class: "medidor" },
    trilha,
    el(
      "div",
      { class: "medidor__legenda" },
      el("span", {}, `chão ${M.formatarReais(custos.totalKm)}`),
      el("span", {}, `piso ${m.faixaKm.piso.toFixed(2).replace(".", ",")}`),
      el("span", {}, `ideal ${m.faixaKm.ideal.toFixed(2).replace(".", ",")}`),
      el("span", {}, `ótimo ${m.faixaKm.otimo.toFixed(2).replace(".", ",")}`)
    )
  );
}

function metasDaJornada() {
  const j = store.jornadaAtiva();
  return { metaMinima: j.metaMinima, metaIdeal: j.metaIdeal, metaOtima: j.metaOtima };
}

function barraMeta(m) {
  const metas = metasDaJornada();
  const lista = M.patamares(metas);
  const teto = Math.max(lista[lista.length - 1].alvo, m.saldo) * 1.02;
  const pct = (v) => `${Math.min(100, (v / teto) * 100)}%`;
  const proximo = M.proximoPatamar(m.saldo, metas);

  return el(
    "section",
    { class: "meta" },
    el(
      "div",
      { class: "meta__barra" },
      el("div", { class: "meta__preenchimento", style: { width: pct(m.saldo) } }),
      ...lista.map((p, i) =>
        el(
          "div",
          {
            class: `meta__marca ${m.saldo >= p.alvo ? "meta__marca--batida" : ""}`.trim(),
            style: { left: pct(p.alvo) },
          },
          el(
            "span",
            { class: `meta__marca-rotulo ${i === lista.length - 1 ? "meta__marca-rotulo--fim" : ""}`.trim() },
            p.nome
          )
        )
      )
    ),
    el(
      "div",
      { class: "meta__texto" },
      proximo
        ? el(
            "span",
            {},
            "Faltam ",
            el("strong", {}, `R$ ${M.formatarReais(proximo.alvo - m.saldo, { comCentavos: false })}`),
            ` para a ${proximo.nome.toLowerCase()}`
          )
        : el("span", { class: "meta__texto--completa" }, "Todas as metas batidas hoje 🎉")
    )
  );
}

/**
 * A versão anterior dizia só "meta fora de alcance no ritmo atual" — um
 * veredito sem dado nenhum. Aqui saem os números que permitem decidir:
 * onde o ritmo atual termina, quanto falta e que ritmo seria preciso. A linha
 * é tocável para ajustar a meta na hora.
 */
function linhaProjecao(m) {
  const p = M.projecaoDetalhada({
    // saldo é do dia (de onde a meta parte); ganho e tempo são desta jornada
    // (de onde sai o ritmo). Misturar os dois inventa projeções absurdas.
    saldo: m.saldo,
    ganho: m.ganho,
    msAtivos: m.msAtivo,
    metas: metasDaJornada(),
    horaLimite: cfg("horaLimiteMeta"),
  });

  const linhas = [];
  let classe = "projecao";

  if (p.tipo === "completa") {
    linhas.push("Tudo batido. O resto do dia é lucro.");
  } else if (p.tipo === "sem_ritmo") {
    linhas.push(`Faltam R$ ${M.formatarReais(p.falta, { comCentavos: false })} para a ${p.alvo.nome.toLowerCase()}`);
    linhas.push(
      p.msAtivos < M.MIN_ATIVO_PROJECAO
        ? "Ritmo em medição — a projeção sai depois de 30 min de jornada"
        : "Registre um saldo para o ritmo aparecer"
    );
    classe += " projecao--fraca";
  } else {
    linhas.push(
      `No ritmo atual: R$ ${M.formatarReais(p.projetado, { comCentavos: false })} até ${M.formatarHora(p.limite)}`
    );
    if (p.tipo === "alcancavel") {
      linhas.push(`${p.alvo.nome} (${M.formatarReais(p.alvo.alvo, { comCentavos: false })}) às ${M.formatarHora(p.chegaEm)}`);
    } else {
      linhas.push(
        `${p.alvo.nome} pede R$ ${p.ritmoNecessario.toFixed(0)}/h nas próximas ` +
          `${p.horasRestantes.toFixed(1).replace(".", ",")}h · você está em ${p.ritmo.toFixed(0)}/h`
      );
      classe += " projecao--alerta";
    }
  }

  return el(
    "button",
    { type: "button", class: `${classe} projecao--botao`, onClick: ajustarMetas },
    ...linhas.map((texto, i) => el("span", { class: i ? "projecao__detalhe" : "projecao__principal" }, texto)),
    el("span", { class: "projecao__toque" }, "tocar para ajustar a meta")
  );
}

function ajustarMetas() {
  vibrar();
  const jornada = store.jornadaAtiva();
  const metas = {
    minima: jornada.metaMinima,
    ideal: jornada.metaIdeal,
    otima: jornada.metaOtima,
  };
  let virarPadrao = false;

  const campo = (chave, rotulo) => {
    const valorEl = el("span", { class: "campo__valor" }, "");
    const pintar = () => (valorEl.textContent = `R$ ${M.formatarReais(metas[chave], { comCentavos: false })}`);
    const ajustar = (dir) => {
      metas[chave] = Math.max(0, metas[chave] + dir * 10);
      pintar();
      vibrar(8);
    };
    pintar();
    return el(
      "div",
      { class: "campo" },
      el("span", { class: "campo__rotulo" }, rotulo),
      el(
        "div",
        { class: "campo__stepper" },
        el("button", { type: "button", class: "stepper", onClick: () => ajustar(-1) }, "−"),
        valorEl,
        el("button", { type: "button", class: "stepper", onClick: () => ajustar(1) }, "+")
      )
    );
  };

  const padrao = el("button", { type: "button", class: "chip", onClick: () => {
    virarPadrao = !virarPadrao;
    padrao.classList.toggle("chip--ativo", virarPadrao);
    vibrar(8);
  } }, "Usar também como padrão");

  let folha;
  folha = abrirFolha({
    titulo: "Metas de hoje",
    conteudo: [
      el("p", { class: "folha__ajuda" }, "Vale para esta jornada. Marque abaixo para valer também nos próximos dias."),
      campo("minima", "Mínima"),
      campo("ideal", "Ideal"),
      campo("otima", "Ótima"),
      padrao,
    ],
    rodape: [
      el(
        "button",
        {
          type: "button",
          class: "botao botao--primario botao--gigante",
          onClick: async () => {
            await store.ajustarMetas(metas);
            if (virarPadrao) {
              await salvarConfig("metaMinima", metas.minima);
              await salvarConfig("metaIdeal", metas.ideal);
              await salvarConfig("metaOtima", metas.otima);
            }
            vibrar(40);
            folha.fechar();
          },
        },
        "SALVAR"
      ),
    ],
  });
}

function blocoAcoes(pausa, reduzido) {
  const registrar = el(
    "button",
    { type: "button", class: "botao botao--primario botao--gigante", onClick: () => abrirRegistro() },
    "+ REGISTRAR"
  );
  if (reduzido) return el("div", { class: "acoes" }, registrar);

  const emCurso = store.corridaEmCurso();
  const corrida = emCurso
    ? el(
        "button",
        { type: "button", class: "botao botao--corrida botao--gigante acoes__larga", onClick: () => abrirCorrida() },
        `■ FIM DA CORRIDA · ${M.formatarDuracao(Date.now() - emCurso.inicio)}`
      )
    : el(
        "div",
        { class: "acoes__larga acoes__dupla" },
        el(
          "button",
          { type: "button", class: "botao botao--secundario botao--gigante", onClick: iniciarCronometro },
          "▶ INICIAR CORRIDA"
        ),
        el(
          "button",
          { type: "button", class: "botao botao--secundario botao--gigante", onClick: () => abrirCorrida() },
          "✎ LANÇAR"
        )
      );

  const pausar = pausa
    ? el(
        "button",
        {
          type: "button",
          class: "botao botao--retomar botao--gigante",
          onClick: async () => {
            await store.encerrarPausa();
            vibrar([30, 40, 30]);
            falar("Retomando.");
          },
        },
        "▶ RETOMAR"
      )
    : el(
        "button",
        { type: "button", class: "botao botao--secundario botao--gigante", onClick: escolherPausa },
        "⏸ PAUSAR"
      );

  return el("div", { class: "acoes" }, registrar, pausar, corrida);
}

function escolherPausa() {
  vibrar();
  let folha;
  const grade = chips(MOTIVOS_PAUSA, {
    classe: "chips--grade",
    aoEscolher: async (id) => {
      await store.iniciarPausa(id);
      vibrar([25, 30, 25]);
      falar("Pausa iniciada. Relógio parado.");
      folha.fechar();
      // Parou para abastecer: o formulário já vem junto, com o odômetro
      // enquanto ele ainda está no posto e consegue olhar o painel.
      if (id === "abastecimento") setTimeout(() => abrirCusto({ tipoInicial: "gnv" }), 260);
    },
  });
  folha = abrirFolha({ titulo: "Pausa — por quê?", conteudo: [grade] });
}

/**
 * Quantas corridas foram lancadas e se elas batem com o saldo. Uma diferenca
 * grande quase sempre é corrida esquecida — melhor descobrir hoje do que na
 * hora de fechar a planilha.
 */
function linhaCorridas() {
  const corridas = store.corridasDoDia();
  if (!corridas.length) return null;
  const conferencia = store.conferencia();
  const somado = M.somaCorridas(corridas);
  const texto = `${corridas.length} corrida${corridas.length > 1 ? "s" : ""} · R$ ${M.formatarReais(somado, { comCentavos: false })}`;

  if (!conferencia || conferencia.fecha) return el("div", { class: "dados__fontes" }, texto);
  return el(
    "div",
    { class: "dados__fontes dados__fontes--alerta" },
    `${texto} · faltam R$ ${M.formatarReais(Math.abs(conferencia.diferenca), { comCentavos: false })} para bater com o saldo`
  );
}

function linhaCustos() {
  const custos = store.custosDaJornada();
  if (!custos.length) return null;
  const total = custos.reduce((soma, c) => soma + (c.valor || 0), 0);
  return el(
    "div",
    { class: "dados__fontes" },
    `${custos.length} gasto${custos.length > 1 ? "s" : ""} · R$ ${M.formatarReais(total, { comCentavos: false })}`
  );
}

function rodapeDados(m, config) {
  const custos = M.custosEstimados(m.km, config, store.energiaKm());
  const liquido = m.saldo - custos.total;
  const fontes = PLATAFORMAS.filter((p) => m.fontes[p.id]?.valor > 0).map(
    (p) => `${p.nome} ${M.formatarReais(m.fontes[p.id].valor, { comCentavos: false })}`
  );
  if (m.fontes.avulso.valor > 0) {
    fontes.push(`avulso ${M.formatarReais(m.fontes.avulso.valor, { comCentavos: false })}`);
  }

  // Sem âncora de odômetro não há km, e sem km o R$/km some. Vale avisar em
  // vez de deixar o traço no tile sem explicação.
  const km =
    m.km > 0
      ? `${m.km.toFixed(1).replace(".", ",")} km`
      : "sem km — informe o odômetro";

  return el(
    "section",
    { class: "dados" },
    el(
      "div",
      { class: "dados__linha" },
      el("span", { class: m.km > 0 ? "" : "dados__gps" }, km),
      m.km > 0 ? el("span", {}, `líquido ≈ R$ ${M.formatarReais(liquido, { comCentavos: false })}`) : null,
      el("span", { class: "dados__gps" }, `${m.ancoras} âncora${m.ancoras === 1 ? "" : "s"}`)
    ),
    fontes.length ? el("div", { class: "dados__fontes" }, fontes.join(" · ")) : null,
    linhaCorridas(),
    linhaCustos(),
    el(
      "div",
      { class: "dados__botoes" },
      el(
        "button",
        {
          type: "button",
          class: "botao botao--texto",
          onClick: async () => {
            await salvarConfig("modoDirigindo", !cfg("modoDirigindo"));
            store.notificar();
          },
        },
        cfg("modoDirigindo") ? "Sair do modo dirigindo" : "Modo dirigindo"
      ),
      el("button", { type: "button", class: "botao botao--texto", onClick: () => abrirFechamento() }, "Encerrar jornada")
    )
  );
}
